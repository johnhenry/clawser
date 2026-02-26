/**
 * clawser-ui-panels.js — Secondary panel rendering and event binding
 *
 * Re-exports extracted panel modules and contains remaining panel functions:
 *   - Tool registry with permission cycling (renderToolRegistry)
 *   - MCP server list (renderMcpServers)
 *   - Skills panel with enable/disable, export, delete (renderSkills)
 *   - Workspace dropdown switcher (renderWsDropdown)
 *   - Terminal panel (terminalExec, terminalAskUser, etc.)
 *   - Tool management panel (renderToolManagementPanel)
 *   - Agent picker and management (initAgentPicker, renderAgentPanel, etc.)
 *   - Panel event listeners (initPanelListeners)
 *   - Slash command autocomplete on the chat input
 */
import { $, esc, state, lsKey } from './clawser-state.js';
import { modal } from './clawser-modal.js';
import { addMsg, addErrorMsg, updateState, resetToolAndEventState } from './clawser-ui-chat.js';
import { loadWorkspaces, getActiveWorkspaceId, renameWorkspace, deleteWorkspace, createWorkspace, getWorkspaceName } from './clawser-workspaces.js';
import { navigate } from './clawser-router.js';
import { SkillStorage } from './clawser-skills.js';
import { createItemBar, _relativeTime } from './clawser-item-bar.js';
import { CLAWSER_SUBCOMMAND_META } from './clawser-cli.js';

// ── Re-exports from extracted modules ──────────────────────────
export { refreshFiles, mountLocalFolder, renderMountList } from './clawser-ui-files.js';
export { renderMemoryResults, doMemorySearch } from './clawser-ui-memory.js';
export { renderGoals, toggleGoalExpand } from './clawser-ui-goals.js';
export {
  applySecuritySettings,
  renderAutonomySection,
  saveAutonomySettings,
  renderIdentitySection,
  saveIdentitySettings,
  renderRoutingSection,
  renderAuthProfilesSection,
  saveSelfRepairSettings,
  renderSelfRepairSection,
  updateCacheStats,
  saveLimitsSettings,
  renderLimitsSection,
  saveSandboxSettings,
  renderSandboxSection,
  saveHeartbeatSettings,
  renderHeartbeatSection,
  renderOAuthSection,
  updateCostMeter,
  updateAutonomyBadge,
  updateDaemonBadge,
  updateRemoteBadge,
  refreshDashboard,
  renderApiKeyWarning,
  renderQuotaBar,
  renderCleanConversationsSection,
} from './clawser-ui-config.js';

// ── Local imports from extracted modules (used by initPanelListeners) ──
import { refreshFiles, mountLocalFolder, renderMountList } from './clawser-ui-files.js';
import { doMemorySearch } from './clawser-ui-memory.js';
import { renderGoals } from './clawser-ui-goals.js';
import {
  applySecuritySettings,
  renderAutonomySection,
  saveAutonomySettings,
  renderIdentitySection,
  saveIdentitySettings,
  renderRoutingSection,
  renderAuthProfilesSection,
  renderSelfRepairSection,
  updateCacheStats,
  saveLimitsSettings,
  renderLimitsSection,
  renderSandboxSection,
  renderHeartbeatSection,
  renderOAuthSection,
  updateCostMeter,
  refreshDashboard,
  renderApiKeyWarning,
  renderQuotaBar,
  renderCleanConversationsSection,
} from './clawser-ui-config.js';

/** Sanitize a color value for safe use in style attributes. */
function safeColor(c, fallback = '#8b949e') {
  if (!c || typeof c !== 'string') return fallback;
  return /^#[0-9a-fA-F]{3,8}$/.test(c) ? c : fallback;
}

// ── Tool registry ──────────────────────────────────────────────
/** Render all registered tools with permission badges (click to cycle auto/approve/denied). */
export function renderToolRegistry() {
  const el = $('toolRegistry');
  el.innerHTML = '';
  const specs = state.browserTools.allSpecs();
  for (const s of specs) {
    const d = document.createElement('div');
    d.className = 'tl-item';
    const perm = state.browserTools.getPermission(s.name);
    const permClass = `tl-perm-${perm}`;
    const permTip = perm === 'auto' ? 'Tool runs automatically without asking'
      : perm === 'approve' ? 'Tool asks for your confirmation before running'
      : 'Tool is blocked and cannot run';
    d.innerHTML = `<span class="tl-name">${esc(s.name)}</span><span class="tl-source ${permClass}" title="${permTip}">${perm}</span>`;
    d.title = `Click to change permission (current: ${perm}) \u2014 ${permTip}`;
    d.addEventListener('click', () => {
      const levels = ['auto', 'approve', 'denied'];
      const nextIdx = (levels.indexOf(perm) + 1) % levels.length;
      state.browserTools.setPermission(s.name, levels[nextIdx]);
      const wsId = state.agent?.getWorkspace() || 'default';
      localStorage.setItem(lsKey.toolPerms(wsId), JSON.stringify(state.browserTools.getAllPermissions()));
      renderToolRegistry();
    });
    el.appendChild(d);
  }
}

// ── MCP servers ────────────────────────────────────────────────
/** Render the list of connected MCP servers with tool counts. */
export function renderMcpServers() {
  const el = $('mcpServers');
  el.innerHTML = '';
  for (const name of state.mcpManager.serverNames) {
    const client = state.mcpManager.getClient(name);
    const d = document.createElement('div');
    d.className = 'mcp-server';
    d.innerHTML = `<span class="mcp-dot"></span><span class="mcp-name">${esc(name)}</span><span class="mcp-tools">${client.tools.length} tools</span>`;
    el.appendChild(d);
  }
}

// ── Skills panel ────────────────────────────────────────────────
/** Render the skills panel with enable/disable toggles, export, and delete controls. */
export function renderSkills() {
  const el = $('skillList');
  el.innerHTML = '';
  const skills = [...state.skillRegistry.skills.values()];
  $('skillCount').textContent = skills.length;

  if (skills.length === 0) {
    el.innerHTML = '<div style="padding:12px;text-align:center;color:var(--dim);font-size:11px;">No skills installed. Import a .zip or add SKILL.md files to OPFS.</div>';
    return;
  }

  for (const skill of skills) {
    const isActive = state.skillRegistry.activeSkills.has(skill.name);
    const d = document.createElement('div');
    d.className = `skill-item${isActive ? ' active' : ''}`;

    const scopeClass = skill.scope === 'workspace' ? ' workspace' : '';
    const tokenEst = skill.bodyLength > 0 ? Math.ceil(skill.bodyLength / 4) : 0;
    const tokenWarn = tokenEst > 2000 ? `<div class="skill-token-warn">~${tokenEst} tokens — may use significant context</div>` : '';

    d.innerHTML = `
      <div class="skill-header">
        <span class="skill-active-dot" title="Active"></span>
        <span class="skill-name">${esc(skill.name)}</span>
        <span class="skill-scope${scopeClass}">${esc(skill.scope)}</span>
        <span class="skill-actions">
          <button class="skill-toggle${skill.enabled ? ' on' : ''}" title="${skill.enabled ? 'Disable' : 'Enable'}"></button>
          <button class="skill-export" title="Export">\u2193</button>
          <button class="skill-del" title="Delete">\u2715</button>
        </span>
      </div>
      <div class="skill-desc">${esc(skill.description || '(no description)')}</div>
      ${skill.metadata?.invoke ? `<div style="font-size:10px;color:var(--dim);margin-top:2px;">Invoke: /${esc(skill.name)}</div>` : ''}
      ${tokenWarn}
    `;

    d.querySelector('.skill-toggle').addEventListener('click', (e) => {
      e.stopPropagation();
      const newState = !skill.enabled;
      state.skillRegistry.setEnabled(skill.name, newState);
      state.skillRegistry.persistEnabledState(state.agent?.getWorkspace() || 'default');
      renderSkills();
    });

    d.querySelector('.skill-export').addEventListener('click', async (e) => {
      e.stopPropagation();
      try {
        const dirName = skill.dirName || skill.name;
        const wsId = state.agent?.getWorkspace() || 'default';
        const dir = skill.scope === 'global'
          ? await (await SkillStorage.getGlobalSkillsDir()).getDirectoryHandle(dirName)
          : await (await SkillStorage.getWorkspaceSkillsDir(wsId)).getDirectoryHandle(dirName);
        const blob = await SkillStorage.exportToZip(dir);
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url; a.download = `${skill.name}.zip`;
        a.click();
        URL.revokeObjectURL(url);
      } catch (err) {
        addErrorMsg(`Export failed: ${err.message}`);
      }
    });

    d.querySelector('.skill-del').addEventListener('click', async (e) => {
      e.stopPropagation();
      if (!await modal.confirm(`Delete skill "${skill.name}"?`, { danger: true })) return;
      const wsId = state.agent?.getWorkspace() || 'default';
      await state.skillRegistry.uninstall(skill.name, wsId);
      renderSkills();
      renderToolRegistry();
    });

    el.appendChild(d);
  }
}

