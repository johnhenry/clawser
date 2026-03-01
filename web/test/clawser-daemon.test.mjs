// Run with: node --import ./web/test/_setup-globals.mjs --test web/test/clawser-daemon.test.mjs
import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

globalThis.BrowserTool = class { constructor() {} };

import {
  DaemonPhase,
  DaemonState,
  CheckpointManager,
  TabCoordinator,
  InputLockManager,
  AgentBusyIndicator,
  WorkerProtocol,
  CrossTabToolBridge,
  HeadlessRunner,
  AwaySummaryBuilder,
  NotificationCenter,
  NativeMessageCodec,
  DaemonStatusTool,
  DaemonCheckpointTool,
} from '../clawser-daemon.js';

// ── DaemonPhase ─────────────────────────────────────────────────

describe('DaemonPhase', () => {
  it('has expected phase values', () => {
    assert.equal(DaemonPhase.STOPPED, 'stopped');
    assert.equal(DaemonPhase.STARTING, 'starting');
    assert.equal(DaemonPhase.RUNNING, 'running');
    assert.equal(DaemonPhase.CHECKPOINTING, 'checkpointing');
    assert.equal(DaemonPhase.PAUSED, 'paused');
    assert.equal(DaemonPhase.RECOVERING, 'recovering');
    assert.equal(DaemonPhase.ERROR, 'error');
  });

  it('is frozen', () => {
    assert.ok(Object.isFrozen(DaemonPhase));
  });
});

// ── DaemonState ─────────────────────────────────────────────────

describe('DaemonState', () => {
  let state;

  beforeEach(() => {
    state = new DaemonState();
  });

  it('constructor defaults to STOPPED', () => {
    assert.equal(state.phase, DaemonPhase.STOPPED);
  });

  it('transition from STOPPED to STARTING succeeds', () => {
    const ok = state.transition(DaemonPhase.STARTING);
    assert.equal(ok, true);
    assert.equal(state.phase, DaemonPhase.STARTING);
  });

  it('transition from STOPPED to RUNNING fails (invalid)', () => {
    const ok = state.transition(DaemonPhase.RUNNING);
    assert.equal(ok, false);
    assert.equal(state.phase, DaemonPhase.STOPPED);
  });

  it('isRunning returns true for RUNNING and CHECKPOINTING', () => {
    state.transition(DaemonPhase.STARTING);
    state.transition(DaemonPhase.RUNNING);
    assert.equal(state.isRunning, true);

    state.transition(DaemonPhase.CHECKPOINTING);
    assert.equal(state.isRunning, true);
  });

  it('history tracks transitions', () => {
    state.transition(DaemonPhase.STARTING);
    state.transition(DaemonPhase.RUNNING);
    const hist = state.history;
    assert.equal(hist.length, 2);
    assert.equal(hist[0].from, DaemonPhase.STOPPED);
    assert.equal(hist[0].to, DaemonPhase.STARTING);
    assert.equal(hist[1].from, DaemonPhase.STARTING);
    assert.equal(hist[1].to, DaemonPhase.RUNNING);
  });

  it('reset clears to STOPPED', () => {
    state.transition(DaemonPhase.STARTING);
    state.transition(DaemonPhase.RUNNING);
    state.reset();
    assert.equal(state.phase, DaemonPhase.STOPPED);
    assert.equal(state.history.length, 0);
  });

  it('onChange callback fires on transition', () => {
    const calls = [];
    const s = new DaemonState({ onChange: (n, o) => calls.push({ n, o }) });
    s.transition(DaemonPhase.STARTING);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].n, DaemonPhase.STARTING);
    assert.equal(calls[0].o, DaemonPhase.STOPPED);
  });
});

// ── CheckpointManager ───────────────────────────────────────────

