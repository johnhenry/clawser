/**
 * clawser-workspace-init-mesh.js — Mesh/P2P/channel/remote-runtime initialization
 *
 * Extracted from workspace-lifecycle. Contains:
 *   - initMeshSubsystem()       — boot ClawserPod and layer mesh networking
 *   - createMeshAgentHost()     — wire PeerSession agent bridge
 *   - configureServerRuntimeResolver()
 *   - Remote runtime panel state + rendering
 *   - VirtualTerminalManager + BrowserVmConsoleRegistry lifecycle
 *   - ChannelGateway creation helper
 */
import { $, state, DEFAULTS } from './clawser-state.js';
import { modal } from './clawser-modal.js';
import { getActiveWorkspaceId } from './clawser-workspaces.js';
import { isPanelRendered } from './clawser-router.js';
import { renderMeshPanel, initMeshListeners } from './clawser-ui-mesh.js';
import { addMsg, addErrorMsg } from './clawser-ui-chat.js';
import { buildMeshController } from './clawser-mesh-controller.mjs';
import { bridgePeerAgent } from 'browsermesh-apps';
import { ChannelGateway } from './clawser-gateway.js';
import { ClawserPod } from './clawser-pod.js';
import { registerMeshTools } from 'browsermesh-apps';
import { PresenceService, presenceChangeMessage } from './clawser-presence.mjs';
import { evaluateAlertRules, recordMetricSample } from './clawser-mesh-alert-rules.mjs';
import { installMultiDeviceWiring, uninstallMultiDeviceWiring } from './clawser-multi-device.mjs';
import { SkillStorage } from './clawser-skills.js';
import { writeConfig as writeFsConfig } from './clawser-fs-config.mjs';
import { approvalModalPrompt } from './clawser-approval-modal.mjs';
import { registerMeshPeerTools, registerIdentityTools } from 'browsermesh-core';
import { createMeshctlTools } from 'browsermesh-apps';
import { getServerManager, setServerRuntimeServiceResolver } from './clawser-server.js';
import { bindServerManagerServices } from './clawser-server-services.js';
import { listReverseExposureRegistrations } from './clawser-wsh-tools.js';
import { VirtualTerminalManager } from './clawser-wsh-virtual-terminal-manager.js';
import { RemoteMountManager } from './clawser-remote-mounts.js';
import { BrowserVmConsoleRegistry, createBuiltinVmImages } from './clawser-vm-console.js';
import { listIncomingSessions } from './clawser-wsh-incoming.js';
import { createConfiguredShell } from './clawser-shell-factory.js';
import {
  initRemoteFilesListeners,
  initRemoteRuntimePanelListeners,
  initRemoteTerminalListeners,
  renderRemoteRuntimePanel,
  updatePeerBadge,
} from './clawser-ui-remote.js'
import { CollabManager } from 'browsermesh-sync';
import { silentCatch } from './clawser-silent-catch.mjs'

// ── Module-level state ───────────────────────────────────────────
let _reverseVirtualTerminalManager = null;
let _browserVmConsoleRegistry = null;

export function getReverseVirtualTerminalManager() {
  return _reverseVirtualTerminalManager;
}

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

// ── Remote Runtime Panel helpers ─────────────────────────────────

function getRemoteRuntimePanelState() {
  if (!state.ui.remoteRuntimePanel) {
    state.ui.remoteRuntimePanel = {
      activeSelector: null,
      activeView: null,
      activeServices: [],
      routeExplanation: null,
      error: null,
      localExposure: [],
      filterText: '',
      filterCapability: '',
      filterPeerType: '',
      telemetry: null,
      auditEntries: [],
      vmError: null,
    };
  }
  return state.ui.remoteRuntimePanel;
}

function currentRemoteAuditEntries(limit = 20) {
  const entries = state.auditChain?.slice?.(-Math.max(limit * 4, 40)) || [];
  const activeSelector = getRemoteRuntimePanelState().activeSelector;
  return entries
    .filter((entry) => entry?.operation?.startsWith?.('remote_'))
    .filter((entry) => {
      if (!activeSelector) return true;
      const selector = entry?.data?.selector || entry?.data?.canonicalId || entry?.data?.podId || null;
      return !selector || selector === activeSelector;
    })
    .slice(-limit)
    .reverse()
    .map((entry) => ({
      sequence: entry.sequence,
      timestamp: entry.timestamp,
      operation: entry.operation,
      actor: entry.data?.actor || entry.authorPodId || 'system',
      selector: entry.data?.selector || entry.data?.canonicalId || entry.data?.podId || null,
      layer: entry.data?.layer || entry.data?.failure?.layer || entry.data?.route?.kind || null,
      outcome: entry.data?.outcome || entry.data?.status || null,
      summary: entry.data?.reason
        || entry.data?.error
        || entry.data?.command
        || entry.data?.path
        || entry.data?.toolName
        || entry.data?.serviceName
        || null,
    }));
}

export function configureServerRuntimeResolver() {
  setServerRuntimeServiceResolver(async ({ kind, selector = null, serviceName = null }) => {
    const registry = state.remoteRuntimeRegistry;
    if (!registry) {
      throw new Error('Remote runtime registry is not available');
    }

    if (kind === 'service') {
      const service = registry.resolveService(serviceName);
      if (!service) {
        throw new Error(`Unknown runtime service: ${serviceName}`);
      }
      return service;
    }

    if (kind === 'runtime-service') {
      const service = registry.resolvePeerService(selector, serviceName);
      if (!service) {
        throw new Error(`Unknown runtime service: ${selector}/${serviceName}`);
      }
      return service;
    }

    if (kind === 'managed-server') {
      const server = registry.resolveManagedServer(selector, serviceName);
      if (!server) {
        throw new Error(`Unknown managed runtime server: ${selector}/${serviceName}`);
      }
      return server;
    }

    if (kind === 'endpoint') {
      const endpoint = registry.resolveEndpoint(serviceName);
      if (!endpoint) {
        throw new Error(`Unknown runtime endpoint: ${serviceName}`);
      }
      return endpoint;
    }

    throw new Error(`Unsupported runtime service lookup kind: ${kind}`);
  });
}

function localExposureStatus() {
  const incomingByHost = new Map();
  for (const session of listIncomingSessions()) {
    const host = session.host || 'local'
    incomingByHost.set(host, (incomingByHost.get(host) || 0) + 1)
  }
  return listReverseExposureRegistrations().map((entry) => ({
    ...entry,
    activeIncomingSessions: incomingByHost.get(entry.host) || 0,
  }));
}

