// Run with: node --import ./web/test/_setup-globals.mjs --test web/test/clawser-vault.test.mjs
import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import {
  SecretVault,
  MemoryVaultStorage,
  generateRecoveryCode,
} from '../clawser-vault.js';

describe('generateRecoveryCode', () => {
  it('produces grouped codes in the expected format', () => {
    const code = generateRecoveryCode();
    assert.match(code, /^[A-Z2-9]{4}(-[A-Z2-9]{4}){4}$/);
  });

  it('produces unique codes', () => {
    const codes = new Set(Array.from({ length: 20 }, () => generateRecoveryCode()));
    assert.equal(codes.size, 20);
  });
});

describe('SecretVault recovery codes', () => {
  let vault;

  beforeEach(async () => {
    vault = new SecretVault(new MemoryVaultStorage());
    await vault.verify('original-passphrase-9!');
    await vault.store('apikey-openai', 'sk-secret-123');
  });

  it('hasRecovery is false before setup, true after', async () => {
    assert.equal(await vault.hasRecovery(), false);
    await vault.setupRecovery();
    assert.equal(await vault.hasRecovery(), true);
  });

  it('recoverWithCode rekeys the vault to a new passphrase', async () => {
    const code = await vault.setupRecovery();
    vault.lock();

    const result = await vault.recoverWithCode(code, 'brand-new-passphrase-7?');
    assert.equal(result.success, true);
    assert.ok(result.recoveryCode, 'issues a fresh recovery code');
    assert.notEqual(result.recoveryCode, code);

    // Secrets survive the recovery
    assert.equal(await vault.retrieve('apikey-openai'), 'sk-secret-123');

    // New passphrase unlocks; the old one no longer verifies
    vault.lock();
    assert.equal(await vault.verify('brand-new-passphrase-7?'), true);
    assert.equal(await vault.retrieve('apikey-openai'), 'sk-secret-123');
    vault.lock();
    assert.equal(await vault.verify('original-passphrase-9!'), false);
  });

  it('recoverWithCode tolerates lowercase and missing dashes', async () => {
    const code = await vault.setupRecovery();
    vault.lock();

    const sloppy = code.toLowerCase().replace(/-/g, ' ');
    const result = await vault.recoverWithCode(sloppy, 'next-passphrase-3#');
    assert.equal(result.success, true);
  });

  it('rejects a wrong recovery code and leaves the vault intact', async () => {
    await vault.setupRecovery();
    vault.lock();

    const result = await vault.recoverWithCode('AAAA-AAAA-AAAA-AAAA-AAAA', 'x');
    assert.equal(result.success, false);

    assert.equal(await vault.verify('original-passphrase-9!'), true);
    assert.equal(await vault.retrieve('apikey-openai'), 'sk-secret-123');
  });

  it('fails cleanly when recovery was never configured', async () => {
    const result = await vault.recoverWithCode('AAAA-AAAA-AAAA-AAAA-AAAA', 'x');
    assert.equal(result.success, false);
    assert.match(result.error, /recovery/i);
  });

  it('list() hides internal vault entries', async () => {
    await vault.setupRecovery();
    const names = await vault.list();
    assert.deepEqual(names, ['apikey-openai']);
  });
});

describe('SecretVault.destroy', () => {
  it('removes every entry including internal ones and locks the vault', async () => {
    const storage = new MemoryVaultStorage();
    const vault = new SecretVault(storage);
    await vault.verify('some-passphrase-1!');
    await vault.store('apikey-a', 'secret-a');
    await vault.setupRecovery();

    await vault.destroy();

    assert.equal(vault.isLocked, true);
    assert.deepEqual(await storage.list(), []);
    assert.equal(await vault.exists(), false);
  });

  it('allows creating a fresh vault afterwards', async () => {
    const storage = new MemoryVaultStorage();
    const vault = new SecretVault(storage);
    await vault.verify('first-pass-9$');
    await vault.store('k', 'v');
    await vault.destroy();

    // New passphrase creates a brand-new vault; old secrets are gone
    assert.equal(await vault.verify('second-pass-3#'), true);
    await assert.rejects(() => vault.retrieve('k'), /not found/i);
  });
});
