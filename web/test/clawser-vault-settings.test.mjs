// clawser-vault-settings.test.mjs — change-passphrase UI logic
// (DOM-free helpers — `validateChangePassphraseInput` and
//  `performChangePassphrase`. The panel-wiring side of the module is
//  the same legacy code that has no unit-test surface.)

import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

import {
  validateChangePassphraseInput,
  performChangePassphrase,
  buildPasskeyListItems,
} from '../clawser-vault-settings.js'

import { SecretVault, MemoryVaultStorage } from '../clawser-vault.js'

const PASS_OLD = 'correct horse battery staple'
const PASS_NEW = 'tr0ub4dor & 3 brevity penalty'

describe('validateChangePassphraseInput', () => {
  it('returns null on a valid form', () => {
    const r = validateChangePassphraseInput({
      oldPassphrase: 'old-something-long',
      newPassphrase: 'new-passphrase-longer',
      confirmPassphrase: 'new-passphrase-longer',
    })
    assert.equal(r, null)
  })

  it('errors on missing old passphrase', () => {
    assert.match(
      validateChangePassphraseInput({ oldPassphrase: '', newPassphrase: 'x'.repeat(12), confirmPassphrase: 'x'.repeat(12) }),
      /Current passphrase/,
    )
  })

  it('errors on missing new passphrase', () => {
    assert.match(
      validateChangePassphraseInput({ oldPassphrase: 'old', newPassphrase: '', confirmPassphrase: '' }),
      /New passphrase is required/,
    )
  })

  it('errors when new passphrase is shorter than 12 characters', () => {
    assert.match(
      validateChangePassphraseInput({ oldPassphrase: 'oldpass', newPassphrase: 'short', confirmPassphrase: 'short' }),
      /at least 12 characters/,
    )
  })

  it('errors when new equals old', () => {
    const same = 'same-passphrase-here'
    assert.match(
      validateChangePassphraseInput({ oldPassphrase: same, newPassphrase: same, confirmPassphrase: same }),
      /must differ/,
    )
  })

  it('errors when new and confirm differ', () => {
    assert.match(
      validateChangePassphraseInput({
        oldPassphrase: 'old',
        newPassphrase: 'new-passphrase-long',
        confirmPassphrase: 'mismatched-passphrase',
      }),
      /do not match/,
    )
  })
})

describe('performChangePassphrase — happy path', () => {
  it('changes passphrase on an unlocked vault', async () => {
    const vault = new SecretVault(new MemoryVaultStorage())
    await vault.unlock(PASS_OLD)
    const r = await performChangePassphrase(vault, {
      oldPassphrase: PASS_OLD,
      newPassphrase: PASS_NEW,
      confirmPassphrase: PASS_NEW,
    })
    assert.equal(r.ok, true)
    // Confirm: old passphrase no longer works, new one does
    vault.lock()
    assert.equal(await vault.verify(PASS_OLD), false)
    assert.equal(await vault.verify(PASS_NEW), true)
  })

  it('unlocks first when called on a locked vault', async () => {
    const storage = new MemoryVaultStorage()
    const v1 = new SecretVault(storage)
    await v1.unlock(PASS_OLD)
    v1.lock()
    const v2 = new SecretVault(storage)
    assert.equal(v2.isLocked, true)
    const r = await performChangePassphrase(v2, {
      oldPassphrase: PASS_OLD,
      newPassphrase: PASS_NEW,
      confirmPassphrase: PASS_NEW,
    })
    assert.equal(r.ok, true)
  })
})

describe('performChangePassphrase — error paths', () => {
  it('reports invalid current passphrase', async () => {
    const storage = new MemoryVaultStorage()
    const v = new SecretVault(storage)
    await v.unlock(PASS_OLD)
    v.lock()
    const r = await performChangePassphrase(v, {
      oldPassphrase: 'wrong-current-passphrase',
      newPassphrase: PASS_NEW,
      confirmPassphrase: PASS_NEW,
    })
    assert.equal(r.ok, false)
    assert.match(r.error, /Current passphrase is incorrect/)
  })

  it('returns the same vault state on validation failure (no side effects)', async () => {
    const v = new SecretVault(new MemoryVaultStorage())
    await v.unlock(PASS_OLD)
    const r = await performChangePassphrase(v, {
      oldPassphrase: PASS_OLD,
      newPassphrase: 'short',
      confirmPassphrase: 'short',
    })
    assert.equal(r.ok, false)
    assert.match(r.error, /at least 12/)
    // Vault still works with original passphrase
    v.lock()
    assert.equal(await v.verify(PASS_OLD), true)
  })

  it('passes through changePassphrase errors', async () => {
    // Inject a vault stub whose changePassphrase always throws.
    const stub = {
      isLocked: false,
      changePassphrase: async () => { throw new Error('storage write failed') },
    }
    const r = await performChangePassphrase(stub, {
      oldPassphrase: 'old-passphrase-long',
      newPassphrase: 'new-passphrase-longer',
      confirmPassphrase: 'new-passphrase-longer',
    })
    assert.equal(r.ok, false)
    assert.match(r.error, /storage write failed/)
  })
})

describe('buildPasskeyListItems', () => {
  const fmt = (ts) => `T${ts}`

  it('filters out non-passkey wraps', () => {
    const items = buildPasskeyListItems([
      { id: 'p-1', kind: 'passphrase', label: null, createdAt: 1, lastUsedAt: 2 },
      { id: 'pk-1', kind: 'passkey', label: 'Mac', createdAt: 3, lastUsedAt: 4 },
    ], fmt)
    assert.equal(items.length, 1)
    assert.equal(items[0].id, 'pk-1')
  })

  it('uses an "Unlabeled passkey" fallback when label is null', () => {
    const items = buildPasskeyListItems([
      { id: 'pk-1', kind: 'passkey', label: null, createdAt: 1, lastUsedAt: null },
    ], fmt)
    assert.equal(items[0].label, 'Unlabeled passkey')
  })

  it('formats lastUsed via the injected formatter when present', () => {
    const items = buildPasskeyListItems([
      { id: 'pk-1', kind: 'passkey', label: 'Mac', createdAt: 1, lastUsedAt: 9999 },
    ], fmt)
    assert.equal(items[0].lastUsedLabel, 'Last used T9999')
  })

  it('shows "Never used" when lastUsedAt is null', () => {
    const items = buildPasskeyListItems([
      { id: 'pk-1', kind: 'passkey', label: 'Mac', createdAt: 1, lastUsedAt: null },
    ], fmt)
    assert.equal(items[0].lastUsedLabel, 'Never used')
  })

  it('returns an empty array when no passkey wraps exist', () => {
    assert.deepEqual(buildPasskeyListItems([], fmt), [])
    assert.deepEqual(buildPasskeyListItems([
      { id: 'p-1', kind: 'passphrase', label: null, createdAt: 1, lastUsedAt: null },
    ], fmt), [])
  })
})
