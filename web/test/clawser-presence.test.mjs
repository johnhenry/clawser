// clawser-presence.test.mjs
// Run: node --import ./web/test/_setup-globals.mjs --test web/test/clawser-presence.test.mjs

import { describe, it, beforeEach } from 'node:test'
import assert from 'node:assert/strict'

import { PresenceService } from '../clawser-presence.mjs'

// ── test helpers ───────────────────────────────────────────────────

function makeFakeNode() {
  const handlers = new Map()
  return {
    on(event, cb) {
      if (!handlers.has(event)) handlers.set(event, new Set())
      handlers.get(event).add(cb)
    },
    off(event, cb) {
      handlers.get(event)?.delete(cb)
    },
    emit(event, payload) {
      const cbs = handlers.get(event)
      if (cbs) for (const cb of cbs) cb(payload)
    },
    _handlerCount(event) {
      return handlers.get(event)?.size ?? 0
    },
  }
}

function makeClock(start = 1_000_000) {
  let t = start
  return {
    now: () => t,
    advance(ms) { t += ms; return t },
  }
}

// ── unit tests ────────────────────────────────────────────────────

describe('PresenceService — getPresence / getAll', () => {
  it('returns null for unknown peers', () => {
    const svc = new PresenceService()
    assert.equal(svc.getPresence('nobody'), null)
  })

  it('starts with an empty getAll() map', () => {
    const svc = new PresenceService()
    assert.equal(svc.getAll().size, 0)
  })

  it('getAll() returns a defensive copy', () => {
    const svc = new PresenceService()
    svc.recordHeartbeat('p1')
    const snap = svc.getAll()
    snap.delete('p1')
    assert.equal(svc.getPresence('p1')?.status, 'online')
  })

  it('getPresence() returns a defensive copy', () => {
    const svc = new PresenceService()
    svc.recordHeartbeat('p1')
    const a = svc.getPresence('p1')
    a.status = 'offline'
    assert.equal(svc.getPresence('p1').status, 'online')
  })
})

describe('PresenceService — recordHeartbeat', () => {
  it('marks a fresh peer online', () => {
    const clock = makeClock()
    const svc = new PresenceService({ now: clock.now })
    svc.recordHeartbeat('alice')
    assert.equal(svc.getPresence('alice').status, 'online')
    assert.equal(svc.getPresence('alice').lastSeen, clock.now())
  })

  it('refreshes lastSeen even when status does not change', () => {
    const clock = makeClock()
    const svc = new PresenceService({ now: clock.now })
    svc.recordHeartbeat('alice')
    const t0 = clock.now()
    clock.advance(1000)
    svc.recordHeartbeat('alice')
    const e = svc.getPresence('alice')
    assert.equal(e.status, 'online')
    assert.equal(e.lastSeen, t0 + 1000)
  })

  it('uses an explicit timestamp when provided', () => {
    const svc = new PresenceService()
    svc.recordHeartbeat('alice', 500)
    assert.equal(svc.getPresence('alice').lastSeen, 500)
  })

  it('ignores nullish peerId', () => {
    const svc = new PresenceService()
    svc.recordHeartbeat(null)
    svc.recordHeartbeat(undefined)
    assert.equal(svc.getAll().size, 0)
  })
})

