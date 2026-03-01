// Run with: node --import ./web/test/_setup-globals.mjs --test web/test/clawser-opfs.test.mjs
import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

// ── OPFS Walk Utilities ───────────────────────────────────────────

// Build a minimal in-memory OPFS mock that tracks getDirectoryHandle calls.
function createMockOPFS() {
  const tree = new Map(); // path → MockDirHandle

  class MockDirHandle {
    #name;
    #children = new Map();

    constructor(name) { this.#name = name; }
    get name() { return this.#name; }

    async getDirectoryHandle(name, opts = {}) {
      if (this.#children.has(name)) return this.#children.get(name);
      if (opts.create) {
        const child = new MockDirHandle(name);
        this.#children.set(name, child);
        return child;
      }
      throw new DOMException(`Directory "${name}" not found`, 'NotFoundError');
    }
  }

  const root = new MockDirHandle('');
  // Override navigator.storage.getDirectory to return our mock root
  globalThis.navigator.storage.getDirectory = async () => root;

  return { root, MockDirHandle };
}

describe('opfsWalk', () => {
  let opfsWalk;

  beforeEach(async () => {
    createMockOPFS();
    const mod = await import('../clawser-opfs.js');
    opfsWalk = mod.opfsWalk;
  });

  it('returns dir and name for a simple filename', async () => {
    const result = await opfsWalk('file.txt');
    assert.ok(result.dir, 'should have a dir handle');
    assert.equal(result.name, 'file.txt');
  });

  it('returns dir and name for a nested path', async () => {
    const result = await opfsWalk('a/b/c/file.txt', { create: true });
    assert.equal(result.name, 'file.txt');
    assert.ok(result.dir, 'should have a dir handle');
  });

  it('handles path with leading slash', async () => {
    const result = await opfsWalk('/a/b/file.txt', { create: true });
    assert.equal(result.name, 'file.txt');
  });

  it('handles path with multiple slashes', async () => {
    const result = await opfsWalk('a//b///file.txt', { create: true });
    assert.equal(result.name, 'file.txt');
  });

  it('throws when intermediate dir missing and create=false', async () => {
    await assert.rejects(
      () => opfsWalk('missing/deep/file.txt', { create: false }),
      /not found|NotFoundError/i,
    );
  });

  it('creates intermediate dirs when create=true', async () => {
    // Should not throw
    const result = await opfsWalk('new/nested/deep/file.txt', { create: true });
    assert.equal(result.name, 'file.txt');
    assert.ok(result.dir);
  });
});

describe('opfsWalkDir', () => {
  let opfsWalkDir;

  beforeEach(async () => {
    createMockOPFS();
    const mod = await import('../clawser-opfs.js');
    opfsWalkDir = mod.opfsWalkDir;
  });

  it('returns root handle for empty path', async () => {
    const dir = await opfsWalkDir('');
    assert.ok(dir, 'should return root dir handle');
  });

  it('returns dir handle for a nested path', async () => {
    const dir = await opfsWalkDir('a/b/c', { create: true });
    assert.ok(dir, 'should return dir handle');
    assert.equal(dir.name, 'c');
  });

  it('throws for missing dir when create=false', async () => {
    await assert.rejects(
      () => opfsWalkDir('nonexistent/path'),
      /not found|NotFoundError/i,
    );
  });

  it('creates nested dirs when create=true', async () => {
    const dir = await opfsWalkDir('x/y/z', { create: true });
    assert.equal(dir.name, 'z');
  });
});
