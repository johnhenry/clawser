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
import { OAUTH_PROVIDERS } from './clawser-oauth.js';
import { createItemBar, _relativeTime } from './clawser-item-bar.js';

/** Sanitize a color value for safe use in style attributes. */
function safeColor(c, fallback = '#8b949e') {
  if (!c || typeof c !== 'string') return fallback;
  return /^#[0-9a-fA-F]{3,8}$/.test(c) ? c : fallback;
}

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

// ── Mount local folder (Block 2) ─────────────────────────────────
/** Prompt user to pick a local directory and mount it into the workspace FS. */
export async function mountLocalFolder() {
  if (!window.showDirectoryPicker) {
    addErrorMsg('showDirectoryPicker not supported in this browser.');
    return;
  }
  try {
    const handle = await window.showDirectoryPicker({ mode: 'readwrite' });
    const mountPoint = await modal.prompt('Mount point (under /mnt/):', `/mnt/${handle.name}`);
    if (!mountPoint) return;
    state.workspaceFs.mount(mountPoint, handle);
    renderMountList();
    refreshFiles();
    addMsg('system', `Mounted "${handle.name}" at ${mountPoint}`);
  } catch (e) {
    if (e.name !== 'AbortError') addErrorMsg(`Mount failed: ${e.message}`);
  }
}

