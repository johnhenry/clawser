/**
 * clawser-app.js — Application orchestrator
 *
 * State machine lifecycle:
 *   1. Module-level singleton creation (providers, tools, skills, MCP)
 *   2. startup() → initListeners + ensureDefaultWorkspace + handleRoute
 *   3. handleRoute() reads the URL hash:
 *      - #home → showView('viewHome'), render workspace/account lists
 *      - #workspace/:id → initWorkspace (first load) or switchWorkspace (subsequent)
 *   4. initWorkspace() bootstraps a fresh agent, registers tools, restores state
 *   5. switchWorkspace() saves current, reinits agent, restores target workspace
 *
 * All cross-module coordination flows through the event bus (on/emit).
 */
import { $, esc, state, on, emit, lsKey, setSending, setConversation, resetConversationState } from './clawser-state.js';
import { modal } from './clawser-modal.js';
import { loadWorkspaces, setActiveWorkspaceId, ensureDefaultWorkspace, createWorkspace, renameWorkspace, deleteWorkspace, getWorkspaceName, touchWorkspace } from './clawser-workspaces.js';
import { loadConversations } from './clawser-conversations.js';
import { SERVICES, loadAccounts, createAccount, deleteAccount, saveConfig, applyRestoredConfig, rebuildProviderDropdown, setupProviders, initAccountListeners } from './clawser-accounts.js';
import { parseHash, navigate, showView, updateRouteHash, activatePanel, initRouterListeners } from './clawser-router.js';
import { setStatus, addMsg, addErrorMsg, addToolCall, addInlineToolCall, updateInlineToolCall, addEvent, updateState, updateCostDisplay, replaySessionHistory, replayFromEvents, updateConvNameDisplay, persistActiveConversation, switchConversation, initChatListeners, renderToolCalls, resetChatUI, addSubAgentCard, updateSubAgentCard, addSafetyBanner, addUndoButton, addIntentBadge } from './clawser-ui-chat.js';
import { refreshFiles, renderGoals, renderToolRegistry, renderSkills, applySecuritySettings, initPanelListeners, renderAutonomySection, renderIdentitySection, renderRoutingSection, renderAuthProfilesSection, renderSelfRepairSection, updateCacheStats, renderSandboxSection, renderHeartbeatSection, updateCostMeter, updateAutonomyBadge, updateDaemonBadge, updateRemoteBadge, refreshDashboard, renderMountList, renderOAuthSection } from './clawser-ui-panels.js';
import { initCmdPaletteListeners } from './clawser-cmd-palette.js';

import { ClawserAgent } from './clawser-agent.js';
import { createDefaultRegistry, WorkspaceFs, registerAgentTools } from './clawser-tools.js';
import { createDefaultProviders, ResponseCache } from './clawser-providers.js';
import { McpManager } from './clawser-mcp.js';
import { SkillRegistry, SkillStorage, ActivateSkillTool, DeactivateSkillTool } from './clawser-skills.js';
import { ClawserShell, ShellTool } from './clawser-shell.js';
import { SecretVault, OPFSVaultStorage } from './clawser-vault.js';
import { AutonomyController, HookPipeline } from './clawser-agent.js';
import { IdentityManager, compileSystemPrompt } from './clawser-identity.js';
import { ModelRouter, ProviderHealth, FallbackChain, FallbackExecutor } from './clawser-fallback.js';
import { IntentRouter } from './clawser-intent.js';
import { InputSanitizer, ToolCallValidator, SafetyPipeline } from './clawser-safety.js';
import { StuckDetector, SelfRepairEngine } from './clawser-self-repair.js';
import { UndoManager } from './clawser-undo.js';
import { HeartbeatRunner } from './clawser-heartbeat.js';
import { AuthProfileManager } from './clawser-auth-profiles.js';
import { OAuthManager } from './clawser-oauth.js';
import { MetricsCollector, RingBufferLog } from './clawser-metrics.js';
import { DaemonController } from './clawser-daemon.js';
import { RoutineEngine } from './clawser-routines.js';
import { MountableFs, MountListTool, MountResolveTool } from './clawser-mount.js';
import { ToolBuilder, ToolBuildTool, ToolTestTool, ToolListCustomTool, ToolEditTool, ToolRemoveTool } from './clawser-tool-builder.js';
import { ChannelManager, ChannelListTool, ChannelSendTool, ChannelHistoryTool } from './clawser-channels.js';
import { DelegateManager, DelegateTool } from './clawser-delegate.js';
import { GitBehavior, GitEpisodicMemory, GitStatusTool, GitDiffTool, GitLogTool, GitCommitTool, GitBranchTool, GitRecallTool } from './clawser-git.js';
import { AutomationManager, BrowserOpenTool, BrowserReadPageTool, BrowserClickTool, BrowserFillTool, BrowserWaitTool, BrowserEvaluateTool, BrowserListTabsTool, BrowserCloseTabTool } from './clawser-browser-auto.js';
import { SandboxManager, SandboxRunTool, SandboxStatusTool } from './clawser-sandbox.js';
import { PeripheralManager, HwListTool, HwConnectTool, HwSendTool, HwReadTool, HwDisconnectTool, HwInfoTool } from './clawser-hardware.js';
import { PairingManager, RemoteStatusTool, RemotePairTool, RemoteRevokeTool } from './clawser-remote.js';

