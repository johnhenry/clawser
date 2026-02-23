// clawser-undo.js — Undo/Redo System
//
// TurnCheckpoint: snapshot of state at turn boundary
// UndoManager: checkpoint stack with multi-layer undo
// Agent tools: undo, undo_status

import { BrowserTool } from './clawser-tools.js';

// ── TurnCheckpoint ──────────────────────────────────────────────

let turnCounter = 0;

/**
 * Reset turn counter (for testing).
 */
export function resetTurnCounter() {
  turnCounter = 0;
}

/**
 * Create a turn checkpoint.
 * @param {object} [opts]
 * @returns {object}
 */
export function createCheckpoint(opts = {}) {
  return {
    turnId: opts.turnId || `turn_${++turnCounter}`,
    timestamp: opts.timestamp || Date.now(),
    snapshot: {
      historyLength: opts.historyLength || 0,
      memoryOps: [],
      fileOps: [],
      goalOps: [],
      ...(opts.snapshot || {}),
    },
  };
}

// ── UndoManager ─────────────────────────────────────────────────

/**
 * Manages turn-based undo with multi-layer state reversal.
 */
export class UndoManager {
  /** @type {object[]} Stack of TurnCheckpoints */
  #checkpoints = [];

  /** @type {number} Maximum retained checkpoints */
  #maxHistory;

  /** @type {object|null} Current (in-progress) checkpoint */
  #current = null;

  /** @type {object} Undo handlers for each layer */
  #handlers;

  /**
   * @param {object} [opts]
   * @param {number} [opts.maxHistory=20]
   * @param {object} [opts.handlers] - { revertHistory, revertMemory, revertFile, revertGoal }
   */
  constructor(opts = {}) {
    this.#maxHistory = opts.maxHistory ?? 20;
    this.#handlers = opts.handlers || {};
  }

  /**
   * Begin a new turn checkpoint. Call at the START of each turn.
   * @param {object} [opts]
   * @param {number} [opts.historyLength] - Current history array length
   * @returns {object} The checkpoint
   */
  beginTurn(opts = {}) {
    const checkpoint = createCheckpoint({
      historyLength: opts.historyLength || 0,
    });

    this.#checkpoints.push(checkpoint);
    this.#current = checkpoint;

    // Trim to maxHistory
    while (this.#checkpoints.length > this.#maxHistory) {
      this.#checkpoints.shift();
    }

    return checkpoint;
  }

  /**
   * Record a memory operation in the current turn.
   * @param {object} op - { type: 'store'|'forget', id, key?, content?, category? }
   */
  recordMemoryOp(op) {
    if (this.#current) {
      this.#current.snapshot.memoryOps.push({ ...op, timestamp: Date.now() });
    }
  }

  /**
   * Record a file operation in the current turn.
   * @param {object} op - { type: 'write'|'delete', path, previousContent? }
   */
  recordFileOp(op) {
    if (this.#current) {
      this.#current.snapshot.fileOps.push({ ...op, timestamp: Date.now() });
    }
  }

  /**
   * Record a goal operation in the current turn.
   * @param {object} op - { type: 'status_change'|'sub_goal_added'|'goal_added', ... }
   */
  recordGoalOp(op) {
    if (this.#current) {
      this.#current.snapshot.goalOps.push({ ...op, timestamp: Date.now() });
    }
  }

  /**
   * Undo the last N turns.
   * @param {number} [turns=1]
   * @returns {Promise<Array<{turnId: string, reverted: boolean, details: object}>>}
   */
  async undo(turns = 1) {
    const results = [];

    for (let i = 0; i < turns; i++) {
      const cp = this.#checkpoints.pop();
      if (!cp) break;

      const details = {
        messagesRemoved: 0,
        memoryOpsReverted: 0,
        fileOpsReverted: 0,
        goalOpsReverted: 0,
      };

      // 1. Revert conversation history
      if (this.#handlers.revertHistory) {
        try {
          details.messagesRemoved = await this.#handlers.revertHistory(cp.snapshot.historyLength);
        } catch { /* ignore */ }
      }

      // 2. Revert memory operations (reverse order)
      const memOps = [...cp.snapshot.memoryOps].reverse();
      for (const op of memOps) {
        if (this.#handlers.revertMemory) {
          try {
            await this.#handlers.revertMemory(op);
            details.memoryOpsReverted++;
          } catch { /* ignore */ }
        }
      }

      // 3. Revert file operations (reverse order)
      const fileOps = [...cp.snapshot.fileOps].reverse();
      for (const op of fileOps) {
        if (this.#handlers.revertFile) {
          try {
            await this.#handlers.revertFile(op);
            details.fileOpsReverted++;
          } catch { /* ignore */ }
        }
      }

      // 4. Revert goal operations (reverse order)
      const goalOps = [...cp.snapshot.goalOps].reverse();
      for (const op of goalOps) {
        if (this.#handlers.revertGoal) {
          try {
            await this.#handlers.revertGoal(op);
            details.goalOpsReverted++;
          } catch { /* ignore */ }
        }
      }

      // Update current checkpoint
      this.#current = this.#checkpoints.length > 0
        ? this.#checkpoints[this.#checkpoints.length - 1]
        : null;

      results.push({ turnId: cp.turnId, reverted: true, details });
    }

    return results;
  }

