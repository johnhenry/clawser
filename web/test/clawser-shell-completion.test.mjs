// Run with: node --import ./web/test/_setup-globals.mjs --test web/test/clawser-shell-completion.test.mjs
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { CommandRegistry, MemoryFs, getCompletions, registerBuiltins } from '../clawser-shell.js';

const buildRegistry = () => {
  const r = new CommandRegistry();
  registerBuiltins(r);
  return r;
};

describe('getCompletions — command-name position', () => {
  it('completes a partial builtin name', async () => {
    const r = buildRegistry();
    const result = await getCompletions('ec', 2, { registry: r });
    assert.equal(result.token, 'ec');
    assert.equal(result.start, 0);
    assert.equal(result.end, 2);
    assert.ok(result.suggestions.includes('echo'));
    // All suggestions must start with the prefix
    for (const s of result.suggestions) assert.ok(s.startsWith('ec'));
  });

  it('returns the empty suggestion set when no command matches', async () => {
    const r = buildRegistry();
    const result = await getCompletions('zzzzz', 5, { registry: r });
    assert.deepEqual(result.suggestions, []);
  });

  it('returns all builtins when token is empty (cursor at start)', async () => {
    const r = buildRegistry();
    const result = await getCompletions('', 0, { registry: r });
    assert.ok(result.suggestions.length > 5);
  });

  it('treats a token starting after whitespace as command position when cursor is on it', async () => {
    const r = buildRegistry();
    // "  ec" with cursor at 4 → first non-whitespace token, command position
    const result = await getCompletions('  ec', 4, { registry: r });
    assert.ok(result.suggestions.includes('echo'));
  });
});

describe('getCompletions — path position', () => {
  const buildFs = async () => {
    const fs = new MemoryFs();
    await fs.writeFile('/tmp/clawser/a.txt', 'a');
    await fs.writeFile('/tmp/clawser/abc.txt', 'abc');
    await fs.writeFile('/tmp/clawser/zzz.txt', 'z');
    await fs.mkdir('/tmp/clawser/sub');
    await fs.writeFile('/tmp/clawser/sub/inner.txt', 'inner');
    return fs;
  };

  it('completes a path fragment within an absolute directory', async () => {
    const r = buildRegistry();
    const fs = await buildFs();
    // `cat /tmp/clawser/a` with cursor at end: complete the path token.
    const input = 'cat /tmp/clawser/a';
    const result = await getCompletions(input, input.length, { registry: r, fs });
    assert.ok(result.suggestions.includes('/tmp/clawser/a.txt'));
    assert.ok(result.suggestions.includes('/tmp/clawser/abc.txt'));
    assert.ok(!result.suggestions.includes('/tmp/clawser/zzz.txt'));
  });

  it('completes a directory entry with a trailing slash', async () => {
    const r = buildRegistry();
    const fs = await buildFs();
    const input = 'cat /tmp/clawser/s';
    const result = await getCompletions(input, input.length, { registry: r, fs });
    assert.ok(result.suggestions.includes('/tmp/clawser/sub/'));
  });

  it('falls back to empty when fs is missing', async () => {
    const r = buildRegistry();
    const input = 'cat /tmp/something';
    const result = await getCompletions(input, input.length, { registry: r });
    assert.deepEqual(result.suggestions, []);
  });

  it('completes relative-to-cwd paths', async () => {
    const r = buildRegistry();
    const fs = await buildFs();
    const result = await getCompletions('cat a', 'cat a'.length, {
      registry: r, fs, cwd: '/tmp/clawser',
    });
    // a.txt and abc.txt both start with 'a'
    assert.ok(result.suggestions.includes('a.txt'));
    assert.ok(result.suggestions.includes('abc.txt'));
  });

  it('returns empty when the directory does not exist', async () => {
    const r = buildRegistry();
    const fs = await buildFs();
    const input = 'cat /nope/x';
    const result = await getCompletions(input, input.length, { registry: r, fs });
    assert.deepEqual(result.suggestions, []);
  });
});
