// Run with: node --import ./web/test/_setup-globals.mjs --test web/test/clawser-completeness-r2.test.mjs
// Completeness Audit Round 2 — TDD tests (written before implementation)
import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

// ── F1: GoalRemoveTool ───────────────────────────────────────────

import { GoalManager, GoalRemoveTool, resetGoalIdCounter } from '../clawser-goals.js';

describe('GoalRemoveTool', () => {
  let manager;

  beforeEach(() => {
    resetGoalIdCounter();
    manager = new GoalManager();
  });

  it('is exported from clawser-goals.js', () => {
    assert.equal(typeof GoalRemoveTool, 'function');
  });

  it('has correct tool metadata', () => {
    const tool = new GoalRemoveTool(manager);
    assert.equal(tool.name, 'goal_remove');
    assert.equal(tool.permission, 'approve');
    assert.deepEqual(tool.parameters.required, ['goal_id']);
  });

  it('removes an existing goal', async () => {
    const goal = manager.addGoal('Test goal');
    const tool = new GoalRemoveTool(manager);
    const result = await tool.execute({ goal_id: goal.id });
    assert.equal(result.success, true);
    assert.equal(manager.get(goal.id), null);
  });

  it('returns error for non-existent goal', async () => {
    const tool = new GoalRemoveTool(manager);
    const result = await tool.execute({ goal_id: 'nonexistent' });
    assert.equal(result.success, false);
    assert.ok(result.error);
  });

  it('removes goal and its descendants', async () => {
    const parent = manager.addGoal('Parent');
    manager.addSubGoal(parent.id, 'Child 1');
    manager.addSubGoal(parent.id, 'Child 2');
    assert.equal(manager.size, 3);

    const tool = new GoalRemoveTool(manager);
    await tool.execute({ goal_id: parent.id });
    assert.equal(manager.size, 0);
  });
});

// ── F2: StorageDeleteTool ────────────────────────────────────────

import { StorageDeleteTool } from '../clawser-tools.js';

describe('StorageDeleteTool', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('is exported from clawser-tools.js', () => {
    assert.equal(typeof StorageDeleteTool, 'function');
  });

  it('has correct tool metadata', () => {
    const tool = new StorageDeleteTool();
    assert.equal(tool.name, 'browser_storage_delete');
    assert.equal(tool.permission, 'write');
    assert.deepEqual(tool.parameters.required, ['key']);
  });

  it('deletes an existing key', async () => {
    localStorage.setItem('test_key', 'hello');
    const tool = new StorageDeleteTool();
    const result = await tool.execute({ key: 'test_key' });
    assert.equal(result.success, true);
    assert.equal(localStorage.getItem('test_key'), null);
  });

  it('returns success for non-existent key (idempotent)', async () => {
    const tool = new StorageDeleteTool();
    const result = await tool.execute({ key: 'no_such_key' });
    assert.equal(result.success, true);
  });

  it('blocks deletion of clawser_ prefixed keys', async () => {
    localStorage.setItem('clawser_config', 'secret');
    const tool = new StorageDeleteTool();
    const result = await tool.execute({ key: 'clawser_config' });
    assert.equal(result.success, false);
    assert.ok(result.error.includes('reserved'));
    assert.equal(localStorage.getItem('clawser_config'), 'secret');
  });
});

// ── F3: DaemonRestoreTool ────────────────────────────────────────

import { DaemonController, DaemonState, CheckpointManager, DaemonRestoreTool } from '../clawser-daemon.js';

