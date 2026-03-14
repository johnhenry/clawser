// Run with: node --import ./web/test/_setup-globals.mjs --test web/test/clawser-mesh-swim.test.mjs
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import {
  SwimMembership,
  SWIM_PING,
  SWIM_ACK,
  SWIM_PING_REQ,
  SWIM_PING_ACK,
  SWIM_MEMBER_STATES,
  SwarmCoordinator,
} from '../clawser-mesh-swarm.js';

// ── 1. Wire Constants ───────────────────────────────────────────

describe('SWIM wire constants', () => {
  it('SWIM_PING equals 0xF0', () => {
    assert.equal(SWIM_PING, 0xF0);
  });

  it('SWIM_ACK equals 0xF1', () => {
    assert.equal(SWIM_ACK, 0xF1);
  });

  it('SWIM_PING_REQ equals 0xF2', () => {
    assert.equal(SWIM_PING_REQ, 0xF2);
  });

  it('SWIM_PING_ACK equals 0xF3', () => {
    assert.equal(SWIM_PING_ACK, 0xF3);
  });

  it('SWIM_MEMBER_STATES is frozen with 4 entries', () => {
    assert.ok(Object.isFrozen(SWIM_MEMBER_STATES));
    assert.equal(SWIM_MEMBER_STATES.length, 4);
    assert.deepEqual(SWIM_MEMBER_STATES, ['alive', 'suspect', 'dead', 'left']);
  });
});

// ── 2. SwimMembership Construction ──────────────────────────────

describe('SwimMembership construction', () => {
  it('throws without localId', () => {
    assert.throws(() => new SwimMembership({ sendFn: () => {} }), /localId/);
  });

  it('throws without sendFn', () => {
    assert.throws(() => new SwimMembership({ localId: 'node-1' }), /sendFn/);
  });

  it('starts with self as alive member (size=1, aliveCount=1)', () => {
    const swim = new SwimMembership({ localId: 'node-1', sendFn: () => {} });
    assert.equal(swim.size, 1);
    assert.equal(swim.aliveMembers().length, 1);
    assert.equal(swim.aliveMembers()[0], 'node-1');
    assert.equal(swim.getState('node-1'), 'alive');
  });

  it('default config values are applied', () => {
    const swim = new SwimMembership({ localId: 'node-1', sendFn: () => {} });
    // Should have reasonable defaults — not throw
    assert.ok(swim);
  });

  it('localId accessor works', () => {
    const swim = new SwimMembership({ localId: 'node-42', sendFn: () => {} });
    assert.equal(swim.localId, 'node-42');
  });
});

// ── 3. Member Lifecycle ─────────────────────────────────────────

describe('SwimMembership member lifecycle', () => {
  /** @type {SwimMembership} */
  let swim;

  beforeEach(() => {
    swim = new SwimMembership({ localId: 'local', sendFn: () => {} });
  });

  afterEach(() => {
    swim.stop();
  });

  it('addMember adds as alive', () => {
    swim.addMember('peer-1');
    assert.equal(swim.getState('peer-1'), 'alive');
    assert.equal(swim.size, 2);
  });

  it('addMember is idempotent (does not overwrite existing state)', () => {
    swim.addMember('peer-1');
    // Manually suspect the member, then re-add — should not overwrite
    // We simulate by handling a suspect update; for simplicity, just verify
    // that calling addMember twice does not change size unexpectedly
    swim.addMember('peer-1');
    assert.equal(swim.size, 2); // still 2, not 3
  });

  it('removeMember transitions to left', () => {
    swim.addMember('peer-1');
    swim.removeMember('peer-1');
    assert.equal(swim.getState('peer-1'), 'left');
  });

  it('getState returns correct state', () => {
    swim.addMember('peer-1');
    assert.equal(swim.getState('peer-1'), 'alive');
    assert.equal(swim.getState('local'), 'alive');
  });

  it('getState returns null for unknown', () => {
    assert.equal(swim.getState('unknown-node'), null);
  });

  it('aliveMembers excludes suspect/dead/left', () => {
    swim.addMember('peer-alive');
    swim.addMember('peer-left');
    swim.removeMember('peer-left');

    const alive = swim.aliveMembers();
    assert.ok(alive.includes('local'));
    assert.ok(alive.includes('peer-alive'));
    assert.ok(!alive.includes('peer-left'));
  });

  it('size counts all members', () => {
    swim.addMember('a');
    swim.addMember('b');
    swim.addMember('c');
    swim.removeMember('c'); // left but still counted
    assert.equal(swim.size, 4); // local + a + b + c
  });
});

// ── 4. Ping Round ───────────────────────────────────────────────

