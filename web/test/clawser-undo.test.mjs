// Run with: node --import ./web/test/_setup-globals.mjs --test web/test/clawser-undo.test.mjs
import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

// Stub BrowserTool before import
globalThis.BrowserTool = class { constructor() {} };

import {
  createCheckpoint,
  resetTurnCounter,
  UndoManager,
} from '../clawser-undo.js';

// ── createCheckpoint ────────────────────────────────────────────

describe('createCheckpoint', () => {
  beforeEach(() => {
    resetTurnCounter();
  });

  it('returns object with turnId and timestamp', () => {
    const cp = createCheckpoint();
    assert.ok(cp.turnId.startsWith('turn_'));
    assert.equal(typeof cp.timestamp, 'number');
  });

  it('auto-increments turnId', () => {
    const cp1 = createCheckpoint();
    const cp2 = createCheckpoint();
    assert.notEqual(cp1.turnId, cp2.turnId);
  });

  it('accepts custom turnId and timestamp', () => {
    const cp = createCheckpoint({ turnId: 'custom_1', timestamp: 42 });
    assert.equal(cp.turnId, 'custom_1');
    assert.equal(cp.timestamp, 42);
  });

  it('snapshot has empty ops arrays', () => {
    const cp = createCheckpoint();
    assert.deepEqual(cp.snapshot.memoryOps, []);
    assert.deepEqual(cp.snapshot.fileOps, []);
    assert.deepEqual(cp.snapshot.goalOps, []);
  });
});

// ── resetTurnCounter ────────────────────────────────────────────

describe('resetTurnCounter', () => {
  it('resets to 0 so next checkpoint is turn_1', () => {
    createCheckpoint(); // turn_N
    resetTurnCounter();
    const cp = createCheckpoint();
    assert.equal(cp.turnId, 'turn_1');
  });
});

// ── UndoManager ─────────────────────────────────────────────────

describe('UndoManager', () => {
  let mgr;

  beforeEach(() => {
    resetTurnCounter();
    mgr = new UndoManager();
  });

  it('starts with canUndo=false, canRedo=false', () => {
    assert.equal(mgr.canUndo, false);
    assert.equal(mgr.canRedo, false);
  });

  it('undoDepth and redoDepth start at 0', () => {
    assert.equal(mgr.undoDepth, 0);
    assert.equal(mgr.redoDepth, 0);
  });

  it('beginTurn creates a checkpoint', () => {
    const cp = mgr.beginTurn({ historyLength: 5 });
    assert.ok(cp.turnId);
    assert.equal(mgr.canUndo, true);
    assert.equal(mgr.undoDepth, 1);
  });

  it('beginTurn clears redo stack', () => {
    mgr.beginTurn();
    mgr.undo();
    assert.equal(mgr.canRedo, true);
    mgr.beginTurn();
    assert.equal(mgr.canRedo, false);
  });

  it('recordMemoryOp appends to current checkpoint', () => {
    mgr.beginTurn();
    mgr.recordMemoryOp({ action: 'store', key: 'x' });
    const cps = mgr.checkpoints;
    assert.equal(cps[0].memoryOps, 1);
  });

  it('recordFileOp appends to current checkpoint', () => {
    mgr.beginTurn();
    mgr.recordFileOp({ action: 'write', path: '/test.txt' });
    const cps = mgr.checkpoints;
    assert.equal(cps[0].fileOps, 1);
  });

  it('recordGoalOp appends to current checkpoint', () => {
    mgr.beginTurn();
    mgr.recordGoalOp({ action: 'add', goalId: 'g1' });
    const cps = mgr.checkpoints;
    assert.equal(cps[0].goalOps, 1);
  });

  it('recordOps are no-ops when no current checkpoint', () => {
    // Should not throw
    mgr.recordMemoryOp({ action: 'store' });
    mgr.recordFileOp({ action: 'write' });
    mgr.recordGoalOp({ action: 'add' });
  });

  it('undo invokes revert handlers', async () => {
    const reverted = [];
    const mgr2 = new UndoManager({
      handlers: {
        revertHistory: async (len) => { reverted.push('history'); return 2; },
        revertMemory: async (op) => { reverted.push('memory'); },
      },
    });
    mgr2.beginTurn({ historyLength: 3 });
    mgr2.recordMemoryOp({ action: 'store', key: 'k' });
    const results = await mgr2.undo();
    assert.equal(results.length, 1);
    assert.equal(results[0].reverted, true);
    assert.ok(reverted.includes('history'));
    assert.ok(reverted.includes('memory'));
  });

  it('undo moves checkpoint to redo stack', async () => {
    mgr.beginTurn();
    assert.equal(mgr.undoDepth, 1);
    assert.equal(mgr.redoDepth, 0);
    await mgr.undo();
    assert.equal(mgr.undoDepth, 0);
    assert.equal(mgr.redoDepth, 1);
  });

  it('redo moves checkpoint back', async () => {
    mgr.beginTurn();
    await mgr.undo();
    const results = await mgr.redo();
    assert.equal(results.length, 1);
    assert.equal(mgr.undoDepth, 1);
    assert.equal(mgr.redoDepth, 0);
  });

  it('clear empties all stacks', async () => {
    mgr.beginTurn();
    mgr.beginTurn();
    await mgr.undo();
    mgr.clear();
    assert.equal(mgr.undoDepth, 0);
    assert.equal(mgr.redoDepth, 0);
    assert.equal(mgr.canUndo, false);
    assert.equal(mgr.canRedo, false);
  });

  it('maxHistory getter/setter truncates old entries', () => {
    for (let i = 0; i < 10; i++) mgr.beginTurn();
    assert.equal(mgr.undoDepth, 10);
    mgr.maxHistory = 5;
    assert.equal(mgr.undoDepth, 5);
    assert.equal(mgr.maxHistory, 5);
  });

  it('beginTurn trims to maxHistory', () => {
    const small = new UndoManager({ maxHistory: 3 });
    for (let i = 0; i < 5; i++) small.beginTurn();
    assert.equal(small.undoDepth, 3);
  });

  it('previewUndo returns description string', () => {
    mgr.beginTurn();
    mgr.recordMemoryOp({ action: 'store' });
    const preview = mgr.previewUndo(1);
    assert.ok(preview.includes('1 turn'));
    assert.ok(preview.includes('memory'));
  });

  it('previewUndo returns "Nothing to undo." when empty', () => {
    assert.equal(mgr.previewUndo(), 'Nothing to undo.');
  });

  it('previewRedo returns null when empty', () => {
    assert.equal(mgr.previewRedo(), null);
  });

  it('previewRedo returns object after undo', async () => {
    mgr.beginTurn();
    mgr.recordMemoryOp({ action: 'store' });
    await mgr.undo();
    const preview = mgr.previewRedo();
    assert.ok(preview);
    assert.ok(preview.id);
    assert.equal(typeof preview.ops, 'number');
  });

  it('checkpoints returns copies', () => {
    mgr.beginTurn();
    mgr.beginTurn();
    const cps = mgr.checkpoints;
    assert.equal(cps.length, 2);
    assert.ok(cps[0].turnId);
    assert.equal(typeof cps[0].memoryOps, 'number');
  });
});
