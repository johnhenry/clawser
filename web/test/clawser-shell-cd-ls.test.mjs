// clawser-shell-cd-ls.test.mjs — Tests for cd/ls bug fixes
// Run with: node --import ./web/test/_setup-globals.mjs --test web/test/clawser-shell-cd-ls.test.mjs

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import {
  MemoryFs,
  ShellState,
  CommandRegistry,
  registerBuiltins,
} from '../clawser-shell.js';

describe('cd / ls bug fixes', () => {
  let fs, state, registry;

  /** Helper: run a builtin command by name */
  async function run(name, args = []) {
    const handler = registry.get(name);
    assert.ok(handler, `command '${name}' should be registered`);
    return handler({ args, state, fs, stdin: '' });
  }

  beforeEach(async () => {
    fs = new MemoryFs();
    // Create a directory structure: /docs/notes/  and  /docs/readme.txt
    await fs.mkdir('/docs');
    await fs.mkdir('/docs/notes');
    await fs.writeFile('/docs/readme.txt', 'hello');
    await fs.writeFile('/root-file.txt', 'top');

    state = new ShellState();
    registry = new CommandRegistry();
    registerBuiltins(registry);
  });

  it('ls after cd shows correct directory contents (not root)', async () => {
    const cdResult = await run('cd', ['docs']);
    assert.equal(cdResult.exitCode, 0);
    assert.equal(state.cwd, '/docs');

    const lsResult = await run('ls');
    assert.equal(lsResult.exitCode, 0);
    // Should list docs contents, not root contents
    assert.ok(lsResult.stdout.includes('notes'), 'should list notes subdir');
    assert.ok(lsResult.stdout.includes('readme.txt'), 'should list readme.txt');
    assert.ok(!lsResult.stdout.includes('root-file.txt'), 'should NOT list root-file.txt');
  });

  it('cd into non-existent directory fails with exitCode 1', async () => {
    const result = await run('cd', ['nonexistent']);
    assert.equal(result.exitCode, 1);
    assert.ok(result.stderr.includes('No such directory'));
    // cwd should remain unchanged
    assert.equal(state.cwd, '/');
  });

  it('cd without fs only allows root', async () => {
    // Simulate no filesystem
    fs = null;
    const result = await run('cd', ['docs']);
    assert.equal(result.exitCode, 1);
    assert.ok(result.stderr.includes('No such directory'));
    assert.equal(state.cwd, '/');
  });

  it('cd / without fs succeeds', async () => {
    fs = null;
    const result = await run('cd', ['/']);
    assert.equal(result.exitCode, 0);
    assert.equal(state.cwd, '/');
  });

  it('cd into a file returns Not a directory', async () => {
    const result = await run('cd', ['root-file.txt']);
    assert.equal(result.exitCode, 1);
    assert.ok(result.stderr.includes('Not a directory'));
    assert.equal(state.cwd, '/');
  });

  it('ls in root shows only top-level entries after cd /', async () => {
    // cd into a subdir then back to root
    await run('cd', ['docs']);
    assert.equal(state.cwd, '/docs');

    await run('cd', ['/']);
    assert.equal(state.cwd, '/');

    const lsResult = await run('ls');
    assert.equal(lsResult.exitCode, 0);
    assert.ok(lsResult.stdout.includes('docs'), 'should list docs dir');
    assert.ok(lsResult.stdout.includes('root-file.txt'), 'should list root-file.txt');
    // Should NOT list nested contents at root level
    assert.ok(!lsResult.stdout.includes('notes'), 'should NOT list nested notes dir');
    assert.ok(!lsResult.stdout.includes('readme.txt'), 'should NOT list nested readme.txt');
  });
});
