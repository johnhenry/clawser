// clawser-ui-panels.js — Secondary panel rendering: files, memory, goals, skills, MCP, security
import { $, esc, state, emit } from './clawser-state.js';
import { modal } from './clawser-modal.js';
import { addMsg, updateState, resetToolAndEventState } from './clawser-ui-chat.js';
import { loadWorkspaces, getActiveWorkspaceId, renameWorkspace, deleteWorkspace, createWorkspace, getWorkspaceName } from './clawser-workspaces.js';
import { navigate } from './clawser-router.js';
import { SkillStorage } from './clawser-skills.js';

// ── OPFS file browser ──────────────────────────────────────────
const HIDDEN_DIRS = new Set(['.checkpoints', '.skills', '.conversations']);

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
          } catch {}
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
      form.className = 'mem-edit-form';
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
        addMsg('error', 'Failed to delete memory.');
      }
    });

    el.appendChild(d);
  }
}

export function doMemorySearch() {
  if (!state.agent) return;
  const query = $('memQuery').value.trim();
  renderMemoryResults(state.agent.memoryRecall(query), $('memResults'));
}

// ── Goals ──────────────────────────────────────────────────────
export function renderGoals() {
  if (!state.agent) return;
  const agentState = state.agent.getState();
  const goals = agentState.goals || [];
  const el = $('goalList');
  el.innerHTML = '';
  for (const g of goals) {
    const d = document.createElement('div');
    d.className = 'goal-item';
    d.innerHTML = `<span class="goal-dot ${g.status}">●</span><span>${esc(g.description)}</span>`;
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
      localStorage.setItem(`clawser_tool_perms_${wsId}`, JSON.stringify(state.browserTools.getAllPermissions()));
      renderToolRegistry();
    });
    el.appendChild(d);
  }
}

// ── MCP servers ────────────────────────────────────────────────
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
        addMsg('error', `Export failed: ${err.message}`);
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
            deleteWorkspace(ws.id);
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
    localStorage.setItem(`clawser_security_${wsId}`, JSON.stringify({ domains: raw, maxFileSizeMB: maxMB }));
  }
}

// ── Panel event listeners ───────────────────────────────────────
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
    const visible = section.style.display !== 'none';
    section.style.display = visible ? 'none' : 'block';
    arrow.innerHTML = visible ? '&#x25B6;' : '&#x25BC;';
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
      addMsg('error', `MCP connection failed: ${e.message}`);
    }
  });

  // Security
  $('securityToggle').addEventListener('click', () => {
    const section = $('securitySection');
    const arrow = $('securityArrow');
    const visible = section.style.display !== 'none';
    section.style.display = visible ? 'none' : 'block';
    arrow.innerHTML = visible ? '&#x25B6;' : '&#x25BC;';
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

    localStorage.removeItem(`clawser_memories_${wsId}`);
    localStorage.removeItem(`clawser_config_${wsId}`);
    localStorage.removeItem(`clawser_conversations_${wsId}`);

    const root = await navigator.storage.getDirectory();
    try {
      const base = await root.getDirectoryHandle('clawser_workspaces');
      await base.removeEntry(wsId, { recursive: true });
    } catch {}
    try {
      const dir = await root.getDirectoryHandle('clawser_checkpoints');
      await dir.removeEntry(wsId, { recursive: true });
    } catch {}

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
    $('skillScopeSelect').style.display = 'block';
  });

  document.querySelectorAll('.skill-scope-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      if (!state.pendingImportBlob) return;
      const scope = btn.dataset.scope;
      const wsId = state.agent?.getWorkspace() || 'default';
      $('skillScopeSelect').style.display = 'none';

      try {
        const result = await state.skillRegistry.installFromZip(scope, wsId, state.pendingImportBlob);
        await state.skillRegistry.discover(wsId);
        renderSkills();
        renderToolRegistry();
        addMsg('system', `Skill "${result.name}" imported (${scope}).`);
      } catch (err) {
        addMsg('error', `Import failed: ${err.message}`);
      }
      state.pendingImportBlob = null;
    });
  });

  $('skillScopeCancel').addEventListener('click', () => {
    $('skillScopeSelect').style.display = 'none';
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
    const visible = wsDropdown.style.display !== 'none';
    wsDropdown.style.display = visible ? 'none' : 'block';
    if (!visible) renderWsDropdown();
  });

  document.addEventListener('click', () => { $('wsDropdown').style.display = 'none'; });
  $('wsDropdown').addEventListener('click', (e) => e.stopPropagation());

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
