/**
 * clawser-multi-device.mjs — workspace-level wiring for sync flags +
 * deploy targets.
 *
 * The infrastructure classes (`SyncFlags`, `DeployAcl`,
 * `DeployApprovals`, `DeployAuditLog`, `DeploySnapshotRing`,
 * `ReplayCounterTracker`, `acceptPackage`) shipped in
 * `clawser-sync-flags.mjs`, `clawser-deploy-target.mjs`, and
 * `clawser-deploy-package.mjs` with full test coverage. This module
 * is what binds them into the active workspace's `state` and routes
 * inbound `pod.onMessage` envelopes to the right consumer.
 *
 * Public API:
 *   - `installMultiDeviceWiring({pod, state, wsId, ...})` — called by
 *     `initWorkspace` after the pod is up. Creates per-workspace
 *     `SyncFlags`, `DeployAcl`, `DeployApprovals`, `DeployAuditLog`,
 *     `DeploySnapshotRing`, `ReplayCounterTracker`. Subscribes to
 *     `pod.onMessage` and routes:
 *       envelope.type === 'sync'          → state.syncEngine.handleIncoming
 *       envelope.type === 'deploy'        → ctx.deployTarget acceptPackage
 *
 *   - `uninstallMultiDeviceWiring(state)` — called on workspace
 *     teardown to clear state and unsubscribe.
 *
 * Per the user's scoping decisions:
 *   - Sync flags     : per-workspace
 *   - Deploy ACL     : per-workspace
 *   - Manifest approvals : per-workspace
 *   - Audit log      : per-workspace
 *   - Snapshot ring  : per-workspace
 *   - Replay counter : per-workspace
 *
 * (Pairing list — not yet implemented at this layer; would be global
 * in a future pass.)
 */

import { SyncFlags } from './clawser-sync-flags.mjs';
import {
  DeployAcl,
  DeployApprovals,
  DeployAuditLog,
  DeploySnapshotRing,
  acceptPackage,
} from './clawser-deploy-target.mjs';
import {
  ReplayCounterTracker,
  verifySignedPackage,
} from './clawser-deploy-package.mjs';
import { createWorkspaceConfigStorage } from './clawser-workspace-storage.mjs';
import { resolveDidKey } from './clawser-did-key.mjs';
import { createDefaultApplyTransport } from './clawser-deploy-apply.mjs';
import { PairedDevicesStore } from './clawser-paired-devices.mjs';

/**
 * @typedef {object} MultiDeviceContext
 * @property {SyncFlags}            syncFlags
 * @property {DeployAcl}            deployAcl
 * @property {DeployApprovals}      deployApprovals
 * @property {DeployAuditLog}       deployAudit
 * @property {DeploySnapshotRing}   deploySnapshots
 * @property {ReplayCounterTracker} replayCounter
 * @property {Function}             unsubscribe
 */

/**
 * Wire the per-workspace sync + deploy services into `state` and
 * subscribe to inbound mesh envelopes.
 *
 * @param {object} args
 * @param {object} args.pod                    — has `onMessage(handler)`
 * @param {object} args.state                  — workspace state object
 * @param {string} args.wsId
 * @param {object} [args.syncEngine]           — has `handleIncoming(env)` (for kind:'sync' envelopes)
 * @param {(req:object) => Promise<boolean>} [args.promptApprove]
 *   user-prompt for first-time-this-manifest approval. If absent,
 *   unapproved manifests are rejected.
 * @param {(source:string) => Promise<CryptoKey>} [args.resolvePublicKey]
 *   resolve a `did:key:` to an Ed25519 public key. Required for deploy.
 * @param {object} [args.snapshotDriver]       — `{create, restore, delete}`; defaults to a no-op driver.
 * @param {object} [args.applyTransport]       — `{applyBatch}` for deploy; defaults to a no-op driver that just confirms.
 * @returns {MultiDeviceContext}
 */