describe('PresenceService — idle/offline sweep', () => {
  it('flips online → idle after idleAfterMs', () => {
    const clock = makeClock()
    const svc = new PresenceService({ now: clock.now, idleAfterMs: 1000, offlineAfterMs: 5000 })
    svc.recordHeartbeat('p1')
    clock.advance(1500)
    svc.sweep()
    assert.equal(svc.getPresence('p1').status, 'idle')
  })

  it('flips idle → offline after offlineAfterMs', () => {
    const clock = makeClock()
    const svc = new PresenceService({ now: clock.now, idleAfterMs: 1000, offlineAfterMs: 5000 })
    svc.recordHeartbeat('p1')
    clock.advance(6000)
    svc.sweep()
    assert.equal(svc.getPresence('p1').status, 'offline')
  })

  it('a heartbeat brings idle peers back to online', () => {
    const clock = makeClock()
    const svc = new PresenceService({ now: clock.now, idleAfterMs: 1000, offlineAfterMs: 5000 })
    svc.recordHeartbeat('p1')
    clock.advance(1500)
    svc.sweep()
    assert.equal(svc.getPresence('p1').status, 'idle')
    clock.advance(100)
    svc.recordHeartbeat('p1')
    assert.equal(svc.getPresence('p1').status, 'online')
  })

  it('sweep is a no-op when nothing changed', () => {
    const clock = makeClock()
    const svc = new PresenceService({ now: clock.now, idleAfterMs: 1000, offlineAfterMs: 5000 })
    svc.recordHeartbeat('p1')
    const events = []
    svc.subscribe(c => events.push(c))
    svc.sweep()
    svc.sweep()
    svc.sweep()
    assert.equal(events.length, 0)
  })
})

describe('PresenceService — subscribe', () => {
  it('fires on initial online transition', () => {
    const svc = new PresenceService()
    const events = []
    svc.subscribe(c => events.push(c))
    svc.recordHeartbeat('p1')
    assert.equal(events.length, 1)
    assert.equal(events[0].peerId, 'p1')
    assert.equal(events[0].status, 'online')
    assert.equal(events[0].prevStatus, null)
  })

  it('fires on online → idle and idle → offline', () => {
    const clock = makeClock()
    const svc = new PresenceService({ now: clock.now, idleAfterMs: 1000, offlineAfterMs: 2000 })
    const events = []
    svc.subscribe(c => events.push(c))
    svc.recordHeartbeat('p1')
    clock.advance(1500); svc.sweep()
    clock.advance(1000); svc.sweep()
    const flips = events.map(e => `${e.prevStatus}->${e.status}`)
    assert.deepEqual(flips, ['null->online', 'online->idle', 'idle->offline'])
  })

  it('returns an unsubscribe function', () => {
    const svc = new PresenceService()
    const events = []
    const unsub = svc.subscribe(c => events.push(c))
    svc.recordHeartbeat('p1')
    unsub()
    svc.recordHeartbeat('p2')
    assert.equal(events.length, 1)
  })

  it('a throwing subscriber does not break others', () => {
    const svc = new PresenceService()
    const ok = []
    svc.subscribe(() => { throw new Error('boom') })
    svc.subscribe(c => ok.push(c))
    svc.recordHeartbeat('p1')
    assert.equal(ok.length, 1)
  })

  it('rejects non-function subscribers', () => {
    const svc = new PresenceService()
    assert.throws(() => svc.subscribe(null), /function/)
    assert.throws(() => svc.subscribe('hi'), /function/)
  })
})

// ── integration: PeerNode events flow into presence state ─────────

