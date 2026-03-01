// Tests for clawser-codex.js (code parsing) and clawser-vault.js (crypto + passphrase strength)
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

// ── 1. extractCodeBlocks (5 tests) ─────────────────────────────

describe('Codex code extraction', () => {
  let extractCodeBlocks, stripCodeBlocks, Codex;

  it('loads exports', async () => {
    const mod = await import('../clawser-codex.js');
    extractCodeBlocks = mod.extractCodeBlocks;
    stripCodeBlocks = mod.stripCodeBlocks;
    Codex = mod.Codex;
    assert.ok(extractCodeBlocks);
    assert.ok(stripCodeBlocks);
    assert.ok(Codex);
  });

  it('extractCodeBlocks parses js blocks', () => {
    const blocks = extractCodeBlocks('Here is code:\n```js\nconsole.log("hi")\n```\nDone.');
    assert.equal(blocks.length, 1);
    assert.equal(blocks[0].lang, 'js');
    assert.ok(blocks[0].code.includes('console.log'));
  });

  it('extractCodeBlocks handles multiple blocks', () => {
    const text = '```python\nprint("a")\n```\ntext\n```javascript\nalert("b")\n```';
    const blocks = extractCodeBlocks(text);
    assert.equal(blocks.length, 2);
    assert.equal(blocks[0].lang, 'python');
    assert.equal(blocks[1].lang, 'javascript');
  });

  it('extractCodeBlocks returns empty for no blocks', () => {
    const blocks = extractCodeBlocks('Just plain text, no code here.');
    assert.equal(blocks.length, 0);
  });

  it('stripCodeBlocks removes code blocks', () => {
    const result = stripCodeBlocks('Before\n```js\ncode\n```\nAfter');
    assert.ok(!result.includes('```'));
    assert.ok(result.includes('Before'));
    assert.ok(result.includes('After'));
  });
});

// ── 2. adaptPythonisms (4 tests) ────────────────────────────────

describe('Codex Python adaptation', () => {
  let adaptPythonisms;

  it('loads function', async () => {
    const mod = await import('../clawser-codex.js');
    adaptPythonisms = mod.adaptPythonisms;
    assert.ok(adaptPythonisms);
  });

  it('converts True/False/None to JS equivalents', () => {
    const adapted = adaptPythonisms('x = True; y = False; z = None');
    assert.ok(adapted.includes('true'));
    assert.ok(adapted.includes('false'));
    assert.ok(adapted.includes('null'));
    assert.ok(!adapted.includes('True'));
    assert.ok(!adapted.includes('False'));
    assert.ok(!adapted.includes('None'));
  });

  it('converts f-strings to template literals', () => {
    const adapted = adaptPythonisms('msg = f"Hello {name}"');
    assert.ok(adapted.includes('`'));
  });

  it('preserves non-Python code unchanged', () => {
    const code = 'const x = 1 + 2;';
    const adapted = adaptPythonisms(code);
    assert.equal(adapted, code);
  });

  it('handles mixed Python/JS patterns', () => {
    const adapted = adaptPythonisms('if (True) { x = None; }');
    assert.ok(adapted.includes('true'));
    assert.ok(adapted.includes('null'));
  });
});

// ── 3. autoAwait (3 tests) ──────────────────────────────────────

describe('Codex autoAwait', () => {
  let autoAwait;

  it('loads function', async () => {
    const mod = await import('../clawser-codex.js');
    autoAwait = mod.autoAwait;
    assert.ok(autoAwait);
  });

  it('adds await before print()', () => {
    const result = autoAwait('print("hello")');
    assert.ok(result.includes('await print'));
  });

  it('does not double-await', () => {
    const result = autoAwait('await print("hello")');
    assert.ok(!result.includes('await await'));
  });

  it('adds await before browser_ calls', () => {
    const result = autoAwait('browser_click("#btn")');
    assert.ok(result.includes('await browser_click'));
  });
});

// ── 4. measurePassphraseStrength (6 tests) ──────────────────────

