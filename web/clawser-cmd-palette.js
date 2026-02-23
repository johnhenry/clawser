// clawser-cmd-palette.js — Command palette: tool search, parameter input, direct execution
import { $, esc, state, emit } from './clawser-state.js';
import { addInlineToolCall, updateInlineToolCall, addToolCall, addEvent, setStatus, persistActiveConversation } from './clawser-ui-chat.js';

// ── Open / Close ─────────────────────────────────────────────────
export function openCommandPalette() {
  const palette = $('cmdPalette');
  palette.style.display = 'flex';
  state.cmdSelectedSpec = null;
  $('cmdSearch').value = '';
  $('cmdParamArea').style.display = 'none';
  $('cmdParamArea').innerHTML = '';
  $('cmdRun').disabled = true;
  renderCmdToolList('');
  $('cmdSearch').focus();
}

export function closeCommandPalette() {
  $('cmdPalette').style.display = 'none';
  state.cmdSelectedSpec = null;
}

// ── Tool list ────────────────────────────────────────────────────
export function renderCmdToolList(filter) {
  const el = $('cmdToolList');
  el.innerHTML = '';

  const allSpecs = [
    ...state.browserTools.allSpecs().map(s => ({ ...s, source: 'browser' })),
    ...state.mcpManager.allToolSpecs().map(s => ({ ...s, source: 'mcp' })),
  ];

  const lower = filter.toLowerCase();
  const filtered = lower
    ? allSpecs.filter(s => s.name.toLowerCase().includes(lower) || (s.description || '').toLowerCase().includes(lower))
    : allSpecs;

  for (const spec of filtered) {
    const d = document.createElement('div');
    d.className = 'cmd-tool-item';
    const perm = spec.required_permission ? `<span class="cmd-tool-perm">${esc(spec.required_permission)}</span>` : '';
    d.innerHTML = `<div><span class="cmd-tool-name">${esc(spec.name)}</span>${perm}</div><div class="cmd-tool-desc">${esc((spec.description || '').slice(0, 100))}</div>`;
    d.addEventListener('click', () => selectCmdTool(spec));
    el.appendChild(d);
  }

  if (filtered.length === 0) {
    el.innerHTML = '<div style="padding:12px;text-align:center;color:var(--dim);font-size:11px;">No matching tools.</div>';
  }
}

// ── Select tool ──────────────────────────────────────────────────
export function selectCmdTool(spec) {
  state.cmdSelectedSpec = spec;

  document.querySelectorAll('.cmd-tool-item').forEach(el => el.classList.remove('selected'));
  document.querySelectorAll('.cmd-tool-item').forEach(el => {
    if (el.querySelector('.cmd-tool-name')?.textContent === spec.name) {
      el.classList.add('selected');
    }
  });

  const area = $('cmdParamArea');
  area.innerHTML = '';

  const props = spec.parameters?.properties || {};
  const required = spec.parameters?.required || [];
  const keys = Object.keys(props);

  if (keys.length === 0) {
    area.innerHTML = '<div style="font-size:11px;color:var(--muted);">No parameters needed.</div>';
  } else {
    for (const key of keys) {
      const prop = props[key];
      const isRequired = required.includes(key);
      const group = document.createElement('div');
      group.className = 'cmd-param-group';

      const label = document.createElement('label');
      label.innerHTML = `${esc(key)}${isRequired ? ' <span class="required">*</span>' : ''} <span style="color:var(--dim);font-size:10px;">${esc(prop.type || '')}</span>`;
      group.appendChild(label);

      let input;
      if (prop.enum) {
        input = document.createElement('select');
        input.innerHTML = `<option value="">--</option>` + prop.enum.map(v => `<option value="${esc(String(v))}">${esc(String(v))}</option>`).join('');
      } else if (prop.type === 'boolean') {
        input = document.createElement('select');
        input.innerHTML = '<option value="">--</option><option value="true">true</option><option value="false">false</option>';
      } else if (prop.type === 'object') {
        input = document.createElement('textarea');
        input.placeholder = 'JSON object...';
      } else {
        input = document.createElement('input');
        input.type = 'text';
        input.placeholder = prop.description || '';
      }
      input.dataset.paramName = key;
      input.dataset.paramType = prop.type || 'string';
      group.appendChild(input);
      area.appendChild(group);
    }
  }

  area.style.display = 'block';
  $('cmdRun').disabled = false;
}

// ── Run tool ─────────────────────────────────────────────────────
export async function runCmdTool() {
  if (!state.cmdSelectedSpec || !state.agent) return;

  const spec = state.cmdSelectedSpec;
  const required = spec.parameters?.required || [];
  const params = {};

  const inputs = $('cmdParamArea').querySelectorAll('[data-param-name]');
  for (const input of inputs) {
    const name = input.dataset.paramName;
    const type = input.dataset.paramType;
    let value = (input.value || '').trim();

    if (!value) {
      if (required.includes(name)) {
        input.style.borderColor = 'var(--red)';
        return;
      }
      continue;
    }

    if (type === 'number') params[name] = Number(value);
    else if (type === 'boolean') params[name] = value === 'true';
    else if (type === 'object') {
      try { params[name] = JSON.parse(value); } catch { input.style.borderColor = 'var(--red)'; return; }
    }
    else params[name] = value;
  }

  closeCommandPalette();

  const callId = `user_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;

  state.agent.recordEvent('tool_call', { call_id: callId, name: spec.name, arguments: params }, 'user');

  const el = addInlineToolCall(spec.name, params, null);
  addEvent('tool_call', `${spec.name} (user)`);

  setStatus('busy', `running ${spec.name}...`);

  try {
    const result = await state.agent.executeToolDirect(spec.name, params);

    state.agent.recordEvent('tool_result', { call_id: callId, name: spec.name, result }, 'system');

    updateInlineToolCall(el, spec.name, params, result);
    addToolCall(spec.name, params, result);
    addEvent('tool_result', `${spec.name}: ${(result.output || result.error || '').slice(0, 80)}`);
  } catch (e) {
    const result = { success: false, output: '', error: e.message };
    state.agent.recordEvent('tool_result', { call_id: callId, name: spec.name, result }, 'system');
    updateInlineToolCall(el, spec.name, params, result);
    addToolCall(spec.name, params, result);
    addEvent('tool_result', `${spec.name}: Error: ${e.message}`);
  }

  await persistActiveConversation();

  emit('refreshFiles');
  setStatus('ready', 'ready');
}

// ── Listeners ────────────────────────────────────────────────────
export function initCmdPaletteListeners() {
  $('cmdPaletteBtn').addEventListener('click', openCommandPalette);
  $('cmdSearch').addEventListener('input', () => renderCmdToolList($('cmdSearch').value));
  $('cmdCancel').addEventListener('click', closeCommandPalette);
  $('cmdRun').addEventListener('click', runCmdTool);
  $('cmdPalette').addEventListener('click', (e) => { if (e.target === $('cmdPalette')) closeCommandPalette(); });

  // Cmd+K / Ctrl+K
  document.addEventListener('keydown', (e) => {
    if (state.currentRoute !== 'workspace') return;
    if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
      e.preventDefault();
      if ($('cmdPalette').style.display === 'none' || !$('cmdPalette').style.display) {
        openCommandPalette();
      } else {
        closeCommandPalette();
      }
    }
    if (e.key === 'Escape' && $('cmdPalette').style.display !== 'none' && $('cmdPalette').style.display) {
      closeCommandPalette();
    }
  });
}
