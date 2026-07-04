// clawser-vault-v2.test.mjs — wrapped-DEK + multi-wrap + migration

import { describe, it, beforeEach } from 'node:test'
import assert from 'node:assert/strict'

import {
  SecretVault,
  MemoryVaultStorage,
  VaultRekeyer,
  generateDek,
  wrapDek,
  unwrapDek,
  deriveKekFromPassphrase,
  deriveKekFromPrf,
  deriveKey,
  encryptSecret,
} from '../clawser-vault.js'

const PASS_A = 'correct horse battery staple'
const PASS_B = 'tr0ub4dor & 3 brevity penalty'

// ── Crypto primitive round-trips ──────────────────────────────────

describe('wrapped-DEK primitives', () => {
  it('generateDek returns an extractable AES-GCM key', async () => {
    const dek = await generateDek()
    assert.equal(dek.algorithm.name, 'AES-GCM')
    assert.equal(dek.extractable, true)
  })

  it('wrap → unwrap with matching KEK round-trips the DEK', async () => {
    const dek = await generateDek()
    const salt = crypto.getRandomValues(new Uint8Array(16))
    const kek = await deriveKekFromPassphrase(PASS_A, salt, 1000)
    const wrap = await wrapDek(dek, kek)
    const unwrapped = await unwrapDek(wrap, kek)
    // Compare raw bytes — wrapKey/unwrapKey should round-trip exactly
    const a = await crypto.subtle.exportKey('raw', dek)
    const b = await crypto.subtle.exportKey('raw', unwrapped)
    assert.deepEqual(new Uint8Array(a), new Uint8Array(b))
  })

  it('unwrap with wrong KEK throws', async () => {
    const dek = await generateDek()
    const salt = crypto.getRandomValues(new Uint8Array(16))
    const kekA = await deriveKekFromPassphrase(PASS_A, salt, 1000)
    const kekB = await deriveKekFromPassphrase(PASS_B, salt, 1000)
    const wrap = await wrapDek(dek, kekA)
    await assert.rejects(() => unwrapDek(wrap, kekB))
  })

  it('PRF-derived KEK can wrap and unwrap a DEK', async () => {
    const dek = await generateDek()
    const prfOutput = crypto.getRandomValues(new Uint8Array(32))
    const kek = await deriveKekFromPrf(prfOutput)
    const wrap = await wrapDek(dek, kek)
    const unwrapped = await unwrapDek(wrap, kek)
    const a = new Uint8Array(await crypto.subtle.exportKey('raw', dek))
    const b = new Uint8Array(await crypto.subtle.exportKey('raw', unwrapped))
    assert.deepEqual(a, b)
  })

  it('deriveKekFromPrf rejects undersized inputs', async () => {
    await assert.rejects(() => deriveKekFromPrf(new Uint8Array(16)), /at least 32/)
  })
})

// ── New v2 vault — happy path ─────────────────────────────────────

