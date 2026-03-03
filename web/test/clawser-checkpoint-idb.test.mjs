// Run with: node --import ./web/test/_setup-globals.mjs --test web/test/clawser-checkpoint-idb.test.mjs
import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { CheckpointIndexedDB } from '../clawser-checkpoint-idb.js';

// ── IndexedDB stub for Node.js ───────────────────────────────────

class StubObjectStore {
  #data = new Map();
  put(data, key) { this.#data.set(key, structuredClone(data)); return { set onsuccess(fn) { fn(); }, set onerror(_) {} }; }
  get(key) { const v = this.#data.get(key); return { result: v, set onsuccess(fn) { fn(); }, set onerror(_) {} }; }
  delete(key) { this.#data.delete(key); return { set onsuccess(fn) { fn(); }, set onerror(_) {} }; }
  getAllKeys() { return { result: [...this.#data.keys()], set onsuccess(fn) { fn(); }, set onerror(_) {} }; }
  clear() { this.#data.clear(); return { set onsuccess(fn) { fn(); }, set onerror(_) {} }; }
}

class StubTransaction {
  #store;
  constructor(store) { this.#store = store; }
  objectStore() { return this.#store; }
  set oncomplete(fn) { fn(); }
}

class StubDB {
  #store = new StubObjectStore();
  #storeNames = { contains: () => true };
  get objectStoreNames() { return this.#storeNames; }
  createObjectStore() { return this.#store; }
  transaction() { return new StubTransaction(this.#store); }
  close() {}
}

// Install stub indexedDB
const stubDB = new StubDB();
globalThis.indexedDB = {
  open() {
    const req = {
      result: stubDB,
      set onupgradeneeded(fn) { fn(); },
      set onsuccess(fn) { fn(); },
      set onerror(_) {},
    };
    return req;
  },
};
globalThis.structuredClone = globalThis.structuredClone || (v => JSON.parse(JSON.stringify(v)));

// ── Tests ────────────────────────────────────────────────────────

describe('CheckpointIndexedDB', () => {
  let idb;

  beforeEach(async () => {
    idb = new CheckpointIndexedDB();
    await idb.clear();
  });

  it('write and read checkpoint', async () => {
    await idb.write('test_key', { foo: 'bar', nested: { a: 1 } });
    const data = await idb.read('test_key');
    assert.deepEqual(data, { foo: 'bar', nested: { a: 1 } });
  });

  it('read returns null for missing key', async () => {
    const data = await idb.read('nonexistent');
    assert.equal(data, null);
  });

  it('delete removes checkpoint', async () => {
    await idb.write('temp', 123);
    await idb.delete('temp');
    const data = await idb.read('temp');
    assert.equal(data, null);
  });

  it('keys lists all stored keys', async () => {
    await idb.write('a', 1);
    await idb.write('b', 2);
    const keys = await idb.keys();
    assert.ok(keys.includes('a'));
    assert.ok(keys.includes('b'));
  });

  it('clear removes all data', async () => {
    await idb.write('x', 1);
    await idb.write('y', 2);
    await idb.clear();
    const keys = await idb.keys();
    assert.equal(keys.length, 0);
  });

  it('write overwrites existing data', async () => {
    await idb.write('key', { v: 1 });
    await idb.write('key', { v: 2 });
    const data = await idb.read('key');
    assert.deepEqual(data, { v: 2 });
  });
});