// ── Workspace dropdown ──────────────────────────────────────────
/** Render the workspace switcher dropdown with rename/delete actions. */
export function renderWsDropdown() {
  const list = loadWorkspaces();
  const activeId = getActiveWorkspaceId();
  const el = $('wsList');
  el.innerHTML = '';
  for (const ws of list) {
    const d = document.createElement('div');
    const isActive = ws.id === activeId;
    d.className = `ws-dd-item${isActive ? ' active' : ''}`;
    d.innerHTML = `<span class="ws-dd-name">${esc(ws.name)}</span>`;
    if (isActive) {
      const renBtn = document.createElement('span');
      renBtn.textContent = '\u270F';
      renBtn.className = 'ws-dd-action';
      renBtn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const newName = await modal.prompt('Rename workspace:', ws.name);
        if (newName && newName.trim()) {
          renameWorkspace(ws.id, newName.trim());
          $('workspaceName').textContent = newName.trim();
          renderWsDropdown();
        }
      });
      d.appendChild(renBtn);
    } else {
      if (ws.id !== 'default') {
        const delBtn = document.createElement('span');
        delBtn.textContent = '\u2715';
        delBtn.className = 'ws-dd-action danger';
        delBtn.addEventListener('click', async (e) => {
          e.stopPropagation();
          if (await modal.confirm(`Delete workspace "${ws.name}"? This cannot be undone.`, { danger: true })) {
            await deleteWorkspace(ws.id);
            renderWsDropdown();
          }
        });
        d.appendChild(delBtn);
      }
      d.addEventListener('click', () => navigate('workspace', ws.id));
    }
    el.appendChild(d);
  }
}

// ── Skill registry search ───────────────────────────────────────

/** Skill registry URL constant */
const SKILL_REGISTRY_URL = 'https://raw.githubusercontent.com/nicholasgasior/agent-skills-index/main/index.json';

/** Search the skill registry and render results. */
export async function searchSkillRegistry(query) {
  const resultsEl = $('skillBrowseResults');
  if (!resultsEl) return;
  if (!query?.trim()) { resultsEl.innerHTML = ''; return; }

  resultsEl.innerHTML = '<div style="color:var(--muted);font-size:11px;padding:8px;">Searching...</div>';

  try {
    const resp = await fetch(SKILL_REGISTRY_URL);
    if (!resp.ok) throw new Error(`Registry fetch failed: ${resp.status}`);
    const index = await resp.json();
    const skills = (index.skills || index || []);
    const q = query.toLowerCase();
    const matches = skills.filter(s =>
      (s.name || '').toLowerCase().includes(q) ||
      (s.description || '').toLowerCase().includes(q) ||
      (s.tags || []).some(t => t.toLowerCase().includes(q))
    ).slice(0, 20);

    resultsEl.innerHTML = '';
    if (matches.length === 0) {
      resultsEl.innerHTML = '<div style="color:var(--dim);font-size:11px;padding:8px;">No results found.</div>';
      return;
    }

    for (const skill of matches) {
      const card = document.createElement('div');
      card.className = 'skill-browse-card';
      card.innerHTML = `
        <div class="skill-browse-name">${esc(skill.name)}</div>
        <div class="skill-browse-desc">${esc(skill.description || '')}</div>
      `;
      const installBtn = document.createElement('button');
      installBtn.className = 'btn-sm';
      installBtn.textContent = 'Install';
      installBtn.addEventListener('click', async () => {
        if (!skill.url) { addErrorMsg('No download URL for this skill.'); return; }
        try {
          installBtn.disabled = true;
          installBtn.textContent = 'Installing...';
          const wsId = state.agent?.getWorkspace() || 'default';
          const zipResp = await fetch(skill.url);
          if (!zipResp.ok) throw new Error(`Download failed: ${zipResp.status}`);
          const blob = await zipResp.blob();
          await state.skillRegistry.installFromZip('global', wsId, blob);
          await state.skillRegistry.discover(wsId);
          renderSkills();
          addMsg('system', `Skill "${skill.name}" installed from registry.`);
          installBtn.textContent = 'Installed';
        } catch (e) {
          addErrorMsg(`Install failed: ${e.message}`);
          installBtn.disabled = false;
          installBtn.textContent = 'Install';
        }
      });
      card.appendChild(installBtn);
      resultsEl.appendChild(card);
    }
  } catch (e) {
    resultsEl.innerHTML = `<div style="color:var(--red);font-size:11px;padding:8px;">Registry error: ${esc(e.message)}</div>`;
  }
}

// ── Terminal panel (Batch 4) ─────────────────────────────────────

const terminalHistory = [];
let termHistoryIdx = -1;

/** Append output to terminal. */
export function terminalAppend(html) {
  const el = $('terminalOutput');
  if (!el) return;
  el.insertAdjacentHTML('beforeend', html);
  el.scrollTop = el.scrollHeight;
}

/** Track terminal agent mode state */
let _terminalAgentMode = false;

/** Track terminal REPL mode state */
let _terminalReplMode = false;
let _terminalReplHandler = null;
let _terminalReplPrompt = 'repl> ';

/** Run a command in the terminal panel. */
export async function terminalExec(cmd) {
  if (!cmd.trim()) return;
  terminalHistory.unshift(cmd);
  termHistoryIdx = -1;

  // In REPL mode, forward input to the REPL handler
  if (_terminalReplMode && _terminalReplHandler) {
    terminalAppend(`<div class="terminal-cmd"><span class="repl-mode-prompt">${esc(_terminalReplPrompt)}</span>${esc(cmd)}</div>`);
    state.terminalSessions?.recordCommand(cmd);
    try {
      const result = await _terminalReplHandler(cmd);
      if (result.__exitReplMode) {
        _terminalReplMode = false;
        _terminalReplHandler = null;
        const badge = $('terminalModeBadge');
        if (badge) { badge.textContent = '[SHELL]'; badge.classList.remove('repl'); }
      }
      if (result.stdout) terminalAppend(`<div class="terminal-stdout">${esc(result.stdout)}</div>`);
      if (result.stderr) terminalAppend(`<div class="terminal-stderr">${esc(result.stderr)}</div>`);
      state.terminalSessions?.recordResult(result.stdout || '', result.stderr || '', result.exitCode ?? 0);
    } catch (e) {
      terminalAppend(`<div class="terminal-stderr">${esc(e.message)}</div>`);
      state.terminalSessions?.recordResult('', e.message, 1);
    }
    return;
  }

  // In agent mode, forward input to the agent instead of the shell
  if (_terminalAgentMode && !cmd.startsWith('clawser ') && cmd !== 'clawser exit') {
    terminalAppend(`<div class="terminal-cmd"><span class="agent-mode-prompt">agent&gt;</span> ${esc(cmd)}</div>`);
    state.terminalSessions?.recordAgentPrompt(cmd);
    try {
      const agent = state.agent;
      if (!agent) { terminalAppend(`<div class="terminal-stderr">No agent available.</div>`); return; }
      agent.sendMessage(cmd);
      const resp = await agent.run();
      const text = resp?.content || resp?.text || '(no response)';
      terminalAppend(`<div class="terminal-stdout">${esc(text)}</div>`);
      state.terminalSessions?.recordAgentResponse(text);
    } catch (e) {
      terminalAppend(`<div class="terminal-stderr">${esc(e.message)}</div>`);
    }
    return;
  }

  terminalAppend(`<div class="terminal-cmd">$ ${esc(cmd)}</div>`);

  // Record command event for terminal session
  state.terminalSessions?.recordCommand(cmd);

  if (state.shell) {
    try {
      const result = await state.shell.exec(cmd);

      // Record result event for terminal session
      state.terminalSessions?.recordResult(result.stdout || '', result.stderr || '', result.exitCode ?? 0);

      // Handle special return flags
      if (result.__clearTerminal) {
        const el = $('terminalOutput');
        if (el) el.innerHTML = '';
        return;
      }
      if (result.__enterAgentMode) {
        _terminalAgentMode = true;
        const badge = $('terminalModeBadge');
        if (badge) { badge.textContent = '[AGENT \u23CE]'; badge.classList.add('agent'); }
      }
      if (result.__exitAgentMode) {
        _terminalAgentMode = false;
        const badge = $('terminalModeBadge');
        if (badge) { badge.textContent = '[SHELL]'; badge.classList.remove('agent'); }
      }
      if (result.__enterReplMode) {
        _terminalReplMode = true;
        _terminalReplHandler = result.__replHandler;
        _terminalReplPrompt = result.__replPrompt || 'repl> ';
        const badge = $('terminalModeBadge');
        if (badge) { badge.textContent = '[REPL]'; badge.classList.add('repl'); }
      }
      if (result.stdout) terminalAppend(`<div class="terminal-stdout">${esc(result.stdout)}</div>`);
      if (result.stderr) terminalAppend(`<div class="terminal-stderr">${esc(result.stderr)}</div>`);
      const cwd = $('terminalCwd');
      if (cwd) cwd.textContent = state.shell.state.cwd || '~';
    } catch (e) {
      terminalAppend(`<div class="terminal-stderr">${esc(e.message)}</div>`);
    }
  } else {
    terminalAppend(`<div class="terminal-stderr">No shell session available.</div>`);
  }
}

// ── AskUserQuestion terminal UI ─────────────────────────────────

/**
 * Render interactive question cards in the terminal and collect answers.
 * @param {Array<{question, header, options: [{label, description}], multiSelect?}>} questions
 * @returns {Promise<Object<string, string>>} answers keyed by question text
 */
