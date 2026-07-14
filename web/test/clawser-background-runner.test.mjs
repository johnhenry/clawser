// Run with: node --import ./web/test/_setup-globals.mjs --test web/test/clawser-background-runner.test.mjs
import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { BackgroundSchedulerRunner, validateCronExpression } from '../clawser-background-runner.js';

// ── In-memory IDB stub ───────────────────────────────────────────

function makeStubIDB() {
  const store = new Map();
  return {
    async write(key, data) { store.set(key, JSON.parse(JSON.stringify(data))); },
    async read(key) { return store.get(key) ?? null; },
    async delete(key) { store.delete(key); },
    async keys() { return [...store.keys()]; },
    async clear() { store.clear(); },
    store,
  };
}

// ── findDueRoutines ──────────────────────────────────────────────

describe('BackgroundSchedulerRunner — findDueRoutines', () => {
  it('finds due cron routines', () => {
    const runner = new BackgroundSchedulerRunner();
    // Create a date where minute matches * and hour matches *
    const now = new Date();
    const routines = [{
      id: 'r1',
      enabled: true,
      trigger: { type: 'cron', cron: '* * * * *' },
      state: { lastCronMinute: 0 },
      meta: null,
    }];
    const nowMs = now.getTime();
    const due = runner.findDueRoutines(routines, nowMs);
    assert.ok(due.length >= 1, 'wildcard cron should always match');
  });

  it('skips disabled routines', () => {
    const runner = new BackgroundSchedulerRunner();
    const routines = [{
      id: 'r1',
      enabled: false,
      trigger: { type: 'cron', cron: '* * * * *' },
      state: {},
    }];
    const due = runner.findDueRoutines(routines, Date.now());
    assert.equal(due.length, 0);
  });

  it('finds due interval routines', () => {
    const runner = new BackgroundSchedulerRunner();
    const now = Date.now();
    const routines = [{
      id: 'r1',
      enabled: true,
      trigger: {},
      meta: { source: 'agent', scheduleType: 'interval', intervalMs: 5000, lastFired: now - 6000 },
    }];
    const due = runner.findDueRoutines(routines, now);
    assert.equal(due.length, 1);
  });

  it('skips interval not yet due', () => {
    const runner = new BackgroundSchedulerRunner();
    const now = Date.now();
    const routines = [{
      id: 'r1',
      enabled: true,
      trigger: {},
      meta: { source: 'agent', scheduleType: 'interval', intervalMs: 10000, lastFired: now - 2000 },
    }];
    const due = runner.findDueRoutines(routines, now);
    assert.equal(due.length, 0);
  });

  it('finds due once routines', () => {
    const runner = new BackgroundSchedulerRunner();
    const now = Date.now();
    const routines = [{
      id: 'r1',
      enabled: true,
      trigger: {},
      meta: { source: 'agent', scheduleType: 'once', fireAt: now - 1000, fired: false },
    }];
    const due = runner.findDueRoutines(routines, now);
    assert.equal(due.length, 1);
  });

  it('skips already-fired once routines', () => {
    const runner = new BackgroundSchedulerRunner();
    const now = Date.now();
    const routines = [{
      id: 'r1',
      enabled: true,
      trigger: {},
      meta: { source: 'agent', scheduleType: 'once', fireAt: now - 1000, fired: true },
    }];
    const due = runner.findDueRoutines(routines, now);
    assert.equal(due.length, 0);
  });
});

// ── run() ────────────────────────────────────────────────────────

