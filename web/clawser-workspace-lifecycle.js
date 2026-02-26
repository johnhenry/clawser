/**
 * clawser-workspace-lifecycle.js — Workspace creation, switching, and initialization
 *
 * Extracted from clawser-app.js. Contains:
 *   - createShellSession()  — fresh shell for current workspace
 *   - switchWorkspace()     — save current, switch, restore target
 *   - initWorkspace()       — full bootstrap from scratch
 */
import { $, state, lsKey, setSending, setConversation, resetConversationState, on, emit } from './clawser-state.js';
import { modal } from './clawser-modal.js';
import { loadWorkspaces, setActiveWorkspaceId, ensureDefaultWorkspace, getWorkspaceName, touchWorkspace } from './clawser-workspaces.js';
import { loadConversations } from './clawser-conversations.js';
import { saveConfig, applyRestoredConfig, rebuildProviderDropdown, setupProviders } from './clawser-accounts.js';
import { updateRouteHash, PANELS, resetRenderedPanels, isPanelRendered } from './clawser-router.js';
import { setStatus, addMsg, addErrorMsg, addToolCall, addInlineToolCall, updateInlineToolCall, addEvent, updateState, updateCostDisplay, replaySessionHistory, replayFromEvents, updateConvNameDisplay, persistActiveConversation, renderToolCalls, resetChatUI } from './clawser-ui-chat.js';
import { refreshFiles, renderGoals, renderToolRegistry, renderSkills, applySecuritySettings, renderAutonomySection, renderIdentitySection, renderRoutingSection, renderAuthProfilesSection, renderSelfRepairSection, updateCacheStats, renderLimitsSection, renderSandboxSection, renderHeartbeatSection, updateCostMeter, updateAutonomyBadge, updateDaemonBadge, refreshDashboard, renderMountList, renderOAuthSection, renderTerminalSessionBar, replayTerminalSession, renderToolManagementPanel, initAgentPicker, updateAgentLabel, renderAgentPanel, terminalAskUser } from './clawser-ui-panels.js';
import { registerClawserCli } from './clawser-cli.js';
import { AgentStorage } from './clawser-agent-storage.js';
import { SwitchAgentTool, ConsultAgentTool } from './clawser-tools.js';
import { TerminalSessionManager } from './clawser-terminal-sessions.js';

import { ClawserAgent } from './clawser-agent.js';
import { createDefaultRegistry, WorkspaceFs, registerAgentTools, AskUserQuestionTool } from './clawser-tools.js';
import { ClawserShell, ShellTool } from './clawser-shell.js';
import { ActivateSkillTool, DeactivateSkillTool, SkillInstallTool, SkillUpdateTool, SkillRemoveTool, SkillListTool, SkillSearchTool } from './clawser-skills.js';

import { MountListTool, MountResolveTool } from './clawser-mount.js';
import { ToolBuildTool, ToolTestTool, ToolListCustomTool, ToolEditTool, ToolRemoveTool } from './clawser-tool-builder.js';
import { ChannelListTool, ChannelSendTool, ChannelHistoryTool } from './clawser-channels.js';
import { DelegateTool } from './clawser-delegate.js';
import { GitStatusTool, GitDiffTool, GitLogTool, GitCommitTool, GitBranchTool, GitRecallTool } from './clawser-git.js';
import { BrowserOpenTool, BrowserReadPageTool, BrowserClickTool, BrowserFillTool, BrowserWaitTool, BrowserEvaluateTool, BrowserListTabsTool, BrowserCloseTabTool } from './clawser-browser-auto.js';
import { SandboxRunTool, SandboxStatusTool } from './clawser-sandbox.js';
import { SandboxEvalTool } from './clawser-tools.js';
import { registerAndboxCli } from './clawser-andbox-cli.js';
import { HwListTool, HwConnectTool, HwSendTool, HwReadTool, HwDisconnectTool, HwInfoTool } from './clawser-hardware.js';
import { RemoteStatusTool, RemotePairTool, RemoteRevokeTool } from './clawser-remote.js';
import { BridgeStatusTool, BridgeListToolsTool, BridgeFetchTool } from './clawser-bridge.js';
import { GoalAddTool, GoalUpdateTool, GoalAddArtifactTool, GoalListTool } from './clawser-goals.js';
import { DaemonStatusTool, DaemonCheckpointTool } from './clawser-daemon.js';
import { OAuthListTool, OAuthConnectTool, OAuthDisconnectTool, OAuthApiTool } from './clawser-oauth.js';
import { AuthListProfilesTool, AuthSwitchProfileTool, AuthStatusTool } from './clawser-auth-profiles.js';
import { RoutineCreateTool, RoutineListTool, RoutineDeleteTool, RoutineRunTool } from './clawser-routines.js';
import { SelfRepairStatusTool, SelfRepairConfigureTool } from './clawser-self-repair.js';
import { UndoTool, UndoStatusTool } from './clawser-undo.js';
import { IntentClassifyTool, IntentOverrideTool } from './clawser-intent.js';
import { HeartbeatStatusTool, HeartbeatRunTool } from './clawser-heartbeat.js';

