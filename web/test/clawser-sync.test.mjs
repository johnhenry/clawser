// clawser-sync.test.mjs

import { describe, it, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'

import { SyncEngine, lwwShouldReplace } from '../clawser-sync.mjs'

// ── helpers ───────────────────────────────────────────────────────

function makePod() {
  const sent = []
  let nextErr = null
  return {
    sendMessage: async (peerId, env) => {
      if (nextErr) { const e = nextErr; nextErr = null; throw e }
      sent.push({ peerId, env: structuredClone(env) })
    },
    _sent: sent,
    _failNext: (e) => { nextErr = e },
  }
}

function makeStore() {
  const committed = new Map()
  const staged = new Map()
  return {
    async get(kind, itemId) {
      const k = `${kind}:${itemId}`
      return committed.has(k) ? structuredClone(committed.get(k)) : null
    },
    async stageApply(kind, itemId, _current, incoming) {
      staged.set(`${kind}:${itemId}`, structuredClone(incoming))
    },
    async commit() {
      for (const [k, v] of staged) committed.set(k, v)
      staged.clear()
    },
    async discard() { staged.clear() },
    _committed: committed,
    _staged: staged,
  }
}

function makeSnapshot() {
  let n = 0
  let lastRestoredId = null
  return {
    create: async () => `snap-${++n}`,
    restore: async (id) => { lastRestoredId = id },
    get lastRestoredId() { return lastRestoredId },
  }
}

function makeClock(start = 1_000_000) {
  let t = start
  return {
    now: () => t,
    advance(ms) { t += ms; return t },
  }
}

// ── lwwShouldReplace ──────────────────────────────────────────────

describe('lwwShouldReplace', () => {
  it('replaces missing current', () => {
    assert.equal(lwwShouldReplace(null, { ts: 1, source: 'a' }), true)
  })
  it('higher ts wins', () => {
    assert.equal(lwwShouldReplace({ ts: 1, source: 'a' }, { ts: 2, source: 'a' }), true)
    assert.equal(lwwShouldReplace({ ts: 2, source: 'a' }, { ts: 1, source: 'a' }), false)
  })
  it('equal ts → lex-greater source wins', () => {
    assert.equal(lwwShouldReplace({ ts: 1, source: 'a' }, { ts: 1, source: 'b' }), true)
    assert.equal(lwwShouldReplace({ ts: 1, source: 'b' }, { ts: 1, source: 'a' }), false)
  })
  it('equal everything → no replacement (tie → keep current)', () => {
    assert.equal(lwwShouldReplace({ ts: 1, source: 'a' }, { ts: 1, source: 'a' }), false)
  })
})

// ── construction guards ───────────────────────────────────────────

describe('SyncEngine construction', () => {
  it('rejects missing pod.sendMessage', () => {
    assert.throws(() => new SyncEngine({ pod: {}, store: {}, selfDeviceId: 'A' }), /sendMessage/)
  })
  it('rejects missing store', () => {
    assert.throws(() => new SyncEngine({ pod: makePod(), store: null, selfDeviceId: 'A' }), /store/)
  })
  it('rejects missing selfDeviceId', () => {
    assert.throws(() => new SyncEngine({ pod: makePod(), store: makeStore() }), /selfDeviceId/)
  })
})

// ── peer membership ───────────────────────────────────────────────

describe('SyncEngine — peers', () => {
  it('addPeer / removePeer / listPeers', () => {
    const e = new SyncEngine({ pod: makePod(), store: makeStore(), selfDeviceId: 'A' })
    e.addPeer('B'); e.addPeer('C'); e.addPeer('B') // dedup
    assert.deepEqual(e.listPeers(), ['B', 'C'])
    e.removePeer('B')
    assert.deepEqual(e.listPeers(), ['C'])
  })
  it('refuses to add self', () => {
    const e = new SyncEngine({ pod: makePod(), store: makeStore(), selfDeviceId: 'A' })
    e.addPeer('A')
    assert.deepEqual(e.listPeers(), [])
  })
})

// ── outbound queue + flush ────────────────────────────────────────

describe('SyncEngine — outbound queue', () => {
  it('flush sends one envelope per item per peer', async () => {
    const pod = makePod()
    const clock = makeClock()
    const e = new SyncEngine({ pod, store: makeStore(), selfDeviceId: 'A', clock: clock.now })
    e.addPeer('B'); e.addPeer('C')
    e.queueLocal('s1', 'lww', { foo: 1 })
    e.queueLocal('s2', 'lww', { bar: 2 })
    const result = await e.flush({ manual: true })
    assert.equal(result.sent, 4)
    assert.equal(pod._sent.length, 4)
    const peerSet = new Set(pod._sent.map(s => s.peerId))
    assert.deepEqual([...peerSet].sort(), ['B', 'C'])
    for (const s of pod._sent) {
      assert.equal(s.env.type, 'sync')
      assert.equal(s.env.source, 'A')
    }
  })

  it('flush is a no-op when queue is empty', async () => {
    const pod = makePod()
    const e = new SyncEngine({ pod, store: makeStore(), selfDeviceId: 'A' })
    e.addPeer('B')
    const result = await e.flush({ manual: true })
    assert.equal(result.sent, 0)
    assert.equal(pod._sent.length, 0)
  })

  it('queueLocal with the same itemId coalesces (last write wins in queue)', async () => {
    const pod = makePod()
    const clock = makeClock()
    const e = new SyncEngine({ pod, store: makeStore(), selfDeviceId: 'A', clock: clock.now })
    e.addPeer('B')
    e.queueLocal('s1', 'lww', { v: 1 })
    clock.advance(10)
    e.queueLocal('s1', 'lww', { v: 2 })
    await e.flush({ manual: true })
    assert.equal(pod._sent.length, 1)
    assert.deepEqual(pod._sent[0].env.payload, { v: 2 })
  })

  it('queueLocal rejects unknown kinds', () => {
    const e = new SyncEngine({ pod: makePod(), store: makeStore(), selfDeviceId: 'A' })
    assert.throws(() => e.queueLocal('s1', 'wat', {}), /unknown kind/)
  })

  it('debounce window batches updates (timer-driven flush)', async () => {
    const pod = makePod()
    const e = new SyncEngine({ pod, store: makeStore(), selfDeviceId: 'A', debounceMs: 30 })
    e.addPeer('B')
    e.queueLocal('s1', 'lww', { v: 1 })
    e.queueLocal('s2', 'lww', { v: 2 })
    // Wait past the debounce window
    await new Promise(r => setTimeout(r, 80))
    assert.equal(pod._sent.length, 2)
  })

  it('a sendMessage error on one peer does not abort others', async () => {
    const pod = makePod()
    const e = new SyncEngine({ pod, store: makeStore(), selfDeviceId: 'A' })
    e.addPeer('B'); e.addPeer('C')
    pod._failNext(new Error('peer down'))
    e.queueLocal('s1', 'lww', { v: 1 })
    const r = await e.flush({ manual: true })
    // First send to B failed; second to C succeeded
    assert.equal(r.sent, 1)
    assert.equal(pod._sent.length, 1)
  })
})

// ── inbound: validation ───────────────────────────────────────────

describe('SyncEngine — validateEnvelope', () => {
  let engine
  beforeEach(() => { engine = new SyncEngine({ pod: makePod(), store: makeStore(), selfDeviceId: 'A' }) })

  it('accepts a well-formed lww envelope', () => {
    const r = engine.validateEnvelope({
      type: 'sync', kind: 'lww', itemId: 's1', payload: 1, ts: 100, source: 'B',
    })
    assert.equal(r.accepted, true)
  })
  it('rejects non-sync types', () => {
    assert.equal(engine.validateEnvelope({ type: 'ping' }).accepted, false)
  })
  it('rejects unknown kinds', () => {
    assert.equal(engine.validateEnvelope({ type: 'sync', kind: 'xyz', itemId: 'a', ts: 1, source: 'B' }).accepted, false)
  })
  it('rejects missing fields', () => {
    assert.equal(engine.validateEnvelope({ type: 'sync', kind: 'lww', payload: 1, ts: 100, source: 'B' }).accepted, false)
    assert.equal(engine.validateEnvelope({ type: 'sync', kind: 'lww', itemId: 's', payload: 1, source: 'B' }).accepted, false)
    assert.equal(engine.validateEnvelope({ type: 'sync', kind: 'lww', itemId: 's', payload: 1, ts: 1 }).accepted, false)
  })
  it('rejects echo from self', () => {
    assert.equal(engine.validateEnvelope({ type: 'sync', kind: 'lww', itemId: 's', payload: 1, ts: 1, source: 'A' }).accepted, false)
  })
})

// ── inbound: atomic apply with snapshot rollback ──────────────────

describe('SyncEngine — applyBatch (LWW)', () => {
  it('applies new updates and commits', async () => {
    const store = makeStore()
    const snap = makeSnapshot()
    const e = new SyncEngine({ pod: makePod(), store, snapshot: snap, selfDeviceId: 'A' })
    const r = await e.applyBatch([
      { kind: 'lww', itemId: 's1', payload: { v: 1 }, ts: 10, source: 'B' },
      { kind: 'lww', itemId: 's2', payload: { v: 2 }, ts: 11, source: 'B' },
    ])
    assert.equal(r.ok, true)
    assert.deepEqual(r.applied.sort(), ['s1', 's2'])
    assert.equal(snap.lastRestoredId, null, 'no rollback on success')
    assert.deepEqual((await store.get('lww', 's1')).payload, { v: 1 })
  })

  it('keeps the existing entry when LWW says it loses', async () => {
    const store = makeStore()
    // Pre-seed with a newer entry
    await store.stageApply('lww', 's1', null, { payload: { v: 99 }, ts: 50, source: 'A' })
    await store.commit()
    const e = new SyncEngine({ pod: makePod(), store, selfDeviceId: 'A' })
    const r = await e.applyBatch([
      { kind: 'lww', itemId: 's1', payload: { v: 1 }, ts: 10, source: 'B' },
    ])
    assert.equal(r.ok, true)
    assert.deepEqual(r.applied, [], 'incoming was older — skipped')
    assert.deepEqual((await store.get('lww', 's1')).payload, { v: 99 })
  })

  it('rolls back via snapshot when stageApply throws mid-batch', async () => {
    const store = makeStore()
    const snap = makeSnapshot()
    let stageCount = 0
    store.stageApply = async (kind, itemId, _curr, incoming) => {
      stageCount++
      if (stageCount === 2) throw new Error('disk full')
      // first call OK
    }
    const e = new SyncEngine({ pod: makePod(), store, snapshot: snap, selfDeviceId: 'A' })
    const r = await e.applyBatch([
      { kind: 'lww', itemId: 's1', payload: 1, ts: 1, source: 'B' },
      { kind: 'lww', itemId: 's2', payload: 2, ts: 1, source: 'B' },
    ])
    assert.equal(r.ok, false)
    assert.equal(r.rolledBack, true)
    assert.equal(snap.lastRestoredId, 'snap-1')
    assert.match(r.error, /disk full/)
  })

  it('rolls back when commit() throws', async () => {
    const store = makeStore()
    const snap = makeSnapshot()
    store.commit = async () => { throw new Error('commit boom') }
    const e = new SyncEngine({ pod: makePod(), store, snapshot: snap, selfDeviceId: 'A' })
    const r = await e.applyBatch([
      { kind: 'lww', itemId: 's1', payload: 1, ts: 1, source: 'B' },
    ])
    assert.equal(r.ok, false)
    assert.equal(r.rolledBack, true)
    assert.equal(snap.lastRestoredId, 'snap-1')
  })

  it('returns ok for empty batches without taking a snapshot', async () => {
    const snap = makeSnapshot()
    const e = new SyncEngine({ pod: makePod(), store: makeStore(), snapshot: snap, selfDeviceId: 'A' })
    const r = await e.applyBatch([])
    assert.equal(r.ok, true)
    assert.equal(r.applied.length, 0)
  })

  it('does not roll back without a snapshot driver', async () => {
    const store = makeStore()
    store.stageApply = async () => { throw new Error('stage boom') }
    const e = new SyncEngine({ pod: makePod(), store, selfDeviceId: 'A' })
    const r = await e.applyBatch([{ kind: 'lww', itemId: 's1', payload: 1, ts: 1, source: 'B' }])
    assert.equal(r.ok, false)
    assert.equal(r.rolledBack, false)
  })

  it('snapshot create failure is reported and aborts the batch', async () => {
    const store = makeStore()
    const snap = makeSnapshot()
    snap.create = async () => { throw new Error('snap boom') }
    const e = new SyncEngine({ pod: makePod(), store, snapshot: snap, selfDeviceId: 'A' })
    const r = await e.applyBatch([{ kind: 'lww', itemId: 's1', payload: 1, ts: 1, source: 'B' }])
    assert.equal(r.ok, false)
    assert.match(r.error, /snapshot create/)
  })
})

// ── inbound: Y.js path ────────────────────────────────────────────

describe('SyncEngine — applyBatch (Y.js)', () => {
  it('delegates to the configured Y.js applicator', async () => {
    const calls = []
    const yjs = { applyUpdate: async (itemId, update) => calls.push({ itemId, len: update.length }) }
    const e = new SyncEngine({ pod: makePod(), store: makeStore(), yjs, selfDeviceId: 'A' })
    const r = await e.applyBatch([
      { kind: 'yjs', itemId: 'doc-1', payload: new Uint8Array([1, 2, 3]), ts: 1, source: 'B' },
    ])
    assert.equal(r.ok, true)
    assert.deepEqual(calls, [{ itemId: 'doc-1', len: 3 }])
  })

  it('errors when no Y.js applicator is configured', async () => {
    const e = new SyncEngine({ pod: makePod(), store: makeStore(), selfDeviceId: 'A' })
    const r = await e.applyBatch([
      { kind: 'yjs', itemId: 'd1', payload: new Uint8Array(), ts: 1, source: 'B' },
    ])
    assert.equal(r.ok, false)
    assert.match(r.error, /Y\.js applicator/)
  })
})

// ── handleIncoming convenience ────────────────────────────────────

describe('SyncEngine — handleIncoming', () => {
  it('happy path applies one envelope', async () => {
    const store = makeStore()
    const e = new SyncEngine({ pod: makePod(), store, selfDeviceId: 'A' })
    const r = await e.handleIncoming({
      type: 'sync', kind: 'lww', itemId: 's1', payload: { v: 1 }, ts: 1, source: 'B',
    })
    assert.equal(r.ok, true)
    assert.deepEqual(r.applied, ['s1'])
  })

  it('returns reason on validation failure', async () => {
    const e = new SyncEngine({ pod: makePod(), store: makeStore(), selfDeviceId: 'A' })
    const r = await e.handleIncoming({ type: 'sync', kind: 'lww', itemId: 's1', payload: 1, ts: 1, source: 'A' })
    assert.equal(r.ok, false)
    assert.match(r.error, /echo from self/)
  })
})
