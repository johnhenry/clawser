// clawser-daemon.js — Daemon Mode (Background Execution + Multi-Tab + Checkpoint/Resume)
//
// DaemonState: lifecycle state machine
// CheckpointManager: serialize/restore agent state
// TabCoordinator: multi-tab message coordination via BroadcastChannel
// DaemonController: orchestrates lifecycle, checkpoint, coordination
// Agent tools: daemon_status, daemon_checkpoint

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
    const id = `cp_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
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

  /** Clear all checkpoint metadata (does not delete stored data). */
  clear() { this.#index = []; }
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
    this.#tabId = `tab_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
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

    this.#state.transition(DaemonPhase.STOPPED);
    return true;
  }

  /**
   * Pause the daemon (keeps state but stops processing).
   * @returns {boolean}
   */
  pause() {
    return this.#state.transition(DaemonPhase.PAUSED);
  }

  /**
   * Resume from paused state.
   * @returns {boolean}
   */
  resume() {
    return this.#state.transition(DaemonPhase.RUNNING);
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