export function installMultiDeviceWiring({
  pod, state, wsId,
  syncEngine = null,
  promptApprove = null,
  resolvePublicKey = resolveDidKey, // default: parse `did:key:` URIs via the standalone resolver
  snapshotDriver = null,
  applyTransport = null,
  /** @type {{writeConfig?:Function, skillsAPI?:object}|null} */
  applyHandlers = null,
}) {
  if (!pod || typeof pod.onMessage !== 'function') {
    throw new Error('installMultiDeviceWiring: pod with onMessage required');
  }
  if (!state) throw new Error('installMultiDeviceWiring: state required');
  if (typeof wsId !== 'string' || !wsId) throw new Error('installMultiDeviceWiring: wsId required');

  // Per-workspace storage adapters
  const syncStorage = createWorkspaceConfigStorage(wsId, 'sync');
  const deployStorage = createWorkspaceConfigStorage(wsId, 'deploy');
  // Paired-devices is conceptually global but persisted under the
  // active workspace's `~/.config/clawser/paired-devices/` per the
  // spec. (Cross-workspace paired-device sync is a future polish
  // item — documented in docs/multi-device-deploy.md.)
  const pairedDevicesStorage = createWorkspaceConfigStorage(wsId, 'paired-devices');

  const syncFlags = new SyncFlags(syncStorage);
  const pairedDevices = new PairedDevicesStore(pairedDevicesStorage);
  const deployAcl = new DeployAcl(deployStorage);
  const deployApprovals = new DeployApprovals(deployStorage);
  const deployAudit = new DeployAuditLog(deployStorage);
  const deploySnapshots = new DeploySnapshotRing(
    deployStorage,
    snapshotDriver || { delete: async () => {}, restore: async () => {} },
  );
  const replayCounter = new ReplayCounterTracker(deployStorage);

  // Default applyTransport: real per-kind handler registry from
  // `clawser-deploy-apply.mjs`. Skill items go through
  // `SkillStorage.writeSkill`, config items through `writeConfig`,
  // memory items through `state.agent.memoryStore`. Caller can
  // override with their own mocks for tests / specialized wiring.
  const defaultApplyTransport = applyTransport
    || createDefaultApplyTransport({
      state, wsId,
      writeConfig: applyHandlers?.writeConfig || null,
      skillsAPI: applyHandlers?.skillsAPI || null,
    });

  // Inbound dispatcher
  const unsubscribe = pod.onMessage(async (envelope, fromPeerId, _meta) => {
    if (!envelope || typeof envelope !== 'object') return;
    if (envelope.type === 'sync' && syncEngine) {
      try { await syncEngine.handleIncoming(envelope); }
      catch (err) {
        if (typeof console !== 'undefined') console.warn('[clawser-multi-device] sync apply failed:', err?.message || err);
      }
      return;
    }
    if (envelope.type === 'deploy' && envelope.package) {
      try {
        await acceptPackage(envelope.package, {
          packageVerifier: { verifySignedPackage },
          replay: replayCounter,
          acl: deployAcl,
          approvals: deployApprovals,
          audit: deployAudit,
          snapshots: deploySnapshots,
          resolvePublicKey,
          promptApprove,
          applyTransport: defaultApplyTransport,
        });
      } catch (err) {
        if (typeof console !== 'undefined') console.warn('[clawser-multi-device] deploy apply failed:', err?.message || err);
      }
    }
  });

  const ctx = {
    syncFlags,
    deployAcl,
    deployApprovals,
    deployAudit,
    deploySnapshots,
    replayCounter,
    unsubscribe,
  };

  state.syncFlags = syncFlags;
  state.pairedDevices = pairedDevices;
  state.deployTarget = ctx;
  return ctx;
}

/**
 * Tear down the per-workspace wiring. Idempotent.
 * @param {object} state
 */
export function uninstallMultiDeviceWiring(state) {
  if (!state) return;
  if (state.deployTarget?.unsubscribe) {
    try { state.deployTarget.unsubscribe(); } catch { /* ignore */ }
  }
  state.deployTarget = null;
  state.syncFlags = null;
  state.pairedDevices = null;
}