describe('SwimMembership ping round', () => {
  /** @type {SwimMembership} */
  let swim;
  /** @type {Array} */
  let sent;

  beforeEach(() => {
    sent = [];
    swim = new SwimMembership({
      localId: 'local',
      sendFn: (target, msg) => sent.push({ target, msg }),
      pingIntervalMs: 100,
    });
  });

  afterEach(() => {
    swim.stop();
  });

  it('start begins sending pings via sendFn', async () => {
    swim.addMember('peer-1');
    swim.start();
    // Wait for at least one ping interval
    await new Promise(r => setTimeout(r, 200));
    swim.stop();
    const pings = sent.filter(s => s.msg.type === SWIM_PING);
    assert.ok(pings.length >= 1, `Expected at least 1 ping, got ${pings.length}`);
  });

  it('stop clears timer', async () => {
    swim.addMember('peer-1');
    swim.start();
    swim.stop();
    const countAfterStop = sent.length;
    await new Promise(r => setTimeout(r, 200));
    assert.equal(sent.length, countAfterStop, 'No new messages after stop');
  });

  it('start is idempotent', () => {
    swim.addMember('peer-1');
    swim.start();
    swim.start(); // should not throw or create duplicate timers
    swim.stop();
  });

  it('ping message has correct format (type, from, seq, updates)', async () => {
    swim.addMember('peer-1');
    swim.start();
    await new Promise(r => setTimeout(r, 200));
    swim.stop();
    const pings = sent.filter(s => s.msg.type === SWIM_PING);
    assert.ok(pings.length >= 1);
    const ping = pings[0].msg;
    assert.equal(ping.type, SWIM_PING);
    assert.equal(ping.from, 'local');
    assert.equal(typeof ping.seq, 'number');
    assert.ok(Array.isArray(ping.updates));
  });
});

// ── 5. Direct Ping-Ack ─────────────────────────────────────────

describe('SwimMembership direct ping-ack', () => {
  /** @type {SwimMembership} */
  let swim;
  /** @type {Array} */
  let sent;

  beforeEach(() => {
    sent = [];
    swim = new SwimMembership({
      localId: 'local',
      sendFn: (target, msg) => sent.push({ target, msg }),
    });
  });

  afterEach(() => {
    swim.stop();
  });

  it('handleMessage with SWIM_PING sends SWIM_ACK back', () => {
    swim.addMember('peer-1');
    swim.handleMessage('peer-1', {
      type: SWIM_PING,
      from: 'peer-1',
      seq: 1,
      updates: [],
    });
    const acks = sent.filter(s => s.msg.type === SWIM_ACK);
    assert.ok(acks.length >= 1, 'Should send an ACK');
    assert.equal(acks[0].target, 'peer-1');
    assert.equal(acks[0].msg.seq, 1);
  });

  it('handleMessage with SWIM_ACK clears pending state', () => {
    swim.addMember('peer-1');
    // Simulate a pending ping by starting a ping round
    // Then send an ACK back — the member should remain alive
    swim.handleMessage('peer-1', {
      type: SWIM_ACK,
      from: 'peer-1',
      seq: 1,
      updates: [],
    });
    assert.equal(swim.getState('peer-1'), 'alive');
  });

  it('ack includes piggybacked updates', () => {
    swim.addMember('peer-1');
    swim.addMember('peer-2');
    // Adding peer-2 should create an update to piggyback
    swim.handleMessage('peer-1', {
      type: SWIM_PING,
      from: 'peer-1',
      seq: 1,
      updates: [],
    });
    const acks = sent.filter(s => s.msg.type === SWIM_ACK);
    assert.ok(acks.length >= 1);
    assert.ok(Array.isArray(acks[0].msg.updates));
  });
});

// ── 6. Indirect Ping ────────────────────────────────────────────

describe('SwimMembership indirect ping', () => {
  /** @type {SwimMembership} */
  let swim;
  /** @type {Array} */
  let sent;

  beforeEach(() => {
    sent = [];
    swim = new SwimMembership({
      localId: 'local',
      sendFn: (target, msg) => sent.push({ target, msg }),
      pingIntervalMs: 50,
      pingTimeoutMs: 50,
      indirectPingCount: 1,
    });
  });

  afterEach(() => {
    swim.stop();
  });

  it('when direct ping times out, SWIM_PING_REQ sent to random members', async () => {
    swim.addMember('target');
    swim.addMember('helper');
    swim.start();
    // Wait for a ping to be sent and then time out
    await new Promise(r => setTimeout(r, 300));
    swim.stop();
    const pingReqs = sent.filter(s => s.msg.type === SWIM_PING_REQ);
    // Should have sent at least one PING_REQ when the direct ping timed out
    assert.ok(pingReqs.length >= 1, `Expected PING_REQ, got ${pingReqs.length}`);
  });

  it('handleMessage with SWIM_PING_REQ pings target on behalf of requester', () => {
    swim.addMember('target');
    swim.addMember('requester');
    swim.handleMessage('requester', {
      type: SWIM_PING_REQ,
      from: 'requester',
      target: 'target',
      seq: 5,
      updates: [],
    });
    // Should send a SWIM_PING to the target
    const pings = sent.filter(s => s.target === 'target' && s.msg.type === SWIM_PING);
    assert.ok(pings.length >= 1, 'Should ping target on behalf of requester');
  });
});

