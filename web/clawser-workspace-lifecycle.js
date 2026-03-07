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
import { loadWorkspaces, setActiveWorkspaceId, getActiveWorkspaceId, ensureDefaultWorkspace, getWorkspaceName, touchWorkspace } from './clawser-workspaces.js';
import { loadConversations } from './clawser-conversations.js';
import { saveConfig, applyRestoredConfig, rebuildProviderDropdown, setupProviders } from './clawser-accounts.js';
import { updateRouteHash, PANELS, resetRenderedPanels, isPanelRendered } from './clawser-router.js';
import { setStatus, addMsg, addErrorMsg, addToolCall, addInlineToolCall, updateInlineToolCall, addEvent, updateState, updateCostDisplay, replaySessionHistory, replayFromEvents, updateConvNameDisplay, persistActiveConversation, renderToolCalls, resetChatUI } from './clawser-ui-chat.js';
import { refreshFiles, renderGoals, renderToolRegistry, renderSkills, applySecuritySettings, renderAutonomySection, renderIdentitySection, renderRoutingSection, renderAuthProfilesSection, renderSelfRepairSection, updateCacheStats, renderLimitsSection, renderSandboxSection, renderHeartbeatSection, updateCostMeter, updateAutonomyBadge, updateDaemonBadge, refreshDashboard, renderMountList, renderOAuthSection, renderTerminalSessionBar, replayTerminalSession, renderToolManagementPanel, initAgentPicker, updateAgentLabel, renderAgentPanel, terminalAskUser, renderMarketplace, renderChannelPanel, updateChannelBadge, restoreSavedChannels, initSharedWorkerFromConfig } from './clawser-ui-panels.js';
import { AgentStorage } from './clawser-agent-storage.js';
import { SwitchAgentTool, ConsultAgentTool } from './clawser-tools.js';
import { TerminalSessionManager } from './clawser-terminal-sessions.js';

import { ClawserAgent } from './clawser-agent.js';
import { createDefaultRegistry, WorkspaceFs, registerAgentTools, AskUserQuestionTool } from './clawser-tools.js';
import { ShellTool } from './clawser-shell.js';

// Kernel integration (optional — no-op if kernel not initialized)
let _kernelIntegration = null;
/** Set the kernel integration adapter for workspace lifecycle hooks. */
export function setKernelIntegration(ki) { _kernelIntegration = ki; }
/** Get the current kernel integration adapter. */
export function getKernelIntegration() { return _kernelIntegration; }
import { ActivateSkillTool, DeactivateSkillTool, SkillInstallTool, SkillUpdateTool, SkillRemoveTool, SkillListTool, SkillSearchTool } from './clawser-skills.js';
import { SkillMarketplace } from './clawser-marketplace.js';

import { MountListTool, MountResolveTool } from './clawser-mount.js';
import { ToolBuildTool, ToolTestTool, ToolListCustomTool, ToolEditTool, ToolRemoveTool } from './clawser-tool-builder.js';
import { ChannelListTool, ChannelSendTool, ChannelHistoryTool } from './clawser-channels.js';
import { ChannelGateway } from './clawser-gateway.js';
import { bridgePeerAgent } from './clawser-peer-agent.js';
import { DelegateTool } from './clawser-delegate.js';
import { GitStatusTool, GitDiffTool, GitLogTool, GitCommitTool, GitBranchTool, GitRecallTool } from './clawser-git.js';
import { BrowserOpenTool, BrowserReadPageTool, BrowserClickTool, BrowserFillTool, BrowserWaitTool, BrowserEvaluateTool, BrowserListTabsTool, BrowserCloseTabTool } from './clawser-browser-auto.js';
import { SandboxRunTool, SandboxStatusTool } from './clawser-sandbox.js';
import { registerWshTools } from './clawser-wsh-tools.js';
import { registerNetwayTools } from './clawser-netway-tools.js';
import { HwListTool, HwConnectTool, HwSendTool, HwReadTool, HwDisconnectTool, HwInfoTool } from './clawser-hardware.js';
import { RemoteStatusTool, RemotePairTool, RemoteRevokeTool } from './clawser-remote.js';
import { GoalAddTool, GoalUpdateTool, GoalAddArtifactTool, GoalListTool } from './clawser-goals.js';
import { DaemonStatusTool, DaemonCheckpointTool } from './clawser-daemon.js';
import { OAuthListTool, OAuthConnectTool, OAuthDisconnectTool, OAuthApiTool } from './clawser-oauth.js';
import { AuthListProfilesTool, AuthSwitchProfileTool, AuthStatusTool } from './clawser-auth-profiles.js';
import { RoutineCreateTool, RoutineListTool, RoutineDeleteTool, RoutineRunTool, RoutineHistoryTool, RoutineToggleTool, RoutineUpdateTool } from './clawser-routines.js';
import { SelfRepairStatusTool, SelfRepairConfigureTool } from './clawser-self-repair.js';
import { UndoTool, UndoStatusTool, RedoTool } from './clawser-undo.js';
import { IntentClassifyTool, IntentOverrideTool } from './clawser-intent.js';
import { HeartbeatStatusTool, HeartbeatRunTool } from './clawser-heartbeat.js';
import { registerExtensionTools, initExtensionBadge } from './clawser-extension-tools.js';
import { initServerManager, getServerManager } from './clawser-server.js';
import { registerServerTools } from './clawser-server-tools.js';
import { renderServerList, initServerPanel } from './clawser-ui-servers.js';
import { ClawserPod } from './clawser-pod.js';
import { registerMeshTools } from './clawser-mesh-tools.js';
import { registerIdentityTools } from './clawser-mesh-identity-tools.js';
import { createMeshctlTools } from './clawser-mesh-orchestrator.js';
import { renderSwarmPanel, initSwarmListeners } from './clawser-ui-swarms.js';
import { renderTransferPanel, initTransferListeners } from './clawser-ui-transfers.js';
import { renderMeshPanel, initMeshListeners } from './clawser-ui-mesh.js';
import { renderIdentityWallet, initIdentityWalletListeners, renderContactBook, initContactBookListeners, renderConnectionPanel, initConnectionListeners, renderAuditLog, initAuditLogListeners } from './clawser-ui-peers.js';
import { renderServiceBrowser, updatePeerBadge } from './clawser-ui-remote.js';

