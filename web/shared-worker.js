// shared-worker.js — SharedWorker host for Clawser
//
// Hosts a single ClawserAgent instance (conceptually) and routes messages
// between multiple browser tabs/ports. Each connected tab gets a MessagePort.
//
// Message types:
//   user_message  — Tab sends a user message to the agent
//   stream_chunk  — Host streams response chunks back to requesting tab
//   state         — Tab requests or host broadcasts agent state
//   shell_exec    — Tab requests shell command execution
//   response      — Host sends complete response to requesting tab
//   error         — Host sends error to requesting tab

// ── Message Types ───────────────────────────────────────────────

export const MSG_TYPES = Object.freeze({
  USER_MESSAGE: 'user_message',
  STREAM_CHUNK: 'stream_chunk',
  STATE:        'state',
  SHELL_EXEC:   'shell_exec',
  RESPONSE:     'response',
  ERROR:        'error',
});

// ── Port ID Generator ───────────────────────────────────────────

let _portIdCounter = 0;

function nextPortId() {
  return `port_${++_portIdCounter}`;
}

// ── SharedWorkerHost ────────────────────────────────────────────

/**
 * Manages multiple connected ports (tabs) and routes messages.
 * In a real SharedWorker context, `self.onconnect` creates ports.
 * This class is also usable outside a SharedWorker for testing.
 */
export class SharedWorkerHost {
  /** @type {Map<MessagePort, { id: string, connectedAt: number }>} */
  #ports = new Map();

  /** @type {number} Timestamp when host was created */
  #startTime = Date.now();

  /** @type {Function|null} Message handler */
  onMessage = null;

  /** @type {boolean} Whether the host is processing a request */
  #busy = false;

  /** @type {Array<{ port: MessagePort, msg: object }>} Queued messages when busy */
  #queue = [];

  // ── Port management ─────────────────────────────────────────

  /**
   * Register a new port (tab connection).
   * @param {MessagePort} port
   */
  addPort(port) {
    const id = nextPortId();
    this.#ports.set(port, { id, connectedAt: Date.now() });

    port.onmessage = (event) => {
      this._handleMessage(port, event.data);
    };

    port.start();
  }

  /**
   * Unregister a port.
   * @param {MessagePort} port
   */
  removePort(port) {
    this.#ports.delete(port);
  }

  /** Number of connected ports. */
  get portCount() {
    return this.#ports.size;
  }

  // ── Message routing ─────────────────────────────────────────

  /**
   * Handle an incoming message from a port.
   * @param {MessagePort} port
   * @param {object} msg - { type: string, payload: object }
   */
  _handleMessage(port, msg) {
    if (!msg || typeof msg.type !== 'string') return;

    // Delegate to external handler if set
    if (this.onMessage) {
      this.onMessage(port, msg);
      return;
    }

    // Default routing
    switch (msg.type) {
      case MSG_TYPES.USER_MESSAGE:
        this.#handleUserMessage(port, msg);
        break;
      case MSG_TYPES.STATE:
        this.sendTo(port, { type: MSG_TYPES.STATE, payload: this.getState() });
        break;
      case MSG_TYPES.SHELL_EXEC:
        this.#handleShellExec(port, msg);
        break;
      default:
        this.sendTo(port, {
          type: MSG_TYPES.ERROR,
          payload: { error: `Unknown message type: ${msg.type}` },
        });
    }
  }

  /**
   * Send a message to a specific port.
   * @param {MessagePort} port
   * @param {object} msg
   */
  sendTo(port, msg) {
    try {
      port.postMessage(msg);
    } catch {
      // Port may have been closed
      this.removePort(port);
    }
  }

  /**
   * Broadcast a message to all connected ports.
   * @param {object} msg
   * @param {MessagePort} [exclude] - Optional port to exclude from broadcast
   */
  broadcast(msg, exclude = null) {
    for (const [port] of this.#ports) {
      if (port === exclude) continue;
      this.sendTo(port, msg);
    }
  }

  // ── State ────────────────────────────────────────────────────

  /**
   * Get current host state snapshot.
   * @returns {{ portCount: number, uptime: number, portIds: string[], busy: boolean }}
   */
  getState() {
    return {
      portCount: this.#ports.size,
      uptime: Date.now() - this.#startTime,
      portIds: [...this.#ports.values()].map(p => p.id),
      busy: this.#busy,
    };
  }

  // ── Cleanup ──────────────────────────────────────────────────

  /**
   * Close all ports and clean up.
   */
  destroy() {
    for (const [port] of this.#ports) {
      try { port.close(); } catch { /* ignore */ }
    }
    this.#ports.clear();
    this.#queue = [];
  }

  // ── Internal message handlers ────────────────────────────────

  async #handleUserMessage(port, msg) {
    if (this.#busy) {
      this.#queue.push({ port, msg });
      this.sendTo(port, {
        type: MSG_TYPES.STATE,
        payload: { queued: true, position: this.#queue.length },
      });
      return;
    }

    this.#busy = true;
    try {
      // In production, this would call the agent
      // For now, echo back as a response
      this.sendTo(port, {
        type: MSG_TYPES.RESPONSE,
        payload: { text: msg.payload?.text || '', source: 'agent' },
      });
    } catch (e) {
      this.sendTo(port, {
        type: MSG_TYPES.ERROR,
        payload: { error: e.message },
      });
    } finally {
      this.#busy = false;
      this.#processQueue();
    }
  }

  async #handleShellExec(port, msg) {
    try {
      // In production, this would execute via the shell
      this.sendTo(port, {
        type: MSG_TYPES.RESPONSE,
        payload: {
          command: msg.payload?.command || '',
          output: '',
          exitCode: 0,
        },
      });
    } catch (e) {
      this.sendTo(port, {
        type: MSG_TYPES.ERROR,
        payload: { error: e.message },
      });
    }
  }

  #processQueue() {
    if (this.#queue.length === 0) return;
    const next = this.#queue.shift();
    queueMicrotask(() => this._handleMessage(next.port, next.msg));
  }
}

// ── SharedWorker bootstrap ──────────────────────────────────────
// When loaded as a SharedWorker, self.onconnect is available.

if (typeof self !== 'undefined' && typeof self.onconnect !== 'undefined') {
  const host = new SharedWorkerHost();

  self.onconnect = (event) => {
    const port = event.ports[0];
    host.addPort(port);

    // Notify all tabs of new connection
    host.broadcast(
      { type: MSG_TYPES.STATE, payload: host.getState() },
      port,
    );
  };
}
