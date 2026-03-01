// Run with: node --import ./web/test/_setup-globals.mjs --test web/test/clawser-fs-mkdir.test.mjs
import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

// ── Minimal OPFS mock ────────────────────────────────────────────

function createMockOPFS() {
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
  globalThis.navigator.storage.getDirectory = async () => root;
  return root;
}

// ── Tests ────────────────────────────────────────────────────────

describe('FsMkdirTool', () => {
  let FsMkdirTool;
  const stubWs = { resolve: (p) => p };

  beforeEach(() => {
    createMockOPFS();
  });

  it('loads the class', async () => {
    const mod = await import('../clawser-tools.js');
    FsMkdirTool = mod.FsMkdirTool;
    assert.ok(FsMkdirTool);
  });

  it('has correct tool metadata', () => {
    const tool = new FsMkdirTool(stubWs);
    assert.equal(tool.name, 'browser_fs_mkdir');
    assert.equal(tool.permission, 'write');
    assert.ok(tool.description.length > 0);
    assert.deepEqual(tool.parameters.required, ['path']);
  });

  it('creates a directory via opfsWalkDir', async () => {
    const tool = new FsMkdirTool(stubWs);
    const result = await tool.execute({ path: 'test-dir/sub' });
    assert.equal(result.success, true);
    assert.ok(result.output.includes('test-dir/sub'));
  });

  it('is idempotent (creating same dir twice succeeds)', async () => {
    const tool = new FsMkdirTool(stubWs);
    await tool.execute({ path: 'idem-dir' });
    const result = await tool.execute({ path: 'idem-dir' });
    assert.equal(result.success, true);
  });
});
