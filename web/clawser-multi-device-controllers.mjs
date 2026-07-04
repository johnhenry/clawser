/**
 * clawser-multi-device-controllers.mjs — production controllers that
 * wire the My Devices + Trusted Publishers panels to live state.
 *
 * The render+bind layer in `clawser-ui-multi-device.mjs` is
 * controller-injectable. This module supplies the controllers that
 * call into:
 *   - `state.pairedDevices`     (PairedDevicesStore — global)
 *   - `state.deployTarget.*`    (DeployAcl / DeployApprovals / etc.)
 *   - `state.syncFlags`         (per-workspace flags)
 *   - `state.pod.sendMessage`   (outbound deploy)
 *   - `state.identityManager`   (signing key for outbound deploy)
 *
 * Modal helpers are injected so the controllers stay testable
 * without DOM. Production passes `showPairNewDeviceModal`,
 * `showPickerModal`, and `modal.confirm` from the existing helpers.
 */

import { publishDeploy } from './clawser-deploy-publish.mjs';
import {
  generatePairingCode,
  createPairingPayload,
} from './clawser-pairing.mjs';
import { showPairNewDeviceModal } from './clawser-ui-multi-device.mjs';
import { showPickerModal } from './clawser-deploy-picker-modal.mjs';

/**
 * @typedef {object} ControllerCtx
 * @property {object} state                    — workspace state
 * @property {object} state.pod                — `{sendMessage}`
 * @property {object} [state.pairedDevices]    — `PairedDevicesStore`
 * @property {object} [state.deployTarget]     — `{deployAcl, deployApprovals, deployAudit, deploySnapshots}`
 * @property {object} [state.syncFlags]
 * @property {object} [state.identityManager]  — has `export(podId)` + `getDefault()`
 * @property {Function} [confirm]              — async (message) => boolean (defaults to a window.confirm wrapper)
 * @property {Function} [showPairModal]        — overrideable for tests
 * @property {Function} [showPickerModalFn]    — overrideable for tests
 * @property {Function} [resolveItems]         — returns `{skills, configs, memory}` for the picker
 * @property {Function} [getSigningKey]        — async () => CryptoKey (private key for signing)
 * @property {Function} [getSourceDid]         — () => string (active identity's did:key)
 * @property {Function} [generatePairPayload]  — async () => string (full pairing payload + code)
 */

/**
 * Default confirm fallback — uses `modal.confirm` if available,
 * else `window.confirm`, else auto-true (test environments).
 */
const defaultConfirm = async (msg) => {
  if (typeof globalThis !== 'undefined' && globalThis.modal?.confirm) {
    return globalThis.modal.confirm(msg);
  }
  if (typeof window !== 'undefined' && typeof window.confirm === 'function') {
    return window.confirm(msg);
  }
  return true;
};

/**
 * Build the My Devices controller.
 *
 * @param {ControllerCtx} ctx
 * @returns {{onPairNew:Function, onToggleSync:Function, onDeployNow:Function, onUnpair:Function}}
 */