// Phase 7: Remote gateway
import { GatewayServer } from './clawser-gateway-server.js';

// Phase 8: OAuth + Integration tools
import { GoogleCalendarListTool, GoogleCalendarCreateTool, GoogleGmailSearchTool, GoogleGmailSendTool, GoogleDriveListTool, GoogleDriveReadTool, GoogleDriveCreateTool } from './clawser-google-tools.js';
import { NotionSearchTool, NotionCreatePageTool, NotionUpdatePageTool, NotionQueryDatabaseTool } from './clawser-notion-tools.js';
import { SlackChannelsTool, SlackPostTool, SlackHistoryTool } from './clawser-slack-tools.js';
import { LinearIssuesTool, LinearCreateIssueTool, LinearUpdateIssueTool } from './clawser-linear-tools.js';
import { GitHubPrReviewTool, GitHubIssueCreateTool, GitHubCodeSearchTool } from './clawser-integration-github.js';
import { CalendarAwarenessTool, CalendarFreeBusyTool, CalendarQuickAddTool } from './clawser-integration-calendar.js';
import { EmailDraftTool, EmailSummarizeTool, EmailTriageTool } from './clawser-integration-email.js';
import { SlackMonitorTool, SlackDraftResponseTool } from './clawser-integration-slack.js';

// Phase 5: Browser infrastructure
import { FsObserver } from './clawser-fs-observer.js';
import { TabViewManager } from './clawser-tab-views.js';

// Phase 9: CORS fetch proxy
import { ExtCorsFetchTool, setCorsFetchClient } from './clawser-cors-fetch.js';
import { getExtensionClient } from './clawser-extension-tools.js';

// Fallback chain
import { FallbackChain, FallbackExecutor } from './clawser-fallback.js';
import { ModelManager, ModelRegistry, ModelCache } from './clawser-models.js';
import { ModelListTool, ModelPullTool, ModelRemoveTool, ModelStatusTool, TranscribeTool, SpeakTool, CaptionTool, OcrTool, DetectObjectsTool, ClassifyImageTool, ClassifyTextTool } from './clawser-model-tools.js';
import { createConfiguredShell } from './clawser-shell-factory.js';
import { VirtualTerminalManager } from './clawser-wsh-virtual-terminal-manager.js';

// ── Mesh agent bridge helper ─────────────────────────────────────
/**
 * Create an AgentHost for a PeerSession, wired through the ChannelGateway.
 * Call this when establishing a PeerSession to enable agent queries from the peer.
 *
 * @param {import('./clawser-peer-session.js').PeerSession} session
 * @returns {import('./clawser-peer-agent.js').AgentHost|null}
 */
export function createMeshAgentHost(session) {
  if (!state.agent || !state.gateway) {
    console.warn('[clawser] Cannot create mesh agent host — agent or gateway not available');
    return null;
  }
  return bridgePeerAgent(session, state.agent, state.gateway,
    (level, msg) => console.log(`[mesh-agent] ${msg}`));
}

// ── Routine → IndexedDB sync (background execution) ─────────────
/**
 * Persist current routine state to IndexedDB so background runners
 * (chrome.alarms Tier 1, periodicSync Tier 3) can pick up due routines.
 */
