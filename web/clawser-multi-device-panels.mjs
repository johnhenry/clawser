/**
 * clawser-multi-device-panels.mjs — mount + reactive-bind for the
 * My Devices and Trusted Publishers panels.
 *
 * `clawser-ui-multi-device.mjs` provides the pure render + bind
 * functions; `clawser-multi-device-controllers.mjs` provides the
 * production controllers; this module ties them together with live
 * `state.pairedDevices` / `state.deployTarget` data + reactive
 * re-render on store mutations.
 *
 * Two entry points: `mountMyDevicesPanel(state)` and
 * `mountTrustedPublishersPanel(state)`. Each is idempotent — calling
 * twice on the same workspace is a no-op (the prior subscription
 * stays). On workspace switch the destroy hook in
 * `installMultiDeviceWiring` clears the underlying stores; the next
 * mount call re-subscribes against the new instances.
 *
 * Mount targets:
 *   - `#myDevicesContainer`     (set up in index.html)
 *   - `#trustedPubsContainer`
 */

import {
  renderMyDevicesPanel,
  bindMyDevicesPanel,
  renderTrustedPublishersPanel,
  bindTrustedPublishersPanel,
} from './clawser-ui-multi-device.mjs';
import {
  buildMyDevicesController,
  buildTrustedPublishersController,
} from './clawser-multi-device-controllers.mjs';

const $ = (id) => (typeof document !== 'undefined' ? document.getElementById(id) : null);

/**
 * Build the view-model for the My Devices panel from the live store.
 * Pure / testable.
 *
 * @param {Array} entries  — output of `pairedDevices.list()`
 * @returns {{devices: Array<{pubKey:string, label:string, lastSyncedAt:number|null, syncEnabled:boolean}>}}
 */
export function buildMyDevicesViewModel(entries) {
  return {
    devices: (entries || []).map(e => ({
      pubKey: e.peerPublicKey || e.deviceId,
      label: e.label || '(unlabeled)',
      lastSyncedAt: e.lastSyncAt ?? null,
      syncEnabled: !!e.syncEnabled,
      _deviceId: e.deviceId,
    })),
  };
}

/**
 * Build the view-model for the Trusted Publishers panel.
 *
 * @param {{sources:Array, approvals:Array, auditEvents:Array}} raw
 * @returns {object}
 */
export function buildTrustedPublishersViewModel(raw) {
  return {
    sources: raw?.sources || [],
    approvals: raw?.approvals || [],
    auditEvents: raw?.auditEvents || [],
  };
}

// Track per-state mount status so re-binding is idempotent.
const _myDevicesMounts = new WeakMap();
const _trustedPubsMounts = new WeakMap();

/**
 * Re-mount any multi-device panels whose section is currently
 * `.visible` in the DOM. Called by `switchWorkspace` after wiring
 * is reinstalled so stale data from the prior workspace is replaced.
 * Idempotent — closed sections are skipped.
 *
 * @param {object} state
 * @param {object} [opts]   — passed through to `mountX` (e.g. `_doc`)
 * @returns {Promise<void>}
 */
export async function remountVisibleMultiDevicePanels(state, opts = {}) {
  const doc = opts._doc || (typeof document !== 'undefined' ? document : null);
  if (!doc) return;
  const myDevicesSection = doc.getElementById('myDevicesSection');
  if (myDevicesSection?.classList?.contains('visible')) {
    await mountMyDevicesPanel(state, opts);
  }
  const trustedPubsSection = doc.getElementById('trustedPubsSection');
  if (trustedPubsSection?.classList?.contains('visible')) {
    await mountTrustedPublishersPanel(state, opts);
  }
}

/**
 * Mount (or re-mount) the My Devices panel.
 *
 * @param {object} state           — workspace state
 * @param {object} [opts]
 * @param {Document} [opts._doc]   — DOM injection for tests
 * @returns {Promise<{unbind:Function}|null>}
 */
