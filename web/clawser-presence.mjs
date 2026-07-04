/**
 * clawser-presence.mjs — Authoritative peer-presence service.
 *
 * Subscribes to a PeerNode's lifecycle events and maintains a presence
 * map of `online` / `idle` / `offline` per peer with timestamps. This
 * extracts what was previously implicit in the PeerNode/SwarmCoordinator
 * heartbeat path into a single addressable surface so consumers (UI
 * panels, mesh-aware tools) can subscribe without coupling to the
 * underlying transport.
 *
 * Public API:
 *   - new PresenceService({ peerNode, idleAfterMs?, offlineAfterMs?, now? })
 *   - .start() / .stop()           — wires PeerNode listeners and idle sweep
 *   - .recordHeartbeat(pubKey)     — call from heartbeat consumers (relay,
 *                                    swarm, app-level) to refresh `lastSeen`
 *   - .getPresence(peerId)         — { status, lastSeen, joinedAt? } | null
 *   - .getAll()                    — Map<peerId, presence>
 *   - .subscribe(cb)               — returns unsubscribe fn; cb({ peerId,
 *                                    status, prevStatus, lastSeen })
 *
 * Timekeeping is injectable via `now` so tests can drive the idle sweep
 * deterministically. The `idleAfterMs` / `offlineAfterMs` thresholds
 * default to values appropriate for an interactive browser-mesh peer
 * (10s/60s) — adjust at construction.
 */

const DEFAULT_IDLE_AFTER_MS = 10_000;
const DEFAULT_OFFLINE_AFTER_MS = 60_000;
const DEFAULT_SWEEP_INTERVAL_MS = 5_000;

/** @typedef {'online'|'idle'|'offline'} PresenceStatus */
/** @typedef {{ status: PresenceStatus, lastSeen: number, joinedAt: number|null }} PresenceEntry */

export class PresenceService {
  #peerNode;
  #idleAfterMs;
  #offlineAfterMs;
  #now;
  #sweepIntervalMs;
  #map = new Map();
  #subscribers = new Set();
  #sweepTimer = null;
  #boundConnect;
  #boundDisconnect;
  #started = false;

  /**
   * @param {object} opts
   * @param {object} [opts.peerNode]      — PeerNode-like; supports on('peer:connect'|'peer:disconnect', cb).
   *                                        Optional so a service can be wired manually via recordHeartbeat.
   * @param {number} [opts.idleAfterMs=10000]    — ms since lastSeen before status flips online → idle
   * @param {number} [opts.offlineAfterMs=60000] — ms since lastSeen before status flips idle → offline
   * @param {number} [opts.sweepIntervalMs=5000] — how often the idle/offline sweep runs (only when started)
   * @param {() => number} [opts.now=Date.now]    — injectable clock for tests
   */
  constructor({ peerNode = null, idleAfterMs, offlineAfterMs, sweepIntervalMs, now } = {}) {
    this.#peerNode = peerNode;
    this.#idleAfterMs = idleAfterMs ?? DEFAULT_IDLE_AFTER_MS;
    this.#offlineAfterMs = offlineAfterMs ?? DEFAULT_OFFLINE_AFTER_MS;
    this.#sweepIntervalMs = sweepIntervalMs ?? DEFAULT_SWEEP_INTERVAL_MS;
    this.#now = now ?? Date.now;
  }

