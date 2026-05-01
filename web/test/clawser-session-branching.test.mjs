// Run with: node --import ./web/test/_setup-globals.mjs --test web/test/clawser-session-branching.test.mjs
import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

// ── Polyfills ────────────────────────────────────────────────────
globalThis.BrowserTool = class { constructor() {} };

if (!globalThis.crypto?.randomUUID) {
  globalThis.crypto = globalThis.crypto || {};
  globalThis.crypto.randomUUID = () =>
    `${Math.random().toString(36).slice(2)}-${Date.now().toString(36)}`;
}

// ── In-memory OPFS mock ─────────────────────────────────────────
// Builds a tree of MockDirectoryHandle / MockFileHandle so that
// TerminalSessionManager can persist, restore, and scan sessions.

class MockFileHandle {
  constructor(name) {
    this.kind = 'file';
    this.name = name;
    this._content = '';
  }
  async getFile() {
    const content = this._content;
    return { text: async () => content };
  }
  async createWritable() {
    const self = this;
    let buf = '';
    return {
      async write(data) { buf += data; },
      async close() { self._content = buf; },
    };
  }
}

class MockDirectoryHandle {
  constructor(name) {
    this.kind = 'directory';
    this.name = name;
    this._entries = new Map();
  }

  async getDirectoryHandle(name, opts) {
    if (this._entries.has(name)) {
      const entry = this._entries.get(name);
      if (entry.kind !== 'directory') throw new DOMException('Not a directory', 'TypeMismatchError');
      return entry;
    }
    if (opts?.create) {
      const dir = new MockDirectoryHandle(name);
      this._entries.set(name, dir);
      return dir;
    }
    throw new DOMException(`Directory not found: ${name}`, 'NotFoundError');
  }

  async getFileHandle(name, opts) {
    if (this._entries.has(name)) {
      const entry = this._entries.get(name);
      if (entry.kind !== 'file') throw new DOMException('Not a file', 'TypeMismatchError');
      return entry;
    }
    if (opts?.create) {
      const file = new MockFileHandle(name);
      this._entries.set(name, file);
      return file;
    }
    throw new DOMException(`File not found: ${name}`, 'NotFoundError');
  }

  async removeEntry(name, _opts) {
    this._entries.delete(name);
  }

  // Async iterator for directory scanning
  async *[Symbol.asyncIterator]() {
    for (const [name, handle] of this._entries) {
      yield [name, handle];
    }
  }
}

// Patch navigator.storage to use our mock
let opfsRoot;
function resetOPFS() {
  opfsRoot = new MockDirectoryHandle('root');
  try {
    globalThis.navigator = {
      storage: { getDirectory: async () => opfsRoot },
      locks: {
        request: async (_name, optsOrCb, maybeCb) => {
          const cb = typeof optsOrCb === 'function' ? optsOrCb : maybeCb;
          if (cb) return cb({ name: _name });
        },
      },
    };
  } catch {
    if (globalThis.navigator) {
      Object.defineProperty(globalThis.navigator, 'storage', {
        value: { getDirectory: async () => opfsRoot },
        configurable: true,
      });
    }
  }
}

// ── Dynamic imports (after polyfills) ───────────────────────────
const { ShellState } = await import('../clawser-shell.js');
const { TerminalSessionManager } = await import('../clawser-terminal-sessions.js');

const makeShell = () => ({ state: new ShellState() });

// ── Helper: create a manager and seed it with some commands ─────
async function seedSession(mgr, commands) {
  for (const cmd of commands) {
    mgr.recordCommand(cmd);
    mgr.recordResult(`output of ${cmd}`, '', 0);
  }
  await mgr.persist();
}

// ── Tests ───────────────────────────────────────────────────────