async function syncRoutinesToIDB() {
  if (!state.checkpointIDB || !state.routineEngine) return;
  try {
    const routines = state.routineEngine.listRoutines?.() || [];
    const serialized = routines.map(r => ({
      id: r.id,
      name: r.name,
      enabled: r.enabled !== false,
      trigger: r.trigger || {},
      state: r.state || {},
      meta: r.meta || null,
      action: r.action || null,
      guardrails: r.guardrails || null,
    }));
    await state.checkpointIDB.write('background_routine_state', serialized);
  } catch { /* best-effort */ }
}

// Export for use by other modules (e.g., routine UI after changes)
export { syncRoutinesToIDB };

let _reverseVirtualTerminalManager = null;

export function getReverseVirtualTerminalManager() {
  return _reverseVirtualTerminalManager;
}

async function refreshReverseVirtualTerminalManager() {
  if (_reverseVirtualTerminalManager) {
    await _reverseVirtualTerminalManager.close();
  }

  _reverseVirtualTerminalManager = new VirtualTerminalManager({
    shellFactory: async () => createConfiguredShell({
      workspaceFs: state.workspaceFs,
      getAgent: () => state.agent,
      getRoutineEngine: () => state.routineEngine,
      getModelManager: () => state.modelManager,
    }),
  });

  try {
    const { setToolRegistry, setVirtualTerminalManager } = await import('./clawser-wsh-incoming.js');
    setVirtualTerminalManager(_reverseVirtualTerminalManager);
    if (state.browserTools) {
      setToolRegistry(state.browserTools);
    }
  } catch (err) {
    console.warn('[clawser] reverse terminal manager wiring failed', err);
  }
}