export async function mountMyDevicesPanel(state, opts = {}) {
  const doc = opts._doc || (typeof document !== 'undefined' ? document : null);
  const container = doc?.getElementById?.('myDevicesContainer');
  if (!container) return null;

  const store = state?.pairedDevices;
  if (!store) {
    container.innerHTML = '<div class="md-empty">Multi-device sync is not initialized in this workspace.</div>';
    return null;
  }

  // Tear down any prior mount on this state — paired-devices is a
  // long-lived store; the DOM container is what's transient.
  const prior = _myDevicesMounts.get(state);
  if (prior) try { prior.unbind?.(); } catch { /* ignore */ }

  const controller = buildMyDevicesController({
    state,
    showPickerModalFn: (await import('./clawser-deploy-picker-modal.mjs')).showPickerModal,
    showPairModal: (await import('./clawser-ui-multi-device.mjs')).showPairNewDeviceModal,
    confirm: opts.confirm,
    resolveItems: opts.resolveItems || (async () => ({ skills: [], configs: [], memory: [] })),
    getSigningKey: opts.getSigningKey,
    getSourceDid: opts.getSourceDid,
  });

  const renderNow = async () => {
    const list = await store.list();
    container.innerHTML = renderMyDevicesPanel(buildMyDevicesViewModel(list));
  };
  const unbindEvents = bindMyDevicesPanel(container, controller);
  await renderNow();
  const unsub = store.subscribe(() => { renderNow().catch(() => {}); });

  const handle = {
    unbind: () => { try { unbindEvents(); } catch { /* ignore */ } try { unsub(); } catch { /* ignore */ } },
  };
  _myDevicesMounts.set(state, handle);
  return handle;
}

/**
 * Mount (or re-mount) the Trusted Publishers panel.
 *
 * @param {object} state
 * @param {object} [opts]
 * @returns {Promise<{unbind:Function}|null>}
 */
export async function mountTrustedPublishersPanel(state, opts = {}) {
  const doc = opts._doc || (typeof document !== 'undefined' ? document : null);
  const container = doc?.getElementById?.('trustedPubsContainer');
  if (!container) return null;

  const target = state?.deployTarget;
  if (!target) {
    container.innerHTML = '<div class="tp-empty">Deploy target is not initialized in this workspace.</div>';
    return null;
  }

  const prior = _trustedPubsMounts.get(state);
  if (prior) try { prior.unbind?.(); } catch { /* ignore */ }

  const controller = buildTrustedPublishersController({ state, confirm: opts.confirm });

  const renderNow = async () => {
    const sources = await (target.deployAcl?.list?.() || Promise.resolve([]));
    const approvals = await (target.deployApprovals?.list?.() || Promise.resolve([]));
    const auditEvents = await (target.deployAudit?.list?.({ limit: 50 }) || Promise.resolve([]));
    container.innerHTML = renderTrustedPublishersPanel(
      buildTrustedPublishersViewModel({ sources, approvals, auditEvents }),
    );
  };

  // The deploy stores don't expose a subscribe hook today; we rebuild
  // on every controller action. Wrap the controller to re-render
  // after each successful mutation, then bind ONCE with the wrapped
  // controller.
  const wrap = (fn) => async (...args) => {
    const r = await fn(...args);
    try { await renderNow(); } catch { /* ignore */ }
    return r;
  };
  const wrappedCtrl = {
    onRevokeSource: wrap(controller.onRevokeSource),
    onRetrustSource: wrap(controller.onRetrustSource),
    onRevokeApproval: wrap(controller.onRevokeApproval),
    onRollback: wrap(controller.onRollback),
  };
  await renderNow();
  const unbindWrapped = bindTrustedPublishersPanel(container, wrappedCtrl);

  const handle = { unbind: () => { try { unbindWrapped(); } catch { /* ignore */ } } };
  _trustedPubsMounts.set(state, handle);
  return handle;
}
