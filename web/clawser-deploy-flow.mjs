/**
 * clawser-deploy-flow.mjs — production wiring for the deploy pickers.
 *
 * The deploy controllers (`buildMyDevicesController`, mesh dashboard
 * `deploySkillFlow`) take injectable `resolveItems` / `getSigningKey` /
 * `getSourceDid` hooks. This module supplies the real implementations
 * from workspace state so both entry points share one flow:
 *
 *   - skills  → SkillRegistry entries + SkillStorage.readSkill files
 *   - configs → ReactiveConfigStore domains (autonomy, identity, …)
 *   - memory  → agent memory entries (key/content/category)
 *   - signing → default mesh identity's Ed25519 private key + did:key
 *
 * All state access is defensive: a missing subsystem contributes an
 * empty section instead of failing the whole picker.
 *
 * @module clawser-deploy-flow
 */

import { SkillStorage } from './clawser-skills.js';

/**
 * Collect deployable items from workspace state.
 *
 * @param {object} state - Workspace state (skillRegistry, reactiveConfigStore, agent)
 * @param {object} [deps]
 * @param {Function} [deps.readSkillFn] - (scope, wsId, name) => Map<path, content> (test override)
 * @returns {Promise<{skills: Array, configs: Array, memory: Array}>} PickerItemRef arrays
 */
export async function resolveDeployItems(state, deps = {}) {
  const readSkill = deps.readSkillFn || SkillStorage.readSkill.bind(SkillStorage);
  const wsId = state?.agent?.getWorkspace?.() || 'default';

  const skills = [];
  try {
    for (const [name, entry] of state?.skillRegistry?.skills || []) {
      let files = {};
      try {
        const fileMap = await readSkill(entry.scope || 'workspace', wsId, entry.dirName || name);
        files = Object.fromEntries(fileMap);
      } catch { continue; } // unreadable skill — skip rather than break the picker
      skills.push({
        kind: 'skill',
        itemId: name,
        label: `${name} (${entry.scope || 'workspace'})`,
        payload: { files, scope: entry.scope || 'workspace' },
      });
    }
  } catch { /* no skill registry — empty section */ }

  const configs = [];
  try {
    const store = state?.reactiveConfigStore;
    for (const domain of store?.listDomains?.() || []) {
      const value = store.get(domain) ?? await store.readFromDisk(domain);
      if (value == null) continue;
      configs.push({ kind: 'config', itemId: domain, label: `${domain}.json`, payload: value });
    }
  } catch { /* no config store — empty section */ }

  const memory = [];
  try {
    for (const entry of state?.agent?.memory?.exportToFlatArray?.() || []) {
      if (!entry?.key || typeof entry.content !== 'string') continue;
      memory.push({
        kind: 'memory',
        itemId: entry.key,
        label: `${entry.key} [${entry.category || 'learned'}]`,
        payload: { key: entry.key, content: entry.content, category: entry.category || 'learned' },
      });
    }
  } catch { /* no memory — empty section */ }

  return { skills, configs, memory };
}

/**
 * The default mesh identity's private key, for signing deploy manifests.
 * @param {object} state
 * @returns {Promise<CryptoKey|null>}
 */
export async function getDeploySigningKey(state) {
  const mgr = state?.identityManager && state.identityManager.getIdentity
    ? state.identityManager
    : state?.meshIdentityManager;
  const podId = mgr?.getDefault?.()?.podId;
  if (!mgr || !podId) return null;
  return mgr.getIdentity(podId)?.keyPair?.privateKey || null;
}

/**
 * The default mesh identity's did:key URI (deploy manifest source).
 * @param {object} state
 * @returns {string|null}
 */
export function getDeploySourceDid(state) {
  const mgr = state?.identityManager && state.identityManager.toDID
    ? state.identityManager
    : state?.meshIdentityManager;
  const podId = mgr?.getDefault?.()?.podId;
  if (!mgr || !podId) return null;
  try { return mgr.toDID(podId); } catch { return null; }
}

/**
 * Bundle the three hooks for `buildMyDevicesController` / panel mounts.
 * @param {object} state
 * @returns {{resolveItems: Function, getSigningKey: Function, getSourceDid: Function}}
 */
export function buildDeployFlowOpts(state) {
  return {
    resolveItems: () => resolveDeployItems(state),
    getSigningKey: () => getDeploySigningKey(state),
    getSourceDid: () => getDeploySourceDid(state),
  };
}

/**
 * One-click deploy flow for the Mesh dashboard: choose a paired device
 * (auto-selected when only one exists), then run the standard
 * pick-items → sign → publish flow.
 *
 * @param {object} state - Workspace state
 * @param {object} [deps]
 * @param {Function} [deps.pickDevice] - async (devices) => device|null (multi-device chooser)
 * @param {Function} [deps.buildController] - test override for buildMyDevicesController
 * @returns {Promise<{ok: boolean, deviceId?: string, error?: string}>}
 */
export async function runMeshDeployFlow(state, deps = {}) {
  const store = state?.pairedDevices;
  if (!store) return { ok: false, error: 'multi-device sync not initialized' };

  const devices = await store.list();
  if (!devices || devices.length === 0) {
    return { ok: false, error: 'no paired devices — pair one in Settings → My Devices' };
  }

  let device = devices[0];
  if (devices.length > 1) {
    const picked = deps.pickDevice ? await deps.pickDevice(devices) : devices[0];
    if (!picked) return { ok: false, error: 'cancelled' };
    device = picked;
  }

  const build = deps.buildController
    || (await import('./clawser-multi-device-controllers.mjs')).buildMyDevicesController;
  const controller = build({ state, ...buildDeployFlowOpts(state) });
  const result = await controller.onDeployNow(device.id);
  return { ...result, deviceId: device.id };
}
