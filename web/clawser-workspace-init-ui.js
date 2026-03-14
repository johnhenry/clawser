/**
 * clawser-workspace-init-ui.js — Lazy panel rendering extracted from workspace-lifecycle
 *
 * Provides registerLazyPanelRenders() and buildLazyPanelConfig() so the
 * large panel→render-function mapping is defined once instead of duplicated
 * in both initWorkspace() and switchWorkspace().
 */
import { $, state } from './clawser-state.js';
import { PANELS, resetRenderedPanels, isPanelRendered } from './clawser-router.js';
import { addMsg } from './clawser-ui-chat.js';
import {
  refreshFiles, renderGoals, renderToolRegistry, renderSkills,
  renderMountList, renderToolManagementPanel, renderAgentPanel,
  renderMarketplace, renderChannelPanel,
  refreshDashboard,
} from './clawser-ui-panels.js';
import { renderServerList, initServerPanel } from './clawser-ui-servers.js';
import { renderSwarmPanel, initSwarmListeners } from './clawser-ui-swarms.js';
import { renderTransferPanel, initTransferListeners } from './clawser-ui-transfers.js';
import { renderIdentityWallet, initIdentityWalletListeners, renderContactBook, initContactBookListeners, renderConnectionPanel, initConnectionListeners, renderAuditLog, initAuditLogListeners } from './clawser-ui-peers.js';
import { refreshMeshWorkspacePanel } from './clawser-workspace-init-mesh.js';

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
 * @param {Object} renders - Map of panel name -> render callback
 */
export function registerLazyPanelRenders(renders) {
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

/**
 * Build the standard lazy panel config object used by both initWorkspace()
 * and switchWorkspace(). Accepts a renderRemotePanel callback so the mesh
 * module can supply its own renderer without circular imports.
 *
 * @param {Function} renderRemotePanel - Callback to render the remote runtime panel
 * @returns {Object} Map of panel name -> render function
 */
export function buildLazyPanelConfig(renderRemotePanel) {
  return {
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
    mesh: () => refreshMeshWorkspacePanel(),
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
      renderRemotePanel();
    },
  };
}
