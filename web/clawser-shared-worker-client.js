// clawser-shared-worker-client.js — SharedWorker client
//
// Provides an async API that mirrors the agent interface, connecting
// to the SharedWorker host via a MessagePort.

import { MSG_TYPES } from './shared-worker.js';

// ── SharedWorkerClient ──────────────────────────────────────────

/**
 * Client class for communicating with the SharedWorker host.
 * Connects via a MessagePort and provides an async API matching
 * the agent interface (sendMessage, requestState, execShell).
 */
export class SharedWorkerClient {
  /** @type {MessagePort} */
  #port;

  /** @type {boolean} */
  #connected = false;

  /** @type {Map<string, Set<Function>>} */
  #listeners = new Map();

  /** @type {Function|null} Stream chunk callback */
  onStream = null;

  /** @type {Function|null} Error callback */
  onError = null;

  /** @type {number} Request ID counter for correlation */
  #reqId = 0;

  /** @type {Map<number, { resolve: Function, reject: Function }>} */
  #pending = new Map();

  /**
   * @param {MessagePort} port - The port from a SharedWorker
   */
  constructor(port) {
    this.#port = port;
    this.#connected = true;

    this.#port.onmessage = (event) => {
      this._handleIncoming(event.data);
    };

    if (typeof this.#port.start === 'function') {
      this.#port.start();
    }
  }

  /** Whether the client is connected. */
  get connected() {
    return this.#connected;
  }

  // ── Outbound messages ─────────────────────────────────────────

  /**
   * Send a user message to the agent via SharedWorker.
   * @param {string} text
   * @param {object} [opts] - Additional options
   */
  sendMessage(text, opts = {}) {
    if (!this.#connected) return;
    this.#port.postMessage({
      type: MSG_TYPES.USER_MESSAGE,
      payload: { text, ...opts },
      reqId: ++this.#reqId,
    });
  }

  /**
   * Request the current agent/host state.
   */
  requestState() {
    if (!this.#connected) return;
    this.#port.postMessage({
      type: MSG_TYPES.STATE,
      reqId: ++this.#reqId,
    });
  }

  /**
   * Request shell command execution.
   * @param {string} command
   * @param {object} [opts]
   */
  execShell(command, opts = {}) {
    if (!this.#connected) return;
    this.#port.postMessage({
      type: MSG_TYPES.SHELL_EXEC,
      payload: { command, ...opts },
      reqId: ++this.#reqId,
    });
  }

  /**
   * Send a raw message to the host.
   * @param {object} msg - { type: string, payload: object }
   */
  send(msg) {
    if (!this.#connected) return;
    this.#port.postMessage(msg);
  }

  // ── Promise-based request/response ────────────────────────────

  /**
   * Send a message and wait for a response.
   * @param {string} text
   * @param {object} [opts]
   * @param {number} [timeout=30000]
   * @returns {Promise<object>}
   */
  async sendAndWait(text, opts = {}, timeout = 30000) {
    if (!this.#connected) throw new Error('Not connected');
    const reqId = ++this.#reqId;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.#pending.delete(reqId);
        reject(new Error('Request timed out'));
      }, timeout);

      this.#pending.set(reqId, {
        resolve: (data) => { clearTimeout(timer); resolve(data); },
        reject: (err) => { clearTimeout(timer); reject(err); },
      });

      this.#port.postMessage({
        type: MSG_TYPES.USER_MESSAGE,
        payload: { text, ...opts },
        reqId,
      });
    });
  }

  // ── Event listeners ────────────────────────────────────────────

  /**
   * Register a listener for a specific message type.
   * @param {string} type - Message type from MSG_TYPES
   * @param {Function} handler - (payload) => void
   */
  on(type, handler) {
    if (!this.#listeners.has(type)) this.#listeners.set(type, new Set());
    this.#listeners.get(type).add(handler);
  }

  /**
   * Remove a listener for a specific message type.
   * @param {string} type
   * @param {Function} handler
   */
  off(type, handler) {
    const set = this.#listeners.get(type);
    if (set) set.delete(handler);
  }

  // ── Incoming message handling ──────────────────────────────────

  /**
   * Handle an incoming message from the host.
   * Routes to appropriate callbacks/listeners.
   * @param {object} msg - { type: string, payload: object, reqId?: number }
   */
  _handleIncoming(msg) {
    if (!msg || typeof msg.type !== 'string') return;

    // Handle stream chunks via dedicated callback
    if (msg.type === MSG_TYPES.STREAM_CHUNK && this.onStream) {
      this.onStream(msg.payload);
      return;
    }

    // Handle errors via dedicated callback
    if (msg.type === MSG_TYPES.ERROR && this.onError) {
      this.onError(msg.payload);
    }

    // Resolve pending promise if reqId matches
    if (msg.reqId && this.#pending.has(msg.reqId)) {
      const pending = this.#pending.get(msg.reqId);
      this.#pending.delete(msg.reqId);
      if (msg.type === MSG_TYPES.ERROR) {
        pending.reject(new Error(msg.payload?.error || 'Unknown error'));
      } else {
        pending.resolve(msg.payload);
      }
    }

    // Notify type-specific listeners
    const listeners = this.#listeners.get(msg.type);
    if (listeners) {
      for (const fn of listeners) {
        try { fn(msg.payload); } catch { /* listener error */ }
      }
    }
  }

  // ── Lifecycle ──────────────────────────────────────────────────

  /**
   * Disconnect from the SharedWorker.
   */
  disconnect() {
    this.#connected = false;
    try { this.#port.close(); } catch { /* ignore */ }
    // Reject all pending
    for (const [, pending] of this.#pending) {
      pending.reject(new Error('Disconnected'));
    }
    this.#pending.clear();
    this.#listeners.clear();
  }
}
