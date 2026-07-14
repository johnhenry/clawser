// clawser-deploy-package.test.mjs

import { describe, it, beforeEach } from 'node:test'
import assert from 'node:assert/strict'

import {
  buildSignedPackage,
  verifySignedPackage,
  canonicalJson,
  sha256Hex,
  ReplayCounterTracker,
} from '../clawser-deploy-package.mjs'

const enc = new TextEncoder()
const memStorage = () => {
  const map = new Map()
  return { async read(k) { return map.has(k) ? map.get(k) : null }, async write(k, v) { map.set(k, v) }, _map: map }
}

async function genIdentity() {
  const kp = await crypto.subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify'])
  return kp
}
const FAKE_DID = 'did:key:z6Mkfake'

describe('canonicalJson', () => {
  it('sorts object keys deterministically', () => {
    assert.equal(
      canonicalJson({ b: 1, a: { d: 4, c: 3 } }),
      '{"a":{"c":3,"d":4},"b":1}',
    )
  })
  it('preserves array order', () => {
    assert.equal(canonicalJson([3, 1, 2]), '[3,1,2]')
  })
  it('refuses cycles', () => {
    const o = {}; o.self = o
    assert.throws(() => canonicalJson(o), /cycle/)
  })
})

describe('sha256Hex', () => {
  it('matches known vector for "abc"', async () => {
    const hash = await sha256Hex('abc')
    assert.equal(hash, 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad')
  })
  it('accepts Uint8Array', async () => {
    assert.equal(await sha256Hex(enc.encode('abc')), await sha256Hex('abc'))
  })
})

describe('buildSignedPackage / verifySignedPackage — happy path', () => {
  it('round-trips through JSON and verifies', async () => {
    const { privateKey, publicKey } = await genIdentity()
    const pkg = await buildSignedPackage({
      source: FAKE_DID, privateKey, counter: 1,
      manifest: {
        sourceLabel: 'My Mac',
        items: [{ kind: 'skill', itemId: 's1' }],
        capabilities: { fs: ['/tmp/'], net: [], mesh: [] },
        createdAt: 1234,
      },
      payloads: { s1: enc.encode('hello world') },
    })
    // Strip Uint8Array → array → Uint8Array (simulates JSON over wire)
    const wire = JSON.parse(JSON.stringify(pkg, (_k, v) =>
      v instanceof Uint8Array ? Array.from(v) : v,
    ))
    wire.payloads.s1 = new Uint8Array(wire.payloads.s1)
    const r = await verifySignedPackage(wire, publicKey)
    assert.equal(r.ok, true)
    assert.equal(typeof r.manifestHash, 'string')
  })
})

describe('verifySignedPackage — failures', () => {
  it('rejects unknown version', async () => {
    const { publicKey } = await genIdentity()
    const r = await verifySignedPackage({ v: 'clawser-deploy-v999' }, publicKey)
    assert.equal(r.ok, false)
    assert.match(r.reason, /version/)
  })

  it('rejects malformed source', async () => {
    const { publicKey } = await genIdentity()
    const r = await verifySignedPackage({ v: 'clawser-deploy-v1', source: 'not-a-did' }, publicKey)
    assert.equal(r.ok, false)
  })

  it('rejects mutated manifest (signature mismatch)', async () => {
    const { privateKey, publicKey } = await genIdentity()
    const pkg = await buildSignedPackage({
      source: FAKE_DID, privateKey, counter: 1,
      manifest: { sourceLabel: 'A', items: [{ kind: 'skill', itemId: 's1' }], capabilities: {}, createdAt: 1 },
      payloads: { s1: enc.encode('x') },
    })
    pkg.manifest.sourceLabel = 'B' // tampered
    const r = await verifySignedPackage(pkg, publicKey)
    assert.equal(r.ok, false)
    assert.match(r.reason, /signature mismatch/)
  })

  it('rejects mutated payload (hash mismatch)', async () => {
    const { privateKey, publicKey } = await genIdentity()
    const pkg = await buildSignedPackage({
      source: FAKE_DID, privateKey, counter: 1,
      manifest: { sourceLabel: 'A', items: [{ kind: 'skill', itemId: 's1' }], capabilities: {}, createdAt: 1 },
      payloads: { s1: enc.encode('original') },
    })
    pkg.payloads.s1 = enc.encode('tampered')
    const r = await verifySignedPackage(pkg, publicKey)
    assert.equal(r.ok, false)
    assert.match(r.reason, /payload hash mismatch/)
  })

  it('rejects against the wrong public key', async () => {
    const { privateKey } = await genIdentity()
    const { publicKey: wrongPub } = await genIdentity()
    const pkg = await buildSignedPackage({
      source: FAKE_DID, privateKey, counter: 1,
      manifest: { sourceLabel: 'A', items: [{ kind: 'skill', itemId: 's1' }], capabilities: {}, createdAt: 1 },
      payloads: { s1: enc.encode('x') },
    })
    const r = await verifySignedPackage(pkg, wrongPub)
    assert.equal(r.ok, false)
  })

  it('rejects when payload is missing', async () => {
    const { privateKey, publicKey } = await genIdentity()
    const pkg = await buildSignedPackage({
      source: FAKE_DID, privateKey, counter: 1,
      manifest: { sourceLabel: 'A', items: [{ kind: 'skill', itemId: 's1' }], capabilities: {}, createdAt: 1 },
      payloads: { s1: enc.encode('x') },
    })
    delete pkg.payloads.s1
    const r = await verifySignedPackage(pkg, publicKey)
    assert.equal(r.ok, false)
    assert.match(r.reason, /missing payload/)
  })
})

describe('ReplayCounterTracker', () => {
  let storage, tracker
  beforeEach(() => { storage = memStorage(); tracker = new ReplayCounterTracker(storage) })

  it('accepts an unseen source/counter', async () => {
    assert.equal(await tracker.accept('did:1', 1), true)
    assert.equal(await tracker.lastSeen('did:1'), 1)
  })

  it('rejects equal counter as replay', async () => {
    await tracker.accept('did:1', 5)
    assert.equal(await tracker.accept('did:1', 5), false)
  })

  it('rejects lower counter as replay', async () => {
    await tracker.accept('did:1', 5)
    assert.equal(await tracker.accept('did:1', 3), false)
  })

  it('accepts higher counter and updates', async () => {
    await tracker.accept('did:1', 5)
    assert.equal(await tracker.accept('did:1', 6), true)
    assert.equal(await tracker.lastSeen('did:1'), 6)
  })

  it('tracks per-source independently', async () => {
    await tracker.accept('did:1', 10)
    assert.equal(await tracker.accept('did:2', 1), true)
    assert.equal(await tracker.lastSeen('did:1'), 10)
    assert.equal(await tracker.lastSeen('did:2'), 1)
  })

  it('persists across instances', async () => {
    await tracker.accept('did:1', 7)
    const t2 = new ReplayCounterTracker(storage)
    assert.equal(await t2.lastSeen('did:1'), 7)
    assert.equal(await t2.accept('did:1', 7), false)
  })

  it('survives a corrupted file by resetting', async () => {
    storage._map.set('__deploy_counters__', enc.encode('not json'))
    const t2 = new ReplayCounterTracker(storage)
    assert.equal(await t2.lastSeen('did:1'), -1)
  })
})