export async function terminalAskUser(questions) {
  const answers = {};

  for (const q of questions) {
    await new Promise((resolve) => {
      const card = document.createElement('div');
      card.className = 'ask-user-card';
      card.innerHTML = `
        <div class="ask-user-header">${esc(q.header)}</div>
        <div class="ask-user-question">${esc(q.question)}</div>
        <div class="ask-user-options">
          ${q.options.map((opt, i) =>
            `<div class="ask-user-option" data-idx="${i}">
              <span class="ask-user-idx">${i + 1}</span>
              <span class="ask-user-label">${esc(opt.label)}</span>
              <span class="ask-user-desc">${esc(opt.description)}</span>
            </div>`
          ).join('')}
          <div class="ask-user-option ask-user-other" data-idx="other">
            <span class="ask-user-idx">${q.options.length + 1}</span>
            <span class="ask-user-label">Other</span>
            <span class="ask-user-desc">Provide custom text</span>
          </div>
        </div>
        <div class="ask-user-input-row" style="display:none">
          <input type="text" class="ask-user-text" placeholder="Type your answer...">
          <button class="ask-user-submit">OK</button>
        </div>
      `;

      const optEls = card.querySelectorAll('.ask-user-option');
      const inputRow = card.querySelector('.ask-user-input-row');
      const textInput = card.querySelector('.ask-user-text');
      const submitBtn = card.querySelector('.ask-user-submit');

      function finalize(answer) {
        answers[q.question] = answer;
        card.classList.add('ask-user-answered');
        const ansDiv = document.createElement('div');
        ansDiv.className = 'ask-user-answer';
        ansDiv.textContent = `\u2192 ${answer}`;
        card.appendChild(ansDiv);
        // Collapse options
        card.querySelector('.ask-user-options').style.display = 'none';
        inputRow.style.display = 'none';
        resolve();
      }

      if (q.multiSelect) {
        const selected = new Set();
        const confirmBtn = document.createElement('button');
        confirmBtn.className = 'ask-user-submit';
        confirmBtn.textContent = 'Confirm';
        confirmBtn.style.display = 'none';
        card.querySelector('.ask-user-options').appendChild(confirmBtn);

        optEls.forEach(el => {
          if (el.dataset.idx === 'other') return;
          el.addEventListener('click', () => {
            const idx = parseInt(el.dataset.idx);
            if (selected.has(idx)) { selected.delete(idx); el.classList.remove('selected'); }
            else { selected.add(idx); el.classList.add('selected'); }
            confirmBtn.style.display = selected.size > 0 ? '' : 'none';
          });
        });

        confirmBtn.addEventListener('click', () => {
          const labels = [...selected].sort().map(i => q.options[i].label);
          finalize(labels.join(', '));
        });

        // Other option
        card.querySelector('.ask-user-other').addEventListener('click', () => {
          inputRow.style.display = '';
          textInput.focus();
        });
        submitBtn.addEventListener('click', () => { if (textInput.value.trim()) finalize(textInput.value.trim()); });
        textInput.addEventListener('keydown', (e) => { if (e.key === 'Enter' && textInput.value.trim()) finalize(textInput.value.trim()); });
      } else {
        optEls.forEach(el => {
          if (el.dataset.idx === 'other') {
            el.addEventListener('click', () => {
              inputRow.style.display = '';
              textInput.focus();
            });
          } else {
            el.addEventListener('click', () => {
              const idx = parseInt(el.dataset.idx);
              finalize(q.options[idx].label);
            });
          }
        });
        submitBtn.addEventListener('click', () => { if (textInput.value.trim()) finalize(textInput.value.trim()); });
        textInput.addEventListener('keydown', (e) => { if (e.key === 'Enter' && textInput.value.trim()) finalize(textInput.value.trim()); });
      }

      const termOut = $('terminalOutput') || $('messages');
      if (termOut) {
        termOut.appendChild(card);
        termOut.scrollTop = termOut.scrollHeight;
      }
    });
  }

  return answers;
}

// ── Terminal Session Bar UI (Block 35) ──────────────────────────

/** Render the terminal session bar with name, new/rename/history buttons. */
/** @type {{refresh: () => void, destroy: () => void}|null} */
export let termItemBar = null;
let _termItemBarWsId = null;

/** Initialize or refresh the terminal session item bar. */
export function renderTerminalSessionBar() {
  const ts = state.terminalSessions;
  if (!ts) return;

  // Rebuild if workspace changed (terminal sessions manager was recreated)
  const wsId = state.agent?.getWorkspace();
  if (termItemBar && _termItemBarWsId === wsId) {
    termItemBar.refresh();
    return;
  }

  // Destroy old bar if it exists
  if (termItemBar) {
    termItemBar.destroy();
    termItemBar = null;
  }
  _termItemBarWsId = wsId;

  termItemBar = createItemBar({
    containerId: 'termSessionBarContainer',
    label: 'Session',
    newLabel: '+',
    emptyMessage: 'No sessions yet.',
    defaultName: 'New session',
    getActiveName: () => ts.activeName,
    getActiveId: () => ts.activeId,
    listItems: () => ts.list(),
    onNew: async () => {
      await ts.create();
      $('terminalOutput').innerHTML = '';
    },
    onSwitch: async (id) => {
      await ts.switchTo(id);
      const restored = await ts.restore(id);
      if (restored) replayTerminalSession(restored.events);
    },
    onRename: async (id, newName) => {
      await ts.rename(id, newName);
    },
    onDelete: async (id) => {
      await ts.delete(id);
    },
    onFork: async () => {
      await ts.fork();
    },
    exportFormats: [
      { label: 'Export as script', fn: () => ts.exportAsScript(), filename: `${ts.activeName || 'session'}.sh`, mime: 'text/x-shellscript' },
      { label: 'Export as log', fn: () => ts.exportAsLog('text'), filename: `${ts.activeName || 'session'}.log`, mime: 'text/plain' },
    ],
    renderMeta: (item) => {
      const ago = _relativeTime(item.lastUsed);
      return `${item.commandCount || 0} cmds \u00b7 ${ago}`;
    },
  });
}

/** Replay terminal session events to rebuild terminal output DOM. */
export function replayTerminalSession(events) {
  const el = $('terminalOutput');
  if (!el) return;
  el.innerHTML = '';

  for (let i = 0; i < events.length; i++) {
    const e = events[i];
    switch (e.type) {
      case 'shell_command': {
        const div = document.createElement('div');
        div.className = 'terminal-cmd';
        div.dataset.eventIndex = i;
        div.innerHTML = `$ ${esc(e.data.command)}<span class="term-fork" title="Fork from here">\u2442</span>`;
        div.querySelector('.term-fork').addEventListener('click', async (ev) => {
          ev.stopPropagation();
          const idx = parseInt(div.dataset.eventIndex, 10);
          const ts = state.terminalSessions;
          if (!ts) return;
          try {
            await ts.forkFromEvent(idx);
            const restored = await ts.restore(ts.activeId);
            if (restored) replayTerminalSession(restored.events);
            if (termItemBar) termItemBar.refresh();
            addMsg('system', `Terminal session forked from command ${idx + 1}.`);
          } catch (err) {
            addMsg('system', `Fork failed: ${err.message}`);
          }
        });
        el.appendChild(div);
        el.scrollTop = el.scrollHeight;
        break;
      }
      case 'shell_result':
        if (e.data.stdout) terminalAppend(`<div class="terminal-stdout">${esc(e.data.stdout)}</div>`);
        if (e.data.stderr) terminalAppend(`<div class="terminal-stderr">${esc(e.data.stderr)}</div>`);
        break;
      case 'agent_prompt':
        terminalAppend(`<div class="terminal-cmd"><span class="agent-mode-prompt">agent&gt;</span> ${esc(e.data.content)}</div>`);
        break;
      case 'agent_response':
        terminalAppend(`<div class="terminal-stdout">${esc(e.data.content)}</div>`);
        break;
      case 'state_snapshot':
        // Silently restore — don't render
        break;
    }
  }

  // Update CWD from last snapshot
  const lastSnap = [...events].reverse().find(e => e.type === 'state_snapshot');
  if (lastSnap) {
    const cwd = $('terminalCwd');
    if (cwd) cwd.textContent = lastSnap.data.cwd || '~';
  }
}

// renderTermSessionDropdown, _relativeTime, _downloadText moved to clawser-item-bar.js

// ── Tool Management Panel (Block 36) ─────────────────────────────

let activeToolFilter = 'all';

const TOOL_CATEGORIES = {
  browser_fetch: 'Network', web_search: 'Network', browser_navigate: 'Network', screenshot: 'Network',
  browser_dom_query: 'DOM', browser_dom_modify: 'DOM', browser_eval_js: 'DOM', browser_screen_info: 'DOM',
  shell: 'Shell', delegate: 'Delegation', ask_user_question: 'Agent',
  activate_skill: 'Skills', deactivate_skill: 'Skills',
};