// ── Create service singletons ───────────────────────────────────
state.workspaceFs = new MountableFs();
state.browserTools = createDefaultRegistry(state.workspaceFs);
state.providers = createDefaultProviders();
state.mcpManager = new McpManager({
  onLog: (level, msg) => console.log(`[mcp] ${msg}`),
});

state.responseCache = new ResponseCache();
state.vault = new SecretVault(new OPFSVaultStorage());

// ── Create advanced module singletons (Batch 6-8) ───────────────
state.identityManager = new IdentityManager();
state.intentRouter = new IntentRouter();
state.inputSanitizer = new InputSanitizer();
state.toolCallValidator = new ToolCallValidator();
state.safetyPipeline = new SafetyPipeline({ sanitizer: state.inputSanitizer, validator: state.toolCallValidator });
state.providerHealth = new ProviderHealth();
state.modelRouter = new ModelRouter();
state.stuckDetector = new StuckDetector();
state.selfRepairEngine = new SelfRepairEngine({ detector: state.stuckDetector });
state.undoManager = new UndoManager({
  handlers: {
    revertHistory: (historyLength) => { /* agent #history is private; undo relies on event log replay */ },
    revertMemory: (op) => { /* memory revert handled by agent */ },
  },
});
state.heartbeatRunner = new HeartbeatRunner({
  onAlert: (msg) => addEvent('heartbeat_alert', msg),
});
state.authProfileManager = new AuthProfileManager({ vault: state.vault });
state.metricsCollector = new MetricsCollector();
state.ringBufferLog = new RingBufferLog(1000);
state.daemonController = new DaemonController({
  getStateFn: () => state.agent?.getState(),
});
state.routineEngine = new RoutineEngine({
  executeFn: async (routine, triggerEvent) => {
    if (state.agent) {
      const prompt = routine.action?.prompt || routine.name;
      state.agent.sendMessage(prompt);
      return state.agent.run();
    }
  },
  onNotify: (routine, message) => addEvent('routine', message),
});

state.oauthManager = new OAuthManager({ vault: state.vault });

// ── Feature module singletons ────────────────────────────────────
const _onLog = (level, msg) => console.log(`[clawser] ${msg}`);
state.toolBuilder = new ToolBuilder(state.browserTools, (code) => new Function(code)());
state.channelManager = new ChannelManager({ onLog: _onLog });
state.delegateManager = new DelegateManager({ maxConcurrency: 3 });
state.gitBehavior = new GitBehavior({
  ops: {
    exec: async (cmd) => {
      if (!state.shell) return { code: 1, stdout: '', stderr: 'No shell available' };
      return state.shell.exec(cmd);
    },
  },
});
state.gitMemory = new GitEpisodicMemory(state.gitBehavior);
state.automationManager = new AutomationManager({ onLog: _onLog });
state.sandboxManager = new SandboxManager({ onLog: _onLog });
state.peripheralManager = new PeripheralManager({ onLog: _onLog });
state.pairingManager = new PairingManager({ onLog: _onLog });

// Freeze service singleton slots to prevent accidental reassignment
Object.defineProperty(state, 'workspaceFs', { value: state.workspaceFs, writable: false, configurable: false });
Object.defineProperty(state, 'browserTools', { value: state.browserTools, writable: false, configurable: false });
Object.defineProperty(state, 'providers', { value: state.providers, writable: false, configurable: false });
Object.defineProperty(state, 'mcpManager', { value: state.mcpManager, writable: false, configurable: false });
Object.defineProperty(state, 'responseCache', { value: state.responseCache, writable: false, configurable: false });
Object.defineProperty(state, 'vault', { value: state.vault, writable: false, configurable: false });

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

