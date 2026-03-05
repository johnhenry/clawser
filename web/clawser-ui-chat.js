// clawser-ui-chat.js — Core messaging UI: chat, streaming, conversations, replay
import { $, esc, state, emit, setSending, setConversation, resetConversationState } from './clawser-state.js';
import { modal } from './clawser-modal.js';
import { loadConversations, updateConversationMeta, generateConvId } from './clawser-conversations.js';
import { loadAccounts } from './clawser-accounts.js';
import { updateRouteHash } from './clawser-router.js';
import { estimateCost, classifyError } from './clawser-providers.js';
import { createItemBar, _relativeTime, _downloadText } from './clawser-item-bar.js';
import { recordCostEvent } from './clawser-ui-config.js';

// ── Lightweight markdown rendering for agent messages ──────────
let _marked = null;
async function getMarked() {
  if (_marked) return _marked;
  try {
    const mod = await import('https://esm.sh/marked@15.0.4');
    mod.marked.setOptions({ gfm: true, breaks: true });
    _marked = mod.marked;
  } catch {
    // Fallback: return identity function (raw text)
    _marked = (s) => esc(s).replace(/\n/g, '<br>');
  }
  return _marked;
}
// Eager-load on module init (non-blocking)
getMarked();

/** Render markdown to sanitized HTML for agent messages. */
function renderMarkdown(text) {
  if (!_marked || typeof _marked !== 'function') return esc(text);
  try {
    return _marked(text);
  } catch {
    return esc(text);
  }
}

// ── Reset helpers (shared for clearing tool/event + message state) ──
/** Clear tool call log, event log, and their DOM elements. */
export function resetToolAndEventState() {
  state.toolCallLog = [];
  state.eventLog = [];
  state.eventCount = 0;
  $('toolCount').textContent = '0';
  $('eventCount').textContent = '0';
  $('toolCalls').innerHTML = '';
  $('eventLog').innerHTML = '';
}

/** Clear all chat messages and reset tool/event state. */
export function resetChatUI() {
  $('messages').innerHTML = '';
  resetToolAndEventState();
}

// ── Status ──────────────────────────────────────────────────────
/** Update the status indicator dot and text. @param {string} statusState - CSS class ('ready'|'busy'|'error') @param {string} text */
export function setStatus(statusState, text) {
  $('statusDot').className = `dot ${statusState}`;
  $('statusText').textContent = text;
}

// ── Message display ─────────────────────────────────────────────
/** Append a message to the chat panel and auto-scroll. @param {'user'|'agent'|'system'|'error'} type @param {string} text @param {string} [eventId] - Event ID for fork-from-point (user messages only) */
export function addMsg(type, text, eventId) {
  const messagesEl = $('messages');
  const d = document.createElement('div');
  d.className = `msg ${type}`;
  if (type === 'user') {
    if (eventId) d.dataset.eventId = eventId;
    d.innerHTML = `<div class="label">You<span class="msg-fork" title="Fork from here">\u2442</span></div>${esc(text)}`;
    d.querySelector('.msg-fork').addEventListener('click', (e) => {
      e.stopPropagation();
      const evtId = d.dataset.eventId;
      if (evtId) forkConversationFromEvent(evtId);
    });
  } else if (type === 'agent') {
    const avatarUrl = state.identityManager?.getCurrent?.()?.physicality?.avatar_url;
    const avatarHtml = avatarUrl ? `<img class="msg-avatar" src="${esc(avatarUrl)}" alt="" />` : '';
    d.innerHTML = `<div class="label">${avatarHtml}Agent</div><div class="md-content">${renderMarkdown(text)}</div>`;
  } else {
    d.textContent = text;
  }
  messagesEl.appendChild(d);
  messagesEl.scrollTop = messagesEl.scrollHeight;
}

/**
 * Display an error message with an optional retry button.
 * @param {string} text - Error message
 * @param {Function|null} onRetry - If provided, adds a "Retry" button that calls this function
 */
export function addErrorMsg(text, onRetry = null) {
  const messagesEl = $('messages');
  const d = document.createElement('div');
  d.className = 'msg error';
  d.textContent = text;
  if (onRetry) {
    const btn = document.createElement('button');
    btn.className = 'retry-btn';
    btn.textContent = 'Retry';
    btn.addEventListener('click', () => {
      d.remove();
      onRetry();
    });
    d.appendChild(btn);
  }
  messagesEl.appendChild(d);
  messagesEl.scrollTop = messagesEl.scrollHeight;
}

// ── Tool call tracking ──────────────────────────────────────────
/** Record a tool call in the sidebar log (capped at 100 entries). @param {string} name @param {Object} params @param {Object|null} result */
export function addToolCall(name, params, result) {
  const entry = { name, params, result, time: new Date().toLocaleTimeString() };
  state.toolCallLog.unshift(entry);
  if (state.toolCallLog.length > 100) state.toolCallLog.pop();
  renderToolCalls();
}

/** Re-render the tool calls sidebar from the in-memory log. */
export function renderToolCalls() {
  $('toolCount').textContent = state.toolCallLog.length;
  const el = $('toolCalls');
  el.innerHTML = '';
  for (const tc of state.toolCallLog.slice(0, 50)) {
    const div = document.createElement('div');
    div.className = 'tool-entry';
    const isOk = tc.result?.success !== false;
    const icon = tc.result === null ? '⏳' : isOk ? '✓' : '✗';
    const iconClass = tc.result === null ? 'run' : isOk ? 'ok' : 'err';
    div.innerHTML = `
      <div class="tool-head">
        <span class="status-icon ${iconClass}">${icon}</span>
        <span class="name">${esc(tc.name)}</span>
        <span class="tool-time">${tc.time}</span>
      </div>
      <div class="tool-body">Params: ${esc(JSON.stringify(tc.params, null, 2))}\n\nResult: ${esc(tc.result ? (tc.result.output || tc.result.error || '(empty)') : '(pending)')}</div>
    `;
    div.querySelector('.tool-head').addEventListener('click', function() {
      this.parentElement.classList.toggle('expanded');
    });
    el.appendChild(div);
  }
}

// ── Sub-Agent UI (Phase 3b) ──────────────────────────────────────

const _subAgentBlocks = new Map();

/**
 * Add a collapsible sub-agent block in the chat flow.
 * @param {string} id - Sub-agent ID
 * @param {string} goal - What the sub-agent is doing
 * @returns {HTMLElement}
 */