  /** Whether undo is possible. */
  get canUndo() { return this.#checkpoints.length > 0; }

  /** Number of undoable turns. */
  get undoDepth() { return this.#checkpoints.length; }

  /** Current in-progress checkpoint (or null). */
  get currentCheckpoint() { return this.#current; }

  /** Get checkpoint stack (copies). */
  get checkpoints() {
    return this.#checkpoints.map(cp => ({
      turnId: cp.turnId,
      timestamp: cp.timestamp,
      memoryOps: cp.snapshot.memoryOps.length,
      fileOps: cp.snapshot.fileOps.length,
      goalOps: cp.snapshot.goalOps.length,
    }));
  }

  /** Clear all checkpoints. */
  clear() {
    this.#checkpoints = [];
    this.#current = null;
  }

  /** Maximum history depth. */
  get maxHistory() { return this.#maxHistory; }

  /**
   * Set maximum history depth.
   * @param {number} n
   */
  set maxHistory(n) {
    this.#maxHistory = n;
    while (this.#checkpoints.length > n) {
      this.#checkpoints.shift();
    }
  }

  /**
   * Build a human-readable summary of what undo would revert.
   * @param {number} [turns=1]
   * @returns {string}
   */
  previewUndo(turns = 1) {
    const count = Math.min(turns, this.#checkpoints.length);
    if (count === 0) return 'Nothing to undo.';

    const parts = [];
    for (let i = 0; i < count; i++) {
      const cp = this.#checkpoints[this.#checkpoints.length - 1 - i];
      const ops = [];
      if (cp.snapshot.memoryOps.length > 0) ops.push(`${cp.snapshot.memoryOps.length} memory op(s)`);
      if (cp.snapshot.fileOps.length > 0) ops.push(`${cp.snapshot.fileOps.length} file op(s)`);
      if (cp.snapshot.goalOps.length > 0) ops.push(`${cp.snapshot.goalOps.length} goal op(s)`);
      parts.push(`${cp.turnId}: ${ops.length > 0 ? ops.join(', ') : 'conversation only'}`);
    }

    return `Will revert ${count} turn(s):\n${parts.join('\n')}`;
  }
}

// ── Agent Tools ─────────────────────────────────────────────────

export class UndoTool extends BrowserTool {
  #manager;

  constructor(manager) {
    super();
    this.#manager = manager;
  }

  get name() { return 'undo'; }
  get description() { return 'Undo the last N turns, reverting conversation, files, memory, and goals.'; }
  get parameters() {
    return {
      type: 'object',
      properties: {
        turns: { type: 'number', description: 'Number of turns to undo (default 1)' },
      },
    };
  }
  get permission() { return 'approve'; }

  async execute({ turns } = {}) {
    const n = turns || 1;
    if (!this.#manager.canUndo) {
      return { success: false, output: '', error: 'Nothing to undo.' };
    }

    const results = await this.#manager.undo(n);
    if (results.length === 0) {
      return { success: false, output: '', error: 'Nothing to undo.' };
    }

    const lines = results.map(r => {
      const d = r.details;
      const parts = [];
      if (d.messagesRemoved > 0) parts.push(`${d.messagesRemoved} messages`);
      if (d.memoryOpsReverted > 0) parts.push(`${d.memoryOpsReverted} memory ops`);
      if (d.fileOpsReverted > 0) parts.push(`${d.fileOpsReverted} file ops`);
      if (d.goalOpsReverted > 0) parts.push(`${d.goalOpsReverted} goal ops`);
      return `Reverted ${r.turnId}${parts.length > 0 ? ': ' + parts.join(', ') : ''}`;
    });

    return { success: true, output: lines.join('\n') };
  }
}

export class UndoStatusTool extends BrowserTool {
  #manager;

  constructor(manager) {
    super();
    this.#manager = manager;
  }

  get name() { return 'undo_status'; }
  get description() { return 'Show undo history and preview what would be reverted.'; }
  get parameters() {
    return {
      type: 'object',
      properties: {
        preview_turns: { type: 'number', description: 'Preview this many turns (default 1)' },
      },
    };
  }
  get permission() { return 'read'; }

  async execute({ preview_turns } = {}) {
    const depth = this.#manager.undoDepth;
    const lines = [
      `Undo depth: ${depth} turn(s)`,
      `Can undo: ${this.#manager.canUndo}`,
      '',
    ];

    if (depth > 0) {
      lines.push(this.#manager.previewUndo(preview_turns || 1));

      lines.push('', 'Checkpoint history:');
      for (const cp of this.#manager.checkpoints) {
        const ops = cp.memoryOps + cp.fileOps + cp.goalOps;
        lines.push(`  ${cp.turnId} (${ops} ops)`);
      }
    }

    return { success: true, output: lines.join('\n') };
  }
}
