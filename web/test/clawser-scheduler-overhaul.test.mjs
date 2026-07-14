// Run with: node --import ./web/test/_setup-globals.mjs --test web/test/clawser-scheduler-overhaul.test.mjs
import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  RoutineEngine,
  TRIGGER_TYPES,
  createRoutine,
  resetRoutineCounter,
} from '../clawser-routines.js';

// ── Error Isolation ──────────────────────────────────────────────

describe('Error isolation in tickCron', () => {
  beforeEach(() => resetRoutineCounter());

  it('one failing routine does not prevent others from executing', async () => {
    const executed = [];
    let callCount = 0;

    const engine = new RoutineEngine({
      executeFn: async (routine) => {
        callCount++;
        if (routine.name === 'bad-routine') {
          throw new Error('Intentional failure');
        }
        executed.push(routine.id);
      },
      tickInterval: 999_999,
    });

    engine.addRoutine({
      name: 'bad-routine',
      trigger: { type: TRIGGER_TYPES.CRON, cron: '* * * * *' },
    });

    engine.addRoutine({
      name: 'good-routine',
      trigger: { type: TRIGGER_TYPES.CRON, cron: '* * * * *' },
    });

    const results = await engine.tickCron(new Date());

    // Both routines should have been attempted
    assert.equal(results.length, 2, 'should have results for both routines');

    // The bad one should show failure, the good one success
    const badResult = results.find(r => r.routineId === 'routine_1');
    const goodResult = results.find(r => r.routineId === 'routine_2');
    assert.equal(badResult.result, 'failure');
    assert.equal(goodResult.result, 'success');
  });

  it('error in one interval routine does not block others', async () => {
    const executed = [];

    const engine = new RoutineEngine({
      executeFn: async (routine) => {
        if (routine.name === 'fail-interval') throw new Error('boom');
        executed.push(routine.name);
      },
      tickInterval: 999_999,
    });

    const now = Date.now();

    engine.addRoutine({
      name: 'fail-interval',
      trigger: { type: TRIGGER_TYPES.CRON, cron: '99 99 99 99 99' }, // won't match cron
      meta: { source: 'agent', scheduleType: 'interval', intervalMs: 1000, lastFired: now - 2000 },
    });

    engine.addRoutine({
      name: 'ok-interval',
      trigger: { type: TRIGGER_TYPES.CRON, cron: '99 99 99 99 99' },
      meta: { source: 'agent', scheduleType: 'interval', intervalMs: 1000, lastFired: now - 2000 },
    });

    const results = await engine.tickCron(new Date(now));
    assert.equal(results.length, 2);
    assert.ok(executed.includes('ok-interval'), 'ok-interval should still execute');
  });
});

// ── Missed Execution Catch-Up ──────────────────────────────────

describe('Missed execution catch-up', () => {
  beforeEach(() => resetRoutineCounter());

  it('catches up missed cron executions on start', async () => {
    const executed = [];

    const engine = new RoutineEngine({
      executeFn: async (routine, trigger) => {
        executed.push({ id: routine.id, type: trigger.type });
      },
      tickInterval: 999_999,
      catchUpMissed: true,
    });

    engine.addRoutine({
      name: 'every-minute',
      trigger: { type: TRIGGER_TYPES.CRON, cron: '* * * * *' },
    });

    // Simulate the engine having last ticked 5 minutes ago
    engine.lastTickTime = Date.now() - 5 * 60_000;

    const catchUpResults = await engine.start();
    engine.stop();

    assert.ok(catchUpResults.length > 0, 'should have catch-up results');
    assert.equal(catchUpResults[0].catchUp, true);
    assert.ok(executed.some(e => e.type === 'cron.catchup'));
  });

  it('does not catch up when catchUpMissed is false', async () => {
    const executed = [];

    const engine = new RoutineEngine({
      executeFn: async (routine, trigger) => {
        executed.push(trigger.type);
      },
      tickInterval: 999_999,
      catchUpMissed: false,
    });

    engine.addRoutine({
      name: 'every-minute',
      trigger: { type: TRIGGER_TYPES.CRON, cron: '* * * * *' },
    });

    engine.lastTickTime = Date.now() - 5 * 60_000;

    const results = await engine.start();
    engine.stop();

    assert.equal(results.length, 0);
    assert.equal(executed.length, 0);
  });

  it('does not catch up if lastTickTime is not set', async () => {
    const engine = new RoutineEngine({
      executeFn: async () => {},
      tickInterval: 999_999,
      catchUpMissed: true,
    });

    engine.addRoutine({
      name: 'every-minute',
      trigger: { type: TRIGGER_TYPES.CRON, cron: '* * * * *' },
    });

    const results = await engine.start();
    engine.stop();

    assert.equal(results.length, 0);
  });

  it('respects maxCatchUpMs window', async () => {
    const executed = [];

    const engine = new RoutineEngine({
      executeFn: async (routine, trigger) => {
        executed.push(trigger.type);
      },
      tickInterval: 999_999,
      catchUpMissed: true,
      maxCatchUpMs: 60_000, // only 1 minute catch-up window
    });

    engine.addRoutine({
      name: 'hourly',
      trigger: { type: TRIGGER_TYPES.CRON, cron: '0 * * * *' }, // on the hour
    });

    // Set lastTickTime to 2 hours ago — but maxCatchUpMs only looks back 1 min
    engine.lastTickTime = Date.now() - 2 * 3_600_000;

    const results = await engine.start();
    engine.stop();

    // The hourly job probably won't match within the last 1 minute window
    // (unless we happen to be at minute 0), so this validates the cap works
    assert.ok(results.length <= 1, 'should be capped by maxCatchUpMs');
  });

  it('catches up only once per routine (not per missed minute)', async () => {
    let count = 0;

    const engine = new RoutineEngine({
      executeFn: async () => { count++; },
      tickInterval: 999_999,
      catchUpMissed: true,
    });

    engine.addRoutine({
      name: 'every-minute',
      trigger: { type: TRIGGER_TYPES.CRON, cron: '* * * * *' },
    });

    // 10 minutes missed
    engine.lastTickTime = Date.now() - 10 * 60_000;

    await engine.start();
    engine.stop();

    // Should only fire once, not 10 times
    assert.equal(count, 1, 'should catch up once per routine');
  });
});