export function addSubAgentBlock(id, goal) {
  const messagesEl = $('messages');
  const d = document.createElement('div');
  d.className = 'msg subagent-card';
  d.innerHTML = `
    <div class="subagent-head">
      <span class="sa-icon">\u{1F916}</span>
      <span class="sa-task">${esc(goal || 'Sub-agent')}</span>
      <span class="sa-stats" id="saStats_${esc(id)}">running...</span>
    </div>
    <div class="subagent-detail" id="saDetail_${esc(id)}"></div>
  `;
  d.querySelector('.subagent-head').addEventListener('click', () => {
    d.classList.toggle('expanded');
  });
  messagesEl.appendChild(d);
  messagesEl.scrollTop = messagesEl.scrollHeight;
  _subAgentBlocks.set(id, d);
  return d;
}

/**
 * Update a sub-agent block with iteration/tool-call events.
 * @param {string} id - Sub-agent ID
 * @param {{type: string, text?: string, name?: string, iteration?: number}} event
 */
export function updateSubAgentBlock(id, event) {
  const block = _subAgentBlocks.get(id);
  if (!block) return;
  const detail = block.querySelector(`#saDetail_${id}`);
  const stats = block.querySelector(`#saStats_${id}`);
  if (!detail) return;

  if (event.type === 'iteration') {
    const line = document.createElement('div');
    line.textContent = `[iter ${event.iteration}] ${event.text || ''}`;
    detail.appendChild(line);
  } else if (event.type === 'tool_call') {
    const line = document.createElement('div');
    line.style.color = 'var(--accent)';
    line.textContent = `\u{1F527} ${event.name || 'tool'}: ${(event.text || '').slice(0, 80)}`;
    detail.appendChild(line);
  } else if (event.type === 'done') {
    if (stats) stats.textContent = `completed \u2713`;
    stats?.classList.add('sa-done');
  } else if (event.type === 'error') {
    if (stats) stats.textContent = `error \u2717`;
    stats?.classList.add('sa-error');
  }

  // Auto-scroll detail if expanded
  if (block.classList.contains('expanded')) {
    detail.scrollTop = detail.scrollHeight;
  }
}

// ── Rich card tool call helpers ──────────────────────────────────

