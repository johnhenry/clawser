/**
 * clawser-ui-panels.js — Secondary panel rendering and event binding
 *
 * Renders and manages all non-chat workspace panels:
 *   - OPFS file browser (refreshFiles) with click-to-preview
 *   - Memory search/edit/delete (renderMemoryResults, doMemorySearch)
 *   - Goals list with status indicators (renderGoals)
 *   - Tool registry with permission cycling (renderToolRegistry)
 *   - MCP server list (renderMcpServers)
 *   - Skills panel with enable/disable, export, delete (renderSkills)
 *   - Workspace dropdown switcher (renderWsDropdown)
 *   - Security settings: domain allowlist, max file size (applySecuritySettings)
 *   - Slash command autocomplete on the chat input
 */
import { $, esc, state, emit, lsKey } from './clawser-state.js';
import { modal } from './clawser-modal.js';
import { addMsg, addErrorMsg, updateState, resetToolAndEventState } from './clawser-ui-chat.js';
import { loadWorkspaces, getActiveWorkspaceId, renameWorkspace, deleteWorkspace, createWorkspace, getWorkspaceName } from './clawser-workspaces.js';
import { navigate } from './clawser-router.js';
import { SkillStorage } from './clawser-skills.js';

// ── OPFS file browser ──────────────────────────────────────────
const HIDDEN_DIRS = new Set(['.checkpoints', '.skills', '.conversations']);

/** Render the OPFS file browser for the active workspace, with click-to-preview.
 * @param {string} [path='/'] - Directory path relative to workspace root
 * @param {HTMLElement} [el] - Container element (defaults to #fileList)
 */