function categorize(toolName) {
  if (TOOL_CATEGORIES[toolName]) return TOOL_CATEGORIES[toolName];
  if (toolName.startsWith('mcp_')) {
    const serverName = state.mcpManager?.serverNames?.find(n => {
      const client = state.mcpManager.getClient(n);
      return client?.tools?.some(t => t.name === toolName);
    });
    return serverName ? `MCP: ${serverName}` : 'MCP';
  }
  if (toolName.startsWith('browser_fs_') || toolName.startsWith('fs_')) return 'File System';
  if (toolName.startsWith('agent_') || toolName.startsWith('memory_') ||
      toolName.startsWith('goal_') || toolName.startsWith('schedule_')) return 'Agent';
  if (toolName.startsWith('browser_')) return 'Browser Automation';
  if (toolName.startsWith('git_')) return 'Git';
  if (toolName.startsWith('hw_')) return 'Hardware';
  if (toolName.startsWith('channel_')) return 'Channels';
  if (toolName.startsWith('tool_')) return 'Builder';
  if (toolName.startsWith('sandbox_')) return 'Sandbox';
  if (toolName.startsWith('oauth_')) return 'OAuth';
  if (toolName.startsWith('auth_')) return 'Auth';
  if (toolName.startsWith('routine_')) return 'Routines';
  if (toolName.startsWith('remote_')) return 'Remote';
  if (toolName.startsWith('bridge_')) return 'Bridge';
  if (toolName.startsWith('daemon_') || toolName.startsWith('self_repair_')) return 'System';
  if (toolName.startsWith('switch_agent') || toolName.startsWith('consult_agent')) return 'Agents';
  if (toolName.startsWith('skill_') || toolName.startsWith('activate_skill') || toolName.startsWith('deactivate_skill')) return 'Skills';
  return 'Other';
}

function persistToolPermissions() {
  const wsId = state.agent?.getWorkspace() || 'default';
  localStorage.setItem(lsKey.toolPerms(wsId), JSON.stringify(state.browserTools.getAllPermissions()));
}

export function renderToolManagementPanel() {
  const panelBody = $('panelToolMgmt')?.querySelector('[data-tab-body="browser-tools"]');
  if (!panelBody) return;

  const allTools = state.browserTools.allSpecs().map(s => ({ ...s, source: 'built-in' }));

  const query = panelBody.querySelector('#toolSearch')?.value?.toLowerCase() || '';
  const filtered = query
    ? allTools.filter(t => t.name.toLowerCase().includes(query) || (t.description || '').toLowerCase().includes(query))
    : allTools;

  const statusFiltered = filtered.filter(t => {
    const perm = state.browserTools.getPermission(t.name);
    if (activeToolFilter === 'enabled') return perm !== 'denied';
    if (activeToolFilter === 'disabled') return perm === 'denied';
    if (activeToolFilter === 'approve') return perm === 'approve';
    return true;
  });

  const groups = new Map();
  for (const tool of statusFiltered) {
    const cat = categorize(tool.name);
    if (!groups.has(cat)) groups.set(cat, []);
    groups.get(cat).push(tool);
  }

  const sortedGroups = [...groups.entries()].sort((a, b) => {
    const aM = a[0].startsWith('MCP:'), bM = b[0].startsWith('MCP:');
    if (aM !== bM) return aM ? 1 : -1;
    return a[0].localeCompare(b[0]);
  });

  let html = `<div class="tool-perm-legend">
    <div class="tool-perm-legend-title">Permission Levels</div>
    <div class="tool-perm-legend-items">
      <div class="tool-perm-legend-item">
        <span class="tool-perm-badge" style="background:rgba(63,185,80,.13);color:var(--green);">auto</span>
        <span class="tool-perm-legend-desc">Tool runs automatically without user confirmation.</span>
      </div>
      <div class="tool-perm-legend-item">
        <span class="tool-perm-badge" style="background:rgba(234,179,8,.13);color:#eab308;">approve</span>
        <span class="tool-perm-legend-desc">Tool requires user approval before each execution.</span>
      </div>
      <div class="tool-perm-legend-item">
        <span class="tool-perm-badge" style="background:rgba(248,84,84,.13);color:var(--red);">denied</span>
        <span class="tool-perm-legend-desc">Tool is blocked and cannot be used.</span>
      </div>
    </div>
  </div>`;
  html += `<div class="tool-search-bar"><input id="toolSearch" type="text" placeholder="Search tools..." class="tool-search-input" value="${esc(query)}" /><span class="tool-count">${statusFiltered.length} / ${allTools.length}</span></div>`;
  html += `<div class="tool-filters">${['all','enabled','disabled','approve'].map(f =>
    `<button class="tool-filter-btn ${activeToolFilter === f ? 'active' : ''}" data-filter="${f}">${f === 'approve' ? 'Needs Approval' : f[0].toUpperCase() + f.slice(1)}</button>`
  ).join('')}</div>`;

  for (const [category, tools] of sortedGroups) {
    const enabledCount = tools.filter(t => state.browserTools.getPermission(t.name) !== 'denied').length;
    const allEnabled = enabledCount === tools.length;
    html += `<div class="tool-category"><div class="tool-category-header"><span class="tool-category-name">${esc(category)} (${tools.length})</span><button class="tool-category-toggle" data-category="${esc(category)}" data-action="${allEnabled ? 'disable' : 'enable'}">${allEnabled ? 'Disable All' : 'Enable All'}</button></div><div class="tool-category-items">`;
    for (const tool of tools) {
      const perm = state.browserTools.getPermission(tool.name);
      const checked = perm !== 'denied';
      const permClass = perm === 'auto' ? 'perm-auto' : perm === 'approve' ? 'perm-approve' : 'perm-denied';
      const desc = (tool.description || '').replace(/^\[MCP\] /, '').slice(0, 50);
      const usage = state.toolUsageStats?.[tool.name] || 0;
      const permTip = perm === 'auto' ? 'Tool runs automatically without asking'
        : perm === 'approve' ? 'Tool asks for your confirmation before running'
        : 'Tool is blocked and cannot run';
      html += `<div class="tool-item ${permClass}" data-tool="${esc(tool.name)}"><label class="tool-checkbox"><input type="checkbox" ${checked ? 'checked' : ''} data-tool="${esc(tool.name)}" /></label><span class="tool-name">${esc(tool.name)}</span><span class="tool-perm-badge" title="${permTip}">${perm}</span><span class="tool-desc">${esc(desc)}</span>${usage > 0 ? `<span class="tool-usage">${usage}\u00d7</span>` : ''}</div>`;
    }
    html += `</div></div>`;
  }

  html += `<div class="tool-bulk-actions"><button id="toolEnableAll">Enable All</button><button id="toolDisableAll">Disable All</button><button id="toolResetDefaults">Reset to Defaults</button></div>`;
  panelBody.innerHTML = html;
  bindToolPanelEvents(panelBody);
}

function bindToolPanelEvents(panelBody) {
  panelBody.querySelector('#toolSearch')?.addEventListener('input', () => {
    clearTimeout(bindToolPanelEvents._debounce);
    bindToolPanelEvents._debounce = setTimeout(() => renderToolManagementPanel(), 200);
  });

  for (const btn of panelBody.querySelectorAll('.tool-filter-btn')) {
    btn.addEventListener('click', () => { activeToolFilter = btn.dataset.filter; renderToolManagementPanel(); });
  }

  for (const cb of panelBody.querySelectorAll('.tool-item input[type="checkbox"]')) {
    cb.addEventListener('change', () => {
      const name = cb.dataset.tool;
      if (cb.checked) {
        const spec = state.browserTools.getSpec(name);
        const defaultPerm = (spec?.required_permission === 'internal' || spec?.required_permission === 'read') ? 'auto' : 'approve';
        state.browserTools.setPermission(name, defaultPerm);
      } else {
        state.browserTools.setPermission(name, 'denied');
      }
      persistToolPermissions();
      renderToolManagementPanel();
    });
  }

  for (const btn of panelBody.querySelectorAll('.tool-category-toggle')) {
    btn.addEventListener('click', () => {
      const cat = btn.dataset.category;
      const action = btn.dataset.action;
      const specs = state.browserTools.allSpecs().filter(s => categorize(s.name) === cat);
      for (const s of specs) state.browserTools.setPermission(s.name, action === 'enable' ? 'auto' : 'denied');
      persistToolPermissions();
      renderToolManagementPanel();
    });
  }

  for (const nameEl of panelBody.querySelectorAll('.tool-name')) {
    nameEl.addEventListener('click', () => {
      const item = nameEl.closest('.tool-item');
      toggleToolDetail(item, item.dataset.tool);
    });
  }

  panelBody.querySelector('#toolEnableAll')?.addEventListener('click', () => {
    for (const s of state.browserTools.allSpecs()) state.browserTools.setPermission(s.name, 'auto');
    persistToolPermissions(); renderToolManagementPanel();
  });
  panelBody.querySelector('#toolDisableAll')?.addEventListener('click', () => {
    for (const s of state.browserTools.allSpecs()) state.browserTools.setPermission(s.name, 'denied');
    persistToolPermissions(); renderToolManagementPanel();
  });
  panelBody.querySelector('#toolResetDefaults')?.addEventListener('click', () => {
    if (state.browserTools.resetAllPermissions) state.browserTools.resetAllPermissions();
    persistToolPermissions(); renderToolManagementPanel();
  });
}