// ── Shell session management ─────────────────────────────────────
/** Create a fresh shell session for the current workspace. Sources .clawserrc. */
async function createShellSession() {
  state.shell = new ClawserShell({ workspaceFs: state.workspaceFs });
  await state.shell.source('/.clawserrc');
}

// ── Cross-module event bus ──────────────────────────────────────
on('refreshFiles', () => refreshFiles());
on('renderGoals', () => renderGoals());
on('renderSkills', () => renderSkills());
on('saveConfig', () => saveConfig());
on('newShellSession', () => createShellSession());
on('updateCostMeter', () => updateCostMeter());
on('updateDaemon', (phase) => updateDaemonBadge(phase));
on('updateRemote', (count) => updateRemoteBadge(count));
on('refreshDashboard', () => refreshDashboard());

// ── Switch workspace ────────────────────────────────────────────
/** Save current workspace state, switch to a new workspace, and restore its agent/UI/conversation state.
 * @param {string} newId - Target workspace ID
 * @param {string} [convId] - Optional conversation ID to open after switching
 */
async function switchWorkspace(newId, convId) {
  if (!state.agent) return;
  $('wsDropdown').classList.remove('visible');
  setStatus('busy', 'switching workspace...');
  history.replaceState(null, '', '#workspace/' + newId);

  // Stop daemon and routine engine before saving
  state.routineEngine.stop();
  await state.daemonController.stop().catch(() => {});

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

  // Restore conversation state
  let wsRestored = false;
  const targetConvId = convId || savedConfig?.activeConversationId;
  if (targetConvId) {
    const convName = convId
      ? (loadConversations(newId).find(c => c.id === convId)?.name || null)
      : (savedConfig?.activeConversationName || null);
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

  renderToolRegistry();
  updateState();
  renderGoals();
  refreshFiles();

  await state.skillRegistry.discover(newId);
  renderSkills();

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
async function initWorkspace(wsId, convId) {
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

    // Sandbox (2)
    state.browserTools.register(new SandboxRunTool(state.sandboxManager));
    state.browserTools.register(new SandboxStatusTool(state.sandboxManager));

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

    // Create initial shell session for this workspace
    await createShellSession();

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
      const convName = convId
        ? (loadConversations(activeWsId).find(c => c.id === convId)?.name || null)
        : (savedConfig?.activeConversationName || null);
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

    renderToolRegistry();
    updateState();
    renderGoals();
    refreshFiles();

    // Render new config sections (Batch 1)
    renderAutonomySection();
    renderIdentitySection();
    renderRoutingSection();
    renderAuthProfilesSection();
    renderOAuthSection();
    renderSelfRepairSection();
    updateCacheStats();
    renderSandboxSection();
    renderHeartbeatSection();
    renderMountList();

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

    state._updateInterval = setInterval(() => {
      updateState();
      updateCostMeter();
      updateCacheStats();
      refreshDashboard();
      updateDaemonBadge(state.daemonController.phase);
      updateAutonomyBadge();
    }, 5000);
  } catch (e) {
    addErrorMsg(`Init failed: ${e.message}`);
    setStatus('error', 'init failed');
    console.error(e);
  }
}

// ── Route handler ───────────────────────────────────────────────
/** Handle hash-based routing: show home view or init/switch workspace based on URL fragment. */
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
/** Render the workspace card list on the home screen with rename/delete actions and click-to-open. */
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
          await deleteWorkspace(ws.id);
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

/** Render the account list on the home screen with delete actions. */
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
/** Bind event listeners for the home view: workspace create, account CRUD, service selector. */
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
    form.classList.toggle('visible');
    if (form.classList.contains('visible')) {
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

  $('homeAcctSave').addEventListener('click', async () => {
    const name = $('homeAcctName').value.trim();
    const service = $('homeAcctService').value;
    const apiKey = $('homeAcctKey').value.trim();
    const model = $('homeAcctModel').value.trim();
    if (!name || !apiKey || !model) return;
    await createAccount({ name, service, apiKey, model });
    $('homeAcctAddForm').classList.remove('visible');
    renderHomeAccountList();
  });

  $('homeAcctCancel').addEventListener('click', () => {
    $('homeAcctAddForm').classList.remove('visible');
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
