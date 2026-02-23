// clawser-app.js — Orchestrator: init, workspace switching, routing, home view
import { $, esc, state, on, emit } from './clawser-state.js';
import { modal } from './clawser-modal.js';
import { loadWorkspaces, setActiveWorkspaceId, ensureDefaultWorkspace, createWorkspace, renameWorkspace, deleteWorkspace, getWorkspaceName, touchWorkspace } from './clawser-workspaces.js';
import { loadConversations } from './clawser-conversations.js';
import { SERVICES, loadAccounts, createAccount, deleteAccount, saveConfig, applyRestoredConfig, rebuildProviderDropdown, setupProviders, initAccountListeners } from './clawser-accounts.js';
import { parseHash, navigate, showView, updateRouteHash, activatePanel, initRouterListeners } from './clawser-router.js';
import { setStatus, addMsg, addToolCall, addInlineToolCall, updateInlineToolCall, addEvent, updateState, updateCostDisplay, replaySessionHistory, replayFromEvents, updateConvNameDisplay, persistActiveConversation, switchConversation, initChatListeners, renderToolCalls, resetChatUI } from './clawser-ui-chat.js';
import { refreshFiles, renderGoals, renderToolRegistry, renderSkills, applySecuritySettings, initPanelListeners } from './clawser-ui-panels.js';
import { initCmdPaletteListeners } from './clawser-cmd-palette.js';

import { ClawserAgent } from './clawser-agent.js';
import { createDefaultRegistry, WorkspaceFs, registerAgentTools } from './clawser-tools.js';
import { createDefaultProviders } from './clawser-providers.js';
import { McpManager } from './clawser-mcp.js';
import { SkillRegistry, SkillStorage, ActivateSkillTool, DeactivateSkillTool } from './clawser-skills.js';

// ── Create service singletons ───────────────────────────────────
state.workspaceFs = new WorkspaceFs();
state.browserTools = createDefaultRegistry(state.workspaceFs);
state.providers = createDefaultProviders();
state.mcpManager = new McpManager({
  onLog: (level, msg) => console.log(`[mcp] ${msg}`),
});

// ── Skills ──────────────────────────────────────────────────────
state.skillRegistry = new SkillRegistry({
  browserTools: state.browserTools,
  onLog: (level, msg) => console.log(`[skills] ${msg}`),
  onActivationChange: (name, active, toolNames) => {
    if (active) {
      state.activeSkillPrompts.set(name, state.skillRegistry.buildActivationPrompt(name));
      if (state.agent && toolNames?.length > 0) {
        for (const tn of toolNames) {
          const spec = state.browserTools.allSpecs().find(s => s.name === tn);
          if (spec) state.agent.registerToolSpec(spec);
        }
      }
    } else {
      state.activeSkillPrompts.delete(name);
      if (state.agent && toolNames?.length > 0) {
        for (const tn of toolNames) {
          state.agent.unregisterToolSpec(tn);
        }
      }
    }
  },
});

// ── Cross-module event bus ──────────────────────────────────────
on('refreshFiles', () => refreshFiles());
on('renderGoals', () => renderGoals());
on('renderSkills', () => renderSkills());
on('saveConfig', () => saveConfig());