export function buildMyDevicesController(ctx) {
  const confirm = ctx.confirm || defaultConfirm;
  const showPairModal = ctx.showPairModal || showPairNewDeviceModal;
  const showPicker = ctx.showPickerModalFn || showPickerModal;

  return {
    /** Open the pairing-new-device modal. */
    async onPairNew() {
      const generate = ctx.generatePairPayload || (async () => {
        const code = generatePairingCode();
        // Need the active identity's JWK to bundle. The user reads
        // the code off the modal and types it on the target device.
        const idMgr = ctx.state?.identityManager;
        const podId = idMgr?.getDefault?.()?.podId;
        if (!idMgr || !podId) return `(error) no active identity to pair`;
        const jwk = await idMgr.export(podId);
        const payload = await createPairingPayload({
          identityJwk: jwk,
          code,
          sourceLabel: 'This device',
          identityLabel: 'Paired identity',
        });
        return `${payload}\n\nCode: ${code}`;
      });
      return showPairModal({ generatePayload: generate });
    },

    /** Toggle a device's sync flag. */
    async onToggleSync(deviceId, enabled) {
      const store = ctx.state?.pairedDevices;
      if (!store) return false;
      // No persisted "syncEnabled" field on the entry today — we use
      // recordSync as the canonical "this device received a push"
      // signal. Flipping the toggle on triggers an initial sync push.
      // Off is a no-op (enabling/disabling continuous sync is a
      // future-flag concern; for now the toggle just controls
      // whether a manual deploy fans to this device).
      const entry = await store.get(deviceId);
      if (!entry) return false;
      // Persist the bool on the entry via the store's `update` patch.
      return store.update(deviceId, { syncEnabled: !!enabled });
    },

    /** Deploy items to one device. */
    async onDeployNow(deviceId) {
      const store = ctx.state?.pairedDevices;
      if (!store) return { ok: false, error: 'no pairedDevices store' };
      const entry = await store.get(deviceId);
      if (!entry) return { ok: false, error: 'device not found' };
      if (!entry.peerPublicKey) return { ok: false, error: 'device has no peerPublicKey — re-pair' };

      const items = ctx.resolveItems ? await ctx.resolveItems() : { skills: [], configs: [], memory: [] };
      const picked = await showPicker({
        ...items,
        sourceLabel: 'This device',
      });
      if (!picked) return { ok: false, error: 'cancelled' };

      const signingKey = ctx.getSigningKey ? await ctx.getSigningKey() : null;
      const sourceDid = ctx.getSourceDid ? ctx.getSourceDid() : null;
      if (!signingKey || !sourceDid) return { ok: false, error: 'no signing identity available' };

      const result = await publishDeploy({
        items: picked.items,
        targetPubKey: entry.peerPublicKey,
        signingKey,
        sourceDid,
        pod: ctx.state?.pod,
        manifestExtras: picked.manifest,
      });
      if (result.ok) await store.recordSync(deviceId);
      return result;
    },

    /** Remove a paired device locally. */
    async onUnpair(deviceId) {
      const store = ctx.state?.pairedDevices;
      if (!store) return false;
      const entry = await store.get(deviceId);
      if (!entry) return false;
      const ok = await confirm(`Unpair "${entry.label || deviceId}"? This removes the device from this device's pairing list. The other device keeps its own copy.`);
      if (!ok) return false;
      return store.remove(deviceId);
    },
  };
}

/**
 * Build the Trusted Publishers controller.
 *
 * @param {ControllerCtx} ctx
 * @returns {{onRevokeSource:Function, onRetrustSource:Function, onRevokeApproval:Function, onRollback:Function}}
 */
export function buildTrustedPublishersController(ctx) {
  const confirm = ctx.confirm || defaultConfirm;

  return {
    async onRevokeSource(source) {
      const acl = ctx.state?.deployTarget?.deployAcl;
      if (!acl) return false;
      const ok = await confirm(`Revoke trust for source ${source.slice(0, 24)}…?`);
      if (!ok) return false;
      return acl.revoke(source);
    },

    async onRetrustSource(source) {
      const acl = ctx.state?.deployTarget?.deployAcl;
      if (!acl) return false;
      // Re-trust = grant again with the existing label.
      const list = await acl.list();
      const existing = list.find(s => s.source === source);
      await acl.grant(source, existing?.label || null);
      return true;
    },

    async onRevokeApproval(source, manifestHash) {
      const approvals = ctx.state?.deployTarget?.deployApprovals;
      if (!approvals) return false;
      const ok = await confirm(`Revoke approval for manifest ${manifestHash.slice(0, 16)}…? Future deploys with this fingerprint will re-prompt.`);
      if (!ok) return false;
      return approvals.revoke(source, manifestHash);
    },

    async onRollback(eventId) {
      const snapshots = ctx.state?.deployTarget?.deploySnapshots;
      if (!snapshots) return { ok: false, error: 'no snapshot ring' };
      const ok = await confirm(`Roll back to the state before deploy event ${eventId}? Items applied in this and any later deploys may be undone.`);
      if (!ok) return { ok: false, error: 'cancelled' };
      try {
        const restored = await snapshots.restore(eventId);
        return { ok: true, restored };
      } catch (e) {
        return { ok: false, error: e?.message || String(e) };
      }
    },
  };
}