function remoteRuntimePeerSession(peer) {
  return {
    pubKey: peer?.identity?.fingerprint || peer?.identity?.canonicalId || '',
    remotePodId: peer?.identity?.podId || peer?.identity?.canonicalId || '',
  };
}

function mergePeerServices(peer, discoveredServices = [], brokerServices = []) {
  const services = new Map();
  for (const service of discoveredServices || []) {
    const key = service.address || `${service.podId || 'peer'}:${service.name || 'service'}`;
    services.set(key, { ...service });
  }
  for (const service of brokerServices || []) {
    const key = service.address || `${service.podId || 'peer'}:${service.name || 'service'}`;
    services.set(key, { ...service });
  }
  for (const service of Object.values(peer?.metadata?.serviceDetails || {})) {
    const key = service.address || `${service.podId || peer?.identity?.podId || 'peer'}:${service.name || 'service'}`;
    services.set(key, { ...service });
  }
  return [...services.values()].sort((left, right) => (left.name || '').localeCompare(right.name || ''));
}

function createBrokerTerminalClient(selector) {
  return {
    async execute(command) {
      const result = await state.remoteSessionBroker.openSession(selector, {
        intent: 'exec',
        command,
      });
      return {
        output: result?.output ?? '',
        exitCode: result?.exitCode ?? 0,
        route: result?.route || null,
      };
    },
  };
}

function normalizeBrokerFileRead(result) {
  if (result?.data instanceof Uint8Array || typeof result?.data === 'string') {
    return result;
  }
  if (typeof result?.content === 'string') {
    return { data: result.content, size: result.content.length };
  }
  return { data: '', size: 0 };
}

function createBrokerFileClient(selector) {
  return {
    async listFiles(path) {
      const result = await state.remoteSessionBroker.openSession(selector, {
        intent: 'files',
        requiredCapabilities: ['fs'],
        operation: 'list',
        path,
      });
      return result?.entries || [];
    },
    async readFile(path) {
      const result = await state.remoteSessionBroker.openSession(selector, {
        intent: 'files',
        requiredCapabilities: ['fs'],
        operation: 'read',
        path,
      });
      return normalizeBrokerFileRead(result);
    },
    async writeFile(path, data) {
      return await state.remoteSessionBroker.openSession(selector, {
        intent: 'files',
        requiredCapabilities: ['fs'],
        operation: 'write',
        path,
        data,
      });
    },
    async deleteFile(path) {
      return await state.remoteSessionBroker.openSession(selector, {
        intent: 'files',
        requiredCapabilities: ['fs'],
        operation: 'remove',
        path,
      });
    },
  };
}

async function openRemoteRuntimeView(selector, view) {
  const panelState = getRemoteRuntimePanelState();
  const registry = state.remoteRuntimeRegistry;
  const broker = state.remoteSessionBroker;
  const peer = registry?.resolvePeer?.(selector);
  if (!registry || !broker || !peer) {
    panelState.error = `Unknown remote runtime: ${selector}`;
    renderRemoteRuntimeWorkspacePanel();
    return;
  }

  try {
    panelState.error = null;
    panelState.activeSelector = selector;

    if (view === 'terminal') {
      panelState.routeExplanation = broker.explainRoute(selector, {
        intent: 'exec',
      });
      panelState.activeView = {
        kind: 'terminal',
        client: createBrokerTerminalClient(selector),
        session: remoteRuntimePeerSession(peer),
      };
      panelState.activeServices = [];
    } else if (view === 'files') {
      panelState.routeExplanation = broker.explainRoute(selector, {
        intent: 'files',
        requiredCapabilities: ['fs'],
      });
      panelState.activeView = {
        kind: 'files',
        client: createBrokerFileClient(selector),
        session: remoteRuntimePeerSession(peer),
      };
      panelState.activeServices = [];
    } else if (view === 'services') {
      panelState.routeExplanation = broker.explainRoute(selector, {
        intent: 'service',
      });
      const brokerResult = await broker.openSession(selector, { intent: 'service' });
      const discovered = state.serviceBrowser?.getServicesByPod?.(peer.identity?.podId || '') || [];
      panelState.activeServices = mergePeerServices(peer, discovered, brokerResult?.services || []);
      panelState.activeView = {
        kind: 'services',
        session: remoteRuntimePeerSession(peer),
      };
    } else if (view === 'servers') {
      panelState.routeExplanation = broker.explainRoute(selector, {
        intent: 'server-management',
      });
      panelState.activeServices = registry.listManagedServers({
        peerFilter: { selector },
        podId: peer.identity?.podId || peer.identity?.fingerprint || peer.identity?.canonicalId || null,
      });
      panelState.activeView = {
        kind: 'servers',
        session: remoteRuntimePeerSession(peer),
      };
    }
  } catch (error) {
    const intent = view === 'files'
      ? 'files'
      : view === 'services'
        ? 'service'
        : view === 'servers'
          ? 'server-management'
          : 'exec';
    panelState.error = describeRemoteRuntimeError(error);
    panelState.routeExplanation = routeExplanationFromError(selector, intent, error);
  }

  renderRemoteRuntimeWorkspacePanel();
}

function explainRemoteRuntimeRoute(selector) {
  const panelState = getRemoteRuntimePanelState();
  const intentOptions = remotePanelIntentOptions(panelState);
  try {
    panelState.error = null;
    panelState.activeSelector = selector;
    panelState.routeExplanation = state.remoteSessionBroker.explainRoute(
      selector,
      intentOptions
    );
  } catch (error) {
    panelState.error = describeRemoteRuntimeError(error);
    panelState.routeExplanation = routeExplanationFromError(selector, intentOptions.intent, error);
  }
  renderRemoteRuntimeWorkspacePanel();
}

function remotePanelIntentOptions(panelState) {
  return panelState.activeView?.kind === 'files'
    ? { intent: 'files', requiredCapabilities: ['fs'] }
    : panelState.activeView?.kind === 'services'
      ? { intent: 'service' }
      : panelState.activeView?.kind === 'servers'
        ? { intent: 'server-management' }
      : { intent: 'exec' };
}

function describeRemoteRuntimeError(error) {
  if (!error) return 'Unknown remote runtime error';
  const layer = error.layer ? `[${error.layer}] ` : '';
  return `${layer}${error.message || String(error)}`;
}