describe('DaemonRestoreTool', () => {
  it('is exported from clawser-daemon.js', () => {
    assert.equal(typeof DaemonRestoreTool, 'function');
  });

  it('has correct tool metadata', () => {
    const state = new DaemonState();
    const cm = new CheckpointManager({
      writeFn: async () => {},
      readFn: async () => null,
    });
    const controller = new DaemonController({ state, checkpoints: cm });
    const tool = new DaemonRestoreTool(controller);
    assert.equal(tool.name, 'daemon_restore');
    assert.equal(tool.permission, 'approve');
  });

  it('restores from checkpoint when available', async () => {
    let restored = false;
    const state = new DaemonState();
    const cm = new CheckpointManager({
      writeFn: async () => {},
      readFn: async () => ({ id: 'cp-1', data: {}, reason: 'test', timestamp: Date.now(), size: 100 }),
    });
    const controller = new DaemonController({ state, checkpoints: cm });
    // Override restore to track call
    const origRestore = controller.restore.bind(controller);
    controller.restore = async () => {
      restored = true;
      return { id: 'cp-1', reason: 'test' };
    };

    const tool = new DaemonRestoreTool(controller);
    const result = await tool.execute();
    assert.equal(result.success, true);
    assert.equal(restored, true);
  });

  it('returns error when no checkpoint available', async () => {
    const state = new DaemonState();
    const cm = new CheckpointManager({
      writeFn: async () => {},
      readFn: async () => null,
    });
    const controller = new DaemonController({ state, checkpoints: cm });

    const tool = new DaemonRestoreTool(controller);
    const result = await tool.execute();
    assert.equal(result.success, false);
    assert.ok(result.error);
  });
});

// ── F4: ProfileCostLedger.clear() ────────────────────────────────

import { ProfileCostLedger } from '../clawser-providers.js';

describe('ProfileCostLedger.clear', () => {
  it('clear() with no args clears all profiles', () => {
    const ledger = new ProfileCostLedger();
    ledger.record('p1', { model: 'a', provider: 'x', inputTokens: 10, outputTokens: 5, costUsd: 0.01 });
    ledger.record('p2', { model: 'b', provider: 'y', inputTokens: 20, outputTokens: 10, costUsd: 0.02 });
    assert.equal(ledger.profileSummary('p1').totalCalls, 1);
    assert.equal(ledger.profileSummary('p2').totalCalls, 1);

    ledger.clear();
    assert.equal(ledger.profileSummary('p1').totalCalls, 0);
    assert.equal(ledger.profileSummary('p2').totalCalls, 0);
    assert.deepEqual(ledger.allProfileSummaries(), {});
  });

  it('clear(profileId) clears only that profile', () => {
    const ledger = new ProfileCostLedger();
    ledger.record('p1', { model: 'a', provider: 'x', inputTokens: 10, outputTokens: 5, costUsd: 0.01 });
    ledger.record('p2', { model: 'b', provider: 'y', inputTokens: 20, outputTokens: 10, costUsd: 0.02 });

    ledger.clear('p1');
    assert.equal(ledger.profileSummary('p1').totalCalls, 0);
    assert.equal(ledger.profileSummary('p2').totalCalls, 1);
  });

  it('clear(profileId) is no-op for unknown profile', () => {
    const ledger = new ProfileCostLedger();
    ledger.clear('unknown'); // Should not throw
  });
});

// ── F5: RoutineEngine.updateRoutine + RoutineUpdateTool ──────────

import { RoutineEngine, RoutineUpdateTool, resetRoutineCounter } from '../clawser-routines.js';

describe('RoutineEngine.updateRoutine', () => {
  beforeEach(() => resetRoutineCounter());

  it('updates name of an existing routine', () => {
    const engine = new RoutineEngine();
    const routine = engine.addRoutine({ name: 'original' });
    const updated = engine.updateRoutine(routine.id, { name: 'renamed' });
    assert.equal(updated, true);
    assert.equal(engine.getRoutine(routine.id).name, 'renamed');
  });

  it('returns false for non-existent routine', () => {
    const engine = new RoutineEngine();
    assert.equal(engine.updateRoutine('no-such', { name: 'x' }), false);
  });

  it('updates trigger of an existing routine', () => {
    const engine = new RoutineEngine();
    const routine = engine.addRoutine({ name: 'test', trigger: { type: 'event', event: 'old' } });
    engine.updateRoutine(routine.id, { trigger: { type: 'event', event: 'new' } });
    assert.equal(engine.getRoutine(routine.id).trigger.event, 'new');
  });

  it('updates action of an existing routine', () => {
    const engine = new RoutineEngine();
    const routine = engine.addRoutine({ name: 'test', action: { type: 'prompt', prompt: 'old' } });
    engine.updateRoutine(routine.id, { action: { type: 'prompt', prompt: 'new' } });
    assert.equal(engine.getRoutine(routine.id).action.prompt, 'new');
  });

  it('does not modify unspecified fields', () => {
    const engine = new RoutineEngine();
    const routine = engine.addRoutine({ name: 'keep-name' });
    engine.updateRoutine(routine.id, { enabled: false });
    assert.equal(engine.getRoutine(routine.id).name, 'keep-name');
    assert.equal(engine.getRoutine(routine.id).enabled, false);
  });
});