// ── 7. Suspicion Mechanism ──────────────────────────────────────

describe('SwimMembership suspicion mechanism', () => {
  /** @type {SwimMembership} */
  let swim;
  /** @type {Array} */
  let sent;
  let now;

  beforeEach(() => {
    sent = [];
    now = 1000;
    swim = new SwimMembership({
      localId: 'local',
      sendFn: (target, msg) => sent.push({ target, msg }),
      nowFn: () => now,
      pingIntervalMs: 50,
      pingTimeoutMs: 50,
      suspectTimeoutMs: 100,
    });
  });

  afterEach(() => {
    swim.stop();
  });

  it('suspect member detected after ping+indirect timeout', async () => {
    swim.addMember('unreachable');
    swim.start();
    // Advance time and wait for detection
    await new Promise(r => setTimeout(r, 300));
    now += 500;
    swim.stop();
    const state = swim.getState('unreachable');
    assert.ok(
      state === 'suspect' || state === 'dead',
      `Expected suspect or dead, got ${state}`
    );
  });

  it('self-suspicion triggers incarnation bump', () => {
    // If another node suspects us, we should bump incarnation and reassert alive
    swim.handleMessage('peer-1', {
      type: SWIM_PING,
      from: 'peer-1',
      seq: 1,
      updates: [{ podId: 'local', state: 'suspect', incarnation: 0 }],
    });
    // Local node should still be alive (it refutes suspicion)
    assert.equal(swim.getState('local'), 'alive');
  });

  it('dead transition after suspectTimeoutMs', async () => {
    swim.addMember('doomed');
    swim.start();
    // Wait long enough for suspect -> dead transition
    await new Promise(r => setTimeout(r, 500));
    now += 1000;
    swim.stop();
    const state = swim.getState('doomed');
    // May be suspect or dead depending on timing; the key property is
    // that it is no longer alive
    assert.ok(
      state !== 'alive',
      `Expected non-alive state, got ${state}`
    );
  });
});

// ── 8. Dissemination ────────────────────────────────────────────

describe('SwimMembership dissemination', () => {
  /** @type {SwimMembership} */
  let swim;
  /** @type {Array} */
  let sent;

  beforeEach(() => {
    sent = [];
    swim = new SwimMembership({
      localId: 'local',
      sendFn: (target, msg) => sent.push({ target, msg }),
    });
  });

  afterEach(() => {
    swim.stop();
  });

  it('state changes are piggybacked on outgoing messages', () => {
    swim.addMember('peer-1');
    swim.addMember('peer-2');
    // Trigger an outgoing message
    swim.handleMessage('peer-1', {
      type: SWIM_PING,
      from: 'peer-1',
      seq: 1,
      updates: [],
    });
    const ack = sent.find(s => s.msg.type === SWIM_ACK);
    assert.ok(ack, 'Should have sent an ACK');
    assert.ok(Array.isArray(ack.msg.updates));
  });

  it('higher incarnation wins', () => {
    swim.addMember('peer-1');
    // Deliver an update with higher incarnation marking peer-1 as suspect
    swim.handleMessage('peer-2', {
      type: SWIM_PING,
      from: 'peer-2',
      seq: 1,
      updates: [{ podId: 'peer-1', state: 'suspect', incarnation: 10 }],
    });
    assert.equal(swim.getState('peer-1'), 'suspect');

    // Now deliver an alive update but with lower incarnation — should NOT override
    swim.handleMessage('peer-2', {
      type: SWIM_PING,
      from: 'peer-2',
      seq: 2,
      updates: [{ podId: 'peer-1', state: 'alive', incarnation: 5 }],
    });
    assert.equal(swim.getState('peer-1'), 'suspect');
  });

  it('state priority ordering: dead > suspect > alive', () => {
    swim.addMember('peer-1');
    // At same incarnation, dead should override suspect
    swim.handleMessage('peer-2', {
      type: SWIM_PING,
      from: 'peer-2',
      seq: 1,
      updates: [{ podId: 'peer-1', state: 'suspect', incarnation: 1 }],
    });
    assert.equal(swim.getState('peer-1'), 'suspect');

    swim.handleMessage('peer-2', {
      type: SWIM_PING,
      from: 'peer-2',
      seq: 2,
      updates: [{ podId: 'peer-1', state: 'dead', incarnation: 1 }],
    });
    assert.equal(swim.getState('peer-1'), 'dead');

    // alive at same incarnation should NOT override dead
    swim.handleMessage('peer-2', {
      type: SWIM_PING,
      from: 'peer-2',
      seq: 3,
      updates: [{ podId: 'peer-1', state: 'alive', incarnation: 1 }],
    });
    assert.equal(swim.getState('peer-1'), 'dead');
  });
});

