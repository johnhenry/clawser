// clawser-daemon.js — Daemon Mode (Background Execution + Multi-Tab + Checkpoint/Resume)
//
// DaemonState: lifecycle state machine
// CheckpointManager: serialize/restore agent state
// TabCoordinator: multi-tab message coordination via BroadcastChannel
// DaemonController: orchestrates lifecycle, checkpoint, coordination
// Agent tools: daemon_status, daemon_checkpoint, daemon_pause, daemon_resume

import { BrowserTool } from './clawser-tools.js';

// ── DaemonState ─────────────────────────────────────────────────

export const DaemonPhase = Object.freeze({
  STOPPED: 'stopped',
  STARTING: 'starting',
  RUNNING: 'running',
  CHECKPOINTING: 'checkpointing',
  PAUSED: 'paused',
  RECOVERING: 'recovering',
  ERROR: 'error',
});

const VALID_TRANSITIONS = {
  [DaemonPhase.STOPPED]:        [DaemonPhase.STARTING],
  [DaemonPhase.STARTING]:       [DaemonPhase.RUNNING, DaemonPhase.ERROR],
  [DaemonPhase.RUNNING]:        [DaemonPhase.CHECKPOINTING, DaemonPhase.PAUSED, DaemonPhase.STOPPED, DaemonPhase.ERROR],
  [DaemonPhase.CHECKPOINTING]:  [DaemonPhase.RUNNING, DaemonPhase.ERROR],
  [DaemonPhase.PAUSED]:         [DaemonPhase.RUNNING, DaemonPhase.STOPPED],
  [DaemonPhase.RECOVERING]:     [DaemonPhase.RUNNING, DaemonPhase.ERROR],
  [DaemonPhase.ERROR]:          [DaemonPhase.STARTING, DaemonPhase.STOPPED],
};

/**
 * Daemon lifecycle state machine.
 */
export class DaemonState {
  #phase = DaemonPhase.STOPPED;
  #history = [];
  #maxHistory = 1000;
  #onChange;

  /**
   * @param {object} [opts]
   * @param {Function} [opts.onChange] - (newPhase, oldPhase) callback
   */
  constructor(opts = {}) {
    this.#onChange = opts.onChange || null;
  }

