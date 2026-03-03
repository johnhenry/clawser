/**
 * clawser-checkpoint-idb.js — IndexedDB checkpoint storage
 *
 * Works in Service Workers, extension background scripts, and regular page contexts.
 * Provides read/write interface for checkpoint data that persists across all tabs.
 */

const DB_NAME = 'clawser_checkpoints';
const DB_VERSION = 1;
const STORE_NAME = 'checkpoints';

/**
 * Open the IndexedDB database.
 * @returns {Promise<IDBDatabase>}
 */
function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

/**
 * Run a read/write transaction on the checkpoint store.
 * @template T
 * @param {'readonly'|'readwrite'} mode
 * @param {(store: IDBObjectStore) => IDBRequest} fn
 * @returns {Promise<T>}
 */
async function withStore(mode, fn) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, mode);
    const store = tx.objectStore(STORE_NAME);
    const req = fn(store);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => { db.close(); reject(req.error); };
    tx.oncomplete = () => db.close();
    tx.onabort = () => { db.close(); reject(tx.error || new Error('Transaction aborted')); };
  });
}

export class CheckpointIndexedDB {
  /**
   * Write a checkpoint to IndexedDB.
   * @param {string} key - Checkpoint key (e.g., 'checkpoint_latest', 'routine_state')
   * @param {*} data - Serializable data to store
   */
  async write(key, data) {
    await withStore('readwrite', store => store.put(data, key));
  }

  /**
   * Read a checkpoint from IndexedDB.
   * @param {string} key - Checkpoint key
   * @returns {Promise<*|null>} Stored data or null if not found
   */
  async read(key) {
    const result = await withStore('readonly', store => store.get(key));
    return result ?? null;
  }

  /**
   * Delete a checkpoint from IndexedDB.
   * @param {string} key
   */
  async delete(key) {
    await withStore('readwrite', store => store.delete(key));
  }

  /**
   * List all checkpoint keys.
   * @returns {Promise<string[]>}
   */
  async keys() {
    return withStore('readonly', store => store.getAllKeys());
  }

  /**
   * Clear all checkpoints.
   */
  async clear() {
    await withStore('readwrite', store => store.clear());
  }
}