describe('SecretVault v2 — basic store/retrieve', () => {
  it('creating a brand-new vault writes meta and stores a secret', async () => {
    const storage = new MemoryVaultStorage()
    const vault = new SecretVault(storage)
    assert.equal(await vault.exists(), false)
    await vault.unlock(PASS_A)
    assert.equal(await vault.exists(), true)
    await vault.store('apikey-openai', 'sk-test')
    assert.equal(await vault.retrieve('apikey-openai'), 'sk-test')
    // Meta is on disk
    assert.notEqual(await storage.read('__vault_meta__'), null)
  })

  it('lock then unlock with correct passphrase recovers all secrets', async () => {
    const storage = new MemoryVaultStorage()
    const v1 = new SecretVault(storage)
    await v1.unlock(PASS_A)
    await v1.store('a', 'one')
    await v1.store('b', 'two')
    v1.lock()
    const v2 = new SecretVault(storage)
    await v2.unlock(PASS_A)
    assert.equal(await v2.retrieve('a'), 'one')
    assert.equal(await v2.retrieve('b'), 'two')
  })

  it('unlock with wrong passphrase throws', async () => {
    const storage = new MemoryVaultStorage()
    const v1 = new SecretVault(storage)
    await v1.unlock(PASS_A)
    await v1.store('a', 'one')
    v1.lock()
    const v2 = new SecretVault(storage)
    await assert.rejects(() => v2.unlock(PASS_B), /Invalid passphrase/)
  })

  it('list excludes reserved entries (meta + .next)', async () => {
    const storage = new MemoryVaultStorage()
    const vault = new SecretVault(storage)
    await vault.unlock(PASS_A)
    await vault.store('a', '1')
    await vault.store('b', '2')
    // Sneak a stale `.next` into storage to confirm filter
    await storage.write('a.next', new Uint8Array([1, 2, 3]))
    const list = await vault.list()
    assert.deepEqual(list.sort(), ['a', 'b'])
  })

  it('store/retrieve/delete reject reserved names', async () => {
    const storage = new MemoryVaultStorage()
    const vault = new SecretVault(storage)
    await vault.unlock(PASS_A)
    await assert.rejects(() => vault.store('__vault_meta__', 'x'), /Reserved/)
    await assert.rejects(() => vault.retrieve('__vault_meta__'), /Reserved/)
    await assert.rejects(() => vault.delete('__vault_meta__'), /Reserved/)
  })

  it('verify(passphrase) returns true on match and unlocks the vault', async () => {
    const storage = new MemoryVaultStorage()
    const v1 = new SecretVault(storage)
    await v1.unlock(PASS_A)
    await v1.store('a', '1')
    v1.lock()
    const v2 = new SecretVault(storage)
    assert.equal(await v2.verify(PASS_A), true)
    assert.equal(v2.isLocked, false)
  })

  it('verify(passphrase) returns false on mismatch and leaves the vault locked', async () => {
    const storage = new MemoryVaultStorage()
    const v1 = new SecretVault(storage)
    await v1.unlock(PASS_A)
    v1.lock()
    const v2 = new SecretVault(storage)
    assert.equal(await v2.verify(PASS_B), false)
    assert.equal(v2.isLocked, true)
  })
})

// ── changePassphrase + VaultRekeyer ──────────────────────────────

describe('SecretVault v2 — changePassphrase', () => {
  it('rotates the passphrase wrap without re-encrypting secrets', async () => {
    const storage = new MemoryVaultStorage()
    const v = new SecretVault(storage)
    await v.unlock(PASS_A)
    await v.store('apikey', 'sk-1')
    const beforeBytes = await storage.read('apikey')
    await v.changePassphrase(PASS_A, PASS_B)
    const afterBytes = await storage.read('apikey')
    assert.deepEqual(afterBytes, beforeBytes,
      'secret bytes must be untouched — only the DEK wrap changed')
    v.lock()
    const v2 = new SecretVault(storage)
    await v2.unlock(PASS_B)
    assert.equal(await v2.retrieve('apikey'), 'sk-1')
  })

  it('rejects an incorrect old passphrase', async () => {
    const storage = new MemoryVaultStorage()
    const v = new SecretVault(storage)
    await v.unlock(PASS_A)
    await assert.rejects(() => v.changePassphrase('wrong', PASS_B), /Old passphrase/)
    // Original passphrase still works
    v.lock()
    await v.unlock(PASS_A)
  })

  it('VaultRekeyer.execute calls changePassphrase on a real v2 vault', async () => {
    const storage = new MemoryVaultStorage()
    const v = new SecretVault(storage)
    await v.unlock(PASS_A)
    await v.store('a', '1')
    const rekeyer = new VaultRekeyer(v)
    const result = await rekeyer.execute(PASS_A, PASS_B)
    assert.equal(result.success, true)
    assert.equal(result.rekeyed, 1)
    v.lock()
    const v2 = new SecretVault(storage)
    await v2.unlock(PASS_B)
    assert.equal(await v2.retrieve('a'), '1')
  })

  it('VaultRekeyer.execute returns failure when old passphrase is wrong', async () => {
    const storage = new MemoryVaultStorage()
    const v = new SecretVault(storage)
    await v.unlock(PASS_A)
    const rekeyer = new VaultRekeyer(v)
    const result = await rekeyer.execute('wrong', PASS_B)
    assert.equal(result.success, false)
    assert.match(result.error, /Old passphrase/)
  })
})

// ── Multi-wrap: passkey enrollment + unlock ──────────────────────