  get phase() { return this.#phase; }

  get isRunning() {
    return this.#phase === DaemonPhase.RUNNING || this.#phase === DaemonPhase.CHECKPOINTING;
  }

  /**
   * Transition to a new phase.
   * @param {string} newPhase - DaemonPhase value
   * @returns {boolean} Whether the transition succeeded
   */
  transition(newPhase) {
    const allowed = VALID_TRANSITIONS[this.#phase] || [];
    if (!allowed.includes(newPhase)) return false;

    const oldPhase = this.#phase;
    this.#phase = newPhase;
    this.#history.push({ from: oldPhase, to: newPhase, timestamp: Date.now() });
    if (this.#history.length > this.#maxHistory) {
      this.#history = this.#history.slice(-this.#maxHistory);
    }

    if (this.#onChange) this.#onChange(newPhase, oldPhase);
    return true;
  }

  /** Get transition history. */
  get history() { return [...this.#history]; }

  /** Reset to stopped. */
  reset() {
    this.#phase = DaemonPhase.STOPPED;
    this.#history = [];
  }
}

// ── CheckpointManager ───────────────────────────────────────────

/**
 * Manages agent state checkpoints for persistence and recovery.
 */
export class CheckpointManager {
  /** @type {object[]} Checkpoint index */
  #index = [];

  /** @type {number} Maximum checkpoints to retain */
  #maxCheckpoints;

  /** @type {Function|null} Storage write function */
  #writeFn;

  /** @type {Function|null} Storage read function */
  #readFn;

  /**
   * @param {object} [opts]
   * @param {number} [opts.maxCheckpoints=10]
   * @param {Function} [opts.writeFn] - async (key, data) => void
   * @param {Function} [opts.readFn] - async (key) => data|null
   */
  constructor(opts = {}) {
    this.#maxCheckpoints = opts.maxCheckpoints ?? 10;
    this.#writeFn = opts.writeFn || null;
    this.#readFn = opts.readFn || null;
  }

  /**
   * Create a checkpoint from agent state.
   * @param {object} agentState - Serializable agent state
   * @param {string} [reason='manual'] - Why this checkpoint was created
   * @returns {Promise<object>} Checkpoint metadata
   */
  async createCheckpoint(agentState, reason = 'manual') {
    const id = `cp_${Date.now().toString(36)}_${crypto.randomUUID().slice(0, 4)}`;
    const meta = {
      id,
      timestamp: Date.now(),
      reason,
      size: JSON.stringify(agentState).length,
    };

    // Write checkpoint data
    if (this.#writeFn) {
      await this.#writeFn(`checkpoint_${id}`, agentState);
      await this.#writeFn('checkpoint_latest', agentState);
    }

    this.#index.push(meta);

    // Trim old checkpoints
    while (this.#index.length > this.#maxCheckpoints) {
      this.#index.shift();
    }

    // Persist index
    if (this.#writeFn) {
      await this.#writeFn('checkpoint_index', this.#index);
    }

    return meta;
  }

  /**
   * Restore the latest checkpoint.
   * @returns {Promise<{meta: object, state: object}|null>}
   */
  async restoreLatest() {
    if (!this.#readFn) return null;
    try {
      const state = await this.#readFn('checkpoint_latest');
      if (!state) return null;

      const meta = this.#index.length > 0
        ? this.#index[this.#index.length - 1]
        : { id: 'latest', timestamp: Date.now(), reason: 'restored' };

      return { meta, state };
    } catch {
      return null;
    }
  }

  /**
   * Restore a specific checkpoint by ID.
   * @param {string} id
   * @returns {Promise<{meta: object, state: object}|null>}
   */
  async restore(id) {
    if (!this.#readFn) return null;
    const meta = this.#index.find(m => m.id === id);
    if (!meta) return null;

    try {
      const state = await this.#readFn(`checkpoint_${id}`);
      if (!state) return null;
      return { meta, state };
    } catch {
      return null;
    }
  }

  /**
   * Load checkpoint index from storage.
   * @returns {Promise<void>}
   */
  async loadIndex() {
    if (!this.#readFn) return;
    try {
      const index = await this.#readFn('checkpoint_index');
      if (Array.isArray(index)) {
        this.#index = index;
      }
    } catch { /* ignore */ }
  }

  /** List checkpoint metadata. */
  get checkpoints() { return [...this.#index]; }

  /** Number of stored checkpoints. */
  get size() { return this.#index.length; }

  /**
   * Delete a specific checkpoint by ID.
   * @param {string} id
   * @returns {Promise<boolean>} true if found and deleted
   */
  async deleteCheckpoint(id) {
    const idx = this.#index.findIndex(m => m.id === id);
    if (idx === -1) return false;

    this.#index.splice(idx, 1);

    if (this.#writeFn) {
      try { await this.#writeFn(`checkpoint_${id}`, null); } catch { /* best-effort */ }
      await this.#writeFn('checkpoint_index', this.#index);
    }

    return true;
  }

  /**
   * Clear all checkpoint metadata and delete stored data via writeFn.
   * @returns {Promise<void>}
   */
  async clear() {
    if (this.#writeFn) {
      for (const meta of this.#index) {
        try { await this.#writeFn(`checkpoint_${meta.id}`, null); } catch { /* best-effort */ }
      }
      try { await this.#writeFn('checkpoint_latest', null); } catch { /* best-effort */ }
      try { await this.#writeFn('checkpoint_index', null); } catch { /* best-effort */ }
    }
    this.#index = [];
  }
}

// ── TabCoordinator ──────────────────────────────────────────────

/**
 * Coordinates multiple browser tabs using BroadcastChannel-like interface.
 */
export class TabCoordinator {
  #tabId;
  #tabs = new Map();
  #channel;
  #onMessage;
  #heartbeatInterval = null;
  #heartbeatMs;

  /**
   * @param {object} [opts]
   * @param {string} [opts.channelName='clawser-tabs']
   * @param {object} [opts.channel] - BroadcastChannel-like object (for testing)
   * @param {number} [opts.heartbeatMs=5000]
   * @param {Function} [opts.onMessage] - (msg) callback for non-system messages
   */
  constructor(opts = {}) {
    this.#tabId = `tab_${Date.now().toString(36)}_${crypto.randomUUID().slice(0, 4)}`;
    this.#heartbeatMs = opts.heartbeatMs ?? 5000;
    this.#onMessage = opts.onMessage || null;

    if (opts.channel) {
      this.#channel = opts.channel;
    } else if (typeof BroadcastChannel !== 'undefined') {
      this.#channel = new BroadcastChannel(opts.channelName || 'clawser-tabs');
    } else {
      // Fallback: no-op channel (single-tab mode)
      this.#channel = { postMessage: () => {}, close: () => {}, onmessage: null };
    }

    this.#channel.onmessage = (event) => this.#handleMessage(event.data || event);
  }

  get tabId() { return this.#tabId; }
  get tabCount() { return this.#tabs.size + 1; } // +1 for self

  /**
   * Start heartbeat broadcasting.
   */
  start() {
    this.#broadcast({ type: 'tab_join', tabId: this.#tabId });
    this.#heartbeatInterval = setInterval(() => {
      this.#broadcast({ type: 'tab_heartbeat', tabId: this.#tabId });
      this.#pruneStale();
    }, this.#heartbeatMs);
  }

  /**
   * Stop heartbeat and announce departure.
   */
  stop() {
    if (this.#heartbeatInterval) {
      clearInterval(this.#heartbeatInterval);
      this.#heartbeatInterval = null;
    }
    this.#broadcast({ type: 'tab_leave', tabId: this.#tabId });
    this.#channel.close();
    this.#tabs.clear();
  }

  /**
   * Broadcast a message to all tabs.
   * @param {object} msg
   */
  broadcast(msg) {
    this.#broadcast({ ...msg, fromTabId: this.#tabId });
  }

  /**
   * Get list of known active tabs.
   * @returns {Array<{tabId: string, lastSeen: number}>}
   */
  get activeTabs() {
    return [
      { tabId: this.#tabId, lastSeen: Date.now() },
      ...[...this.#tabs.entries()].map(([id, data]) => ({
        tabId: id,
        lastSeen: data.lastSeen,
      })),
    ];
  }

  /**
   * Check if this tab is the leader (first tab).
   * Determined by earliest join time.
   */
  get isLeader() {
    for (const data of this.#tabs.values()) {
      if (data.joinedAt < this.#joinedAt) return false;
    }
    return true;
  }

  #joinedAt = Date.now();

  #broadcast(data) {
    try {
      this.#channel.postMessage(data);
    } catch { /* channel closed */ }
  }

  #handleMessage(data) {
    if (!data || data.tabId === this.#tabId) return;

    switch (data.type) {
      case 'tab_join':
        this.#tabs.set(data.tabId, { lastSeen: Date.now(), joinedAt: Date.now() });
        // Respond so the new tab knows about us
        this.#broadcast({ type: 'tab_heartbeat', tabId: this.#tabId });
        break;
      case 'tab_heartbeat':
        if (this.#tabs.has(data.tabId)) {
          this.#tabs.get(data.tabId).lastSeen = Date.now();
        } else {
          this.#tabs.set(data.tabId, { lastSeen: Date.now(), joinedAt: Date.now() });
        }
        break;
      case 'tab_leave':
        this.#tabs.delete(data.tabId);
        break;
      default:
        if (this.#onMessage) this.#onMessage(data);
        break;
    }
  }

  #pruneStale() {
    const cutoff = Date.now() - (this.#heartbeatMs * 3);
    for (const [id, data] of this.#tabs) {
      if (data.lastSeen < cutoff) this.#tabs.delete(id);
    }
  }
}

// ── DaemonController ────────────────────────────────────────────

/**
 * Orchestrates daemon lifecycle, checkpoint management, and tab coordination.
 */
export class DaemonController {
  #state;
  #checkpoints;
  #coordinator;
  #autoCheckpointInterval = null;
  #autoCheckpointMs;
  #getStateFn;

  /**
   * @param {object} [opts]
   * @param {DaemonState} [opts.state]
   * @param {CheckpointManager} [opts.checkpoints]
   * @param {TabCoordinator} [opts.coordinator]
   * @param {number} [opts.autoCheckpointMs=60000] - Auto-checkpoint interval
   * @param {Function} [opts.getStateFn] - () => serializable state
   */
  constructor(opts = {}) {
    this.#state = opts.state || new DaemonState();
    this.#checkpoints = opts.checkpoints || new CheckpointManager();
    this.#coordinator = opts.coordinator || null;
    this.#autoCheckpointMs = opts.autoCheckpointMs ?? 60000;
    this.#getStateFn = opts.getStateFn || null;
  }

  /**
   * Start the daemon.
   * @returns {Promise<boolean>}
   */
  async start() {
    if (!this.#state.transition(DaemonPhase.STARTING)) return false;

    try {
      // Load checkpoint index
      await this.#checkpoints.loadIndex();

      // Start tab coordinator
      if (this.#coordinator) {
        this.#coordinator.start();
      }

      // Start auto-checkpoint timer
      if (this.#autoCheckpointMs > 0 && this.#getStateFn) {
        this.#autoCheckpointInterval = setInterval(async () => {
          await this.checkpoint('auto');
        }, this.#autoCheckpointMs);
      }

      this.#state.transition(DaemonPhase.RUNNING);
      return true;
    } catch {
      this.#state.transition(DaemonPhase.ERROR);
      return false;
    }
  }

  /**
   * Stop the daemon.
   * @returns {Promise<boolean>}
   */
  async stop() {
    if (this.#autoCheckpointInterval) {
      clearInterval(this.#autoCheckpointInterval);
      this.#autoCheckpointInterval = null;
    }

    // Final checkpoint before stopping
    if (this.#getStateFn) {
      await this.checkpoint('shutdown');
    }

    if (this.#coordinator) {
      this.#coordinator.stop();
    }

    if (!this.#state.transition(DaemonPhase.STOPPED)) {
      this.#state.reset?.(); // force reset if transition is invalid from current state
    }
    return true;
  }

  /**
   * Pause the daemon (keeps state but stops processing).
   * Stops the auto-checkpoint interval but preserves all state.
   * @returns {Promise<boolean>}
   */
  async pause() {
    if (!this.#state.transition(DaemonPhase.PAUSED)) return false;

    // Stop auto-checkpoint timer while paused
    if (this.#autoCheckpointInterval) {
      clearInterval(this.#autoCheckpointInterval);
      this.#autoCheckpointInterval = null;
    }

    return true;
  }

  /**
   * Resume from paused state.
   * Restarts the auto-checkpoint interval.
   * @returns {Promise<boolean>}
   */
  async resume() {
    if (!this.#state.transition(DaemonPhase.RUNNING)) return false;

    // Restart auto-checkpoint timer
    if (this.#autoCheckpointMs > 0 && this.#getStateFn && !this.#autoCheckpointInterval) {
      this.#autoCheckpointInterval = setInterval(async () => {
        await this.checkpoint('auto');
      }, this.#autoCheckpointMs);
    }

    return true;
  }

  /**
   * Create a checkpoint.
   * @param {string} [reason='manual']
   * @returns {Promise<object|null>}
   */
  async checkpoint(reason = 'manual') {
    if (!this.#getStateFn) return null;

    const wasRunning = this.#state.phase === DaemonPhase.RUNNING;
    if (wasRunning) this.#state.transition(DaemonPhase.CHECKPOINTING);

    try {
      const state = this.#getStateFn();
      const meta = await this.#checkpoints.createCheckpoint(state, reason);
      if (wasRunning) this.#state.transition(DaemonPhase.RUNNING);
      return meta;
    } catch {
      if (wasRunning) this.#state.transition(DaemonPhase.ERROR);
      return null;
    }
  }

  /**
   * Restore from the latest checkpoint.
   * @returns {Promise<object|null>} Restored state
   */
  async restore() {
    return this.#checkpoints.restoreLatest();
  }

  /** Daemon state. */
  get daemonState() { return this.#state; }

  /** Current phase. */
  get phase() { return this.#state.phase; }

  /** Whether running. */
  get isRunning() { return this.#state.isRunning; }

  /** Checkpoint manager. */
  get checkpointManager() { return this.#checkpoints; }

  /** Tab coordinator. */
  get tabCoordinator() { return this.#coordinator; }

  /**
   * Build system prompt section.
   * @returns {string}
   */
  buildPrompt() {
    const lines = [`Daemon: ${this.#state.phase}`];
    if (this.#coordinator) {
      lines.push(`Tabs: ${this.#coordinator.tabCount}`);
      lines.push(`Leader: ${this.#coordinator.isLeader}`);
    }
    lines.push(`Checkpoints: ${this.#checkpoints.size}`);
    return lines.join('\n');
  }
}

// ── Agent Tools ─────────────────────────────────────────────────

export class DaemonStatusTool extends BrowserTool {
  #controller;

  constructor(controller) {
    super();
    this.#controller = controller;
  }

  get name() { return 'daemon_status'; }
  get description() { return 'Show daemon mode status, tab coordination, and checkpoint info.'; }
  get parameters() { return { type: 'object', properties: {} }; }
  get permission() { return 'read'; }

  async execute() {
    return { success: true, output: this.#controller.buildPrompt() };
  }
}

export class DaemonCheckpointTool extends BrowserTool {
  #controller;

  constructor(controller) {
    super();
    this.#controller = controller;
  }

  get name() { return 'daemon_checkpoint'; }
  get description() { return 'Create a checkpoint of current agent state.'; }
  get parameters() {
    return {
      type: 'object',
      properties: {
        reason: { type: 'string', description: 'Reason for checkpoint' },
      },
    };
  }
  get permission() { return 'approve'; }

  async execute({ reason } = {}) {
    const meta = await this.#controller.checkpoint(reason || 'user_requested');
    if (!meta) {
      return { success: false, output: '', error: 'Failed to create checkpoint' };
    }
    return { success: true, output: `Checkpoint ${meta.id} created (${meta.size} bytes, reason: ${meta.reason})` };
  }
}

export class DaemonPauseTool extends BrowserTool {
  #controller;

  constructor(controller) {
    super();
    this.#controller = controller;
  }

  get name() { return 'daemon_pause'; }
  get description() { return 'Pause the daemon. Stops processing but preserves state.'; }
  get parameters() { return { type: 'object', properties: {} }; }
  get permission() { return 'approve'; }

  async execute() {
    const ok = await this.#controller.pause();
    if (ok) {
      return { success: true, output: 'Daemon paused.' };
    }
    return { success: false, output: '', error: `Cannot pause from current phase: ${this.#controller.phase}` };
  }
}

export class DaemonResumeTool extends BrowserTool {
  #controller;

  constructor(controller) {
    super();
    this.#controller = controller;
  }

  get name() { return 'daemon_resume'; }
  get description() { return 'Resume the daemon from paused state.'; }
  get parameters() { return { type: 'object', properties: {} }; }
  get permission() { return 'approve'; }

  async execute() {
    const ok = await this.#controller.resume();
    if (ok) {
      return { success: true, output: 'Daemon resumed.' };
    }
    return { success: false, output: '', error: `Cannot resume from current phase: ${this.#controller.phase}` };
  }
}

export class DaemonRestoreTool extends BrowserTool {
  #controller;

  constructor(controller) {
    super();
    this.#controller = controller;
  }

  get name() { return 'daemon_restore'; }
  get description() { return 'Restore agent state from the latest checkpoint.'; }
  get parameters() { return { type: 'object', properties: {} }; }
  get permission() { return 'approve'; }

  async execute() {
    const meta = await this.#controller.restore();
    if (!meta) {
      return { success: false, output: '', error: 'No checkpoint available to restore' };
    }
    return { success: true, output: `Restored from checkpoint ${meta.id} (reason: ${meta.reason})` };
  }
}

// ── Input Lock Manager ──────────────────────────────────────────

/**
 * Manages input arbitration locks for multi-tab coordination.
 * Uses navigator.locks when available, falls back to in-memory tracking.
 */
export class InputLockManager {
  #held = new Map(); // resource → { acquired: timestamp }

  /**
   * Try to acquire a lock on a resource.
   * @param {string} resource - Resource name to lock
   * @returns {Promise<{acquired: boolean}>}
   */
  async tryAcquire(resource) {
    if (typeof navigator !== 'undefined' && navigator.locks) {
      try {
        let acquired = false;
        await navigator.locks.request(resource, { ifAvailable: true }, (lock) => {
          acquired = lock !== null;
          if (acquired) {
            this.#held.set(resource, { acquired: Date.now() });
          }
        });
        return { acquired };
      } catch {
        // Fallback to in-memory
      }
    }
    // In-memory fallback
    if (this.#held.has(resource)) {
      return { acquired: false };
    }
    this.#held.set(resource, { acquired: Date.now() });
    return { acquired: true };
  }

  /**
   * Release a lock on a resource.
   * @param {string} resource
   */
  release(resource) {
    this.#held.delete(resource);
  }

  /**
   * Check if a resource is currently held.
   * @param {string} resource
   * @returns {boolean}
   */
  isHeld(resource) {
    return this.#held.has(resource);
  }

  /**
   * List all currently held lock names.
   * @returns {string[]}
   */
  heldLocks() {
    return [...this.#held.keys()];
  }
}

// ── Agent Busy Indicator ────────────────────────────────────────

/**
 * Broadcasts agent busy/idle state to other tabs via BroadcastChannel.
 */
export class AgentBusyIndicator {
  #busy = false;
  #reason = '';
  #since = 0;
  #channel;

  /**
   * @param {object} [opts]
   * @param {object} [opts.channel] - BroadcastChannel-like (for testing)
   * @param {string} [opts.channelName='clawser-agent-busy']
   */
  constructor(opts = {}) {
    if (opts.channel) {
      this.#channel = opts.channel;
    } else if (typeof BroadcastChannel !== 'undefined') {
      this.#channel = new BroadcastChannel(opts.channelName || 'clawser-agent-busy');
    } else {
      this.#channel = { postMessage: () => {}, close: () => {} };
    }
  }

  /** @returns {boolean} */
  get isBusy() { return this.#busy; }

  /** @returns {string} */
  get reason() { return this.#reason; }

  /**
   * Set busy state and broadcast to other tabs.
   * @param {boolean} busy
   * @param {string} [reason]
   */
  setBusy(busy, reason = '') {
    this.#busy = busy;
    this.#reason = busy ? reason : '';
    this.#since = busy ? Date.now() : 0;
    this.#channel.postMessage({
      type: 'agent_busy',
      busy: this.#busy,
      reason: this.#reason,
      since: this.#since,
    });
  }

  /**
   * Get current status.
   * @returns {{ busy: boolean, reason: string, since: number }}
   */
  status() {
    return {
      busy: this.#busy,
      reason: this.#reason,
      since: this.#since,
    };
  }

  /** Clean up channel. */
  close() {
    this.#channel.close();
  }
}

// ── WorkerProtocol ──────────────────────────────────────────────

/**
 * Message protocol for Tab↔SharedWorker communication.
 * Defines message types, encoding, decoding, and validation.
 */

const VALID_MESSAGE_TYPES = new Set([
  'user_message',
  'stream_chunk',
  'state',
  'shell_exec',
  'tool_invoke',
  'tool_result',
  'error',
  'heartbeat',
]);

export class WorkerProtocol {
  /**
   * Encode a message for transport.
   * @param {string} type - Message type
   * @param {object} payload - Message payload
   * @returns {{ type: string, payload: object, id: string, timestamp: number }}
   */
  static encode(type, payload) {
    return {
      type,
      payload: payload || {},
      id: crypto.randomUUID(),
      timestamp: Date.now(),
    };
  }

  /**
   * Decode a transport message.
   * @param {object} msg - Raw message
   * @returns {{ type: string, payload: object, id: string, timestamp: number }}
   */
  static decode(msg) {
    return {
      type: msg.type,
      payload: msg.payload || {},
      id: msg.id,
      timestamp: msg.timestamp,
    };
  }

  /**
   * Validate a message structure.
   * @param {*} msg - Message to validate
   * @returns {boolean}
   */
  static isValid(msg) {
    if (!msg || typeof msg !== 'object') return false;
    if (!VALID_MESSAGE_TYPES.has(msg.type)) return false;
    return true;
  }
}

// ── CrossTabToolBridge ──────────────────────────────────────────

/**
 * Enables tools to be invoked across browser tabs via BroadcastChannel.
 */
export class CrossTabToolBridge {
  #tools = new Map();
  #channel;

  /**
   * @param {object} [opts]
   * @param {object} [opts.channel] - BroadcastChannel-like (for testing)
   * @param {string} [opts.channelName='clawser-cross-tab-tools']
   */
  constructor(opts = {}) {
    if (opts.channel) {
      this.#channel = opts.channel;
    } else if (typeof BroadcastChannel !== 'undefined') {
      this.#channel = new BroadcastChannel(opts.channelName || 'clawser-cross-tab-tools');
    } else {
      this.#channel = { postMessage: () => {}, close: () => {} };
    }
  }

  /**
   * Register a tool for cross-tab access.
   * @param {string} name - Tool name
   * @param {Function} executeFn - async (args) => ToolResult
   */
  registerTool(name, executeFn) {
    this.#tools.set(name, executeFn);
  }

  /**
   * Unregister a tool.
   * @param {string} name
   */
  unregisterTool(name) {
    this.#tools.delete(name);
  }

  /**
   * List registered tool names.
   * @returns {string[]}
   */
  listTools() {
    return [...this.#tools.keys()];
  }

  /**
   * Invoke a registered tool locally.
   * @param {string} name - Tool name
   * @param {object} args - Tool arguments
   * @returns {Promise<{ success: boolean, output: string, error?: string }>}
   */
  async invoke(name, args) {
    const fn = this.#tools.get(name);
    if (!fn) {
      return { success: false, output: '', error: `Tool "${name}" not found` };
    }
    try {
      return await fn(args);
    } catch (e) {
      return { success: false, output: '', error: e.message };
    }
  }

  /** Clean up channel. */
  close() {
    this.#channel.close();
  }
}

// ── HeadlessRunner ──────────────────────────────────────────────

/**
 * Runs the agent in headless mode (Service Worker / background context).
 * Manages checkpoint load → execute pending jobs → checkpoint save lifecycle.
 */
export class HeadlessRunner {
  #readFn;
  #writeFn;
  #executeFn;

  /**
   * @param {object} opts
   * @param {Function} opts.readFn - async (key) => data|null
   * @param {Function} [opts.writeFn] - async (key, data) => void
   * @param {Function} [opts.executeFn] - async (job) => { success: boolean }
   */
  constructor(opts = {}) {
    this.#readFn = opts.readFn || (async () => null);
    this.#writeFn = opts.writeFn || (async () => {});
    this.#executeFn = opts.executeFn || (async () => ({ success: true }));
  }

  /**
   * Load the latest checkpoint.
   * @returns {Promise<object|null>}
   */
  async loadCheckpoint() {
    try {
      return await this.#readFn('checkpoint_latest');
    } catch {
      return null;
    }
  }

  /**
   * Run from the latest checkpoint: load state, process pending jobs, save.
   * @returns {Promise<{ executed: number, results: Array }|null>}
   */
  async runFromCheckpoint() {
    const state = await this.loadCheckpoint();
    if (!state) return null;

    const jobs = state.pendingJobs || [];
    const results = [];

    for (const job of jobs) {
      const result = await this.#executeFn(job);
      results.push({ jobId: job.id, ...result });
    }

    // Save updated checkpoint (clear pending jobs)
    const updatedState = { ...state, pendingJobs: [], lastRun: Date.now() };
    await this.#writeFn('checkpoint_latest', updatedState);

    return { executed: results.length, results };
  }
}

// ── AwaySummaryBuilder ──────────────────────────────────────────

/**
 * Builds a "While you were away" summary from activity events.
 */
export class AwaySummaryBuilder {
  #events = [];

  /**
   * Add an activity event.
   * @param {{ type: string, timestamp: number, [key: string]: any }} event
   */
  addEvent(event) {
    this.#events.push({ ...event });
  }

  get eventCount() { return this.#events.length; }

  /**
   * Build a summary of activity.
   * @param {object} [opts]
   * @param {number} [opts.since] - Only include events after this timestamp
   * @returns {{ events: Array, text: string }}
   */
  build(opts = {}) {
    let events = [...this.#events];
    if (opts.since) {
      events = events.filter(e => e.timestamp >= opts.since);
    }

    if (events.length === 0) {
      return { events: [], text: 'No activity while you were away.' };
    }

    const lines = [];
    const byType = {};
    for (const e of events) {
      byType[e.type] = (byType[e.type] || 0) + 1;
    }

    for (const [type, count] of Object.entries(byType)) {
      lines.push(`- ${type}: ${count} event${count > 1 ? 's' : ''}`);
    }

    const text = `While you were away (${events.length} events):\n${lines.join('\n')}`;
    return { events, text };
  }

  /** Clear all events. */
  clear() {
    this.#events = [];
  }
}

// ── NotificationCenter ──────────────────────────────────────────

/**
 * In-app notification center with unread tracking.
 */
export class NotificationCenter {
  #notifications = [];
  #nextId = 1;

  /**
   * Add a notification.
   * @param {{ type: string, title: string, message: string }} opts
   * @returns {number} Notification ID
   */
  add(opts) {
    const id = this.#nextId++;
    this.#notifications.push({
      id,
      type: opts.type || 'info',
      title: opts.title,
      message: opts.message,
      read: false,
      timestamp: Date.now(),
    });
    return id;
  }

  /**
   * Mark a notification as read.
   * @param {number} id
   */
  markRead(id) {
    const n = this.#notifications.find(n => n.id === id);
    if (n) n.read = true;
  }

  /** Mark all notifications as read. */
  markAllRead() {
    for (const n of this.#notifications) n.read = true;
  }

  /**
   * List notifications (newest first).
   * @param {object} [opts]
   * @param {number} [opts.limit=50]
   * @returns {Array}
   */
  list(opts = {}) {
    const limit = opts.limit || 50;
    return [...this.#notifications].reverse().slice(0, limit);
  }

  get count() { return this.#notifications.length; }
  get unreadCount() { return this.#notifications.filter(n => !n.read).length; }

  /**
   * Get a notification by ID.
   * @param {number} id
   * @returns {object|null}
   */
  get(id) {
    return this.#notifications.find(n => n.id === id) || null;
  }

  /** Remove a notification by ID. */
  remove(id) {
    const idx = this.#notifications.findIndex(n => n.id === id);
    if (idx !== -1) this.#notifications.splice(idx, 1);
  }

  /** Clear all notifications. */
  clear() {
    this.#notifications = [];
    this.#nextId = 1;
  }
}

// ── NativeMessageCodec ──────────────────────────────────────────

/**
 * Chrome Native Messaging protocol codec.
 * Messages are JSON with a 4-byte little-endian length prefix.
 */
export class NativeMessageCodec {
  /**
   * Encode a message with a 4-byte LE length prefix.
   * @param {object} msg - JSON-serializable message
   * @returns {Uint8Array}
   */
  static encode(msg) {
    const json = JSON.stringify(msg);
    const encoder = new TextEncoder();
    const body = encoder.encode(json);
    const result = new Uint8Array(4 + body.length);
    // Write length as 4-byte little-endian
    result[0] = body.length & 0xff;
    result[1] = (body.length >> 8) & 0xff;
    result[2] = (body.length >> 16) & 0xff;
    result[3] = (body.length >> 24) & 0xff;
    result.set(body, 4);
    return result;
  }

  /**
   * Decode a length-prefixed message.
   * @param {Uint8Array} data
   * @returns {object}
   */
  static decode(data) {
    if (!data || data.length < 4) throw new Error('Invalid native message: too short');
    const length = data[0] | (data[1] << 8) | (data[2] << 16) | (data[3] << 24);
    if (data.length < 4 + length) throw new Error('Invalid native message: truncated');
    const decoder = new TextDecoder();
    const json = decoder.decode(data.slice(4, 4 + length));
    return JSON.parse(json);
  }
}
