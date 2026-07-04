// clawser-paired-devices.test.mjs

import { describe, it, beforeEach } from 'node:test'
import assert from 'node:assert/strict'

import { PairedDevicesStore } from '../clawser-paired-devices.mjs'

const memStorage = () => {
  const map = new Map()
  return {
    async read(name) { return map.has(name) ? map.get(name) : null },
    async write(name, bytes) { map.set(name, bytes) },
    _map: map,
  }
}

describe('PairedDevicesStore — construction', () => {
  it('rejects missing storage', () => {
    assert.throws(() => new PairedDevicesStore(), /storage with read\/write required/)
    assert.throws(() => new PairedDevicesStore({}), /storage with read\/write required/)
  })
})

describe('PairedDevicesStore — basic CRUD', () => {
  let store
  beforeEach(() => { store = new PairedDevicesStore(memStorage()) })

  it('starts empty', async () => {
    assert.deepEqual(await store.list(), [])
  })

  it('add returns the persisted entry with a generated deviceId', async () => {
    const entry = await store.add({ label: 'My phone', peerPublicKey: 'pk_phone' })
    assert.match(entry.deviceId, /^dev-/)
    assert.equal(entry.label, 'My phone')
    assert.equal(entry.peerPublicKey, 'pk_phone')
    assert.equal(entry.lastSyncAt, null)
    assert.equal(typeof entry.addedAt, 'number')
  })

  it('add respects an explicit deviceId', async () => {
    const entry = await store.add({ deviceId: 'fixed-id', label: 'X' })
    assert.equal(entry.deviceId, 'fixed-id')
  })

  it('add is idempotent for the same deviceId (returns existing, no duplicate)', async () => {
    const a = await store.add({ deviceId: 'd1', label: 'First' })
    const b = await store.add({ deviceId: 'd1', label: 'Second' })  // should be ignored
    assert.equal(a.deviceId, b.deviceId)
    assert.equal(b.label, 'First', 'duplicate-add must NOT overwrite existing label')
    assert.equal((await store.list()).length, 1)
  })

  it('get returns null for unknown device', async () => {
    assert.equal(await store.get('nope'), null)
  })

  it('get returns a defensive copy', async () => {
    await store.add({ deviceId: 'd', label: 'Phone' })
    const a = await store.get('d')
    a.label = 'mutated'
    const b = await store.get('d')
    assert.equal(b.label, 'Phone', 'mutating returned object must not affect store')
  })

  it('remove returns true on success, false on miss', async () => {
    await store.add({ deviceId: 'd1' })
    assert.equal(await store.remove('d1'), true)
    assert.equal(await store.list().then(l => l.length), 0)
    assert.equal(await store.remove('d-nope'), false)
  })

  it('setLabel updates the stored label', async () => {
    await store.add({ deviceId: 'd', label: 'old' })
    assert.equal(await store.setLabel('d', 'new'), true)
    assert.equal((await store.get('d')).label, 'new')
  })

  it('setLabel returns false on miss', async () => {
    assert.equal(await store.setLabel('nope', 'x'), false)
  })

  it('setLabel returns false on non-string', async () => {
    await store.add({ deviceId: 'd', label: 'old' })
    assert.equal(await store.setLabel('d', 42), false)
    assert.equal(await store.setLabel('d', null), false)
  })

  it('recordSync stamps lastSyncAt', async () => {
    await store.add({ deviceId: 'd' })
    assert.equal(await store.recordSync('d', 12345), true)
    assert.equal((await store.get('d')).lastSyncAt, 12345)
  })

  it('recordSync uses Date.now when no timestamp passed', async () => {
    await store.add({ deviceId: 'd' })
    const before = Date.now()
    await store.recordSync('d')
    const after = Date.now()
    const ts = (await store.get('d')).lastSyncAt
    assert.ok(ts >= before && ts <= after)
  })

  it('clear wipes everything', async () => {
    await store.add({ deviceId: 'a' })
    await store.add({ deviceId: 'b' })
    await store.clear()
    assert.deepEqual(await store.list(), [])
  })
})

describe('PairedDevicesStore — persistence', () => {
  it('a fresh instance over the same storage sees the same entries', async () => {
    const storage = memStorage()
    const a = new PairedDevicesStore(storage)
    await a.add({ deviceId: 'd1', label: 'My phone' })
    await a.add({ deviceId: 'd2', label: 'Tablet' })
    const b = new PairedDevicesStore(storage)
    const list = await b.list()
    assert.equal(list.length, 2)
    assert.deepEqual(list.map(e => e.deviceId).sort(), ['d1', 'd2'])
  })

  it('survives a corrupted persistence file by resetting', async () => {
    const storage = memStorage()
    storage._map.set('__paired_devices__', new TextEncoder().encode('not json'))
    const store = new PairedDevicesStore(storage)
    assert.deepEqual(await store.list(), [])
  })

  it('rejects unknown version', async () => {
    const storage = memStorage()
    storage._map.set('__paired_devices__',
      new TextEncoder().encode(JSON.stringify({ version: 99, entries: [{ deviceId: 'x' }] })))
    const store = new PairedDevicesStore(storage)
    assert.deepEqual(await store.list(), [])
  })
})

describe('PairedDevicesStore — subscribe', () => {
  it('fires on add, remove, setLabel, recordSync, clear', async () => {
    const store = new PairedDevicesStore(memStorage())
    const events = []
    store.subscribe((list) => events.push(list.map(e => e.deviceId).sort()))

    await store.add({ deviceId: 'a' })
    await store.add({ deviceId: 'b' })
    await store.setLabel('a', 'New')
    await store.recordSync('a')
    await store.remove('b')
    await store.clear()
    assert.deepEqual(events, [
      ['a'],            // add a
      ['a', 'b'],       // add b
      ['a', 'b'],       // setLabel a
      ['a', 'b'],       // recordSync a
      ['a'],            // remove b
      [],               // clear
    ])
  })

  it('returns an unsubscribe function', async () => {
    const store = new PairedDevicesStore(memStorage())
    const calls = []
    const unsub = store.subscribe(() => calls.push(1))
    await store.add({ deviceId: 'a' })
    unsub()
    await store.add({ deviceId: 'b' })
    assert.equal(calls.length, 1)
  })

  it('a throwing subscriber doesn\'t break others', async () => {
    const store = new PairedDevicesStore(memStorage())
    const ok = []
    store.subscribe(() => { throw new Error('boom') })
    store.subscribe(() => ok.push(1))
    await store.add({ deviceId: 'a' })
    assert.equal(ok.length, 1)
  })

  it('emits a defensive-copy list', async () => {
    const store = new PairedDevicesStore(memStorage())
    let received = null
    store.subscribe((list) => { received = list })
    await store.add({ deviceId: 'a', label: 'orig' })
    received[0].label = 'mutated'
    const fromGet = await store.get('a')
    assert.equal(fromGet.label, 'orig', 'mutating subscriber argument must not affect the store')
  })
})