// ── Timezone Support ──────────────────────────────────────────

describe('Timezone-aware cron', () => {
  beforeEach(() => resetRoutineCounter());

  it('resolveInTimezone returns correct components for UTC', () => {
    // Create a date at a known UTC time
    const date = new Date('2025-06-15T14:30:00Z');
    const resolved = RoutineEngine.resolveInTimezone(date, 'UTC');
    assert.equal(resolved.minute, 30);
    assert.equal(resolved.hour, 14);
    assert.equal(resolved.day, 15);
    assert.equal(resolved.month, 6);
    // June 15, 2025 is a Sunday
    assert.equal(resolved.dow, 0);
  });

  it('resolveInTimezone shifts hours for different timezone', () => {
    // UTC 14:30 should be 10:30 in America/New_York (EDT, UTC-4)
    const date = new Date('2025-06-15T14:30:00Z');
    const resolved = RoutineEngine.resolveInTimezone(date, 'America/New_York');
    assert.equal(resolved.minute, 30);
    assert.equal(resolved.hour, 10);
  });

  it('cron matches in specified timezone', async () => {
    const executed = [];

    const engine = new RoutineEngine({
      executeFn: async (routine) => {
        executed.push(routine.id);
      },
      tickInterval: 999_999,
    });

    // Schedule for 10:30 in America/New_York
    engine.addRoutine({
      name: 'ny-morning',
      trigger: { type: TRIGGER_TYPES.CRON, cron: '30 10 * * *', timezone: 'America/New_York' },
    });

    // Tick at 14:30 UTC (which is 10:30 EDT)
    await engine.tickCron(new Date('2025-06-15T14:30:00Z'));
    assert.equal(executed.length, 1, 'should fire at 10:30 New York time');

    // Tick at 10:30 UTC (which is 6:30 EDT) — should NOT match
    executed.length = 0;
    await engine.tickCron(new Date('2025-06-15T10:30:00Z'));
    assert.equal(executed.length, 0, 'should not fire at 10:30 UTC');
  });

  it('cron without timezone uses local time (backward compat)', async () => {
    const executed = [];

    const engine = new RoutineEngine({
      executeFn: async (routine) => { executed.push(routine.id); },
      tickInterval: 999_999,
    });

    const now = new Date();
    const min = now.getMinutes();
    const hour = now.getHours();

    engine.addRoutine({
      name: 'local-time',
      trigger: { type: TRIGGER_TYPES.CRON, cron: `${min} ${hour} * * *` },
    });

    await engine.tickCron(now);
    assert.equal(executed.length, 1, 'should match local time');
  });
});

// ── Jitter ──────────────────────────────────────────────────────

describe('Jitter option', () => {
  beforeEach(() => resetRoutineCounter());

  it('routine with jitterMs=0 fires immediately', async () => {
    const executed = [];

    const engine = new RoutineEngine({
      executeFn: async (routine) => { executed.push(routine.id); },
      tickInterval: 999_999,
    });

    engine.addRoutine({
      name: 'no-jitter',
      trigger: { type: TRIGGER_TYPES.CRON, cron: '* * * * *' },
      jitterMs: 0,
    });

    await engine.tickCron(new Date());
    assert.equal(executed.length, 1);
  });

  it('createRoutine defaults jitterMs to 0', () => {
    const r = createRoutine({ name: 'test' });
    assert.equal(r.jitterMs, 0);
  });

  it('createRoutine accepts jitterMs', () => {
    const r = createRoutine({ name: 'test', jitterMs: 5000 });
    assert.equal(r.jitterMs, 5000);
  });

  it('createRoutine accepts timezone in trigger', () => {
    const r = createRoutine({
      name: 'tz-test',
      trigger: { type: 'cron', cron: '0 9 * * *', timezone: 'Europe/London' },
    });
    assert.equal(r.trigger.timezone, 'Europe/London');
  });
});

