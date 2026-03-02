// Run with: node --import ./web/test/_setup-globals.mjs --test web/test/clawser-sw-heartbeat.test.mjs
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import {
  SwHeartbeat,
  HEARTBEAT_CHANNEL,
  HEARTBEAT_INTERVAL_MS,
} from '../clawser-sw-heartbeat.js';

// ── Constants ───────────────────────────────────────────────────

describe('Constants', () => {
  it('HEARTBEAT_CHANNEL is a string', () => {
    assert.equal(typeof HEARTBEAT_CHANNEL, 'string');
    assert.ok(HEARTBEAT_CHANNEL.length > 0);
  });

  it('HEARTBEAT_INTERVAL_MS is a positive number', () => {
    assert.equal(typeof HEARTBEAT_INTERVAL_MS, 'number');
    assert.ok(HEARTBEAT_INTERVAL_MS > 0);
  });
});

// ── SwHeartbeat ─────────────────────────────────────────────────

describe('SwHeartbeat', () => {
  let heartbeat;

  beforeEach(() => {
    heartbeat = new SwHeartbeat();
  });

  afterEach(() => {
    heartbeat.stop();
  });

  it('constructor initializes with stopped state', () => {
    assert.equal(heartbeat.running, false);
    assert.equal(heartbeat.tickCount, 0);
  });

  it('start begins the heartbeat loop', () => {
    heartbeat.start();
    assert.equal(heartbeat.running, true);
  });

  it('start is idempotent', () => {
    heartbeat.start();
    heartbeat.start();
    assert.equal(heartbeat.running, true);
  });

  it('stop halts the heartbeat loop', () => {
    heartbeat.start();
    heartbeat.stop();
    assert.equal(heartbeat.running, false);
  });

  it('stop is safe to call when not running', () => {
    heartbeat.stop();
    assert.equal(heartbeat.running, false);
  });

  it('tick increments tickCount and calls onTick', async () => {
    let tickCalled = false;
    heartbeat.onTick = () => { tickCalled = true; };
    await heartbeat.tick();
    assert.equal(heartbeat.tickCount, 1);
    assert.equal(tickCalled, true);
  });

  it('tick broadcasts results via BroadcastChannel', async () => {
    const messages = [];
    // Override BroadcastChannel to capture messages
    const OrigBC = globalThis.BroadcastChannel;
    globalThis.BroadcastChannel = class {
      constructor(name) { this.name = name; }
      postMessage(data) { messages.push(data); }
      close() {}
    };

    const hb = new SwHeartbeat();
    await hb.tick();

    globalThis.BroadcastChannel = OrigBC;

    assert.equal(messages.length, 1);
    assert.equal(messages[0].type, 'heartbeat');
    assert.equal(typeof messages[0].timestamp, 'number');
    assert.equal(messages[0].tickCount, 1);
  });

  it('periodicSyncAvailable reflects API availability', () => {
    assert.equal(typeof heartbeat.periodicSyncAvailable, 'boolean');
    // In Node test env, periodicSync is not available
    assert.equal(heartbeat.periodicSyncAvailable, false);
  });

  it('addCheck registers a health check function', () => {
    heartbeat.addCheck('test-check', async () => ({ ok: true }));
    assert.equal(heartbeat.checkCount, 1);
  });

  it('removeCheck unregisters a health check', () => {
    heartbeat.addCheck('test-check', async () => ({ ok: true }));
    heartbeat.removeCheck('test-check');
    assert.equal(heartbeat.checkCount, 0);
  });

  it('tick runs registered checks and includes results', async () => {
    const messages = [];
    const OrigBC = globalThis.BroadcastChannel;
    globalThis.BroadcastChannel = class {
      postMessage(data) { messages.push(data); }
      close() {}
    };

    const hb = new SwHeartbeat();
    hb.addCheck('memory', async () => ({ usage: 42 }));
    hb.addCheck('scheduler', async () => ({ pendingJobs: 3 }));
    await hb.tick();

    globalThis.BroadcastChannel = OrigBC;

    assert.equal(messages.length, 1);
    assert.ok(messages[0].results);
    assert.equal(messages[0].results.memory.usage, 42);
    assert.equal(messages[0].results.scheduler.pendingJobs, 3);
  });

  it('tick handles check errors gracefully', async () => {
    const messages = [];
    const OrigBC = globalThis.BroadcastChannel;
    globalThis.BroadcastChannel = class {
      postMessage(data) { messages.push(data); }
      close() {}
    };

    const hb = new SwHeartbeat();
    hb.addCheck('broken', async () => { throw new Error('boom'); });
    await hb.tick();

    globalThis.BroadcastChannel = OrigBC;

    assert.equal(messages.length, 1);
    assert.ok(messages[0].results.broken.error);
    assert.equal(messages[0].results.broken.error, 'boom');
  });
});