function routeExplanationFromError(selector, intent, error) {
  return {
    connectionKind: 'failed',
    reason: error?.message || String(error),
    target: { selector, intent },
    descriptor: { capabilities: [] },
    health: {
      health: error?.layer === 'routing' ? 'degraded' : 'failed',
      lastOutcomeReason: error?.message || String(error),
      lastOutcomeLayer: error?.layer || 'unknown',
    },
    resumability: { replayMode: 'unsupported' },
    warnings: [
      error?.layer ? `layer:${error.layer}` : null,
      error?.code ? `code:${error.code}` : null,
    ].filter(Boolean),
    alternatives: [],
    failure: {
      layer: error?.layer || 'unknown',
      code: error?.code || 'remote-session-error',
    },
  };
}

export function renderRemoteRuntimeWorkspacePanel() {
  const container = $('remoteContainer');
  if (!container) return;
  if (!state.peerNode) {
    container.innerHTML = '<div class="rc-empty" style="padding:1.5rem;opacity:0.6">Remote access requires an active peer connection. Start a mesh session first.</div>';
    return;
  }
  if (!state.remoteRuntimeRegistry || !state.remoteSessionBroker) {
    container.innerHTML = '<div class="rc-empty" style="padding:1.5rem;opacity:0.6">Remote runtime services are still initializing.</div>';
    return;
  }

  bindRemoteRuntimePanelEvents();

  const panelState = getRemoteRuntimePanelState();
  panelState.localExposure = localExposureStatus();
  panelState.telemetry = state.remoteSessionBroker?.telemetrySnapshot?.() || null;
  panelState.auditEntries = currentRemoteAuditEntries();
  container.innerHTML = renderRemoteRuntimePanel(state.remoteRuntimeRegistry, {
    ...panelState,
    vmRuntimes: _browserVmConsoleRegistry?.list?.() || [],
    vmImages: _browserVmConsoleRegistry?.listImages?.() || [],
    defaultVmRuntimeId: _browserVmConsoleRegistry?.getDefaultRuntimeId?.() || null,
  });
  initRemoteRuntimePanelListeners({
    onOpenView: (selector, view) => {
      void openRemoteRuntimeView(selector, view);
    },
    onExplainRoute: (selector) => explainRemoteRuntimeRoute(selector),
    onUpdateFilter: (key, value) => {
      panelState[key] = value;
      renderRemoteRuntimeWorkspacePanel();
    },
    onVmAction: async (action, target) => {
      if (!_browserVmConsoleRegistry) return;
      panelState.vmError = null;
      try {
        if (action === 'install-image') {
          const installed = _browserVmConsoleRegistry.install(target, {
            workspaceId: getActiveWorkspaceId() || 'default',
          });
          await _browserVmConsoleRegistry.get(installed.id)?.restorePersistedState?.();
        } else if (action === 'set-default') {
          _browserVmConsoleRegistry.setDefault(target);
        } else if (action === 'start-runtime') {
          await _browserVmConsoleRegistry.start(target);
        } else if (action === 'stop-runtime') {
          await _browserVmConsoleRegistry.stop(target);
        } else if (action === 'reset-runtime') {
          await _browserVmConsoleRegistry.reset(target);
        } else if (action === 'remove-runtime') {
          _browserVmConsoleRegistry.uninstall(target);
        }
      } catch (error) {
        panelState.vmError = error?.message || String(error);
      }
      renderRemoteRuntimeWorkspacePanel();
    },
  });

  if (panelState.activeView?.kind === 'terminal') {
    initRemoteTerminalListeners(panelState.activeView.client);
  } else if (panelState.activeView?.kind === 'files') {
    initRemoteFilesListeners(panelState.activeView.client);
  }

  updatePeerBadge(state.peerNode);
}

/**
 * Re-render the mesh dashboard panel if it is currently visible.
 * Mirrors the render logic in buildLazyPanelConfig() but can be called
 * reactively from peer lifecycle events without circular imports.
 */
export function refreshMeshWorkspacePanel() {
  if (!isPanelRendered('mesh')) return;
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
    connectivity: {
      active: !!state.webrtcMeshManager,
      connectionCount: state.webrtcMeshManager?.connectionCount ?? 0,
      stats: state.webrtcMeshManager?.lastStats ?? [],
    },
  });
  const ctrl = buildMeshController({
    peerNode: state.peerNode,
    refresh: refreshMeshWorkspacePanel,
    promptForPubKey: async () => modal.prompt('Pod ID / pubKey to drain:', ''),
    promptForExec: async () => {
      const target = await modal.prompt('Target pod ID / pubKey:', '');
      if (!target) return null;
      const cmd = await modal.prompt('Command to execute on remote pod:', '');
      if (!cmd) return null;
      return { target, cmd };
    },
    deploySkillFlow: async () => {
      const { runMeshDeployFlow } = await import('./clawser-deploy-flow.mjs');
      const result = await runMeshDeployFlow(state, {
        pickDevice: async (devices) => {
          const names = devices.map((d, i) => `${i + 1}. ${d.label || d.id}`).join('\n');
          const answer = await modal.prompt(`Deploy to which device?\n${names}\n\nEnter a number:`, '1');
          if (!answer) return null;
          return devices[parseInt(answer, 10) - 1] || null;
        },
      });
      if (result.ok) addMsg('system', `Deployed to device ${result.deviceId}.`);
      else if (result.error && result.error !== 'cancelled') addErrorMsg(`Deploy failed: ${result.error}`);
      return result;
    },
    onLog: (m) => addMsg('system', m),
    onError: (e) => addErrorMsg(`Mesh action failed: ${e?.message || e}`),
  });
  initMeshListeners(ctrl);
}