describe('SecretVault v2 — passkey wraps', () => {
  it('addPasskeyWrap appends a wrap entry without re-encrypting secrets', async () => {
    const storage = new MemoryVaultStorage()
    const v = new SecretVault(storage)
    await v.unlock(PASS_A)
    await v.store('apikey', 'sk-1')
    const before = await storage.read('apikey')

    const credentialId = crypto.getRandomValues(new Uint8Array(16))
    const prfOutput = crypto.getRandomValues(new Uint8Array(32))
    const { id } = await v.addPasskeyWrap({ credentialId, prfOutput, label: 'YubiKey' })
    assert.match(id, /^pk-/)

    const after = await storage.read('apikey')
    assert.deepEqual(after, before)

    const wraps = v.listWraps()
    assert.equal(wraps.length, 2)
    assert.equal(wraps.find(w => w.kind === 'passkey').label, 'YubiKey')
  })

  it('unlockWithPasskey decrypts after a fresh load', async () => {
    const storage = new MemoryVaultStorage()
    const v = new SecretVault(storage)
    await v.unlock(PASS_A)
    await v.store('apikey', 'sk-1')

    const credentialId = crypto.getRandomValues(new Uint8Array(16))
    const prfOutput = crypto.getRandomValues(new Uint8Array(32))
    await v.addPasskeyWrap({ credentialId, prfOutput, label: null })
    v.lock()

    const v2 = new SecretVault(storage)
    await v2.unlockWithPasskey(credentialId, prfOutput)
    assert.equal(v2.isLocked, false)
    assert.equal(await v2.retrieve('apikey'), 'sk-1')
  })

  it('unlockWithPasskey throws on wrong PRF output', async () => {
    const storage = new MemoryVaultStorage()
    const v = new SecretVault(storage)
    await v.unlock(PASS_A)
    const credentialId = crypto.getRandomValues(new Uint8Array(16))
    const prfOutput = crypto.getRandomValues(new Uint8Array(32))
    await v.addPasskeyWrap({ credentialId, prfOutput })
    v.lock()
    const v2 = new SecretVault(storage)
    const wrongPrf = crypto.getRandomValues(new Uint8Array(32))
    await assert.rejects(() => v2.unlockWithPasskey(credentialId, wrongPrf), /No matching passkey wrap|invalid/)
  })

  it('unlockWithPasskey throws on unknown credentialId', async () => {
    const storage = new MemoryVaultStorage()
    const v = new SecretVault(storage)
    await v.unlock(PASS_A)
    const credentialId = crypto.getRandomValues(new Uint8Array(16))
    const prfOutput = crypto.getRandomValues(new Uint8Array(32))
    await v.addPasskeyWrap({ credentialId, prfOutput })
    v.lock()
    const v2 = new SecretVault(storage)
    const otherCred = crypto.getRandomValues(new Uint8Array(16))
    await assert.rejects(() => v2.unlockWithPasskey(otherCred, prfOutput), /No matching passkey wrap/)
  })

  it('multiple passkey wraps coexist; unlock picks the matching one', async () => {
    const storage = new MemoryVaultStorage()
    const v = new SecretVault(storage)
    await v.unlock(PASS_A)
    const credA = crypto.getRandomValues(new Uint8Array(16))
    const prfA = crypto.getRandomValues(new Uint8Array(32))
    const credB = crypto.getRandomValues(new Uint8Array(16))
    const prfB = crypto.getRandomValues(new Uint8Array(32))
    await v.addPasskeyWrap({ credentialId: credA, prfOutput: prfA, label: 'A' })
    await v.addPasskeyWrap({ credentialId: credB, prfOutput: prfB, label: 'B' })
    v.lock()
    const v2 = new SecretVault(storage)
    await v2.unlockWithPasskey(credB, prfB)
    assert.equal(v2.isLocked, false)
  })
})

// ── removeWrap ────────────────────────────────────────────────────

describe('SecretVault v2 — removeWrap', () => {
  it('removes a passkey wrap by id', async () => {
    const storage = new MemoryVaultStorage()
    const v = new SecretVault(storage)
    await v.unlock(PASS_A)
    const { id } = await v.addPasskeyWrap({
      credentialId: crypto.getRandomValues(new Uint8Array(16)),
      prfOutput: crypto.getRandomValues(new Uint8Array(32)),
    })
    assert.equal(v.listWraps().length, 2)
    await v.removeWrap(id)
    assert.equal(v.listWraps().length, 1)
  })

  it('refuses to remove the last unlock path', async () => {
    const storage = new MemoryVaultStorage()
    const v = new SecretVault(storage)
    await v.unlock(PASS_A)
    const wraps = v.listWraps()
    assert.equal(wraps.length, 1)
    await assert.rejects(() => v.removeWrap(wraps[0].id), /last unlock path/)
  })

  it('throws on unknown wrap id', async () => {
    const storage = new MemoryVaultStorage()
    const v = new SecretVault(storage)
    await v.unlock(PASS_A)
    await assert.rejects(() => v.removeWrap('p-doesnotexist'), /No such wrap/)
  })
})