describe('CheckpointManager', () => {
  let mgr;

  beforeEach(() => {
    mgr = new CheckpointManager();
  });

  it('constructor defaults (size=0)', () => {
    assert.equal(mgr.size, 0);
    assert.deepEqual(mgr.checkpoints, []);
  });

  it('createCheckpoint stores and returns meta with id, timestamp, reason, size', async () => {
    const meta = await mgr.createCheckpoint({ foo: 'bar' }, 'test');
    assert.ok(meta.id.startsWith('cp_'));
    assert.ok(typeof meta.timestamp === 'number');
    assert.equal(meta.reason, 'test');
    assert.ok(meta.size > 0);
    assert.equal(mgr.size, 1);
  });

  it('createCheckpoint calls writeFn', async () => {
    const written = {};
    const m = new CheckpointManager({
      writeFn: async (key, data) => { written[key] = data; },
    });
    await m.createCheckpoint({ x: 1 }, 'w');
    assert.ok('checkpoint_latest' in written);
    assert.ok('checkpoint_index' in written);
    // The specific checkpoint key also written
    const cpKeys = Object.keys(written).filter(k => k.startsWith('checkpoint_cp_'));
    assert.ok(cpKeys.length >= 1);
  });

  it('restoreLatest returns null without readFn', async () => {
    const result = await mgr.restoreLatest();
    assert.equal(result, null);
  });

  it('checkpoints returns copies', async () => {
    await mgr.createCheckpoint({ a: 1 });
    const cp = mgr.checkpoints;
    cp.push({ fake: true });
    assert.equal(mgr.checkpoints.length, 1); // original unaffected
  });

  it('deleteCheckpoint removes by id', async () => {
    const meta = await mgr.createCheckpoint({ a: 1 });
    assert.equal(mgr.size, 1);
    const deleted = await mgr.deleteCheckpoint(meta.id);
    assert.equal(deleted, true);
    assert.equal(mgr.size, 0);
  });

  it('clear empties all', async () => {
    await mgr.createCheckpoint({ a: 1 });
    await mgr.createCheckpoint({ b: 2 });
    assert.equal(mgr.size, 2);
    await mgr.clear();
    assert.equal(mgr.size, 0);
  });

  it('maxCheckpoints trims old ones', async () => {
    const m = new CheckpointManager({ maxCheckpoints: 2 });
    await m.createCheckpoint({ a: 1 }, 'first');
    await m.createCheckpoint({ b: 2 }, 'second');
    await m.createCheckpoint({ c: 3 }, 'third');
    assert.equal(m.size, 2);
    // The first checkpoint should have been trimmed
    const reasons = m.checkpoints.map(c => c.reason);
    assert.ok(!reasons.includes('first'));
    assert.ok(reasons.includes('second'));
    assert.ok(reasons.includes('third'));
  });
});

// ── TabCoordinator ──────────────────────────────────────────────

describe('TabCoordinator', () => {
  let coord;

  beforeEach(() => {
    const ch = { postMessage() {}, close() {}, onmessage: null };
    coord = new TabCoordinator({ channel: ch });
  });

  it('constructor generates tabId', () => {
    assert.ok(coord.tabId.startsWith('tab_'));
  });

  it('tabCount starts at 1 (self)', () => {
    assert.equal(coord.tabCount, 1);
  });

  it('activeTabs includes self', () => {
    const tabs = coord.activeTabs;
    assert.equal(tabs.length, 1);
    assert.equal(tabs[0].tabId, coord.tabId);
  });

  it('stop clears tabs', () => {
    coord.stop();
    // After stop, only self remains (tabs map cleared, but activeTabs still shows self)
    assert.equal(coord.tabCount, 1);
  });
});

// ── InputLockManager ────────────────────────────────────────────

describe('InputLockManager', () => {
  let lock;
  let savedLocks;

  beforeEach(() => {
    // Force in-memory fallback by hiding navigator.locks
    savedLocks = navigator.locks;
    Object.defineProperty(navigator, 'locks', { value: undefined, configurable: true });
    lock = new InputLockManager();
  });

  it('tryAcquire returns {acquired: true} first time', async (t) => {
    t.after(() => Object.defineProperty(navigator, 'locks', { value: savedLocks, configurable: true }));
    const result = await lock.tryAcquire('test-resource');
    assert.equal(result.acquired, true);
  });

  it('tryAcquire returns {acquired: false} when already held', async (t) => {
    t.after(() => Object.defineProperty(navigator, 'locks', { value: savedLocks, configurable: true }));
    await lock.tryAcquire('res');
    const result = await lock.tryAcquire('res');
    assert.equal(result.acquired, false);
  });

  it('release allows re-acquire', async (t) => {
    t.after(() => Object.defineProperty(navigator, 'locks', { value: savedLocks, configurable: true }));
    await lock.tryAcquire('res');
    lock.release('res');
    const result = await lock.tryAcquire('res');
    assert.equal(result.acquired, true);
  });

  it('isHeld returns correct state', async (t) => {
    t.after(() => Object.defineProperty(navigator, 'locks', { value: savedLocks, configurable: true }));
    assert.equal(lock.isHeld('res'), false);
    await lock.tryAcquire('res');
    assert.equal(lock.isHeld('res'), true);
    lock.release('res');
    assert.equal(lock.isHeld('res'), false);
  });
});

// ── AgentBusyIndicator ──────────────────────────────────────────