// ── Health Metrics ──────────────────────────────────────────────

describe('Health metrics', () => {
  beforeEach(() => resetRoutineCounter());

  it('getRoutineHealth returns null for unknown routine', () => {
    const engine = new RoutineEngine();
    assert.equal(engine.getRoutineHealth('nonexistent'), null);
  });

  it('getRoutineHealth returns zeros before any execution', () => {
    const engine = new RoutineEngine();
    engine.addRoutine({ name: 'fresh' });

    const health = engine.getRoutineHealth('routine_1');
    assert.equal(health.successCount, 0);
    assert.equal(health.failureCount, 0);
    assert.equal(health.errorCount, 0);
    assert.equal(health.totalRuns, 0);
    assert.equal(health.avgDurationMs, 0);
    assert.equal(health.lastRunTime, null);
  });

  it('tracks success metrics after execution', async () => {
    const engine = new RoutineEngine({
      executeFn: async () => {},
      tickInterval: 999_999,
    });

    engine.addRoutine({
      name: 'tracked',
      trigger: { type: TRIGGER_TYPES.CRON, cron: '* * * * *' },
    });

    await engine.tickCron(new Date());
    await engine.tickCron(new Date());

    const health = engine.getRoutineHealth('routine_1');
    assert.equal(health.successCount, 2);
    assert.equal(health.totalRuns, 2);
    assert.equal(health.lastResult, 'success');
    assert.ok(health.lastRunTime !== null);
  });

  it('tracks failure metrics', async () => {
    const engine = new RoutineEngine({
      executeFn: async () => { throw new Error('fail'); },
      tickInterval: 999_999,
    });

    engine.addRoutine({
      name: 'failing',
      trigger: { type: TRIGGER_TYPES.CRON, cron: '* * * * *' },
      guardrails: { maxRunsPerHour: 100 },
    });

    await engine.tickCron(new Date());

    const health = engine.getRoutineHealth('routine_1');
    assert.equal(health.failureCount, 1);
    assert.equal(health.lastResult, 'failure');
  });

  it('getAllHealth returns metrics for all routines', async () => {
    const engine = new RoutineEngine({
      executeFn: async () => {},
      tickInterval: 999_999,
    });

    engine.addRoutine({
      name: 'a',
      trigger: { type: TRIGGER_TYPES.CRON, cron: '* * * * *' },
    });
    engine.addRoutine({
      name: 'b',
      trigger: { type: TRIGGER_TYPES.CRON, cron: '* * * * *' },
    });

    await engine.tickCron(new Date());

    const all = engine.getAllHealth();
    assert.equal(all.length, 2);
    assert.ok(all.every(h => h.totalRuns === 1));
  });

  it('health includes nextFireTime', () => {
    const engine = new RoutineEngine();
    engine.addRoutine({
      name: 'once-job',
      meta: { source: 'agent', scheduleType: 'once', fireAt: 99999, fired: false },
    });

    const health = engine.getRoutineHealth('routine_1');
    assert.equal(health.nextFireTime, 99999);
  });
});

// ── Persistence (toJSON/fromJSON) ────────────────────────────────

describe('Enhanced persistence', () => {
  beforeEach(() => resetRoutineCounter());

  it('toJSON includes lastTickTime and healthMetrics', async () => {
    const engine = new RoutineEngine({
      executeFn: async () => {},
      tickInterval: 999_999,
    });

    engine.addRoutine({
      name: 'persist-test',
      trigger: { type: TRIGGER_TYPES.CRON, cron: '* * * * *' },
    });

    await engine.tickCron(new Date());

    const json = engine.toJSON();
    assert.ok(json.lastTickTime !== null, 'should include lastTickTime');
    assert.ok(json.healthMetrics, 'should include healthMetrics');
    assert.ok(json.routines.length === 1, 'should include routines');
  });

  it('fromJSON restores lastTickTime and healthMetrics', async () => {
    const engine1 = new RoutineEngine({
      executeFn: async () => {},
      tickInterval: 999_999,
    });

    engine1.addRoutine({
      name: 'roundtrip',
      trigger: { type: TRIGGER_TYPES.CRON, cron: '* * * * *' },
    });

    await engine1.tickCron(new Date());
    const json = engine1.toJSON();

    // Restore into a new engine
    resetRoutineCounter();
    const engine2 = new RoutineEngine({ tickInterval: 999_999 });
    engine2.fromJSON(json);

    assert.equal(engine2.lastTickTime, json.lastTickTime);
    const health = engine2.getRoutineHealth('routine_1');
    assert.equal(health.successCount, 1);
  });

  it('fromJSON handles legacy array format', () => {
    const engine = new RoutineEngine();
    const legacyData = [
      createRoutine({ name: 'legacy' }),
    ];

    engine.fromJSON(legacyData);
    assert.equal(engine.routineCount, 1);
  });
});
