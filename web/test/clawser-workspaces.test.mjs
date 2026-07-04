// Run with: node --import ./web/test/_setup-globals.mjs --test web/test/clawser-workspaces.test.mjs
import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

// Need crypto.randomUUID polyfill for Node < 19
if (!globalThis.crypto) {
  const { webcrypto } = await import('node:crypto');
  globalThis.crypto = webcrypto;
}

import {
  WS_KEY,
  WS_ACTIVE_KEY,
  loadWorkspaces,
  saveWorkspaces,
  getActiveWorkspaceId,
  setActiveWorkspaceId,
  ensureDefaultWorkspace,
  createWorkspace,
  renameWorkspace,
  getWorkspaceName,
  touchWorkspace,
  __resetForTests,
} from '../clawser-workspaces.js';

describe('Workspace CRUD', () => {
  beforeEach(() => {
    localStorage.clear();
    __resetForTests();
  });

  it('loadWorkspaces returns [] when empty', () => {
    assert.deepEqual(loadWorkspaces(), []);
  });

  it('loadWorkspaces returns [] for bad JSON', () => {
    localStorage.setItem(WS_KEY, 'not json');
    assert.deepEqual(loadWorkspaces(), []);
  });

  it('saveWorkspaces + loadWorkspaces round-trip', () => {
    const list = [{ id: 'ws1', name: 'Test' }];
    saveWorkspaces(list);
    const loaded = loadWorkspaces();
    assert.equal(loaded.length, 1);
    assert.equal(loaded[0].id, 'ws1');
    assert.equal(loaded[0].name, 'Test');
  });

  it('getActiveWorkspaceId defaults to "default"', () => {
    assert.equal(getActiveWorkspaceId(), 'default');
  });

  it('setActiveWorkspaceId persists value', () => {
    setActiveWorkspaceId('ws_custom');
    assert.equal(getActiveWorkspaceId(), 'ws_custom');
  });

  it('ensureDefaultWorkspace creates default on first call', () => {
    const list = ensureDefaultWorkspace();
    assert.ok(list.length >= 1);
    assert.ok(list.some(w => w.id === 'default'));
  });

  it('ensureDefaultWorkspace is idempotent', () => {
    ensureDefaultWorkspace();
    const list = ensureDefaultWorkspace();
    const defaults = list.filter(w => w.id === 'default');
    assert.equal(defaults.length, 1);
  });

  it('createWorkspace returns new ID and persists', () => {
    ensureDefaultWorkspace();
    const id = createWorkspace('My Workspace');
    assert.ok(id.startsWith('ws_'));
    const list = loadWorkspaces();
    assert.ok(list.some(w => w.id === id && w.name === 'My Workspace'));
  });

  it('createWorkspace auto-names when no name given', () => {
    ensureDefaultWorkspace();
    const id = createWorkspace();
    const list = loadWorkspaces();
    const ws = list.find(w => w.id === id);
    assert.ok(ws.name.startsWith('workspace'));
  });

  it('renameWorkspace updates name', () => {
    ensureDefaultWorkspace();
    renameWorkspace('default', 'Renamed');
    assert.equal(getWorkspaceName('default'), 'Renamed');
  });

  it('renameWorkspace no-ops for missing workspace', () => {
    ensureDefaultWorkspace();
    renameWorkspace('nonexistent', 'X');
    // Just should not throw
  });

  it('getWorkspaceName returns workspace name', () => {
    ensureDefaultWorkspace();
    assert.equal(getWorkspaceName('default'), 'workspace');
  });

  it('getWorkspaceName returns fallback for missing', () => {
    assert.equal(getWorkspaceName('nonexistent'), 'workspace');
  });

  it('touchWorkspace updates lastUsed timestamp', () => {
    ensureDefaultWorkspace();
    const before = loadWorkspaces().find(w => w.id === 'default').lastUsed;
    // Small delay to ensure timestamp differs
    touchWorkspace('default');
    const after = loadWorkspaces().find(w => w.id === 'default').lastUsed;
    assert.ok(after >= before);
  });

  it('touchWorkspace no-ops for missing workspace', () => {
    ensureDefaultWorkspace();
    assert.doesNotThrow(() => touchWorkspace('nonexistent'));
  });

  it('WS_KEY and WS_ACTIVE_KEY are strings', () => {
    assert.equal(typeof WS_KEY, 'string');
    assert.equal(typeof WS_ACTIVE_KEY, 'string');
  });
});

// ── OPFS-backed cache + migration ─────────────────────────────────