// ── Switch workspace ────────────────────────────────────────────
async function switchWorkspace(newId, convId) {
  if (!state.agent) return;
  $('wsDropdown').style.display = 'none';
  setStatus('busy', 'switching workspace...');
  history.replaceState(null, '', '#workspace/' + newId);

  // Save current workspace
  await persistActiveConversation();
  state.agent.persistMemories();
  await state.agent.persistCheckpoint();
  saveConfig();

  // Reset agent state
  state.agent.reinit({});
  state.agent.setWorkspace(newId);
  setActiveWorkspaceId(newId);
  touchWorkspace(newId);

  // Clear UI
  resetChatUI();
  $('memResults').innerHTML = '';
  $('goalList').innerHTML = '';

  // Clear skills state
  state.activeSkillPrompts.clear();
  for (const name of [...state.skillRegistry.activeSkills.keys()]) {
    state.skillRegistry.deactivate(name);
  }

  state.sessionCost = 0;
  updateCostDisplay();

  state.activeConversationId = null;
  state.activeConversationName = null;
  updateConvNameDisplay();

  // Restore new workspace state
  const savedConfig = state.agent.restoreConfig();
  const memCount = state.agent.restoreMemories();

  state.agent.setSystemPrompt($('systemPrompt').value);

  await rebuildProviderDropdown();
  await applyRestoredConfig(savedConfig);

  // Restore conversation state
  let wsRestored = false;
  const targetConvId = convId || savedConfig?.activeConversationId;
  if (targetConvId) {
    state.activeConversationId = targetConvId;
    if (convId) {
      const convList = loadConversations(newId);
      const conv = convList.find(c => c.id === convId);
      state.activeConversationName = conv?.name || null;
    } else {
      state.activeConversationName = savedConfig?.activeConversationName || null;
    }
    updateConvNameDisplay();

    const convData = await state.agent.restoreConversation(state.activeConversationId);
    if (convData) {
      const evts = state.agent.getEventLog().events;
      if (evts.length > 0) {
        replayFromEvents(evts);
        wsRestored = true;
      }
    }
  }

  // Fallback: checkpoint
  if (!wsRestored) {
    const restoredCheckpoint = await state.agent.restoreCheckpoint();
    if (restoredCheckpoint) {
      state.toolCallLog = [];
      const checkpoint = state.agent.getCheckpointJSON();
      if (checkpoint?.session_history) {
        replaySessionHistory(checkpoint.session_history);
        renderToolCalls();
      }
      wsRestored = true;
    }
  }

  // Update header
  const providerSelect = $('providerSelect');
  const wsName = getWorkspaceName(newId);
  $('workspaceName').textContent = wsName;
  $('providerLabel').textContent = providerSelect.options[providerSelect.selectedIndex]?.textContent || providerSelect.value;

  renderToolRegistry();
  updateState();
  renderGoals();
  refreshFiles();

  await state.skillRegistry.discover(newId);
  renderSkills();

  const parts = [`Switched to "${wsName}".`];
  if (wsRestored) parts.push(`Session restored (${$('messages').querySelectorAll('.msg.user, .msg.agent').length} messages).`);
  if (memCount > 0) parts.push(`${memCount} memories loaded.`);
  if (state.skillRegistry.skills.size > 0) parts.push(`${state.skillRegistry.skills.size} skills available.`);
  addMsg('system', parts.join(' '));

  setStatus('ready', 'ready');
  $('userInput').disabled = false;
  $('sendBtn').disabled = false;
  $('cmdPaletteBtn').disabled = false;
  $('userInput').focus();
  updateRouteHash();
}