describe('BackgroundSchedulerRunner — run', () => {
  it('executes due routines and saves state', async () => {
    const idb = makeStubIDB();
    const executed = [];
    const runner = new BackgroundSchedulerRunner({
      idb,
      executeFn: async (routine) => { executed.push(routine.id); },
    });

    const now = Date.now();
    await idb.write('background_routine_state', [{
      id: 'r1',
      name: 'Test cron',
      enabled: true,
      trigger: { type: 'cron', cron: '* * * * *' },
      state: { lastCronMinute: 0 },
      meta: null,
    }]);

    const result = await runner.run(now);
    assert.ok(result.executed >= 1);
    assert.ok(executed.includes('r1'));

    // Verify state was saved
    const saved = await idb.read('background_routine_state');
    assert.ok(saved[0].state.lastRun === now);
    assert.equal(saved[0].state.lastResult, 'success');
  });

  it('logs failures and continues', async () => {
    const idb = makeStubIDB();
    const logs = [];
    const runner = new BackgroundSchedulerRunner({
      idb,
      executeFn: async () => { throw new Error('exec failed'); },
      onLog: (msg) => logs.push(msg),
    });

    const now = Date.now();
    await idb.write('background_routine_state', [{
      id: 'r1',
      name: 'Failing',
      enabled: true,
      trigger: { type: 'cron', cron: '* * * * *' },
      state: { lastCronMinute: 0 },
    }]);

    const result = await runner.run(now);
    assert.ok(result.results.some(r => r.result === 'failure'));
    assert.ok(logs.some(l => l.includes('failed')));
  });

  it('returns empty when no routines stored', async () => {
    const idb = makeStubIDB();
    const runner = new BackgroundSchedulerRunner({ idb });
    const result = await runner.run();
    assert.equal(result.executed, 0);
    assert.deepEqual(result.results, []);
  });

  it('appends to execution log and can read/clear it', async () => {
    const idb = makeStubIDB();
    const runner = new BackgroundSchedulerRunner({
      idb,
      executeFn: async () => {},
    });

    const now = Date.now();
    await idb.write('background_routine_state', [{
      id: 'r1',
      name: 'Logged',
      enabled: true,
      trigger: {},
      meta: { source: 'agent', scheduleType: 'interval', intervalMs: 1000, lastFired: 0 },
    }]);

    await runner.run(now);

    const log = await runner.readLog();
    assert.ok(log.length >= 1, 'execution log should have entries');
    assert.ok(log[0].results.length >= 1);

    await runner.clearLog();
    const cleared = await runner.readLog();
    assert.deepEqual(cleared, []);
  });

  it('marks once routines as fired', async () => {
    const idb = makeStubIDB();
    const runner = new BackgroundSchedulerRunner({ idb, executeFn: async () => {} });

    const now = Date.now();
    await idb.write('background_routine_state', [{
      id: 'r1',
      name: 'Once',
      enabled: true,
      trigger: {},
      meta: { source: 'agent', scheduleType: 'once', fireAt: now - 1000, fired: false },
      state: {},
    }]);

    await runner.run(now);
    const saved = await idb.read('background_routine_state');
    assert.ok(saved[0].meta.fired, 'once routine should be marked as fired');
  });

  it('updates interval lastFired', async () => {
    const idb = makeStubIDB();
    const runner = new BackgroundSchedulerRunner({ idb, executeFn: async () => {} });

    const now = Date.now();
    await idb.write('background_routine_state', [{
      id: 'r1',
      name: 'Interval',
      enabled: true,
      trigger: {},
      meta: { source: 'agent', scheduleType: 'interval', intervalMs: 5000, lastFired: 0 },
      state: {},
    }]);

    await runner.run(now);
    const saved = await idb.read('background_routine_state');
    assert.equal(saved[0].meta.lastFired, now, 'lastFired should be updated');
  });
});

// ── validateCronExpression ────────────────────────────────────────

describe('validateCronExpression', () => {
  it('accepts valid 5-field expressions', () => {
    for (const expr of ['* * * * *', '0 9 * * 1-5', '*/15 * * * *', '0,30 8-18 * * *']) {
      assert.equal(validateCronExpression(expr), null, `expected valid: ${expr}`);
    }
  });

  it('rejects the wrong number of fields', () => {
    assert.match(validateCronExpression('* * * *'), /expected 5 fields, got 4/);
    assert.match(validateCronExpression('* * * * * *'), /expected 5 fields, got 6/);
  });

  it('rejects out-of-range field values', () => {
    assert.match(validateCronExpression('99 * * * *'), /minute field/);
    assert.match(validateCronExpression('* 25 * * *'), /hour field/);
    assert.match(validateCronExpression('* * 32 * *'), /day-of-month field/);
    assert.match(validateCronExpression('* * * 13 *'), /month field/);
    assert.match(validateCronExpression('* * * * 8'), /day-of-week field/);
  });

  it('rejects invalid ranges and steps', () => {
    assert.match(validateCronExpression('10-5 * * * *'), /minute field/); // reversed range
    assert.match(validateCronExpression('*/0 * * * *'), /minute field/); // zero step
    assert.match(validateCronExpression('abc * * * *'), /minute field/); // non-numeric
  });

  it('rejects non-string / empty input', () => {
    assert.match(validateCronExpression(''), /non-empty string/);
    assert.match(validateCronExpression(null), /non-empty string/);
  });
});