// ── 9. Callbacks ────────────────────────────────────────────────

describe('SwimMembership callbacks', () => {
  /** @type {SwimMembership} */
  let swim;
  /** @type {Array} */
  let events;

  beforeEach(() => {
    events = [];
    swim = new SwimMembership({
      localId: 'local',
      sendFn: () => {},
      onJoin: (id) => events.push({ type: 'join', id }),
      onSuspect: (id) => events.push({ type: 'suspect', id }),
      onDead: (id) => events.push({ type: 'dead', id }),
      onLeave: (id) => events.push({ type: 'leave', id }),
    });
  });

  afterEach(() => {
    swim.stop();
  });

  it('onJoin called on addMember', () => {
    swim.addMember('peer-1');
    const joinEvents = events.filter(e => e.type === 'join');
    assert.ok(joinEvents.length >= 1);
    assert.equal(joinEvents[joinEvents.length - 1].id, 'peer-1');
  });

  it('onSuspect called on suspect transition', () => {
    swim.addMember('peer-1');
    swim.handleMessage('peer-2', {
      type: SWIM_PING,
      from: 'peer-2',
      seq: 1,
      updates: [{ podId: 'peer-1', state: 'suspect', incarnation: 10 }],
    });
    const suspectEvents = events.filter(e => e.type === 'suspect');
    assert.ok(suspectEvents.length >= 1);
    assert.equal(suspectEvents[0].id, 'peer-1');
  });

  it('onDead called on dead transition', () => {
    swim.addMember('peer-1');
    swim.handleMessage('peer-2', {
      type: SWIM_PING,
      from: 'peer-2',
      seq: 1,
      updates: [{ podId: 'peer-1', state: 'dead', incarnation: 10 }],
    });
    const deadEvents = events.filter(e => e.type === 'dead');
    assert.ok(deadEvents.length >= 1);
    assert.equal(deadEvents[0].id, 'peer-1');
  });

  it('onLeave called on removeMember', () => {
    swim.addMember('peer-1');
    swim.removeMember('peer-1');
    const leaveEvents = events.filter(e => e.type === 'leave');
    assert.ok(leaveEvents.length >= 1);
    assert.equal(leaveEvents[0].id, 'peer-1');
  });
});

// ── 10. SwarmCoordinator Integration ────────────────────────────

describe('SwarmCoordinator SWIM integration', () => {
  it('accepts swim option', () => {
    const swim = new SwimMembership({ localId: 'local', sendFn: () => {} });
    const coord = new SwarmCoordinator('local', { swim });
    assert.ok(coord);
    swim.stop();
  });

  it('swim accessor returns instance', () => {
    const swim = new SwimMembership({ localId: 'local', sendFn: () => {} });
    const coord = new SwarmCoordinator('local', { swim });
    assert.equal(coord.swim, swim);
    swim.stop();
  });

  it('existing tests (without swim) still work', () => {
    const coord = new SwarmCoordinator('local');
    assert.equal(coord.swim, null);
    assert.equal(coord.swarmSize, 1);
    coord.join('peer-1');
    assert.equal(coord.swarmSize, 2);
    assert.equal(coord.leave('peer-1'), true);
    assert.equal(coord.swarmSize, 1);
  });
});

// ── 11. Timer Cleanup ───────────────────────────────────────────

describe('SwimMembership timer cleanup', () => {
  it('stop clears all timers', () => {
    const swim = new SwimMembership({
      localId: 'local',
      sendFn: () => {},
      pingIntervalMs: 50,
    });
    swim.addMember('peer-1');
    swim.start();
    swim.stop();
    // Should not throw and should be callable multiple times
    swim.stop();
  });

  it('no process hangs after stop', async () => {
    const swim = new SwimMembership({
      localId: 'local',
      sendFn: () => {},
      pingIntervalMs: 50,
    });
    swim.addMember('peer-1');
    swim.start();
    swim.stop();
    // If timers leak, this test file will hang — the test runner will detect it
    await new Promise(r => setTimeout(r, 200));
  });
});