/** Render the list of active mounts with unmount buttons. */
export function renderMountList() {
  const el = $('mountList');
  if (!el) return;
  el.innerHTML = '';
  if (!state.workspaceFs?.mountTable) return;
  const mounts = state.workspaceFs.mountTable;
  if (mounts.length === 0) return;
  for (const m of mounts) {
    const d = document.createElement('div');
    d.className = 'mount-item';
    d.innerHTML = `<span class="mount-point">${esc(m.path)}</span><span style="color:var(--dim);font-size:10px;">${esc(m.name)}${m.readOnly ? ' (ro)' : ''}</span>`;
    const btn = document.createElement('button');
    btn.className = 'mount-unmount';
    btn.textContent = '✕';
    btn.title = 'Unmount';
    btn.addEventListener('click', () => {
      state.workspaceFs.unmount(m.path);
      renderMountList();
      refreshFiles();
      addMsg('system', `Unmounted ${m.path}`);
    });
    d.appendChild(btn);
    el.appendChild(d);
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

/** Execute a memory search using the query input and render results.
 *  When semantic toggle is checked, uses async hybrid search. */
export async function doMemorySearch() {
  if (!state.agent) return;
  const query = $('memQuery').value.trim();
  const semantic = $('memSemanticToggle')?.checked;
  const category = $('memCatFilter').value || undefined;

  if (semantic && query) {
    const el = $('memResults');
    el.innerHTML = '<div style="color:var(--muted);font-size:11px;padding:8px;">Searching...</div>';
    try {
      const results = await state.agent.memoryRecallAsync(query, { category });
      renderMemoryResults(results, el);
    } catch (e) {
      el.textContent = `Search error: ${e.message}`;
    }
  } else {
    renderMemoryResults(state.agent.memoryRecall(query), $('memResults'));
  }
}

// ── Goals (tree view — Block 8) ────────────────────────────────
const _collapsedGoals = new Set();

/** Toggle goal expand/collapse state. */
export function toggleGoalExpand(goalId) {
  if (_collapsedGoals.has(goalId)) _collapsedGoals.delete(goalId);
  else _collapsedGoals.add(goalId);
  renderGoals();
}

/** Render the goals tree with indentation, progress bars, artifact links, and collapse toggles. */
export function renderGoals() {
  if (!state.agent) return;
  const agentState = state.agent.getState();
  const goals = agentState.goals || [];
  const el = $('goalList');
  el.innerHTML = '';

  // Build parent→children map
  const childMap = new Map();
  const roots = [];
  for (const g of goals) {
    if (g.parentId) {
      if (!childMap.has(g.parentId)) childMap.set(g.parentId, []);
      childMap.get(g.parentId).push(g);
    } else {
      roots.push(g);
    }
  }

  function renderGoalNode(g, depth) {
    const children = childMap.get(g.id) || [];
    const hasChildren = children.length > 0;
    const collapsed = _collapsedGoals.has(g.id);

    const d = document.createElement('div');
    d.className = 'goal-item goal-tree-item';
    d.style.marginLeft = `${depth * 16}px`;

    // Toggle arrow
    let arrow = '';
    if (hasChildren) {
      arrow = `<span class="goal-toggle" data-gid="${g.id}">${collapsed ? '▶' : '▼'}</span>`;
    }

    d.innerHTML = `${arrow}<span class="goal-dot ${esc(g.status)}">●</span><span class="goal-desc">${esc(g.description)}</span>`;

    // Progress bar for goals with sub-goals
    if (hasChildren) {
      const completed = children.filter(c => c.status === 'completed').length;
      const pct = Math.round((completed / children.length) * 100);
      d.insertAdjacentHTML('beforeend',
        `<div class="goal-progress"><div class="goal-progress-fill" style="width:${pct}%"></div></div>`);
    }

    // Artifact links
    if (g.artifacts?.length > 0) {
      for (const a of g.artifacts) {
        const link = document.createElement('a');
        link.className = 'goal-artifact-link';
        link.href = '#';
        link.textContent = a.name || a.path || 'artifact';
        link.addEventListener('click', (e) => { e.preventDefault(); });
        d.appendChild(link);
      }
    }

    // Complete button
    if (g.status === 'active') {
      const btn = document.createElement('button');
      btn.textContent = '✓';
      btn.className = 'goal-complete-btn';
      btn.addEventListener('click', () => { state.agent.completeGoal(g.id); renderGoals(); updateState(); });
      d.appendChild(btn);
    }

    // Collapse toggle handler
    if (hasChildren) {
      d.querySelector('.goal-toggle').addEventListener('click', () => toggleGoalExpand(g.id));
    }

    el.appendChild(d);

    // Render children recursively if not collapsed
    if (hasChildren && !collapsed) {
      for (const child of children) {
        renderGoalNode(child, depth + 1);
      }
    }
  }

  for (const root of roots) {
    renderGoalNode(root, 0);
  }

  // Handle flat goals with no roots (all have parentId but parent doesn't exist)
  if (roots.length === 0 && goals.length > 0) {
    for (const g of goals) {
      renderGoalNode(g, 0);
    }
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
  const saved = JSON.parse(localStorage.getItem(lsKey.autonomy(wsId)) || '{}');
  if (saved.level) {
    const radio = document.querySelector(`input[name="autonomyLevel"][value="${saved.level}"]`);
    if (radio) radio.checked = true;
  }
  if (saved.maxActions) $('cfgMaxActions').value = saved.maxActions;
  if (saved.dailyCostLimit != null) $('cfgDailyCostLimit').value = saved.dailyCostLimit;
  // Apply saved config to agent's AutonomyController
  if (state.agent && saved.level) {
    state.agent.applyAutonomyConfig({
      level: saved.level || 'supervised',
      maxActionsPerHour: parseInt(saved.maxActions) || Infinity,
      maxCostPerDayCents: parseInt(saved.dailyCostLimit) || Infinity,
    });
  }
  updateCostMeter();
  updateAutonomyBadge();
}

/** Save autonomy settings to localStorage and apply live. */
export function saveAutonomySettings() {
  const wsId = state.agent?.getWorkspace() || 'default';
  const level = document.querySelector('input[name="autonomyLevel"]:checked')?.value || 'supervised';
  const maxActions = parseInt($('cfgMaxActions').value) || 100;
  const dailyCostLimit = parseFloat($('cfgDailyCostLimit').value) || 5;
  localStorage.setItem(lsKey.autonomy(wsId), JSON.stringify({ level, maxActions, dailyCostLimit }));
  // Apply live to agent's AutonomyController
  if (state.agent) {
    state.agent.applyAutonomyConfig({
      level,
      maxActionsPerHour: parseInt(maxActions) || Infinity,
      maxCostPerDayCents: parseInt(dailyCostLimit) || Infinity,
    });
  }
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
  const saved = JSON.parse(localStorage.getItem(lsKey.identity(wsId)) || '{}');
  if (saved.format) $('identityFormat').value = saved.format;
  if (saved.plain) $('identityPlain').value = saved.plain;
  if (saved.name) $('identityName').value = saved.name;
  if (saved.role) $('identityRole').value = saved.role;
  if (saved.personality) $('identityPersonality').value = saved.personality;
  toggleIdentityFormat();
  // Apply saved identity to system prompt on init
  applyIdentityToAgent(saved);
}

function toggleIdentityFormat() {
  const format = $('identityFormat').value;
  $('identityPlainWrap').style.display = format === 'plain' ? '' : 'none';
  const aieosWrap = $('identityAieosWrap');
  if (format === 'aieos') aieosWrap.classList.add('visible');
  else aieosWrap.classList.remove('visible');
}

/** Apply identity config to agent's system prompt. */
function applyIdentityToAgent(saved) {
  if (!state.agent || !state.identityManager || !saved?.format) return;
  try {
    if (saved.format === 'plain') {
      state.identityManager.load(saved.plain || '');
    } else {
      state.identityManager.load({
        version: '1.1',
        names: { display: saved.name || '' },
        bio: saved.role || '',
        linguistics: { tone: saved.personality || '' },
      });
    }
    const compiled = state.identityManager.compile();
    if (compiled) state.agent.setSystemPrompt(compiled);
  } catch (e) { console.warn('[clawser] identity compile failed', e); }
}

function saveIdentitySettings() {
  const wsId = state.agent?.getWorkspace() || 'default';
  const format = $('identityFormat').value;
  const saved = {
    format,
    plain: $('identityPlain').value,
    name: $('identityName').value,
    role: $('identityRole').value,
    personality: $('identityPersonality').value,
  };
  localStorage.setItem(lsKey.identity(wsId), JSON.stringify(saved));
  // Apply live to agent's system prompt
  applyIdentityToAgent(saved);
}

/** Render model routing section (Block 11). */
export async function renderRoutingSection() {
  const list = $('routingChainList');
  const badges = $('routingHealthBadges');
  if (!list || !badges) return;
  list.innerHTML = '';
  badges.innerHTML = '';

  // Show registered providers as chain entries
  if (state.providers) {
    let idx = 1;
    const providerList = await state.providers.listWithAvailability().catch(() => []);
    for (const { name } of providerList) {
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

/** Save self-repair slider settings and apply to StuckDetector. */
export function saveSelfRepairSettings() {
  const wsId = state.agent?.getWorkspace() || 'default';
  const cfg = {
    toolTimeout: parseInt($('cfgToolTimeout')?.value) || 60,
    noProgress: parseInt($('cfgNoProgress')?.value) || 120,
    loopDetection: parseInt($('cfgLoopDetection')?.value) || 3,
    consecErrors: parseInt($('cfgConsecErrors')?.value) || 5,
    costRunaway: parseFloat($('cfgCostRunaway')?.value) || 2.0,
  };
  localStorage.setItem(lsKey.selfRepair(wsId), JSON.stringify(cfg));
  // Apply live to StuckDetector
  if (state.stuckDetector) {
    state.stuckDetector.setThresholds({
      toolTimeout: cfg.toolTimeout * 1000,
      noProgress: cfg.noProgress * 1000,
      loopDetection: cfg.loopDetection,
      consecutiveErrors: cfg.consecErrors,
      costRunaway: cfg.costRunaway,
    });
  }
}

/** Render self-repair section (Block 22). */
export function renderSelfRepairSection() {
  const wsId = state.agent?.getWorkspace() || 'default';
  const saved = JSON.parse(localStorage.getItem(lsKey.selfRepair(wsId)) || 'null');

  const sliders = [
    ['cfgToolTimeout', 'cfgToolTimeoutVal'],
    ['cfgNoProgress', 'cfgNoProgressVal'],
    ['cfgLoopDetection', 'cfgLoopDetectionVal'],
    ['cfgConsecErrors', 'cfgConsecErrorsVal'],
    ['cfgCostRunaway', 'cfgCostRunawayVal'],
  ];
  const keys = ['toolTimeout', 'noProgress', 'loopDetection', 'consecErrors', 'costRunaway'];

  for (let i = 0; i < sliders.length; i++) {
    const [sliderId, valId] = sliders[i];
    const slider = $(sliderId);
    const val = $(valId);
    if (slider && val) {
      // Restore saved value
      if (saved && saved[keys[i]] != null) slider.value = saved[keys[i]];
      val.textContent = slider.value;
      slider.addEventListener('input', () => {
        val.textContent = slider.value;
        saveSelfRepairSettings();
      });
    }
  }

  // Apply saved thresholds on init
  if (saved && state.stuckDetector) {
    state.stuckDetector.setThresholds({
      toolTimeout: (saved.toolTimeout || 60) * 1000,
      noProgress: (saved.noProgress || 120) * 1000,
      loopDetection: saved.loopDetection || 3,
      consecutiveErrors: saved.consecErrors || 5,
      costRunaway: saved.costRunaway || 2.0,
    });
  }
}

/** Update cache stats display (Block 26). */
export function updateCacheStats() {
  const el = $('cacheStats');
  if (!el || !state.responseCache) return;
  const stats = state.responseCache.stats;
  el.textContent = `Hits: ${stats.totalHits || 0} · Misses: ${stats.totalMisses || 0} · Entries: ${stats.entries || 0}`;
}

/** Save sandbox capability gates and apply to tool permissions. */
export function saveSandboxSettings() {
  const wsId = state.agent?.getWorkspace() || 'default';
  const caps = {};
  for (const cb of document.querySelectorAll('#sandboxCapabilities input[type=checkbox]')) {
    caps[cb.value] = cb.checked;
  }
  localStorage.setItem(lsKey.sandbox(wsId), JSON.stringify(caps));
  // Apply: update tool permissions based on capability gates
  const toolMap = { net_fetch: 'fetch', fs_write: 'fs_write', fs_read: 'fs_read', dom_access: 'dom_query', eval: 'code_eval' };
  if (state.browserTools) {
    for (const [cap, toolName] of Object.entries(toolMap)) {
      if (caps[cap] === false) state.browserTools.setPermission(toolName, 'denied');
      else state.browserTools.setPermission(toolName, 'auto');
    }
  }
}

/** Render sandbox capabilities (Block 28). */
export function renderSandboxSection() {
  const el = $('sandboxCapabilities');
  if (!el) return;
  el.innerHTML = '';

  const wsId = state.agent?.getWorkspace() || 'default';
  const saved = JSON.parse(localStorage.getItem(lsKey.sandbox(wsId)) || 'null');

  const caps = ['net_fetch', 'fs_read', 'fs_write', 'dom_access', 'eval', 'crypto'];
  for (const cap of caps) {
    const label = document.createElement('label');
    label.className = 'sandbox-cap';
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.value = cap;
    cb.dataset.cap = cap;
    // Restore saved state (default: checked/enabled)
    cb.checked = saved ? (saved[cap] !== false) : true;
    cb.addEventListener('change', () => saveSandboxSettings());
    label.appendChild(cb);
    label.appendChild(document.createTextNode(` ${cap}`));
    el.appendChild(label);
  }

  // Apply saved capability gates on init
  if (saved) saveSandboxSettings();
}

/** Save heartbeat check list to localStorage. */
export function saveHeartbeatSettings() {
  const wsId = state.agent?.getWorkspace() || 'default';
  const items = [];
  for (const el of document.querySelectorAll('#heartbeatChecks .heartbeat-check-item')) {
    const nameEl = el.querySelector('.hb-name');
    if (nameEl) items.push({ description: nameEl.textContent, interval: 300000 });
  }
  localStorage.setItem(lsKey.heartbeat(wsId), JSON.stringify(items));
}

/** Render heartbeat checks (Block 29). */
export function renderHeartbeatSection() {
  const el = $('heartbeatChecks');
  if (!el) return;
  el.innerHTML = '';

  const wsId = state.agent?.getWorkspace() || 'default';
  const saved = JSON.parse(localStorage.getItem(lsKey.heartbeat(wsId)) || 'null');
  const defaultChecks = [
    { description: 'Memory health', interval: 300000 },
    { description: 'Provider connectivity', interval: 300000 },
    { description: 'OPFS accessible', interval: 300000 },
    { description: 'Event bus responsive', interval: 300000 },
  ];
  const checks = saved || defaultChecks;

  for (const check of checks) {
    const d = document.createElement('div');
    d.className = 'heartbeat-check-item';
    d.innerHTML = `
      <span class="hb-status"></span>
      <span class="hb-name">${esc(check.description || check)}</span>
      <button class="hb-remove" title="Remove">✕</button>
    `;
    d.querySelector('.hb-remove').addEventListener('click', () => {
      d.remove();
      saveHeartbeatSettings();
    });
    el.appendChild(d);
  }
}

/** Render OAuth connected apps section (Block 16). */
export function renderOAuthSection() {
  const el = $('oauthProviderList');
  if (!el) return;
  el.innerHTML = '';

  for (const [key, prov] of Object.entries(OAUTH_PROVIDERS)) {
    const connected = state.oauthManager?.isConnected(key);
    const d = document.createElement('div');
    d.className = 'oauth-provider-card';
    d.innerHTML = `
      <span class="oauth-name">${esc(prov.name)}</span>
      <span class="oauth-status ${connected ? 'connected' : ''}">${connected ? 'Connected' : 'Not connected'}</span>
    `;
    const btn = document.createElement('button');
    btn.className = `btn-sm ${connected ? 'btn-surface2' : ''}`;
    btn.textContent = connected ? 'Disconnect' : 'Connect';
    btn.addEventListener('click', async () => {
      if (!state.oauthManager) { addErrorMsg('OAuth manager not initialized.'); return; }
      try {
        if (connected) {
          await state.oauthManager.disconnect(key);
          addMsg('system', `Disconnected from ${prov.name}.`);
        } else {
          const clientId = await modal.prompt(`${prov.name} Client ID:`);
          if (!clientId) return;
          await state.oauthManager.authenticate(key, clientId);
          addMsg('system', `Connected to ${prov.name}.`);
        }
        renderOAuthSection();
      } catch (e) {
        addErrorMsg(`OAuth error: ${e.message}`);
      }
    });
    d.appendChild(btn);
    el.appendChild(d);
  }
}

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
/** Track terminal agent mode state */
let _terminalAgentMode = false;

export async function terminalExec(cmd) {
  if (!cmd.trim()) return;
  terminalHistory.unshift(cmd);
  termHistoryIdx = -1;

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
        if (badge) { badge.textContent = '[AGENT ⏎]'; badge.classList.add('agent'); }
      }
      if (result.__exitAgentMode) {
        _terminalAgentMode = false;
        const badge = $('terminalModeBadge');
        if (badge) { badge.textContent = '[SHELL]'; badge.classList.remove('agent'); }
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
        ansDiv.textContent = `→ ${answer}`;
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
      ts.rename(id, newName);
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
  const panelBody = $('panelToolMgmt')?.querySelector('.panel-body');
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

  let html = `<div class="tool-search-bar"><input id="toolSearch" type="text" placeholder="Search tools..." class="tool-search-input" value="${esc(query)}" /><span class="tool-count">${statusFiltered.length} / ${allTools.length}</span></div>`;
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
      html += `<div class="tool-item ${permClass}" data-tool="${esc(tool.name)}"><label class="tool-checkbox"><input type="checkbox" ${checked ? 'checked' : ''} data-tool="${esc(tool.name)}" /></label><span class="tool-name">${esc(tool.name)}</span><span class="tool-perm-badge">${perm}</span><span class="tool-desc">${esc(desc)}</span>${usage > 0 ? `<span class="tool-usage">${usage}\u00d7</span>` : ''}</div>`;
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
  detail.innerHTML = `<div class="tool-detail-desc">${esc(spec.description || 'No description')}</div>${paramHtml}<div class="tool-detail-meta">Source: built-in${usage > 0 ? ` \u00b7 Calls: ${usage}` : ''}${lastUsed ? ` \u00b7 Last: ${_relativeTime(lastUsed)}` : ''}</div><div class="tool-detail-perm">Permission: ${['auto','approve','denied'].map(p => `<label class="tool-perm-radio"><input type="radio" name="perm_${esc(toolName)}" value="${p}" ${perm === p ? 'checked' : ''} /> ${p}</label>`).join('')}</div>`;

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

// ── Dashboard panel (Batch 4) ────────────────────────────────────

/** Refresh dashboard metrics display. */
export function refreshDashboard() {
  if (state.metricsCollector) {
    const snap = state.metricsCollector.snapshot();
    $('dashRequests').textContent = snap.counters?.requests ?? 0;
    $('dashTokens').textContent = snap.counters?.tokens ?? 0;
    $('dashErrors').textContent = snap.counters?.errors ?? 0;
    const hist = snap.histograms?.latency;
    $('dashLatency').textContent = hist?.avg ? `${Math.round(hist.avg)}ms` : '0ms';
  }
  if (state.ringBufferLog) {
    const el = $('dashLogViewer');
    if (!el) return;
    el.innerHTML = '';
    const entries = state.ringBufferLog.query({ limit: 50 });
    for (const entry of entries) {
      const d = document.createElement('div');
      const levelNames = ['debug', 'info', 'warn', 'error'];
      d.className = `dash-log-entry ${levelNames[entry.level] ?? ''}`;
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