describe('measurePassphraseStrength', () => {
  let measurePassphraseStrength;

  it('loads function', async () => {
    const mod = await import('../clawser-vault.js');
    measurePassphraseStrength = mod.measurePassphraseStrength;
    assert.ok(measurePassphraseStrength);
  });

  it('empty string returns score 0', () => {
    const result = measurePassphraseStrength('');
    assert.equal(result.score, 0);
    assert.equal(result.label, 'none');
  });

  it('short password returns low score', () => {
    const result = measurePassphraseStrength('abc');
    assert.ok(result.score <= 1);
  });

  it('common password is penalized', () => {
    const result = measurePassphraseStrength('password123');
    assert.ok(result.entropy <= 10);
  });

  it('long mixed password scores high', () => {
    const result = measurePassphraseStrength('C0mplex!P@ssphrase#2024');
    assert.ok(result.score >= 3);
    assert.ok(result.label === 'strong' || result.label === 'very strong');
  });

  it('repetitive pattern is penalized', () => {
    const result = measurePassphraseStrength('aaaaaaaaaa');
    const normal = measurePassphraseStrength('abcdefghij');
    assert.ok(result.entropy < normal.entropy);
  });
});

// ── 5. MemoryVaultStorage (5 tests) ─────────────────────────────

describe('MemoryVaultStorage', () => {
  let MemoryVaultStorage;

  it('loads class', async () => {
    const mod = await import('../clawser-vault.js');
    MemoryVaultStorage = mod.MemoryVaultStorage;
    assert.ok(MemoryVaultStorage);
  });

  it('read returns null for missing key', async () => {
    const storage = new MemoryVaultStorage();
    const result = await storage.read('nonexistent');
    assert.equal(result, null);
  });

  it('write and read round-trip', async () => {
    const storage = new MemoryVaultStorage();
    const data = new Uint8Array([1, 2, 3, 4, 5]);
    await storage.write('test', data);
    const result = await storage.read('test');
    assert.deepEqual(result, data);
  });

  it('remove deletes a key', async () => {
    const storage = new MemoryVaultStorage();
    await storage.write('key', new Uint8Array([10]));
    await storage.remove('key');
    assert.equal(await storage.read('key'), null);
  });

  it('list returns all keys', async () => {
    const storage = new MemoryVaultStorage();
    await storage.write('a', new Uint8Array([1]));
    await storage.write('b', new Uint8Array([2]));
    const keys = await storage.list();
    assert.ok(keys.includes('a'));
    assert.ok(keys.includes('b'));
    assert.equal(keys.length, 2);
  });
});

// ── 6. SecretVault with MemoryVaultStorage (5 tests) ────────────

describe('SecretVault', () => {
  let SecretVault, MemoryVaultStorage;

  it('loads classes', async () => {
    const mod = await import('../clawser-vault.js');
    SecretVault = mod.SecretVault;
    MemoryVaultStorage = mod.MemoryVaultStorage;
    assert.ok(SecretVault);
  });

  it('starts locked', () => {
    const vault = new SecretVault(new MemoryVaultStorage());
    assert.equal(vault.isLocked, true);
  });

  it('unlock makes vault unlocked', async () => {
    const vault = new SecretVault(new MemoryVaultStorage());
    await vault.unlock('test-passphrase');
    assert.equal(vault.isLocked, false);
  });

  it('store and retrieve round-trip', async () => {
    const vault = new SecretVault(new MemoryVaultStorage());
    await vault.unlock('my-secret-passphrase');
    await vault.store('api-key', 'sk-abc123');
    const retrieved = await vault.retrieve('api-key');
    assert.equal(retrieved, 'sk-abc123');
  });

  it('lock prevents retrieval', async () => {
    const vault = new SecretVault(new MemoryVaultStorage());
    await vault.unlock('passphrase');
    await vault.store('key1', 'value1');
    vault.lock();
    assert.equal(vault.isLocked, true);
    await assert.rejects(() => vault.retrieve('key1'), /locked/i);
  });
});
