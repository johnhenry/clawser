// Run with: node --import ./web/test/_setup-globals.mjs --test web/test/clawser-routines-toggle.test.mjs
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  RoutineEngine,
  RoutineToggleTool,
  TRIGGER_TYPES,
  resetRoutineCounter,
} from '../clawser-routines.js';

// ── enableRoutine / disableRoutine ─────────────────────────────

describe('RoutineEngine enableRoutine / disableRoutine', () => {
  it('enableRoutine sets routine.enabled to true', () => {
    resetRoutineCounter();
    const engine = new RoutineEngine();
    const routine = engine.addRoutine({ name: 'toggle-test', enabled: false });

    assert.equal(routine.enabled, false, 'should start disabled');
    const result = engine.enableRoutine(routine.id);
    assert.equal(result, true, 'should return true for existing routine');

    const updated = engine.getRoutine(routine.id);
    assert.equal(updated.enabled, true, 'should be enabled after enableRoutine');
  });

  it('disableRoutine sets routine.enabled to false', () => {
    resetRoutineCounter();
    const engine = new RoutineEngine();
    const routine = engine.addRoutine({ name: 'toggle-test-2' });

    assert.equal(routine.enabled, true, 'should start enabled');
    const result = engine.disableRoutine(routine.id);
    assert.equal(result, true, 'should return true for existing routine');

    const updated = engine.getRoutine(routine.id);
    assert.equal(updated.enabled, false, 'should be disabled after disableRoutine');
  });

  it('enableRoutine returns false for unknown id', () => {
    const engine = new RoutineEngine();
    assert.equal(engine.enableRoutine('nonexistent'), false);
  });

  it('disableRoutine returns false for unknown id', () => {
    const engine = new RoutineEngine();
    assert.equal(engine.disableRoutine('nonexistent'), false);
  });

  it('enableRoutine is idempotent', () => {
    resetRoutineCounter();
    const engine = new RoutineEngine();
    const routine = engine.addRoutine({ name: 'idem' });

    engine.enableRoutine(routine.id);
    engine.enableRoutine(routine.id);
    assert.equal(engine.getRoutine(routine.id).enabled, true);
  });

  it('disableRoutine is idempotent', () => {
    resetRoutineCounter();
    const engine = new RoutineEngine();
    const routine = engine.addRoutine({ name: 'idem2', enabled: false });

    engine.disableRoutine(routine.id);
    engine.disableRoutine(routine.id);
    assert.equal(engine.getRoutine(routine.id).enabled, false);
  });
});

// ── triggerManual skips disabled routines ──────────────────────

describe('triggerManual checks enabled state', () => {
  it('skips disabled routine and returns skipped message', async () => {
    resetRoutineCounter();
    let executed = false;
    const engine = new RoutineEngine({
      executeFn: async () => { executed = true; },
    });

    const routine = engine.addRoutine({ name: 'skip-test', enabled: false });
    const result = await engine.triggerManual(routine.id);

    assert.equal(executed, false, 'executeFn should NOT be called for disabled routine');
    assert.equal(result, 'skipped_disabled', 'should return skipped_disabled');
  });

  it('executes enabled routine normally', async () => {
    resetRoutineCounter();
    let executed = false;
    const engine = new RoutineEngine({
      executeFn: async () => { executed = true; },
    });

    const routine = engine.addRoutine({ name: 'run-test', enabled: true });
    const result = await engine.triggerManual(routine.id);

    assert.equal(executed, true, 'executeFn SHOULD be called for enabled routine');
    assert.equal(result, 'success');
  });

  it('throws for nonexistent routine id', async () => {
    const engine = new RoutineEngine();
    await assert.rejects(
      () => engine.triggerManual('does-not-exist'),
      /not found/i,
    );
  });
});

// ── RoutineRunTool respects enabled flag ────────────────────────

describe('RoutineRunTool respects enabled flag', () => {
  it('returns skipped message for disabled routine', async () => {
    resetRoutineCounter();
    const { RoutineRunTool } = await import('../clawser-routines.js');
    const engine = new RoutineEngine({
      executeFn: async () => 'ok',
    });
    const routine = engine.addRoutine({ name: 'run-disabled', enabled: false });

    const tool = new RoutineRunTool(engine);
    const result = await tool.execute({ id: routine.id });

    assert.ok(result.success, 'should succeed (skip is not an error)');
    assert.ok(result.output.includes('skipped') || result.output.includes('disabled'),
      'output should mention skipped or disabled');
  });
});

// ── RoutineToggleTool ──────────────────────────────────────────

describe('RoutineToggleTool', () => {
  it('is exported from clawser-routines.js', () => {
    assert.ok(RoutineToggleTool, 'should be exported');
    assert.equal(typeof RoutineToggleTool, 'function');
  });

  it('has correct tool metadata', () => {
    const engine = new RoutineEngine();
    const tool = new RoutineToggleTool(engine);

    assert.equal(tool.name, 'routine_toggle');
    assert.ok(tool.description.length > 0, 'should have a description');
    assert.equal(tool.permission, 'approve');

    const params = tool.parameters;
    assert.ok(params.properties.routine_id, 'should have routine_id param');
    assert.ok(params.properties.enabled, 'should have enabled param');
    assert.deepEqual(params.required, ['routine_id', 'enabled']);
  });

  it('enables a routine via tool', async () => {
    resetRoutineCounter();
    const engine = new RoutineEngine();
    const routine = engine.addRoutine({ name: 'tool-enable', enabled: false });

    const tool = new RoutineToggleTool(engine);
    const result = await tool.execute({ routine_id: routine.id, enabled: true });

    assert.ok(result.success);
    assert.equal(engine.getRoutine(routine.id).enabled, true);
  });

  it('disables a routine via tool', async () => {
    resetRoutineCounter();
    const engine = new RoutineEngine();
    const routine = engine.addRoutine({ name: 'tool-disable', enabled: true });

    const tool = new RoutineToggleTool(engine);
    const result = await tool.execute({ routine_id: routine.id, enabled: false });

    assert.ok(result.success);
    assert.equal(engine.getRoutine(routine.id).enabled, false);
  });

  it('returns error for nonexistent routine', async () => {
    const engine = new RoutineEngine();
    const tool = new RoutineToggleTool(engine);
    const result = await tool.execute({ routine_id: 'no-such', enabled: true });

    assert.equal(result.success, false);
    assert.ok(result.error);
  });
});
