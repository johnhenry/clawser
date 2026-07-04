// clawser-pairing.test.mjs

import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

import {
  generatePairingCode,
  createPairingPayload,
  parsePairingPayload,
  consumePairingPayload,
  createMemoryPairingStorage,
  _internals,
} from '../clawser-pairing.mjs'

// Generate a test JWK using subtle (Node 22 supports Ed25519).
async function makeJwk() {
  const kp = await crypto.subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify'])
  return crypto.subtle.exportKey('jwk', kp.privateKey)
}

describe('generatePairingCode', () => {
  it('returns a 6-digit string', () => {
    for (let i = 0; i < 50; i++) {
      const c = generatePairingCode()
      assert.equal(typeof c, 'string')
      assert.match(c, /^\d{6}$/)
    }
  })
  it('is uniformly distributed across the digit space (smoke)', () => {
    const counts = new Map()
    for (let i = 0; i < 200; i++) counts.set(generatePairingCode(), true)
    // 200 trials should yield ~200 distinct codes (very high prob; allow for
    // one collision)
    assert.ok(counts.size >= 199)
  })
})

describe('createPairingPayload / parsePairingPayload', () => {
  it('round-trips an envelope through text encoding', async () => {
    const jwk = await makeJwk()
    const code = '042042'
    const text = await createPairingPayload({ identityJwk: jwk, code, sourceLabel: 'Mac', identityLabel: 'me@mac' })
    assert.match(text, /^CLAWSER-PAIR:/)
    const env = parsePairingPayload(text)
    assert.equal(env.v, _internals.PAIRING_VERSION)
    assert.equal(env.sourceLabel, 'Mac')
    assert.equal(env.identityLabel, 'me@mac')
    assert.equal(typeof env.pairingId, 'string')
    assert.equal(typeof env.expiresAt, 'number')
  })

  it('rejects non-pairing text', () => {
    assert.throws(() => parsePairingPayload('not a payload'), /Not a Clawser pairing payload/)
  })

  it('rejects malformed payload', () => {
    assert.throws(() => parsePairingPayload('CLAWSER-PAIR:not-base64!!!'), /malformed/i)
  })

  it('rejects unknown version', () => {
    const bogus = btoa(JSON.stringify({ v: 'clawser-pair-v999' }))
    assert.throws(() => parsePairingPayload('CLAWSER-PAIR:' + bogus), /Unsupported/)
  })
})

describe('consumePairingPayload — happy path', () => {
  it('decrypts and returns the identity JWK', async () => {
    const jwk = await makeJwk()
    const code = '042042'
    const text = await createPairingPayload({ identityJwk: jwk, code, sourceLabel: 'Mac' })
    const env = parsePairingPayload(text)
    const result = await consumePairingPayload(env, code, { storage: createMemoryPairingStorage() })
    assert.deepEqual(result.identityJwk, jwk)
    assert.equal(result.sourceLabel, 'Mac')
    assert.equal(result.pairingId, env.pairingId)
  })
})

describe('consumePairingPayload — error paths', () => {
  it('rejects an expired payload', async () => {
    const jwk = await makeJwk()
    const code = '111111'
    const past = 1_000_000
    const text = await createPairingPayload({
      identityJwk: jwk, code, ttlMs: 1000, now: () => past,
    })
    const env = parsePairingPayload(text)
    await assert.rejects(
      () => consumePairingPayload(env, code, { now: () => past + 5000 }),
      /expired/,
    )
  })

  it('rejects a wrong pairing code', async () => {
    const jwk = await makeJwk()
    const text = await createPairingPayload({ identityJwk: jwk, code: '111111' })
    const env = parsePairingPayload(text)
    await assert.rejects(
      () => consumePairingPayload(env, '222222', { storage: createMemoryPairingStorage() }),
      /Wrong pairing code/,
    )
  })

  it('rejects malformed code (non-digits)', async () => {
    const env = { v: _internals.PAIRING_VERSION, pairingId: 'x', createdAt: 0, expiresAt: Date.now() + 1000, salt: '', iv: '', ciphertext: '' }
    await assert.rejects(() => consumePairingPayload(env, 'abcdef', {}), /6-digit/)
  })

  it('refuses replay on the same storage', async () => {
    const jwk = await makeJwk()
    const code = '333333'
    const text = await createPairingPayload({ identityJwk: jwk, code })
    const env = parsePairingPayload(text)
    const storage = createMemoryPairingStorage()
    await consumePairingPayload(env, code, { storage })
    await assert.rejects(
      () => consumePairingPayload(env, code, { storage }),
      /already consumed/,
    )
  })

  it('a new storage allows the same payload (different device, fair)', async () => {
    const jwk = await makeJwk()
    const code = '444444'
    const text = await createPairingPayload({ identityJwk: jwk, code })
    const env = parsePairingPayload(text)
    await consumePairingPayload(env, code, { storage: createMemoryPairingStorage() })
    const result = await consumePairingPayload(env, code, { storage: createMemoryPairingStorage() })
    assert.deepEqual(result.identityJwk, jwk)
  })

  it('caps the consumed-id list at 200 entries', async () => {
    const storage = createMemoryPairingStorage()
    const seed = []
    for (let i = 0; i < 300; i++) seed.push(`seed-${i}`)
    await storage.write('__paired_consumed_ids__', JSON.stringify(seed))
    const jwk = await makeJwk()
    const text = await createPairingPayload({ identityJwk: jwk, code: '555555' })
    const env = parsePairingPayload(text)
    await consumePairingPayload(env, '555555', { storage })
    const stored = JSON.parse(await storage.read('__paired_consumed_ids__'))
    assert.ok(stored.length <= 200, `got ${stored.length}`)
    // The newly-consumed id must be present
    assert.ok(stored.includes(env.pairingId))
  })
})