// ── v1 → v2 migration ────────────────────────────────────────────

/**
 * Build a v1-format vault in `storage` so we can test load-time migration
 * without depending on an actual v1 instance class. Uses the legacy
 * `deriveKey` + `encryptSecret` path that was the only thing on disk
 * before the v2 refactor.
 */
async function seedV1Vault(storage, passphrase, secrets) {
  const salt = crypto.getRandomValues(new Uint8Array(16))
  await storage.write('__vault_salt__', salt)
  const key = await deriveKey(passphrase, salt)
  for (const [name, value] of Object.entries(secrets)) {
    const { iv, ciphertext } = await encryptSecret(value, key)
    const packed = new Uint8Array(12 + ciphertext.length)
    packed.set(iv, 0)
    packed.set(ciphertext, 12)
    await storage.write(name, packed)
  }
  // Drop a stale canary so we can verify migration ignores it
  const canary = await encryptSecret('clawser-vault-ok', key)
  const canaryPacked = new Uint8Array(12 + canary.ciphertext.length)
  canaryPacked.set(canary.iv, 0)
  canaryPacked.set(canary.ciphertext, 12)
  await storage.write('__vault_canary__', canaryPacked)
}

describe('SecretVault v2 — migration from v1', () => {
  it('migrates a v1 vault on first unlock and decrypts secrets', async () => {
    const storage = new MemoryVaultStorage()
    await seedV1Vault(storage, PASS_A, { 'apikey-openai': 'sk-1', 'apikey-anthropic': 'sk-2' })
    assert.notEqual(await storage.read('__vault_salt__'), null,
      'precondition: v1 salt is present')

    const v = new SecretVault(storage)
    await v.unlock(PASS_A)
    assert.equal(await v.retrieve('apikey-openai'), 'sk-1')
    assert.equal(await v.retrieve('apikey-anthropic'), 'sk-2')

    // Post-migration: meta exists, salt removed, canary removed.
    assert.notEqual(await storage.read('__vault_meta__'), null)
    assert.equal(await storage.read('__vault_salt__'), null)
    assert.equal(await storage.read('__vault_canary__'), null)
  })

  it('rejects v1 migration with wrong passphrase without touching disk', async () => {
    const storage = new MemoryVaultStorage()
    await seedV1Vault(storage, PASS_A, { 'apikey': 'sk-1' })
    const beforeSalt = await storage.read('__vault_salt__')
    const beforeSecret = await storage.read('apikey')

    const v = new SecretVault(storage)
    await assert.rejects(() => v.unlock(PASS_B), /Invalid passphrase/)

    // No meta written, salt + secret bytes unchanged
    assert.equal(await storage.read('__vault_meta__'), null)
    assert.deepEqual(await storage.read('__vault_salt__'), beforeSalt)
    assert.deepEqual(await storage.read('apikey'), beforeSecret)
  })

  it('a re-load after migration uses the v2 path (no salt → no migration)', async () => {
    const storage = new MemoryVaultStorage()
    await seedV1Vault(storage, PASS_A, { 'apikey': 'sk-1' })
    const v1 = new SecretVault(storage)
    await v1.unlock(PASS_A)
    v1.lock()
    // Now confirm second instance unlocks via v2 path
    const v2 = new SecretVault(storage)
    await v2.unlock(PASS_A)
    assert.equal(await v2.retrieve('apikey'), 'sk-1')
    // And changePassphrase works (v2 only) — proves we're in v2 mode
    await v2.changePassphrase(PASS_A, PASS_B)
  })

  it('crash before commit (failing storage) leaves v1 state intact', async () => {
    // Storage that fails on the meta write, simulating a crash exactly at
    // the commit point. Pre-commit `.next` writes are allowed; afterward
    // any further write throws.
    const inner = new MemoryVaultStorage()
    let failOnMeta = false
    const storage = {
      async read(name) { return inner.read(name) },
      async write(name, packed) {
        if (failOnMeta && name === '__vault_meta__') throw new Error('simulated crash')
        return inner.write(name, packed)
      },
      async remove(name) { return inner.remove(name) },
      async list() { return inner.list() },
    }
    await seedV1Vault(storage, PASS_A, { 'a': '1', 'b': '2' })

    failOnMeta = true
    const v = new SecretVault(storage)
    await assert.rejects(() => v.unlock(PASS_A), /simulated crash/)

    // Recovery: salt still there, meta absent, secret bytes still v1.
    assert.notEqual(await storage.read('__vault_salt__'), null)
    assert.equal(await storage.read('__vault_meta__'), null)

    // A fresh instance with the original storage (no crash injection)
    // can still decrypt — we can re-run migration cleanly.
    const v2 = new SecretVault(inner)
    await v2.unlock(PASS_A)
    assert.equal(await v2.retrieve('a'), '1')
    assert.equal(await v2.retrieve('b'), '2')
  })

  it('crash after commit but before cleanup is recoverable via .next fallback', async () => {
    // Run a normal migration, but simulate a crash between meta write and
    // the post-commit per-secret swap by manually preserving `.next` files
    // and reverting `{name}` to old bytes.
    const storage = new MemoryVaultStorage()
    await seedV1Vault(storage, PASS_A, { 'a': '1' })
    const oldSecretBytes = await storage.read('a')

    // Run migration
    const v = new SecretVault(storage)
    await v.unlock(PASS_A)
    v.lock()

    // Simulate "crash mid-cleanup": write old v1 bytes back to `a`, but
    // keep `.next` populated. (We need to reconstruct `.next` since clean
    // migration removes it — write the v2 bytes that retrieve('a') returned.)
    // Easier: seed a synthetic post-commit-pre-cleanup state by hand.
    const storage2 = new MemoryVaultStorage()
    // Seed v2 meta + `a.next` = v2 bytes, while `a` = v1 stale bytes.
    const v3 = new SecretVault(storage2)
    await v3.unlock(PASS_A)
    await v3.store('a', '1')
    const v2Bytes = await storage2.read('a')
    const meta = await storage2.read('__vault_meta__')
    v3.lock()

    // Build the post-commit-pre-cleanup mess
    const messy = new MemoryVaultStorage()
    await messy.write('__vault_meta__', meta)
    await messy.write('a', oldSecretBytes)        // stale v1 bytes (won't decrypt)
    await messy.write('a.next', v2Bytes)           // canonical v2 bytes (will decrypt)

    const v4 = new SecretVault(messy)
    await v4.unlock(PASS_A)
    assert.equal(await v4.retrieve('a'), '1')
  })
})

