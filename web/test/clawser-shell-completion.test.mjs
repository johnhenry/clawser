// Run with: node --import ./web/test/_setup-globals.mjs --test web/test/clawser-shell-completion.test.mjs
import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

globalThis.BrowserTool = globalThis.BrowserTool || class { constructor() {} };

import { ClawserShell, MemoryFs } from '../clawser-shell.js';

describe('ClawserShell.complete', () => {
  let shell;

  beforeEach(async () => {
    const fs = new MemoryFs();
    await fs.writeFile('/docs/readme.md', 'x');
    await fs.writeFile('/docs/notes.txt', 'x');
    await fs.writeFile('/data.json', 'x');
    await fs.mkdir('/downloads');
    await fs.writeFile('/.hidden', 'x');
    shell = new ClawserShell({ fs });
  });

  describe('command completion', () => {
    it('completes builtin command names for the first word', async () => {
      const result = await shell.complete('ech');
      assert.deepEqual(result.completions, ['echo ']);
      assert.equal(result.insert, 'echo ');
      assert.equal(result.replaceStart, 0);
    });

    it('returns multiple candidates with a common-prefix insert', async () => {
      const result = await shell.complete('un');
      // unalias + unset + uniq at minimum
      assert.ok(result.completions.length >= 2);
      assert.ok(result.completions.every(c => c.startsWith('un')));
      assert.equal(result.insert, 'un');
    });

    it('includes aliases in command completion', async () => {
      shell.state.aliases.set('deploy-all', 'echo deploying');
      const result = await shell.complete('deploy');
      assert.deepEqual(result.completions, ['deploy-all ']);
    });

    it('includes defined functions in command completion', async () => {
      shell.state.functions = new Map([['greet_user', {}]]);
      const result = await shell.complete('greet');
      assert.deepEqual(result.completions, ['greet_user ']);
    });

    it('completes commands after a pipe', async () => {
      const result = await shell.complete('cat /data.json | ech');
      assert.deepEqual(result.completions, ['echo ']);
      assert.equal(result.replaceStart, 'cat /data.json | '.length);
    });

    it('completes commands after && and ;', async () => {
      assert.deepEqual((await shell.complete('ls && ech')).completions, ['echo ']);
      assert.deepEqual((await shell.complete('ls; ech')).completions, ['echo ']);
    });
  });

  describe('path completion', () => {
    it('completes file paths as command arguments', async () => {
      const result = await shell.complete('cat /docs/re');
      assert.deepEqual(result.completions, ['/docs/readme.md ']);
      assert.equal(result.insert, '/docs/readme.md ');
      assert.equal(result.replaceStart, 'cat '.length);
    });

    it('marks directories with a trailing slash', async () => {
      const result = await shell.complete('cd /down');
      assert.deepEqual(result.completions, ['/downloads/']);
    });

    it('lists all entries in a directory for an empty base token', async () => {
      const result = await shell.complete('ls /docs/');
      const names = result.completions.sort();
      assert.deepEqual(names, ['/docs/notes.txt ', '/docs/readme.md ']);
    });

    it('completes relative paths from the cwd', async () => {
      await shell.exec('cd /docs');
      const result = await shell.complete('cat re');
      assert.deepEqual(result.completions, ['readme.md ']);
    });

    it('hides dotfiles unless the token starts with a dot', async () => {
      const all = await shell.complete('cat /');
      assert.ok(!all.completions.some(c => c.includes('.hidden')));

      const dotted = await shell.complete('cat /.hi');
      assert.deepEqual(dotted.completions, ['/.hidden ']);
    });

    it('returns empty for non-existent directories', async () => {
      const result = await shell.complete('cat /nope/file');
      assert.deepEqual(result.completions, []);
      assert.equal(result.insert, '/nope/file');
    });
  });

  it('returns empty completions for no matches', async () => {
    const result = await shell.complete('zzzznothing');
    assert.deepEqual(result.completions, []);
    assert.equal(result.insert, 'zzzznothing');
  });

  it('completes at a mid-line cursor position', async () => {
    const line = 'ech | grep x';
    const result = await shell.complete(line, 3); // cursor after 'ech'
    assert.deepEqual(result.completions, ['echo ']);
    assert.equal(result.replaceStart, 0);
  });
});
