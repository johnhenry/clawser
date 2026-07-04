// clawser-did-key.test.mjs — did:key parser + signature round-trip

import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

import { base58btcDecode, parseDidKey, resolveDidKey } from '../clawser-did-key.mjs'
import { MeshIdentityManager, InMemoryIdentityStorage } from '../clawser-mesh-identity.js'

describe('base58btcDecode', () => {
  it('round-trips 0..255 with known fixed input', () => {
    // base58btc("123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz") roundtrips
    // through encode→decode but we only have decode here. Instead, use known
    // pairs from the Bitcoin community (the leading-zero behavior is the
    // tricky part):
    //   "1"      → [0]
    //   "11"     → [0, 0]
    //   "1z"     → [0, 0x39]  (z is index 57 in alphabet)
    assert.deepEqual(base58btcDecode('1'), new Uint8Array([0]))
    assert.deepEqual(base58btcDecode('11'), new Uint8Array([0, 0]))
    assert.deepEqual(base58btcDecode('1z'), new Uint8Array([0, 0x39]))
    assert.deepEqual(base58btcDecode(''), new Uint8Array(0))
  })

  it('throws on invalid characters', () => {
    assert.throws(() => base58btcDecode('hello-world'), /invalid character/)
    assert.throws(() => base58btcDecode('I'), /invalid character/) // I is not in alphabet
    assert.throws(() => base58btcDecode('O'), /invalid character/)
    assert.throws(() => base58btcDecode('0'), /invalid character/) // 0 is not in alphabet
  })

  it('throws on non-string input', () => {
    assert.throws(() => base58btcDecode(null), /must be a string/)
    assert.throws(() => base58btcDecode(123), /must be a string/)
  })
})

describe('parseDidKey', () => {
  it('rejects non-did inputs', () => {
    assert.throws(() => parseDidKey('not-a-did'), /not a did:key URI/)
    assert.throws(() => parseDidKey('did:web:example.com'), /not a did:key URI/)
  })

  it('rejects non-z multibase prefix', () => {
    assert.throws(() => parseDidKey('did:key:m1234'), /multibase "z"/)
  })

  it('rejects garbage payloads', () => {
    assert.throws(() => parseDidKey('did:key:z!!!'), /base58btc decode failed/)
  })

  it('rejects unsupported multicodec', () => {
    // Build a did:key for a P-256 key (multicodec 0x80 0x24) — should be rejected
    const fakeBytes = new Uint8Array(34); fakeBytes[0] = 0x80; fakeBytes[1] = 0x24;
    const enc = (b) => {
      const A = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz'
      let zeros = 0; while (zeros < b.length && b[zeros] === 0) zeros++
      const arr = Array.from(b); const out = []; let start = zeros
      while (start < arr.length) {
        let r = 0
        for (let i = start; i < arr.length; i++) {
          const acc = r * 256 + arr[i]; arr[i] = Math.floor(acc / 58); r = acc % 58
        }
        out.push(A[r])
        while (start < arr.length && arr[start] === 0) start++
      }
      let p = ''; for (let i = 0; i < zeros; i++) p += A[0]
      return p + out.reverse().join('')
    }
    assert.throws(() => parseDidKey('did:key:z' + enc(fakeBytes)), /unsupported multicodec/)
  })

  it('rejects wrong byte length', () => {
    // Multicodec OK but only 1 key byte → 3 bytes total
    const A = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz'
    const tiny = new Uint8Array([0xed, 0x01, 0x42])
    const enc = (b) => {
      let zeros = 0; while (zeros < b.length && b[zeros] === 0) zeros++
      const arr = Array.from(b); const out = []; let start = zeros
      while (start < arr.length) {
        let r = 0
        for (let i = start; i < arr.length; i++) {
          const acc = r * 256 + arr[i]; arr[i] = Math.floor(acc / 58); r = acc % 58
        }
        out.push(A[r])
        while (start < arr.length && arr[start] === 0) start++
      }
      let p = ''; for (let i = 0; i < zeros; i++) p += A[0]
      return p + out.reverse().join('')
    }
    assert.throws(() => parseDidKey('did:key:z' + enc(tiny)), /expected 34 bytes/)
  })
})

// ── Round-trip with MeshIdentityManager ───────────────────────────

describe('resolveDidKey ↔ MeshIdentityManager.toDID round-trip', () => {
  it('verifies a signature made by an identity created via MeshIdentityManager', async () => {
    const mgr = new MeshIdentityManager(new InMemoryIdentityStorage())
    const summary = await mgr.create('test')
    const did = summary.did
    assert.match(did, /^did:key:z/)
    // Resolve the DID back to a CryptoKey
    const verifyKey = await resolveDidKey(did)
    assert.equal(verifyKey.algorithm.name, 'Ed25519')
    assert.equal(verifyKey.usages.includes('verify'), true)

    // Sign something using the identity's private key
    const identityEntry = mgr._test_getEntry?.(summary.podId)
      || mgr.list().find(s => s.podId === summary.podId)
    // We don't have direct access to the private key from outside;
    // use the wallet/manager's signature surface if it has one. Otherwise
    // manually fish out the CryptoKey via export.
    const internal = await new Promise((resolve, reject) => {
      // Reach in through a small helper: the identity manager exposes
      // export() which gives us the JWK, and we can re-import as a
      // signing key for the test.
      mgr.export(summary.podId).then(resolve, reject)
    })
    const privKey = await crypto.subtle.importKey('jwk', internal, { name: 'Ed25519' }, false, ['sign'])
    const data = new TextEncoder().encode('hello, world')
    const signature = await crypto.subtle.sign({ name: 'Ed25519' }, privKey, data)
    const ok = await crypto.subtle.verify({ name: 'Ed25519' }, verifyKey, signature, data)
    assert.equal(ok, true)
  })

  it('a different identity\'s signature does NOT verify against the first DID', async () => {
    const mgr = new MeshIdentityManager(new InMemoryIdentityStorage())
    const a = await mgr.create('a')
    const b = await mgr.create('b')
    const aDidKey = await resolveDidKey(a.did)
    const bJwk = await mgr.export(b.podId)
    const bPriv = await crypto.subtle.importKey('jwk', bJwk, { name: 'Ed25519' }, false, ['sign'])
    const sig = await crypto.subtle.sign({ name: 'Ed25519' }, bPriv, new TextEncoder().encode('x'))
    const ok = await crypto.subtle.verify({ name: 'Ed25519' }, aDidKey, sig, new TextEncoder().encode('x'))
    assert.equal(ok, false, 'signature from b must not verify against a')
  })
})