// ── Shell session management ─────────────────────────────────────
/** Create a fresh shell session for the current workspace. Sources .clawserrc and registers CLI. */
export async function createShellSession() {
  state.shell = new ClawserShell({ workspaceFs: state.workspaceFs });
  await state.shell.source('/.clawserrc');
  registerClawserCli(state.shell.registry, () => state.agent, () => state.shell);
  registerAndboxCli(state.shell.registry, () => state.agent, () => state.shell);
  // Update terminal session manager's shell reference
  if (state.terminalSessions) {
    state.terminalSessions.setShell(state.shell);
  }
}

// ── Lazy Panel Rendering (Gap 11.1) ──────────────────────────────
/**
 * Deferred panel render registry. Maps panel names to render callbacks.
 * When a panel is first activated, its render callback fires once.
 * Config panel is NOT deferred because its render functions apply runtime
 * settings (autonomy levels, cache TTL, etc.) that affect agent behavior.
 */
const _deferredRenders = new Map();

/**
 * Register deferred render callbacks for panels that don't need
 * eager DOM population. Called during workspace init/switch.
 * @param {Object} renders - Map of panel name → render callback
 */
function registerLazyPanelRenders(renders) {
  // Clear old listeners
  for (const [panelName, { el, handler }] of _deferredRenders) {
    if (el) el.removeEventListener('panel:firstrender', handler);
  }
  _deferredRenders.clear();

  for (const [panelName, renderFn] of Object.entries(renders)) {
    const panelDef = PANELS[panelName];
    if (!panelDef) continue;
    const el = $(panelDef.id);
    if (!el) continue;

    // If the panel was already rendered (e.g. chat), run immediately
    if (isPanelRendered(panelName)) {
      renderFn();
      continue;
    }

    const handler = () => {
      renderFn();
      _deferredRenders.delete(panelName);
    };
    el.addEventListener('panel:firstrender', handler, { once: true });
    _deferredRenders.set(panelName, { el, handler });
  }
}

// ── Switch workspace ────────────────────────────────────────────
/** Save current workspace state, switch to a new workspace, and restore its agent/UI/conversation state.
 * @param {string} newId - Target workspace ID
 * @param {string} [convId] - Optional conversation ID to open after switching
 */
