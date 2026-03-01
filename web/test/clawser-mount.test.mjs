// clawser-mount.test.mjs — Tests for MountableFs, mount helpers, and mount tools
// Run with: node --import ./web/test/_setup-globals.mjs --test web/test/clawser-mount.test.mjs

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

// Stubs required before importing modules that extend BrowserTool / WorkspaceFs
globalThis.BrowserTool = class { constructor() {} };
globalThis.WorkspaceFs = class {
  resolve(p) { return p; }
};

// ── Import module under test ────────────────────────────────────

const {
  MountableFs,
  isFileSystemAccessSupported,
  MountListTool,
  MountResolveTool,
} = await import('../clawser-mount.js');

// ── Helpers ─────────────────────────────────────────────────────

function mockHandle(name = 'test-dir', kind = 'directory') {
  return { name, kind };
}

// ── MountableFs ─────────────────────────────────────────────────

describe('MountableFs', () => {
  let fs;

  beforeEach(() => {
    fs = new MountableFs();
  });

  // ── mount / unmount / isMounted ───────────────────────────────

  it('mount stores a handle at mount point', () => {
    const handle = mockHandle();
    fs.mount('/mnt/myapp', handle);
    assert.equal(fs.isMounted('/mnt/myapp'), true);
  });

  it('mount throws for non /mnt/ paths', () => {
    const handle = mockHandle();
    assert.throws(() => fs.mount('/usr/local', handle), {
      message: /Mount points must be under \/mnt\//,
    });
  });

  it('unmount returns true for existing mount', () => {
    fs.mount('/mnt/data', mockHandle());
    assert.equal(fs.unmount('/mnt/data'), true);
  });

  it('unmount returns false for non-existent mount', () => {
    assert.equal(fs.unmount('/mnt/nope'), false);
  });

  it('isMounted returns correct state', () => {
    assert.equal(fs.isMounted('/mnt/missing'), false);
    fs.mount('/mnt/here', mockHandle());
    assert.equal(fs.isMounted('/mnt/here'), true);
    fs.unmount('/mnt/here');
    assert.equal(fs.isMounted('/mnt/here'), false);
  });

  // ── mountCount ────────────────────────────────────────────────

  it('mountCount reflects mounts', () => {
    assert.equal(fs.mountCount, 0);
    fs.mount('/mnt/a', mockHandle('a'));
    assert.equal(fs.mountCount, 1);
    fs.mount('/mnt/b', mockHandle('b'));
    assert.equal(fs.mountCount, 2);
    fs.unmount('/mnt/a');
    assert.equal(fs.mountCount, 1);
  });

  // ── resolveMount ──────────────────────────────────────────────

  it('resolveMount returns mount type for mounted paths', () => {
    fs.mount('/mnt/proj', mockHandle('proj'));
    const resolved = fs.resolveMount('/mnt/proj/src/main.js');
    assert.equal(resolved.type, 'mount');
    assert.equal(resolved.mountPoint, '/mnt/proj');
    assert.equal(resolved.relative, 'src/main.js');
  });

  it('resolveMount returns opfs type for non-mounted paths', () => {
    const resolved = fs.resolveMount('/some/other/path');
    assert.equal(resolved.type, 'opfs');
  });

  it('resolveMount finds longest prefix match', () => {
    fs.mount('/mnt/proj', mockHandle('proj'));
    fs.mount('/mnt/proj/deep', mockHandle('deep'));
    const resolved = fs.resolveMount('/mnt/proj/deep/file.txt');
    assert.equal(resolved.type, 'mount');
    assert.equal(resolved.mountPoint, '/mnt/proj/deep');
    assert.equal(resolved.relative, 'file.txt');
  });

  // ── mountTable ────────────────────────────────────────────────

  it('mountTable returns array of mount info', () => {
    fs.mount('/mnt/alpha', mockHandle('alpha'));
    fs.mount('/mnt/beta', mockHandle('beta', 'file'), { readOnly: true });
    const table = fs.mountTable;
    assert.equal(table.length, 2);

    const alpha = table.find(m => m.path === '/mnt/alpha');
    assert.ok(alpha);
    assert.equal(alpha.name, 'alpha');
    assert.equal(alpha.kind, 'directory');
    assert.equal(alpha.readOnly, false);

    const beta = table.find(m => m.path === '/mnt/beta');
    assert.ok(beta);
    assert.equal(beta.name, 'beta');
    assert.equal(beta.kind, 'file');
    assert.equal(beta.readOnly, true);
  });

  // ── unmountAll ────────────────────────────────────────────────

  it('unmountAll clears all mounts', () => {
    fs.mount('/mnt/a', mockHandle('a'));
    fs.mount('/mnt/b', mockHandle('b'));
    assert.equal(fs.mountCount, 2);
    fs.unmountAll();
    assert.equal(fs.mountCount, 0);
    assert.equal(fs.isMounted('/mnt/a'), false);
  });

  // ── formatMountTable ──────────────────────────────────────────

  it('formatMountTable returns empty string for no mounts', () => {
    assert.equal(fs.formatMountTable(), '');
  });

  it('formatMountTable returns markdown table', () => {
    fs.mount('/mnt/docs', mockHandle('docs'));
    const table = fs.formatMountTable();
    assert.ok(table.includes('| Path |'));
    assert.ok(table.includes('/mnt/docs'));
    assert.ok(table.includes('readwrite'));
    assert.ok(table.includes('docs'));
  });

  // ── injectMountContext ────────────────────────────────────────

  it('injectMountContext returns base prompt unchanged when no mounts', () => {
    const base = 'You are a helpful assistant.';
    assert.equal(fs.injectMountContext(base), base);
  });

  it('injectMountContext appends mount table', () => {
    fs.mount('/mnt/code', mockHandle('code'));
    const base = 'Base prompt.';
    const result = fs.injectMountContext(base);
    assert.ok(result.startsWith(base));
    assert.ok(result.includes('## Mounted Directories'));
    assert.ok(result.includes('/mnt/code'));
  });

  // ── exportMounts ──────────────────────────────────────────────

  it('exportMounts returns same as mountTable', () => {
    fs.mount('/mnt/foo', mockHandle('foo'));
    const exported = fs.exportMounts();
    const table = fs.mountTable;
    assert.deepEqual(exported, table);
  });

  // ── importPresets ─────────────────────────────────────────────

  it('importPresets validates and returns valid entries', () => {
    const presets = [
      { path: '/mnt/a', name: 'dirA', kind: 'directory', readOnly: false },
      { path: '/mnt/b' }, // sparse — should fill defaults
      42, // invalid — should be skipped
      null, // invalid — should be skipped
    ];
    const result = fs.importPresets(presets);
    assert.equal(result.length, 2);
    assert.equal(result[0].path, '/mnt/a');
    assert.equal(result[0].name, 'dirA');
    assert.equal(result[1].path, '/mnt/b');
    assert.equal(result[1].name, 'b'); // defaults to last path segment
    assert.equal(result[1].kind, 'directory'); // default
    assert.equal(result[1].readOnly, false); // default
  });

  it('importPresets returns empty for non-array input', () => {
    assert.deepEqual(fs.importPresets(null), []);
    assert.deepEqual(fs.importPresets('string'), []);
    assert.deepEqual(fs.importPresets(123), []);
    assert.deepEqual(fs.importPresets(undefined), []);
  });
});