describe('Session branching', () => {
  let mgr;

  beforeEach(async () => {
    resetOPFS();
    mgr = new TerminalSessionManager({ wsId: 'ws_test', shell: makeShell() });
    await mgr.init();
  });

  describe('branch()', () => {
    it('creates a new session with parentId and branchPoint', async () => {
      await seedSession(mgr, ['pwd', 'ls', 'echo hello']);
      const parentId = mgr.activeId;
      // Branch from event index 2 (second shell_command 'ls')
      const meta = await mgr.branch(2);
      assert.ok(meta.id);
      assert.notEqual(meta.id, parentId);
      assert.equal(meta.parentId, parentId);
      assert.equal(meta.branchPoint, 2);
    });

    it('defaults to branching from the last event', async () => {
      await seedSession(mgr, ['pwd', 'ls']);
      const parentId = mgr.activeId;
      const totalEvents = mgr.events.length;
      // switch back to parent so we can branch from it
      await mgr.switchTo(parentId);
      const meta = await mgr.branch();
      assert.equal(meta.branchPoint, totalEvents - 1);
    });

    it('copies events up to the branch point', async () => {
      await seedSession(mgr, ['pwd', 'ls', 'echo hello']);
      const parentId = mgr.activeId;
      // Events: [cmd:pwd, res:pwd, cmd:ls, res:ls, cmd:echo, res:echo]
      // Branch at index 2 (cmd:ls) — should include cmd:ls + its result (index 3)
      await mgr.switchTo(parentId);
      const meta = await mgr.branch(2);
      // Now active session is the branch
      const branchEvents = mgr.events;
      // Should have events 0..3 (inclusive of result paired with cmd at index 2)
      assert.equal(branchEvents.length, 4);
      assert.equal(branchEvents[0].data.command, 'pwd');
      assert.equal(branchEvents[2].data.command, 'ls');
    });

    it('throws on empty session', async () => {
      // Active session exists but is empty (init creates one)
      // Clear events by creating a fresh session
      await mgr.create('Empty');
      await assert.rejects(() => mgr.branch(), /empty session/i);
    });

    it('throws on out-of-range seq', async () => {
      await seedSession(mgr, ['pwd']);
      const parentId = mgr.activeId;
      await mgr.switchTo(parentId);
      await assert.rejects(() => mgr.branch(999), /out of range/i);
      await assert.rejects(() => mgr.branch(-1), /out of range/i);
    });

    it('accepts a custom name', async () => {
      await seedSession(mgr, ['pwd']);
      const parentId = mgr.activeId;
      await mgr.switchTo(parentId);
      const meta = await mgr.branch(0, 'My Branch');
      assert.equal(meta.name, 'My Branch');
    });
  });

  describe('listBranches()', () => {
    it('returns empty array for session with no branches', async () => {
      await seedSession(mgr, ['pwd']);
      assert.deepStrictEqual(mgr.listBranches(), []);
    });

    it('returns direct children of a session', async () => {
      await seedSession(mgr, ['pwd', 'ls', 'echo']);
      const rootId = mgr.activeId;

      await mgr.switchTo(rootId);
      await mgr.branch(0, 'Branch A');

      await mgr.switchTo(rootId);
      await mgr.branch(2, 'Branch B');

      const branches = mgr.listBranches(rootId);
      assert.equal(branches.length, 2);
      const names = branches.map(b => b.name).sort();
      assert.deepStrictEqual(names, ['Branch A', 'Branch B']);
    });

    it('does not return grandchild branches', async () => {
      await seedSession(mgr, ['pwd', 'ls']);
      const rootId = mgr.activeId;

      await mgr.switchTo(rootId);
      const child = await mgr.branch(0, 'Child');

      // Add an event to the child so we can branch it
      mgr.recordCommand('date');
      mgr.recordResult('2026-01-01', '', 0);
      await mgr.persist();

      await mgr.branch(0, 'Grandchild');

      const rootBranches = mgr.listBranches(rootId);
      assert.equal(rootBranches.length, 1);
      assert.equal(rootBranches[0].name, 'Child');
    });
  });

  describe('getBranchTree()', () => {
    it('returns single node for session with no branches', async () => {
      await seedSession(mgr, ['pwd']);
      const tree = mgr.getBranchTree();
      assert.ok(tree);
      assert.equal(tree.id, mgr.activeId);
      assert.equal(tree.children, undefined);
    });

    it('builds nested tree structure', async () => {
      await seedSession(mgr, ['pwd', 'ls', 'echo']);
      const rootId = mgr.activeId;

      await mgr.switchTo(rootId);
      const childA = await mgr.branch(0, 'Child A');

      await mgr.switchTo(rootId);
      const childB = await mgr.branch(2, 'Child B');

      // Branch from childA
      await mgr.switchTo(childA.id);
      mgr.recordCommand('date');
      mgr.recordResult('2026-01-01', '', 0);
      await mgr.persist();
      await mgr.branch(0, 'Grandchild');

      const tree = mgr.getBranchTree(rootId);
      assert.ok(tree);
      assert.equal(tree.children.length, 2);

      const childANode = tree.children.find(c => c.name === 'Child A');
      assert.ok(childANode);
      assert.equal(childANode.children.length, 1);
      assert.equal(childANode.children[0].name, 'Grandchild');

      const childBNode = tree.children.find(c => c.name === 'Child B');
      assert.ok(childBNode);
      assert.equal(childBNode.children, undefined);
    });

    it('walks up to root when no rootId given', async () => {
      await seedSession(mgr, ['pwd']);
      const rootId = mgr.activeId;

      await mgr.switchTo(rootId);
      const child = await mgr.branch(0, 'Child');

      // Now active is the child — getBranchTree should still find root
      const tree = mgr.getBranchTree();
      assert.equal(tree.id, rootId);
      assert.equal(tree.children.length, 1);
    });

    it('returns null for unknown rootId', () => {
      const tree = mgr.getBranchTree('nonexistent_id');
      assert.equal(tree, null);
    });
  });

  describe('renderBranchTree()', () => {
    it('renders single session', async () => {
      await seedSession(mgr, ['pwd']);
      const output = mgr.renderBranchTree();
      assert.ok(output.length > 0);
      assert.ok(output.includes('*'), 'active session should have * marker');
    });

    it('renders multi-level tree with branch points', async () => {
      await seedSession(mgr, ['pwd', 'ls']);
      const rootId = mgr.activeId;

      await mgr.switchTo(rootId);
      await mgr.branch(0, 'Branch A');

      await mgr.switchTo(rootId);
      await mgr.branch(1, 'Branch B');

      // Switch to root to render
      await mgr.switchTo(rootId);
      const output = mgr.renderBranchTree();
      assert.ok(output.includes('Branch A'));
      assert.ok(output.includes('Branch B'));
      assert.ok(output.includes('branched@'));
    });
  });

  describe('fork() now records parentId', () => {
    it('fork() sets parentId and branchPoint on the new session', async () => {
      await seedSession(mgr, ['pwd', 'ls']);
      const parentId = mgr.activeId;

      await mgr.switchTo(parentId);
      const forked = await mgr.fork('My Fork');
      const sessions = mgr.list();
      const forkedMeta = sessions.find(s => s.id === forked.id);
      assert.equal(forkedMeta.parentId, parentId);
      assert.equal(typeof forkedMeta.branchPoint, 'number');
    });

    it('forkFromEvent() sets parentId and branchPoint', async () => {
      await seedSession(mgr, ['pwd', 'ls', 'echo']);
      const parentId = mgr.activeId;

      await mgr.switchTo(parentId);
      const forked = await mgr.forkFromEvent(2, 'Fork@2');
      const sessions = mgr.list();
      const forkedMeta = sessions.find(s => s.id === forked.id);
      assert.equal(forkedMeta.parentId, parentId);
      assert.equal(forkedMeta.branchPoint, 2);
    });
  });

  describe('persistence round-trip', () => {
    it('branch metadata survives persist + scan', async () => {
      await seedSession(mgr, ['pwd', 'ls']);
      const rootId = mgr.activeId;

      await mgr.switchTo(rootId);
      const branch = await mgr.branch(0, 'Persistent Branch');

      // Create a new manager pointing at the same OPFS
      const mgr2 = new TerminalSessionManager({ wsId: 'ws_test', shell: makeShell() });
      await mgr2.init();

      const sessions = mgr2.list();
      const branchMeta = sessions.find(s => s.id === branch.id);
      assert.ok(branchMeta, 'branch session should be found after re-scan');
      assert.equal(branchMeta.parentId, rootId);
      assert.equal(branchMeta.branchPoint, 0);

      // Tree should still work
      const tree = mgr2.getBranchTree(rootId);
      assert.ok(tree);
      assert.ok(tree.children?.length >= 1);
    });
  });
});
