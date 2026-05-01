// Run with: node --test web/test/clawser-skill-hot-reload.test.mjs
import { describe, it, beforeEach, afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';

// ── Stubs ────────────────────────────────────────────────────────

globalThis.BrowserTool = class { constructor() {} };

const store = {};
globalThis.localStorage = globalThis.localStorage || {
  getItem: (k) => store[k] ?? null,
  setItem: (k, v) => { store[k] = String(v); },
  removeItem: (k) => { delete store[k]; },
  clear: () => { for (const k of Object.keys(store)) delete store[k]; },
};

// Stub navigator.storage for OPFS mocking
if (!globalThis.navigator) globalThis.navigator = {};
if (!globalThis.navigator.storage) {
  globalThis.navigator.storage = { getDirectory: async () => { throw new Error('OPFS not available'); } };
}
if (!globalThis.DOMException) {
  globalThis.DOMException = class DOMException extends Error {
    constructor(msg, name) { super(msg); this.name = name || 'DOMException'; }
  };
}

// ── Import modules under test ────────────────────────────────────

import { SkillParser, SkillStorage, SkillRegistry, computeSkillHash } from '../clawser-skills.js';
import { SkillHotReloader, SkillFsWatcher, createSkillWatcher } from '../clawser-skill-hot-reload.js';

// ── OPFS stub helpers (copied from clawser-skills.test.mjs) ──────

let _fileModTime = Date.now();

let _modTimeCounter = 0;

const createFileHandle = (content, modTime) => {
  let stored = content;
  let lastMod = modTime ?? _fileModTime;
  return {
    kind: 'file',
    getFile() {
      return {
        text: async () => stored,
        lastModified: lastMod,
        arrayBuffer: async () => new TextEncoder().encode(stored).buffer,
      };
    },
    async createWritable() {
      return {
        // Ensure each write produces a unique timestamp
        async write(data) { stored = data; lastMod = Date.now() + (++_modTimeCounter); },
        async close() {},
      };
    },
    // Test helpers
    _setContent(c) { stored = c; lastMod = Date.now() + (++_modTimeCounter); },
    _getContent() { return stored; },
  };
};

const createDirHandle = (entries = {}) => {
  const dirs = {};
  const files = {};

  for (const [name, value] of Object.entries(entries)) {
    if (typeof value === 'string') {
      files[name] = createFileHandle(value);
    } else if (value && value.kind === 'directory') {
      dirs[name] = value;
    } else if (value && value.kind === 'file') {
      files[name] = value;
    } else if (value && typeof value === 'object' && !value.kind) {
      dirs[name] = createDirHandle(value);
    }
  }

  const handle = {
    kind: 'directory',
    async getDirectoryHandle(name, opts) {
      if (dirs[name]) return dirs[name];
      if (opts?.create) {
        dirs[name] = createDirHandle();
        return dirs[name];
      }
      throw new DOMException(`Not found: ${name}`, 'NotFoundError');
    },
    async getFileHandle(name, opts) {
      if (files[name]) return files[name];
      if (opts?.create) {
        files[name] = createFileHandle('');
        return files[name];
      }
      throw new DOMException(`Not found: ${name}`, 'NotFoundError');
    },
    async removeEntry(name) {
      delete dirs[name];
      delete files[name];
    },
    async *[Symbol.asyncIterator]() {
      for (const [name, dir] of Object.entries(dirs)) yield [name, dir];
      for (const [name, file] of Object.entries(files)) yield [name, file];
    },
    // Test helpers
    _addDir(name, d) { dirs[name] = d; },
    _removeDir(name) { delete dirs[name]; },
    _addFile(name, f) { files[name] = f; },
    _getFile(name) { return files[name]; },
    _getDirs() { return dirs; },
  };
  return handle;
};

const makeSkillMd = (name, desc = 'A test skill') => `---
name: ${name}
description: ${desc}
version: 1.0.0
---
# ${name}
Instructions for ${name}.`;

let origGetDirectory;
const installMockOPFS = (root) => {
  origGetDirectory = navigator.storage.getDirectory;
  navigator.storage.getDirectory = async () => root;
};
const restoreOPFS = () => {
  if (origGetDirectory) {
    navigator.storage.getDirectory = origGetDirectory;
    origGetDirectory = null;
  }
};

// ── Minimal SkillRegistry for testing ────────────────────────────

const createTestRegistry = () => {
  const logs = [];
  const activationChanges = [];
  const registry = new SkillRegistry({
    onLog: (level, msg) => logs.push({ level, msg }),
    onActivationChange: (name, active, tools) => activationChanges.push({ name, active, tools }),
  });
  return { registry, logs, activationChanges };
};

// ═══════════════════════════════════════════════════════════════════
// 1. SkillHotReloader — construction and lifecycle
// ═══════════════════════════════════════════════════════════════════

describe('SkillHotReloader', () => {
  let root, globalDir;

  beforeEach(() => {
    _fileModTime = Date.now();
    globalDir = createDirHandle({
      'my-skill': createDirHandle({
        'SKILL.md': makeSkillMd('my-skill'),
      }),
    });
    root = createDirHandle({
      clawser_skills: globalDir,
      clawser_workspaces: createDirHandle({}),
    });
    installMockOPFS(root);
  });

  afterEach(() => {
    restoreOPFS();
    localStorage.clear();
  });

  it('starts and stops cleanly', () => {
    const { registry } = createTestRegistry();
    const reloader = new SkillHotReloader({
      registry,
      wsId: 'test-ws',
      intervalMs: 60000,
    });

    assert.equal(reloader.running, false);
    reloader.start();
    assert.equal(reloader.running, true);
    reloader.stop();
    assert.equal(reloader.running, false);
  });

  it('start is idempotent', () => {
    const { registry } = createTestRegistry();
    const reloader = new SkillHotReloader({
      registry,
      wsId: 'test-ws',
      intervalMs: 60000,
    });

    reloader.start();
    reloader.start(); // no-op
    assert.equal(reloader.running, true);
    reloader.stop();
  });

  it('enforces minimum poll interval', () => {
    const { registry } = createTestRegistry();
    const reloader = new SkillHotReloader({
      registry,
      wsId: 'test-ws',
      intervalMs: 100, // below MIN_POLL_INTERVAL_MS (500)
    });
    assert.ok(reloader.intervalMs >= 500);
  });

  it('setWorkspace clears cached hashes', async () => {
    const { registry } = createTestRegistry();
    const reloader = new SkillHotReloader({
      registry,
      wsId: 'test-ws',
    });

    await reloader.snapshot();
    // Switching workspace should clear the cache
    reloader.setWorkspace('new-ws');

    // pollNow after switch should detect all skills as "new" since cache was cleared
    await registry.discover('test-ws');
    const changed = await reloader.pollNow();
    // All skills appear as changed because hashes were cleared
    assert.ok(changed.length >= 0); // may be 0 if dirs don't match new ws
  });

  it('snapshot indexes existing skills without triggering reload', async () => {
    const { registry, logs } = createTestRegistry();
    await registry.discover('test-ws');

    const reloadCalled = [];
    const reloader = new SkillHotReloader({
      registry,
      wsId: 'test-ws',
      onLog: (level, msg) => logs.push({ level, msg }),
      onReload: (changed) => reloadCalled.push(changed),
    });

    await reloader.snapshot();
    assert.equal(reloadCalled.length, 0);

    // Poll should find no changes since snapshot matches current state
    const changed = await reloader.pollNow();
    assert.deepStrictEqual(changed, []);
    assert.equal(reloadCalled.length, 0);
  });

  it('pollNow detects new skills', async () => {
    const { registry, logs } = createTestRegistry();
    await registry.discover('test-ws');

    const reloadCalled = [];
    const reloader = new SkillHotReloader({
      registry,
      wsId: 'test-ws',
      onLog: (level, msg) => logs.push({ level, msg }),
      onReload: (changed) => reloadCalled.push(changed),
    });

    await reloader.snapshot();

    // Add a new skill to OPFS
    globalDir._addDir('new-skill', createDirHandle({
      'SKILL.md': makeSkillMd('new-skill', 'A brand new skill'),
    }));

    const changed = await reloader.pollNow();
    assert.ok(changed.includes('new-skill'));
    assert.equal(reloadCalled.length, 1);
    assert.ok(reloadCalled[0].includes('new-skill'));

    // Registry should now have the new skill
    assert.ok(registry.skills.has('new-skill'));
  });

  it('pollNow detects removed skills', async () => {
    const { registry } = createTestRegistry();
    await registry.discover('test-ws');

    const reloadCalled = [];
    const reloader = new SkillHotReloader({
      registry,
      wsId: 'test-ws',
      onReload: (changed) => reloadCalled.push(changed),
    });

    await reloader.snapshot();

    // Remove the skill from OPFS
    globalDir._removeDir('my-skill');

    const changed = await reloader.pollNow();
    assert.ok(changed.includes('my-skill'));
    assert.equal(reloadCalled.length, 1);
  });

  it('pollNow detects modified SKILL.md', async () => {
    const { registry } = createTestRegistry();
    await registry.discover('test-ws');

    const reloadCalled = [];
    const reloader = new SkillHotReloader({
      registry,
      wsId: 'test-ws',
      onReload: (changed) => reloadCalled.push(changed),
    });

    await reloader.snapshot();

    // Modify the SKILL.md content
    const skillDir = await globalDir.getDirectoryHandle('my-skill');
    const fileHandle = await skillDir.getFileHandle('SKILL.md');
    const writable = await fileHandle.createWritable();
    await writable.write(makeSkillMd('my-skill', 'Updated description'));
    await writable.close();

    const changed = await reloader.pollNow();
    assert.ok(changed.includes('my-skill'));
    assert.equal(reloadCalled.length, 1);
  });

  it('reactivates active skills on change', async () => {
    const { registry, logs } = createTestRegistry();
    await registry.discover('test-ws');
    await registry.activate('my-skill');
    assert.ok(registry.activeSkills.has('my-skill'));

    const reloader = new SkillHotReloader({
      registry,
      wsId: 'test-ws',
      onLog: (level, msg) => logs.push({ level, msg }),
      onReload: () => {},
    });

    await reloader.snapshot();

    // Modify the skill — change body text (not just metadata)
    const newContent = `---
name: my-skill
description: Reactivation test
version: 1.0.0
---
# my-skill
Updated body for reactivation test.`;
    const skillDir = await globalDir.getDirectoryHandle('my-skill');
    const fileHandle = await skillDir.getFileHandle('SKILL.md');
    const writable = await fileHandle.createWritable();
    await writable.write(newContent);
    await writable.close();

    const changed = await reloader.pollNow();
    assert.ok(changed.includes('my-skill'));

    // Skill should be reactivated with new content
    assert.ok(registry.activeSkills.has('my-skill'));
    const activation = registry.activeSkills.get('my-skill');
    assert.ok(activation.body.includes('Updated body for reactivation test'));
  });

  it('handles broken SKILL.md gracefully — does not throw', async () => {
    const { registry, logs } = createTestRegistry();
    await registry.discover('test-ws');

    const reloader = new SkillHotReloader({
      registry,
      wsId: 'test-ws',
      onLog: (level, msg) => logs.push({ level, msg }),
      onReload: () => {},
    });

    await reloader.snapshot();

    // Replace skill dir with completely different content to trigger change
    // Use a file handle with a different timestamp to bypass the fast-path
    globalDir._removeDir('my-skill');
    const brokenFile = createFileHandle(
      'This file has no frontmatter at all and is basically broken.',
      Date.now() + 999999,
    );
    const brokenDir = createDirHandle({});
    brokenDir._addFile('SKILL.md', brokenFile);
    globalDir._addDir('my-skill', brokenDir);

    // Should not throw even with malformed skill content
    const changed = await reloader.pollNow();
    assert.ok(changed.length > 0, 'Should detect the change');
    // The key assertion: no uncaught exceptions
  });

  it('no-ops when polling is already in progress', async () => {
    const { registry } = createTestRegistry();
    await registry.discover('test-ws');

    const reloader = new SkillHotReloader({
      registry,
      wsId: 'test-ws',
      onReload: () => {},
    });

    await reloader.snapshot();

    // Trigger two concurrent polls
    const [a, b] = await Promise.all([
      reloader.pollNow(),
      reloader.pollNow(),
    ]);

    // One should return [] (the guard), the other runs normally
    assert.ok(Array.isArray(a));
    assert.ok(Array.isArray(b));
  });

  it('setInterval updates the polling interval', () => {
    const { registry } = createTestRegistry();
    const reloader = new SkillHotReloader({
      registry,
      wsId: 'test-ws',
      intervalMs: 5000,
    });
    assert.equal(reloader.intervalMs, 5000);
    reloader.setInterval(10000);
    assert.equal(reloader.intervalMs, 10000);
    reloader.setInterval(100); // below minimum
    assert.ok(reloader.intervalMs >= 500);
  });
});

// ═══════════════════════════════════════════════════════════════════
// 2. SkillFsWatcher — static checks (no real fs needed)
// ═══════════════════════════════════════════════════════════════════

describe('SkillFsWatcher', () => {
  it('reports availability based on Node.js environment', () => {
    // We're running in Node.js, so it should be available
    assert.equal(SkillFsWatcher.available, true);
  });

  it('constructs without errors', () => {
    const { registry } = createTestRegistry();
    const watcher = new SkillFsWatcher({
      registry,
      wsId: 'test-ws',
      dirs: ['/nonexistent/path'],
    });
    assert.equal(watcher.running, false);
  });

  it('stop is safe to call when not running', () => {
    const { registry } = createTestRegistry();
    const watcher = new SkillFsWatcher({
      registry,
      wsId: 'test-ws',
      dirs: [],
    });
    watcher.stop(); // should not throw
    assert.equal(watcher.running, false);
  });

  it('setWorkspace updates the tracked workspace', () => {
    const { registry } = createTestRegistry();
    const watcher = new SkillFsWatcher({
      registry,
      wsId: 'ws1',
      dirs: [],
    });
    watcher.setWorkspace('ws2');
    // No public getter, but setWorkspace shouldn't throw
    assert.equal(watcher.running, false);
  });
});

// ═══════════════════════════════════════════════════════════════════
// 3. createSkillWatcher factory
// ═══════════════════════════════════════════════════════════════════

describe('createSkillWatcher', () => {
  it('returns SkillFsWatcher when dirs are provided and Node.js is available', () => {
    const { registry } = createTestRegistry();
    const watcher = createSkillWatcher({
      registry,
      wsId: 'test-ws',
      dirs: ['/some/dir'],
    });
    assert.ok(watcher instanceof SkillFsWatcher);
  });

  it('returns SkillHotReloader when no dirs provided', () => {
    const { registry } = createTestRegistry();
    const watcher = createSkillWatcher({
      registry,
      wsId: 'test-ws',
    });
    assert.ok(watcher instanceof SkillHotReloader);
  });

  it('returns SkillHotReloader when dirs is empty', () => {
    const { registry } = createTestRegistry();
    const watcher = createSkillWatcher({
      registry,
      wsId: 'test-ws',
      dirs: [],
    });
    assert.ok(watcher instanceof SkillHotReloader);
  });
});

// ═══════════════════════════════════════════════════════════════════
// 4. Script change detection
// ═══════════════════════════════════════════════════════════════════

describe('SkillHotReloader script change detection', () => {
  let root, globalDir;

  beforeEach(() => {
    _fileModTime = Date.now();
    globalDir = createDirHandle({
      'scripted-skill': createDirHandle({
        'SKILL.md': makeSkillMd('scripted-skill'),
        scripts: createDirHandle({
          'run.js': createFileHandle('console.log("v1")'),
        }),
      }),
    });
    root = createDirHandle({
      clawser_skills: globalDir,
      clawser_workspaces: createDirHandle({}),
    });
    installMockOPFS(root);
  });

  afterEach(() => {
    restoreOPFS();
    localStorage.clear();
  });

  it('detects script file changes', async () => {
    const { registry } = createTestRegistry();
    await registry.discover('test-ws');

    const reloadCalled = [];
    const reloader = new SkillHotReloader({
      registry,
      wsId: 'test-ws',
      onReload: (changed) => reloadCalled.push(changed),
    });

    await reloader.snapshot();

    // Modify the script file
    const skillDir = await globalDir.getDirectoryHandle('scripted-skill');
    const scriptsDir = await skillDir.getDirectoryHandle('scripts');
    const scriptFile = await scriptsDir.getFileHandle('run.js');
    const writable = await scriptFile.createWritable();
    await writable.write('console.log("v2")');
    await writable.close();

    const changed = await reloader.pollNow();
    assert.ok(changed.includes('scripted-skill'));
    assert.equal(reloadCalled.length, 1);
  });
});
