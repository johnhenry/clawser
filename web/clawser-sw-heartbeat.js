// clawser-sw-heartbeat.js — Service Worker heartbeat loop
//
// Provides a heartbeat loop that can run inside a Service Worker.
// Uses periodicSync API if available, falls back to client postMessage wake.
// On each tick: runs registered health checks, broadcasts results via BroadcastChannel.

// ── Constants ───────────────────────────────────────────────────

export const HEARTBEAT_CHANNEL = 'clawser-heartbeat';
export const HEARTBEAT_INTERVAL_MS = 60_000; // 1 minute default
const PERIODIC_SYNC_TAG = 'clawser-heartbeat';

// ── SwHeartbeat ─────────────────────────────────────────────────

/**
 * Heartbeat loop for Service Worker context.
 * Runs periodic health checks and broadcasts results.
 */
export class SwHeartbeat {
  /** @type {number|null} Interval timer ID */
  #timer = null;

  /** @type {boolean} */
  #running = false;

  /** @type {number} Total ticks executed */
  #tickCount = 0;

  /** @type {Map<string, Function>} Registered health check functions */
  #checks = new Map();

  /** @type {Function|null} Callback on each tick */
  onTick = null;

  /** @type {number} Interval in ms */
  #intervalMs;

  /**
   * @param {object} [opts]
   * @param {number} [opts.intervalMs] - Tick interval in milliseconds
   */
  constructor(opts = {}) {
    this.#intervalMs = opts.intervalMs || HEARTBEAT_INTERVAL_MS;
  }

  // ── Public API ─────────────────────────────────────────────────

  /** Whether the heartbeat loop is running. */
  get running() {
    return this.#running;
  }

  /** Number of ticks executed since start. */
  get tickCount() {
    return this.#tickCount;
  }

  /** Number of registered health checks. */
  get checkCount() {
    return this.#checks.size;
  }

  /**
   * Whether the Periodic Background Sync API is available.
   * @returns {boolean}
   */
  get periodicSyncAvailable() {
    return typeof self !== 'undefined' &&
      'serviceWorker' in (self.navigator || {}) &&
      'periodicSync' in (self.registration || {});
  }

  /**
   * Start the heartbeat loop.
   * Tries periodicSync first, falls back to setInterval.
   */
  start() {
    if (this.#running) return;
    this.#running = true;

    if (this.periodicSyncAvailable) {
      this.#registerPeriodicSync();
    } else {
      this.#timer = setInterval(() => this.tick(), this.#intervalMs);
    }
  }

  /**
   * Stop the heartbeat loop.
   */
  stop() {
    if (this.#timer !== null) {
      clearInterval(this.#timer);
      this.#timer = null;
    }
    this.#running = false;
  }

  /**
   * Execute a single heartbeat tick.
   * Runs all registered checks and broadcasts results.
   * @returns {Promise<object>} Tick results
   */
  async tick() {
    this.#tickCount++;

    // Run all registered checks
    const results = {};
    for (const [name, checkFn] of this.#checks) {
      try {
        results[name] = await checkFn();
      } catch (e) {
        results[name] = { error: e.message };
      }
    }

    // Build heartbeat message
    const message = {
      type: 'heartbeat',
      timestamp: Date.now(),
      tickCount: this.#tickCount,
      results,
    };

    // Broadcast via BroadcastChannel
    this.#broadcast(message);

    // Call onTick callback if set
    if (this.onTick) {
      try { this.onTick(message); } catch { /* ignore callback errors */ }
    }

    return message;
  }

  // ── Health check registration ──────────────────────────────────

  /**
   * Register a health check function.
   * @param {string} name - Unique check name
   * @param {Function} fn - async () => object
   */
  addCheck(name, fn) {
    this.#checks.set(name, fn);
  }

  /**
   * Remove a health check.
   * @param {string} name
   * @returns {boolean}
   */
  removeCheck(name) {
    return this.#checks.delete(name);
  }

  // ── Client wake (fallback) ─────────────────────────────────────

  /**
   * Wake connected clients via postMessage.
   * Used as a fallback when periodicSync is unavailable.
   * Should be called from the SW fetch/message event.
   */
  async wakeClients() {
    if (typeof self === 'undefined' || !self.clients) return;
    const clients = await self.clients.matchAll({ type: 'window' });
    for (const client of clients) {
      client.postMessage({ type: 'heartbeat-wake' });
    }
  }

  // ── Internal ───────────────────────────────────────────────────

  #broadcast(message) {
    try {
      const channel = new BroadcastChannel(HEARTBEAT_CHANNEL);
      channel.postMessage(message);
      channel.close();
    } catch {
      // BroadcastChannel not available — silent fallback
    }
  }

  async #registerPeriodicSync() {
    try {
      const registration = self.registration;
      if (registration?.periodicSync) {
        await registration.periodicSync.register(PERIODIC_SYNC_TAG, {
          minInterval: this.#intervalMs,
        });
      }
    } catch {
      // periodicSync registration failed — fall back to interval
      this.#timer = setInterval(() => this.tick(), this.#intervalMs);
    }
  }
}
