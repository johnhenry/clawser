/**
 * clawser-quota-guard.mjs — pre-write OPFS/IDB storage quota guard.
 *
 * Wraps `checkQuota()` (clawser-tools.js) so write sites can ask "is
 * there room?" before committing bytes, rather than discovering
 * `QuotaExceededError` after the fact. Also provides oldest-first
 * eviction for auto-created snapshots when usage runs high.
 *
 * @module clawser-quota-guard
 */

import { checkQuota } from './clawser-tools.js';

/** Module-level warn-once state: re-arms once usage drops back below the warning threshold. */
let warnedThisSession = false;

/** Reset warn-once state. Exposed for tests; also useful after a manual cleanup. */
export function resetQuotaWarningState() {
  warnedThisSession = false;
}

/**
 * Check whether a write of `sizeBytes` should proceed.
 *
 * - `critical` (>=95%): denied outright.
 * - `warning` (>=80%): allowed, but flags `warned: true` the first time
 *   per session (re-arms once usage drops back below 80%). Calls
 *   `opts.onWarning()` once when the warning first fires, so callers
 *   can trigger eviction opportunistically.
 * - Otherwise: allowed silently.
 *
 * @param {number} sizeBytes - Size of the pending write (informational; not currently size-gated beyond quota %)
 * @param {string} op - Short label for the operation (used in the denial reason)
 * @param {object} [opts]
 * @param {Function} [opts.checkQuotaFn] - Override for `checkQuota()` (tests)
 * @param {Function} [opts.onWarning] - async () => void, called once when warning first fires
 * @returns {Promise<{ok: boolean, warned: boolean, reason?: string, percent: number}>}
 */
export async function guardBeforeWrite(sizeBytes, op, opts = {}) {
  const checkQuotaFn = opts.checkQuotaFn || checkQuota;
  const quota = await checkQuotaFn();

  if (quota.critical) {
    return { ok: false, warned: false, percent: quota.percent, reason: `Storage nearly full (${Math.round(quota.percent)}%) — refusing ${op} to avoid a hard quota failure` };
  }

  if (!quota.warning) {
    warnedThisSession = false; // re-arm once usage is comfortably below threshold
    return { ok: true, warned: false, percent: quota.percent };
  }

  const warned = !warnedThisSession;
  if (warned) {
    warnedThisSession = true;
    if (opts.onWarning) await opts.onWarning();
  }
  return { ok: true, warned, percent: quota.percent };
}

/**
 * Evict the oldest auto-created snapshots until quota drops out of the
 * warning range, up to `maxToPrune` deletions, always keeping at least
 * `keepMinimum` snapshots regardless of pressure.
 *
 * @param {{listSnapshots: Function, deleteSnapshot: Function}} snapshotManager - SnapshotManager instance
 * @param {object} [opts]
 * @param {number} [opts.keepMinimum=3] - Never prune below this many snapshots
 * @param {number} [opts.maxToPrune=20] - Safety cap on deletions per call
 * @param {Function} [opts.checkQuotaFn] - Override for `checkQuota()` (tests)
 * @returns {Promise<string[]>} IDs of snapshots pruned, oldest-first
 */
export async function evictOldestSnapshots(snapshotManager, opts = {}) {
  const keepMinimum = opts.keepMinimum ?? 3;
  const maxToPrune = opts.maxToPrune ?? 20;
  const checkQuotaFn = opts.checkQuotaFn || checkQuota;

  let quota = await checkQuotaFn();
  if (!quota.warning) return [];

  const list = await snapshotManager.listSnapshots(); // newest-first
  const oldestFirst = [...list].reverse();
  const pruned = [];

  for (const snap of oldestFirst) {
    if (list.length - pruned.length <= keepMinimum) break;
    if (pruned.length >= maxToPrune) break;
    quota = await checkQuotaFn();
    if (!quota.warning) break;
    await snapshotManager.deleteSnapshot(snap.id);
    pruned.push(snap.id);
  }
  return pruned;
}
