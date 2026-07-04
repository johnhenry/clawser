/**
 * clawser-yjs-applicator.mjs — Y.js bridge for the personal-sync engine.
 *
 * Closes A.3 of the deploy work. The sync engine has a `YjsApplicator`
 * delegation hook with two methods (`applyUpdate(itemId, update)` and
 * `encodeStateAsUpdate(itemId)`); this module provides a real
 * implementation backed by `YjsAdapter` from `clawser-peer-collab.js`.
 *
 * Each Y.js doc the user wants synced lives in a `YjsAdapter` keyed by
 * `itemId`. The registry:
 *
 *   - Lazy-creates adapters on demand so docs don't need pre-registration.
 *   - Routes inbound `kind: 'yjs'` envelopes to `adapter.applyUpdate`.
 *   - Bridges outbound: when an adapter emits a local update, the
 *     registry wraps it as a `kind: 'yjs'` envelope and queues it on
 *     the sync engine. The engine handles debouncing + per-peer
 *     dispatch via the existing `pod.sendMessage` path.
 *
 * Wire-format compatibility: the existing sync envelope already
 * carries `kind: 'yjs'`, `itemId`, `payload` (the update bytes), `ts`,
 * `source`. No changes needed.
 *
 * `clawser-peer-collab.js` itself manages a separate `CollabSession`
 * transport for pair-wise live editing. That subsystem is unchanged —
 * we use only the doc-level `YjsAdapter` class, which is
 * transport-agnostic. Personal sync goes through the engine's
 * pod-routed transport.
 */

import { YjsAdapter } from './clawser-peer-collab.js';

/**
 * Adapter registry + sync-engine bridge.
 *
 * Construction takes the optional `Y` module (Yjs) so consumers can
 * inject the real Yjs in production and a stub in tests; matches the
 * pattern in `YjsAdapter`.
 */
export class YjsApplicatorRegistry {
  /** @type {Map<string, YjsAdapter>} */
  #adapters = new Map();
  #Y = null;
  #syncEngine = null;
  #boundItems = new Set();
  #unsubByItem = new Map();

  /**
   * @param {object} [opts]
   * @param {object} [opts.Y]            - Yjs module (injected for testing)
   * @param {object} [opts.syncEngine]   - SyncEngine instance to forward outbound updates to
   */
  constructor({ Y = null, syncEngine = null } = {}) {
    this.#Y = Y;
    this.#syncEngine = syncEngine;
  }

  /** Late-bind / replace the sync engine. Useful when constructing the
   *  registry before the engine is ready. */
  setSyncEngine(engine) {
    this.#syncEngine = engine;
  }

  /**
   * Get (or lazily create) the adapter for an itemId.
   * @param {string} itemId
   * @returns {YjsAdapter}
   */
  getOrCreateAdapter(itemId) {
    if (typeof itemId !== 'string' || !itemId) throw new Error('itemId is required');
    let a = this.#adapters.get(itemId);
    if (!a) {
      a = new YjsAdapter(itemId, this.#Y ? { Y: this.#Y } : {});
      this.#adapters.set(itemId, a);
    }
    return a;
  }

  /**
   * Whether the registry has seen this itemId.
   * @param {string} itemId
   * @returns {boolean}
   */
  hasAdapter(itemId) { return this.#adapters.has(itemId); }

  // ── YjsApplicator interface (consumed by SyncEngine.applyBatch) ──

  /**
   * Apply an inbound Y.js update. The sync engine calls this when it
   * receives a `kind: 'yjs'` envelope. Origin is tagged so the
   * registry's outbound bridge can ignore the echoing local-update
   * event that Yjs fires from `applyUpdate` itself.
   *
   * `YjsAdapter.applyUpdate` doesn't take an origin argument, so we
   * reach into its underlying doc and use `Y.applyUpdate(doc, update,
   * origin)` directly when Y is available. In stub mode (no Y) we
   * fall back to the adapter's stub append.
   *
   * @param {string} itemId
   * @param {Uint8Array} update
   */
  async applyUpdate(itemId, update) {
    const adapter = this.getOrCreateAdapter(itemId);
    if (this.#Y && adapter.doc) {
      this.#Y.applyUpdate(adapter.doc, update, REMOTE_ORIGIN);
    } else {
      adapter.applyUpdate(update);
    }
  }

  /**
   * Encode the doc's full state as a Yjs update. Used when a peer asks
   * for the current state (state-sync or new-pairing).
   *
   * `YjsAdapter` calls this method `encodeState()` internally; we
   * preserve the more conventional `encodeStateAsUpdate` name on the
   * registry (matching the `YjsApplicator` interface the SyncEngine
   * expects).
   *
   * @param {string} itemId
   * @returns {Promise<Uint8Array>}
   */
  async encodeStateAsUpdate(itemId) {
    const adapter = this.getOrCreateAdapter(itemId);
    return adapter.encodeState();
  }

  // ── Outbound bridge ────────────────────────────────────────────

  /**
   * Bind a doc to the sync engine: when a local update fires on the
   * adapter, queue a `kind: 'yjs'` envelope on the engine. Updates
   * with the special `REMOTE_ORIGIN` tag are skipped — they came IN
   * via `applyUpdate` and shouldn't be echoed back out.
   *
   * Idempotent: calling twice with the same itemId is a no-op.
   *
   * @param {string} itemId
   */
  bindForSync(itemId) {
    if (!this.#syncEngine) throw new Error('YjsApplicatorRegistry: no sync engine bound');
    if (this.#boundItems.has(itemId)) return;
    const adapter = this.getOrCreateAdapter(itemId);
    const cb = (update, origin) => {
      // Skip the loop-back from a remote-applied update.
      if (origin === REMOTE_ORIGIN) return;
      this.#syncEngine.queueLocal(itemId, 'yjs', update);
    };
    adapter.onUpdate(cb);
    this.#boundItems.add(itemId);
    // YjsAdapter doesn't expose an explicit unbind; track the cb so a
    // future unbind helper can use it (and so the test can introspect).
    this.#unsubByItem.set(itemId, cb);
  }

  /**
   * Stop forwarding updates for an item. Best-effort — the underlying
   * `YjsAdapter` may not support listener removal in stub mode, in
   * which case we just stop tracking it as bound.
   * @param {string} itemId
   */
  unbindFromSync(itemId) {
    this.#boundItems.delete(itemId);
    this.#unsubByItem.delete(itemId);
  }

  /**
   * Snapshot of which items are currently bound for outbound sync.
   * Used for tests / UI listings.
   * @returns {string[]}
   */
  listBound() { return [...this.#boundItems].sort(); }

  /**
   * Tear down every adapter. Called during workspace shutdown.
   */
  destroy() {
    for (const a of this.#adapters.values()) {
      try { a.destroy?.(); } catch { /* best-effort */ }
    }
    this.#adapters.clear();
    this.#boundItems.clear();
    this.#unsubByItem.clear();
  }
}

/** Sentinel origin tag for updates we just pushed via `applyUpdate`. */
const REMOTE_ORIGIN = Symbol('REMOTE_ORIGIN');

export const _yjsApplicatorInternals = { REMOTE_ORIGIN };
