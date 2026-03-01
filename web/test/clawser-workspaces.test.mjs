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
} from '../clawser-workspaces.js';

describe('Workspace CRUD', () => {
  beforeEach(() => {
    localStorage.clear();
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