// ── isFileSystemAccessSupported ─────────────────────────────────

describe('isFileSystemAccessSupported', () => {
  it('returns boolean', () => {
    const result = isFileSystemAccessSupported();
    assert.equal(typeof result, 'boolean');
  });
});

// ── MountListTool ───────────────────────────────────────────────

describe('MountListTool', () => {
  it('returns no-mounts message when empty', async () => {
    const fs = new MountableFs();
    const tool = new MountListTool(fs);
    const result = await tool.execute();
    assert.equal(result.success, true);
    assert.ok(result.output.toLowerCase().includes('no'));
  });

  it('returns mount list when mounts exist', async () => {
    const fs = new MountableFs();
    fs.mount('/mnt/project', mockHandle('project'));
    const tool = new MountListTool(fs);
    const result = await tool.execute();
    assert.equal(result.success, true);
    assert.ok(result.output.includes('/mnt/project'));
    assert.ok(result.output.includes('project'));
  });
});

// ── MountResolveTool ────────────────────────────────────────────

describe('MountResolveTool', () => {
  it('resolves mounted path', async () => {
    const fs = new MountableFs();
    fs.mount('/mnt/src', mockHandle('src'));
    const tool = new MountResolveTool(fs);
    const result = await tool.execute({ path: '/mnt/src/index.js' });
    assert.equal(result.success, true);
    assert.ok(result.output.includes('local mount'));
    assert.ok(result.output.includes('/mnt/src'));
  });

  it('resolves opfs path', async () => {
    const fs = new MountableFs();
    const tool = new MountResolveTool(fs);
    const result = await tool.execute({ path: '/workspace/file.txt' });
    assert.equal(result.success, true);
    assert.ok(result.output.includes('OPFS'));
  });
});