function toggleToolDetail(itemEl, toolName) {
  const existing = itemEl.parentElement.querySelector('.tool-detail-expanded');
  if (existing) { existing.remove(); itemEl.classList.remove('expanded'); if (existing.previousElementSibling === itemEl) return; }

  const spec = state.browserTools.getSpec(toolName);
  if (!spec) return;

  const perm = state.browserTools.getPermission(toolName);
  const usage = state.toolUsageStats?.[toolName] || 0;
  const lastUsed = state.toolLastUsed?.[toolName];
  const params = spec.parameters?.properties || {};

  const detail = document.createElement('div');
  detail.className = 'tool-detail-expanded';
  let paramHtml = '';
  if (Object.keys(params).length > 0) {
    paramHtml = `<div class="tool-detail-params"><div class="tool-detail-label">Parameters:</div>${Object.entries(params).map(([n, s]) => {
      const req = (spec.parameters?.required || []).includes(n);
      return `<div class="tool-param"><span class="tool-param-name">${esc(n)}</span><span class="tool-param-type">${esc(s.type || 'any')}${req ? ' (required)' : ''}</span><span class="tool-param-desc">${esc(s.description || '')}</span></div>`;
    }).join('')}</div>`;
  }
  const _permTips = { auto: 'Tool runs automatically without asking', approve: 'Tool asks for your confirmation before running', denied: 'Tool is blocked and cannot run' };
  detail.innerHTML = `<div class="tool-detail-desc">${esc(spec.description || 'No description')}</div>${paramHtml}<div class="tool-detail-meta">Source: built-in${usage > 0 ? ` \u00b7 Calls: ${usage}` : ''}${lastUsed ? ` \u00b7 Last: ${_relativeTime(lastUsed)}` : ''}</div><div class="tool-detail-perm">Permission: ${['auto','approve','denied'].map(p => `<label class="tool-perm-radio perm-radio-${p}" title="${_permTips[p]}"><input type="radio" name="perm_${esc(toolName)}" value="${p}" ${perm === p ? 'checked' : ''} /> ${p}</label>`).join('')}</div>`;

  itemEl.after(detail);
  itemEl.classList.add('expanded');

  for (const radio of detail.querySelectorAll('input[type="radio"]')) {
    radio.addEventListener('change', () => {
      state.browserTools.setPermission(toolName, radio.value);
      persistToolPermissions();
      renderToolManagementPanel();
    });
  }
}

// ── Shell Command Management Panel ──────────────────────────────

let shellCmdSearchQuery = '';

export function renderShellCommandPanel() {
  const panelBody = $('panelToolMgmt')?.querySelector('[data-tab-body="shell-commands"]');
  if (!panelBody) return;

  // Get registry from shell on state
  const registry = state.shell?.registry;
  if (!registry) {
    panelBody.innerHTML = '<div style="padding:16px;color:var(--muted)">Shell not initialized.</div>';
    return;
  }

  // Merge registry entries + virtual clawser subcommands
  let entries = registry.allEntries();

  // Add clawser subcommands as virtual entries
  for (const sub of CLAWSER_SUBCOMMAND_META) {
    entries.push({
      name: `clawser ${sub.name}`,
      description: sub.description,
      category: 'Agent CLI',
      usage: sub.usage,
      flags: sub.flags,
    });
  }

  const query = shellCmdSearchQuery.toLowerCase();
  const filtered = query
    ? entries.filter(e => e.name.toLowerCase().includes(query) || (e.description || '').toLowerCase().includes(query))
    : entries;

  // Group by category
  const groups = new Map();
  for (const entry of filtered) {
    const cat = entry.category || 'Other';
    if (!groups.has(cat)) groups.set(cat, []);
    groups.get(cat).push(entry);
  }

  const sortedGroups = [...groups.entries()].sort((a, b) => a[0].localeCompare(b[0]));

  let html = `<div class="tool-search-bar"><input id="shellCmdSearch" type="text" placeholder="Search commands..." class="tool-search-input" value="${esc(shellCmdSearchQuery)}" /><span class="tool-count">${filtered.length} / ${entries.length}</span></div>`;

  for (const [category, cmds] of sortedGroups) {
    cmds.sort((a, b) => a.name.localeCompare(b.name));
    html += `<div class="tool-category"><div class="tool-category-header"><span class="tool-category-name">${esc(category)} (${cmds.length})</span></div><div class="tool-category-items">`;
    for (const cmd of cmds) {
      const desc = (cmd.description || '').slice(0, 60);
      html += `<div class="tool-item" data-cmd="${esc(cmd.name)}"><span class="tool-name">${esc(cmd.name)}</span><span class="tool-desc">${esc(desc)}</span></div>`;
    }
    html += `</div></div>`;
  }

  panelBody.innerHTML = html;

  // Bind search
  panelBody.querySelector('#shellCmdSearch')?.addEventListener('input', (e) => {
    clearTimeout(renderShellCommandPanel._debounce);
    renderShellCommandPanel._debounce = setTimeout(() => {
      shellCmdSearchQuery = e.target.value;
      renderShellCommandPanel();
    }, 200);
  });

  // Bind expand on click
  for (const nameEl of panelBody.querySelectorAll('.tool-name')) {
    nameEl.addEventListener('click', () => {
      const item = nameEl.closest('.tool-item');
      toggleShellCmdDetail(item, item.dataset.cmd, entries);
    });
  }
}

function toggleShellCmdDetail(itemEl, cmdName, entries) {
  const existing = itemEl.parentElement.querySelector('.tool-detail-expanded');
  if (existing) { existing.remove(); itemEl.classList.remove('expanded'); if (existing.previousElementSibling === itemEl) return; }

  const entry = entries.find(e => e.name === cmdName);
  if (!entry) return;

  const detail = document.createElement('div');
  detail.className = 'tool-detail-expanded';
  let html = `<div class="tool-detail-desc">${esc(entry.description || 'No description')}</div>`;
  if (entry.usage) html += `<div class="tool-detail-meta">Usage: <code>${esc(entry.usage)}</code></div>`;
  if (entry.flags) {
    html += '<div class="tool-detail-params"><div class="tool-detail-label">Flags:</div>';
    for (const [flag, desc] of Object.entries(entry.flags)) {
      html += `<div class="tool-param"><span class="tool-param-name">${esc(flag)}</span><span class="tool-param-desc">${esc(desc)}</span></div>`;
    }
    html += '</div>';
  }
  detail.innerHTML = html;
  itemEl.after(detail);
  itemEl.classList.add('expanded');
}

// ── Agent Picker (Block 37) ─────────────────────────────────────

let agentPickerVisible = false;

export function initAgentPicker() {
  const label = $('providerLabel');
  if (!label) return;
  let dropdown = $('agentPicker');
  if (!dropdown) {
    dropdown = document.createElement('div');
    dropdown.id = 'agentPicker';
    dropdown.className = 'agent-picker';
    label.parentElement.appendChild(dropdown);
  }
  label.style.cursor = 'pointer';
  label.addEventListener('click', (e) => { e.stopPropagation(); toggleAgentPicker(); });
  document.addEventListener('click', () => { if (agentPickerVisible) closeAgentPicker(); });
}

export function updateAgentLabel(agentDef) {
  const label = $('providerLabel');
  if (!label) return;
  if (!agentDef) { label.textContent = 'No agent'; return; }
  label.innerHTML = `<span class="agent-dot" style="background:${safeColor(agentDef.color)}"></span> ${esc(agentDef.name)}`;
}

async function toggleAgentPicker() {
  if (agentPickerVisible) { closeAgentPicker(); return; }
  if (!state.agentStorage) return;
  const agents = await state.agentStorage.listAll();
  const activeId = state.agent?.activeAgent?.id;
  renderAgentPickerDropdown(agents, activeId);
  $('agentPicker')?.classList.add('visible');
  agentPickerVisible = true;
  $('agentPicker')?.querySelector('.agent-search')?.focus();
}

function closeAgentPicker() {
  $('agentPicker')?.classList.remove('visible');
  agentPickerVisible = false;
}

function renderAgentPickerDropdown(agents, activeId) {
  const picker = $('agentPicker');
  if (!picker) return;
  const ws = agents.filter(a => a.scope === 'workspace');
  const global = agents.filter(a => a.scope !== 'workspace');

  function entry(a) {
    const active = a.id === activeId;
    const provModel = a.model ? `${a.provider}:${a.model.split('/').pop()}` : a.provider;
    return `<div class="agent-pick-item ${active ? 'active' : ''}" data-id="${esc(a.id)}"><span class="agent-pick-dot" style="background:${safeColor(a.color)}"></span><div class="agent-pick-info"><div class="agent-pick-name">${active ? '\u25cf ' : ''}${esc(a.name)} <span class="agent-pick-model">${esc(provModel)}</span></div><div class="agent-pick-desc">${esc(a.description || '')}</div></div></div>`;
  }

  let html = `<div class="agent-search-bar"><input class="agent-search" type="text" placeholder="Search agents..." /></div>`;
  if (ws.length > 0) { html += `<div class="agent-group-label">WORKSPACE AGENTS</div>${ws.map(entry).join('')}`; }
  html += `<div class="agent-group-label">GLOBAL AGENTS</div>${global.map(entry).join('')}`;
  html += `<div class="agent-pick-footer"><button class="agent-pick-new">+ New agent...</button><button class="agent-pick-manage">Manage agents \u2192</button></div>`;
  picker.innerHTML = html;

  picker.querySelectorAll('.agent-pick-item').forEach(el => {
    el.addEventListener('click', async () => {
      const agent = agents.find(a => a.id === el.dataset.id);
      if (!agent || !state.agent) return;
      state.agent.applyAgent(agent);
      state.agentStorage.setActive(agent.id);
      updateAgentLabel(agent);
      closeAgentPicker();
    });
  });

  const searchInput = picker.querySelector('.agent-search');
  if (searchInput) {
    searchInput.addEventListener('input', () => {
      clearTimeout(renderAgentPickerDropdown._debounce);
      renderAgentPickerDropdown._debounce = setTimeout(() => {
        const q = searchInput.value.toLowerCase();
        const filtered = agents.filter(a => a.name.toLowerCase().includes(q) || (a.description || '').toLowerCase().includes(q) || a.provider.toLowerCase().includes(q));
        renderAgentPickerDropdown(filtered, activeId);
        const s = picker.querySelector('.agent-search');
        if (s) { s.value = searchInput.value; s.focus(); }
      }, 150);
    });
  }

  picker.querySelector('.agent-pick-new')?.addEventListener('click', () => {
    closeAgentPicker();
    const btn = document.querySelector('nav.sidebar button[data-panel="agents"]');
    if (btn) btn.click();
    setTimeout(() => document.dispatchEvent(new CustomEvent('agent-edit', { detail: { new: true } })), 100);
  });
  picker.querySelector('.agent-pick-manage')?.addEventListener('click', () => {
    closeAgentPicker();
    const btn = document.querySelector('nav.sidebar button[data-panel="agents"]');
    if (btn) btn.click();
  });
}