// ── Init workspace ──────────────────────────────────────────────
async function initWorkspace(wsId, convId) {
  if (state._updateInterval) clearInterval(state._updateInterval);
  setStatus('busy', 'initializing...');

  try {
    ensureDefaultWorkspace();
    const activeWsId = wsId;
    const wsName = getWorkspaceName(activeWsId);
    $('workspaceName').textContent = wsName;

    state.agent = await ClawserAgent.create({
      browserTools: state.browserTools,
      workspaceFs: state.workspaceFs,
      providers: state.providers,
      mcpManager: state.mcpManager,
      onEvent: (topic, payload) => addEvent(topic, payload),
      onLog: (level, msg) => {
        const methods = ['debug','debug','info','warn','error'];
        console[methods[level] || 'log'](`[clawser] ${msg}`);
      },
      onToolCall: (name, params, result) => {
        addToolCall(name, params, result);
        if (result === null) {
          const el = addInlineToolCall(name, params, null);
          state.pendingInlineTools.set(name + '_' + Date.now(), el);
        } else {
          let found = false;
          for (const [key, el] of state.pendingInlineTools) {
            if (key.startsWith(name + '_')) {
              updateInlineToolCall(el, name, params, result);
              state.pendingInlineTools.delete(key);
              found = true;
              break;
            }
          }
          if (!found) {
            addInlineToolCall(name, params, result);
          }
        }
      },
    });

    addMsg('system', 'Initializing agent...');
    const rc = state.agent.init({});
    if (rc !== 0) throw new Error(`agent.init returned ${rc}`);

    registerAgentTools(state.browserTools, state.agent);

    state.browserTools.register(new ActivateSkillTool(state.skillRegistry, () => {
      renderSkills();
    }));
    state.browserTools.register(new DeactivateSkillTool(state.skillRegistry, () => {
      renderSkills();
    }));

    state.agent.refreshToolSpecs();

    state.browserTools.setApprovalHandler(async (toolName, params) => {
      return await modal.confirm(`Allow tool "${toolName}" to execute?\n\nParams: ${JSON.stringify(params).slice(0, 200)}`);
    });

    try {
      const savedPerms = JSON.parse(localStorage.getItem(`clawser_tool_perms_${activeWsId}`) || '{}');
      state.browserTools.loadPermissions(savedPerms);
    } catch {}

    try {
      const sec = JSON.parse(localStorage.getItem(`clawser_security_${activeWsId}`) || '{}');
      if (sec.domains) $('cfgDomainAllowlist').value = sec.domains;
      if (sec.maxFileSizeMB) $('cfgMaxFileSize').value = sec.maxFileSizeMB;
      applySecuritySettings();
    } catch {}

    state.agent.setWorkspace(activeWsId);
    touchWorkspace(activeWsId);

    const savedConfig = state.agent.restoreConfig();
    const memCount = state.agent.restoreMemories();

    state.agent.memoryHygiene();

    state.agent.setSystemPrompt($('systemPrompt').value);
    await setupProviders();

    await applyRestoredConfig(savedConfig);

    // Restore conversation state
    let restored = false;
    const targetConvId = convId || savedConfig?.activeConversationId;
    if (targetConvId) {
      state.activeConversationId = targetConvId;
      if (convId) {
        const convList = loadConversations(activeWsId);
        const conv = convList.find(c => c.id === convId);
        state.activeConversationName = conv?.name || null;
      } else {
        state.activeConversationName = savedConfig?.activeConversationName || null;
      }
      updateConvNameDisplay();

      const convData = await state.agent.restoreConversation(state.activeConversationId);
      if (convData) {
        const evts = state.agent.getEventLog().events;
        if (evts.length > 0) {
          replayFromEvents(evts);
          restored = true;
        }
      }
    }

    // Fallback: checkpoint
    if (!restored) {
      const restoredCheckpoint = await state.agent.restoreCheckpoint();
      if (restoredCheckpoint) {
        const checkpoint = state.agent.getCheckpointJSON();
        if (checkpoint?.session_history) {
          $('messages').innerHTML = '';
          state.toolCallLog = [];
          replaySessionHistory(checkpoint.session_history);
          renderToolCalls();
        }
        restored = true;
      }
    }
    const providerSelect = $('providerSelect');
    $('providerLabel').textContent = providerSelect.options[providerSelect.selectedIndex]?.textContent || providerSelect.value;

    renderToolRegistry();
    updateState();
    renderGoals();
    refreshFiles();

    await state.skillRegistry.discover(activeWsId);
    renderSkills();

    const toolCount = state.browserTools.names().length;

    const parts = [`Agent ready — ${toolCount} browser tools, workspace "${wsName}".`];
    if (restored) parts.push(`Session restored (${$('messages').querySelectorAll('.msg.user, .msg.agent').length} messages).`);
    if (memCount > 0) parts.push(`${memCount} memories loaded.`);
    if (state.skillRegistry.skills.size > 0) parts.push(`${state.skillRegistry.skills.size} skills available.`);

    const providerName = providerSelect.options[providerSelect.selectedIndex]?.textContent || providerSelect.value;
    parts.push(`Provider: ${providerName}.`);

    if (providerSelect.value === 'echo') {
      parts.push('Tip: Select a provider in Settings (gear icon) to enable intelligent responses.');
    }

    addMsg('system', parts.join(' '));
    setStatus('ready', 'ready');

    $('userInput').disabled = false;
    $('sendBtn').disabled = false;
    $('cmdPaletteBtn').disabled = false;
    $('userInput').focus();

    state.agentInitialized = true;
    setActiveWorkspaceId(activeWsId);
    updateRouteHash();

    state._updateInterval = setInterval(() => updateState(), 5000);
  } catch (e) {
    addMsg('error', `Init failed: ${e.message}`);
    setStatus('error', 'init failed');
    console.error(e);
  }
}

// ── Route handler ───────────────────────────────────────────────
async function handleRoute() {
  if (state.switchingViaRouter) return;
  const parsed = parseHash();

  if (parsed.route === 'home') {
    if (state.currentRoute === 'workspace' && state.agent && state.agentInitialized) {
      await persistActiveConversation();
      state.agent.persistMemories();
      await state.agent.persistCheckpoint();
      saveConfig();
    }
    state.currentRoute = 'home';
    showView('viewHome');
    ensureDefaultWorkspace();
    renderHomeWorkspaceList();
    renderHomeAccountList();
    return;
  }

  if (parsed.route === 'workspace') {
    ensureDefaultWorkspace();
    const list = loadWorkspaces();
    if (!list.find(w => w.id === parsed.wsId)) {
      navigate('home');
      return;
    }

    showView('viewWorkspace');
    state.currentRoute = 'workspace';

    state.switchingViaRouter = true;
    try {
      if (!state.agentInitialized) {
        await initWorkspace(parsed.wsId, parsed.convId);
      } else {
        const currentWsId = state.agent.getWorkspace();
        if (currentWsId !== parsed.wsId) {
          await switchWorkspace(parsed.wsId, parsed.convId);
        } else if (parsed.convId && parsed.convId !== state.activeConversationId) {
          await switchConversation(parsed.convId);
        }
      }
    } finally {
      state.switchingViaRouter = false;
    }

    activatePanel(parsed.panel || 'chat');
  }
}

window.addEventListener('hashchange', () => handleRoute());

