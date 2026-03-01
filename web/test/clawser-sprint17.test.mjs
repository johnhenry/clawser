// Sprint 17 — CLI Packages + Auto-Index + Mount Presets + Skill Deps + Attachments
// RED phase: 30 tests, all expected to fail initially.

import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';

// ── 1. Installable CLI packages (5 tests) ───────────────────────

describe('Installable CLI packages', () => {
  let ClawserShell;

  before(async () => {
    const mod = await import('../clawser-shell.js');
    ClawserShell = mod.ClawserShell;
  });

  it('shell has installPackage method', () => {
    const shell = new ClawserShell();
    assert.equal(typeof shell.installPackage, 'function');
  });

  it('installPackage registers commands from module exports', async () => {
    const shell = new ClawserShell();
    // Simulated package with exported commands
    const pkg = {
      name: 'test-pkg',
      commands: {
        hello: async (args) => ({ stdout: `Hello ${args[0] || 'world'}`, stderr: '', exitCode: 0 }),
        goodbye: async () => ({ stdout: 'Goodbye', stderr: '', exitCode: 0 }),
      },
    };
    shell.installPackage(pkg);
    const result = await shell.exec('hello Claude');
    assert.equal(result.stdout, 'Hello Claude');
  });

  it('listPackages returns installed packages', () => {
    const shell = new ClawserShell();
    const pkg = { name: 'my-pkg', commands: { noop: async () => ({ stdout: '', stderr: '', exitCode: 0 }) } };
    shell.installPackage(pkg);
    const list = shell.listPackages();
    assert.ok(Array.isArray(list));
    assert.ok(list.some(p => p.name === 'my-pkg'));
  });

  it('uninstallPackage removes commands', async () => {
    const shell = new ClawserShell();
    const pkg = { name: 'rm-pkg', commands: { temp: async () => ({ stdout: 'hi', stderr: '', exitCode: 0 }) } };
    shell.installPackage(pkg);
    const r1 = await shell.exec('temp');
    assert.equal(r1.stdout, 'hi');
    shell.uninstallPackage('rm-pkg');
    const r2 = await shell.exec('temp');
    assert.notEqual(r2.exitCode, 0); // Command no longer found
  });

  it('installPackage validates required fields', () => {
    const shell = new ClawserShell();
    assert.throws(() => shell.installPackage({}), /name/i);
    assert.throws(() => shell.installPackage({ name: 'bad' }), /commands/i);
  });
});

// ── 2. Auto-indexing (5 tests) ──────────────────────────────────

describe('Auto-indexing', () => {
  let MountableFs;

  before(async () => {
    const mod = await import('../clawser-mount.js');
    MountableFs = mod.MountableFs;
  });

  it('buildIndex method exists', () => {
    const fs = new MountableFs();
    assert.equal(typeof fs.buildIndex, 'function');
  });

  it('buildIndex returns tree for mounted directory', async () => {
    const fs = new MountableFs();
    const entries = [
      { name: 'src', kind: 'directory' },
      { name: 'README.md', kind: 'file' },
      { name: 'package.json', kind: 'file' },
    ];
    const handle = {
      name: 'project',
      kind: 'directory',
      async *entries() { for (const e of entries) yield [e.name, e]; },
    };
    fs.mount('/mnt/project', handle);
    const tree = await fs.buildIndex('/mnt/project');
    assert.ok(tree.includes('src'));
    assert.ok(tree.includes('README.md'));
    assert.ok(tree.includes('package.json'));
  });

  it('buildIndex returns empty string for unmounted path', async () => {
    const fs = new MountableFs();
    const tree = await fs.buildIndex('/workspace/nonexistent');
    assert.equal(tree, '');
  });

  it('buildIndex formats as indented tree', async () => {
    const fs = new MountableFs();
    const subEntries = [{ name: 'index.js', kind: 'file' }];
    const entries = [
      {
        name: 'src', kind: 'directory',
        async *entries() { for (const e of subEntries) yield [e.name, e]; },
        async getDirectoryHandle() { return this; },
      },
      { name: 'README.md', kind: 'file' },
    ];
    const handle = {
      name: 'proj',
      kind: 'directory',
      async *entries() { for (const e of entries) yield [e.name, e]; },
      async getDirectoryHandle(name) { return entries.find(e => e.name === name); },
    };
    fs.mount('/mnt/proj', handle);
    const tree = await fs.buildIndex('/mnt/proj', { maxDepth: 2 });
    assert.ok(tree.includes('src/'));
    assert.ok(tree.includes('  index.js'));
  });

  it('buildIndex respects maxDepth', async () => {
    const fs = new MountableFs();
    const deep = {
      name: 'deep', kind: 'directory',
      async *entries() { yield ['hidden.txt', { name: 'hidden.txt', kind: 'file' }]; },
    };
    const entries = [
      {
        name: 'level1', kind: 'directory',
        async *entries() { yield ['deep', deep]; },
        async getDirectoryHandle() { return { async *entries() { yield ['deep', deep]; } }; },
      },
    ];
    const handle = {
      name: 'test',
      kind: 'directory',
      async *entries() { for (const e of entries) yield [e.name, e]; },
      async getDirectoryHandle(name) { return entries.find(e => e.name === name); },
    };
    fs.mount('/mnt/test', handle);
    const tree = await fs.buildIndex('/mnt/test', { maxDepth: 1 });
    assert.ok(tree.includes('level1'));
    assert.ok(!tree.includes('hidden.txt'));
  });
});