// ── Misc / hardening ─────────────────────────────────────────────

describe('SecretVault v2 — hardening', () => {
  it('migrateKeysToVault still moves localStorage values into the vault', async () => {
    const storage = new MemoryVaultStorage()
    const v = new SecretVault(storage)
    await v.unlock(PASS_A)
    // Quick localStorage stub so we can drive migrateKeysToVault from node
    const ls = new Map([['my-key', 'my-value'], ['other', 'thing']])
    const originalLS = globalThis.localStorage
    globalThis.localStorage = {
      getItem: (k) => ls.get(k) ?? null,
      removeItem: (k) => { ls.delete(k) },
    }
    try {
      const n = await v.migrateKeysToVault(['my-key', 'other', 'absent'])
      assert.equal(n, 2)
      assert.equal(await v.retrieve('my-key'), 'my-value')
      assert.equal(ls.has('my-key'), false)
    } finally {
      globalThis.localStorage = originalLS
    }
  })

  it('lock then store throws Vault is locked', async () => {
    const v = new SecretVault(new MemoryVaultStorage())
    await v.unlock(PASS_A)
    v.lock()
    await assert.rejects(() => v.store('a', 'b'), /locked/)
  })

  it('listWraps on a locked vault returns empty', () => {
    const v = new SecretVault(new MemoryVaultStorage())
    assert.deepEqual(v.listWraps(), [])
  })

  it('addPasskeyWrap fails when locked', async () => {
    const v = new SecretVault(new MemoryVaultStorage())
    await assert.rejects(
      () => v.addPasskeyWrap({
        credentialId: new Uint8Array(16),
        prfOutput: new Uint8Array(32),
      }),
      /locked/,
    )
  })
})
