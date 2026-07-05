// Run with: node --import ./web/test/_setup-globals.mjs --test web/test/clawser-daemon.test.mjs
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

globalThis.BrowserTool = class { constructor() {} };

import {
  DaemonPhase,
  DaemonState,
  DaemonController,
  CheckpointManager,
  TabCoordinator,
  InputLockManager,
  AgentBusyIndicator,
  /* CrossTabToolBridge — deleted 2026-05-06 (unused orphan) */
  WorkerProtocol,
  HeadlessRunner,
  AwaySummaryBuilder,
  NotificationCenter,
  NativeMessageCodec,
  DaemonStatusTool,
  DaemonCheckpointTool,
  DaemonPauseTool,
  DaemonResumeTool,
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

  it('isLeader: only one of two coordinators wins, and it is the older one', () => {
    // Build a paired BroadcastChannel mock so two coordinators can talk.
    const subA = []; const subB = [];
    const chA = {
      postMessage(msg) { for (const fn of subB) fn({ data: msg }); },
      close() {}, set onmessage(fn) { subA.push(fn); },
    };
    const chB = {
      postMessage(msg) { for (const fn of subA) fn({ data: msg }); },
      close() {}, set onmessage(fn) { subB.push(fn); },
    };
    const oldCoord = new TabCoordinator({ channel: chA });
    // Force a deterministic earlier joinedAt for `oldCoord` by reaching
    // through to the private field via the broadcast contract instead:
    // run start() so broadcasts go out, then a fresh coordinator joins.
    oldCoord.start();
    // sleep-ish: spin Date.now forward a hair to ensure a different ts
    const newCoord = new TabCoordinator({ channel: chB });
    newCoord.start();
    // Both should now have learned of each other via the swap.
    assert.equal(oldCoord.isLeader, true, 'older coordinator wins');
    assert.equal(newCoord.isLeader, false, 'newer coordinator does NOT also claim leader');
    oldCoord.stop();
    newCoord.stop();
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

  afterEach(() => {
    // setBusy(true) starts a keepalive setInterval — without this the
    // interval outlives the test and blocks the process from exiting.
    indicator.close();
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

  it('subscribe receives remote-tab busy state via paired channel', () => {
    // Build a paired BroadcastChannel mock so two indicators talk.
    let aHandler = null;
    let bHandler = null;
    const chA = {
      postMessage(msg) { if (bHandler) bHandler({ data: msg }); },
      close() {}, set onmessage(fn) { aHandler = fn; },
    };
    const chB = {
      postMessage(msg) { if (aHandler) aHandler({ data: msg }); },
      close() {}, set onmessage(fn) { bHandler = fn; },
    };
    const a = new AgentBusyIndicator({ channel: chA });
    const b = new AgentBusyIndicator({ channel: chB });
    const events = [];
    b.subscribe((e) => events.push(e));
    a.setBusy(true, 'thinking');
    assert.equal(events.length, 1);
    assert.equal(events[0].busy, true);
    assert.equal(events[0].reason, 'thinking');
    assert.equal(events[0].tabId, a.tabId);
    assert.equal(b.isAnyPeerBusy(), true);
    a.setBusy(false);
    assert.equal(events.length, 2);
    assert.equal(events[1].busy, false);
    assert.equal(b.isAnyPeerBusy(), false);
    a.close();
    b.close();
  });

  it('peerStates() returns a snapshot of remote tabs', () => {
    let aHandler = null;
    let bHandler = null;
    const chA = {
      postMessage(msg) { if (bHandler) bHandler({ data: msg }); },
      close() {}, set onmessage(fn) { aHandler = fn; },
    };
    const chB = {
      postMessage(msg) { if (aHandler) aHandler({ data: msg }); },
      close() {}, set onmessage(fn) { bHandler = fn; },
    };
    const a = new AgentBusyIndicator({ channel: chA });
    const b = new AgentBusyIndicator({ channel: chB });
    a.setBusy(true, 'r1');
    const peers = b.peerStates();
    assert.equal(peers.length, 1);
    assert.equal(peers[0].tabId, a.tabId);
    assert.equal(peers[0].busy, true);
    a.close();
    b.close();
  });

  it('ignores echoes of own broadcasts (tabId match)', () => {
    // BroadcastChannel doesn't deliver to sender, but the unit test
    // can simulate an explicit echo and verify the guard.
    let handler = null;
    const ch = {
      postMessage() {},
      close() {},
      set onmessage(fn) { handler = fn; },
    };
    const ind = new AgentBusyIndicator({ channel: ch });
    let called = 0;
    ind.subscribe(() => called++);
    handler({ data: { type: 'agent_busy', tabId: ind.tabId, busy: true, reason: 'self', since: 1 } });
    assert.equal(called, 0, 'self-message must be ignored');
    ind.close();
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

// CrossTabToolBridge tests removed 2026-05-06 — class was deleted as
// an unused orphan with a half-implemented receive side. See the
// note in clawser-daemon.js where the export used to live.

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

// ── DaemonController pause/resume ────────────────────────────────

describe('DaemonController pause/resume', () => {
  /** Helper: create a started controller. */
  async function makeRunning(opts = {}) {
    const state = new DaemonState();
    const ctrl = new DaemonController({
      state,
      checkpoints: new CheckpointManager(),
      autoCheckpointMs: opts.autoCheckpointMs ?? 0,
      getStateFn: opts.getStateFn || (() => ({ test: true })),
    });
    await ctrl.start();
    return ctrl;
  }

  it('pause transitions RUNNING → PAUSED', async () => {
    const ctrl = await makeRunning();
    const ok = await ctrl.pause();
    assert.equal(ok, true);
    assert.equal(ctrl.phase, DaemonPhase.PAUSED);
  });

  it('pause fails from STOPPED', async () => {
    const ctrl = new DaemonController();
    const ok = await ctrl.pause();
    assert.equal(ok, false);
    assert.equal(ctrl.phase, DaemonPhase.STOPPED);
  });

  it('resume transitions PAUSED → RUNNING', async () => {
    const ctrl = await makeRunning();
    await ctrl.pause();
    assert.equal(ctrl.phase, DaemonPhase.PAUSED);
    const ok = await ctrl.resume();
    assert.equal(ok, true);
    assert.equal(ctrl.phase, DaemonPhase.RUNNING);
  });

  it('resume fails from STOPPED', async () => {
    const ctrl = new DaemonController();
    const ok = await ctrl.resume();
    assert.equal(ok, false);
    assert.equal(ctrl.phase, DaemonPhase.STOPPED);
  });

  it('resume fails from RUNNING (already running)', async () => {
    const ctrl = await makeRunning();
    const ok = await ctrl.resume();
    assert.equal(ok, false);
    assert.equal(ctrl.phase, DaemonPhase.RUNNING);
  });

  it('pause → resume round-trip preserves state', async () => {
    const ctrl = await makeRunning();
    assert.equal(ctrl.isRunning, true);
    await ctrl.pause();
    assert.equal(ctrl.isRunning, false);
    await ctrl.resume();
    assert.equal(ctrl.isRunning, true);
  });

  it('pause stops auto-checkpoint interval', async () => {
    let checkpointCount = 0;
    const ctrl = await makeRunning({
      autoCheckpointMs: 50,
      getStateFn: () => {
        checkpointCount++;
        return {};
      },
    });
    await ctrl.pause();
    const countAtPause = checkpointCount;
    // Wait to ensure no more auto-checkpoints fire
    await new Promise(r => setTimeout(r, 120));
    assert.equal(checkpointCount, countAtPause);
    await ctrl.stop();
  });

  it('stop works from PAUSED state', async () => {
    const ctrl = await makeRunning();
    await ctrl.pause();
    const ok = await ctrl.stop();
    assert.equal(ok, true);
    assert.equal(ctrl.phase, DaemonPhase.STOPPED);
  });

  it('onChange callback fires for pause and resume transitions', async () => {
    const transitions = [];
    const state = new DaemonState({
      onChange: (newP, oldP) => transitions.push({ from: oldP, to: newP }),
    });
    const ctrl = new DaemonController({
      state,
      checkpoints: new CheckpointManager(),
      autoCheckpointMs: 0,
    });
    await ctrl.start();
    await ctrl.pause();
    await ctrl.resume();

    // Expect: STOPPED→STARTING, STARTING→RUNNING, RUNNING→PAUSED, PAUSED→RUNNING
    assert.equal(transitions.length, 4);
    assert.equal(transitions[2].from, DaemonPhase.RUNNING);
    assert.equal(transitions[2].to, DaemonPhase.PAUSED);
    assert.equal(transitions[3].from, DaemonPhase.PAUSED);
    assert.equal(transitions[3].to, DaemonPhase.RUNNING);
  });
});

// ── DaemonPauseTool ─────────────────────────────────────────────

describe('DaemonPauseTool', () => {
  async function makeRunningController() {
    const ctrl = new DaemonController({
      state: new DaemonState(),
      checkpoints: new CheckpointManager(),
      autoCheckpointMs: 0,
    });
    await ctrl.start();
    return ctrl;
  }

  it('has correct name and permission', () => {
    const tool = new DaemonPauseTool(new DaemonController());
    assert.equal(tool.name, 'daemon_pause');
    assert.equal(tool.permission, 'approve');
  });

  it('has description', () => {
    const tool = new DaemonPauseTool(new DaemonController());
    assert.ok(tool.description.length > 0);
  });

  it('pauses a running daemon', async () => {
    const ctrl = await makeRunningController();
    const tool = new DaemonPauseTool(ctrl);
    const result = await tool.execute();
    assert.equal(result.success, true);
    assert.ok(result.output.includes('paused'));
    assert.equal(ctrl.phase, DaemonPhase.PAUSED);
  });

  it('returns error when not in RUNNING phase', async () => {
    const ctrl = new DaemonController();
    const tool = new DaemonPauseTool(ctrl);
    const result = await tool.execute();
    assert.equal(result.success, false);
    assert.ok(result.error.includes('Cannot pause'));
  });
});

// ── DaemonResumeTool ────────────────────────────────────────────

describe('DaemonResumeTool', () => {
  async function makeRunningController() {
    const ctrl = new DaemonController({
      state: new DaemonState(),
      checkpoints: new CheckpointManager(),
      autoCheckpointMs: 0,
    });
    await ctrl.start();
    return ctrl;
  }

  it('has correct name and permission', () => {
    const tool = new DaemonResumeTool(new DaemonController());
    assert.equal(tool.name, 'daemon_resume');
    assert.equal(tool.permission, 'approve');
  });

  it('has description', () => {
    const tool = new DaemonResumeTool(new DaemonController());
    assert.ok(tool.description.length > 0);
  });

  it('resumes a paused daemon', async () => {
    const ctrl = await makeRunningController();
    await ctrl.pause();
    const tool = new DaemonResumeTool(ctrl);
    const result = await tool.execute();
    assert.equal(result.success, true);
    assert.ok(result.output.includes('resumed'));
    assert.equal(ctrl.phase, DaemonPhase.RUNNING);
  });

  it('returns error when not in PAUSED phase', async () => {
    const ctrl = new DaemonController();
    const tool = new DaemonResumeTool(ctrl);
    const result = await tool.execute();
    assert.equal(result.success, false);
    assert.ok(result.error.includes('Cannot resume'));
  });
});

// ── AgentBusyIndicator keepalive (long-run pruning fix) ──────────

describe('AgentBusyIndicator keepalive', () => {
  const pair = () => {
    let aHandler = null, bHandler = null;
    const chA = {
      postMessage(msg) { if (bHandler) bHandler({ data: msg }); },
      close() {}, set onmessage(fn) { aHandler = fn; },
    };
    const chB = {
      postMessage(msg) { if (aHandler) aHandler({ data: msg }); },
      close() {}, set onmessage(fn) { bHandler = fn; },
    };
    return [chA, chB];
  };

  it('re-broadcasts while busy so long runs survive peer pruning', async () => {
    const [chA, chB] = pair();
    // staleMs=90 → prune interval ~500ms floor... keepalive floor is 500 too;
    // use large-enough windows: staleMs=1500 → keepalive every 500ms,
    // prune checks every 500ms. Busy run of ~1.2s must NOT be pruned.
    const a = new AgentBusyIndicator({ channel: chA, staleMs: 1500 });
    const b = new AgentBusyIndicator({ channel: chB, staleMs: 1500 });
    const events = [];
    b.subscribe((e) => events.push(e));

    a.setBusy(true, 'long run');
    await new Promise(r => setTimeout(r, 1200));

    assert.equal(b.isAnyPeerBusy(), true, 'peer still busy after > 2 keepalive intervals');
    assert.ok(!events.some(e => e.pruned), 'peer must not be pruned while keepalives flow');
    // Keepalives are change-deduped: exactly one busy notification
    assert.equal(events.filter(e => e.busy).length, 1);

    a.setBusy(false);
    assert.equal(b.isAnyPeerBusy(), false);
    a.close();
    b.close();
  });

  it('keepalive timer stops on setBusy(false) and close()', () => {
    const sent = [];
    const ch = { postMessage(m) { sent.push(m); }, close() {} };
    const a = new AgentBusyIndicator({ channel: ch, staleMs: 1500 });
    a.setBusy(true, 'x');
    a.setBusy(false);
    a.close(); // must clear all timers — test runner hangs otherwise
    assert.equal(sent.length, 2);
  });
});