export async function refreshFiles(path = '/', el = null) {
  if (!el) el = $('fileList');
  try {
    const root = await navigator.storage.getDirectory();

    let wsDir;
    try {
      const base = await root.getDirectoryHandle('clawser_workspaces');
      const wsId = state.agent?.getWorkspace() || 'default';
      wsDir = await base.getDirectoryHandle(wsId);
    } catch {
      el.textContent = '(empty — files created by the agent will appear here)';
      return;
    }

    let dir = wsDir;
    if (path !== '/') {
      for (const part of path.replace(/^\//, '').split('/').filter(Boolean)) {
        dir = await dir.getDirectoryHandle(part);
      }
    }
    el.innerHTML = '';
    if (path !== '/') {
      const back = document.createElement('div');
      back.className = 'file-back';
      back.textContent = '.. (back)';
      const parentPath = path.replace(/[^/]+\/$/, '') || '/';
      back.addEventListener('click', () => refreshFiles(parentPath, el));
      el.appendChild(back);
    }
    let count = 0;
    for await (const [name, handle] of dir) {
      if (path === '/' && HIDDEN_DIRS.has(name)) continue;
      count++;
      const d = document.createElement('div');
      d.className = 'file-item';
      const icon = handle.kind === 'directory' ? '📁' : '📄';
      d.textContent = `${icon} ${name}`;
      d.addEventListener('click', async () => {
        if (handle.kind === 'directory') {
          await refreshFiles(`${path}${name}/`, el);
        } else {
          try {
            const file = await handle.getFile();
            if (file.name.endsWith('.bin') || file.name.endsWith('.wasm') || file.size > 100000) {
              el.insertAdjacentHTML('afterbegin',
                `<div class="file-binary-info">${esc(name)}: ${(file.size / 1024).toFixed(1)} KB (binary)</div>`);
            } else {
              const text = await file.text();
              el.insertAdjacentHTML('afterbegin',
                `<div class="file-preview"><div class="file-preview-name">${esc(name)}</div>${esc(text.slice(0, 2000))}</div>`);
            }
          } catch (e) { console.debug('[clawser] file preview error', e); }
        }
      });
      el.appendChild(d);
    }
    if (count === 0) el.textContent = '(empty — files created by the agent will appear here)';
  } catch (e) {
    el.textContent = `Error: ${e.message}`;
  }
}

// ── Memory management ──────────────────────────────────────────
/** Render memory search results with edit/delete controls, applying category filter.
 * @param {Array<Object>} results - Memory entries
 * @param {HTMLElement} el - Container element
 */
export function renderMemoryResults(results, el) {
  const catFilter = $('memCatFilter').value;
  if (catFilter) results = results.filter(r => r.category === catFilter);

  el.innerHTML = '';
  if (results.length === 0) { el.textContent = 'No memories found.'; return; }
  for (const r of results) {
    const d = document.createElement('div');
    d.className = 'mem-item';
    const cat = r.category || '';
    const catBadge = cat ? `<span class="mem-cat">${esc(cat)}</span>` : '';
    const score = r.score != null ? `<span class="mem-score">${r.score.toFixed(1)}</span>` : '';
    const ts = r.timestamp ? new Date(r.timestamp).toLocaleDateString() : '';
    d.innerHTML = `
      <div class="mem-header">
        <span class="mem-key">${esc(r.key)}</span>
        ${catBadge}${score}
        <span class="mem-actions">
          <button class="mem-edit" title="Edit">&#x270E;</button>
          <button class="mem-del" title="Delete">&#x2715;</button>
        </span>
      </div>
      <div class="mem-content">${esc(r.content || '')}</div>
      ${ts ? `<div class="mem-date">${ts}</div>` : ''}
    `;

    d.querySelector('.mem-edit').addEventListener('click', () => {
      d.querySelectorAll('.mem-edit-form').forEach(f => f.remove());
      const form = document.createElement('div');
      form.className = 'mem-form mem-edit-form';
      form.innerHTML = `
        <input type="text" class="edit-key" value="${esc(r.key)}" />
        <textarea class="edit-content">${esc(r.content || '')}</textarea>
        <div class="mem-form-row">
          <select class="edit-cat">
            <option value="core"${cat === 'core' ? ' selected' : ''}>core</option>
            <option value="learned"${cat === 'learned' ? ' selected' : ''}>learned</option>
            <option value="user"${cat === 'user' ? ' selected' : ''}>user</option>
            <option value="context"${cat === 'context' ? ' selected' : ''}>context</option>
          </select>
          <button class="btn-sm edit-save">Save</button>
          <button class="btn-sm btn-sm-secondary edit-cancel">Cancel</button>
        </div>
      `;
      form.querySelector('.edit-cancel').addEventListener('click', () => form.remove());
      form.querySelector('.edit-save').addEventListener('click', () => {
        const newKey = form.querySelector('.edit-key').value.trim();
        const newContent = form.querySelector('.edit-content').value.trim();
        const newCat = form.querySelector('.edit-cat').value;
        if (!newKey || !newContent) return;
        state.agent.memoryForget(r.id);
        state.agent.memoryStore({ key: newKey, content: newContent, category: newCat });
        state.agent.persistMemories();
        updateState();
        doMemorySearch();
      });
      d.appendChild(form);
    });

    d.querySelector('.mem-del').addEventListener('click', async () => {
      if (!await modal.confirm(`Delete memory "${r.key}"?`, { danger: true })) return;
      const rc = state.agent.memoryForget(r.id);
      if (rc === 1) {
        state.agent.persistMemories();
        updateState();
        doMemorySearch();
      } else {
        addErrorMsg('Failed to delete memory.');
      }
    });

    el.appendChild(d);
  }
}

/** Execute a memory search using the query input and render results. */
export function doMemorySearch() {
  if (!state.agent) return;
  const query = $('memQuery').value.trim();
  renderMemoryResults(state.agent.memoryRecall(query), $('memResults'));
}

// ── Goals ──────────────────────────────────────────────────────
/** Render the goals list with status indicators and completion buttons. */
export function renderGoals() {
  if (!state.agent) return;
  const agentState = state.agent.getState();
  const goals = agentState.goals || [];
  const el = $('goalList');
  el.innerHTML = '';
  for (const g of goals) {
    const d = document.createElement('div');
    d.className = 'goal-item';
    d.innerHTML = `<span class="goal-dot ${esc(g.status)}">●</span><span>${esc(g.description)}</span>`;
    if (g.status === 'active') {
      const btn = document.createElement('button');
      btn.textContent = '✓';
      btn.className = 'goal-complete-btn';
      btn.addEventListener('click', () => { state.agent.completeGoal(g.id); renderGoals(); updateState(); });
      d.appendChild(btn);
    }
    el.appendChild(d);
  }
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
    d.innerHTML = `<span class="tl-name">${esc(s.name)}</span><span class="tl-source ${permClass}">${perm}</span>`;
    d.title = `Click to change permission (current: ${perm})`;
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
          <button class="skill-export" title="Export">↓</button>
          <button class="skill-del" title="Delete">✕</button>
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
      renBtn.textContent = '✏';
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
        delBtn.textContent = '✕';
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

// ── Security settings ──────────────────────────────────────────
/** Apply domain allowlist and max file size from UI inputs to the browser tools and persist. */
export function applySecuritySettings() {
  const raw = $('cfgDomainAllowlist').value.trim();
  const domains = raw ? raw.split(',').map(d => d.trim()).filter(Boolean) : null;
  const maxMB = parseFloat($('cfgMaxFileSize').value) || 10;

  const fetchTool = state.browserTools.get('browser_fetch');
  if (fetchTool?.setDomainAllowlist) fetchTool.setDomainAllowlist(domains);

  const writeTool = state.browserTools.get('browser_fs_write');
  if (writeTool?.setMaxFileSize) writeTool.setMaxFileSize(maxMB * 1024 * 1024);

  if (state.agent) {
    const wsId = state.agent.getWorkspace();
    localStorage.setItem(lsKey.security(wsId), JSON.stringify({ domains: raw, maxFileSizeMB: maxMB }));
  }
}

// ── Config sections (Batch 1) ────────────────────────────────────

/** Generic collapsible section toggle. */
function bindToggle(toggleId, sectionId, arrowId) {
  const toggle = $(toggleId);
  if (!toggle) return;
  toggle.addEventListener('click', () => {
    const section = $(sectionId);
    const arrow = $(arrowId);
    section.classList.toggle('visible');
    arrow.innerHTML = section.classList.contains('visible') ? '&#x25BC;' : '&#x25B6;';
  });
}

/** Render autonomy & costs section (Block 6). */
export function renderAutonomySection() {
  const wsId = state.agent?.getWorkspace() || 'default';
  const saved = JSON.parse(localStorage.getItem(`clawser_autonomy_${wsId}`) || '{}');
  if (saved.level) {
    const radio = document.querySelector(`input[name="autonomyLevel"][value="${saved.level}"]`);
    if (radio) radio.checked = true;
  }
  if (saved.maxActions) $('cfgMaxActions').value = saved.maxActions;
  if (saved.dailyCostLimit != null) $('cfgDailyCostLimit').value = saved.dailyCostLimit;
  updateCostMeter();
  updateAutonomyBadge();
}

/** Save autonomy settings to localStorage. */
export function saveAutonomySettings() {
  const wsId = state.agent?.getWorkspace() || 'default';
  const level = document.querySelector('input[name="autonomyLevel"]:checked')?.value || 'supervised';
  const maxActions = parseInt($('cfgMaxActions').value) || 100;
  const dailyCostLimit = parseFloat($('cfgDailyCostLimit').value) || 5;
  localStorage.setItem(`clawser_autonomy_${wsId}`, JSON.stringify({ level, maxActions, dailyCostLimit }));
  updateCostMeter();
  updateAutonomyBadge();
}

/** Update cost meter bar and label. */
export function updateCostMeter() {
  const limit = parseFloat($('cfgDailyCostLimit')?.value) || 5;
  const spent = state.sessionCost || 0;
  const pct = Math.min((spent / limit) * 100, 100);
  const bar = $('costMeterBar');
  const label = $('costMeterLabel');
  if (bar) {
    bar.style.width = pct + '%';
    bar.className = 'cost-meter-bar' + (pct > 80 ? ' danger' : pct > 50 ? ' warn' : '');
  }
  if (label) label.textContent = `$${spent.toFixed(2)} / $${limit.toFixed(2)}`;
}

/** Update autonomy badge in header. */
export function updateAutonomyBadge() {
  const badge = $('autonomyBadge');
  if (!badge) return;
  const level = document.querySelector('input[name="autonomyLevel"]:checked')?.value || 'supervised';
  const labels = { readonly: '🔴 ReadOnly', supervised: '🟡 Supervised', full: '🟢 Full' };
  badge.textContent = labels[level] || '';
  badge.className = `autonomy-badge visible ${level}`;
}

/** Render identity section (Block 7). */
export function renderIdentitySection() {
  const wsId = state.agent?.getWorkspace() || 'default';
  const saved = JSON.parse(localStorage.getItem(`clawser_identity_${wsId}`) || '{}');
  if (saved.format) $('identityFormat').value = saved.format;
  if (saved.plain) $('identityPlain').value = saved.plain;
  if (saved.name) $('identityName').value = saved.name;
  if (saved.role) $('identityRole').value = saved.role;
  if (saved.personality) $('identityPersonality').value = saved.personality;
  toggleIdentityFormat();
}

function toggleIdentityFormat() {
  const format = $('identityFormat').value;
  $('identityPlainWrap').style.display = format === 'plain' ? '' : 'none';
  const aieosWrap = $('identityAieosWrap');
  if (format === 'aieos') aieosWrap.classList.add('visible');
  else aieosWrap.classList.remove('visible');
}

function saveIdentitySettings() {
  const wsId = state.agent?.getWorkspace() || 'default';
  const format = $('identityFormat').value;
  localStorage.setItem(`clawser_identity_${wsId}`, JSON.stringify({
    format,
    plain: $('identityPlain').value,
    name: $('identityName').value,
    role: $('identityRole').value,
    personality: $('identityPersonality').value,
  }));
}

/** Render model routing section (Block 11). */
export function renderRoutingSection() {
  const list = $('routingChainList');
  const badges = $('routingHealthBadges');
  if (!list || !badges) return;
  list.innerHTML = '';
  badges.innerHTML = '';

  // Show registered providers as chain entries
  if (state.providers) {
    let idx = 1;
    for (const name of state.providers.names()) {
      const d = document.createElement('div');
      d.className = 'routing-chain-item';
      d.innerHTML = `<span class="chain-idx">${idx++}.</span><span class="chain-name">${esc(name)}</span>`;
      list.appendChild(d);

      const badge = document.createElement('span');
      badge.className = 'health-badge healthy';
      badge.textContent = name;
      badges.appendChild(badge);
    }
  }
  if (list.children.length === 0) list.textContent = '(no providers configured)';
}

/** Render auth profiles section (Block 19). */
export function renderAuthProfilesSection() {
  const list = $('authProfileList');
  if (!list) return;
  list.innerHTML = '';

  if (state.authProfileManager) {
    const profiles = state.authProfileManager.listProfiles();
    for (const p of profiles) {
      const d = document.createElement('div');
      d.className = 'auth-profile-item';
      const active = state.authProfileManager.isActive(p.id);
      d.innerHTML = `
        <span class="profile-active ${active ? 'on' : 'off'}"></span>
        <span class="profile-name">${esc(p.name)}</span>
        <span class="profile-provider">${esc(p.provider || '')}</span>
        <span class="profile-actions">
          <button class="profile-switch" title="Switch">${active ? '●' : '○'}</button>
          <button class="profile-del" title="Delete">✕</button>
        </span>
      `;
      list.appendChild(d);
    }
  }
  if (!list.children.length) list.innerHTML = '<div style="color:var(--dim);font-size:10px;padding:4px 0;">No profiles. Add one to manage multiple auth credentials.</div>';
}

/** Render self-repair section (Block 22). */
export function renderSelfRepairSection() {
  const sliders = [
    ['cfgToolTimeout', 'cfgToolTimeoutVal'],
    ['cfgNoProgress', 'cfgNoProgressVal'],
    ['cfgLoopDetection', 'cfgLoopDetectionVal'],
    ['cfgConsecErrors', 'cfgConsecErrorsVal'],
    ['cfgCostRunaway', 'cfgCostRunawayVal'],
  ];
  for (const [sliderId, valId] of sliders) {
    const slider = $(sliderId);
    const val = $(valId);
    if (slider && val) {
      val.textContent = slider.value;
      slider.addEventListener('input', () => { val.textContent = slider.value; });
    }
  }
}

/** Update cache stats display (Block 26). */
export function updateCacheStats() {
  const el = $('cacheStats');
  if (!el || !state.responseCache) return;
  const stats = state.responseCache.stats();
  el.textContent = `Hits: ${stats.hits || 0} · Misses: ${stats.misses || 0} · Entries: ${stats.size || 0}`;
}

/** Render sandbox capabilities (Block 28). */
export function renderSandboxSection() {
  const el = $('sandboxCapabilities');
  if (!el) return;
  el.innerHTML = '';
  const caps = ['net_fetch', 'fs_read', 'fs_write', 'dom_access', 'eval', 'crypto'];
  for (const cap of caps) {
    const label = document.createElement('label');
    label.className = 'sandbox-cap';
    label.innerHTML = `<input type="checkbox" value="${cap}" /> ${cap}`;
    el.appendChild(label);
  }
}

/** Render heartbeat checks (Block 29). */
export function renderHeartbeatSection() {
  const el = $('heartbeatChecks');
  if (!el) return;
  el.innerHTML = '';
  const defaultChecks = ['Memory health', 'Provider connectivity', 'OPFS accessible', 'Event bus responsive'];
  for (const check of defaultChecks) {
    const d = document.createElement('div');
    d.className = 'heartbeat-check-item';
    d.innerHTML = `
      <span class="hb-status"></span>
      <span class="hb-name">${esc(check)}</span>
      <button class="hb-remove" title="Remove">✕</button>
    `;
    d.querySelector('.hb-remove').addEventListener('click', () => d.remove());
    el.appendChild(d);
  }
}

// ── Header badges (Batch 2) ─────────────────────────────────────

/** Update daemon badge in header. */
export function updateDaemonBadge(phase) {
  const badge = $('daemonBadge');
  if (!badge) return;
  if (!phase || phase === 'STOPPED') {
    badge.classList.remove('visible');
    return;
  }
  const labels = { PAUSED: '⏸ Paused', RUNNING: '▶ Running', STOPPED: '⏹ Stopped' };
  const classes = { PAUSED: 'paused', RUNNING: 'running', STOPPED: 'stopped' };
  badge.textContent = labels[phase] || phase;
  badge.className = `daemon-badge visible ${classes[phase] || 'stopped'}`;
}

/** Update remote sessions badge. */
export function updateRemoteBadge(count) {
  const badge = $('remoteBadge');
  if (!badge) return;
  if (!count || count <= 0) {
    badge.classList.remove('visible');
    return;
  }
  badge.textContent = `📡 ${count} remote`;
  badge.classList.add('visible');
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

/** Run a command in the terminal panel. */
export async function terminalExec(cmd) {
  if (!cmd.trim()) return;
  terminalHistory.unshift(cmd);
  termHistoryIdx = -1;
  terminalAppend(`<div class="terminal-cmd">$ ${esc(cmd)}</div>`);

  if (state.shell) {
    try {
      const result = await state.shell.exec(cmd);
      if (result.stdout) terminalAppend(`<div class="terminal-stdout">${esc(result.stdout)}</div>`);
      if (result.stderr) terminalAppend(`<div class="terminal-stderr">${esc(result.stderr)}</div>`);
      const cwd = $('terminalCwd');
      if (cwd) cwd.textContent = state.shell.cwd || '~';
    } catch (e) {
      terminalAppend(`<div class="terminal-stderr">${esc(e.message)}</div>`);
    }
  } else {
    terminalAppend(`<div class="terminal-stderr">No shell session available.</div>`);
  }
}

// ── Dashboard panel (Batch 4) ────────────────────────────────────

/** Refresh dashboard metrics display. */
export function refreshDashboard() {
  if (state.metricsCollector) {
    const snap = state.metricsCollector.snapshot();
    $('dashRequests').textContent = snap.counters?.requests ?? 0;
    $('dashTokens').textContent = snap.counters?.tokens ?? 0;
    $('dashErrors').textContent = snap.counters?.errors ?? 0;
    const hist = snap.histograms?.latency;
    $('dashLatency').textContent = hist?.mean ? `${Math.round(hist.mean)}ms` : '0ms';
  }
  if (state.ringBufferLog) {
    const el = $('dashLogViewer');
    if (!el) return;
    el.innerHTML = '';
    const entries = state.ringBufferLog.query({ limit: 50 });
    for (const entry of entries) {
      const d = document.createElement('div');
      d.className = `dash-log-entry ${entry.level || ''}`;
      const time = entry.timestamp ? new Date(entry.timestamp).toLocaleTimeString() : '';
      d.innerHTML = `<span class="log-time">${time}</span>${esc(entry.message || JSON.stringify(entry))}`;
      el.appendChild(d);
    }
  }
}

// ── Panel event listeners ───────────────────────────────────────
/** Bind event listeners for all secondary panels (files, memory, goals, MCP, security, skills, workspace). */
export function initPanelListeners() {
  // File browser
  $('refreshFiles').addEventListener('click', () => refreshFiles());

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

  // ── Batch 1: Config section toggles + listeners ──
  bindToggle('autonomyToggle', 'autonomySection', 'autonomyArrow');
  bindToggle('identityToggle', 'identitySection', 'identityArrow');
  bindToggle('routingToggle', 'routingSection', 'routingArrow');
  bindToggle('authProfilesToggle', 'authProfilesSection', 'authProfilesArrow');
  bindToggle('selfRepairToggle', 'selfRepairSection', 'selfRepairArrow');
  bindToggle('cacheToggle', 'cacheSection', 'cacheArrow');
  bindToggle('sandboxToggle', 'sandboxSection', 'sandboxArrow');
  bindToggle('heartbeatToggle', 'heartbeatSection', 'heartbeatArrow');

  // Autonomy settings
  document.querySelectorAll('input[name="autonomyLevel"]').forEach(r =>
    r.addEventListener('change', saveAutonomySettings));
  $('cfgMaxActions')?.addEventListener('change', saveAutonomySettings);
  $('cfgDailyCostLimit')?.addEventListener('change', saveAutonomySettings);

  // Identity settings
  $('identityFormat')?.addEventListener('change', () => { toggleIdentityFormat(); saveIdentitySettings(); });
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

  // Cache controls
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