function bindRemoteRuntimePanelEvents() {
  if (state.remoteSessionBroker && !state.remoteSessionBroker._remoteRuntimeUiBound) {
    state.remoteSessionBroker._remoteRuntimeUiBound = true;
    state.remoteSessionBroker.on('route:selected', (selection) => {
      const panelState = getRemoteRuntimePanelState();
      if (panelState.activeSelector === selection?.target?.selector) {
        try {
          panelState.routeExplanation = state.remoteSessionBroker.explainRoute(
            selection.target.selector,
            remotePanelIntentOptions(panelState),
          );
        } catch {
          panelState.routeExplanation = {
            ...selection,
            connectionKind: selection.route?.kind || 'unknown',
            reason: `${selection.descriptor?.peerType || 'unknown'}/${selection.descriptor?.shellBackend || 'unknown'} via ${selection.route?.kind || 'unknown'}`,
          };
        }
      }
      if (isPanelRendered('remote')) {
        renderRemoteRuntimeWorkspacePanel();
      }
    });
    state.remoteSessionBroker.on('session:failed', ({ selection, error }) => {
      const panelState = getRemoteRuntimePanelState();
      const selector = selection?.target?.selector || panelState.activeSelector;
      if (panelState.activeSelector === selector) {
        panelState.error = describeRemoteRuntimeError(error);
        panelState.routeExplanation = routeExplanationFromError(
          selector,
          selection?.target?.intent || remotePanelIntentOptions(panelState).intent,
          error,
        );
      }
      if (isPanelRendered('remote')) {
        renderRemoteRuntimeWorkspacePanel();
      }
    });
  }

  if (!state.ui._wshExposureUiBound) {
    state.ui._wshExposureUiBound = true;
    globalThis.addEventListener?.('clawser:wsh-exposure-changed', () => {
      if (isPanelRendered('remote')) {
        renderRemoteRuntimeWorkspacePanel();
      }
    });
  }

  if (state.serviceBrowser && !state.serviceBrowser._remoteRuntimeUiBound) {
    state.serviceBrowser._remoteRuntimeUiBound = true;
    const refresh = () => {
      if (isPanelRendered('remote')) {
        renderRemoteRuntimeWorkspacePanel();
      }
    };
    state.serviceBrowser.on('discovered', refresh);
    state.serviceBrowser.on('lost', refresh);
  }

  if (_browserVmConsoleRegistry && !_browserVmConsoleRegistry._remoteRuntimeUiBound) {
    _browserVmConsoleRegistry._remoteRuntimeUiBound = true;
    _browserVmConsoleRegistry.on('changed', () => {
      if (isPanelRendered('remote')) {
        renderRemoteRuntimeWorkspacePanel();
      }
    });
  }
}

// ── VirtualTerminalManager lifecycle ─────────────────────────────

export async function refreshReverseVirtualTerminalManager() {
  if (_reverseVirtualTerminalManager) {
    await _reverseVirtualTerminalManager.close();
  }

  if (!_browserVmConsoleRegistry) {
    _browserVmConsoleRegistry = new BrowserVmConsoleRegistry();
    const workspaceId = getActiveWorkspaceId() || 'default';
    for (const image of createBuiltinVmImages()) {
      _browserVmConsoleRegistry.registerImage(image);
    }
    const demoLinuxVm = _browserVmConsoleRegistry.install('demo-linux', { workspaceId });
    await _browserVmConsoleRegistry.get(demoLinuxVm.id)?.restorePersistedState?.();
    _browserVmConsoleRegistry.setDefault(demoLinuxVm.id);
  }
  globalThis.__clawserVmConsoleRegistry = _browserVmConsoleRegistry;
  state.features.vmConsoleRegistry = _browserVmConsoleRegistry;

  _reverseVirtualTerminalManager = new VirtualTerminalManager({
    shellFactory: async () => createConfiguredShell({
      workspaceFs: state.workspaceFs,
      getAgent: () => state.agent,
      getRoutineEngine: () => state.routineEngine,
      getModelManager: () => state.modelManager,
    }),
    vmConsoleFactory: async ({ peerContext }) => _browserVmConsoleRegistry.createShell(peerContext?.vmRuntimeId || 'default'),
  });

  try {
    const {
      setIncomingSessionApprovalProvider,
      setRemoteRuntimeAuditRecorder,
      setToolRegistry,
      setVirtualTerminalManager,
    } = await import('./clawser-wsh-incoming.js');
    setVirtualTerminalManager(_reverseVirtualTerminalManager);
    setRemoteRuntimeAuditRecorder(state.pod?.remoteAuditRecorder || null);
    globalThis.__clawserRemoteAuditRecorder = state.pod?.remoteAuditRecorder || null;
    setIncomingSessionApprovalProvider(async (request) => {
      const capabilitySummary = (request.capabilities || []).join(', ') || 'none';
      return modal.confirm(
        `Allow ${request.username || 'remote peer'} to open a ${request.kind} session?\n\nBackend: ${request.peerType}/${request.shellBackend}\nCapabilities: ${capabilitySummary}\nCommand: ${request.command || '(interactive shell)'}`,
        { okLabel: 'Allow', cancelLabel: 'Deny' },
      );
    });
    if (state.browserTools) {
      setToolRegistry(state.browserTools);
    }
  } catch (err) {
    console.warn('[clawser] reverse terminal manager wiring failed', err);
  }
}

// ── P2P Mesh Initialization ─────────────────────────────────────
/**
 * Initialize or reinitialize the P2P mesh subsystem via ClawserPod.
 * Creates a Pod (identity, discovery, messaging) then layers on
 * PeerNode + SwarmCoordinator. Safe to call multiple times.
 */
