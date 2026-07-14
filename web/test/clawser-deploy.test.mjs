// clawser-deploy.test.mjs

import { describe, it, beforeEach } from 'node:test'
import assert from 'node:assert/strict'

import { buildDeployPreview, runDeploy, recordLocalChange } from '../clawser-deploy.mjs'
import { SyncFlags } from '../clawser-sync-flags.mjs'
import { SyncEngine } from '../clawser-sync.mjs'

const makeMemStorage = () => {
  const map = new Map()
  return { async read(k) { return map.has(k) ? map.get(k) : null }, async write(k, v) { map.set(k, v) } }
}
const makePod = () => {
  const sent = []
  return { sendMessage: async (peerId, env) => { sent.push({ peerId, env }) }, _sent: sent }
}
const makeStore = () => ({
  async get() { return null },
  async stageApply() {},
  async commit() {},
  async discard() {},
})

function makeCtx({ flagged = [] } = {}) {
  const flags = new SyncFlags(makeMemStorage())
  const pod = makePod()
  const engine = new SyncEngine({ pod, store: makeStore(), selfDeviceId: 'A' })
  engine.addPeer('B'); engine.addPeer('C')
  const items = new Map()
  for (const f of flagged) {
    const [, id] = f.fid.split(':')
    items.set(f.fid, { kind: f.kind || 'lww', itemId: id, payload: f.payload ?? {} })
  }
  return {
    flags,
    pod,
    engine,
    listPeers: () => engine.listPeers(),
    resolveItem: async (fid) => items.get(fid) || null,
    _items: items,
  }
}

describe('buildDeployPreview', () => {
  it('returns empty when nothing is flagged', async () => {
    const ctx = makeCtx()
    const p = await buildDeployPreview(ctx)
    assert.deepEqual(p.items, [])
    assert.deepEqual(p.peers.sort(), ['B', 'C'])
  })

  it('lists every flagged item with present/missing status', async () => {
    const ctx = makeCtx({
      flagged: [
        { fid: 'skill:s1', kind: 'lww', payload: { v: 1 } },
        { fid: 'config:c1', kind: 'lww', payload: { v: 2 } },
      ],
    })
    await ctx.flags.setFlag('skill:s1', true)
    await ctx.flags.setFlag('config:c1', true)
    await ctx.flags.setFlag('memory:gone', true) // resolveItem returns null
    const p = await buildDeployPreview(ctx)
    const byFid = Object.fromEntries(p.items.map(i => [i.fid, i]))
    assert.equal(byFid['skill:s1'].present, true)
    assert.equal(byFid['memory:gone'].present, false)
    assert.equal(byFid['memory:gone'].kind, 'unknown')
  })
})

describe('runDeploy', () => {
  it('queues and flushes flagged items to all peers', async () => {
    const ctx = makeCtx({
      flagged: [
        { fid: 'skill:s1', kind: 'lww', payload: { v: 1 } },
        { fid: 'config:c1', kind: 'lww', payload: { v: 2 } },
      ],
    })
    await ctx.flags.setFlag('skill:s1', true)
    await ctx.flags.setFlag('config:c1', true)
    const r = await runDeploy(ctx)
    assert.equal(r.queued, 2)
    assert.equal(r.sent, 4) // 2 items × 2 peers
    assert.equal(r.peers, 2)
    assert.deepEqual(r.missing, [])
  })

  it('reports missing items but still ships the rest', async () => {
    const ctx = makeCtx({
      flagged: [{ fid: 'skill:s1', kind: 'lww', payload: { v: 1 } }],
    })
    await ctx.flags.setFlag('skill:s1', true)
    await ctx.flags.setFlag('memory:vanished', true)
    const r = await runDeploy(ctx)
    assert.equal(r.queued, 1)
    assert.equal(r.sent, 2)
    assert.deepEqual(r.missing, ['memory:vanished'])
  })

  it('no-ops when nothing is flagged', async () => {
    const ctx = makeCtx()
    const r = await runDeploy(ctx)
    assert.deepEqual(r, { queued: 0, sent: 0, peers: 2, missing: [] })
  })
})

describe('recordLocalChange', () => {
  let ctx
  beforeEach(() => { ctx = makeCtx() })

  it('queues when the flag is set', async () => {
    await ctx.flags.setFlag('skill:s1', true)
    const queued = await recordLocalChange(ctx, 'skill:s1', 'lww', 's1', { v: 1 })
    assert.equal(queued, true)
    const pending = ctx.engine.pendingSnapshot()
    assert.equal(pending.length, 1)
    assert.equal(pending[0].itemId, 's1')
  })

  it('skips when the flag is unset', async () => {
    const queued = await recordLocalChange(ctx, 'skill:s1', 'lww', 's1', { v: 1 })
    assert.equal(queued, false)
    assert.equal(ctx.engine.pendingSnapshot().length, 0)
  })
})