describe('initWorkspacesCache — OPFS + migration', () => {
  // In-memory OPFS stub
  const createMemoryOPFS = () => {
    const dirs = new Map();
    const files = new Map();
    const ensureDir = (path) => {
      if (dirs.has(path)) return;
      // Recursively create any parent dirs as well
      if (path) {
        const parts = path.split('/');
        let acc = '';
        for (const p of parts) {
          acc = acc ? `${acc}/${p}` : p;
          if (!dirs.has(acc)) dirs.set(acc, makeDir(acc, false));
        }
      } else {
        dirs.set('', makeDir('', false));
      }
    };
    const makeDir = (path, register = true) => {
      const handle = {
        kind: 'directory',
        getDirectoryHandle: async (name, opts = {}) => {
          const childPath = path ? `${path}/${name}` : name;
          if (!dirs.has(childPath) && opts.create) {
            ensureDir(childPath);
          }
          if (!dirs.has(childPath)) throw new Error(`NotFound: ${childPath}`);
          return dirs.get(childPath);
        },
        getFileHandle: async (name, opts = {}) => {
          const filePath = path ? `${path}/${name}` : name;
          if (!files.has(filePath) && !opts.create) throw new Error(`NotFound: ${filePath}`);
          if (!files.has(filePath)) files.set(filePath, '');
          return makeFile(filePath);
        },
      };
      if (register) dirs.set(path, handle);
      return handle;
    };
    const makeFile = (filePath) => ({
      kind: 'file',
      getFile: async () => ({ text: async () => files.get(filePath) || '' }),
      createWritable: async () => {
        let buf = '';
        return {
          write: async (data) => { buf += typeof data === 'string' ? data : String(data); },
          close: async () => { files.set(filePath, buf); },
        };
      },
    });
    ensureDir('');
    return { root: dirs.get(''), files, dirs, ensureDir };
  };

  let memOPFS;
  beforeEach(() => {
    localStorage.clear();
    __resetForTests();
    memOPFS = createMemoryOPFS();
    Object.defineProperty(globalThis.navigator, 'storage', {
      value: { getDirectory: async () => memOPFS.root },
      configurable: true,
    });
  });

  it('reads from OPFS when /etc/clawser/workspaces.json exists', async () => {
    memOPFS.ensureDir('clawser/etc/clawser');
    memOPFS.files.set('clawser/etc/clawser/workspaces.json', JSON.stringify([
      { id: 'opfs-ws', name: 'From OPFS' },
    ]));
    memOPFS.files.set('clawser/etc/clawser/active-workspace', 'opfs-ws');

    const { initWorkspacesCache } = await import('../clawser-workspaces.js');
    await initWorkspacesCache();

    assert.equal(loadWorkspaces().length, 1);
    assert.equal(loadWorkspaces()[0].id, 'opfs-ws');
    assert.equal(getActiveWorkspaceId(), 'opfs-ws');
  });

  it('migrates from localStorage to OPFS when OPFS is empty', async () => {
    localStorage.setItem(WS_KEY, JSON.stringify([{ id: 'legacy', name: 'Legacy' }]));
    localStorage.setItem(WS_ACTIVE_KEY, 'legacy');

    const { initWorkspacesCache } = await import('../clawser-workspaces.js');
    await initWorkspacesCache();

    // Cache reflects localStorage content
    assert.equal(loadWorkspaces()[0].id, 'legacy');
    assert.equal(getActiveWorkspaceId(), 'legacy');

    // Wait for the background OPFS write to land
    await new Promise(r => setTimeout(r, 30));

    const written = memOPFS.files.get('clawser/etc/clawser/workspaces.json');
    assert.ok(written, 'OPFS file should be populated by migration');
    const parsed = JSON.parse(written);
    assert.equal(parsed[0].id, 'legacy');
  });

  it('returns defaults when both OPFS and localStorage are empty', async () => {
    const { initWorkspacesCache } = await import('../clawser-workspaces.js');
    await initWorkspacesCache();
    assert.deepEqual(loadWorkspaces(), []);
    assert.equal(getActiveWorkspaceId(), 'default');
  });

  it('saveWorkspaces writes to OPFS asynchronously', async () => {
    const { initWorkspacesCache } = await import('../clawser-workspaces.js');
    await initWorkspacesCache();

    saveWorkspaces([{ id: 'fresh', name: 'Fresh' }]);
    setActiveWorkspaceId('fresh');
    await new Promise(r => setTimeout(r, 30));

    const written = memOPFS.files.get('clawser/etc/clawser/workspaces.json');
    assert.ok(written);
    assert.equal(JSON.parse(written)[0].id, 'fresh');
    assert.equal(memOPFS.files.get('clawser/etc/clawser/active-workspace'), 'fresh');
  });

  it('initWorkspacesCache is idempotent', async () => {
    memOPFS.ensureDir('clawser/etc/clawser');
    memOPFS.files.set('clawser/etc/clawser/workspaces.json', JSON.stringify([{ id: 'x' }]));
    const { initWorkspacesCache } = await import('../clawser-workspaces.js');
    await initWorkspacesCache();
    await initWorkspacesCache(); // no-op
    assert.equal(loadWorkspaces()[0].id, 'x');
  });
});