// ── 3. Mount presets (5 tests) ──────────────────────────────────

describe('Mount presets', () => {
  let MountableFs;

  before(async () => {
    const mod = await import('../clawser-mount.js');
    MountableFs = mod.MountableFs;
  });

  it('exportPresets returns serializable preset list', () => {
    const fs = new MountableFs();
    fs.mount('/mnt/app', { name: 'myapp', kind: 'directory' });
    fs.mount('/mnt/data', { name: 'data', kind: 'directory' }, { readOnly: true });
    // New method: exportPresets() → array of preset configs
    const presets = fs.exportPresets();
    assert.ok(Array.isArray(presets));
    assert.equal(presets.length, 2);
    assert.ok(presets.some(p => p.path === '/mnt/app'));
    assert.ok(presets.some(p => p.readOnly === true));
  });

  it('importPresets validates preset structure', () => {
    const fs = new MountableFs();
    // importPresets restores the saved config (paths only, handles must be re-acquired)
    const result = fs.importPresets([
      { path: '/mnt/app', name: 'myapp', kind: 'directory', readOnly: false },
    ]);
    assert.ok(Array.isArray(result));
    assert.equal(result.length, 1);
    assert.equal(result[0].path, '/mnt/app');
  });

  it('importPresets returns empty for invalid input', () => {
    const fs = new MountableFs();
    assert.deepEqual(fs.importPresets(null), []);
    assert.deepEqual(fs.importPresets('bad'), []);
  });

  it('exportPresets includes all mount metadata', () => {
    const fs = new MountableFs();
    fs.mount('/mnt/code', { name: 'code', kind: 'directory' }, { readOnly: false });
    const presets = fs.exportPresets();
    const preset = presets[0];
    assert.equal(preset.path, '/mnt/code');
    assert.equal(preset.name, 'code');
    assert.equal(preset.kind, 'directory');
    assert.equal(preset.readOnly, false);
  });

  it('presets round-trip (export → import → export)', () => {
    const fs = new MountableFs();
    fs.mount('/mnt/x', { name: 'x', kind: 'directory' }, { readOnly: true });
    const exported = fs.exportPresets();
    const fs2 = new MountableFs();
    const imported = fs2.importPresets(exported);
    assert.deepEqual(imported, exported);
  });
});

// ── 4. Skill dependency resolution (5 tests) ────────────────────

describe('Skill dependency resolution', () => {
  let validateRequirements, resolveDependencies;

  before(async () => {
    // Polyfill browser globals needed by clawser-state.js (imported by clawser-skills.js)
    if (typeof globalThis.localStorage === 'undefined') {
      const store = {};
      globalThis.localStorage = {
        getItem(k) { return store[k] ?? null; },
        setItem(k, v) { store[k] = String(v); },
        removeItem(k) { delete store[k]; },
        clear() { for (const k in store) delete store[k]; },
        get length() { return Object.keys(store).length; },
      };
    }
    if (typeof globalThis.location === 'undefined') {
      globalThis.location = { href: 'http://localhost/', origin: 'http://localhost', pathname: '/' };
    }
    const mod = await import('../clawser-skills.js');
    validateRequirements = mod.validateRequirements;
    resolveDependencies = mod.resolveDependencies;
  });

  it('resolveDependencies function exists', () => {
    assert.equal(typeof resolveDependencies, 'function');
  });

  it('returns empty for skill with no dependencies', () => {
    const result = resolveDependencies({ name: 'basic' }, {});
    assert.ok(result.resolved);
    assert.equal(result.missing.length, 0);
  });

  it('identifies missing skill dependencies', () => {
    const metadata = {
      name: 'advanced',
      requires: { skills: ['base-skill', 'auth-skill'] },
    };
    const available = { skills: ['base-skill'] };
    const result = resolveDependencies(metadata, available);
    assert.equal(result.resolved, false);
    assert.ok(result.missing.includes('auth-skill'));
  });

  it('returns resolved=true when all deps present', () => {
    const metadata = {
      name: 'complete',
      requires: { skills: ['a', 'b'] },
    };
    const available = { skills: ['a', 'b', 'c'] };
    const result = resolveDependencies(metadata, available);
    assert.equal(result.resolved, true);
    assert.equal(result.missing.length, 0);
  });

  it('handles mixed tool and skill dependencies', () => {
    const metadata = {
      name: 'mixed',
      requires: { tools: ['browser_fetch'], skills: ['helper'] },
    };
    const available = { tools: ['browser_fetch'], skills: [] };
    const result = resolveDependencies(metadata, available);
    assert.equal(result.resolved, false);
    assert.ok(result.missing.includes('helper'));
  });
});

