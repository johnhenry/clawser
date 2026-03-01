// clawser-shell-builtins.test.mjs — Tests for registerExtendedBuiltins, registerMountBuiltins, registerJqBuiltin
// Run with: node --import ./web/test/_setup-globals.mjs --test web/test/clawser-shell-builtins.test.mjs

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

// Stubs required before importing modules that depend on browser globals
globalThis.BrowserTool = class { constructor() {} };
globalThis.WorkspaceFs = class { resolve(p) { return p; } };

// ── Minimal CommandRegistry mock ────────────────────────────────
// Mirrors the real CommandRegistry API from clawser-shell.js

class MockRegistry {
  #commands = new Map();

  register(name, handler, meta) {
    this.#commands.set(name, { handler, meta: meta || {} });
  }

  get(name) {
    const entry = this.#commands.get(name);
    return entry ? entry.handler : null;
  }

  has(name) {
    return this.#commands.has(name);
  }

  names() {
    return [...this.#commands.keys()];
  }

  get size() {
    return this.#commands.size;
  }
}

// ── Import module under test ────────────────────────────────────

const {
  registerExtendedBuiltins,
  registerMountBuiltins,
  registerJqBuiltin,
} = await import('../clawser-shell-builtins.js');

// ── registerExtendedBuiltins ────────────────────────────────────

describe('registerExtendedBuiltins', () => {
  let registry;

  beforeEach(() => {
    registry = new MockRegistry();
    registerExtendedBuiltins(registry);
  });

  it('registers commands into registry', () => {
    assert.ok(registry.size > 0, 'should register at least one command');
  });

  it('registry has expected text commands', () => {
    const textCmds = ['tr', 'cut', 'rev', 'nl', 'fold', 'column', 'diff', 'sed', 'paste'];
    for (const cmd of textCmds) {
      assert.ok(registry.has(cmd), `missing text command: ${cmd}`);
    }
  });

  it('registry has expected file commands', () => {
    const fileCmds = ['touch', 'stat', 'find', 'du', 'basename', 'dirname', 'realpath', 'tree'];
    for (const cmd of fileCmds) {
      assert.ok(registry.has(cmd), `missing file command: ${cmd}`);
    }
  });

  it('registry has expected generator commands', () => {
    const genCmds = ['seq', 'yes', 'printf', 'date', 'sleep', 'time'];
    for (const cmd of genCmds) {
      assert.ok(registry.has(cmd), `missing generator command: ${cmd}`);
    }
  });

  it('registry has expected session commands', () => {
    const sessCmds = ['clear', 'history', 'alias', 'unalias', 'set', 'unset', 'read'];
    for (const cmd of sessCmds) {
      assert.ok(registry.has(cmd), `missing session command: ${cmd}`);
    }
  });

  it('registry has expected data commands', () => {
    const dataCmds = ['xxd', 'base64', 'sha256sum', 'md5sum'];
    for (const cmd of dataCmds) {
      assert.ok(registry.has(cmd), `missing data command: ${cmd}`);
    }
  });

  it('registry has expected process commands', () => {
    const procCmds = ['xargs', 'test', '['];
    for (const cmd of procCmds) {
      assert.ok(registry.has(cmd), `missing process command: ${cmd}`);
    }
  });

  it('each command is a function', () => {
    for (const name of registry.names()) {
      const handler = registry.get(name);
      assert.equal(typeof handler, 'function', `${name} handler should be a function`);
    }
  });

  it('does not register duplicate keys', () => {
    const names = registry.names();
    const unique = new Set(names);
    assert.equal(names.length, unique.size, 'all command names should be unique');
  });

  it('total registered count is 37', () => {
    assert.equal(registry.size, 37, `expected 37 commands, got ${registry.size}`);
  });

  // ── Command execution tests ───────────────────────────────────

  it('basename command returns filename portion', () => {
    const handler = registry.get('basename');
    const result = handler({ args: ['/usr/local/bin/node'] });
    assert.equal(result.stdout, 'node\n');
    assert.equal(result.exitCode, 0);
  });

  it('basename command strips suffix', () => {
    const handler = registry.get('basename');
    const result = handler({ args: ['/path/to/file.txt', '.txt'] });
    assert.equal(result.stdout, 'file\n');
    assert.equal(result.exitCode, 0);
  });

  it('dirname command returns directory portion', () => {
    const handler = registry.get('dirname');
    const result = handler({ args: ['/usr/local/bin/node'] });
    assert.equal(result.stdout, '/usr/local/bin\n');
    assert.equal(result.exitCode, 0);
  });

  it('dirname command returns . for bare filename', () => {
    const handler = registry.get('dirname');
    const result = handler({ args: ['file.txt'] });
    assert.equal(result.stdout, '.\n');
    assert.equal(result.exitCode, 0);
  });

  it('rev command reverses string', () => {
    const handler = registry.get('rev');
    const result = handler({ stdin: 'hello\nworld\n' });
    assert.equal(result.stdout, 'olleh\ndlrow\n');
    assert.equal(result.exitCode, 0);
  });

  it('seq generates number sequence', () => {
    const handler = registry.get('seq');
    const result = handler({ args: ['5'] });
    assert.equal(result.stdout, '1\n2\n3\n4\n5\n');
    assert.equal(result.exitCode, 0);
  });

  it('seq generates range with start and end', () => {
    const handler = registry.get('seq');
    const result = handler({ args: ['3', '6'] });
    assert.equal(result.stdout, '3\n4\n5\n6\n');
    assert.equal(result.exitCode, 0);
  });

  it('base64 encodes string', () => {
    const handler = registry.get('base64');
    const result = handler({ args: [], stdin: 'hello\n' });
    assert.equal(result.stdout, btoa('hello') + '\n');
    assert.equal(result.exitCode, 0);
  });

  it('base64 decodes string with -d flag', () => {
    const handler = registry.get('base64');
    const encoded = btoa('hello world');
    const result = handler({ args: ['-d'], stdin: encoded });
    assert.equal(result.stdout, 'hello world');
    assert.equal(result.exitCode, 0);
  });

  it('basename with no args returns error', () => {
    const handler = registry.get('basename');
    const result = handler({ args: [] });
    assert.equal(result.exitCode, 1);
    assert.ok(result.stderr.includes('missing operand'));
  });
});

// ── registerMountBuiltins ───────────────────────────────────────

describe('registerMountBuiltins', () => {
  let registry;

  beforeEach(() => {
    registry = new MockRegistry();
    registerMountBuiltins(registry);
  });

  it('registers mount commands', () => {
    assert.ok(registry.size > 0, 'should register at least one command');
  });

  it('has mount, umount, df commands', () => {
    assert.ok(registry.has('mount'), 'missing mount');
    assert.ok(registry.has('umount'), 'missing umount');
    assert.ok(registry.has('df'), 'missing df');
  });

  it('registers exactly 3 commands', () => {
    assert.equal(registry.size, 3);
  });
});

// ── registerJqBuiltin ───────────────────────────────────────────

describe('registerJqBuiltin', () => {
  let registry;

  beforeEach(() => {
    registry = new MockRegistry();
    registerJqBuiltin(registry);
  });

  it('registers jq command', () => {
    assert.ok(registry.has('jq'));
    assert.equal(registry.size, 1);
  });

  it('jq with identity filter returns input', async () => {
    const handler = registry.get('jq');
    const result = await handler({ args: ['.'], stdin: '{"a":1}' });
    assert.equal(result.exitCode, 0);
    const parsed = JSON.parse(result.stdout);
    assert.deepEqual(parsed, { a: 1 });
  });

  it('jq with field access returns value', async () => {
    const handler = registry.get('jq');
    const result = await handler({ args: ['.name'], stdin: '{"name":"clawser","version":1}' });
    assert.equal(result.exitCode, 0);
    assert.equal(result.stdout, '"clawser"');
  });

  it('jq with no input returns error', async () => {
    const handler = registry.get('jq');
    const result = await handler({ args: ['.'], stdin: '' });
    assert.equal(result.exitCode, 1);
    assert.ok(result.stderr.includes('no input'));
  });
});