// ── Home view rendering ─────────────────────────────────────────
function renderHomeWorkspaceList() {
  const list = loadWorkspaces();
  const el = $('homeWsList');
  el.innerHTML = '';
  for (const ws of list) {
    const card = document.createElement('div');
    card.className = 'ws-card';
    const convs = loadConversations(ws.id);
    const lastUsed = ws.lastUsed ? new Date(ws.lastUsed).toLocaleDateString() : 'never';
    card.innerHTML = `
      <span class="ws-card-name">${esc(ws.name)}</span>
      <span class="ws-card-meta">${convs.length} conversations · ${lastUsed}</span>
      <span class="ws-card-actions">
        <button class="ws-rename" title="Rename">&#x270E;</button>
        ${ws.id !== 'default' ? '<button class="ws-delete danger" title="Delete">&#x2715;</button>' : ''}
      </span>
    `;
    card.querySelector('.ws-rename').addEventListener('click', async (e) => {
      e.stopPropagation();
      const newName = await modal.prompt('Rename workspace:', ws.name);
      if (newName?.trim()) { renameWorkspace(ws.id, newName.trim()); renderHomeWorkspaceList(); }
    });
    const delBtn = card.querySelector('.ws-delete');
    if (delBtn) {
      delBtn.addEventListener('click', async (e) => {
        e.stopPropagation();
        if (await modal.confirm(`Delete workspace "${ws.name}"?`, { danger: true })) {
          deleteWorkspace(ws.id);
          renderHomeWorkspaceList();
        }
      });
    }
    card.addEventListener('click', (e) => {
      if (e.target.closest('.ws-card-actions')) return;
      navigate('workspace', ws.id);
    });
    el.appendChild(card);
  }
  if (list.length === 0) {
    el.innerHTML = '<div style="color:var(--muted);font-size:12px;">No workspaces yet.</div>';
  }
}

function renderHomeAccountList() {
  const list = loadAccounts();
  const el = $('homeAcctList');
  el.innerHTML = '';
  for (const acct of list) {
    const d = document.createElement('div');
    d.className = 'acct-item';
    const svcName = SERVICES[acct.service]?.name || acct.service;
    d.innerHTML = `
      <span class="acct-name">${esc(acct.name)}</span>
      <span class="acct-detail">${esc(svcName)} · ${esc(acct.model)}</span>
      <span class="acct-actions">
        <button class="acct-del" title="Delete">&#x2715;</button>
      </span>
    `;
    d.querySelector('.acct-del').addEventListener('click', async () => {
      if (!await modal.confirm(`Delete account "${acct.name}"?`, { danger: true })) return;
      deleteAccount(acct.id);
      renderHomeAccountList();
    });
    el.appendChild(d);
  }
}

// ── Home view event listeners ───────────────────────────────────
function initHomeListeners() {
  $('homeWsCreate').addEventListener('click', () => {
    const name = $('homeWsNewName').value.trim();
    if (!name) return;
    const id = createWorkspace(name);
    $('homeWsNewName').value = '';
    navigate('workspace', id);
  });

  $('homeWsNewName').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') $('homeWsCreate').click();
  });

  $('homeAcctAddToggle').addEventListener('click', () => {
    const form = $('homeAcctAddForm');
    form.style.display = form.style.display === 'none' ? 'block' : 'none';
    if (form.style.display === 'block') {
      $('homeAcctName').value = '';
      $('homeAcctKey').value = '';
      const svc = SERVICES[$('homeAcctService').value];
      $('homeAcctModel').value = svc?.defaultModel || '';
      const dl = $('homeModelSuggestions');
      dl.innerHTML = '';
      if (svc) { for (const m of svc.models) { const opt = document.createElement('option'); opt.value = m; dl.appendChild(opt); } }
      $('homeAcctName').focus();
    }
  });

  $('homeAcctService').addEventListener('change', () => {
    const svc = SERVICES[$('homeAcctService').value];
    $('homeAcctModel').value = svc?.defaultModel || '';
    const dl = $('homeModelSuggestions');
    dl.innerHTML = '';
    if (svc) { for (const m of svc.models) { const opt = document.createElement('option'); opt.value = m; dl.appendChild(opt); } }
  });

  $('homeAcctSave').addEventListener('click', () => {
    const name = $('homeAcctName').value.trim();
    const service = $('homeAcctService').value;
    const apiKey = $('homeAcctKey').value.trim();
    const model = $('homeAcctModel').value.trim();
    if (!name || !apiKey || !model) return;
    createAccount({ name, service, apiKey, model });
    $('homeAcctAddForm').style.display = 'none';
    renderHomeAccountList();
  });

  $('homeAcctCancel').addEventListener('click', () => {
    $('homeAcctAddForm').style.display = 'none';
  });
}

// ── Startup ─────────────────────────────────────────────────────
initRouterListeners();
initAccountListeners();
initPanelListeners();
initCmdPaletteListeners();
initChatListeners();
initHomeListeners();

ensureDefaultWorkspace();
handleRoute();
