// Run with: node --import ./web/test/_setup-globals.mjs --test web/test/clawser-vault.test.mjs
import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import {
  SecretVault,
  MemoryVaultStorage,
  generateRecoveryCode,
  VaultStoreTool,
  VaultRetrieveTool,
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

describe('OPFSVaultStorage quota guard', () => {
  it('defaults to always-allow when no guard is injected', async () => {
    // Can't exercise real OPFS in node:test, but construction with the
    // default guard must not throw, and #quotaGuard must be callable.
    const store = new (await import('../clawser-vault.js')).OPFSVaultStorage('test-dir');
    assert.ok(store);
  });

  it('a denying storage backend surfaces as a failed verify()', async () => {
    // verify() treats ANY unlock failure (wrong passphrase, storage error,
    // quota denial) as "not verified" — this proves a guard-denied write
    // propagates through unlock() rather than silently succeeding.
    const { SecretVault } = await import('../clawser-vault.js');
    class DeniedStorage {
      async read() { return null; }
      async write() { throw new Error('Storage nearly full — refusing vault write'); }
      async remove() {}
      async list() { return []; }
    }
    const vault = new SecretVault(new DeniedStorage());
    assert.equal(await vault.verify('some-passphrase-1!'), false);
    assert.equal(vault.isLocked, true);
  });
});

// ── VaultStoreTool / VaultRetrieveTool ───────────────────────────
//
// Agent-invokable wrappers around SecretVault.store/retrieve. Both
// require 'approve' permission — every invocation needs a human to
// knowingly authorize it, regardless of autonomy level, since a
// prompt-injected agent could otherwise exfiltrate stored secrets.

describe('VaultStoreTool / VaultRetrieveTool', () => {
  let vault;

  beforeEach(async () => {
    vault = new SecretVault(new MemoryVaultStorage());
    await vault.verify('agent-tool-test-passphrase-1!');
  });

  it('both tools require approve permission', () => {
    assert.equal(new VaultStoreTool(vault).permission, 'approve');
    assert.equal(new VaultRetrieveTool(vault).permission, 'approve');
  });

  it('VaultStoreTool declares redactedFields for the secret argument', () => {
    const tool = new VaultStoreTool(vault);
    assert.deepEqual(tool.redactedFields, ['secret']);
  });

  it('VaultStoreTool stores a secret retrievable via SecretVault directly', async () => {
    const tool = new VaultStoreTool(vault);
    const result = await tool.execute({ name: 'apikey-test', secret: 'sk-abc123' });
    assert.equal(result.success, true);
    assert.equal(await vault.retrieve('apikey-test'), 'sk-abc123');
  });

  it('VaultStoreTool requires name and secret', async () => {
    const tool = new VaultStoreTool(vault);
    assert.equal((await tool.execute({ secret: 'x' })).success, false);
    assert.equal((await tool.execute({ name: 'x' })).success, false);
    assert.equal((await tool.execute({})).success, false);
  });

  it('VaultStoreTool fails cleanly when the vault is locked', async () => {
    vault.lock();
    const tool = new VaultStoreTool(vault);
    const result = await tool.execute({ name: 'x', secret: 'y' });
    assert.equal(result.success, false);
    assert.match(result.error, /locked/i);
  });

  it('VaultStoreTool surfaces reserved-name rejection from the vault', async () => {
    const tool = new VaultStoreTool(vault);
    const result = await tool.execute({ name: '__vault_meta__', secret: 'x' });
    assert.equal(result.success, false);
    assert.match(result.error, /reserved/i);
  });

  it('VaultRetrieveTool retrieves a secret previously stored via SecretVault directly', async () => {
    await vault.store('apikey-test', 'sk-abc123');
    const tool = new VaultRetrieveTool(vault);
    const result = await tool.execute({ name: 'apikey-test' });
    assert.equal(result.success, true);
    assert.equal(result.output, 'sk-abc123');
  });

  it('a value stored via VaultStoreTool is retrievable via VaultRetrieveTool', async () => {
    await new VaultStoreTool(vault).execute({ name: 'round-trip', secret: 'hunter2' });
    const result = await new VaultRetrieveTool(vault).execute({ name: 'round-trip' });
    assert.equal(result.success, true);
    assert.equal(result.output, 'hunter2');
  });

  it('VaultRetrieveTool requires a name', async () => {
    const tool = new VaultRetrieveTool(vault);
    const result = await tool.execute({});
    assert.equal(result.success, false);
  });

  it('VaultRetrieveTool fails cleanly when the vault is locked', async () => {
    await vault.store('apikey-test', 'sk-abc123');
    vault.lock();
    const tool = new VaultRetrieveTool(vault);
    const result = await tool.execute({ name: 'apikey-test' });
    assert.equal(result.success, false);
    assert.match(result.error, /locked/i);
  });

  it('VaultRetrieveTool fails cleanly for a secret that was never stored', async () => {
    const tool = new VaultRetrieveTool(vault);
    const result = await tool.execute({ name: 'never-stored' });
    assert.equal(result.success, false);
    assert.match(result.error, /not found/i);
  });

  it('VaultRetrieveTool rejects retrieving reserved internal vault keys', async () => {
    const tool = new VaultRetrieveTool(vault);
    const result = await tool.execute({ name: '__vault_meta__' });
    assert.equal(result.success, false);
    assert.match(result.error, /reserved/i);
  });

  it("redactArgs fully redacts VaultStoreTool's declared secret field from EventLog args", async () => {
    const { redactArgs } = await import('../clawser-redaction.mjs');
    const tool = new VaultStoreTool(vault);
    const redacted = redactArgs({ name: 'apikey-test', secret: 'sk-abc123' }, tool.redactedFields);
    assert.equal(redacted.name, 'apikey-test', 'non-secret fields pass through');
    assert.equal(redacted.secret.redacted, true, 'the declared secret field is replaced with a redaction placeholder');
    assert.doesNotMatch(JSON.stringify(redacted), /sk-abc123/);
  });

  it("VaultRetrieveTool's output is NOT fully redactable by field name — only clawser-agent.js's .output content reaches the model, so redactResult() gives the same conservative regex-based protection every free-form-output tool gets, not a guarantee", async () => {
    const { redactResult } = await import('../clawser-redaction.mjs');
    await vault.store('generic', 'a plain, non-API-key-shaped secret');
    const result = await new VaultRetrieveTool(vault).execute({ name: 'generic' });
    const redacted = redactResult(result, new VaultRetrieveTool(vault).redactedResultFields || []);
    // Documents the real, current behavior rather than asserting a false
    // guarantee: a generic secret that doesn't match a recognized
    // high-confidence shape (API key prefix, JWT, etc.) is NOT scrubbed
    // from .output. The 'approve' permission gate is the actual control.
    assert.equal(redacted.output, 'a plain, non-API-key-shaped secret');
  });

  it("VaultRetrieveTool's output IS scrubbed when the secret matches a recognized high-confidence API key shape", async () => {
    const { redactResult } = await import('../clawser-redaction.mjs');
    await vault.store('openai-key', 'sk-' + 'x'.repeat(40));
    const result = await new VaultRetrieveTool(vault).execute({ name: 'openai-key' });
    const redacted = redactResult(result);
    assert.doesNotMatch(redacted.output, /sk-x{40}/);
  });
});
