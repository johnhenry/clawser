// clawser-passkey.test.mjs — WebAuthn enrollment + assertion via mocks

import { describe, it, beforeEach } from 'node:test'
import assert from 'node:assert/strict'

import {
  isPasskeyPRFSupported,
  enrollPasskey,
  assertPasskeyForUnlock,
  encodeBase64Url,
  decodeBase64Url,
} from '../clawser-passkey.mjs'

import { SecretVault, MemoryVaultStorage } from '../clawser-vault.js'

const PASS = 'correct horse battery staple'

// ── Helpers: build mock WebAuthn responses ────────────────────────

function makeCredential({ rawId, prfFirst, prfEnabled = true }) {
  return {
    rawId: rawId.buffer ?? rawId,
    getClientExtensionResults: () => ({
      prf: { enabled: prfEnabled, results: prfFirst ? { first: prfFirst.buffer ?? prfFirst } : undefined },
    }),
  }
}

// ── Base64URL round-trip ──────────────────────────────────────────

describe('encodeBase64Url / decodeBase64Url', () => {
  it('round-trips arbitrary bytes', () => {
    const orig = crypto.getRandomValues(new Uint8Array(33))
    const enc = encodeBase64Url(orig)
    const dec = decodeBase64Url(enc)
    assert.deepEqual(dec, orig)
  })

  it('produces URL-safe characters with no padding', () => {
    const enc = encodeBase64Url(new Uint8Array([255, 255, 255]))
    assert.equal(/^[A-Za-z0-9_-]+$/.test(enc), true)
    assert.equal(enc.includes('='), false)
  })
})

// ── isPasskeyPRFSupported ─────────────────────────────────────────

describe('isPasskeyPRFSupported', () => {
  it('returns false in node (no navigator.credentials)', () => {
    // _setup-globals stubs `navigator` but not credentials API
    assert.equal(isPasskeyPRFSupported(), false)
  })

  it('returns true when navigator.credentials.create exists and PublicKeyCredential is global', () => {
    // Node's `navigator` is a non-writable getter, so we patch its credentials
    // property in place rather than reassigning the whole object.
    const origCreds = globalThis.navigator?.credentials
    const origPK = globalThis.PublicKeyCredential
    Object.defineProperty(globalThis.navigator, 'credentials', {
      value: { create: () => {}, get: () => {} }, configurable: true,
    })
    globalThis.PublicKeyCredential = function () {}
    try {
      assert.equal(isPasskeyPRFSupported(), true)
    } finally {
      if (origCreds === undefined) delete globalThis.navigator.credentials
      else Object.defineProperty(globalThis.navigator, 'credentials', { value: origCreds, configurable: true })
      delete globalThis.PublicKeyCredential
      if (origPK !== undefined) globalThis.PublicKeyCredential = origPK
    }
  })
})

// ── enrollPasskey ─────────────────────────────────────────────────

describe('enrollPasskey', () => {
  it('passes the prfSalt as eval.first and returns credentialId + prfOutput', async () => {
    const salt = crypto.getRandomValues(new Uint8Array(32))
    const credId = crypto.getRandomValues(new Uint8Array(16))
    const prf = crypto.getRandomValues(new Uint8Array(32))
    let captured = null
    const create = async (opts) => {
      captured = opts
      return makeCredential({ rawId: credId, prfFirst: prf })
    }
    const result = await enrollPasskey({ prfSalt: salt, label: 'YubiKey', _navCredsCreate: create })
    assert.deepEqual(result.credentialId, credId)
    assert.deepEqual(result.prfOutput, prf)
    assert.equal(result.label, 'YubiKey')
    // Confirm the PRF salt was passed correctly
    const pkExt = captured.publicKey.extensions.prf.eval.first
    assert.deepEqual(new Uint8Array(pkExt), salt)
  })

  it('throws when authenticator does not support PRF', async () => {
    const create = async () => makeCredential({
      rawId: new Uint8Array(16),
      prfFirst: null,
      prfEnabled: false,
    })
    await assert.rejects(
      () => enrollPasskey({ prfSalt: new Uint8Array(32), _navCredsCreate: create }),
      /does not support the WebAuthn PRF extension/,
    )
  })

  it('rejects undersized prfSalt', async () => {
    await assert.rejects(
      () => enrollPasskey({ prfSalt: new Uint8Array(8), _navCredsCreate: async () => {} }),
      /32-byte/,
    )
  })

  it('throws when WebAuthn is unavailable', async () => {
    // Patch credentials to undefined; `navigator` itself is a non-writable getter in Node.
    const origCreds = globalThis.navigator?.credentials
    Object.defineProperty(globalThis.navigator, 'credentials', { value: undefined, configurable: true })
    try {
      await assert.rejects(
        () => enrollPasskey({ prfSalt: new Uint8Array(32) }),
        /WebAuthn is not available/,
      )
    } finally {
      if (origCreds === undefined) delete globalThis.navigator.credentials
      else Object.defineProperty(globalThis.navigator, 'credentials', { value: origCreds, configurable: true })
    }
  })

  it('passes the result through end-to-end into vault.addPasskeyWrap', async () => {
    const storage = new MemoryVaultStorage()
    const vault = new SecretVault(storage)
    await vault.unlock(PASS)
    await vault.store('apikey', 'sk-1')

    const salt = await vault.getOrCreatePrfSalt()
    const credId = crypto.getRandomValues(new Uint8Array(16))
    const prf = crypto.getRandomValues(new Uint8Array(32))
    const create = async () => makeCredential({ rawId: credId, prfFirst: prf })
    const enrolled = await enrollPasskey({ prfSalt: salt, label: 'Test', _navCredsCreate: create })
    await vault.addPasskeyWrap({
      credentialId: enrolled.credentialId,
      prfOutput: enrolled.prfOutput,
      label: enrolled.label,
    })

    // Lock + unlock with same PRF output
    vault.lock()
    const v2 = new SecretVault(storage)
    await v2.unlockWithPasskey(enrolled.credentialId, enrolled.prfOutput)
    assert.equal(await v2.retrieve('apikey'), 'sk-1')
  })
})

