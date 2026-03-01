// clawser-notifications.js — Notification Manager
//
// Centralized notification system with:
//   - Notification queue with unique IDs
//   - Batching (configurable time window)
//   - Browser Notification API permission flow
//   - Notification types: info, warning, error, success
//   - History, dismiss, clear

// ── NotificationManager ─────────────────────────────────────────

/**
 * Centralized notification manager with batching and permission flow.
 */
export class NotificationManager {
  /** @type {Map<string, object>} Notification history by ID */
  #history = new Map();

  /** @type {object[]} Pending batch buffer */
  #batch = [];

  /** @type {number} Batch window in ms (0 = no batching) */
  #batchWindow;

  /** @type {number|null} Batch timer ID */
  #batchTimer = null;

  /** @type {number} Auto-increment for IDs */
  #nextId = 1;

  /** @type {Function|null} Callback for delivered notifications */
  #onNotify = null;

  /** @type {object} Per-type enable/disable preferences */
  #preferences;

  /** @type {object|null} Quiet hours config { start: 0-23, end: 0-23 } */
  #quietHours;

  /**
   * @param {object} [opts]
   * @param {number} [opts.batchWindow=0] - Batch window in ms (0 = immediate)
   * @param {Function} [opts.onNotify] - Callback for delivered notifications
   * @param {object} [opts.preferences] - Per-type toggles { info: true, warning: true, error: true, success: true }
   * @param {object} [opts.quietHours] - { start: hour, end: hour } — suppress all during window
   */
  constructor(opts = {}) {
    this.#batchWindow = opts.batchWindow ?? 0;
    this.#onNotify = opts.onNotify || null;
    this.#preferences = opts.preferences || { info: true, warning: true, error: true, success: true };
    this.#quietHours = opts.quietHours || null;
  }

  /** Per-type notification preferences. */
  get preferences() { return { ...this.#preferences }; }

  /** @returns {object|null} Current quiet hours config or null. */
  getQuietHours() { return this.#quietHours ? { ...this.#quietHours } : null; }

  /** @param {object|null} config - { start: 0-23, end: 0-23 } or null to disable. */
  setQuietHours(config) { this.#quietHours = config || null; }

  /**
   * Update a single type preference.
   * @param {string} type - 'info'|'warning'|'error'|'success'
   * @param {boolean} enabled
   */
  setPreference(type, enabled) {
    this.#preferences[type] = enabled;
  }

  /** Set the notification delivery callback. */
  set onNotify(fn) { this.#onNotify = fn; }

  /** Number of pending (undelivered batched) notifications. */
  get pending() { return this.#batch.length; }

  /**
   * Enqueue a notification.
   * @param {object} opts
   * @param {string} opts.type - 'info'|'warning'|'error'|'success'
   * @param {string} opts.title - Notification title
   * @param {string} opts.body - Notification body
   * @param {object} [opts.data] - Optional extra data
   */
  notify(opts) {
    const type = opts.type || 'info';

    // Check type preference
    if (this.#preferences[type] === false) return;

    // Check quiet hours
    if (this.#quietHours) {
      const hour = new Date().getHours();
      const { start, end } = this.#quietHours;
      if (start <= end) {
        if (hour >= start && hour < end) return;
      } else {
        // Wraps midnight (e.g., 22-6)
        if (hour >= start || hour < end) return;
      }
    }

    const notif = {
      id: `notif-${this.#nextId++}`,
      type,
      title: opts.title || '',
      body: opts.body || '',
      data: opts.data || null,
      timestamp: Date.now(),
    };

    if (this.#batchWindow <= 0) {
      // Immediate delivery
      this.#history.set(notif.id, notif);
      this.#deliver(notif);
    } else {
      // Batched delivery
      this.#batch.push(notif);
      this.#scheduleBatch();
    }
  }

  /**
   * List all notifications in history.
   * @returns {object[]}
   */
  list() {
    return [...this.#history.values()];
  }

  /**
   * Dismiss (remove) a notification by ID.
   * @param {string} id
   */
  dismiss(id) {
    this.#history.delete(id);
  }

  /**
   * Clear all notifications.
   */
  clear() {
    this.#history.clear();
    this.#batch = [];
    if (this.#batchTimer !== null) {
      clearTimeout(this.#batchTimer);
      this.#batchTimer = null;
    }
  }

  /**
   * Force-deliver all batched notifications immediately.
   */
  flush() {
    if (this.#batchTimer !== null) {
      clearTimeout(this.#batchTimer);
      this.#batchTimer = null;
    }
    this.#deliverBatch();
  }

  /**
   * Request browser notification permission.
   * @returns {Promise<string>} 'granted'|'denied'|'unavailable'
   */
  async requestPermission() {
    if (typeof Notification === 'undefined') return 'unavailable';
    try {
      const result = await Notification.requestPermission();
      return result;
    } catch {
      return 'denied';
    }
  }

  /** Schedule batch delivery after the window expires. */
  #scheduleBatch() {
    if (this.#batchTimer !== null) return; // Already scheduled
    this.#batchTimer = setTimeout(() => {
      this.#batchTimer = null;
      this.#deliverBatch();
    }, this.#batchWindow);
  }

  /** Deliver all batched notifications as a summary. */
  #deliverBatch() {
    if (this.#batch.length === 0) return;

    if (this.#batch.length === 1) {
      // Single notification — deliver directly
      const notif = this.#batch[0];
      this.#history.set(notif.id, notif);
      this.#deliver(notif);
    } else {
      // Multiple notifications — create summary
      const count = this.#batch.length;
      const summary = {
        id: `notif-${this.#nextId++}`,
        type: 'info',
        title: `${count} notifications`,
        body: this.#batch.map(n => `[${n.type}] ${n.title}: ${n.body}`).join('\n'),
        data: { batched: true, count, items: this.#batch.map(n => n.id) },
        timestamp: Date.now(),
      };

      // Store individual notifications in history
      for (const notif of this.#batch) {
        this.#history.set(notif.id, notif);
      }
      // Store and deliver summary
      this.#history.set(summary.id, summary);
      this.#deliver(summary);
    }

    this.#batch = [];
  }

  /** Deliver a notification via callback. */
  #deliver(notif) {
    if (this.#onNotify) this.#onNotify(notif);
  }
}
