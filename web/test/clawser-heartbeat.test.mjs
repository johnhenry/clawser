// Run with: node --import ./web/test/_setup-globals.mjs --test web/test/clawser-heartbeat.test.mjs
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

// Stub BrowserTool before import
globalThis.BrowserTool = class { constructor() {} };

import {
  INTERVAL_WAKE,
  DEFAULT_HEARTBEAT,
  parseChecklist,
  ALERT_STRATEGIES,
  HeartbeatRunner,
} from '../clawser-heartbeat.js';

// ── parseChecklist ──────────────────────────────────────────────

describe('parseChecklist', () => {
  it('parses DEFAULT_HEARTBEAT into check items', () => {
    const checks = parseChecklist(DEFAULT_HEARTBEAT);
    assert.ok(checks.length >= 5);
  });

  it('parses minute intervals', () => {
    const checks = parseChecklist('## Every 5 minutes\n- [ ] Check A');
    assert.equal(checks.length, 1);
    assert.equal(checks[0].interval, 5 * 60_000);
    assert.equal(checks[0].description, 'Check A');
  });

  it('parses hour intervals', () => {
    const checks = parseChecklist('## Every 1 hour\n- [ ] Check B');
    assert.equal(checks.length, 1);
    assert.equal(checks[0].interval, 60 * 60_000);
  });

  it('parses "On wake" interval', () => {
    const checks = parseChecklist('## On wake\n- [ ] Provider reachable');
    assert.equal(checks.length, 1);
    assert.equal(checks[0].interval, INTERVAL_WAKE);
  });

  it('parses code annotations', () => {
    const checks = parseChecklist('## Every 5 minutes\n- [ ] Check → `isHealthy()`');
    assert.equal(checks[0].code, 'isHealthy()');
  });

  it('returns empty for null code when not present', () => {
    const checks = parseChecklist('## Every 5 minutes\n- [ ] Simple check');
    assert.equal(checks[0].code, null);
  });

  it('handles empty input', () => {
    assert.deepEqual(parseChecklist(''), []);
  });

  it('initializes check metadata', () => {
    const checks = parseChecklist('## Every 5 minutes\n- [ ] Test');
    assert.equal(checks[0].lastRun, null);
    assert.equal(checks[0].lastResult, null);
    assert.equal(checks[0].consecutiveFailures, 0);
  });
});

// ── ALERT_STRATEGIES ────────────────────────────────────────────

describe('ALERT_STRATEGIES', () => {
  it('format returns formatted failure summary', () => {
    const failures = [
      { description: 'Check A', consecutiveFailures: 3 },
      { description: 'Check B', consecutiveFailures: 1 },
    ];
    const msg = ALERT_STRATEGIES.format(failures);
    assert.ok(msg.includes('Check A'));
    assert.ok(msg.includes('3x'));
    assert.ok(msg.includes('Check B'));
  });

  it('log does not throw', () => {
    const failures = [{ description: 'Test', error: 'oops' }];
    assert.doesNotThrow(() => ALERT_STRATEGIES.log(failures));
  });
});

// ── HeartbeatRunner ─────────────────────────────────────────────

describe('HeartbeatRunner', () => {
  let runner;

  beforeEach(() => {
    runner = new HeartbeatRunner();
  });

  afterEach(() => { runner.stop(); });

  it('constructor defaults', () => {
    assert.equal(runner.running, false);
    assert.equal(runner.checkCount, 0);
  });

  it('loadChecklist parses and registers checks', () => {
    // Use "On wake" to avoid setInterval timers
    runner.loadChecklist('## On wake\n- [ ] Check A\n- [ ] Check B');
    assert.equal(runner.checkCount, 2);
    assert.equal(runner.running, true);
  });

  it('status returns check status array', () => {
    runner.loadChecklist('## On wake\n- [ ] Test');
    const status = runner.status;
    assert.equal(status.length, 1);
    assert.equal(status[0].description, 'Test');
    assert.equal(status[0].passed, null); // not run yet
  });

  it('stop() stops the runner', () => {
    runner.loadChecklist('## On wake\n- [ ] X');
    runner.stop();
    assert.equal(runner.running, false);
  });

  it('clear() removes all checks', () => {
    runner.loadChecklist('## On wake\n- [ ] X');
    runner.clear();
    assert.equal(runner.checkCount, 0);
    assert.equal(runner.running, false);
  });

  it('runAll with no evalFn treats all as passed', async () => {
    runner.loadChecklist('## On wake\n- [ ] Auto-pass');
    const failures = await runner.runAll();
    assert.equal(failures.length, 0);
  });

  it('runAll with evalFn that returns false reports failures', async () => {
    runner = new HeartbeatRunner({
      evalFn: async () => false,
      onAlert: () => {},
    });
    runner.loadChecklist('## On wake\n- [ ] Fail check → `fail()`');
    const failures = await runner.runAll();
    assert.equal(failures.length, 1);
  });

  it('checks getter returns copies', () => {
    runner.loadChecklist('## On wake\n- [ ] Copy test');
    const checks = runner.checks;
    assert.equal(checks.length, 1);
    assert.equal(checks[0].description, 'Copy test');
  });
});