// ── 5. Attachment handling (5 tests) ─────────────────────────────

describe('Attachment handling', () => {
  let AttachmentProcessor;

  before(async () => {
    const mod = await import('../clawser-tools.js');
    AttachmentProcessor = mod.AttachmentProcessor;
  });

  it('AttachmentProcessor class exists', () => {
    assert.ok(AttachmentProcessor);
    const proc = new AttachmentProcessor();
    assert.ok(proc);
  });

  it('processText extracts content from text file', async () => {
    const proc = new AttachmentProcessor();
    const result = await proc.processText('hello.txt', 'Hello World');
    assert.equal(result.type, 'text');
    assert.equal(result.content, 'Hello World');
    assert.equal(result.filename, 'hello.txt');
  });

  it('processText detects file type from extension', async () => {
    const proc = new AttachmentProcessor();
    const r1 = await proc.processText('code.js', 'const x = 1;');
    assert.equal(r1.language, 'javascript');
    const r2 = await proc.processText('data.json', '{}');
    assert.equal(r2.language, 'json');
  });

  it('formatForContext wraps content in code block', () => {
    const proc = new AttachmentProcessor();
    const attachment = { type: 'text', filename: 'app.py', content: 'print("hi")', language: 'python' };
    const formatted = proc.formatForContext(attachment);
    assert.ok(formatted.includes('```python'));
    assert.ok(formatted.includes('print("hi")'));
    assert.ok(formatted.includes('app.py'));
  });

  it('formatForContext handles plain text without language', () => {
    const proc = new AttachmentProcessor();
    const attachment = { type: 'text', filename: 'notes.txt', content: 'Some notes', language: 'text' };
    const formatted = proc.formatForContext(attachment);
    assert.ok(formatted.includes('notes.txt'));
    assert.ok(formatted.includes('Some notes'));
  });
});

// ── 6. Stderr redirect validation (5 tests) ─────────────────────

describe('Stderr redirect execution', () => {
  let ClawserShell;

  before(async () => {
    const mod = await import('../clawser-shell.js');
    ClawserShell = mod.ClawserShell;
  });

  it('2>/dev/null suppresses stderr', async () => {
    const shell = new ClawserShell();
    shell.registry.register('errout', async () => ({
      stdout: 'out', stderr: 'error text', exitCode: 0,
    }), { description: 'Test' });
    const result = await shell.exec('errout 2>/dev/null');
    assert.equal(result.stderr, '');
    assert.equal(result.stdout, 'out');
  });

  it('2>&1 merges stderr into stdout', async () => {
    const shell = new ClawserShell();
    shell.registry.register('mixed', async () => ({
      stdout: 'out-', stderr: 'err-', exitCode: 0,
    }), { description: 'Test' });
    const result = await shell.exec('mixed 2>&1');
    assert.ok(result.stdout.includes('out-'));
    assert.ok(result.stdout.includes('err-'));
    assert.equal(result.stderr, '');
  });

  it('2>file writes stderr to file', async () => {
    const files = {};
    const mockFs = {
      readFile: async (p) => files[p] || '',
      writeFile: async (p, c) => { files[p] = c; },
    };
    const shell = new ClawserShell({ fs: mockFs });
    shell.registry.register('warn', async () => ({
      stdout: 'ok', stderr: 'warning!', exitCode: 0,
    }), { description: 'Test' });
    const result = await shell.exec('warn 2>err.log');
    assert.equal(result.stderr, '');
    assert.equal(files['/err.log'], 'warning!');
  });

  it('stderr redirect works with pipes', async () => {
    const shell = new ClawserShell();
    shell.registry.register('noise', async () => ({
      stdout: 'signal', stderr: 'noise', exitCode: 0,
    }), { description: 'Test' });
    const result = await shell.exec('noise 2>/dev/null');
    assert.equal(result.stdout, 'signal');
    assert.equal(result.stderr, '');
  });

  it('combined stdout and stderr redirect', async () => {
    const files = {};
    const mockFs = {
      readFile: async (p) => files[p] || '',
      writeFile: async (p, c) => { files[p] = c; },
    };
    const shell = new ClawserShell({ fs: mockFs });
    shell.registry.register('both', async () => ({
      stdout: 'output', stderr: 'errors', exitCode: 0,
    }), { description: 'Test' });
    const result = await shell.exec('both >out.txt 2>err.txt');
    assert.equal(files['/out.txt'], 'output');
    assert.equal(files['/err.txt'], 'errors');
  });
});
