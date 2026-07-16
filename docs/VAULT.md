# Vault — wrapped-DEK with multiple unlock paths

The vault stores API keys, OAuth tokens, and other secrets entirely in
the browser using OPFS. Encryption is AES-GCM-256. As of 2026-05-03, the
on-disk format is **v2** — a wrapped-DEK model where one master data key
encrypts every secret and is itself wrapped by one or more KEKs (key-
encryption keys), each derived from a different unlock material:
passphrase today, WebAuthn PRF passkeys today, future kinds tomorrow.

Source: `web/clawser-vault.js`, `web/clawser-passkey.mjs`,
`web/clawser-vault-settings.js`.

## Why wrapped-DEK

The previous v1 design derived an AES-GCM key from the passphrase via
PBKDF2 and used that key directly to encrypt every secret. Three painful
consequences:

1. Changing the passphrase required reading every secret, decrypting
   with the old key, re-encrypting with the new key, and writing all
   files back. With many secrets that's a lot of I/O and a lot of ways
   to leave the vault in a partial state.
2. There was no way to add a second unlock path (e.g. a passkey) — the
   passphrase was structurally welded to the data.
3. Recovery (forgotten passphrase) was impossible — the passphrase-derived
   key was the only unlock path, so there was no way to add a recovery
   code or passkey as a second way in.

In v2 the DEK is generated once at vault creation and kept stable. The
DEK encrypts secrets. KEKs (one per unlock path) wrap the DEK. Rotating
a passphrase rewraps the DEK; secret bytes never move. Adding a passkey
adds a new wrap entry with no other change. A forgotten passphrase
loses one unlock path, not the vault — provided another wrap exists.

## On-disk format (v2)

OPFS directory `clawser_vault/` contains:

| File | Contents |
|------|----------|
| `__vault_meta__.enc` | Plain JSON (no encryption — the DEK material it points at *is* encrypted). Schema below. |
| `{secret-name}.enc` | `[iv (12 bytes)] [AES-GCM ciphertext]`, encrypted with the DEK. |
| `{secret-name}.next.enc` | Optional. Staged ciphertext written during a v1→v2 migration. Reader prefers `.next` over `{name}` until cleanup runs. |
| `__vault_salt__.enc` | Legacy v1 salt. Removed during v1→v2 migration cleanup. Harmless if it lingers. |

> The `.enc` suffix is appended automatically by `OPFSVaultStorage`'s
> name → file convention. The vault code refers to entries by their
> logical name (`__vault_meta__`, `apikey-openai`, etc.).

### Meta schema

```json
{
  "version": 2,
  "createdAt": 1714665600000,
  "prfSalt": "<base64 32 bytes — present only after a passkey is added>",
  "wraps": [
    {
      "id": "p-lk2tnkzx-A1B2C3D4",
      "kind": "passphrase",
      "label": null,
      "createdAt": 1714665600000,
      "lastUsedAt": 1714665700000,
      "iv": "<base64 12 bytes>",
      "wrappedDek": "<base64 ~48 bytes — wrapped DEK + GCM tag>",
      "salt": "<base64 16 bytes>",
      "iterations": 600000
    },
    {
      "id": "pk-lk2tnozt-X9Y8Z7W6",
      "kind": "passkey",
      "label": "MacBook Touch ID",
      "createdAt": 1714665800000,
      "lastUsedAt": null,
      "iv": "<base64 12 bytes>",
      "wrappedDek": "<base64 ~48 bytes>",
      "credentialId": "<base64 — WebAuthn credential id>"
    }
  ]
}
```

`prfSalt` is **vault-level**, shared across every passkey wrap. The PRF
output is per-(credential, salt) deterministic, so one shared salt is
sufficient and lets every passkey unlock without per-wrap salt
coordination. It is created lazily on the first `getOrCreatePrfSalt()` call.

