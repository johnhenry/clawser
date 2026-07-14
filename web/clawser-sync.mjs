/**
 * clawser-sync.mjs — Personal multi-device sync engine.
 *
 * Coordinates outbound and inbound sync traffic between paired devices
 * (devices that share the same did:key via the pairing flow). The
 * engine owns:
 *   - a debounced outbound queue (500ms windows by default)
 *   - kind-aware dispatch: `yjs` updates delegate to a pluggable Y.js
 *     applicator; `lww` updates carry a (timestamp, source) tuple and
 *     resolve via last-write-wins on the receiver
 *   - atomic batch apply on the receiver: snapshot first, stage every
 *     item, commit, restore on any failure
 *
 * Wire envelope (matches the spec):
 *   {
 *     type: 'sync',
 *     kind: 'yjs' | 'lww',
 *     itemId: string,
 *     payload: <transport-specific>,
 *     ts: number,           // sender's clock at update time
 *     source: string,       // sender's deviceId
 *     vector?: ...          // (yjs) Y state vector, optional
 *   }
 *
 * The engine is transport-agnostic — it calls `pod.sendMessage(peerId,
 * envelope)` for each paired peer. Inbound delivery is the caller's job:
 * route raw mesh messages with `type === 'sync'` to `engine.handleIncoming`.
 */

const DEFAULT_DEBOUNCE_MS = 500;

/**
 * @typedef {object} SyncStore
 * @property {(kind: string, itemId: string, current: object|null, incoming: object) => Promise<void>} stageApply
 *   - Stage an incoming update. Must NOT commit yet — staged writes are
 *     either committed by `commit()` or discarded by `discard()`.
 * @property {(kind: string, itemId: string) => Promise<{payload:any, ts:number, source:string}|null>} get
 *   - Read the current value (used to compare LWW timestamps).
 * @property {() => Promise<void>} commit
 * @property {() => Promise<void>} discard
 */

/**
 * @typedef {object} SyncSnapshot
 * @property {() => Promise<string>} create        - returns snapshot id
 * @property {(id: string) => Promise<void>} restore
 */

/**
 * @typedef {object} YjsApplicator
 * @property {(itemId: string, update: Uint8Array) => Promise<void>} applyUpdate
 *   - Apply a Y update to the named doc.
 * @property {(itemId: string) => Promise<Uint8Array>} encodeStateAsUpdate
 *   - Snapshot a doc's current state for outbound sync.
 */

/**
 * Resolve a last-write-wins conflict.
 *   - Higher `ts` wins.
 *   - On equal `ts`, lexicographically larger `source` wins (any total
 *     order is fine; this is deterministic and source-symmetric so two
 *     peers concurrently resolving converge to the same answer).
 *
 * Exported for testing.
 *
 * @param {{ts:number, source:string}|null} current
 * @param {{ts:number, source:string}} incoming
 * @returns {boolean} true if `incoming` should replace `current`
 */
export const lwwShouldReplace = (current, incoming) => {
  if (!current) return true;
  if (incoming.ts > current.ts) return true;
  if (incoming.ts < current.ts) return false;
  return incoming.source > current.source;
};

/**
 * Personal-device sync engine.
 */
export class SyncEngine {
  #pod;
  #store;
  #snapshot;
  #yjs;
  #self;
  #clock;
  #debounceMs;
  #peers = new Set();
  #pending = new Map();   // itemId -> {kind, payload, ts}
  #flushTimer = null;
  #incomingLog = [];

  /**
   * @param {object} opts
   * @param {object}        opts.pod            - has `sendMessage(peerId, envelope)`
   * @param {SyncStore}     opts.store
   * @param {SyncSnapshot}  [opts.snapshot]     - if absent, atomicity becomes
   *                                              best-effort (no snapshot/restore)
   * @param {YjsApplicator} [opts.yjs]          - required for `kind: 'yjs'`
   * @param {string}        opts.selfDeviceId
   * @param {() => number}  [opts.clock]
   * @param {number}        [opts.debounceMs]
   */
  constructor({ pod, store, snapshot = null, yjs = null, selfDeviceId, clock = Date.now, debounceMs = DEFAULT_DEBOUNCE_MS }) {
    if (!pod || typeof pod.sendMessage !== 'function') {
      throw new Error('SyncEngine requires a pod with sendMessage');
    }
    if (!store) throw new Error('SyncEngine requires a store');
    if (!selfDeviceId || typeof selfDeviceId !== 'string') {
      throw new Error('SyncEngine requires a selfDeviceId string');
    }
    this.#pod = pod;
    this.#store = store;
    this.#snapshot = snapshot;
    this.#yjs = yjs;
    this.#self = selfDeviceId;
    this.#clock = clock;
    this.#debounceMs = debounceMs;
  }

