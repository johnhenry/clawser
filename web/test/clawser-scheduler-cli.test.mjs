// Run with: node --import ./web/test/_setup-globals.mjs --test web/test/clawser-scheduler-cli.test.mjs
import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { RoutineEngine, createRoutine, resetRoutineCounter } from '../clawser-routines.js';
import { registerSchedulerCli } from '../clawser-scheduler-cli.js';

// ── Helpers ──────────────────────────────────────────────────────

function makeEngine() {
  resetRoutineCounter();
  return new RoutineEngine({
    executeFn: async () => 'ok',
    onLog: () => {},
  });
}

function makeRegistry() {
  const commands = new Map();
  return {
    register(name, handler) { commands.set(name, handler); },
    run(name, args) { return commands.get(name)({ args }); },
    commands,
  };
}

// ── Registration ─────────────────────────────────────────────────

describe('Scheduler CLI — registration', () => {
  it('registers cron and schedule commands', () => {
    const reg = makeRegistry();
    registerSchedulerCli(reg, () => makeEngine(), () => null);
    assert.ok(reg.commands.has('cron'));
    assert.ok(reg.commands.has('schedule'));
  });
});

// ── Subcommands ──────────────────────────────────────────────────

describe('Scheduler CLI — subcommands', () => {
  let engine, reg;

  beforeEach(() => {
    engine = makeEngine();
    reg = makeRegistry();
    registerSchedulerCli(reg, () => engine, () => null);
  });

  it('help shows usage', async () => {
    const result = await reg.run('cron', []);
    assert.equal(result.exitCode, 0);
    assert.ok(result.stdout.includes('Usage:'));
  });

  it('list shows empty when no routines', async () => {
    const result = await reg.run('cron', ['list']);
    assert.equal(result.exitCode, 0);
    assert.ok(result.stdout.includes('No routines'));
  });

  it('list shows routines after add', async () => {
    engine.addRoutine({
      name: 'Test routine',
      trigger: { type: 'cron', cron: '*/5 * * * *' },
      action: { type: 'prompt', prompt: 'Test' },
    });
    const result = await reg.run('cron', ['list']);
    assert.equal(result.exitCode, 0);
    assert.ok(result.stdout.includes('Test routine'));
    assert.ok(result.stdout.includes('*/5 * * * *'));
  });

  it('add cron routine via CLI (with engine fallback)', async () => {
    const result = await reg.run('cron', ['add', '0 9 * * *', 'Good morning check']);
    assert.equal(result.exitCode, 0);
    assert.ok(result.stdout.includes('Added cron'));
    assert.equal(engine.listRoutines().length, 1);
  });

  it('remove deletes a routine', async () => {
    const r = engine.addRoutine({ name: 'Temp', trigger: { type: 'cron' }, action: { type: 'prompt' } });
    const result = await reg.run('cron', ['remove', r.id]);
    assert.equal(result.exitCode, 0);
    assert.ok(result.stdout.includes('Removed'));
    assert.equal(engine.listRoutines().length, 0);
  });

  it('remove returns error for unknown id', async () => {
    const result = await reg.run('cron', ['remove', 'nonexistent']);
    assert.equal(result.exitCode, 1);
  });

  it('pause disables a routine', async () => {
    const r = engine.addRoutine({ name: 'Pausable', trigger: { type: 'cron' }, action: { type: 'prompt' } });
    const result = await reg.run('cron', ['pause', r.id]);
    assert.equal(result.exitCode, 0);
    assert.ok(!engine.getRoutine(r.id).enabled);
  });

  it('resume re-enables a routine', async () => {
    const r = engine.addRoutine({ name: 'Resumable', trigger: { type: 'cron' }, action: { type: 'prompt' } });
    engine.setEnabled(r.id, false);
    const result = await reg.run('cron', ['resume', r.id]);
    assert.equal(result.exitCode, 0);
    assert.ok(engine.getRoutine(r.id).enabled);
  });

  it('history shows no history initially', async () => {
    const r = engine.addRoutine({ name: 'Historical', trigger: { type: 'cron' }, action: { type: 'prompt' } });
    const result = await reg.run('cron', ['history', r.id]);
    assert.equal(result.exitCode, 0);
    assert.ok(result.stdout.includes('No history'));
  });

  it('history shows entries after execution', async () => {
    const r = engine.addRoutine({
      name: 'Executed',
      trigger: { type: 'cron', cron: '* * * * *' },
      action: { type: 'prompt', prompt: 'test' },
    });
    await engine.triggerManual(r.id);
    const result = await reg.run('cron', ['history', r.id]);
    assert.equal(result.exitCode, 0);
    assert.ok(result.stdout.includes('success'));
  });

  it('run triggers manual execution', async () => {
    const r = engine.addRoutine({
      name: 'Runnable',
      trigger: { type: 'cron' },
      action: { type: 'prompt', prompt: 'go' },
    });
    const result = await reg.run('cron', ['run', r.id]);
    assert.equal(result.exitCode, 0);
    assert.ok(result.stdout.includes('success'));
    assert.equal(engine.getRoutine(r.id).state.runCount, 1);
  });

  it('status shows summary', async () => {
    engine.addRoutine({ name: 'Active', trigger: { type: 'cron' }, action: { type: 'prompt' } });
    const r2 = engine.addRoutine({ name: 'Paused', trigger: { type: 'cron' }, action: { type: 'prompt' } });
    engine.setEnabled(r2.id, false);

    const result = await reg.run('cron', ['status']);
    assert.equal(result.exitCode, 0);
    assert.ok(result.stdout.includes('Total routines: 2'));
    assert.ok(result.stdout.includes('Active: 1'));
    assert.ok(result.stdout.includes('Paused: 1'));
  });

  it('unknown subcommand returns error', async () => {
    const result = await reg.run('cron', ['foobar']);
    assert.equal(result.exitCode, 1);
    assert.ok(result.stderr.includes('Unknown subcommand'));
  });
});

// ── Add with flags ───────────────────────────────────────────────

describe('Scheduler CLI — add with flags', () => {
  let engine, reg;

  beforeEach(() => {
    engine = makeEngine();
    reg = makeRegistry();
    registerSchedulerCli(reg, () => engine, () => null);
  });

  it('add without prompt returns error', async () => {
    const result = await reg.run('cron', ['add']);
    assert.equal(result.exitCode, 1);
    assert.ok(result.stderr.includes('Missing'));
  });

  it('add --interval with invalid duration returns error', async () => {
    const result = await reg.run('cron', ['add', '--interval', 'bad', 'test']);
    assert.equal(result.exitCode, 1);
    assert.ok(result.stderr.includes('Invalid duration'));
  });
});