describe('RoutineUpdateTool', () => {
  beforeEach(() => resetRoutineCounter());

  it('is exported from clawser-routines.js', () => {
    assert.equal(typeof RoutineUpdateTool, 'function');
  });

  it('has correct tool metadata', () => {
    const engine = new RoutineEngine();
    const tool = new RoutineUpdateTool(engine);
    assert.equal(tool.name, 'routine_update');
    assert.equal(tool.permission, 'approve');
    assert.ok(tool.parameters.properties.routine_id);
  });

  it('updates routine via tool', async () => {
    const engine = new RoutineEngine();
    const routine = engine.addRoutine({ name: 'via-tool' });
    const tool = new RoutineUpdateTool(engine);
    const result = await tool.execute({ routine_id: routine.id, name: 'updated-name' });
    assert.equal(result.success, true);
    assert.equal(engine.getRoutine(routine.id).name, 'updated-name');
  });

  it('returns error for non-existent routine', async () => {
    const engine = new RoutineEngine();
    const tool = new RoutineUpdateTool(engine);
    const result = await tool.execute({ routine_id: 'no-such', name: 'x' });
    assert.equal(result.success, false);
    assert.ok(result.error);
  });
});

// ── F6: WebMCPDiscovery.removeDiscovered ─────────────────────────

import { WebMCPDiscovery } from '../clawser-mcp.js';

describe('WebMCPDiscovery.removeDiscovered', () => {
  it('removes an existing discovered tool', () => {
    const d = new WebMCPDiscovery();
    d.addDiscovered([{ name: 'tool-a', description: 'A', parameters: {}, source: 'test' }]);
    assert.equal(d.size, 1);
    const removed = d.removeDiscovered('tool-a');
    assert.equal(removed, true);
    assert.equal(d.size, 0);
  });

  it('returns false for non-existent tool', () => {
    const d = new WebMCPDiscovery();
    assert.equal(d.removeDiscovered('no-such'), false);
  });

  it('does not affect other tools', () => {
    const d = new WebMCPDiscovery();
    d.addDiscovered([
      { name: 'tool-a', description: 'A', parameters: {}, source: 'test' },
      { name: 'tool-b', description: 'B', parameters: {}, source: 'test' },
    ]);
    d.removeDiscovered('tool-a');
    assert.equal(d.size, 1);
    assert.equal(d.listDiscovered()[0].name, 'tool-b');
  });
});

// ── F7: SelfRepairEngine.unregisterHandler ───────────────────────

import { SelfRepairEngine } from '../clawser-self-repair.js';

describe('SelfRepairEngine.unregisterHandler', () => {
  it('unregisters an existing handler', () => {
    const engine = new SelfRepairEngine({ handlers: {} });
    engine.registerHandler('test_action', async () => true);
    assert.equal(engine.hasHandler('test_action'), true);
    const removed = engine.unregisterHandler('test_action');
    assert.equal(removed, true);
    assert.equal(engine.hasHandler('test_action'), false);
  });

  it('returns false for non-existent handler', () => {
    const engine = new SelfRepairEngine({ handlers: {} });
    assert.equal(engine.unregisterHandler('no-such'), false);
  });

  it('does not affect other handlers', () => {
    const engine = new SelfRepairEngine({ handlers: {} });
    engine.registerHandler('keep', async () => true);
    engine.registerHandler('remove', async () => true);
    engine.unregisterHandler('remove');
    assert.equal(engine.hasHandler('keep'), true);
    assert.equal(engine.hasHandler('remove'), false);
  });
});