/** Format a duration in ms to a human-readable string. */
function formatDuration(ms) {
  if (ms < 1000) return `${Math.round(ms)}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  const m = Math.floor(ms / 60000);
  const s = Math.round((ms % 60000) / 1000);
  return `${m}m ${s}s`;
}

/** Generate a smart one-line summary for the tool card header. */
function toolSummary(name, params, output) {
  if (!params) params = {};
  // File ops → show path
  if (/^fs_(read|write|mkdir|rm|ls)$/.test(name) && params.path)
    return params.path;
  // Fetch → hostname
  if (name === 'fetch_url' && params.url) {
    try { return new URL(params.url).hostname; } catch { return params.url.slice(0, 50); }
  }
  // Search → query
  if (name === 'web_search' && params.query)
    return params.query.slice(0, 50);
  // Codex eval
  if (name === '_codex_eval') return 'code eval';
  // Fallback: first non-empty line of output
  if (output) {
    const first = String(output).split('\n').find(l => l.trim());
    if (first) return first.slice(0, 50);
  }
  return '';
}

/** Split output into lines for preview display. */
function formatToolOutput(output, maxLines = 4) {
  if (!output) return { lines: [], total: 0, isError: false };
  const raw = String(output);
  const all = raw.split('\n');
  return { lines: all.slice(0, maxLines), total: all.length, isError: false };
}

/** Render param key-value pairs as HTML. */
function renderParamPairs(params) {
  if (!params || typeof params !== 'object' || Array.isArray(params)) return '';
  return Object.entries(params).map(([k, v]) => {
    let vs = typeof v === 'string' ? v : JSON.stringify(v);
    if (vs.length > 80) vs = vs.slice(0, 77) + '…';
    return `<div class="tc-param"><span class="tc-pk">${esc(k)}</span><span class="tc-pv">${esc(vs)}</span></div>`;
  }).join('');
}

/** Normalize params to a plain object (handles string, null, non-objects). */
function safeParamsObj(params) {
  if (!params) return {};
  if (typeof params === 'string') {
    try { const p = JSON.parse(params); return (p && typeof p === 'object' && !Array.isArray(p)) ? p : {}; } catch { return {}; }
  }
  if (typeof params === 'object' && !Array.isArray(params)) return params;
  return {};
}

/** Coerce tool output to a string. */
function safeOutputStr(result) {
  if (!result) return '';
  const raw = result.output || result.error || '';
  return typeof raw === 'string' ? raw : JSON.stringify(raw, null, 2);
}

/** Attach the "N more lines" toggle button behavior to a card. */
function _attachOutputToggle(el, outputStr, previewLines, totalLines) {
  const toggleBtn = el.querySelector('.tc-output-toggle');
  if (!toggleBtn) return;
  toggleBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    const outputEl = el.querySelector('.tc-output');
    if (!outputEl) return;
    const isExpanded = outputEl.classList.toggle('tc-output-expanded');
    const linesEl = el.querySelector('.tc-output-lines');
    if (isExpanded) {
      const allLines = outputStr.split('\n');
      linesEl.innerHTML = allLines.map((l, i) =>
        `<div class="tc-line"><span class="tc-ln">${i + 1}</span><span>${esc(l)}</span></div>`
      ).join('');
      toggleBtn.textContent = '▾ collapse';
    } else {
      linesEl.innerHTML = previewLines.map((l, i) =>
        `<div class="tc-line"><span class="tc-ln">${i + 1}</span><span>${esc(l)}</span></div>`
      ).join('');
      const moreCount = totalLines - previewLines.length;
      toggleBtn.textContent = `▸ ${moreCount} more line${moreCount === 1 ? '' : 's'}`;
    }
  });
}

// ── Inline tool calls (rich cards in chat flow) ──────────────────
/** Add a rich tool card inline in the chat flow (pending or complete).
 * @param {string} name @param {Object} params @param {Object|null} result - null for pending
 * @returns {HTMLElement} The tool call element (for later update via updateInlineToolCall)
 */
export function addInlineToolCall(name, params, result) {
  const messagesEl = $('messages');
  const displayName = name === '_codex_eval' ? 'code eval' : name;
  const safeParams = safeParamsObj(params);
  const div = document.createElement('div');

  const isPending = result === null;
  const isOk = !isPending && result?.success !== false;
  div.className = `msg tool-card ${isPending ? 'pending' : isOk ? 'ok' : 'err'}`;
  div.dataset.startTime = String(Date.now());

  const iconHtml = isPending
    ? '<span class="tool-spinner"></span>'
    : isOk ? '<span class="tc-status ok">✓</span>' : '<span class="tc-status err">✗</span>';

  const output = isPending ? '' : safeOutputStr(result);
  const summary = isPending ? 'running…' : esc(toolSummary(name, safeParams, output));
  const paramCount = Object.keys(safeParams).length;

  const { lines, total } = formatToolOutput(output);
  const isError = !isPending && !isOk;
  let outputHtml = '';
  if (!isPending && output) {
    const lineHtml = lines.map((l, i) =>
      `<div class="tc-line"><span class="tc-ln">${i + 1}</span><span>${esc(l)}</span></div>`
    ).join('');
    const moreCount = total - lines.length;
    const toggleHtml = moreCount > 0
      ? `<button class="tc-output-toggle">▸ ${moreCount} more line${moreCount === 1 ? '' : 's'}</button>` : '';
    outputHtml = `<div class="tc-output${isError ? ' tc-output-err' : ''}"><div class="tc-output-lines">${lineHtml}</div>${toggleHtml}</div>`;
  } else if (!isPending) {
    outputHtml = '<div class="tc-output"><span class="tc-empty">(no output)</span></div>';
  }

  const paramsHtml = paramCount > 0 ? `<div class="tc-params" style="display:none">${renderParamPairs(safeParams)}</div>` : '';
  const chipHtml = paramCount > 0 ? `<span class="tc-params-chip">${paramCount} param${paramCount === 1 ? '' : 's'}</span>` : '';
  const durationHtml = isPending ? '' : '<span class="tc-duration"></span>';

  div.innerHTML =
    `<div class="tc-header">` +
    `<span class="tc-icon">${iconHtml}</span>` +
    `<span class="tc-name">${esc(displayName)}</span>` +
    `<span class="tc-summary">${summary}</span>` +
    `<span class="tc-meta">${chipHtml}${durationHtml}</span>` +
    `</div>` + paramsHtml + outputHtml;

  // Header click → toggle output expansion
  div.querySelector('.tc-header').addEventListener('click', () => div.classList.toggle('expanded'));

  // Params chip click → toggle params section
  const chip = div.querySelector('.tc-params-chip');
  if (chip) {
    chip.addEventListener('click', (e) => {
      e.stopPropagation();
      const paramsEl = div.querySelector('.tc-params');
      if (paramsEl) paramsEl.style.display = paramsEl.style.display === 'none' ? '' : 'none';
    });
  }

  _attachOutputToggle(div, output, lines, total);

  messagesEl.appendChild(div);
  messagesEl.scrollTop = messagesEl.scrollHeight;
  return div;
}

/** Update a pending inline tool call element with its result. @param {HTMLElement} el @param {string} name @param {Object} params @param {Object} result */
export function updateInlineToolCall(el, name, params, result) {
  if (!el) return;
  const messagesEl = $('messages');
  const displayName = name === '_codex_eval' ? 'code eval' : name;
  const safeParams = safeParamsObj(params);
  const isOk = result?.success !== false;

  el.className = `msg tool-card ${isOk ? 'ok' : 'err'}`;

  const startTime = parseInt(el.dataset.startTime || '0', 10);
  const duration = startTime ? Date.now() - startTime : 0;

  const iconHtml = isOk
    ? '<span class="tc-status ok">✓</span>'
    : '<span class="tc-status err">✗</span>';

  const output = safeOutputStr(result);
  const summary = esc(toolSummary(name, safeParams, output));
  const paramCount = Object.keys(safeParams).length;
  const isError = !isOk;

  const { lines, total } = formatToolOutput(output);
  let outputHtml = '';
  if (output) {
    const lineHtml = lines.map((l, i) =>
      `<div class="tc-line"><span class="tc-ln">${i + 1}</span><span>${esc(l)}</span></div>`
    ).join('');
    const moreCount = total - lines.length;
    const toggleHtml = moreCount > 0
      ? `<button class="tc-output-toggle">▸ ${moreCount} more line${moreCount === 1 ? '' : 's'}</button>` : '';
    outputHtml = `<div class="tc-output${isError ? ' tc-output-err' : ''}"><div class="tc-output-lines">${lineHtml}</div>${toggleHtml}</div>`;
  } else {
    outputHtml = '<div class="tc-output"><span class="tc-empty">(no output)</span></div>';
  }

  const paramsHtml = paramCount > 0 ? `<div class="tc-params" style="display:none">${renderParamPairs(safeParams)}</div>` : '';
  const chipHtml = paramCount > 0 ? `<span class="tc-params-chip">${paramCount} param${paramCount === 1 ? '' : 's'}</span>` : '';
  const durationHtml = duration > 0 ? `<span class="tc-duration">${formatDuration(duration)}</span>` : '';

  el.innerHTML =
    `<div class="tc-header">` +
    `<span class="tc-icon">${iconHtml}</span>` +
    `<span class="tc-name">${esc(displayName)}</span>` +
    `<span class="tc-summary">${summary}</span>` +
    `<span class="tc-meta">${chipHtml}${durationHtml}</span>` +
    `</div>` + paramsHtml + outputHtml;

  // Re-attach listeners
  el.querySelector('.tc-header').addEventListener('click', () => el.classList.toggle('expanded'));

  const chip = el.querySelector('.tc-params-chip');
  if (chip) {
    chip.addEventListener('click', (e) => {
      e.stopPropagation();
      const paramsEl = el.querySelector('.tc-params');
      if (paramsEl) paramsEl.style.display = paramsEl.style.display === 'none' ? '' : 'none';
    });
  }

  _attachOutputToggle(el, output, lines, total);

  messagesEl.scrollTop = messagesEl.scrollHeight;
}

// ── Event log ───────────────────────────────────────────────────
/** Log an event to the events sidebar panel (capped at 200 entries). @param {string} topic @param {*} payload */
export function addEvent(topic, payload) {
  const str = typeof payload === 'string' ? payload : JSON.stringify(payload);
  state.eventCount++;
  state.eventLog.unshift({ topic, payload: str.slice(0, 200), time: new Date().toLocaleTimeString() });
  if (state.eventLog.length > 200) state.eventLog.pop();
  $('eventCount').textContent = state.eventCount;
  const el = $('eventLog');
  const d = document.createElement('div');
  d.className = 'event-item';
  d.innerHTML = `<span class="topic">${esc(topic)}</span> ${esc(str.slice(0, 80))}`;
  el.prepend(d);
  while (el.children.length > 100) el.removeChild(el.lastChild);
}

// ── Agent state display ─────────────────────────────────────────
/** Refresh the agent state display (history len, memory count, goals, jobs). */
export function updateState() {
  if (!state.agent) return;
  try {
    const s = state.agent.getState();
    $('stHistory').textContent = s.history_len ?? '-';
    $('stMemory').textContent = s.memory_count ?? '-';
    $('stGoals').textContent = s.goals?.length ?? '-';
    $('stJobs').textContent = s.scheduler_jobs ?? '-';
    $('goalCount').textContent = s.goals?.length ?? 0;
    $('memCount').textContent = s.memory_count ?? 0;
  } catch (e) { console.warn('[clawser] updateState error', e); }
}

// ── Cost display ────────────────────────────────────────────────
/** Update the session cost display, formatting as cents or dollars. */
export function updateCostDisplay() {
  const el = $('costDisplay');
  if (state.sessionCost <= 0) {
    el.textContent = '';
  } else if (state.sessionCost < 0.01) {
    el.textContent = `${(state.sessionCost * 100).toFixed(2)}¢`;
  } else {
    el.textContent = `$${state.sessionCost.toFixed(4)}`;
  }
}

// ── Streaming message helpers ───────────────────────────────────
/** Create a new agent message element with a blinking cursor for streaming. @returns {HTMLElement} */
export function createStreamingMsg() {
  const messagesEl = $('messages');
  const d = document.createElement('div');
  d.className = 'msg agent';
  d.innerHTML = '<div class="label">Agent</div><span class="streaming-cursor"></span>';
  messagesEl.appendChild(d);
  messagesEl.scrollTop = messagesEl.scrollHeight;
  return d;
}

/** Append a text chunk to a streaming message, repositioning the cursor. @param {HTMLElement} el @param {string} text */
export function appendToStreamingMsg(el, text) {
  const messagesEl = $('messages');
  const cursor = el.querySelector('.streaming-cursor');
  if (cursor) cursor.remove();
  el.appendChild(document.createTextNode(text));
  const newCursor = document.createElement('span');
  newCursor.className = 'streaming-cursor';
  el.appendChild(newCursor);
  messagesEl.scrollTop = messagesEl.scrollHeight;
}

/** Remove the blinking cursor and re-render content as markdown. @param {HTMLElement} el @param {string} [fullContent] - accumulated raw text to render as markdown */
export function finalizeStreamingMsg(el, fullContent) {
  const cursor = el.querySelector('.streaming-cursor');
  if (cursor) cursor.remove();
  // Re-render as markdown if we have the full accumulated text
  if (fullContent && _marked) {
    const label = el.querySelector('.label');
    // Remove all child nodes except the label
    while (el.lastChild && el.lastChild !== label) el.removeChild(el.lastChild);
    const md = document.createElement('div');
    md.className = 'md-content';
    md.innerHTML = renderMarkdown(fullContent);
    el.appendChild(md);
  }
}

// ── Persist active conversation (preserves created timestamp) ────
/** Save the active conversation's history and events to OPFS, preserving the created timestamp. */
export async function persistActiveConversation() {
  if (!state.agent || !state.activeConversationId) return;
  await state.agent.persistConversation(state.activeConversationId, {
    name: state.activeConversationName || state.activeConversationId,
  });
}

// ── Conversation name display ───────────────────────────────────
/** Update the conversation name display via the ItemBar. */
export function updateConvNameDisplay() {
  if (convItemBar) convItemBar.refresh();
}

/** Rename the active conversation. @param {string} name */
export async function renameCurrentConversation(name) {
  if (!state.agent || !state.activeConversationId || !name) return;

  setConversation(state.activeConversationId, name);
  updateConvNameDisplay();

  await persistActiveConversation();
  addMsg('system', `Conversation renamed to "${name}".`);
}

// ── New conversation ────────────────────────────────────────────
/** Start a fresh conversation: persist current, reinit agent, clear UI, reset cost/skills. */
export async function newConversation() {
  if (!state.agent) return;

  if (state.activeConversationId) {
    await persistActiveConversation();
  }

  await state.agent.reinit({});
  state.agent.restoreMemories();
  state.agent.setSystemPrompt($('systemPrompt').value);

  resetChatUI();
  resetConversationState();
  emit('newShellSession');
  emit('renderSkills');
  updateCostDisplay();
  updateConvNameDisplay();
  updateState();
  addMsg('system', 'New conversation started. Memories preserved.');
  $('userInput').focus();
  updateRouteHash();
}

// ── Switch conversation ─────────────────────────────────────────
/** Switch to an existing conversation by ID, restoring its history and events. @param {string} convId */
export async function switchConversation(convId) {
  if (state.isSending) return;
  if (!state.agent) return;
  const wsId = state.agent.getWorkspace();

  if (state.activeConversationId) {
    await persistActiveConversation();
  }

  setStatus('busy', 'loading conversation...');

  resetConversationState();
  emit('newShellSession');
  updateCostDisplay();

  await state.agent.reinit({});
  state.agent.restoreMemories();
  state.agent.setSystemPrompt($('systemPrompt').value);

  const convData = await state.agent.restoreConversation(convId);

  const evts = state.agent.getEventLog().events;
  if (evts.length > 0) {
    replayFromEvents(evts);
  } else {
    resetChatUI();
  }
  emit('renderGoals');

  setConversation(convId, convData?.name || convId);
  updateConvNameDisplay();

  await updateConversationMeta(wsId, convId, { lastUsed: Date.now() });

  updateState();
  setStatus('ready', 'ready');
  $('userInput').disabled = false;
  $('sendBtn').disabled = false;
  $('cmdPaletteBtn').disabled = false;
  $('userInput').focus();
  updateRouteHash();
}

// ── Delete conversation ─────────────────────────────────────────
/** Delete a conversation from OPFS and localStorage, resetting UI if it was active. @param {string} convId */
export async function deleteConversationEntry(convId) {
  if (!state.agent) return;

  await state.agent.deleteConversation(convId);

  if (state.activeConversationId === convId) {
    setConversation(null, null);
    updateConvNameDisplay();

    await state.agent.reinit({});
    state.agent.restoreMemories();
    state.agent.setSystemPrompt($('systemPrompt').value);

    resetChatUI();
    updateState();
    addMsg('system', 'Conversation deleted. Starting fresh.');
    updateRouteHash();
  }

  if (convItemBar) convItemBar.refresh();
}

// ── Fork conversation ────────────────────────────────────────────
/** Fork the active conversation: copy history to a new conversation. */
export async function forkConversation() {
  if (!state.agent || !state.activeConversationId) return;
  const wsId = state.agent.getWorkspace();
  await persistActiveConversation();

  const newId = generateConvId();
  const origName = state.activeConversationName || 'conversation';
  const forkName = `${origName} (fork)`;

  await state.agent.persistConversation(newId, {
    name: forkName,
    created: Date.now(),
  });

  setConversation(newId, forkName);
  updateConvNameDisplay();
  updateRouteHash();
  addMsg('system', `Forked conversation as "${forkName}".`);
}

// ── Fork conversation from specific event ────────────────────────
/** Fork the active conversation from a specific event, keeping only events up to that turn.
 * @param {string} eventId - The event ID of the user_message to fork from
 */
export async function forkConversationFromEvent(eventId) {
  if (!state.agent || !state.activeConversationId) return;
  const wsId = state.agent.getWorkspace();
  await persistActiveConversation();

  const eventLog = state.agent.getEventLog();
  const sliced = eventLog.sliceToTurnEnd(eventId);
  if (!sliced || sliced.length === 0) {
    addMsg('system', 'Fork failed: event not found.');
    return;
  }

  // Count user messages up to the fork point to label it
  const userMsgCount = sliced.filter(e => e.type === 'user_message').length;
  const origName = state.activeConversationName || 'conversation';
  const forkName = `${origName} (fork@msg ${userMsgCount})`;
  const newId = generateConvId();

  // Persist the sliced events as a new conversation via OPFS
  try {
    const root = await navigator.storage.getDirectory();
    const base = await root.getDirectoryHandle('clawser_workspaces', { create: true });
    const wsDir = await base.getDirectoryHandle(wsId, { create: true });
    const convDir = await wsDir.getDirectoryHandle('.conversations', { create: true });
    const convIdDir = await convDir.getDirectoryHandle(newId, { create: true });

    const meta = { id: newId, name: forkName, created: Date.now(), lastUsed: Date.now(), version: 2 };
    const metaFile = await convIdDir.getFileHandle('meta.json', { create: true });
    const metaWritable = await metaFile.createWritable();
    await metaWritable.write(JSON.stringify(meta));
    await metaWritable.close();

    const eventsJsonl = sliced.map(e => JSON.stringify(e)).join('\n');
    const eventsFile = await convIdDir.getFileHandle('events.jsonl', { create: true });
    const eventsWritable = await eventsFile.createWritable();
    await eventsWritable.write(eventsJsonl);
    await eventsWritable.close();
  } catch (e) {
    addMsg('system', `Fork failed: ${e.message}`);
    return;
  }

  // Switch to the forked conversation
  await switchConversation(newId);
  addMsg('system', `Forked conversation as "${forkName}" (${userMsgCount} messages kept).`);
}

// ── Export conversation ──────────────────────────────────────────
/** Export the active conversation as JSON. @returns {string} */
export function exportConversationAsJSON() {
  if (!state.agent) return '[]';
  const evts = state.agent.getEventLog().events;
  return JSON.stringify(evts, null, 2);
}

/** Export the active conversation as readable text. @returns {string} */
export function exportConversationAsText() {
  if (!state.agent) return '';
  const evts = state.agent.getEventLog().events;
  return evts.map(evt => {
    const ts = evt.timestamp ? new Date(evt.timestamp).toISOString() : '';
    switch (evt.type) {
      case 'user_message': return `[${ts}] User: ${evt.data.content}`;
      case 'agent_message': return `[${ts}] Agent: ${evt.data.content || ''}`;
      case 'system_message': return `[${ts}] System: ${evt.data.content}`;
      case 'tool_call': return `[${ts}] Tool Call: ${evt.data.name}(${JSON.stringify(evt.data.arguments)})`;
      case 'tool_result': return `[${ts}] Tool Result: ${evt.data.name} → ${JSON.stringify(evt.data.result)}`;
      case 'error': return `[${ts}] Error: ${evt.data.message}`;
      default: return `[${ts}] ${evt.type}: ${JSON.stringify(evt.data)}`;
    }
  }).join('\n');
}

// ── Conversation ItemBar ─────────────────────────────────────────
/** @type {{refresh: () => void, destroy: () => void}|null} */
export let convItemBar = null;

/** Initialize the conversation item bar (called once during chat listener setup). */
function initConvItemBar() {
  convItemBar = createItemBar({
    containerId: 'convBarContainer',
    label: 'Conversation',
    newLabel: '+ New',
    emptyMessage: 'No conversations yet.',
    defaultName: 'New conversation',
    getActiveName: () => state.activeConversationName,
    getActiveId: () => state.activeConversationId,
    listItems: async () => {
      if (!state.agent) return [];
      return await loadConversations(state.agent.getWorkspace());
    },
    onNew: () => newConversation(),
    onSwitch: (id) => switchConversation(id),
    onRename: (id, newName) => renameCurrentConversation(newName),
    onDelete: (id) => deleteConversationEntry(id),
    onFork: () => forkConversation(),
    exportFormats: [
      { label: 'Export as JSON', fn: () => exportConversationAsJSON(), filename: 'conversation.json', mime: 'application/json' },
      { label: 'Export as text', fn: () => exportConversationAsText(), filename: 'conversation.txt', mime: 'text/plain' },
    ],
    renderMeta: (item) => {
      const ago = _relativeTime(item.lastUsed || item.created);
      return `${item.messageCount || 0} msgs \u00b7 ${ago}`;
    },
  });
}

// ── Replay session history (checkpoint-based, legacy) ───────────
/** Replay chat messages from a checkpoint-based session history array (legacy format).
 * @param {Array<Object>} history - Array of {role, content, tool_calls?} messages
 */
export function replaySessionHistory(history) {
  const pendingReplay = new Map();
  for (const msg of history) {
    if (msg.role === 'user') {
      addMsg('user', msg.content);
    } else if (msg.role === 'assistant') {
      if (msg.content) addMsg('agent', msg.content);
      if (msg.tool_calls) {
        for (const tc of msg.tool_calls) {
          const name = tc.function?.name || tc.name || 'unknown';
          const args = tc.function?.arguments || tc.arguments || {};
          const parsedArgs = typeof args === 'string' ? (() => { try { return JSON.parse(args); } catch { return args; } })() : args;
          const el = addInlineToolCall(name, parsedArgs, null);
          if (tc.id) pendingReplay.set(tc.id, { el, name, params: parsedArgs });
        }
      }
    } else if (msg.role === 'tool') {
      const toolCallId = msg.tool_call_id;
      let result;
      try { result = JSON.parse(msg.content); } catch { result = { success: true, output: msg.content }; }
      if (toolCallId && pendingReplay.has(toolCallId)) {
        const { el, name, params } = pendingReplay.get(toolCallId);
        updateInlineToolCall(el, name, params, result);
        pendingReplay.delete(toolCallId);
        addToolCall(name, params, result);
      } else {
        const name = msg.name || 'tool';
        addToolCall(name, {}, result);
      }
    }
  }
}

// ── Replay from events (v2 — single source of truth) ────────────
/** Replay the chat UI from an event log array (v2 event-sourced format).
 * @param {Array<Object>} events - EventLog entries with type and data
 */
export function replayFromEvents(events) {
  resetChatUI();

  const pendingReplayTools = new Map();

  for (const evt of events) {
    switch (evt.type) {
      case 'user_message':
        addMsg('user', evt.data.content, evt.id);
        break;
      case 'agent_message':
        if (evt.data.content) addMsg('agent', evt.data.content);
        break;
      case 'system_message':
        addMsg('system', evt.data.content);
        break;
      case 'tool_call': {
        const params = typeof evt.data.arguments === 'string'
          ? (() => { try { return JSON.parse(evt.data.arguments); } catch { return evt.data.arguments; } })()
          : evt.data.arguments;
        const el = addInlineToolCall(evt.data.name, params, null);
        pendingReplayTools.set(evt.data.call_id, { el, name: evt.data.name, params });
        break;
      }
      case 'tool_result': {
        const pending = pendingReplayTools.get(evt.data.call_id);
        if (pending) {
          updateInlineToolCall(pending.el, evt.data.name, pending.params, evt.data.result);
          pendingReplayTools.delete(evt.data.call_id);
          addToolCall(evt.data.name, pending.params, evt.data.result);
        } else {
          addToolCall(evt.data.name, {}, evt.data.result);
        }
        break;
      }
      case 'error':
        addErrorMsg(evt.data.message);
        break;
    }

    addEvent(evt.type, JSON.stringify(evt.data).slice(0, 200));
  }

  renderToolCalls();
}

// ── Batch 5: Chat inline elements ────────────────────────────────

/**
 * Add a sub-agent delegation card to the chat (Block 9).
 * @param {string} task - Sub-agent task description
 * @param {Object} [opts] - Options: {iterations, tokens, output}
 * @returns {HTMLElement} The card element (for later updates)
 */
export function addSubAgentCard(task, opts = {}) {
  const messagesEl = $('messages');
  const div = document.createElement('div');
  div.className = 'msg subagent-card';
  const stats = opts.iterations != null ? `${opts.iterations} iters · ${opts.tokens || 0} tokens` : 'starting...';
  div.innerHTML = `
    <div class="subagent-head">
      <span class="sa-icon">🤖</span>
      <span class="sa-task">${esc(task)}</span>
      <span class="sa-stats">${esc(stats)}</span>
    </div>
    <div class="subagent-detail">${esc(opts.output || '(pending)')}</div>
  `;
  div.querySelector('.subagent-head').addEventListener('click', () => div.classList.toggle('expanded'));
  messagesEl.appendChild(div);
  messagesEl.scrollTop = messagesEl.scrollHeight;
  return div;
}

/** Update a sub-agent card with results. */
export function updateSubAgentCard(el, task, opts = {}) {
  if (!el) return;
  const head = el.querySelector('.subagent-head');
  if (head) {
    const stats = opts.iterations != null ? `${opts.iterations} iters · ${opts.tokens || 0} tokens` : 'done';
    head.querySelector('.sa-stats').textContent = stats;
  }
  const detail = el.querySelector('.subagent-detail');
  if (detail && opts.output) detail.textContent = opts.output;
}

/**
 * Display a safety/injection warning banner (Block 23).
 * @param {string} details - Warning details
 */
export function addSafetyBanner(details) {
  const messagesEl = $('messages');
  const div = document.createElement('div');
  div.className = 'safety-banner';
  div.textContent = `⚠ Potential injection detected — ${details}`;
  messagesEl.appendChild(div);
  messagesEl.scrollTop = messagesEl.scrollHeight;
}

/**
 * Add an undo button after an agent message (Block 25).
 * @param {Function} onUndo - Callback when undo is clicked
 * @returns {HTMLElement}
 */
export function addUndoButton(onUndo) {
  const messagesEl = $('messages');
  const btn = document.createElement('button');
  btn.className = 'undo-btn';
  btn.textContent = '↩ Undo';
  btn.addEventListener('click', () => {
    btn.remove();
    if (onUndo) onUndo();
  });
  messagesEl.appendChild(btn);
  messagesEl.scrollTop = messagesEl.scrollHeight;
  return btn;
}

/**
 * Add an intent classification badge to the last user message (Block 27).
 * @param {string} intent - One of COMMAND|QUERY|TASK|CHAT|SYSTEM
 */
export function addIntentBadge(intent) {
  const messagesEl = $('messages');
  const userMsgs = messagesEl.querySelectorAll('.msg.user');
  const lastUser = userMsgs[userMsgs.length - 1];
  if (!lastUser) return;
  const existing = lastUser.querySelector('.intent-badge');
  if (existing) existing.remove();
  const badge = document.createElement('span');
  badge.className = `intent-badge ${intent}`;
  badge.textContent = intent;
  const label = lastUser.querySelector('.label');
  if (label) label.appendChild(badge);
  else lastUser.appendChild(badge);
}

// ── Dynamic system prompt builder ────────────────────────────────
/**
 * Build dynamic system prompt from base + memories + goals + skill metadata + active skill bodies.
 * Pure function extracted for testability — no DOM or state access.
 * @param {string} basePrompt - The base system prompt text
 * @param {Array<{key:string,content:string}>} memories - Relevant memory entries (max 10 used)
 * @param {Array<{id:string,description:string,status:string}>} goals - Agent goals (only 'active' are included)
 * @param {string} skillMetadata - XML block of available skill metadata (may be empty)
 * @param {Map<string,string>} activeSkillPrompts - Map of skill name → activation prompt body
 * @returns {string} Complete system prompt with all dynamic sections appended
 */
export function buildDynamicSystemPrompt(basePrompt, memories, goals, skillMetadata, activeSkillPrompts) {
  const parts = [basePrompt];

  if (memories.length > 0) {
    const memLines = memories.slice(0, 10).map(m => `- [${m.key}] ${m.content}`).join('\n');
    parts.push(`\nRelevant memories:\n${memLines}`);
  }

  const activeGoals = goals.filter(g => g.status === 'active');
  if (activeGoals.length > 0) {
    const goalLines = activeGoals.map(g => `- (${g.id}) ${g.description}`).join('\n');
    parts.push(`\nYour current goals:\n${goalLines}\nWork toward these goals when relevant. Use the agent_goal_update tool to mark goals completed or failed.`);
  }

  if (skillMetadata) parts.push(skillMetadata);

  for (const [, prompt] of activeSkillPrompts) {
    parts.push(prompt);
  }

  return parts.join('\n');
}

// ── Send message ────────────────────────────────────────────────
/**
 * Send user input to the agent and render the response.
 *
 * Pipeline:
 * 1. Detect /skill-name prefix → activate skill via SkillRegistry
 * 2. Build dynamic system prompt (memories + goals + skills) via buildDynamicSystemPrompt
 * 3. Auto-compact context if estimated tokens exceed 12K
 * 4. Send message to agent, then run streaming or non-streaming path based on provider
 * 5. Track cost (estimateCost) and update session cost display
 * 6. Persist: memories, checkpoint, config, conversation list + OPFS event log
 * 7. Re-render goals, files, and state display
 */
export async function sendMessage() {
  if (state.isSending) return;
  let text = $('userInput').value.trim();
  if (!text || !state.agent) return;
  setSending(true);

  $('userInput').value = '';
  $('slashAutocomplete').classList.remove('visible');

  // Capture context for retry closures — conversation may change between error and click
  const originalText = text;
  const retryConvId = state.activeConversationId;

  /** Build a retry function that verifies conversation context before retrying. */
  const makeRetryFn = (classified) => {
    if (!classified.retryable) return null;
    return () => {
      if (state.activeConversationId !== retryConvId) {
        addErrorMsg('Cannot retry: conversation has changed since the error.');
        return;
      }
      $('userInput').value = originalText;
      sendMessage();
    };
  };

  // Detect /skill-name args prefix → activate skill
  const slashMatch = text.match(/^\/([a-z0-9][a-z0-9-]*)\s*(.*)/s);
  if (slashMatch) {
    const [, skillName, skillArgs] = slashMatch;
    if (state.skillRegistry.skills.has(skillName)) {
      addMsg('system', `Activating skill: ${skillName}...`);
      const activation = await state.skillRegistry.activate(skillName, skillArgs);
      if (activation) {
        emit('renderSkills');
        text = skillArgs.trim() || `[Skill "${skillName}" activated. Follow the skill instructions.]`;
      }
    }
  }

  addMsg('user', originalText);
  $('userInput').disabled = true;
  $('sendBtn').disabled = true;
  setStatus('busy', 'thinking...');

  // Batch 5: Intent classification badge
  if (state.intentRouter) {
    try {
      const intent = state.intentRouter.classify(originalText);
      addIntentBadge(intent);
    } catch (e) { /* intent classification is non-critical */ }
  }

  // Batch 6: Safety check on inbound message
  if (state.inputSanitizer) {
    try {
      const sanitized = state.inputSanitizer.sanitize(originalText);
      if (sanitized.flags?.length > 0) {
        addSafetyBanner(sanitized.flags.join(', '));
      }
      // Use sanitized content (zero-width chars stripped) for the actual message
      text = sanitized.content || text;
    } catch (e) { /* safety check is non-critical */ }
  }

  // Batch 6: Undo checkpoint before agent acts
  if (state.undoManager && state.agent) {
    try {
      const agentState = state.agent.getState();
      state.undoManager.beginTurn({
        historyLength: agentState.history_len || 0,
      });
    } catch (e) { /* undo checkpoint is non-critical */ }
  }

  try {
    // Build dynamic system prompt with goals + memory + skills context
    const basePrompt = $('systemPrompt').value;
    const memories = state.agent.memoryRecall(originalText);
    const agentState = state.agent.getState();
    const goals = agentState.goals || [];
    const skillMeta = state.skillRegistry.buildMetadataPrompt();
    state.agent.setSystemPrompt(buildDynamicSystemPrompt(basePrompt, memories, goals, skillMeta, state.activeSkillPrompts));

    // Auto-compact context if getting large
    const estTokens = state.agent.estimateHistoryTokens();
    if (estTokens > 12000) {
      setStatus('busy', 'compacting context...');
      await state.agent.compactContext({ maxTokens: 8000, keepRecent: 12 });
    }

    state.agent.sendMessage(text);

    // Backfill event ID on the user message div for fork-from-point
    const lastEvt = state.agent.getEventLog().events.at(-1);
    if (lastEvt?.type === 'user_message') {
      const userMsgs = $('messages').querySelectorAll('.msg.user');
      const lastUserDiv = userMsgs[userMsgs.length - 1];
      if (lastUserDiv) lastUserDiv.dataset.eventId = lastEvt.id;
    }

    // Check if streaming is supported for the active provider
    const providerObj = state.providers.get(state.agent.getProvider());
    const canStream = providerObj?.supportsStreaming ?? false;

    if (canStream) {
      // ── Streaming path ──
      setStatus('busy', 'streaming...');
      const streamEl = createStreamingMsg();
      let fullContent = '';

      let lastChunkWasTool = false;
      const pendingStreamTools = new Map();
      for await (const chunk of state.agent.runStream()) {
        if (chunk.type === 'text') {
          // Insert newline when text resumes after tool execution
          if (lastChunkWasTool && chunk.text && fullContent.length > 0) {
            fullContent += '\n\n';
            appendToStreamingMsg(streamEl, '\n\n');
          }
          fullContent += chunk.text;
          appendToStreamingMsg(streamEl, chunk.text);
          lastChunkWasTool = false;
        } else if (chunk.type === 'tool_start') {
          setStatus('busy', `calling ${chunk.name}...`);
          const parsedArgs = typeof chunk.args === 'string'
            ? (() => { try { return JSON.parse(chunk.args); } catch { return chunk.args; } })()
            : (chunk.args || {});
          const el = addInlineToolCall(chunk.name, parsedArgs, null);
          if (chunk.id) pendingStreamTools.set(chunk.id, { el, name: chunk.name, params: parsedArgs });
        } else if (chunk.type === 'tool_result') {
          lastChunkWasTool = true;
          addEvent('tool_result', `${chunk.name}: ${(chunk.result?.output || chunk.result?.error || '').slice(0, 80)}`);
          const pending = chunk.id && pendingStreamTools.get(chunk.id);
          if (pending) {
            updateInlineToolCall(pending.el, chunk.name, pending.params, chunk.result);
            pendingStreamTools.delete(chunk.id);
            addToolCall(chunk.name, pending.params, chunk.result);
          } else {
            addToolCall(chunk.name, {}, chunk.result);
          }
          if (chunk.name?.startsWith('browser_fs_')) emit('refreshFiles');
        } else if (chunk.type === 'done' && chunk.response) {
          const model = chunk.response.model || state.agent.getModel() || '';
          const usage = chunk.response.usage;
          if (usage) {
            const cost = estimateCost(model, usage);
            state.sessionCost += cost;
            updateCostDisplay();
            recordCostEvent(model, usage, cost * 100);
          }
        } else if (chunk.type === 'safety_redacted') {
          // Safety pipeline redacted the streamed content — replace what's already rendered
          const label = streamEl.querySelector('.label');
          const cursor = streamEl.querySelector('.streaming-cursor');
          // Remove all content nodes (text nodes and cursor), keep the label
          while (streamEl.lastChild && streamEl.lastChild !== label) {
            streamEl.removeChild(streamEl.lastChild);
          }
          streamEl.appendChild(document.createTextNode(chunk.text));
          if (cursor) streamEl.appendChild(cursor);
          fullContent = chunk.text;
        } else if (chunk.type === 'error') {
          finalizeStreamingMsg(streamEl);
          const classified = classifyError(chunk.error);
          addErrorMsg(`Error (${classified.category}): ${classified.message}`, makeRetryFn(classified));
          emit('error', classified);
        }
      }

      finalizeStreamingMsg(streamEl, fullContent);
      if (!fullContent.trim()) {
        streamEl.remove();
      } else {
        // Batch 5: Undo button after agent response
        if (state.undoManager?.canUndo) {
          addUndoButton(async () => {
            try {
              await state.undoManager.undo();
              addMsg('system', 'Last turn undone.');
            } catch (e) { addErrorMsg(`Undo failed: ${e.message}`); }
          });
        }
      }
    } else {
      // ── Non-streaming path (original) ──
      const result = await state.agent.run();

      if (result.usage) {
        const model = result.model || state.agent.getModel() || '';
        const cost = estimateCost(model, result.usage);
        state.sessionCost += cost;
        updateCostDisplay();
        recordCostEvent(model, result.usage, cost * 100);
      }

      switch (result.status) {
        case 0: addMsg('system', '(idle — no response)'); break;
        case 1:
          addMsg('agent', result.data);
          // Batch 5: Undo button after agent response
          if (state.undoManager?.canUndo) {
            addUndoButton(async () => {
              try {
                await state.undoManager.undo();
                addMsg('system', 'Last turn undone.');
              } catch (e) { addErrorMsg(`Undo failed: ${e.message}`); }
            });
          }
          break;
        case -1: {
          const classified = classifyError(result.data);
          addErrorMsg(`Error (${classified.category}): ${classified.message}`, makeRetryFn(classified));
          emit('error', classified);
          break;
        }
        default: addMsg('system', `Status ${result.status}: ${result.data}`);
      }
    }
  } catch (e) {
    const classified = classifyError(e);
    addErrorMsg(`Error (${classified.category}): ${classified.message}`, makeRetryFn(classified));
    state.agent.recordEvent('error', { message: e.message, category: classified.category }, 'system');
    emit('error', classified);
    console.error(e);
  } finally {
    // Track metrics (Batch 6)
    if (state.metricsCollector) {
      state.metricsCollector.increment('requests');
    }
    emit('updateCostMeter');

    try {
      state.agent.persistMemories();
      await state.agent.persistCheckpoint();
      emit('saveConfig');

      const wsId = state.agent.getWorkspace();
      const messagesEl = $('messages');
      const msgCount = messagesEl.querySelectorAll('.msg.user, .msg.agent').length;
      const userMsgs = messagesEl.querySelectorAll('.msg.user');
      const preview = userMsgs.length > 0 ? userMsgs[userMsgs.length - 1].textContent.replace(/^You\n?/, '').slice(0, 80) : '';

      if (!state.activeConversationId) {
        setConversation(generateConvId(), text.slice(0, 40) + (text.length > 40 ? '...' : ''));
        await updateConversationMeta(wsId, state.activeConversationId, {
          id: state.activeConversationId,
          name: state.activeConversationName,
          created: Date.now(),
          lastUsed: Date.now(),
          messageCount: msgCount,
          preview,
        });
        updateConvNameDisplay();
        updateRouteHash();
      } else {
        await updateConversationMeta(wsId, state.activeConversationId, {
          lastUsed: Date.now(),
          messageCount: msgCount,
          preview,
        });
      }

      await persistActiveConversation();

      updateState();
      emit('renderGoals');
      emit('refreshFiles');
    } catch (postErr) {
      console.error('Post-send error:', postErr);
    }

    setStatus('ready', 'ready');
    $('userInput').disabled = false;
    $('sendBtn').disabled = false;
    $('cmdPaletteBtn').disabled = false;
    setSending(false);
    $('userInput').focus();
  }
}

// ── Chat event listeners ────────────────────────────────────────
/** Bind event listeners for chat input, send button, conversation controls, and system prompt. */
export function initChatListeners() {
  $('sendBtn').addEventListener('click', sendMessage);
  $('userInput').addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.shiftKey) {
      if ($('slashAutocomplete').classList.contains('visible') && state.slashSelectedIdx >= 0) return;
      e.preventDefault();
      sendMessage();
    }
  });

  // Initialize unified conversation item bar
  initConvItemBar();

  // System prompt change
  $('systemPrompt').addEventListener('change', () => {
    if (state.agent) {
      state.agent.setSystemPrompt($('systemPrompt').value);
      addMsg('system', 'System prompt updated');
    }
  });
}