export async function switchWorkspace(newId, convId) {
  if (!state.agent) return;
  $('wsDropdown').classList.remove('visible');
  setStatus('busy', 'switching workspace...');
  history.replaceState(null, '', '#workspace/' + newId);

  // Stop daemon and routine engine before saving
  state.routineEngine.stop();
  await state.daemonController.stop().catch(() => {});

  // Persist terminal session before switching
  if (state.terminalSessions) {
    await state.terminalSessions.persist().catch(() => {});
  }

  // Save current workspace
  await persistActiveConversation();
  state.agent.persistMemories();
  await state.agent.persistCheckpoint();
  saveConfig();

  // Save routine state before switching
  try {
    const wsId = state.agent.getWorkspace();
    const routineData = state.routineEngine.toJSON();
    if (routineData) localStorage.setItem(lsKey.routines(wsId), JSON.stringify(routineData));
  } catch (e) { console.warn('[clawser] routine save failed', e); }

  // Reset agent state
  state.agent.reinit({});
  state.agent.setWorkspace(newId);
  setActiveWorkspaceId(newId);
  touchWorkspace(newId);

  // Create fresh shell session for new workspace
  await createShellSession();

  // Create terminal session manager for new workspace
  state.terminalSessions = new TerminalSessionManager({
    wsId: newId,
    shell: state.shell,
  });
  const switchInitResult = await state.terminalSessions.init();
  if (switchInitResult.restored && switchInitResult.events) {
    replayTerminalSession(switchInitResult.events);
  }
  renderTerminalSessionBar();

  // Clear UI
  resetChatUI();
  $('memResults').innerHTML = '';
  $('goalList').innerHTML = '';

  // Clear skills state
  for (const name of [...state.skillRegistry.activeSkills.keys()]) {
    state.skillRegistry.deactivate(name);
  }

  resetConversationState();
  updateCostDisplay();
  updateConvNameDisplay();

  // Restore new workspace state
  const savedConfig = state.agent.restoreConfig();
  const memCount = state.agent.restoreMemories();

  state.agent.setSystemPrompt($('systemPrompt').value);

  await rebuildProviderDropdown();
  await applyRestoredConfig(savedConfig);

  // Apply saved cache & limits config for the new workspace (Gap 11.2/11.3)
  renderLimitsSection();

  // Restore conversation state
  let wsRestored = false;
  const targetConvId = convId || savedConfig?.activeConversationId;
  if (targetConvId) {
    let convName = savedConfig?.activeConversationName || null;
    if (convId) {
      const convList = await loadConversations(newId);
      convName = convList.find(c => c.id === convId)?.name || null;
    }
    setConversation(targetConvId, convName);
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

  // Defer non-essential panel renders until first activation (Gap 11.1)
  resetRenderedPanels();
  await state.skillRegistry.discover(newId);
  registerLazyPanelRenders({
    tools:    () => renderToolRegistry(),
    goals:    () => renderGoals(),
    files:    () => { refreshFiles(); renderMountList(); },
    skills:   () => renderSkills(),
    dashboard: () => refreshDashboard(),
  });

  updateState();

  // Restart daemon and routine engine for new workspace
  state.daemonController.start().then(started => {
    if (started) updateDaemonBadge(state.daemonController.phase);
  }).catch(() => {});
  try {
    const savedRoutines = JSON.parse(localStorage.getItem(lsKey.routines(newId)) || 'null');
    if (savedRoutines) state.routineEngine.fromJSON(savedRoutines);
  } catch (e) { console.warn('[clawser] routine restore failed', e); }
  state.routineEngine.start();

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
/** Bootstrap a workspace from scratch: create agent, register tools, restore state, discover skills.
 * @param {string} wsId - Workspace ID to initialize
 * @param {string} [convId] - Optional conversation ID to restore
 */
export async function initWorkspace(wsId, convId) {
  if (state._updateInterval) { clearInterval(state._updateInterval); state._updateInterval = null; }
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
      responseCache: state.responseCache,
      safetyPipeline: state.safetyPipeline,
      selfRepairEngine: state.selfRepairEngine,
      undoManager: state.undoManager,
      onEvent: (topic, payload) => addEvent(topic, payload),
      onLog: (level, msg) => {
        const methods = ['debug','debug','info','warn','error'];
        console[methods[level] || 'log'](`[clawser] ${msg}`);
      },
      onToolCall: (() => {
        let _toolSeq = 0;
        return (name, params, result) => {
          if (result !== null) {
            state.toolUsageStats[name] = (state.toolUsageStats[name] || 0) + 1;
            state.toolLastUsed[name] = Date.now();
          }
          addToolCall(name, params, result);
          if (result === null) {
            const key = `${name}_${++_toolSeq}`;
            const el = addInlineToolCall(name, params, null);
            el._pendingKey = key;
            state.pendingInlineTools.set(key, el);
          } else {
            // Find the oldest pending entry for this tool name (FIFO)
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
        };
      })(),
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

    // Register shell tool (reads current shell from state.shell)
    state.browserTools.register(new ShellTool(() => state.shell));

    // ── Feature module tools (36 tools) ──────────────────────────

    // Mount (2)
    state.browserTools.register(new MountListTool(state.workspaceFs));
    state.browserTools.register(new MountResolveTool(state.workspaceFs));

    // Tool Builder (5)
    state.browserTools.register(new ToolBuildTool(state.toolBuilder));
    state.browserTools.register(new ToolTestTool(state.toolBuilder));
    state.browserTools.register(new ToolListCustomTool(state.toolBuilder));
    state.browserTools.register(new ToolEditTool(state.toolBuilder));
    state.browserTools.register(new ToolRemoveTool(state.toolBuilder));

    // Channels (3)
    state.browserTools.register(new ChannelListTool(state.channelManager));
    state.browserTools.register(new ChannelSendTool(state.channelManager));
    state.browserTools.register(new ChannelHistoryTool(state.channelManager));

    // Delegate (1) — uses lazy closures for provider/tool access
    state.browserTools.register(new DelegateTool({
      manager: state.delegateManager,
      chatFn: async (messages, tools) => {
        const providerSelect = $('providerSelect');
        const provId = providerSelect?.value || 'echo';
        const provider = state.providers?.get(provId);
        if (!provider) return { content: 'No provider available', tool_calls: [] };
        return provider.chat(messages, { tools });
      },
      executeFn: async (name, params) => state.browserTools.execute(name, params),
      toolSpecs: state.browserTools.allSpecs(),
    }));

    // Git (6)
    state.browserTools.register(new GitStatusTool(state.gitBehavior));
    state.browserTools.register(new GitDiffTool(state.gitBehavior));
    state.browserTools.register(new GitLogTool(state.gitBehavior));
    state.browserTools.register(new GitCommitTool(state.gitBehavior));
    state.browserTools.register(new GitBranchTool(state.gitBehavior));
    state.browserTools.register(new GitRecallTool(state.gitMemory));

    // Browser Automation (8)
    state.browserTools.register(new BrowserOpenTool(state.automationManager));
    state.browserTools.register(new BrowserReadPageTool(state.automationManager));
    state.browserTools.register(new BrowserClickTool(state.automationManager));
    state.browserTools.register(new BrowserFillTool(state.automationManager));
    state.browserTools.register(new BrowserWaitTool(state.automationManager));
    state.browserTools.register(new BrowserEvaluateTool(state.automationManager));
    state.browserTools.register(new BrowserListTabsTool(state.automationManager));
    state.browserTools.register(new BrowserCloseTabTool(state.automationManager));

    // Sandbox (3)
    state.browserTools.register(new SandboxRunTool(state.sandboxManager));
    state.browserTools.register(new SandboxStatusTool(state.sandboxManager));
    state.browserTools.register(new SandboxEvalTool(() => state.agent?.codex?._sandbox));

    // Hardware (6)
    state.browserTools.register(new HwListTool(state.peripheralManager));
    state.browserTools.register(new HwConnectTool(state.peripheralManager));
    state.browserTools.register(new HwSendTool(state.peripheralManager));
    state.browserTools.register(new HwReadTool(state.peripheralManager));
    state.browserTools.register(new HwDisconnectTool(state.peripheralManager));
    state.browserTools.register(new HwInfoTool(state.peripheralManager));

    // Remote (3)
    state.browserTools.register(new RemoteStatusTool(state.pairingManager));
    state.browserTools.register(new RemotePairTool(state.pairingManager));
    state.browserTools.register(new RemoteRevokeTool(state.pairingManager));

    // ── Gap-fill tools (31 tools from blocks 0-29) ─────────────

    // Bridge (3)
    state.browserTools.register(new BridgeStatusTool(state.bridgeManager));
    state.browserTools.register(new BridgeListToolsTool(state.bridgeManager));
    state.browserTools.register(new BridgeFetchTool(state.bridgeManager));

    // Goals (4)
    state.browserTools.register(new GoalAddTool(state.goalManager));
    state.browserTools.register(new GoalUpdateTool(state.goalManager));
    state.browserTools.register(new GoalAddArtifactTool(state.goalManager));
    state.browserTools.register(new GoalListTool(state.goalManager));

    // Daemon (2)
    state.browserTools.register(new DaemonStatusTool(state.daemonController));
    state.browserTools.register(new DaemonCheckpointTool(state.daemonController));

    // OAuth (4)
    state.browserTools.register(new OAuthListTool(state.oauthManager));
    state.browserTools.register(new OAuthConnectTool(state.oauthManager));
    state.browserTools.register(new OAuthDisconnectTool(state.oauthManager));
    state.browserTools.register(new OAuthApiTool(state.oauthManager));

    // Auth Profiles (3)
    state.browserTools.register(new AuthListProfilesTool(state.authProfileManager));
    state.browserTools.register(new AuthSwitchProfileTool(state.authProfileManager));
    state.browserTools.register(new AuthStatusTool(state.authProfileManager));

    // Routines (4)
    state.browserTools.register(new RoutineCreateTool(state.routineEngine));
    state.browserTools.register(new RoutineListTool(state.routineEngine));
    state.browserTools.register(new RoutineDeleteTool(state.routineEngine));
    state.browserTools.register(new RoutineRunTool(state.routineEngine));

    // Self-Repair (2)
    state.browserTools.register(new SelfRepairStatusTool(state.selfRepairEngine));
    state.browserTools.register(new SelfRepairConfigureTool(state.selfRepairEngine));

    // Undo (2)
    state.browserTools.register(new UndoTool(state.undoManager));
    state.browserTools.register(new UndoStatusTool(state.undoManager));

    // Intent (2)
    state.browserTools.register(new IntentClassifyTool(state.intentRouter));
    state.browserTools.register(new IntentOverrideTool(state.intentRouter));

    // Heartbeat (2)
    state.browserTools.register(new HeartbeatStatusTool(state.heartbeatRunner));
    state.browserTools.register(new HeartbeatRunTool(state.heartbeatRunner));

    // Skills Registry (5)
    state.browserTools.register(new SkillSearchTool(state.skillRegistryClient));
    state.browserTools.register(new SkillInstallTool(state.skillRegistryClient, state.skillRegistry, activeWsId));
    state.browserTools.register(new SkillUpdateTool(state.skillRegistryClient, state.skillRegistry, activeWsId));
    state.browserTools.register(new SkillRemoveTool(state.skillRegistry, activeWsId));
    state.browserTools.register(new SkillListTool(state.skillRegistry));

    // AskUserQuestion (1)
    state.browserTools.register(new AskUserQuestionTool(async (questions) => {
      return terminalAskUser(questions);
    }));

    // Agents (Block 37) — storage + tools
    try {
      const opfsRoot = await navigator.storage.getDirectory();
      let globalAgentDir;
      try { globalAgentDir = await opfsRoot.getDirectoryHandle('clawser_agents', { create: true }); } catch { globalAgentDir = null; }
      let wsAgentDir;
      try {
        const wsBase = await opfsRoot.getDirectoryHandle('clawser_workspaces', { create: true });
        const wsHandle = await wsBase.getDirectoryHandle(activeWsId, { create: true });
        wsAgentDir = await wsHandle.getDirectoryHandle('.agents', { create: true });
      } catch { wsAgentDir = null; }
      state.agentStorage = new AgentStorage({ globalDir: globalAgentDir, wsDir: wsAgentDir, wsId: activeWsId });
      await state.agentStorage.seedBuiltins();

      // Register agent tools
      state.browserTools.register(new SwitchAgentTool(state.agentStorage, state.agent));
      state.browserTools.register(new ConsultAgentTool(state.agentStorage, {
        providers: state.providers,
        browserTools: state.browserTools,
        mcpManager: state.mcpManager,
        onLog: (level, msg) => console.log(`[consult] ${msg}`),
        createEngine: async (engineOpts) => {
          const sub = await ClawserAgent.create(engineOpts);
          sub.init({});
          return sub;
        },
      }));

      // Restore active agent
      const activeAgent = await state.agentStorage.getActive();
      if (activeAgent) {
        state.agent.applyAgent(activeAgent);
        updateAgentLabel(activeAgent);
      }
    } catch (e) {
      console.warn('[clawser] Agent storage init failed:', e);
    }

    state.agent.refreshToolSpecs();

    state.browserTools.setApprovalHandler(async (toolName, params) => {
      return await modal.confirm(`Allow tool "${toolName}" to execute?\n\nParams: ${JSON.stringify(params).slice(0, 200)}`);
    });

    try {
      const savedPerms = JSON.parse(localStorage.getItem(lsKey.toolPerms(activeWsId)) || '{}');
      state.browserTools.loadPermissions(savedPerms);
    } catch (e) { console.warn('[clawser] failed to parse saved tool permissions', e); }

    try {
      const sec = JSON.parse(localStorage.getItem(lsKey.security(activeWsId)) || '{}');
      if (sec.domains) $('cfgDomainAllowlist').value = sec.domains;
      if (sec.maxFileSizeMB) $('cfgMaxFileSize').value = sec.maxFileSizeMB;
      applySecuritySettings();
    } catch (e) { console.warn('[clawser] failed to parse saved security config', e); }

    state.agent.setWorkspace(activeWsId);
    touchWorkspace(activeWsId);

    // Create initial shell session for this workspace (includes CLI registration)
    await createShellSession();

    // Create terminal session manager (Block 35)
    state.terminalSessions = new TerminalSessionManager({
      wsId: activeWsId,
      shell: state.shell,
    });
    const initResult = await state.terminalSessions.init();
    if (initResult.restored && initResult.events) {
      replayTerminalSession(initResult.events);
    }
    renderTerminalSessionBar();

    const savedConfig = state.agent.restoreConfig();
    const memCount = state.agent.restoreMemories();

    state.agent.memoryHygiene();

    state.agent.setSystemPrompt($('systemPrompt').value);

    // Apply saved identity to compile system prompt (B1)
    try {
      const savedIdentity = JSON.parse(localStorage.getItem(lsKey.identity(activeWsId)) || 'null');
      if (savedIdentity?.format) {
        if (savedIdentity.format === 'plain') {
          state.identityManager.load(savedIdentity.plain || '');
        } else {
          state.identityManager.load({
            version: '1.1',
            names: { display: savedIdentity.name || '' },
            bio: savedIdentity.role || '',
            linguistics: { tone: savedIdentity.personality || '' },
          });
        }
        const compiled = state.identityManager.compile();
        if (compiled) state.agent.setSystemPrompt(compiled);
      }
    } catch (e) { console.warn('[clawser] identity compile failed', e); }

    await setupProviders();

    await applyRestoredConfig(savedConfig);

    // Restore conversation state
    let restored = false;
    const targetConvId = convId || savedConfig?.activeConversationId;
    if (targetConvId) {
      let convName = savedConfig?.activeConversationName || null;
      if (convId) {
        const convList = await loadConversations(activeWsId);
        convName = convList.find(c => c.id === convId)?.name || null;
      }
      setConversation(targetConvId, convName);
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

    // ── Eager renders: config sections (apply runtime settings) ──
    renderAutonomySection();
    renderIdentitySection();
    renderRoutingSection();
    renderAuthProfilesSection();
    renderOAuthSection();
    renderSelfRepairSection();
    updateCacheStats();
    renderLimitsSection();
    renderSandboxSection();
    renderHeartbeatSection();
    updateState();

    // Initialize heartbeat (Batch 7)
    state.heartbeatRunner.loadDefault();

    // Build default routing chains from available providers (B3)
    try {
      const providerIds = state.providers ? [...(await state.providers.listWithAvailability().catch(() => []))].map(p => p.name) : [];
      if (providerIds.length > 0) state.modelRouter.buildDefaults(providerIds);
    } catch (e) { console.warn('[clawser] modelRouter buildDefaults failed', e); }

    // Start daemon controller (B4)
    state.daemonController.start().then(started => {
      if (started) updateDaemonBadge(state.daemonController.phase);
    }).catch(e => console.warn('[clawser] daemon start failed', e));

    // Start routine engine (B5)
    try {
      const savedRoutines = JSON.parse(localStorage.getItem(lsKey.routines(activeWsId)) || 'null');
      if (savedRoutines) state.routineEngine.fromJSON(savedRoutines);
    } catch (e) { console.warn('[clawser] routine restore failed', e); }
    state.routineEngine.start();

    await state.skillRegistry.discover(activeWsId);

    // ── Deferred renders: non-config panels (Gap 11.1) ──
    // These panels keep empty DOM until the user first clicks on them.
    registerLazyPanelRenders({
      tools:    () => renderToolRegistry(),
      files:    () => { refreshFiles(); renderMountList(); },
      goals:    () => renderGoals(),
      skills:   () => renderSkills(),
      toolMgmt: () => renderToolManagementPanel(),
      agents:   () => { renderAgentPanel(); initAgentPicker(); },
      dashboard: () => refreshDashboard(),
    });

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

    state._updateInterval = setInterval(() => {
      updateState();
      updateCostMeter();
      updateCacheStats();
      // Only refresh dashboard if it has been activated (Gap 11.1)
      if (isPanelRendered('dashboard')) refreshDashboard();
      updateDaemonBadge(state.daemonController.phase);
      updateAutonomyBadge();
    }, 5000);
  } catch (e) {
    addErrorMsg(`Init failed: ${e.message}`);
    setStatus('error', 'init failed');
    console.error(e);
  }
}