// ── run() — cron validation ────────────────────────────────────────

describe('BackgroundSchedulerRunner — run cron validation', () => {
  it('logs an invalid cron once and excludes the routine from due-checking', async () => {
    const idb = makeStubIDB();
    const logs = [];
    const executed = [];
    const runner = new BackgroundSchedulerRunner({
      idb, onLog: (m) => logs.push(m),
      executeFn: async (r) => { executed.push(r.id); },
    });
    await idb.write('background_routine_state', [{
      id: 'bad', name: 'Bad Cron', enabled: true,
      trigger: { type: 'cron', cron: '99 * * * *' }, state: {},
    }]);

    await runner.run(Date.now());
    assert.equal(executed.length, 0);
    assert.ok(logs.some(l => l.includes('Invalid cron')));

    // Second run: same warning must not repeat (state.cronInvalidLogged sticks)
    logs.length = 0;
    await runner.run(Date.now());
    assert.equal(logs.filter(l => l.includes('Invalid cron')).length, 0);
  });

  it('a valid cron on an otherwise-identical routine still executes', async () => {
    const idb = makeStubIDB();
    const executed = [];
    const runner = new BackgroundSchedulerRunner({ idb, executeFn: async (r) => { executed.push(r.id); } });
    await idb.write('background_routine_state', [{
      id: 'ok', name: 'Good Cron', enabled: true,
      trigger: { type: 'cron', cron: '* * * * *' }, state: { lastCronMinute: 0 },
    }]);

    await runner.run(Date.now());
    assert.deepEqual(executed, ['ok']);
  });
});

// ── run() — consecutive-failure skip ───────────────────────────────

describe('BackgroundSchedulerRunner — consecutive failure skip', () => {
  it('skips a routine after 3 consecutive failures instead of retrying forever', async () => {
    const idb = makeStubIDB();
    const logs = [];
    const runner = new BackgroundSchedulerRunner({
      idb, onLog: (m) => logs.push(m),
      executeFn: async () => { throw new Error('boom'); },
    });
    await idb.write('background_routine_state', [{
      id: 'r1', name: 'Flaky', enabled: true,
      meta: { source: 'agent', scheduleType: 'interval', intervalMs: 1, lastFired: 0 },
      state: {},
    }]);

    // Fail 3 times
    let now = Date.now();
    for (let i = 0; i < 3; i++) {
      await runner.run(now);
      now += 10;
    }
    let saved = (await idb.read('background_routine_state'))[0];
    assert.equal(saved.state.consecutiveFailures, 3);

    // 4th tick: skipped, not retried
    const result = await runner.run(now);
    assert.equal(result.results.length, 0);
    assert.equal(result.skipped.length, 1);
    assert.equal(result.skipped[0].reason, 'previous failure');
    assert.ok(logs.some(l => l.includes('Skipped (previous failure)')));
  });

  it('resets the failure counter on a subsequent success', async () => {
    const idb = makeStubIDB();
    let shouldFail = true;
    const runner = new BackgroundSchedulerRunner({
      idb,
      executeFn: async () => { if (shouldFail) throw new Error('boom'); },
    });
    await idb.write('background_routine_state', [{
      id: 'r1', name: 'Recovers', enabled: true,
      meta: { source: 'agent', scheduleType: 'interval', intervalMs: 1, lastFired: 0 },
      state: {},
    }]);

    let now = Date.now();
    await runner.run(now); now += 10;
    await runner.run(now); now += 10;
    shouldFail = false;
    await runner.run(now);

    const saved = (await idb.read('background_routine_state'))[0];
    assert.equal(saved.state.consecutiveFailures, 0);
    assert.equal(saved.state.lastResult, 'success');
  });

  it('records skipped entries in the execution log', async () => {
    const idb = makeStubIDB();
    const runner = new BackgroundSchedulerRunner({ idb, executeFn: async () => { throw new Error('x'); } });
    await idb.write('background_routine_state', [{
      id: 'r1', name: 'Flaky', enabled: true,
      meta: { source: 'agent', scheduleType: 'interval', intervalMs: 1, lastFired: 0 },
      state: { consecutiveFailures: 3 },
    }]);

    await runner.run(Date.now());
    const log = await runner.readLog();
    const last = log[log.length - 1];
    assert.deepEqual(last.skipped, [{ routineId: 'r1', reason: 'previous failure' }]);
  });
});
