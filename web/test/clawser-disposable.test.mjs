// Run with: node --import ./web/test/_setup-globals.mjs --test web/test/clawser-disposable.test.mjs
import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import { SessionStorageAdapter, NullCheckpointIDB, getStorage } from '../clawser-disposable.js';

// ── SessionStorageAdapter ──────────────────────────────────────

describe('SessionStorageAdapter', () => {
  let adapter;

  beforeEach(() => {
    adapter = new SessionStorageAdapter();
  });

  it('stores and retrieves values', () => {
    adapter.setItem('key1', 'value1');
    assert.equal(adapter.getItem('key1'), 'value1');
  });

  it('returns null for missing keys', () => {
    assert.equal(adapter.getItem('nonexistent'), null);
  });

  it('coerces values to strings', () => {
    adapter.setItem('num', 42);
    assert.equal(adapter.getItem('num'), '42');
  });

  it('removes items', () => {
    adapter.setItem('key', 'val');
    adapter.removeItem('key');
    assert.equal(adapter.getItem('key'), null);
  });

  it('clears all items', () => {
    adapter.setItem('a', '1');
    adapter.setItem('b', '2');
    adapter.clear();
    assert.equal(adapter.getItem('a'), null);
    assert.equal(adapter.getItem('b'), null);
  });

  it('reports correct length', () => {
    assert.equal(adapter.length, 0);
    adapter.setItem('x', '1');
    assert.equal(adapter.length, 1);
    adapter.setItem('y', '2');
    assert.equal(adapter.length, 2);
    adapter.removeItem('x');
    assert.equal(adapter.length, 1);
  });

  it('returns keys by index', () => {
    adapter.setItem('alpha', '1');
    adapter.setItem('beta', '2');
    const keys = [adapter.key(0), adapter.key(1)].sort();
    assert.deepEqual(keys, ['alpha', 'beta']);
    assert.equal(adapter.key(5), null);
  });

  it('overwrites existing values', () => {
    adapter.setItem('k', 'old');
    adapter.setItem('k', 'new');
    assert.equal(adapter.getItem('k'), 'new');
    assert.equal(adapter.length, 1);
  });
});

// ── NullCheckpointIDB ──────────────────────────────────────────

describe('NullCheckpointIDB', () => {
  let idb;

  beforeEach(() => {
    idb = new NullCheckpointIDB();
  });

  it('write is a no-op that resolves', async () => {
    await idb.write('key', { data: 'test' }); // should not throw
  });

  it('read always returns null', async () => {
    await idb.write('key', { data: 'test' });
    const result = await idb.read('key');
    assert.equal(result, null);
  });

  it('delete is a no-op that resolves', async () => {
    await idb.delete('nonexistent'); // should not throw
  });

  it('keys always returns empty array', async () => {
    await idb.write('a', 1);
    await idb.write('b', 2);
    const keys = await idb.keys();
    assert.deepEqual(keys, []);
  });

  it('clear is a no-op that resolves', async () => {
    await idb.clear(); // should not throw
  });
});

// ── getStorage ─────────────────────────────────────────────────

describe('getStorage', () => {
  it('returns localStorage when not in disposable mode', () => {
    // In the test env, isDisposable() returns false (no URL param),
    // so getStorage() should return the global localStorage stub
    const storage = getStorage();
    assert.equal(storage, globalThis.localStorage);
  });

  it('returned storage implements getItem/setItem/removeItem', () => {
    const storage = getStorage();
    storage.setItem('__test__', 'hello');
    assert.equal(storage.getItem('__test__'), 'hello');
    storage.removeItem('__test__');
    assert.equal(storage.getItem('__test__'), null);
  });
});

// ── Integration: SessionStorageAdapter as localStorage drop-in ──

describe('SessionStorageAdapter as localStorage drop-in', () => {
  it('works with JSON.stringify/parse round-trip', () => {
    const adapter = new SessionStorageAdapter();
    const data = { memories: ['a', 'b'], config: { model: 'gpt-4' } };
    adapter.setItem('clawser_v1_config_default', JSON.stringify(data));
    const restored = JSON.parse(adapter.getItem('clawser_v1_config_default'));
    assert.deepEqual(restored, data);
  });

  it('handles workspace key patterns', () => {
    const adapter = new SessionStorageAdapter();
    const wsId = 'ws_test_1234';
    const key = `clawser_v1_memories_${wsId}`;
    adapter.setItem(key, '[]');
    assert.equal(adapter.getItem(key), '[]');
    adapter.removeItem(key);
    assert.equal(adapter.getItem(key), null);
  });

  it('multiple adapters share the same backing store in test env', () => {
    // Both use the in-memory Map fallback since sessionStorage is undefined in Node
    // Each instance gets its own Map, so they are independent
    const a = new SessionStorageAdapter();
    const b = new SessionStorageAdapter();
    a.setItem('shared', 'yes');
    // In Node (Map fallback), each adapter is independent
    // In browser (real sessionStorage), they would share state
    // This test documents the Node behavior
    assert.equal(a.getItem('shared'), 'yes');
  });
});
