/**
 * clawser-workspace-lifecycle.js — Workspace creation, switching, and initialization
 *
 * Orchestrator that delegates to:
 *   - clawser-workspace-init-tools.js  — tool registration
 *   - clawser-workspace-init-ui.js     — lazy panel rendering
 *   - clawser-workspace-init-mesh.js   — mesh/P2P/channel/remote-runtime
 *
 * Keeps: kernel integration state, syncRoutinesToIDB, createShellSession,
 *        cleanupWorkspace, switchWorkspace, initWorkspace.
 */
import { $, state, lsKey, setSending, setConversation, resetConversationState, on, emit } from './clawser-state.js';
import { modal } from './clawser-modal.js';
import { loadWorkspaces, setActiveWorkspaceId, getActiveWorkspaceId, ensureDefaultWorkspace, getWorkspaceName, touchWorkspace } from './clawser-workspaces.js';
import { loadConversations } from './clawser-conversations.js';
import { saveConfig, applyRestoredConfig, rebuildProviderDropdown, setupProviders } from './clawser-accounts.js';
import { updateRouteHash, PANELS, resetRenderedPanels, isPanelRendered } from './clawser-router.js';
import { setStatus, addMsg, addErrorMsg, addToolCall, addInlineToolCall, updateInlineToolCall, addEvent, updateState, updateCostDisplay, replaySessionHistory, replayFromEvents, updateConvNameDisplay, persistActiveConversation, renderToolCalls, resetChatUI } from './clawser-ui-chat.js';
import { renderGoals, renderToolRegistry, renderSkills, applySecuritySettings, renderAutonomySection, renderIdentitySection, renderRoutingSection, renderAuthProfilesSection, renderSelfRepairSection, updateCacheStats, renderLimitsSection, renderSandboxSection, renderHeartbeatSection, updateCostMeter, updateAutonomyBadge, updateDaemonBadge, refreshDashboard, renderOAuthSection, renderTerminalSessionBar, replayTerminalSession, initAgentPicker, updateAgentLabel, restoreSavedChannels, updateChannelBadge, initSharedWorkerFromConfig } from './clawser-ui-panels.js';
import { TerminalSessionManager } from './clawser-terminal-sessions.js';

import { ClawserAgent } from './clawser-agent.js';
import { createDefaultRegistry, WorkspaceFs } from './clawser-tools.js';

import { SkillMarketplace } from './clawser-marketplace.js';
import { createConfiguredShell } from './clawser-shell-factory.js';

// Fallback chain
import { FallbackChain, FallbackExecutor } from './clawser-fallback.js';

// ── Extracted modules ────────────────────────────────────────────
import { registerAllTools } from './clawser-workspace-init-tools.js';
import { registerLazyPanelRenders, buildLazyPanelConfig } from './clawser-workspace-init-ui.js';
import {
  initMeshSubsystem,
  createMeshAgentHost,
  getReverseVirtualTerminalManager,
  configureServerRuntimeResolver,
  refreshReverseVirtualTerminalManager,
  renderRemoteRuntimeWorkspacePanel,
  createChannelGateway,
} from './clawser-workspace-init-mesh.js';

// Re-export for external consumers
export { createMeshAgentHost, getReverseVirtualTerminalManager };

// ── Kernel integration (optional — no-op if kernel not initialized) ──
let _kernelIntegration = null;
/** Set the kernel integration adapter for workspace lifecycle hooks. */
export function setKernelIntegration(ki) { _kernelIntegration = ki; }
/** Get the current kernel integration adapter. */
export function getKernelIntegration() { return _kernelIntegration; }

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

// ── Cleanup workspace ──────────────────────────────────────────
/** Tear down the current workspace: stop services, persist state, destroy kernel tenant.
 * Must be called before switching or destroying a workspace to prevent state leaks.
 */
export async function cleanupWorkspace() {
  if (!state.agent) return;

  // Clear update interval to prevent stale timer stacking
  if (state._updateInterval) { clearInterval(state._updateInterval); state._updateInterval = null; }

  // Stop daemon and routine engine before saving
  state.routineEngine.stop();
  await state.daemonController.stop().catch(e => console.warn('[clawser] Daemon stop:', e.message));

  // Persist terminal session before switching
  if (state.terminalSessions) {
    await state.terminalSessions.persist().catch(e => console.warn('[clawser] Terminal persist:', e.message));
  }

  // Destroy kernel tenant for outgoing workspace
  if (_kernelIntegration) {
    const oldWsId = state.agent.getWorkspace();
    _kernelIntegration.destroyWorkspaceTenant(oldWsId);
  }

  // Save current workspace state
  await persistActiveConversation();
  state.agent.persistMemories();
  await state.agent.persistCheckpoint();
  saveConfig();

  // Save routine state
  try {
    const wsId = state.agent.getWorkspace();
    const routineData = state.routineEngine.toJSON();
    if (routineData) localStorage.setItem(lsKey.routines(wsId), JSON.stringify(routineData));
  } catch (e) { console.warn('[clawser] routine save failed', e); }

  // Shut down the ClawserPod (stops peer node, sync engine, relay, etc.)
  if (state.pod) {
    try { await state.pod.shutdown(); } catch { /* best-effort */ }
  }

  // Stop channel gateway
  if (state.gateway) {
    try { state.gateway.stop(); } catch { /* best-effort */ }
  }

  // Deactivate all skills
  if (state.skillRegistry) {
    for (const name of [...state.skillRegistry.activeSkills.keys()]) {
      state.skillRegistry.deactivate(name);
    }
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

  await cleanupWorkspace();

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
  registerLazyPanelRenders(buildLazyPanelConfig(() => renderRemoteRuntimeWorkspacePanel()));

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

    // ── Register all tools ──────────────────────────────────────
    await registerAllTools({ activeWsId, configureServerRuntimeResolver });

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
    // If an active agent was restored, keep its styled label; otherwise use dropdown text
    const activeAgent = state.agentStorage ? await state.agentStorage.getActive() : null;
    if (activeAgent) {
      updateAgentLabel(activeAgent);
    } else {
      $('providerLabel').textContent = providerSelect.options[providerSelect.selectedIndex]?.textContent || providerSelect.value;
    }

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
    state.gateway = createChannelGateway(wsId, _kernelIntegration);

    // Wire gateway to WSH incoming sessions
    try {
      const { setAgentGateway } = await import('./clawser-wsh-incoming.js');
      setAgentGateway(state.gateway);
    } catch (e) { console.warn('[clawser] gateway→wsh wire failed', e); }

    // ── P2P mesh initialization ──
    await initMeshSubsystem();

    // ── Deferred renders: non-config panels (Gap 11.1) ──
    registerLazyPanelRenders(buildLazyPanelConfig(() => renderRemoteRuntimeWorkspacePanel()));

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
