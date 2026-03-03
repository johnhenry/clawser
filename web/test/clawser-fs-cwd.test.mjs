// Run with: node --import ./web/test/_setup-globals.mjs --test web/test/clawser-fs-cwd.test.mjs
import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

// ── Minimal OPFS mock ────────────────────────────────────────────

function createMockOPFS() {
  class MockFileHandle {
    #name;
    #content = '';
    constructor(name) { this.#name = name; this.kind = 'file'; }
    get name() { return this.#name; }
    setContent(c) { this.#content = c; }
    async getFile() {
      const content = this.#content;
      return { size: new TextEncoder().encode(content).byteLength, text: async () => content };
    }
    async createWritable() {
      const self = this;
      let buf = '';
      return {
        async write(data) { buf += data; },
        async close() { self.setContent(buf); },
        async abort() {},
      };
    }
  }

  class MockDirHandle {
    #name;
    #children = new Map();
    constructor(name) { this.#name = name; this.kind = 'directory'; }
    get name() { return this.#name; }
    async getDirectoryHandle(name, opts = {}) {
      if (this.#children.has(name)) {
        const h = this.#children.get(name);
        if (h.kind === 'directory') return h;
      }
      if (opts.create) {
        const child = new MockDirHandle(name);
        this.#children.set(name, child);
        return child;
      }
      throw new DOMException(`Directory "${name}" not found`, 'NotFoundError');
    }
    async getFileHandle(name, opts = {}) {
      if (this.#children.has(name)) {
        const h = this.#children.get(name);
        if (h.kind === 'file') return h;
      }
      if (opts.create) {
        const fh = new MockFileHandle(name);
        this.#children.set(name, fh);
        return fh;
      }
      throw new DOMException(`File "${name}" not found`, 'NotFoundError');
    }
    async removeEntry(name, opts = {}) {
      if (!this.#children.has(name)) throw new DOMException(`"${name}" not found`, 'NotFoundError');
      this.#children.delete(name);
    }
    async *entries() {
      for (const [k, v] of this.#children) yield [k, v];
    }
    [Symbol.asyncIterator]() { return this.entries(); }
  }

  const root = new MockDirHandle('');
  globalThis.navigator.storage.getDirectory = async () => root;
  return root;
}

// Stub quota check
globalThis.navigator.storage.estimate = async () => ({ usage: 0, quota: 1e9 });

// ── Tests ────────────────────────────────────────────────────────

describe('Fs Tools — CWD-Relative Path Resolution', () => {
  let FsReadTool, FsWriteTool, FsDeleteTool, FsListTool, FsMkdirTool, WorkspaceFs;
  let ws;

  beforeEach(async () => {
    createMockOPFS();
    const mod = await import('../clawser-tools.js');
    FsReadTool = mod.FsReadTool;
    FsWriteTool = mod.FsWriteTool;
    FsDeleteTool = mod.FsDeleteTool;
    FsListTool = mod.FsListTool;
    FsMkdirTool = mod.FsMkdirTool;
    WorkspaceFs = mod.WorkspaceFs;
    ws = new WorkspaceFs();
  });

  function mockShellState(cwd) {
    return () => ({ cwd });
  }

  // ── FsWriteTool + FsReadTool: relative path resolves to cwd ────

  it('FsWriteTool writes relative path under cwd', async () => {
    const getShellState = mockShellState('/docs');
    const writeTool = new FsWriteTool(ws, getShellState);
    const result = await writeTool.execute({ path: 'hello.txt', content: 'world' });
    assert.equal(result.success, true);

    // Now read via absolute path to confirm it landed under /docs
    const readTool = new FsReadTool(ws);
    const readResult = await readTool.execute({ path: '/docs/hello.txt' });
    assert.equal(readResult.success, true);
    assert.equal(readResult.output, 'world');
  });

  it('FsReadTool reads relative path under cwd', async () => {
    const getShellState = mockShellState('/docs');
    const writeTool = new FsWriteTool(ws, getShellState);
    await writeTool.execute({ path: 'file.txt', content: 'data' });

    const readTool = new FsReadTool(ws, getShellState);
    const result = await readTool.execute({ path: 'file.txt' });
    assert.equal(result.success, true);
    assert.equal(result.output, 'data');
  });

  // ── FsDeleteTool: relative path resolves to cwd ────

  it('FsDeleteTool deletes relative path under cwd', async () => {
    const getShellState = mockShellState('/stuff');
    const writeTool = new FsWriteTool(ws, getShellState);
    await writeTool.execute({ path: 'temp.txt', content: 'tmp' });

    const deleteTool = new FsDeleteTool(ws, getShellState);
    const result = await deleteTool.execute({ path: 'temp.txt' });
    assert.equal(result.success, true);

    // Confirm it's gone
    const readTool = new FsReadTool(ws, getShellState);
    await assert.rejects(readTool.execute({ path: 'temp.txt' }));
  });

  // ── FsListTool: relative path resolves to cwd ────

  it('FsListTool lists relative path under cwd', async () => {
    const getShellState = mockShellState('/project');
    const writeTool = new FsWriteTool(ws, getShellState);
    await writeTool.execute({ path: 'a.txt', content: 'a' });
    await writeTool.execute({ path: 'b.txt', content: 'b' });

    // List root of /project using "." (default)
    const listTool = new FsListTool(ws, getShellState);
    const result = await listTool.execute({});
    assert.equal(result.success, true);
    const entries = JSON.parse(result.output);
    const names = entries.map(e => e.name);
    assert.ok(names.includes('a.txt'));
    assert.ok(names.includes('b.txt'));
  });

  // ── FsMkdirTool: relative path resolves to cwd ────

  it('FsMkdirTool creates directory relative to cwd', async () => {
    const getShellState = mockShellState('/workspace');
    const mkdirTool = new FsMkdirTool(ws, getShellState);
    const result = await mkdirTool.execute({ path: 'subdir' });
    assert.equal(result.success, true);

    // Verify by listing /workspace
    const listTool = new FsListTool(ws, getShellState);
    const listResult = await listTool.execute({});
    const entries = JSON.parse(listResult.output);
    assert.ok(entries.some(e => e.name === 'subdir'));
  });

  // ── Absolute paths pass through unchanged ────

  it('Absolute paths are unaffected by cwd', async () => {
    const getShellState = mockShellState('/other');
    const writeTool = new FsWriteTool(ws, getShellState);
    await writeTool.execute({ path: '/abs/file.txt', content: 'absolute' });

    const readTool = new FsReadTool(ws, getShellState);
    const result = await readTool.execute({ path: '/abs/file.txt' });
    assert.equal(result.success, true);
    assert.equal(result.output, 'absolute');
  });

  // ── Security: isInternalPath guard works on resolved paths ────

  it('FsWriteTool blocks write when cwd resolves into internal dir', async () => {
    const getShellState = mockShellState('/.checkpoints');
    const writeTool = new FsWriteTool(ws, getShellState);
    const result = await writeTool.execute({ path: 'evil.bin', content: 'bad' });
    assert.equal(result.success, false);
    assert.ok(result.error.includes('system directory'));
  });

  it('FsDeleteTool blocks delete when cwd resolves into internal dir', async () => {
    const getShellState = mockShellState('/.conversations');
    const deleteTool = new FsDeleteTool(ws, getShellState);
    const result = await deleteTool.execute({ path: 'log.json' });
    assert.equal(result.success, false);
    assert.ok(result.error.includes('system directory'));
  });

  it('FsMkdirTool blocks mkdir when cwd resolves into internal dir', async () => {
    const getShellState = mockShellState('/.skills');
    const mkdirTool = new FsMkdirTool(ws, getShellState);
    const result = await mkdirTool.execute({ path: 'subdir' });
    assert.equal(result.success, false);
    assert.ok(result.error.includes('system directory'));
  });

  // ── Fallback: tools without getShellState resolve from / ────

  it('FsReadTool without getShellState resolves from root', async () => {
    const writeTool = new FsWriteTool(ws);
    await writeTool.execute({ path: 'root-file.txt', content: 'at root' });

    const readTool = new FsReadTool(ws);
    const result = await readTool.execute({ path: 'root-file.txt' });
    assert.equal(result.success, true);
    assert.equal(result.output, 'at root');
  });

  it('FsWriteTool without getShellState resolves from root', async () => {
    const writeTool = new FsWriteTool(ws);
    const result = await writeTool.execute({ path: 'new.txt', content: 'hi' });
    assert.equal(result.success, true);

    const readTool = new FsReadTool(ws);
    const readResult = await readTool.execute({ path: '/new.txt' });
    assert.equal(readResult.success, true);
    assert.equal(readResult.output, 'hi');
  });

  it('FsListTool without getShellState lists root', async () => {
    const writeTool = new FsWriteTool(ws);
    await writeTool.execute({ path: 'root-item.txt', content: 'x' });

    const listTool = new FsListTool(ws, null, () => true);
    const result = await listTool.execute({});
    assert.equal(result.success, true);
    const entries = JSON.parse(result.output);
    assert.ok(entries.some(e => e.name === 'root-item.txt'));
  });
});