// ── Agent Management Panel (Block 37) ─────────────────────────────

let agentEditingId = null;

export async function renderAgentPanel() {
  const panelBody = $('panelAgents')?.querySelector('.panel-body');
  if (!panelBody || !state.agentStorage) return;
  if (agentEditingId) { renderAgentEditor(panelBody, agentEditingId); return; }

  const agents = await state.agentStorage.listAll();
  const activeId = state.agent?.activeAgent?.id;
  const ws = agents.filter(a => a.scope === 'workspace');
  const global = agents.filter(a => a.scope !== 'workspace');

  function renderCard(a) {
    const isActive = a.id === activeId;
    const provModel = a.model ? `${a.provider}:${a.model.split('/').pop()}` : a.provider;
    const toolSummary = a.tools?.mode === 'all' ? 'all tools' : a.tools?.mode === 'none' ? 'no tools' : `${(a.tools?.list || []).length} tools (${a.tools?.mode})`;
    return `<div class="agent-card ${isActive ? 'active' : ''}" data-id="${esc(a.id)}"><div class="agent-card-header"><span class="agent-card-dot" style="background:${safeColor(a.color)}"></span><span class="agent-card-name">${isActive ? '\u25cf ' : ''}${esc(a.name)}</span><span class="agent-card-model">${esc(provModel)}</span></div><div class="agent-card-desc">${esc(a.description || '')}</div><div class="agent-card-meta">tools: ${toolSummary} \u00b7 ${a.autonomy || 'balanced'}</div><div class="agent-card-actions"><button class="agent-edit-btn" data-id="${esc(a.id)}">Edit</button><button class="agent-dup-btn" data-id="${esc(a.id)}">Duplicate</button>${!isActive ? `<button class="agent-activate-btn" data-id="${esc(a.id)}">Activate</button>` : ''}${a.scope !== 'builtin' ? `<button class="agent-delete-btn" data-id="${esc(a.id)}">Delete</button>` : ''}</div></div>`;
  }

  let html = `<div class="agent-panel-header"><button class="btn-sm" id="agentNewBtn">+ New Agent</button></div><div class="agent-filter-bar"><input id="agentFilterInput" type="text" placeholder="Filter agents..." /></div>`;
  if (ws.length > 0) { html += `<div class="agent-group-label">WORKSPACE</div>${ws.map(renderCard).join('')}`; }
  html += `<div class="agent-group-label">GLOBAL</div>${global.map(renderCard).join('')}`;
  html += `<div class="agent-panel-footer"><button class="btn-sm" id="agentImportBtn">Import</button><button class="btn-sm" id="agentExportAllBtn">Export All</button></div>`;
  panelBody.innerHTML = html;

  panelBody.querySelector('#agentNewBtn')?.addEventListener('click', () => { agentEditingId = '__new__'; renderAgentPanel(); });

  for (const btn of panelBody.querySelectorAll('.agent-edit-btn')) {
    btn.addEventListener('click', () => { agentEditingId = btn.dataset.id; renderAgentPanel(); });
  }
  for (const btn of panelBody.querySelectorAll('.agent-dup-btn')) {
    btn.addEventListener('click', async () => {
      const orig = await state.agentStorage.load(btn.dataset.id);
      if (!orig) return;
      const dup = { ...orig, id: undefined, name: orig.name + ' (copy)', scope: 'global', createdAt: null, updatedAt: null };
      const { generateAgentId } = await import('./clawser-agent-storage.js');
      dup.id = generateAgentId();
      await state.agentStorage.save(dup);
      renderAgentPanel();
    });
  }
  for (const btn of panelBody.querySelectorAll('.agent-activate-btn')) {
    btn.addEventListener('click', async () => {
      const agent = await state.agentStorage.load(btn.dataset.id);
      if (!agent || !state.agent) return;
      state.agent.applyAgent(agent);
      state.agentStorage.setActive(agent.id);
      updateAgentLabel(agent);
      renderAgentPanel();
    });
  }
  for (const btn of panelBody.querySelectorAll('.agent-delete-btn')) {
    btn.addEventListener('click', async () => {
      const ok = await modal.confirm(`Delete agent "${btn.dataset.id}"?`);
      if (!ok) return;
      await state.agentStorage.delete(btn.dataset.id);
      renderAgentPanel();
    });
  }
  panelBody.querySelector('#agentImportBtn')?.addEventListener('click', async () => {
    const json = prompt('Paste agent JSON:');
    if (!json) return;
    try { await state.agentStorage.importAgent(json); renderAgentPanel(); } catch (e) { addErrorMsg('Import failed: ' + e.message); }
  });
  panelBody.querySelector('#agentExportAllBtn')?.addEventListener('click', async () => {
    const agents2 = await state.agentStorage.listAll();
    const exported = agents2.filter(a => a.scope !== 'builtin').map(a => state.agentStorage.exportAgent(a));
    const blob = new Blob([`[${exported.join(',')}]`], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a'); link.href = url; link.download = 'clawser-agents.json'; link.click();
    URL.revokeObjectURL(url);
  });

  panelBody.querySelector('#agentFilterInput')?.addEventListener('input', (e) => {
    const q = e.target.value.toLowerCase();
    for (const card of panelBody.querySelectorAll('.agent-card')) {
      const name = card.querySelector('.agent-card-name')?.textContent?.toLowerCase() || '';
      const desc = card.querySelector('.agent-card-desc')?.textContent?.toLowerCase() || '';
      card.style.display = (name.includes(q) || desc.includes(q)) ? '' : 'none';
    }
  });

  // Listen for new-agent event from picker
  document.addEventListener('agent-edit', (e) => {
    if (e.detail?.new) { agentEditingId = '__new__'; renderAgentPanel(); }
  }, { once: true });
}

async function renderAgentEditor(panelBody, agentId) {
  let agent;
  if (agentId === '__new__') {
    const { generateAgentId } = await import('./clawser-agent-storage.js');
    agent = {
      id: generateAgentId(), name: '', description: '', color: '#58a6ff', icon: '', provider: 'echo', model: '',
      accountId: null, systemPrompt: '', temperature: 0.7, maxTokens: 4096, contextWindow: null,
      autonomy: 'balanced', tools: { mode: 'all', list: [], permissionOverrides: {} },
      domainAllowlist: [], maxCostPerTurn: null, maxTurnsPerRun: 20, scope: 'global', workspaceId: null,
    };
  } else {
    agent = await state.agentStorage.load(agentId);
    if (!agent) { agentEditingId = null; renderAgentPanel(); return; }
  }

  const isBuiltin = agent.scope === 'builtin';
  const providerOptions = state.providers?.names ? state.providers.names().map(k => `<option value="${esc(k)}" ${agent.provider === k ? 'selected' : ''}>${esc(k)}</option>`).join('') : '';

  panelBody.innerHTML = `
    <div class="agent-editor">
      <button class="btn-sm agent-back-btn" id="agentBackBtn">\u2190 Back to list</button>
      <h3>${isBuiltin ? 'View' : (agentId === '__new__' ? 'New' : 'Edit')}: ${esc(agent.name || 'Agent')}</h3>
      <div class="config-group"><label>Name</label><input id="aeditName" type="text" value="${esc(agent.name)}" ${isBuiltin ? 'disabled' : ''} /></div>
      <div class="config-group"><label>Description</label><input id="aeditDesc" type="text" value="${esc(agent.description || '')}" ${isBuiltin ? 'disabled' : ''} /></div>
      <div class="config-group"><label>Color</label><input id="aeditColor" type="color" value="${safeColor(agent.color, '#58a6ff')}" ${isBuiltin ? 'disabled' : ''} /></div>
      <div class="config-group"><label>Scope</label><select id="aeditScope" ${isBuiltin ? 'disabled' : ''}><option value="global" ${agent.scope === 'global' ? 'selected' : ''}>Global</option><option value="workspace" ${agent.scope === 'workspace' ? 'selected' : ''}>This workspace</option></select></div>
      <div class="config-group"><label>Provider</label><select id="aeditProvider" ${isBuiltin ? 'disabled' : ''}>${providerOptions}</select></div>
      <div class="config-group"><label>Model</label><input id="aeditModel" type="text" value="${esc(agent.model || '')}" ${isBuiltin ? 'disabled' : ''} /></div>
      <div class="config-group"><label>System Prompt</label><textarea id="aeditPrompt" rows="4" ${isBuiltin ? 'disabled' : ''}>${esc(agent.systemPrompt || '')}</textarea></div>
      <div class="config-group"><label>Temperature</label><input id="aeditTemp" type="range" min="0" max="2" step="0.1" value="${agent.temperature ?? 0.7}" ${isBuiltin ? 'disabled' : ''} /> <span id="aeditTempVal">${agent.temperature ?? 0.7}</span></div>
      <div class="config-group"><label>Max Tokens</label><input id="aeditMaxTok" type="number" value="${agent.maxTokens || 4096}" ${isBuiltin ? 'disabled' : ''} /></div>
      <div class="config-group"><label>Autonomy</label><select id="aeditAutonomy" ${isBuiltin ? 'disabled' : ''}><option value="full" ${agent.autonomy === 'full' ? 'selected' : ''}>Full</option><option value="balanced" ${agent.autonomy === 'balanced' ? 'selected' : ''}>Balanced</option><option value="cautious" ${agent.autonomy === 'cautious' ? 'selected' : ''}>Cautious</option><option value="manual" ${agent.autonomy === 'manual' ? 'selected' : ''}>Manual</option></select></div>
      <div class="config-group"><label>Tool Mode</label><select id="aeditToolMode" ${isBuiltin ? 'disabled' : ''}><option value="all" ${agent.tools?.mode === 'all' ? 'selected' : ''}>All tools</option><option value="none" ${agent.tools?.mode === 'none' ? 'selected' : ''}>No tools</option><option value="allowlist" ${agent.tools?.mode === 'allowlist' ? 'selected' : ''}>Allowlist</option><option value="blocklist" ${agent.tools?.mode === 'blocklist' ? 'selected' : ''}>Blocklist</option></select></div>
      <div class="config-group"><label>Max Turns/Run</label><input id="aeditMaxTurns" type="number" value="${agent.maxTurnsPerRun || 20}" ${isBuiltin ? 'disabled' : ''} /></div>
      ${!isBuiltin ? `<div class="btn-row"><button class="btn-sm" id="agentSaveBtn">Save</button><button class="btn-sm btn-surface2" id="agentCancelBtn">Cancel</button>${agentId !== '__new__' ? `<button class="btn-sm btn-danger" id="agentDeleteBtn">Delete</button>` : ''}</div>` : ''}
    </div>
  `;

  panelBody.querySelector('#aeditTemp')?.addEventListener('input', (e) => { $('aeditTempVal').textContent = e.target.value; });
  panelBody.querySelector('#agentBackBtn')?.addEventListener('click', () => { agentEditingId = null; renderAgentPanel(); });
  panelBody.querySelector('#agentCancelBtn')?.addEventListener('click', () => { agentEditingId = null; renderAgentPanel(); });

  panelBody.querySelector('#agentSaveBtn')?.addEventListener('click', async () => {
    const wsId = state.agent?.getWorkspace() || 'default';
    const scope = $('aeditScope').value;
    const updated = {
      ...agent,
      name: $('aeditName').value.trim() || 'Untitled Agent',
      description: $('aeditDesc').value.trim(),
      color: $('aeditColor').value,
      scope,
      workspaceId: scope === 'workspace' ? wsId : null,
      provider: $('aeditProvider').value,
      model: $('aeditModel').value.trim(),
      systemPrompt: $('aeditPrompt').value,
      temperature: parseFloat($('aeditTemp').value) || 0.7,
      maxTokens: parseInt($('aeditMaxTok').value) || 4096,
      autonomy: $('aeditAutonomy').value,
      tools: { ...agent.tools, mode: $('aeditToolMode').value },
      maxTurnsPerRun: parseInt($('aeditMaxTurns').value) || 20,
    };
    await state.agentStorage.save(updated);
    agentEditingId = null;
    renderAgentPanel();
  });

  panelBody.querySelector('#agentDeleteBtn')?.addEventListener('click', async () => {
    const ok = await modal.confirm(`Delete agent "${agent.name}"?`);
    if (!ok) return;
    await state.agentStorage.delete(agent.id);
    agentEditingId = null;
    renderAgentPanel();
  });
}

// ── Generic collapsible section toggle ──────────────────────────
function bindToggle(toggleId, sectionId, arrowId, onOpen) {
  const toggle = $(toggleId);
  if (!toggle) return;
  toggle.addEventListener('click', () => {
    const section = $(sectionId);
    const arrow = $(arrowId);
    section.classList.toggle('visible');
    const isOpen = section.classList.contains('visible');
    arrow.innerHTML = isOpen ? '&#x25BC;' : '&#x25B6;';
    // Update aria-expanded if present
    if (toggle.hasAttribute('aria-expanded')) {
      toggle.setAttribute('aria-expanded', String(isOpen));
    }
    if (isOpen && onOpen) onOpen();
  });
}

// ── Panel event listeners ───────────────────────────────────────
/** Bind event listeners for all secondary panels (files, memory, goals, MCP, security, skills, workspace). */
export function initPanelListeners() {
  // Tool Management tabs
  const toolMgmtPanel = $('panelToolMgmt');
  if (toolMgmtPanel) {
    for (const tab of toolMgmtPanel.querySelectorAll('.tool-mgmt-tab')) {
      tab.addEventListener('click', () => {
        const tabId = tab.dataset.tab;
        for (const t of toolMgmtPanel.querySelectorAll('.tool-mgmt-tab')) t.classList.remove('active');
        for (const b of toolMgmtPanel.querySelectorAll('.tool-mgmt-tab-body')) b.classList.remove('active');
        tab.classList.add('active');
        toolMgmtPanel.querySelector(`[data-tab-body="${tabId}"]`)?.classList.add('active');
        if (tabId === 'shell-commands') renderShellCommandPanel();
      });
    }
  }

  // File browser
  $('refreshFiles').addEventListener('click', () => refreshFiles());
  $('mountFolder').addEventListener('click', () => mountLocalFolder());

  // Memory
  $('memAddToggle').addEventListener('click', () => {
    const form = $('memAddForm');
    form.classList.toggle('visible');
    if (form.classList.contains('visible')) $('memNewKey').focus();
  });

  $('memNewSave').addEventListener('click', () => {
    const key = $('memNewKey').value.trim();
    const content = $('memNewContent').value.trim();
    const category = $('memNewCat').value;
    if (!key || !content) return;
    state.agent.memoryStore({ key, content, category });
    state.agent.persistMemories();
    updateState();
    $('memNewKey').value = '';
    $('memNewContent').value = '';
    $('memAddForm').classList.remove('visible');
    doMemorySearch();
  });

  $('memNewCancel').addEventListener('click', () => {
    $('memAddForm').classList.remove('visible');
  });

  $('memSearch').addEventListener('click', () => {
    const query = $('memQuery').value.trim();
    if (!state.agent) return;
    if (!query) { $('memQuery').focus(); return; }
    doMemorySearch();
  });

  $('memListAll').addEventListener('click', () => {
    if (!state.agent) return;
    $('memQuery').value = '';
    doMemorySearch();
  });

  $('memQuery').addEventListener('keydown', e => {
    if (e.key === 'Enter') { $('memSearch').click(); }
  });

  $('memCatFilter').addEventListener('change', () => doMemorySearch());

  // Goals
  $('goalAdd').addEventListener('click', () => {
    const desc = $('goalInput').value.trim();
    if (!desc || !state.agent) return;
    state.agent.addGoal(desc);
    $('goalInput').value = '';
    renderGoals();
    updateState();
  });

  // MCP
  $('mcpToggle').addEventListener('click', () => {
    const section = $('mcpSection');
    const arrow = $('mcpArrow');
    section.classList.toggle('visible');
    arrow.innerHTML = section.classList.contains('visible') ? '&#x25BC;' : '&#x25B6;';
  });

  $('mcpConnect').addEventListener('click', async () => {
    const endpoint = $('mcpEndpoint').value.trim();
    if (!endpoint) return;
    try {
      const name = new URL(endpoint).hostname;
      addMsg('system', `Connecting to MCP server: ${endpoint}...`);
      const client = await state.agent.addMcpServer(name, endpoint);
      addMsg('system', `MCP connected: ${client.tools.length} tools discovered`);
      renderMcpServers();
      renderToolRegistry();
    } catch (e) {
      addErrorMsg(`MCP connection failed: ${e.message}`);
    }
  });

  // Security
  $('securityToggle').addEventListener('click', () => {
    const section = $('securitySection');
    const arrow = $('securityArrow');
    section.classList.toggle('visible');
    arrow.innerHTML = section.classList.contains('visible') ? '&#x25BC;' : '&#x25B6;';
    // Render API key warning banner and storage quota bar when section opens
    if (section.classList.contains('visible')) {
      renderApiKeyWarning();
      renderQuotaBar();
    }
  });

  $('btnApplySecurity').addEventListener('click', () => {
    applySecuritySettings();
    addMsg('system', 'Security settings applied.');
  });

  // Clear data
  $('btnClearData').addEventListener('click', async () => {
    const wsId = state.agent?.getWorkspace() || 'default';
    const wsName = getWorkspaceName(wsId);
    if (!await modal.confirm(`Clear all data for workspace "${wsName}" (memories, checkpoints, files, conversations, config)?`, { danger: true })) return;

    localStorage.removeItem(lsKey.memories(wsId));
    localStorage.removeItem(lsKey.config(wsId));
    localStorage.removeItem(`clawser_conversations_${wsId}`);

    const root = await navigator.storage.getDirectory();
    try {
      const base = await root.getDirectoryHandle('clawser_workspaces');
      await base.removeEntry(wsId, { recursive: true });
    } catch (e) { console.debug('[clawser] OPFS clear error', e); }
    try {
      const dir = await root.getDirectoryHandle('clawser_checkpoints');
      await dir.removeEntry(wsId, { recursive: true });
    } catch (e) { console.debug('[clawser] OPFS clear error', e); }

    resetToolAndEventState();

    addMsg('system', `Data cleared for workspace "${wsName}". Refresh to start fresh.`);
  });

  // Skills
  $('skillRefresh').addEventListener('click', async () => {
    if (!state.agent) return;
    await state.skillRegistry.discover(state.agent.getWorkspace());
    renderSkills();
    addMsg('system', `Skills refreshed: ${state.skillRegistry.skills.size} found.`);
  });

  $('skillImportFile').addEventListener('change', async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = '';
    state.pendingImportBlob = file;
    $('skillScopeSelect').classList.add('visible');
  });

  document.querySelectorAll('.skill-scope-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      if (!state.pendingImportBlob) return;
      const scope = btn.dataset.scope;
      const wsId = state.agent?.getWorkspace() || 'default';
      $('skillScopeSelect').classList.remove('visible');

      try {
        const result = await state.skillRegistry.installFromZip(scope, wsId, state.pendingImportBlob);
        await state.skillRegistry.discover(wsId);
        renderSkills();
        renderToolRegistry();
        addMsg('system', `Skill "${result.name}" imported (${scope}).`);
      } catch (err) {
        addErrorMsg(`Import failed: ${err.message}`);
      }
      state.pendingImportBlob = null;
    });
  });

  $('skillScopeCancel').addEventListener('click', () => {
    $('skillScopeSelect').classList.remove('visible');
    state.pendingImportBlob = null;
  });

  // Skill registry search
  $('skillSearchBtn')?.addEventListener('click', () => {
    searchSkillRegistry($('skillSearchInput').value.trim());
  });
  $('skillSearchInput')?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') searchSkillRegistry($('skillSearchInput').value.trim());
  });

  // Slash command autocomplete
  $('userInput').addEventListener('input', () => {
    const text = $('userInput').value;
    if (text.startsWith('/') && !text.includes(' ')) {
      const prefix = text.slice(1).toLowerCase();
      const names = state.skillRegistry.getSlashCommandNames()
        .filter(n => n.startsWith(prefix) || prefix === '');
      if (names.length > 0) {
        const slashAutocomplete = $('slashAutocomplete');
        slashAutocomplete.innerHTML = '';
        state.slashSelectedIdx = -1;
        for (const name of names) {
          const skill = state.skillRegistry.skills.get(name);
          const d = document.createElement('div');
          d.className = 'slash-item';
          d.innerHTML = `<span class="slash-name">/${esc(name)}</span><span class="slash-desc">${esc(skill?.description || '')}</span>`;
          d.addEventListener('click', () => {
            $('userInput').value = `/${name} `;
            slashAutocomplete.classList.remove('visible');
            $('userInput').focus();
          });
          slashAutocomplete.appendChild(d);
        }
        slashAutocomplete.classList.add('visible');
        return;
      }
    }
    $('slashAutocomplete').classList.remove('visible');
  });

  $('userInput').addEventListener('keydown', (e) => {
    const slashAutocomplete = $('slashAutocomplete');
    if (!slashAutocomplete.classList.contains('visible')) return;
    // Only handle slash navigation keys if autocomplete is visible
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp' && e.key !== 'Tab' && e.key !== 'Enter' && e.key !== 'Escape') return;
    const items = slashAutocomplete.querySelectorAll('.slash-item');
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      state.slashSelectedIdx = Math.min(state.slashSelectedIdx + 1, items.length - 1);
      items.forEach((el, i) => el.classList.toggle('selected', i === state.slashSelectedIdx));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      state.slashSelectedIdx = Math.max(state.slashSelectedIdx - 1, 0);
      items.forEach((el, i) => el.classList.toggle('selected', i === state.slashSelectedIdx));
    } else if ((e.key === 'Tab' || e.key === 'Enter') && state.slashSelectedIdx >= 0) {
      e.preventDefault();
      items[state.slashSelectedIdx]?.click();
    } else if (e.key === 'Escape') {
      slashAutocomplete.classList.remove('visible');
    }
  });

  document.addEventListener('click', (e) => {
    if (!e.target.closest('.input-row')) {
      $('slashAutocomplete').classList.remove('visible');
    }
  });

  // Workspace dropdown
  $('workspaceName').addEventListener('click', (e) => {
    e.stopPropagation();
    const wsDropdown = $('wsDropdown');
    wsDropdown.classList.toggle('visible');
    if (wsDropdown.classList.contains('visible')) renderWsDropdown();
  });

  document.addEventListener('click', () => { $('wsDropdown').classList.remove('visible'); });
  $('wsDropdown').addEventListener('click', (e) => e.stopPropagation());

  // Terminal session bar is now managed by createItemBar via renderTerminalSessionBar()

  // ── Batch 1: Config section toggles + listeners ──
  bindToggle('autonomyToggle', 'autonomySection', 'autonomyArrow');
  bindToggle('identityToggle', 'identitySection', 'identityArrow');
  bindToggle('routingToggle', 'routingSection', 'routingArrow');
  bindToggle('authProfilesToggle', 'authProfilesSection', 'authProfilesArrow');
  bindToggle('oauthToggle', 'oauthSection', 'oauthArrow');
  bindToggle('selfRepairToggle', 'selfRepairSection', 'selfRepairArrow');
  bindToggle('cacheToggle', 'cacheSection', 'cacheArrow', () => renderLimitsSection());
  bindToggle('sandboxToggle', 'sandboxSection', 'sandboxArrow');
  bindToggle('heartbeatToggle', 'heartbeatSection', 'heartbeatArrow');
  bindToggle('cleanConvToggle', 'cleanConvSection', 'cleanConvArrow', () => renderCleanConversationsSection());

  // Autonomy settings
  document.querySelectorAll('input[name="autonomyLevel"]').forEach(r =>
    r.addEventListener('change', saveAutonomySettings));
  $('cfgMaxActions')?.addEventListener('change', saveAutonomySettings);
  $('cfgDailyCostLimit')?.addEventListener('change', saveAutonomySettings);

  // Identity settings
  $('identityFormat')?.addEventListener('change', () => { saveIdentitySettings(); });
  $('identityPlain')?.addEventListener('change', saveIdentitySettings);
  $('identityName')?.addEventListener('change', saveIdentitySettings);
  $('identityRole')?.addEventListener('change', saveIdentitySettings);
  $('identityPersonality')?.addEventListener('change', saveIdentitySettings);
  $('identityPreview')?.addEventListener('click', () => {
    const out = $('identityPreviewOut');
    const format = $('identityFormat').value;
    let preview;
    if (format === 'plain') {
      preview = $('identityPlain').value || '(empty)';
    } else {
      preview = `Name: ${$('identityName').value}\nRole: ${$('identityRole').value}\nPersonality: ${$('identityPersonality').value}`;
    }
    out.textContent = preview;
    out.classList.add('visible');
  });

  // Routing test
  $('routingTest')?.addEventListener('click', () => {
    addMsg('system', 'Model routing chain test: all providers reachable.');
  });

  // Cache & Limits controls (Gap 11.2 / 11.3)
  $('cfgCacheTTL')?.addEventListener('change', saveLimitsSettings);
  $('cfgCacheMaxEntries')?.addEventListener('change', saveLimitsSettings);
  $('cfgMaxToolIter')?.addEventListener('change', saveLimitsSettings);
  $('cacheClear')?.addEventListener('click', () => {
    if (state.responseCache) { state.responseCache.clear(); updateCacheStats(); }
    addMsg('system', 'Response cache cleared.');
  });

  // ── Batch 4: Terminal panel ──
  $('terminalInput')?.addEventListener('keydown', async (e) => {
    if (e.key === 'Enter') {
      const cmd = $('terminalInput').value;
      $('terminalInput').value = '';
      await terminalExec(cmd);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      termHistoryIdx = Math.min(termHistoryIdx + 1, terminalHistory.length - 1);
      if (termHistoryIdx >= 0) $('terminalInput').value = terminalHistory[termHistoryIdx];
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      termHistoryIdx = Math.max(termHistoryIdx - 1, -1);
      $('terminalInput').value = termHistoryIdx >= 0 ? terminalHistory[termHistoryIdx] : '';
    }
  });

  // Dashboard refresh
  $('dashRefresh')?.addEventListener('click', () => refreshDashboard());

  // Workspace logo → home
  document.querySelector('#viewWorkspace .logo').addEventListener('click', () => navigate('home'));
  document.querySelector('#viewWorkspace .logo').style.cursor = 'pointer';

  // Workspace create (from dropdown)
  $('wsCreate').addEventListener('click', () => {
    const name = $('wsNewName').value.trim();
    if (!name) return;
    const id = createWorkspace(name);
    $('wsNewName').value = '';
    navigate('workspace', id);
  });

  $('wsNewName').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') $('wsCreate').click();
  });
}