  /** Wire PeerNode listeners and start the periodic idle sweep. Idempotent. */
  start() {
    if (this.#started) return;
    this.#started = true;
    if (this.#peerNode && typeof this.#peerNode.on === 'function') {
      this.#boundConnect = (peer) => {
        const id = this.#peerIdFrom(peer);
        if (id == null) return;
        this.#markOnline(id, this.#now(), { joining: true });
      };
      this.#boundDisconnect = (peer) => {
        const id = this.#peerIdFrom(peer);
        if (id == null) return;
        this.#markOffline(id);
      };
      this.#peerNode.on('peer:connect', this.#boundConnect);
      this.#peerNode.on('peer:disconnect', this.#boundDisconnect);
    }
    if (typeof setInterval === 'function') {
      this.#sweepTimer = setInterval(() => this.sweep(), this.#sweepIntervalMs);
      this.#sweepTimer?.unref?.();
    }
  }

  /** Stop the idle sweep and detach PeerNode listeners. Safe to call multiple times. */
  stop() {
    if (!this.#started) return;
    this.#started = false;
    if (this.#sweepTimer) {
      clearInterval(this.#sweepTimer);
      this.#sweepTimer = null;
    }
    if (this.#peerNode && typeof this.#peerNode.off === 'function') {
      if (this.#boundConnect) this.#peerNode.off('peer:connect', this.#boundConnect);
      if (this.#boundDisconnect) this.#peerNode.off('peer:disconnect', this.#boundDisconnect);
    }
    this.#boundConnect = null;
    this.#boundDisconnect = null;
  }

  /**
   * Record a heartbeat / liveness signal for a peer. Call this from
   * existing heartbeat producers (swarm coordinator, relay, app-level).
   * Promotes idle/offline back to online and updates lastSeen.
   * @param {string} peerId
   * @param {number} [timestamp]
   */
  recordHeartbeat(peerId, timestamp) {
    if (peerId == null) return;
    this.#markOnline(peerId, timestamp ?? this.#now());
  }

  /**
   * Fetch the current presence entry for a peer.
   * @param {string} peerId
   * @returns {PresenceEntry|null}
   */
  getPresence(peerId) {
    const e = this.#map.get(peerId);
    return e ? { ...e } : null;
  }

  /**
   * Snapshot of all known peers' presence. Defensive copy — mutating the
   * returned map does not affect internal state.
   * @returns {Map<string, PresenceEntry>}
   */
  getAll() {
    const out = new Map();
    for (const [id, e] of this.#map) out.set(id, { ...e });
    return out;
  }

  /**
   * Subscribe to presence changes. Callback fires on every status flip
   * (including initial transitions to `online`).
   * @param {(change: { peerId: string, status: PresenceStatus, prevStatus: PresenceStatus|null, lastSeen: number }) => void} cb
   * @returns {() => void} unsubscribe
   */
  subscribe(cb) {
    if (typeof cb !== 'function') throw new TypeError('subscribe expects a function');
    this.#subscribers.add(cb);
    return () => this.#subscribers.delete(cb);
  }

  /**
   * Run the idle/offline sweep once. Normally invoked by the internal
   * timer started by `start()`, but also callable directly so tests can
   * tick it without real time passing.
   */
  sweep() {
    const now = this.#now();
    for (const [peerId, entry] of this.#map) {
      const elapsed = now - entry.lastSeen;
      let next = entry.status;
      if (elapsed >= this.#offlineAfterMs) next = 'offline';
      else if (elapsed >= this.#idleAfterMs) next = next === 'offline' ? 'offline' : 'idle';
      if (next !== entry.status) {
        const prev = entry.status;
        entry.status = next;
        this.#notify({ peerId, status: next, prevStatus: prev, lastSeen: entry.lastSeen });
      }
    }
  }

  // ── internals ───────────────────────────────────────────────────

  #peerIdFrom(peer) {
    if (peer == null) return null;
    if (typeof peer === 'string') return peer;
    return peer.podId ?? peer.peerId ?? peer.pubKey ?? peer.id ?? null;
  }

  #markOnline(peerId, ts, { joining = false } = {}) {
    const existing = this.#map.get(peerId);
    if (!existing) {
      const entry = { status: 'online', lastSeen: ts, joinedAt: joining ? ts : null };
      this.#map.set(peerId, entry);
      this.#notify({ peerId, status: 'online', prevStatus: null, lastSeen: ts });
      return;
    }
    // Refresh lastSeen unconditionally (heartbeats from idle peers should
    // bump the freshness even when no status flip happens).
    existing.lastSeen = ts;
    if (joining && existing.joinedAt == null) existing.joinedAt = ts;
    if (existing.status !== 'online') {
      const prev = existing.status;
      existing.status = 'online';
      this.#notify({ peerId, status: 'online', prevStatus: prev, lastSeen: ts });
    }
  }

  #markOffline(peerId) {
    const existing = this.#map.get(peerId);
    if (!existing) return;
    if (existing.status === 'offline') return;
    const prev = existing.status;
    existing.status = 'offline';
    this.#notify({ peerId, status: 'offline', prevStatus: prev, lastSeen: existing.lastSeen });
  }

  #notify(change) {
    for (const cb of this.#subscribers) {
      try { cb(change); }
      catch (err) {
        console.warn('[presence] subscriber threw:', { peerId: change.peerId, status: change.status, error: err?.message || err });
      }
    }
  }
}