export async function initMeshSubsystem(opts = {}) {
  try {
    // Boot pod if not already running
    if (!state.pod) {
      state.pod = new ClawserPod();
      await state.pod.boot({ discoveryTimeout: 500 });
    }

    // Distributed tracing MVP: forward mesh.send/mesh.recv events to the
    // kernel Tracer when kernel integration is active (no-op otherwise).
    if (opts.kernelIntegration) {
      state.pod.setTraceEmit((event) => opts.kernelIntegration.traceMeshEvent(event));
    }

    // Layer mesh networking on top of the pod
    // Resolve mesh server URLs: localStorage override → DEFAULTS → undefined
    const signalingUrl = localStorage.getItem('clawser_signaling_url')
      || DEFAULTS.signalingUrl
      || undefined
    const relayUrl = localStorage.getItem('clawser_relay_url')
      || DEFAULTS.relayUrl
      || signalingUrl  // fall back to signaling URL if relay not separately configured
      || undefined
    const result = await state.pod.initMesh({ relayUrl });
    state.peerNode = result.peerNode;
    // Authoritative peer-presence map (online/idle/offline). Subscribes to
    // PeerNode's connect/disconnect events; consumers can call
    // state.presenceService.recordHeartbeat(peerId) from any heartbeat
    // producer (relay, swarm, app-level) to refresh liveness.
    if (state.presenceService) {
      try { state.presenceService.stop(); } catch (e) { silentCatch('clawser-workspace-init-mesh', 'state.presenceService.stop', e) }
    }
    state.presenceService = new PresenceService({ peerNode: state.peerNode });
    state.presenceService.start();
    // Surface sustained disconnects/reconnects as system messages
    // (offline is already debounced by offlineAfterMs, so this is quiet
    // for transient blips — see presenceChangeMessage policy).
    state.presenceService.subscribe((change) => {
      const msg = presenceChangeMessage(change);
      if (msg) addMsg('system', msg);
      updatePeerBadge();
    });

    // Per-workspace sync-flags + deploy-target wiring. Subscribes to
    // pod.onMessage so inbound `{type:'sync'}` and `{type:'deploy'}`
    // envelopes get routed to the right consumer. Storage is at
    // ~/.config/clawser/sync/ and ~/.config/clawser/deploy/ for the
    // active workspace (resolves under /home/<active>/ via the alias).
    uninstallMultiDeviceWiring(state); // idempotent — clears prior workspace's
    try {
      const wsId = getActiveWorkspaceId() || 'default';
      installMultiDeviceWiring({
        pod: state.pod,
        state,
        wsId,
        syncEngine: state.syncEngine,
        // resolvePublicKey defaults to `resolveDidKey` from
        // clawser-did-key.mjs, so signed packages from `did:key:` peers
        // verify out of the box.
        // applyHandlers wires the real per-kind persistence:
        //   skill  → SkillStorage.writeSkill
        //   config → writeFsConfig (under ~/.config/clawser/)
        //   memory → state.agent.memoryStore (set inside the apply registry)
        // Both writes are quota-guarded — a received deploy package must
        // not be able to push the workspace past a hard quota failure.
        applyHandlers: {
          writeConfig: async (domain, wsId, value) => {
            const { guardBeforeWrite } = await import('./clawser-quota-guard.mjs');
            const guard = await guardBeforeWrite(JSON.stringify(value).length, `deploy config write (${domain})`);
            if (!guard.ok) throw new Error(guard.reason);
            return writeFsConfig(domain, wsId, value);
          },
          skillsAPI: {
            writeSkill: async (scope, wsId, name, files) => {
              const { guardBeforeWrite } = await import('./clawser-quota-guard.mjs');
              const size = [...files.values()].reduce((sum, content) => sum + content.length, 0);
              const guard = await guardBeforeWrite(size, `deploy skill write (${name})`);
              if (!guard.ok) throw new Error(guard.reason);
              return SkillStorage.writeSkill(scope, wsId, name, files);
            },
          },
        },
        // First-deploy approval modal — surfaces the source DID,
        // manifest fingerprint, capabilities, and items being deployed.
        // User clicks Approve/Deny; cached by (source, manifestHash)
        // so future deploys with the same fingerprint auto-apply.
        promptApprove: approvalModalPrompt,
      });
    } catch (e) {
      silentCatch('clawser-workspace-init-mesh', 'multi-device-wiring', e);
    }
    state.swarmCoordinator = result.swarmCoordinator;
    state.discoveryManager = result.discoveryManager;
    state.transportNegotiator = result.transportNegotiator;
    state.auditChain = result.auditChain;
    state.streamMultiplexer = result.streamMultiplexer;
    state.fileTransfer = result.fileTransfer;
    state.serviceDirectory = result.serviceDirectory;
    state.serviceAdvertiser = result.serviceAdvertiser;
    state.serviceBrowser = result.serviceBrowser;
    state.syncEngine = result.syncEngine;
    state.resourceRegistry = result.resourceRegistry;
    state.meshMarketplace = result.meshMarketplace;
    state.quotaManager = result.quotaManager;
    state.quotaEnforcer = result.quotaEnforcer;
    // Stop the previous workspace's/pod's sweeper before replacing
    // paymentRouter — initMesh() rebuilds a fresh PaymentRouter on every
    // call (e.g. workspace switch), and without this the old sweeper
    // timer keeps firing against a detached EscrowManager forever.
    if (state.paymentRouter) {
      try { state.paymentRouter.stopEscrowSweeper(); } catch (e) { silentCatch('clawser-workspace-init-mesh', 'stop-prior-escrow-sweeper', e) }
    }
    state.paymentRouter = result.paymentRouter;
    // Escrow-timeout enforcement: without this, EscrowManager.pruneExpired()
    // exists but nothing ever calls it and timed-out escrows sit in
    // 'held' status forever. See PaymentRouter.startEscrowSweeper() docs
    // for why there's no wire notification (no ESCROW_EXPIRE message
    // type in the mesh wire format yet — each party expires independently).
    if (state.paymentRouter) {
      state.paymentRouter.startEscrowSweeper(30_000, (expired) => {
        for (const e of expired) {
          addMsg('system', `Escrow ${e.escrowId.slice(0, 8)}… timed out (${e.amount} held between ${e.payerPodId.slice(0, 8)}… and ${e.payeePodId.slice(0, 8)}…).`);
        }
      });
    }
    // Mesh health metrics: poll WebRTC connection stats on a rolling 1-min
    // window and surface alert-rule violations (latency, packet loss, peer
    // drop) as system messages. Stop any prior timer first (same
    // rebuild-on-every-initMesh-call concern as the escrow sweeper above).
    // NOTE: state.webrtcMeshManager is not currently populated by
    // ClawserPod.initMesh() — the production WebRTC transport still uses
    // raw per-endpoint WebRTCPeerConnection instances (see the 'webrtc'
    // adapter in clawser-pod.js), not WebRTCMeshManager. This poller is a
    // documented no-op until that wiring exists; it's fully real and
    // tested against WebRTCMeshManager directly (clawser-mesh-webrtc.js,
    // clawser-mesh-alert-rules.mjs).
    if (state._meshMetricsTimer) clearInterval(state._meshMetricsTimer);
    state._meshMetricsWindow = [];
    state._meshMetricsPeerIds = [];
    state._meshMetricsTimer = setInterval(async () => {
      if (!state.webrtcMeshManager) return;
      try {
        const stats = await state.webrtcMeshManager.getAllConnectionStats();
        const violations = evaluateAlertRules(stats, state._meshMetricsPeerIds);
        state._meshMetricsPeerIds = stats.map(s => s.remotePodId);
        state._meshMetricsWindow = recordMetricSample(state._meshMetricsWindow, { stats }, Date.now());
        for (const v of violations) addMsg('system', v.message);
        refreshMeshWorkspacePanel();
      } catch (e) { silentCatch('clawser-workspace-init-mesh', 'mesh-metrics-poll', e); }
    }, 10_000);
    if (state._meshMetricsTimer?.unref) state._meshMetricsTimer.unref();
    state.consensusManager = result.consensusManager;
    state.relayClient = result.relayClient;
    // If user opted in via Settings → Mesh / Relay, fire-and-forget connect.
    // Failure is non-fatal (mesh still works peer-to-peer), but surface
    // visibly so a bad relay URL or down server isn't silent. The
    // relayClient also emits 'error' on reconnect-budget exhaustion;
    // forward those to the user too.
    if (state.relayClient && localStorage.getItem('clawser_relay_auto_connect') === 'true') {
      state.relayClient.onError?.((err) => {
        addErrorMsg(`Relay error: ${err?.message || err}`);
      });
      state.relayClient.connect().catch(err => {
        console.warn('[clawser] relay auto-connect failed:', err?.message || err);
        addErrorMsg(`Relay auto-connect failed: ${err?.message || err}`);
      });
    }
    state.nameResolver = result.nameResolver;
    state.appRegistry = result.appRegistry;
    state.appStore = result.appStore;
    state.orchestrator = result.orchestrator;
    // Track 1: Transports
    state.transportFactory = result.transportFactory;
    // Track 2: Security
    state.handshakeCoordinator = result.handshakeCoordinator;
    state.meshACL = result.meshACL;
    state.capabilityValidator = result.capabilityValidator;
    state.crossOriginBridge = result.crossOriginBridge;
    state.sessionManager = result.sessionManager;
    // Track 3: Communication
    state.meshChat = result.meshChat;
    state.gatewayNode = result.gatewayNode;
    state.gatewayDiscovery = result.gatewayDiscovery;
    state.torrentManager = result.torrentManager;
    state.ipfsStore = result.ipfsStore;
    // Track 2 (continued)
    state.verificationQuorum = result.verificationQuorum;
    // Track 4: Compute
    state.meshScheduler = result.meshScheduler;
    state.federatedCompute = result.federatedCompute;
    state.agentSwarmCoordinator = result.agentSwarmCoordinator;
    // Track 5: Ops
    state.dhtNode = result.dhtNode;
    state.creditLedger = result.creditLedger;
    state.escrowManager = result.escrowManager;
    state.healthMonitor = result.healthMonitor;
    state.meshRouter = result.meshRouter;
    state.migrationEngine = result.migrationEngine;
    state.meshInspector = result.meshInspector;
    state.stealthAgent = result.stealthAgent;
    state.meshFetchRouter = result.meshFetchRouter;
    state.timestampAuthority = result.timestampAuthority;
    state.syncCoordinator = result.syncCoordinator;

    // ── Mesh peer device files (`/dev/clawser/mesh/peers/{peerId}`) ──
    // Subscribe to discovery events to register/unregister per-peer device
    // files. Reads return current metadata; writes require a sendFn (not
    // currently provided by the pod's public API — they will throw a clear
    // "no send function wired" error until a per-peer send is added).
    if (state.deviceHandler && state.discoveryManager) {
      try {
        const { addMeshPeerDevice, removeMeshPeerDevice } = await import('./clawser-runtime.js');
        // Track registered peer paths so we don't double-register.
        if (!state._registeredPeerDevices) state._registeredPeerDevices = new Set();

        const registerForPeer = (record) => {
          if (!record?.podId) return;
          if (state._registeredPeerDevices.has(record.podId)) return;
          addMeshPeerDevice(state.deviceHandler, record.podId, {
            getMetadata: () => {
              const fresh = state.discoveryManager.getRecord?.(record.podId)
                || state.peerNode?.registry?.getPeer?.(record.podId)
                || record;
              return {
                podId: fresh.podId,
                status: fresh.isExpired?.() ? 'expired' : 'active',
                lastSeen: fresh.discoveredAt || fresh.lastSeen || null,
                capabilities: fresh.capabilities || [],
                peerType: fresh.peerType || 'unknown',
              };
            },
            // A3 write path: route shell-side writes through the pod's
            // unicast send. Throws when the peer has no active session.
            sendFn: async (peerId, envelope) => {
              if (!state.pod || typeof state.pod.sendMessage !== 'function') {
                throw new Error('mesh peer write: pod.sendMessage unavailable');
              }
              return state.pod.sendMessage(peerId, envelope);
            },
          });
          state._registeredPeerDevices.add(record.podId);
        };
        const unregisterForPeer = (record) => {
          if (!record?.podId) return;
          if (!state._registeredPeerDevices.has(record.podId)) return;
          removeMeshPeerDevice(state.deviceHandler, record.podId);
          state._registeredPeerDevices.delete(record.podId);
        };

        // Register devices for already-known peers.
        const known = state.discoveryManager.list?.() || [];
        for (const r of known) registerForPeer(r);

        state.discoveryManager.onPeerDiscovered?.(registerForPeer);
        state.discoveryManager.onPeerLost?.(unregisterForPeer);
      } catch (e) {
        console.warn('[clawser] mesh peer device wiring failed:', e?.message || e);
      }
    }

    // ── Wire collaborative editing bridge ────────────────────────
    if (state.collabManager) {
      try { state.collabManager.destroy() } catch (e) { silentCatch('clawser-workspace-init-mesh', 'state.collabManager.destroy', e) }
    }
    state.collabManager = new CollabManager({
      localPodId: state.pod.podId,
      syncEngine: state.syncEngine,
      syncCoordinator: state.syncCoordinator,
      sessionManager: state.sessionManager,
      onLog: (level, msg) => console.log(`[collab] ${msg}`),
    })

    state.remoteRuntimeRegistry = result.remoteRuntimeRegistry || state.pod.remoteRuntimeRegistry;
    state.remoteSessionBroker = result.remoteSessionBroker || state.pod.remoteSessionBroker;
    globalThis.__clawserRemoteRuntimeRegistry = state.remoteRuntimeRegistry;
    configureServerRuntimeResolver();
    state.remoteMountManager = new RemoteMountManager({
      mountableFs: state.workspaceFs,
      runtimeRegistry: state.remoteRuntimeRegistry,
      sessionBroker: state.remoteSessionBroker,
      auditRecorder: state.pod.remoteAuditRecorder,
    });
    if (state.serverServiceSyncCleanup) {
      try { state.serverServiceSyncCleanup() } catch { /* best-effort cleanup */ }
      state.serverServiceSyncCleanup = null
    }
    try {
      const serverManager = getServerManager()
      state.serverServiceSyncCleanup = await bindServerManagerServices({
        serverManager,
        serviceAdvertiser: state.serviceAdvertiser,
      })
    } catch (e) {
      console.warn('[clawser] Virtual server service sync failed (non-fatal):', e.message)
    }

    // Register mesh tools if tool registry is available
    if (state.browserTools) {
      try {
        registerMeshTools(state.browserTools, state.streamMultiplexer, state.fileTransfer);
        // Wire DHT node into existing mesh tools context
        const { meshToolsContext } = await import('./clawser-mesh-tools.js');
        if (state.dhtNode) meshToolsContext.setDhtNode(state.dhtNode);
        registerIdentityTools(state.browserTools);
        // Register orchestrator tools
        if (state.orchestrator) {
          const meshctlTools = createMeshctlTools(state.orchestrator);
          for (const tool of meshctlTools) state.browserTools.register(tool);
        }
        // Register peer subsystem tools (chat, scheduler, compute, etc.)
        registerMeshPeerTools(state.browserTools, {
          meshChat: state.meshChat,
          meshScheduler: state.meshScheduler,
          federatedCompute: state.federatedCompute,
          agentSwarmCoordinator: state.agentSwarmCoordinator,
          healthMonitor: state.healthMonitor,
          escrowManager: state.escrowManager,
          meshRouter: state.meshRouter,
          timestampAuthority: state.timestampAuthority,
          stealthAgent: state.stealthAgent,
          syncCoordinator: state.syncCoordinator,
          gatewayNode: state.gatewayNode,
          torrentManager: state.torrentManager,
          ipfsStore: state.ipfsStore,
          meshACL: state.meshACL,
          capabilityValidator: state.capabilityValidator,
          sessionManager: state.sessionManager,
          crossOriginBridge: state.crossOriginBridge,
          verificationQuorum: state.verificationQuorum,
          migrationEngine: state.migrationEngine,
          creditLedger: state.creditLedger,
        });
        // Register devtools inspector tool (Track 5)
        if (state.meshInspector) {
          try {
            const { MeshInspectTool } = await import('./clawser-mesh-devtools.js');
            state.browserTools.register(new MeshInspectTool({
              pod: state.pod,
              peerNode: state.peerNode,
              swarmCoordinator: state.swarmCoordinator,
              transportNegotiator: state.transportNegotiator,
              auditChain: state.auditChain,
              streamMultiplexer: state.streamMultiplexer,
              fileTransfer: state.fileTransfer,
              serviceDirectory: state.serviceDirectory,
              syncEngine: state.syncEngine,
              resourceRegistry: state.resourceRegistry,
              meshMarketplace: state.meshMarketplace,
              quotaManager: state.quotaManager,
              quotaEnforcer: state.quotaEnforcer,
              paymentRouter: state.paymentRouter,
              consensusManager: state.consensusManager,
              relayClient: state.relayClient,
              nameResolver: state.nameResolver,
              appRegistry: state.appRegistry,
              appStore: state.appStore,
              orchestrator: state.orchestrator,
              sessionManager: state.sessionManager,
              discoveryManager: state.discoveryManager,
            }));
          } catch (e) {
            console.warn('[clawser] MeshInspectTool registration failed (non-fatal):', e.message);
          }
        }
      } catch (e) {
        console.warn('[clawser] Mesh tool registration failed (non-fatal):', e.message);
      }
    }

    // Wire peer lifecycle events for session-scoped modules
    if (state.peerNode) {
      state.peerNode.on('peer:connect', (peer) => {
        const peerId = peer?.fingerprint || peer?.podId || peer?.pubKey
        if (!peerId) return
        console.log(`[clawser] Peer connected: ${peerId}`)

        // Add route for the new peer
        if (state.meshRouter) {
          try { state.meshRouter.addRoute(peerId, peerId, 1) } catch (e) { silentCatch('clawser-workspace-init-mesh', 'state.meshRouter.addRoute', e) }
        }

        // Register peer with gateway node
        if (state.gatewayNode) {
          try { state.gatewayNode.registerPeer?.(peerId) } catch (e) { silentCatch('clawser-workspace-init-mesh', 'state.gatewayNode.registerPeer', e) }
        }

        // Join swarm coordinator
        if (state.swarmCoordinator) {
          try { state.swarmCoordinator.join(peerId) } catch (e) { silentCatch('clawser-workspace-init-mesh', 'state.swarmCoordinator.join', e) }
        }

        // Re-render mesh panel to reflect new peer
        refreshMeshWorkspacePanel()
      })

      state.peerNode.on('peer:disconnect', (peer) => {
        const peerId = peer?.fingerprint || peer?.podId || peer?.pubKey
        if (!peerId) return
        console.log(`[clawser] Peer disconnected: ${peerId}`)

        // Remove peer route
        if (state.meshRouter) {
          try { state.meshRouter.removeRoute?.(peerId) } catch (e) { silentCatch('clawser-workspace-init-mesh', 'state.meshRouter.removeRoute', e) }
        }

        // Remove from gateway
        if (state.gatewayNode) {
          try { state.gatewayNode.unregisterPeer?.(peerId) } catch (e) { silentCatch('clawser-workspace-init-mesh', 'state.gatewayNode.unregisterPeer', e) }
        }

        // Leave swarm coordinator
        if (state.swarmCoordinator) {
          try { state.swarmCoordinator.leave(peerId) } catch (e) { silentCatch('clawser-workspace-init-mesh', 'state.swarmCoordinator.leave', e) }
        }

        // Re-render mesh panel to reflect peer departure
        refreshMeshWorkspacePanel()
      })

      // Attach collab manager to react to peer lifecycle events
      if (state.collabManager) {
        state.collabManager.attach(state.peerNode)
      }

      // Wire SyncCoordinator sendFn to route delta sync messages
      // through PeerSession via the collab bridge's CRDT service type
      if (state.syncCoordinator && state.sessionManager) {
        state.syncCoordinator.setSendFn((targetId, msg) => {
          const sessions = state.sessionManager.getSessionsForPeer(targetId)
          if (sessions.length === 0) return
          try {
            sessions[0].send('crdt-sync', { action: 'delta', docId: msg.type, message: msg })
          } catch (e) { silentCatch('clawser-workspace-init-mesh', 'non-fatal-peer-may-have-disconnected', e) }
        })
      }
    }

    // ── Wire SW mesh-fetch relay ──────────────────────────────────
    // Listen for mesh-fetch messages from the Service Worker and route
    // them through the MeshFetchRouter running in the main thread.
    if (typeof navigator !== 'undefined' && navigator.serviceWorker && state.meshFetchRouter) {
      const meshFetchListener = async (event) => {
        if (event.data?.type !== 'mesh-fetch') return
        const { port, pseudoRequest } = event.data
        if (!port || !pseudoRequest) return

        try {
          // Reconstruct a Request-like object for MeshFetchRouter
          const headerEntries = pseudoRequest.headers || []
          const headersObj = {}
          for (const [k, v] of headerEntries) headersObj[k] = v

          const reqLike = {
            url: pseudoRequest.url,
            method: pseudoRequest.method || 'GET',
            headers: {
              forEach(cb) { for (const [k, v] of Object.entries(headersObj)) cb(v, k) },
              entries() { return Object.entries(headersObj) },
            },
            async text() {
              if (pseudoRequest.body instanceof ArrayBuffer) {
                return new TextDecoder().decode(pseudoRequest.body)
              }
              return pseudoRequest.body != null ? String(pseudoRequest.body) : ''
            },
          }

          const response = await state.meshFetchRouter.route(reqLike)
          if (response) {
            const body = typeof response._body !== 'undefined'
              ? response._body
              : await response.text?.() ?? ''
            const resHeaders = []
            if (response.headers) {
              if (typeof response.headers.entries === 'function') {
                for (const entry of response.headers.entries()) resHeaders.push(entry)
              } else if (typeof response.headers.forEach === 'function') {
                response.headers.forEach((v, k) => resHeaders.push([k, v]))
              }
            }
            port.postMessage({
              pseudoResponse: {
                status: response.status || 200,
                statusText: response.statusText || 'OK',
                headers: resHeaders,
                body,
              },
            })
          } else {
            port.postMessage({
              pseudoResponse: {
                status: 404,
                statusText: 'Not Found',
                headers: [['content-type', 'application/json']],
                body: JSON.stringify({ error: 'No mesh route matched' }),
              },
            })
          }
        } catch (err) {
          port.postMessage({ error: err.message || 'Mesh fetch handler error' })
        }
      }

      navigator.serviceWorker.addEventListener('message', meshFetchListener)
      state._meshFetchSwCleanup = () => {
        navigator.serviceWorker.removeEventListener('message', meshFetchListener)
      }
    }

    console.log('[clawser] P2P mesh initialized via ClawserPod — podId:', state.pod.podId);
  } catch (err) {
    console.warn('[clawser] P2P mesh init failed (non-fatal):', err.message);
    state.peerNode = null;
    if (state.presenceService) {
      try { state.presenceService.stop(); } catch (e) { silentCatch('clawser-workspace-init-mesh', 'state.presenceService.stop', e) }
      state.presenceService = null;
    }
    uninstallMultiDeviceWiring(state);
    state.swarmCoordinator = null;
    state.discoveryManager = null;
    state.transportNegotiator = null;
    state.auditChain = null;
    state.streamMultiplexer = null;
    state.fileTransfer = null;
    state.serviceDirectory = null;
    state.serviceAdvertiser = null;
    state.serviceBrowser = null;
    if (state.serverServiceSyncCleanup) {
      try { state.serverServiceSyncCleanup() } catch { /* best-effort cleanup */ }
      state.serverServiceSyncCleanup = null
    }
    state.syncEngine = null;
    state.resourceRegistry = null;
    state.meshMarketplace = null;
    state.quotaManager = null;
    state.quotaEnforcer = null;
    if (state.paymentRouter) {
      try { state.paymentRouter.stopEscrowSweeper(); } catch (e) { silentCatch('clawser-workspace-init-mesh', 'state.paymentRouter.stopEscrowSweeper', e) }
    }
    state.paymentRouter = null;
    if (state._meshMetricsTimer) {
      clearInterval(state._meshMetricsTimer);
      state._meshMetricsTimer = null;
    }
    state.consensusManager = null;
    state.relayClient = null;
    state.nameResolver = null;
    state.appRegistry = null;
    state.appStore = null;
    state.orchestrator = null;
    state.remoteRuntimeRegistry = null;
    state.remoteSessionBroker = null;
    state.remoteMountManager = null;
    // Track 1
    state.transportFactory = null;
    // Track 2
    state.handshakeCoordinator = null;
    state.meshACL = null;
    state.capabilityValidator = null;
    state.crossOriginBridge = null;
    state.verificationQuorum = null;
    state.sessionManager = null;
    // Track 3
    state.meshChat = null;
    state.gatewayNode = null;
    state.gatewayDiscovery = null;
    state.torrentManager = null;
    state.ipfsStore = null;
    // Track 4
    state.meshScheduler = null;
    state.federatedCompute = null;
    state.agentSwarmCoordinator = null;
    // Track 5
    state.dhtNode = null;
    state.creditLedger = null;
    state.escrowManager = null;
    state.healthMonitor = null;
    state.meshRouter = null;
    state.migrationEngine = null;
    state.meshInspector = null;
    state.stealthAgent = null;
    state.meshFetchRouter = null;
    if (state._meshFetchSwCleanup) {
      try { state._meshFetchSwCleanup() } catch (e) { silentCatch('clawser-workspace-init-mesh', 'state._meshFetchSwCleanup', e) }
      state._meshFetchSwCleanup = null
    }
    state.timestampAuthority = null;
    state.syncCoordinator = null;
    if (state.collabManager) {
      try { state.collabManager.destroy() } catch (e) { silentCatch('clawser-workspace-init-mesh', 'state.collabManager.destroy', e) }
      state.collabManager = null;
    }
  }
}

// ── Channel Gateway creation ─────────────────────────────────────
/**
 * Create a ChannelGateway for the given workspace.
 * @param {string} wsId - Workspace ID
 * @param {Object|null} kernelIntegration - Kernel integration adapter (may be null)
 * @returns {ChannelGateway}
 */
export function createChannelGateway(wsId, kernelIntegration) {
  return new ChannelGateway({
    agent: state.agent,
    tenantId: kernelIntegration?.getWorkspaceTenantId(wsId) || null,
    deviceHandler: state.deviceHandler || null,
    onIngest: (channelId, msg) => {
      addMsg('user', msg.content, null, channelId);
    },
    onRespond: (channelId, text) => {
      addMsg('agent', text, null, channelId);
    },
    onLog: (msg) => console.log(`[gateway] ${msg}`),
  });
}
