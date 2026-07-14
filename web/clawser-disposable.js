/**
 * clawser-disposable.js — Disposable (ephemeral) workspace mode
 *
 * When activated via `?disposable=true` URL parameter or config toggle,
 * nothing persists after tab close:
 *   - sessionStorage replaces localStorage (cleared on tab close)
 *   - IndexedDB writes are no-ops
 *   - Vault creation is skipped (MemoryVaultStorage used instead)
 *   - OPFS writes are skipped (MemoryFs used for workspace files)
 *
 * @example
 *   import { isDisposable, SessionStorageAdapter, NullCheckpointIDB } from './clawser-disposable.js';
 *   if (isDisposable()) {
 *     // use ephemeral adapters
 *   }
 */

// ── Detection ───────────────────────────────────────────────────

/**
 * Check if disposable mode is active.
 * Activated by URL parameter `?disposable=true` (not `?disposable=false`).
 * @returns {boolean}
 */
export const isDisposable = (() => {
  if (typeof location === 'undefined' || !location.search) return () => false;
  const p = new URLSearchParams(location.search);
  const active = p.has('disposable') && p.get('disposable') !== 'false';
  return () => active;
})();

// ── SessionStorage adapter (localStorage-compatible interface) ──

/**
 * Wraps sessionStorage with the same interface as localStorage.
 * All data is lost when the tab/window closes.
 *
 * Falls back to an in-memory Map if sessionStorage is unavailable
 * (e.g. in Node.js test environments).
 */
export class SessionStorageAdapter {
  #store;
  #isMemory;

  constructor() {
    if (typeof sessionStorage !== 'undefined') {
      this.#store = sessionStorage;
      this.#isMemory = false;
    } else {
      this.#store = new Map();
      this.#isMemory = true;
    }
  }

  /** @param {string} key @returns {string|null} */
  getItem(key) {
    if (this.#isMemory) return this.#store.get(key) ?? null;
    return this.#store.getItem(key);
  }

  /** @param {string} key @param {string} value */
  setItem(key, value) {
    if (this.#isMemory) { this.#store.set(key, String(value)); return; }
    this.#store.setItem(key, String(value));
  }

  /** @param {string} key */
  removeItem(key) {
    if (this.#isMemory) { this.#store.delete(key); return; }
    this.#store.removeItem(key);
  }

  clear() {
    if (this.#isMemory) { this.#store.clear(); return; }
    this.#store.clear();
  }

  /** @param {number} index @returns {string|null} */
  key(index) {
    if (this.#isMemory) {
      const keys = [...this.#store.keys()];
      return keys[index] ?? null;
    }
    return this.#store.key(index);
  }

  /** @returns {number} */
  get length() {
    if (this.#isMemory) return this.#store.size;
    return this.#store.length;
  }
}

// ── Null IndexedDB adapter (no-op for disposable mode) ──────────

/**
 * Drop-in replacement for CheckpointIndexedDB that performs no I/O.
 * All writes are silently discarded; reads return null/empty.
 */
export class NullCheckpointIDB {
  /** @param {string} _key @param {*} _data */
  async write(_key, _data) { /* no-op */ }

  /** @param {string} _key @returns {Promise<null>} */
  async read(_key) { return null; }

  /** @param {string} _key */
  async delete(_key) { /* no-op */ }

  /** @returns {Promise<string[]>} */
  async keys() { return []; }

  async clear() { /* no-op */ }
}

// ── Disposable storage proxy ────────────────────────────────────

/**
 * Returns the appropriate storage backend based on disposable mode.
 * In disposable mode, returns a SessionStorageAdapter.
 * Otherwise, returns the real localStorage.
 * @returns {Storage|SessionStorageAdapter}
 */
export const getStorage = (() => {
  let _instance = null;
  return () => {
    if (!isDisposable()) return localStorage;
    if (!_instance) _instance = new SessionStorageAdapter();
    return _instance;
  };
})();