// ── assertPasskeyForUnlock ────────────────────────────────────────

describe('assertPasskeyForUnlock', () => {
  it('returns credentialId + prfOutput from the assertion', async () => {
    const salt = crypto.getRandomValues(new Uint8Array(32))
    const credId = crypto.getRandomValues(new Uint8Array(16))
    const prf = crypto.getRandomValues(new Uint8Array(32))
    let captured = null
    const get = async (opts) => {
      captured = opts
      return makeCredential({ rawId: credId, prfFirst: prf })
    }
    const result = await assertPasskeyForUnlock({
      allowCredentialIds: [credId],
      prfSalt: salt,
      _navCredsGet: get,
    })
    assert.deepEqual(result.credentialId, credId)
    assert.deepEqual(result.prfOutput, prf)
    // allowCredentials passed correctly
    assert.equal(captured.publicKey.allowCredentials.length, 1)
    assert.equal(captured.publicKey.allowCredentials[0].type, 'public-key')
    assert.deepEqual(new Uint8Array(captured.publicKey.allowCredentials[0].id), credId)
    assert.deepEqual(new Uint8Array(captured.publicKey.extensions.prf.eval.first), salt)
  })

  it('rejects empty allowCredentialIds', async () => {
    await assert.rejects(
      () => assertPasskeyForUnlock({
        allowCredentialIds: [], prfSalt: new Uint8Array(32),
        _navCredsGet: async () => ({}),
      }),
      /No passkeys/,
    )
  })

  it('rejects when authenticator returns no PRF output', async () => {
    const get = async () => makeCredential({ rawId: new Uint8Array(16), prfFirst: null })
    await assert.rejects(
      () => assertPasskeyForUnlock({
        allowCredentialIds: [new Uint8Array(16)],
        prfSalt: new Uint8Array(32),
        _navCredsGet: get,
      }),
      /did not return PRF/,
    )
  })

  it('rejects undersized prfSalt', async () => {
    await assert.rejects(
      () => assertPasskeyForUnlock({
        allowCredentialIds: [new Uint8Array(16)],
        prfSalt: new Uint8Array(8),
        _navCredsGet: async () => ({}),
      }),
      /32-byte/,
    )
  })

  it('end-to-end: assertion output unlocks an enrolled vault', async () => {
    const storage = new MemoryVaultStorage()
    const vault = new SecretVault(storage)
    await vault.unlock(PASS)
    const salt = await vault.getOrCreatePrfSalt()
    const credId = crypto.getRandomValues(new Uint8Array(16))
    const prf = crypto.getRandomValues(new Uint8Array(32))
    const create = async () => makeCredential({ rawId: credId, prfFirst: prf })
    const enrolled = await enrollPasskey({ prfSalt: salt, _navCredsCreate: create })
    await vault.addPasskeyWrap({
      credentialId: enrolled.credentialId,
      prfOutput: enrolled.prfOutput,
    })
    vault.lock()

    // Now an unrelated process kicks off unlock-with-passkey:
    const v2 = new SecretVault(storage)
    const allow = await v2.peekPasskeyCredentialIds()
    const peekedSalt = await v2.peekPrfSalt()
    assert.equal(allow.length, 1)
    assert.deepEqual(allow[0], credId)

    const get = async () => makeCredential({ rawId: credId, prfFirst: prf })
    const asserted = await assertPasskeyForUnlock({
      allowCredentialIds: allow,
      prfSalt: peekedSalt,
      _navCredsGet: get,
    })
    await v2.unlockWithPasskey(asserted.credentialId, asserted.prfOutput)
    assert.equal(v2.isLocked, false)
  })
})