Wraps also come in a third `kind`, `"recovery"` — see
[Recovery codes](#recovery-codes) below. A recovery wrap has the same
shape as a passphrase wrap (`iv`, `wrappedDek`, `salt`, `iterations`),
just derived from a generated code instead of a user passphrase.

## Unlock paths

### Passphrase

`vault.unlock(passphrase)` walks every `kind === 'passphrase'` wrap and
attempts to unwrap the DEK with a KEK derived from
`PBKDF2-SHA256(passphrase, wrap.salt, wrap.iterations)`. The first wrap
that unwraps successfully wins. If none do, `Invalid passphrase` is
thrown.

A brand-new vault is created lazily on first unlock with the passphrase
the user supplies.

### Passkey (WebAuthn PRF)

`vault.unlockWithPasskey(credentialId, prfOutput)` matches the supplied
`credentialId` against passkey wraps and attempts to unwrap the DEK with
`AES-GCM` derived directly from the 32-byte PRF output. The PRF is
evaluated against the vault-level `prfSalt` during the WebAuthn assertion;
caller obtains both via `vault.peekPasskeyCredentialIds()` and
`vault.peekPrfSalt()` before unlock.

The full unlock dance is:

```js
const allow = await vault.peekPasskeyCredentialIds();
const prfSalt = await vault.peekPrfSalt();
const { credentialId, prfOutput } = await assertPasskeyForUnlock({
  allowCredentialIds: allow, prfSalt,
});
await vault.unlockWithPasskey(credentialId, prfOutput);
```

`assertPasskeyForUnlock` (in `clawser-passkey.mjs`) wraps
`navigator.credentials.get` with the `prf: { eval: { first: prfSalt } }`
extension. If the chosen authenticator does not return PRF output, the
helper throws with a clear error.

## Enrollment (passkey)

```js
const prfSalt = await vault.getOrCreatePrfSalt();
const { credentialId, prfOutput, label } = await enrollPasskey({
  prfSalt, label: 'MacBook Touch ID',
});
await vault.addPasskeyWrap({ credentialId, prfOutput, label });
```

`enrollPasskey` calls `navigator.credentials.create` with
`prf: { eval: { first: prfSalt } }`. **If the chosen authenticator does
not advertise PRF support in its extension result, enrollment is
rejected immediately** with a message guiding the user to a different
passkey — we do not register a credential that will fail to unlock
later.

The browser must support WebAuthn and PRF. Probe with
`isPasskeyPRFSupported()` before showing UI.

## Changing the passphrase

`vault.changePassphrase(oldPassphrase, newPassphrase)`:

1. Verify the old passphrase by unwrapping the DEK with the existing
   wrap (this is constant-time relative to KEK derivation only — the
   PBKDF2 work is unavoidable).
2. Derive a new KEK from `newPassphrase` + a fresh salt.
3. Wrap the existing DEK with the new KEK.
4. Replace every `kind === 'passphrase'` wrap with the new one.
5. Persist `__vault_meta__`.

**Secrets are not touched.** Passkey wraps are unaffected. The DEK is
not rotated — only the wrap that protects it changes. `VaultRekeyer` is
a thin compatibility wrapper around `changePassphrase`.

The UI surface is the "Change passphrase" button in the vault settings
panel (gear icon → Change passphrase). The form requires a new
passphrase of at least 12 characters that differs from the old one.

## Removing an unlock path

`vault.removeWrap(wrapId)` deletes a wrap entry. The vault refuses to
remove the last unlock path — once you've enrolled a second one, you
can rotate either. The UI shows a confirm before removal.

## Recovery codes

Recovery codes **are** shipped, as a third wrap `kind`. A code looks like
`K3PF-9XQW-M2VH-T7RD-J4NB` (5 groups of 4 characters from an alphabet
that excludes `0/O/1/I/L` for unambiguous hand-typing, ~99 bits of
entropy) and is generated by `generateRecoveryCode()`.

- `vault.setupRecovery()` generates a fresh code, wraps the DEK with a
  KEK derived from `PBKDF2-SHA256(normalizedCode, freshSalt)`, replaces
  any existing `kind === 'recovery'` wrap with it, and returns the code.
  It is shown to the user **exactly once**, immediately after a new
  vault is created (in the "Save your recovery code" dialog) — it is
  never stored in plaintext.
- `vault.hasRecovery()` reports whether a recovery wrap exists; works
  while the vault is locked, so the unlock modal can conditionally show
  a "Recover" button.
- `vault.recoverWithCode(code, newPassphrase)` unwraps the DEK via the
  recovery wrap, replaces every `kind === 'passphrase'` wrap with one
  derived from `newPassphrase`, then calls `setupRecovery()` again to
  issue and return a **new** code (the used one is rotated out — codes
  are single-use). Secrets are not re-encrypted, only wraps change.

The UI surface is the "Recover" button on the vault unlock modal
(`clawser-app.js`): it prompts for the code and a new passphrase, calls
`recoverWithCode`, and shows the freshly rotated code in an alert the
user must save before continuing.

## Migration from v1

The v1 format is detected by the presence of `__vault_salt__.enc` and
the absence of `__vault_meta__.enc`. On the first `unlock(passphrase)`
of a v1 vault:

1. Read every secret, decrypt with the v1 PBKDF2-derived key.
2. Generate a new DEK; build a passphrase wrap around it with a fresh
   salt.
3. Stage every secret as `{name}.next.enc`, encrypted with the DEK.
4. Write `__vault_meta__.enc`. **This is the commit point** — a single
   atomic OPFS write.
5. Replace each `{name}.enc` with the bytes from `{name}.next.enc`,
   then delete `{name}.next.enc`.
6. Delete `__vault_salt__.enc` and the legacy `__vault_canary__.enc`.

If the process crashes:

| Crash point | State on disk | Recovery |
|-------------|---------------|----------|
| Before step 4 | v1 salt + v1 secrets, possibly some orphan `.next` files | Next unlock retries the migration; orphan `.next` files are harmlessly overwritten. |
| Between step 4 and step 5 | v2 meta + `.next` files staged + stale v1 secret bytes at canonical names | `retrieve()` checks `{name}.next` before `{name}`, so v2 reads decrypt correctly. Cleanup completes on next operation. |
| Mid-step 5 | v2 meta + some secrets swapped, some still under `.next` | Same as above — `.next` fallback covers the not-yet-swapped half. |
| After step 5, before step 6 | v2 meta + all secrets canonical, leftover `__vault_salt__.enc` / canary | Harmless. Cleaned up on next migration attempt or ignored. |

Wrong passphrase aborts before step 4, leaving v1 state untouched.

## Backup and last-resort reset

For users who want an off-device backup, the vault settings panel
(gear icon) exposes **Export vault backup**, which emits a JSON file
containing base64-encoded copies of every `clawser_vault/*.enc` blob,
and a matching **import** to restore them into OPFS on another device.
Without a working unlock path (passphrase, passkey, or recovery code)
the export is useless to anyone else; restore it onto a new device and
unlock with one of the original unlock paths.

If every unlock path is lost (forgotten passphrase, no recovery code
saved, no passkey), the same settings panel's **Reset all data** wipes
localStorage, OPFS, IndexedDB, the Cache API, and registered service
workers, then reloads — there's nothing on a remote server this app
could use to restore a vault whose unlock material is entirely gone.
A narrower **Reset Vault** button (vault-only, not all app data) is
also offered from the unlock modal after a failed unlock attempt.