  // ── peer membership ──────────────────────────────────────────

  addPeer(peerId) {
    if (typeof peerId !== 'string' || !peerId) return;
    if (peerId === this.#self) return;
    this.#peers.add(peerId);
  }
  removePeer(peerId) { this.#peers.delete(peerId); }
  listPeers() { return [...this.#peers].sort(); }

  // ── outbound queue ───────────────────────────────────────────

  /**
   * Enqueue a local update. The update will be flushed to all paired
   * peers after the debounce window unless `flush({manual:true})` is
   * called sooner.
   *
   * @param {string} itemId
   * @param {string} kind     - 'yjs' | 'lww'
   * @param {*}      payload  - LWW: any JSON-safe value; YJS: Uint8Array update
   */
  queueLocal(itemId, kind, payload) {
    if (kind !== 'yjs' && kind !== 'lww') {
      throw new Error(`SyncEngine.queueLocal: unknown kind ${kind}`);
    }
    this.#pending.set(itemId, { kind, payload, ts: this.#clock() });
    this.#scheduleFlush();
  }

  #scheduleFlush() {
    if (this.#flushTimer) return;
    if (typeof setTimeout !== 'function') return;
    this.#flushTimer = setTimeout(() => {
      this.#flushTimer = null;
      this.flush().catch(err => {
        console.warn('[clawser-sync] flush failed:', err?.message || err);
      });
    }, this.#debounceMs);
    if (this.#flushTimer && typeof this.#flushTimer.unref === 'function') {
      this.#flushTimer.unref();
    }
  }

  /**
   * Drain the pending queue and dispatch one envelope per item to every
   * paired peer. Returns a summary `{sent, peers}`. Safe to call when
   * the queue is empty (no-op).
   *
   * @param {object} [opts]
   * @param {boolean} [opts.manual]  - if true, skip the debounce timer
   *                                   (used by "Deploy now")
   * @returns {Promise<{sent:number, peers:number}>}
   */
  async flush(_opts = {}) {
    if (this.#flushTimer) {
      clearTimeout(this.#flushTimer);
      this.#flushTimer = null;
    }
    if (this.#pending.size === 0) return { sent: 0, peers: this.#peers.size };
    const items = [...this.#pending];
    this.#pending.clear();
    let sent = 0;
    for (const [itemId, { kind, payload, ts }] of items) {
      const envelope = { type: 'sync', kind, itemId, payload, ts, source: this.#self };
      for (const peerId of this.#peers) {
        try {
          await this.#pod.sendMessage(peerId, envelope);
          sent++;
        } catch (err) {
          console.warn('[clawser-sync] sendMessage failed:', { peerId, itemId, error: err?.message || err });
        }
      }
    }
    return { sent, peers: this.#peers.size };
  }

  /**
   * Inspect the pending queue (testing aid).
   * @returns {Array<{itemId:string, kind:string, ts:number}>}
   */
  pendingSnapshot() {
    return [...this.#pending].map(([itemId, { kind, ts }]) => ({ itemId, kind, ts }));
  }

  // ── inbound delivery + atomic apply ──────────────────────────

  /**
   * Validate-and-batch a single incoming envelope. Multiple envelopes
   * arriving close together are batched into one atomic apply. The
   * caller decides batching policy by calling `applyBatch(batch)`
   * directly when ready, or `handleIncoming(env)` for one-shot apply.
   *
   * @param {object} envelope
   * @returns {{accepted:boolean, reason?:string, batchItem?:object}}
   */
  validateEnvelope(envelope) {
    if (!envelope || envelope.type !== 'sync') return { accepted: false, reason: 'not a sync envelope' };
    const { kind, itemId, payload, ts, source } = envelope;
    if (kind !== 'yjs' && kind !== 'lww') return { accepted: false, reason: `unknown kind ${kind}` };
    if (typeof itemId !== 'string' || !itemId) return { accepted: false, reason: 'missing itemId' };
    if (typeof ts !== 'number' || !Number.isFinite(ts)) return { accepted: false, reason: 'missing ts' };
    if (typeof source !== 'string' || !source) return { accepted: false, reason: 'missing source' };
    if (source === this.#self) return { accepted: false, reason: 'echo from self' };
    return { accepted: true, batchItem: { kind, itemId, payload, ts, source } };
  }

  /**
   * Convenience: handle one envelope inline, atomically. Equivalent to
   * `applyBatch([env])` after validation.
   *
   * @param {object} envelope
   * @returns {Promise<{ok:boolean, applied:string[], rolledBack?:boolean, error?:string}>}
   */
  async handleIncoming(envelope) {
    const v = this.validateEnvelope(envelope);
    if (!v.accepted) return { ok: false, applied: [], error: v.reason };
    return this.applyBatch([v.batchItem]);
  }

  /**
   * Apply a batch of validated envelope items atomically. Snapshots
   * before the apply (if a snapshot driver is configured); stages each
   * item via the store; commits on success. On any error: rolls back
   * staged writes AND restores the snapshot.
   *
   * @param {Array<{kind:string, itemId:string, payload:any, ts:number, source:string}>} batch
   * @returns {Promise<{ok:boolean, applied:string[], rolledBack:boolean, error?:string, snapshotId?:string}>}
   */
  async applyBatch(batch) {
    if (!Array.isArray(batch) || batch.length === 0) {
      return { ok: true, applied: [], rolledBack: false };
    }
    const applied = [];
    let snapshotId = null;
    if (this.#snapshot && typeof this.#snapshot.create === 'function') {
      try { snapshotId = await this.#snapshot.create(); }
      catch (e) {
        return { ok: false, applied: [], rolledBack: false, error: `snapshot create failed: ${e.message}` };
      }
    }

    try {
      for (const item of batch) {
        if (item.kind === 'lww') {
          const current = await this.#store.get('lww', item.itemId);
          const incoming = { ts: item.ts, source: item.source };
          if (lwwShouldReplace(current, incoming)) {
            await this.#store.stageApply('lww', item.itemId, current, {
              payload: item.payload, ts: item.ts, source: item.source,
            });
            applied.push(item.itemId);
          }
        } else if (item.kind === 'yjs') {
          if (!this.#yjs) throw new Error('Y.js applicator not configured');
          // Y.js merges are commutative — no LWW guard needed; staging
          // the update is sufficient.
          const update = item.payload instanceof Uint8Array
            ? item.payload
            : new Uint8Array(item.payload);
          await this.#store.stageApply('yjs', item.itemId, null, { update, ts: item.ts, source: item.source });
          await this.#yjs.applyUpdate(item.itemId, update);
          applied.push(item.itemId);
        }
      }
      await this.#store.commit();
      if (snapshotId) this.#incomingLog.push({ at: this.#clock(), applied: applied.slice(), snapshotId });
      return { ok: true, applied, rolledBack: false, snapshotId };
    } catch (err) {
      // Best-effort rollback: discard staged writes, then restore the snapshot.
      try { await this.#store.discard(); } catch { /* swallowed: discard failure can't worsen the rollback */ }
      let rolledBack = false;
      if (snapshotId && this.#snapshot?.restore) {
        try { await this.#snapshot.restore(snapshotId); rolledBack = true; }
        catch (rerr) { console.warn('[clawser-sync] snapshot restore failed:', rerr?.message || rerr); }
      }
      return { ok: false, applied: [], rolledBack, error: err?.message || String(err), snapshotId };
    }
  }

  /**
   * Recent incoming-batch log (most-recent-first) for the My Devices UI.
   * @param {number} [limit=20]
   */
  recentIncoming(limit = 20) {
    return this.#incomingLog.slice(-limit).reverse();
  }
}