describe('AgentBusyIndicator', () => {
  let indicator;

  beforeEach(() => {
    const ch = { postMessage() {}, close() {} };
    indicator = new AgentBusyIndicator({ channel: ch });
  });

  it('isBusy defaults to false', () => {
    assert.equal(indicator.isBusy, false);
  });

  it('setBusy(true) changes state', () => {
    indicator.setBusy(true, 'processing');
    assert.equal(indicator.isBusy, true);
    assert.equal(indicator.reason, 'processing');
  });

  it('setBusy(false) clears reason', () => {
    indicator.setBusy(true, 'working');
    indicator.setBusy(false);
    assert.equal(indicator.isBusy, false);
    assert.equal(indicator.reason, '');
  });

  it('status returns {busy, reason, since}', () => {
    indicator.setBusy(true, 'test');
    const s = indicator.status();
    assert.equal(s.busy, true);
    assert.equal(s.reason, 'test');
    assert.ok(typeof s.since === 'number');
    assert.ok(s.since > 0);
  });
});

// ── WorkerProtocol ──────────────────────────────────────────────

describe('WorkerProtocol', () => {
  it('encode returns {type, payload, id, timestamp}', () => {
    const msg = WorkerProtocol.encode('user_message', { text: 'hi' });
    assert.equal(msg.type, 'user_message');
    assert.deepEqual(msg.payload, { text: 'hi' });
    assert.ok(typeof msg.id === 'string');
    assert.ok(typeof msg.timestamp === 'number');
  });

  it('decode extracts fields', () => {
    const original = WorkerProtocol.encode('state', { phase: 'running' });
    const decoded = WorkerProtocol.decode(original);
    assert.equal(decoded.type, 'state');
    assert.deepEqual(decoded.payload, { phase: 'running' });
    assert.equal(decoded.id, original.id);
    assert.equal(decoded.timestamp, original.timestamp);
  });

  it('isValid returns true for valid message types', () => {
    assert.equal(WorkerProtocol.isValid({ type: 'user_message' }), true);
    assert.equal(WorkerProtocol.isValid({ type: 'stream_chunk' }), true);
    assert.equal(WorkerProtocol.isValid({ type: 'heartbeat' }), true);
    assert.equal(WorkerProtocol.isValid({ type: 'error' }), true);
  });

  it('isValid returns false for invalid types', () => {
    assert.equal(WorkerProtocol.isValid({ type: 'bogus' }), false);
    assert.equal(WorkerProtocol.isValid(null), false);
    assert.equal(WorkerProtocol.isValid('string'), false);
    assert.equal(WorkerProtocol.isValid({}), false);
  });
});

// ── CrossTabToolBridge ──────────────────────────────────────────

describe('CrossTabToolBridge', () => {
  let bridge;

  beforeEach(() => {
    const ch = { postMessage() {}, close() {} };
    bridge = new CrossTabToolBridge({ channel: ch });
  });

  it('registerTool + listTools', () => {
    bridge.registerTool('ping', async () => ({ success: true, output: 'pong' }));
    assert.deepEqual(bridge.listTools(), ['ping']);
  });

  it('invoke returns result from registered tool', async () => {
    bridge.registerTool('echo', async (args) => ({ success: true, output: args.msg }));
    const result = await bridge.invoke('echo', { msg: 'hello' });
    assert.equal(result.success, true);
    assert.equal(result.output, 'hello');
  });

  it('invoke returns error for unknown tool', async () => {
    const result = await bridge.invoke('nonexistent', {});
    assert.equal(result.success, false);
    assert.ok(result.error.includes('not found'));
  });

  it('unregisterTool removes', () => {
    bridge.registerTool('temp', async () => ({ success: true, output: '' }));
    assert.deepEqual(bridge.listTools(), ['temp']);
    bridge.unregisterTool('temp');
    assert.deepEqual(bridge.listTools(), []);
  });
});

// ── HeadlessRunner ──────────────────────────────────────────────

describe('HeadlessRunner', () => {
  it('loadCheckpoint returns null without data', async () => {
    const runner = new HeadlessRunner({ readFn: async () => null });
    const result = await runner.loadCheckpoint();
    assert.equal(result, null);
  });

  it('runFromCheckpoint processes jobs', async () => {
    const executed = [];
    const runner = new HeadlessRunner({
      readFn: async (key) => {
        if (key === 'checkpoint_latest') {
          return { pendingJobs: [{ id: 'j1' }, { id: 'j2' }] };
        }
        return null;
      },
      writeFn: async () => {},
      executeFn: async (job) => {
        executed.push(job.id);
        return { success: true };
      },
    });
    const result = await runner.runFromCheckpoint();
    assert.equal(result.executed, 2);
    assert.deepEqual(executed, ['j1', 'j2']);
    assert.equal(result.results.length, 2);
  });
});