// ── Shell session management ─────────────────────────────────────
/** Create a fresh shell session for the current workspace. Sources .clawserrc and registers CLI. */
export async function createShellSession() {
  state.shell = await createConfiguredShell({
    workspaceFs: state.workspaceFs,
    getAgent: () => state.agent,
    getRoutineEngine: () => state.routineEngine,
    getModelManager: () => state.modelManager,
  });
  // Update terminal session manager's shell reference
  if (state.terminalSessions) {
    state.terminalSessions.setShell(state.shell);
  }

  await refreshReverseVirtualTerminalManager();
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

// ── P2P Mesh Initialization ─────────────────────────────────────
/**
 * Initialize or reinitialize the P2P mesh subsystem via ClawserPod.
 * Creates a Pod (identity, discovery, messaging) then layers on
 * PeerNode + SwarmCoordinator. Safe to call multiple times.
 */
async function initMeshSubsystem() {
  try {
    // Boot pod if not already running
    if (!state.pod) {
      state.pod = new ClawserPod();
      await state.pod.boot({ discoveryTimeout: 500 });
    }

    // Layer mesh networking on top of the pod
    const result = await state.pod.initMesh();
    state.peerNode = result.peerNode;
    state.swarmCoordinator = result.swarmCoordinator;
    state.discoveryManager = result.discoveryManager;
    state.transportNegotiator = result.transportNegotiator;
    state.auditChain = result.auditChain;
    state.streamMultiplexer = result.streamMultiplexer;
    state.fileTransfer = result.fileTransfer;
    state.serviceDirectory = result.serviceDirectory;
    state.syncEngine = result.syncEngine;
    state.resourceRegistry = result.resourceRegistry;
    state.meshMarketplace = result.meshMarketplace;
    state.quotaManager = result.quotaManager;
    state.quotaEnforcer = result.quotaEnforcer;
    state.paymentRouter = result.paymentRouter;
    state.consensusManager = result.consensusManager;
    state.relayClient = result.relayClient;
    state.nameResolver = result.nameResolver;
    state.appRegistry = result.appRegistry;
    state.appStore = result.appStore;
    state.orchestrator = result.orchestrator;

    // Register mesh tools if tool registry is available
    if (state.browserTools) {
      try {
        registerMeshTools(state.browserTools, state.streamMultiplexer, state.fileTransfer);
        registerIdentityTools(state.browserTools);
        // Register orchestrator tools
        if (state.orchestrator) {
          const meshctlTools = createMeshctlTools(state.orchestrator);
          for (const tool of meshctlTools) state.browserTools.register(tool);
        }
      } catch (e) {
        console.warn('[clawser] Mesh tool registration failed (non-fatal):', e.message);
      }
    }

    console.log('[clawser] P2P mesh initialized via ClawserPod — podId:', state.pod.podId);
  } catch (err) {
    console.warn('[clawser] P2P mesh init failed (non-fatal):', err.message);
    state.peerNode = null;
    state.swarmCoordinator = null;
    state.discoveryManager = null;
    state.transportNegotiator = null;
    state.auditChain = null;
    state.streamMultiplexer = null;
    state.fileTransfer = null;
    state.serviceDirectory = null;
    state.syncEngine = null;
    state.resourceRegistry = null;
    state.meshMarketplace = null;
    state.quotaManager = null;
    state.quotaEnforcer = null;
    state.paymentRouter = null;
    state.consensusManager = null;
    state.relayClient = null;
    state.nameResolver = null;
    state.appRegistry = null;
    state.appStore = null;
    state.orchestrator = null;
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

  // Clear update interval to prevent stale timer stacking
  if (state._updateInterval) { clearInterval(state._updateInterval); state._updateInterval = null; }

  // Stop daemon and routine engine before saving
  state.routineEngine.stop();
  await state.daemonController.stop().catch(() => {});

  // Persist terminal session before switching
  if (state.terminalSessions) {
    await state.terminalSessions.persist().catch(() => {});
  }

  // Destroy kernel tenant for outgoing workspace
  if (_kernelIntegration) {
    const oldWsId = state.agent.getWorkspace();
    _kernelIntegration.destroyWorkspaceTenant(oldWsId);
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
  await state.agent.reinit({});
  state.agent.setWorkspace(newId);
  setActiveWorkspaceId(newId);
  touchWorkspace(newId);

  // Create kernel tenant for incoming workspace (Fix H7)
  if (_kernelIntegration) {
    _kernelIntegration.createWorkspaceTenant(newId);
    _kernelIntegration.hookEventLog(state.agent.eventLog);
  }
  // Wire kernel integration to agent (Fix H8)
  state.agent._kernelIntegration = _kernelIntegration;

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

  // Demo mode: force Echo provider
  if (state.demoMode) {
    const providerSelect = $('providerSelect');
    if (providerSelect) {
      providerSelect.value = 'echo';
      providerSelect.dispatchEvent(new Event('change'));
    }
  }

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
  state.marketplace = new SkillMarketplace();
  restoreSavedChannels(state.channelManager);
  updateChannelBadge();
  // Update gateway tenant ID so subsequent ingests are attributed to the
  // new workspace's kernel tenant. Falls back to null when kernel is absent.
  if (state.gateway) {
    state.gateway.setTenantId(_kernelIntegration?.getWorkspaceTenantId(newId) || null);
  }
  await initMeshSubsystem();
  registerLazyPanelRenders({
    tools:    () => renderToolRegistry(),
    goals:    () => renderGoals(),
    files:    () => { refreshFiles(); renderMountList(); },
    skills:   () => renderSkills(),
    dashboard: () => refreshDashboard(),
    servers:  () => { initServerPanel(); renderServerList(); },
    channels: () => renderChannelPanel(),
    marketplace: () => {
      const container = $('marketplaceContainer');
      if (container && state.marketplace) {
        renderMarketplace(container, state.marketplace, {
          onInstall: () => renderSkills(),
          onUninstall: () => renderSkills(),
        });
      }
    },
    toolMgmt: () => renderToolManagementPanel(),
    agents:   () => { renderAgentPanel(); },
    swarms: () => {
      const c = $('swarmsContainer');
      if (!c) return;
      const podId = state.peerNode?.podId || 'local';
      const sc = state.swarmCoordinator;
      const getSwarms = () => sc?.listSwarms?.() || [];
      const listenerOpts = {
        onCreate: (opts) => {
          if (sc) {
            sc.submitTask(opts.goal, opts.strategy || 'round_robin', {});
            addMsg('system', `Swarm task submitted: "${opts.goal}"`);
          }
        },
        onRefresh: () => {
          c.innerHTML = renderSwarmPanel({ swarms: getSwarms(), localPodId: podId });
          initSwarmListeners(listenerOpts);
        },
      };
      c.innerHTML = renderSwarmPanel({ swarms: getSwarms(), localPodId: podId });
      initSwarmListeners(listenerOpts);
    },
    transfers: () => {
      const c = $('transfersContainer');
      if (!c) return;
      const podId = state.peerNode?.podId || 'local';
      const ft = state.fileTransfer;
      const active = ft?.listTransfers?.({ status: 'transferring' }) || [];
      const history = ft?.listTransfers?.({ status: 'completed' }) || [];
      c.innerHTML = renderTransferPanel({ active, history, localPodId: podId });
      initTransferListeners();
    },
    mesh: () => {
      const c = $('meshContainer');
      if (!c) return;
      const podId = state.peerNode?.podId || 'local';
      const peerLabel = state.peerNode?.wallet?.getDefault()?.label || 'This Pod';
      const peers = state.peerNode?.registry?.listPeers?.() || [];
      const services = state.serviceDirectory?.listAll?.() || [];
      c.innerHTML = renderMeshPanel({
        localPod: { podId, label: peerLabel, uptime: 0 },
        peers,
        resources: (state.resourceRegistry?.listAll?.() || []).flatMap(d =>
          Object.entries(d.resources || {}).filter(([,v]) => v > 0).map(([type, value]) =>
            ({ podId: d.podId, type, used: value, capacity: value })
          )
        ),
        services,
      });
      initMeshListeners();
    },
    peers: () => {
      const c = $('peersContainer');
      if (!c) return;
      if (state.peerNode) {
        c.innerHTML = renderIdentityWallet(state.peerNode) + renderContactBook(state.peerNode.wallet) + renderConnectionPanel(state.peerNode) + renderAuditLog(state.peerNode);
        initIdentityWalletListeners(state.peerNode);
        initContactBookListeners(state.peerNode.wallet);
        initConnectionListeners(state.peerNode);
        initAuditLogListeners(state.peerNode);
      } else {
        c.innerHTML = '<div class="peer-empty" style="padding:1.5rem;opacity:0.6">P2P peer subsystem not initialized. Start a mesh session to enable peer management.</div>';
      }
    },
    remote: () => {
      const c = $('remoteContainer');
      if (!c) return;
      if (state.peerNode) {
        const svcDir = state.serviceDirectory;
        if (svcDir) {
          c.innerHTML = renderServiceBrowser(svcDir);
        } else {
          c.innerHTML = '<div class="rc-empty" style="padding:1.5rem;opacity:0.6">Service directory not initialized. Mesh subsystem may still be starting.</div>';
        }
        updatePeerBadge(state.peerNode);
      } else {
        c.innerHTML = '<div class="rc-empty" style="padding:1.5rem;opacity:0.6">Remote access requires an active peer connection. Start a mesh session first.</div>';
      }
    },
  });

  updateState();

  // Restart daemon and routine engine for new workspace
  try {
    const started = await state.daemonController.start();
    if (started) updateDaemonBadge(state.daemonController.phase);
  } catch (e) { console.warn('[clawser] daemon start failed on switch', e); }
  try {
    const savedRoutines = JSON.parse(localStorage.getItem(lsKey.routines(newId)) || 'null');
    if (savedRoutines) state.routineEngine.fromJSON(savedRoutines);
  } catch (e) { console.warn('[clawser] routine restore failed', e); }
  state.routineEngine.start();

  // Sync routine state to IndexedDB for background runners (Tier 1/3)
  await syncRoutinesToIDB();

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
      metricsCollector: state.metricsCollector,
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

    // Wire RoutineEngine for scheduler delegation
    state.agent.setRoutineEngine(state.routineEngine);

    // Wire account resolver for agent/fallback credential resolution
    state.agent.setAccountResolver(async (accountId) => {
      const { loadAccounts, resolveAccountKey } = await import('./clawser-accounts.js');
      const accts = loadAccounts();
      const acct = accts.find(a => a.id === accountId);
      if (!acct) return { apiKey: '', baseUrl: '', service: '', model: '' };
      const apiKey = await resolveAccountKey(acct);
      return { apiKey, baseUrl: acct.baseUrl || '', service: acct.service, model: acct.model };
    });

    // Create kernel tenant for this workspace (Step 23)
    if (_kernelIntegration) {
      _kernelIntegration.createWorkspaceTenant(wsId);
      _kernelIntegration.hookEventLog(state.agent.eventLog);
    }
    // Wire kernel integration to agent (Fix H8)
    state.agent._kernelIntegration = _kernelIntegration;

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

    // Local AI Models (11)
    if (!state.modelManager) {
      state.modelManager = new ModelManager();
    }
    state.browserTools.register(new ModelListTool(state.modelManager));
    state.browserTools.register(new ModelPullTool(state.modelManager));
    state.browserTools.register(new ModelRemoveTool(state.modelManager));
    state.browserTools.register(new ModelStatusTool(state.modelManager));
    state.browserTools.register(new TranscribeTool(state.modelManager));
    state.browserTools.register(new SpeakTool(state.modelManager));
    state.browserTools.register(new CaptionTool(state.modelManager));
    state.browserTools.register(new OcrTool(state.modelManager));
    state.browserTools.register(new DetectObjectsTool(state.modelManager));
    state.browserTools.register(new ClassifyImageTool(state.modelManager));
    state.browserTools.register(new ClassifyTextTool(state.modelManager));

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
      toolSpecs: () => state.browserTools.allSpecs(),
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

    // wsh — Web Shell (10 tools)
    registerWshTools(state.browserTools);

    // netway — Virtual Networking (8 tools)
    registerNetwayTools(state.browserTools);

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

    // Routines (7)
    state.browserTools.register(new RoutineCreateTool(state.routineEngine));
    state.browserTools.register(new RoutineListTool(state.routineEngine));
    state.browserTools.register(new RoutineDeleteTool(state.routineEngine));
    state.browserTools.register(new RoutineRunTool(state.routineEngine));
    state.browserTools.register(new RoutineHistoryTool(state.routineEngine));
    state.browserTools.register(new RoutineToggleTool(state.routineEngine));
    state.browserTools.register(new RoutineUpdateTool(state.routineEngine));

    // Self-Repair (2)
    state.browserTools.register(new SelfRepairStatusTool(state.selfRepairEngine));
    state.browserTools.register(new SelfRepairConfigureTool(state.selfRepairEngine));

    // Undo/Redo (3)
    state.browserTools.register(new UndoTool(state.undoManager));
    state.browserTools.register(new UndoStatusTool(state.undoManager));
    state.browserTools.register(new RedoTool(state.undoManager));

    // Intent (2)
    state.browserTools.register(new IntentClassifyTool(state.intentRouter));
    state.browserTools.register(new IntentOverrideTool(state.intentRouter));

    // Heartbeat (2)
    state.browserTools.register(new HeartbeatStatusTool(state.heartbeatRunner));
    state.browserTools.register(new HeartbeatRunTool(state.heartbeatRunner));

    // Skills Registry (5)
    state.browserTools.register(new SkillSearchTool(state.skillRegistryClient));
    state.browserTools.register(new SkillInstallTool(state.skillRegistryClient, state.skillRegistry, () => getActiveWorkspaceId()));
    state.browserTools.register(new SkillUpdateTool(state.skillRegistryClient, state.skillRegistry, () => getActiveWorkspaceId()));
    state.browserTools.register(new SkillRemoveTool(state.skillRegistry, () => getActiveWorkspaceId()));
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

      // Seed built-in accounts (echo, chrome-ai) and migrate unlinked agents
      try {
        const { seedBuiltinAccounts, loadAccounts } = await import('./clawser-accounts.js');
        const { migrateAgentAccounts } = await import('./clawser-agent-storage.js');
        seedBuiltinAccounts();
        if (!localStorage.getItem('clawser_agent_acct_migrated')) {
          const migrated = await migrateAgentAccounts(loadAccounts(), state.agentStorage);
          if (migrated > 0) console.log(`[clawser] Migrated ${migrated} agents to accounts`);
          localStorage.setItem('clawser_agent_acct_migrated', '1');
        }
      } catch (e) { console.warn('[clawser] Agent account seeding/migration failed:', e); }

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
        await state.agent.applyAgent(activeAgent);
        updateAgentLabel(activeAgent);
      }
    } catch (e) {
      console.warn('[clawser] Agent storage init failed:', e);
    }

    // Chrome Extension — real browser control (34 tools)
    registerExtensionTools(state.browserTools);
    initExtensionBadge();

    // Virtual Server subsystem (Phase 7) — 8 tools
    try {
      await initServerManager();
      registerServerTools(state.browserTools, () => getActiveWorkspaceId());
    } catch (e) { console.warn('[clawser] Server manager init failed:', e); }

    // Phase 7: Remote Gateway Server
    try {
      const gw = new GatewayServer({
        pairing: state.pairingManager,
        agent: state.agent,
        serverManager: getServerManager(),
      });
      state.gatewayServer = gw;
    } catch (e) { console.warn('[clawser] Gateway server init failed:', e); }

    // Phase 8: OAuth integration tools (7 Google + 4 Notion + 3 Slack + 3 Linear = 17)
    // Tools receive the OAuthManager and call getClient(provider) internally
    const oauth = state.oauthManager;
    state.browserTools.register(new GoogleCalendarListTool(oauth));
    state.browserTools.register(new GoogleCalendarCreateTool(oauth));
    state.browserTools.register(new GoogleGmailSearchTool(oauth));
    state.browserTools.register(new GoogleGmailSendTool(oauth));
    state.browserTools.register(new GoogleDriveListTool(oauth));
    state.browserTools.register(new GoogleDriveReadTool(oauth));
    state.browserTools.register(new GoogleDriveCreateTool(oauth));
    state.browserTools.register(new NotionSearchTool(oauth));
    state.browserTools.register(new NotionCreatePageTool(oauth));
    state.browserTools.register(new NotionUpdatePageTool(oauth));
    state.browserTools.register(new NotionQueryDatabaseTool(oauth));
    state.browserTools.register(new SlackChannelsTool(oauth));
    state.browserTools.register(new SlackPostTool(oauth));
    state.browserTools.register(new SlackHistoryTool(oauth));
    state.browserTools.register(new LinearIssuesTool(oauth));
    state.browserTools.register(new LinearCreateIssueTool(oauth));
    state.browserTools.register(new LinearUpdateIssueTool(oauth));

    // Phase 8: Integration wrappers (3 GitHub + 3 Calendar + 3 Email + 2 Slack = 11)
    state.browserTools.register(new GitHubPrReviewTool(oauth));
    state.browserTools.register(new GitHubIssueCreateTool(oauth));
    state.browserTools.register(new GitHubCodeSearchTool(oauth));
    state.browserTools.register(new CalendarAwarenessTool(oauth));
    state.browserTools.register(new CalendarFreeBusyTool(oauth));
    state.browserTools.register(new CalendarQuickAddTool(oauth));
    state.browserTools.register(new EmailDraftTool(oauth));
    state.browserTools.register(new EmailSummarizeTool(oauth));
    state.browserTools.register(new EmailTriageTool(oauth));
    state.browserTools.register(new SlackMonitorTool(oauth));
    state.browserTools.register(new SlackDraftResponseTool(oauth));

    // Phase 9: CORS fetch proxy (1)
    state.browserTools.register(new ExtCorsFetchTool(getExtensionClient()));
    setCorsFetchClient(getExtensionClient());

    // Phase 5: FileSystemObserver (optional, Chrome 129+)
    try {
      state.fsObserver = new FsObserver();
    } catch (e) { /* FsObserver unavailable in this browser */ }

    // Phase 5: TabViewManager
    try {
      state.tabViewManager = new TabViewManager();
    } catch (e) { /* Tab views unavailable */ }

    state.agent.refreshToolSpecs();

    // Wire safety pipeline into tool registry for defense-in-depth
    // (catches Codex path, executeToolDirect, and any direct registry calls)
    if (state.safetyPipeline) {
      state.browserTools.setSafety(state.safetyPipeline);
    }

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

    // Initialize FallbackExecutor from saved chain (uses account resolver wired above)
    try {
      const chainRaw = localStorage.getItem(`clawser_fallback_chain_${activeWsId}`);
      if (chainRaw) {
        const entries = JSON.parse(chainRaw);
        if (Array.isArray(entries) && entries.length > 0) {
          const chain = new FallbackChain({ entries });
          const executor = new FallbackExecutor(chain, {
            onLog: (lvl, msg) => console.log(`[fallback] ${msg}`),
          });
          state.agent.setFallbackExecutor(executor);
          state.fallbackChain = entries;
        }
      }
    } catch (e) { console.warn('[clawser] FallbackExecutor init failed:', e); }

    await applyRestoredConfig(savedConfig);

    // Demo mode: force Echo provider
    if (state.demoMode) {
      const providerSelect = $('providerSelect');
      if (providerSelect) {
        providerSelect.value = 'echo';
        providerSelect.dispatchEvent(new Event('change'));
      }
    }

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

    // SharedWorker opt-in
    await initSharedWorkerFromConfig();

    // Build default routing chains from available providers (B3)
    try {
      const providerIds = state.providers ? [...(await state.providers.listWithAvailability().catch(() => []))].map(p => p.name) : [];
      if (providerIds.length > 0) state.modelRouter.buildDefaults(providerIds);
    } catch (e) { console.warn('[clawser] modelRouter buildDefaults failed', e); }

    // Start daemon controller (B4)
    try {
      const daemonStarted = await state.daemonController.start();
      if (daemonStarted) updateDaemonBadge(state.daemonController.phase);
    } catch (e) { console.warn('[clawser] daemon start failed', e); }

    // Start routine engine (B5)
    try {
      const savedRoutines = JSON.parse(localStorage.getItem(lsKey.routines(activeWsId)) || 'null');
      if (savedRoutines) state.routineEngine.fromJSON(savedRoutines);
    } catch (e) { console.warn('[clawser] routine restore failed', e); }
    state.routineEngine.start();

    // Sync routine state to IndexedDB for background runners (Tier 1/3)
    await syncRoutinesToIDB();

    await state.skillRegistry.discover(activeWsId);

    // Init marketplace
    state.marketplace = new SkillMarketplace();

    // Restore saved channels
    restoreSavedChannels(state.channelManager);
    updateChannelBadge();

    // ── Channel Gateway ──
    // Central hub for all inbound channel messages → agent → outbound responses.
    // tenantId comes from the kernel integration so each message is attributable
    // to the workspace's kernel tenant for resource tracking and isolation.
    state.gateway = new ChannelGateway({
      agent: state.agent,
      tenantId: _kernelIntegration?.getWorkspaceTenantId(wsId) || null,
      onIngest: (channelId, msg) => {
        addMsg('user', msg.content, null, channelId);
      },
      onRespond: (channelId, text) => {
        addMsg('agent', text, null, channelId);
      },
      onLog: (msg) => console.log(`[gateway] ${msg}`),
    });

    // Wire gateway to WSH incoming sessions
    try {
      const { setAgentGateway } = await import('./clawser-wsh-incoming.js');
      setAgentGateway(state.gateway);
    } catch (e) { console.warn('[clawser] gateway→wsh wire failed', e); }

    // ── P2P mesh initialization ──
    await initMeshSubsystem();

    // ── Deferred renders: non-config panels (Gap 11.1) ──
    // These panels keep empty DOM until the user first clicks on them.
    registerLazyPanelRenders({
      tools:    () => renderToolRegistry(),
      files:    () => { refreshFiles(); renderMountList(); },
      goals:    () => renderGoals(),
      skills:   () => renderSkills(),
      toolMgmt: () => renderToolManagementPanel(),
      agents:   () => { renderAgentPanel(); },
      dashboard: () => refreshDashboard(),
      servers:  () => { initServerPanel(); renderServerList(); },
      channels: () => renderChannelPanel(),
      marketplace: () => {
        const container = $('marketplaceContainer');
        if (container && state.marketplace) {
          renderMarketplace(container, state.marketplace, {
            onInstall: () => renderSkills(),
            onUninstall: () => renderSkills(),
          });
        }
      },
      swarms: () => {
        const c = $('swarmsContainer');
        if (!c) return;
        const podId = state.peerNode?.podId || 'local';
        const sc = state.swarmCoordinator;
        const getSwarms = () => sc?.listSwarms?.() || [];
        const listenerOpts = {
          onCreate: (opts) => {
            if (sc) {
              sc.submitTask(opts.goal, opts.strategy || 'round_robin', {});
              addMsg('system', `Swarm task submitted: "${opts.goal}"`);
            }
          },
          onRefresh: () => {
            c.innerHTML = renderSwarmPanel({ swarms: getSwarms(), localPodId: podId });
            initSwarmListeners(listenerOpts);
          },
        };
        c.innerHTML = renderSwarmPanel({ swarms: getSwarms(), localPodId: podId });
        initSwarmListeners(listenerOpts);
      },
      transfers: () => {
        const c = $('transfersContainer');
        if (!c) return;
        const podId = state.peerNode?.podId || 'local';
        const ft = state.fileTransfer;
        const active = ft?.listTransfers?.({ status: 'transferring' }) || [];
        const history = ft?.listTransfers?.({ status: 'completed' }) || [];
        c.innerHTML = renderTransferPanel({ active, history, localPodId: podId });
        initTransferListeners();
      },
      mesh: () => {
        const c = $('meshContainer');
        if (!c) return;
        const podId = state.peerNode?.podId || 'local';
        const peerLabel = state.peerNode?.wallet?.getDefault()?.label || 'This Pod';
        const peers = state.peerNode?.registry?.listPeers?.() || [];
        const services = state.serviceDirectory?.listAll?.() || [];
        c.innerHTML = renderMeshPanel({
          localPod: { podId, label: peerLabel, uptime: 0 },
          peers,
          resources: (state.resourceRegistry?.listAll?.() || []).flatMap(d =>
          Object.entries(d.resources || {}).filter(([,v]) => v > 0).map(([type, value]) =>
            ({ podId: d.podId, type, used: value, capacity: value })
          )
        ),
          services,
        });
        initMeshListeners();
      },
      peers: () => {
        const c = $('peersContainer');
        if (!c) return;
        if (state.peerNode) {
          c.innerHTML = renderIdentityWallet(state.peerNode) + renderContactBook(state.peerNode.wallet) + renderConnectionPanel(state.peerNode) + renderAuditLog(state.peerNode);
          initIdentityWalletListeners(state.peerNode);
          initContactBookListeners(state.peerNode.wallet);
          initConnectionListeners(state.peerNode);
          initAuditLogListeners(state.peerNode);
        } else {
          c.innerHTML = '<div class="peer-empty" style="padding:1.5rem;opacity:0.6">P2P peer subsystem not initialized. Start a mesh session to enable peer management.</div>';
        }
      },
      remote: () => {
        const c = $('remoteContainer');
        if (!c) return;
        if (state.peerNode) {
          const svcDir = state.serviceDirectory;
          if (svcDir) {
            c.innerHTML = renderServiceBrowser(svcDir);
          } else {
            c.innerHTML = '<div class="rc-empty" style="padding:1.5rem;opacity:0.6">Service directory not initialized. Mesh subsystem may still be starting.</div>';
          }
          updatePeerBadge(state.peerNode);
        } else {
          c.innerHTML = '<div class="rc-empty" style="padding:1.5rem;opacity:0.6">Remote access requires an active peer connection. Start a mesh session first.</div>';
        }
      },
    });

    // Agent picker must be initialized eagerly — it attaches to the
    // header provider label which is visible on every page load.
    initAgentPicker();

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