describe('PresenceService — PeerNode wiring', () => {
  it('start() subscribes to peer:connect / peer:disconnect', () => {
    const node = makeFakeNode()
    const svc = new PresenceService({ peerNode: node })
    svc.start()
    assert.equal(node._handlerCount('peer:connect'), 1)
    assert.equal(node._handlerCount('peer:disconnect'), 1)
    svc.stop()
    assert.equal(node._handlerCount('peer:connect'), 0)
    assert.equal(node._handlerCount('peer:disconnect'), 0)
  })

  it('peer:connect event marks peer online', () => {
    const node = makeFakeNode()
    const clock = makeClock()
    const svc = new PresenceService({ peerNode: node, now: clock.now })
    svc.start()
    node.emit('peer:connect', { podId: 'alice' })
    const e = svc.getPresence('alice')
    assert.equal(e.status, 'online')
    assert.equal(e.joinedAt, clock.now())
    svc.stop()
  })

  it('peer:disconnect event marks peer offline', () => {
    const node = makeFakeNode()
    const svc = new PresenceService({ peerNode: node })
    svc.start()
    node.emit('peer:connect', { podId: 'alice' })
    node.emit('peer:disconnect', { podId: 'alice' })
    assert.equal(svc.getPresence('alice').status, 'offline')
    svc.stop()
  })

  it('peer-id extraction handles podId / peerId / pubKey / id / string', () => {
    const node = makeFakeNode()
    const svc = new PresenceService({ peerNode: node })
    svc.start()
    node.emit('peer:connect', { podId: 'a' })
    node.emit('peer:connect', { peerId: 'b' })
    node.emit('peer:connect', { pubKey: 'c' })
    node.emit('peer:connect', { id: 'd' })
    node.emit('peer:connect', 'e')
    const all = svc.getAll()
    assert.deepEqual([...all.keys()].sort(), ['a', 'b', 'c', 'd', 'e'])
    svc.stop()
  })

  it('start() / stop() are idempotent', () => {
    const node = makeFakeNode()
    const svc = new PresenceService({ peerNode: node })
    svc.start()
    svc.start()
    assert.equal(node._handlerCount('peer:connect'), 1)
    svc.stop()
    svc.stop()
    assert.equal(node._handlerCount('peer:connect'), 0)
  })

  it('disconnect of unknown peer is a no-op', () => {
    const node = makeFakeNode()
    const svc = new PresenceService({ peerNode: node })
    svc.start()
    node.emit('peer:disconnect', { podId: 'ghost' })
    assert.equal(svc.getPresence('ghost'), null)
    svc.stop()
  })

  it('peer-without-id is silently dropped', () => {
    const node = makeFakeNode()
    const svc = new PresenceService({ peerNode: node })
    svc.start()
    node.emit('peer:connect', {})
    node.emit('peer:connect', null)
    assert.equal(svc.getAll().size, 0)
    svc.stop()
  })

  it('integration: events → state → sweep → events flow end-to-end', () => {
    const node = makeFakeNode()
    const clock = makeClock()
    const events = []
    const svc = new PresenceService({
      peerNode: node, now: clock.now,
      idleAfterMs: 1000, offlineAfterMs: 3000,
    })
    svc.subscribe(c => events.push(c))
    svc.start()

    node.emit('peer:connect', { podId: 'alice' })
    clock.advance(500)
    svc.recordHeartbeat('alice')
    clock.advance(1500); svc.sweep() // alice → idle
    clock.advance(2000); svc.sweep() // alice → offline
    svc.recordHeartbeat('alice')      // back to online

    const flips = events.map(e => `${e.peerId}:${e.prevStatus}->${e.status}`)
    assert.deepEqual(flips, [
      'alice:null->online',
      'alice:online->idle',
      'alice:idle->offline',
      'alice:offline->online',
    ])
    svc.stop()
  })
})

// ── presenceChangeMessage ─────────────────────────────────────────

describe('presenceChangeMessage', () => {
  it('announces sustained offline transitions', async () => {
    const { presenceChangeMessage } = await import('../clawser-presence.mjs');
    const msg = presenceChangeMessage({ peerId: 'pod-abcdef123456789', status: 'offline', prevStatus: 'online' });
    assert.match(msg, /pod-abcdef12.*went offline/);
  });

  it('announces recovery from offline', async () => {
    const { presenceChangeMessage } = await import('../clawser-presence.mjs');
    const msg = presenceChangeMessage({ peerId: 'p1', status: 'online', prevStatus: 'offline' });
    assert.match(msg, /reconnected/);
  });

  it('stays quiet for idle flapping and initial discovery', async () => {
    const { presenceChangeMessage } = await import('../clawser-presence.mjs');
    assert.equal(presenceChangeMessage({ peerId: 'p', status: 'idle', prevStatus: 'online' }), null);
    assert.equal(presenceChangeMessage({ peerId: 'p', status: 'online', prevStatus: 'idle' }), null);
    assert.equal(presenceChangeMessage({ peerId: 'p', status: 'online', prevStatus: null }), null);
    assert.equal(presenceChangeMessage({ peerId: 'p', status: 'offline', prevStatus: 'offline' }), null);
  });
});
