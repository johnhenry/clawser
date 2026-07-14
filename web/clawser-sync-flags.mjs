/**
 * clawser-sync-flags.mjs — Per-item "sync to my devices" flag storage.
 *
 * A skill, workspace config entry, or memory item is opted into
 * personal multi-device sync by flipping a `sync` flag. The flags are
 * persisted in an OPFS file `__sync_flags__.json` so they survive
 * reloads and aren't workspace-scoped (the user is one entity across
 * workspaces, even if their secrets aren't).
 *
 * Flagged items are addressed by a fully-qualified id of the form
 * `{kind}:{id}` — e.g. `skill:my-skill`, `config:autonomy`,
 * `memory:abc123`. Consumers (sync engine, UI) reason about the kinds
 * they care about; this module is kind-agnostic.
 */

const FLAGS_FILE = '__sync_flags__';
const VERSION = 1;

/**
 * Build a flag id from kind + id. Validates and returns the canonical
 * `kind:id` form. Useful so the sync engine and UI can't disagree on
 * the wire spelling.
 *
 * @param {string} kind  — `skill` | `config` | `memory` | future
 * @param {string} id
 * @returns {string}
 */
export const flagId = (kind, id) => {
  if (typeof kind !== 'string' || !/^[a-z][a-z0-9_-]{0,30}$/.test(kind)) {
    throw new Error(`Invalid sync-flag kind: ${kind}`);
  }
  if (typeof id !== 'string' || id.length === 0 || id.length > 200) {
    throw new Error(`Invalid sync-flag id: ${id}`);
  }
  return `${kind}:${id}`;
};

/**
 * @typedef {object} SyncFlagsStorage
 * @property {(name: string) => Promise<Uint8Array|null>} read
 * @property {(name: string, packed: Uint8Array) => Promise<void>} write
 */

const enc = new TextEncoder();
const dec = new TextDecoder();

/**
 * Per-process flag store backed by an OPFS-shaped storage adapter.
 * Constructor argument is the same `OPFSVaultStorage`-style interface
 * the rest of the codebase uses; tests pass a memory shim.
 */
export class SyncFlags {
  #storage;
  #cache = null; // Set<string> | null

  /** @param {SyncFlagsStorage} storage */
  constructor(storage) { this.#storage = storage; }

  async #ensureLoaded() {
    if (this.#cache) return this.#cache;
    const raw = await this.#storage.read(FLAGS_FILE);
    if (!raw) {
      this.#cache = new Set();
      return this.#cache;
    }
    try {
      const parsed = JSON.parse(dec.decode(raw));
      if (parsed?.version !== VERSION) {
        throw new Error(`Unsupported sync-flags version: ${parsed?.version}`);
      }
      this.#cache = new Set(Array.isArray(parsed.flagged) ? parsed.flagged : []);
    } catch (e) {
      // Corrupted file — start over. We never had any data to lose
      // beyond user's flag selections, which they can re-toggle.
      console.warn('[clawser-sync-flags] reset corrupted flags file:', e?.message || e);
      this.#cache = new Set();
    }
    return this.#cache;
  }

  async #persist() {
    const cache = this.#cache || new Set();
    const json = JSON.stringify({ version: VERSION, flagged: [...cache].sort() });
    await this.#storage.write(FLAGS_FILE, enc.encode(json));
  }

  /**
   * Check whether an item is flagged for sync.
   * @param {string} fid - From `flagId(kind, id)`
   * @returns {Promise<boolean>}
   */
  async isFlagged(fid) {
    const cache = await this.#ensureLoaded();
    return cache.has(fid);
  }

  /**
   * Set the flag for an item (true = sync, false = don't).
   * No-ops when the value is already correct.
   * @param {string} fid
   * @param {boolean} value
   * @returns {Promise<boolean>} the new value
   */
  async setFlag(fid, value) {
    const cache = await this.#ensureLoaded();
    const want = !!value;
    const has = cache.has(fid);
    if (want === has) return want;
    if (want) cache.add(fid);
    else cache.delete(fid);
    await this.#persist();
    return want;
  }

  /**
   * Toggle the flag and return the new value.
   * @param {string} fid
   * @returns {Promise<boolean>}
   */
  async toggle(fid) {
    const cache = await this.#ensureLoaded();
    return this.setFlag(fid, !cache.has(fid));
  }

  /**
   * List all flagged ids, optionally filtered by kind prefix.
   * @param {string} [kindFilter]  — e.g. `'skill'`
   * @returns {Promise<string[]>}
   */
  async listFlagged(kindFilter) {
    const cache = await this.#ensureLoaded();
    const all = [...cache].sort();
    if (!kindFilter) return all;
    const prefix = `${kindFilter}:`;
    return all.filter(f => f.startsWith(prefix));
  }

  /** Wipe every flag (used by reset / unpair). */
  async clear() {
    this.#cache = new Set();
    await this.#persist();
  }
}
