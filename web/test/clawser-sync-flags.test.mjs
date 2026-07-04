// clawser-sync-flags.test.mjs

import { describe, it, beforeEach } from 'node:test'
import assert from 'node:assert/strict'

import { SyncFlags, flagId } from '../clawser-sync-flags.mjs'

const makeMemStorage = () => {
  const map = new Map()
  return {
    async read(k) { return map.has(k) ? map.get(k) : null },
    async write(k, v) { map.set(k, v) },
    _map: map,
  }
}

describe('flagId', () => {
  it('builds canonical kind:id', () => {
    assert.equal(flagId('skill', 'my-skill'), 'skill:my-skill')
  })
  it('rejects invalid kind', () => {
    assert.throws(() => flagId('Skill!', 'x'), /Invalid sync-flag kind/)
    assert.throws(() => flagId('', 'x'), /Invalid sync-flag kind/)
  })
  it('rejects invalid id', () => {
    assert.throws(() => flagId('skill', ''), /Invalid sync-flag id/)
    assert.throws(() => flagId('skill', 'x'.repeat(300)), /Invalid sync-flag id/)
  })
})

describe('SyncFlags', () => {
  let storage, flags
  beforeEach(() => { storage = makeMemStorage(); flags = new SyncFlags(storage) })

  it('reports unflagged ids as false', async () => {
    assert.equal(await flags.isFlagged('skill:x'), false)
  })

  it('setFlag(true) persists across instances', async () => {
    await flags.setFlag('skill:x', true)
    const flags2 = new SyncFlags(storage)
    assert.equal(await flags2.isFlagged('skill:x'), true)
  })

  it('setFlag(false) is a no-op when already false', async () => {
    await flags.setFlag('skill:x', false)
    assert.equal(storage._map.size, 0, 'no write when flag was unset and stays unset')
  })

  it('setFlag(true) twice is idempotent (no extra writes)', async () => {
    await flags.setFlag('skill:x', true)
    const beforeWrites = storage._map.get('__sync_flags__')
    await flags.setFlag('skill:x', true)
    assert.deepEqual(storage._map.get('__sync_flags__'), beforeWrites)
  })

  it('toggle flips the value and returns the new state', async () => {
    assert.equal(await flags.toggle('config:autonomy'), true)
    assert.equal(await flags.toggle('config:autonomy'), false)
    assert.equal(await flags.isFlagged('config:autonomy'), false)
  })

  it('listFlagged returns sorted ids', async () => {
    await flags.setFlag('skill:b', true)
    await flags.setFlag('skill:a', true)
    await flags.setFlag('config:c', true)
    assert.deepEqual(await flags.listFlagged(), ['config:c', 'skill:a', 'skill:b'])
  })

  it('listFlagged filters by kind prefix', async () => {
    await flags.setFlag('skill:a', true)
    await flags.setFlag('config:c', true)
    assert.deepEqual(await flags.listFlagged('skill'), ['skill:a'])
    assert.deepEqual(await flags.listFlagged('memory'), [])
  })

  it('clear removes everything', async () => {
    await flags.setFlag('skill:x', true)
    await flags.setFlag('config:y', true)
    await flags.clear()
    assert.deepEqual(await flags.listFlagged(), [])
  })

  it('survives a corrupted file by resetting cleanly', async () => {
    storage._map.set('__sync_flags__', new TextEncoder().encode('not json'))
    const flags2 = new SyncFlags(storage)
    assert.deepEqual(await flags2.listFlagged(), [])
  })

  it('rejects unknown version', async () => {
    storage._map.set('__sync_flags__',
      new TextEncoder().encode(JSON.stringify({ version: 99, flagged: ['skill:x'] })))
    const flags2 = new SyncFlags(storage)
    // Behavior on bad version: log a warning and reset (same as corrupt).
    assert.deepEqual(await flags2.listFlagged(), [])
  })
})