// ── AwaySummaryBuilder ──────────────────────────────────────────

describe('AwaySummaryBuilder', () => {
  let builder;

  beforeEach(() => {
    builder = new AwaySummaryBuilder();
  });

  it('addEvent increases eventCount', () => {
    assert.equal(builder.eventCount, 0);
    builder.addEvent({ type: 'message', timestamp: Date.now() });
    assert.equal(builder.eventCount, 1);
  });

  it('build returns text summary', () => {
    builder.addEvent({ type: 'message', timestamp: Date.now() });
    builder.addEvent({ type: 'tool_call', timestamp: Date.now() });
    builder.addEvent({ type: 'message', timestamp: Date.now() });
    const summary = builder.build();
    assert.ok(summary.text.includes('3 events'));
    assert.ok(summary.text.includes('message: 2'));
    assert.ok(summary.text.includes('tool_call: 1'));
    assert.equal(summary.events.length, 3);
  });

  it('build with since filters events', () => {
    const past = Date.now() - 10000;
    const now = Date.now();
    builder.addEvent({ type: 'old', timestamp: past });
    builder.addEvent({ type: 'new', timestamp: now });
    const summary = builder.build({ since: now - 1 });
    assert.equal(summary.events.length, 1);
    assert.equal(summary.events[0].type, 'new');
  });

  it('build returns "No activity" for empty', () => {
    const summary = builder.build();
    assert.ok(summary.text.includes('No activity'));
    assert.equal(summary.events.length, 0);
  });

  it('clear resets', () => {
    builder.addEvent({ type: 'x', timestamp: Date.now() });
    builder.clear();
    assert.equal(builder.eventCount, 0);
  });
});

// ── NotificationCenter ──────────────────────────────────────────

describe('NotificationCenter', () => {
  let center;

  beforeEach(() => {
    center = new NotificationCenter();
  });

  it('add returns id', () => {
    const id = center.add({ type: 'info', title: 'Test', message: 'Hello' });
    assert.ok(typeof id === 'number');
    assert.equal(center.count, 1);
  });

  it('list returns newest first', () => {
    center.add({ title: 'First', message: 'a' });
    center.add({ title: 'Second', message: 'b' });
    const list = center.list();
    assert.equal(list[0].title, 'Second');
    assert.equal(list[1].title, 'First');
  });

  it('markRead marks notification', () => {
    const id = center.add({ title: 'T', message: 'm' });
    assert.equal(center.unreadCount, 1);
    center.markRead(id);
    assert.equal(center.unreadCount, 0);
  });

  it('markAllRead marks all', () => {
    center.add({ title: 'A', message: 'a' });
    center.add({ title: 'B', message: 'b' });
    assert.equal(center.unreadCount, 2);
    center.markAllRead();
    assert.equal(center.unreadCount, 0);
  });

  it('unreadCount tracks unread', () => {
    center.add({ title: 'A', message: '1' });
    center.add({ title: 'B', message: '2' });
    assert.equal(center.unreadCount, 2);
    center.markRead(1);
    assert.equal(center.unreadCount, 1);
  });

  it('remove deletes by id', () => {
    const id = center.add({ title: 'X', message: 'x' });
    assert.equal(center.count, 1);
    center.remove(id);
    assert.equal(center.count, 0);
  });

  it('clear empties all', () => {
    center.add({ title: 'A', message: 'a' });
    center.add({ title: 'B', message: 'b' });
    center.clear();
    assert.equal(center.count, 0);
    assert.equal(center.unreadCount, 0);
  });
});

// ── NativeMessageCodec ──────────────────────────────────────────

describe('NativeMessageCodec', () => {
  it('encode returns Uint8Array with length prefix', () => {
    const encoded = NativeMessageCodec.encode({ hello: 'world' });
    assert.ok(encoded instanceof Uint8Array);
    assert.ok(encoded.length > 4);
    // First 4 bytes are the length prefix (little-endian)
    const bodyLen = encoded[0] | (encoded[1] << 8) | (encoded[2] << 16) | (encoded[3] << 24);
    assert.equal(bodyLen, encoded.length - 4);
  });

  it('decode round-trips with encode', () => {
    const original = { type: 'test', data: [1, 2, 3] };
    const encoded = NativeMessageCodec.encode(original);
    const decoded = NativeMessageCodec.decode(encoded);
    assert.deepEqual(decoded, original);
  });

  it('decode throws for too-short data', () => {
    assert.throws(() => NativeMessageCodec.decode(new Uint8Array([1, 2])), /too short/);
    assert.throws(() => NativeMessageCodec.decode(null), /too short/);
  });
});
