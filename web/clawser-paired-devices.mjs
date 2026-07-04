/**
 * clawser-paired-devices.mjs — global registry of paired devices.
 *
 * "Paired devices" = the user's other devices that share their mesh
 * identity (the W3C did:key bundle handed off via the
 * `clawser-pairing.mjs` flow). The registry is GLOBAL, not
 * per-workspace — devices belong to the identity, not to any one
 * workspace's security context.
 *
 * Storage: `~/.config/clawser/paired-devices.json` resolved via the
 * default workspace's path (the file is global; the resolver just
 * needs SOME wsId to walk OPFS — we use the active workspace's ID
 * at construction time, but the file itself is a singleton).
 *
 * Entry shape:
 *   { deviceId, label, addedAt, lastSyncAt, peerPublicKey, peerDid }
 *
 * Public API:
 *   - list()                     → entries[]
 *   - get(deviceId)              → entry | null
 *   - add(entry)                 → returns the persisted entry (with deviceId if missing)
 *   - remove(deviceId)           → boolean (false if not found)
 *   - setLabel(deviceId, label)  → boolean
 *   - recordSync(deviceId, ts?)  → boolean
 *   - subscribe(callback)        → unsubscribe; callback receives the new list[] on every change
 *   - clear()                    — wipes everything (used by reset-all-data)
 *
 * Persistence is per-instance — the store loads lazily on first
 * read/write and writes through on every mutation. Subscribers fire
 * AFTER the persist resolves so reads are coherent.
 */

const VERSION = 1;
const FILE = '__paired_devices__';

const enc = new TextEncoder();
const dec = new TextDecoder();

const generateDeviceId = () => {
  const r = crypto.getRandomValues(new Uint8Array(8));
  let hex = '';
  for (let i = 0; i < r.length; i++) hex += r[i].toString(16).padStart(2, '0');
  return `dev-${Date.now().toString(36)}-${hex}`;
};

/**
 * @typedef {object} PairedDeviceEntry
 * @property {string} deviceId
 * @property {string} label
 * @property {number} addedAt
 * @property {number|null} lastSyncAt
 * @property {string|null} peerPublicKey
 * @property {string|null} peerDid
 */

export class PairedDevicesStore {
  #storage;
  #entries = null; // lazy-loaded
  #subscribers = new Set();

  /**
   * @param {object} storage  — `{read(name), write(name, bytes)}` (matches
   *                            `createWorkspaceConfigStorage` shape)
   */
  constructor(storage) {
    if (!storage || typeof storage.read !== 'function' || typeof storage.write !== 'function') {
      throw new Error('PairedDevicesStore: storage with read/write required');
    }
    this.#storage = storage;
  }

  async #ensureLoaded() {
    if (this.#entries) return this.#entries;
    const raw = await this.#storage.read(FILE);
    if (!raw) {
      this.#entries = [];
      return this.#entries;
    }
    try {
      const parsed = JSON.parse(dec.decode(raw));
      if (parsed?.version !== VERSION) {
        console.warn('[clawser-paired-devices] reset due to version mismatch:', parsed?.version);
        this.#entries = [];
        return this.#entries;
      }
      this.#entries = Array.isArray(parsed.entries) ? parsed.entries : [];
    } catch (e) {
      console.warn('[clawser-paired-devices] reset corrupted file:', e?.message || e);
      this.#entries = [];
    }
    return this.#entries;
  }

  async #persist() {
    const json = JSON.stringify({ version: VERSION, entries: this.#entries || [] });
    await this.#storage.write(FILE, enc.encode(json));
  }

  /** Notify subscribers of the current list. Defensive copy. */
  #notify() {
    const snapshot = (this.#entries || []).map(e => ({ ...e }));
    for (const cb of this.#subscribers) {
      try { cb(snapshot); }
      catch (err) { console.warn('[clawser-paired-devices] subscriber threw:', err?.message || err); }
    }
  }

  /**
   * Get the full list. Defensive copy.
   * @returns {Promise<PairedDeviceEntry[]>}
   */
  async list() {
    const arr = await this.#ensureLoaded();
    return arr.map(e => ({ ...e }));
  }

  /**
   * Get one entry.
   * @param {string} deviceId
   * @returns {Promise<PairedDeviceEntry|null>}
   */
  async get(deviceId) {
    const arr = await this.#ensureLoaded();
    const found = arr.find(e => e.deviceId === deviceId);
    return found ? { ...found } : null;
  }

  /**
   * Add a new device entry. If `entry.deviceId` is missing, a fresh
   * one is generated. If a device with the same id already exists,
   * the existing entry is returned unchanged (no duplicate-add).
   *
   * @param {Partial<PairedDeviceEntry>} entry
   * @returns {Promise<PairedDeviceEntry>}
   */
  async add(entry) {
    const arr = await this.#ensureLoaded();
    const deviceId = (typeof entry?.deviceId === 'string' && entry.deviceId)
      ? entry.deviceId
      : generateDeviceId();
    const existing = arr.find(e => e.deviceId === deviceId);
    if (existing) return { ...existing };
    const persisted = {
      deviceId,
      label: typeof entry?.label === 'string' ? entry.label : 'Paired device',
      addedAt: typeof entry?.addedAt === 'number' ? entry.addedAt : Date.now(),
      lastSyncAt: entry?.lastSyncAt ?? null,
      peerPublicKey: entry?.peerPublicKey ?? null,
      peerDid: entry?.peerDid ?? null,
    };
    arr.push(persisted);
    await this.#persist();
    this.#notify();
    return { ...persisted };
  }

  /**
   * Remove a device by id.
   * @param {string} deviceId
   * @returns {Promise<boolean>}
   */
  async remove(deviceId) {
    const arr = await this.#ensureLoaded();
    const idx = arr.findIndex(e => e.deviceId === deviceId);
    if (idx < 0) return false;
    arr.splice(idx, 1);
    await this.#persist();
    this.#notify();
    return true;
  }

  /**
   * Merge a partial patch into an existing entry. Returns false on
   * miss. `deviceId` and `addedAt` cannot be changed by the patch.
   *
   * @param {string} deviceId
   * @param {Partial<PairedDeviceEntry> & {syncEnabled?:boolean}} patch
   * @returns {Promise<boolean>}
   */
  async update(deviceId, patch) {
    if (!patch || typeof patch !== 'object') return false;
    const arr = await this.#ensureLoaded();
    const idx = arr.findIndex(e => e.deviceId === deviceId);
    if (idx < 0) return false;
    const next = { ...arr[idx], ...patch, deviceId: arr[idx].deviceId, addedAt: arr[idx].addedAt };
    arr[idx] = next;
    await this.#persist();
    this.#notify();
    return true;
  }

  /**
   * Update a device's user-visible label.
   * @param {string} deviceId
   * @param {string} label
   * @returns {Promise<boolean>}
   */
  async setLabel(deviceId, label) {
    if (typeof label !== 'string') return false;
    const arr = await this.#ensureLoaded();
    const entry = arr.find(e => e.deviceId === deviceId);
    if (!entry) return false;
    entry.label = label;
    await this.#persist();
    this.#notify();
    return true;
  }

  /**
   * Stamp a device's `lastSyncAt`. Called by the sync engine after
   * a successful push/pull to that device.
   * @param {string} deviceId
   * @param {number} [timestamp]
   * @returns {Promise<boolean>}
   */
  async recordSync(deviceId, timestamp) {
    const arr = await this.#ensureLoaded();
    const entry = arr.find(e => e.deviceId === deviceId);
    if (!entry) return false;
    entry.lastSyncAt = typeof timestamp === 'number' ? timestamp : Date.now();
    await this.#persist();
    this.#notify();
    return true;
  }

  /**
   * Subscribe to mutations. Callback receives a defensive-copy list
   * after every change. Returns an unsubscribe function.
   * @param {(entries: PairedDeviceEntry[]) => void} cb
   * @returns {() => void}
   */
  subscribe(cb) {
    if (typeof cb !== 'function') return () => {};
    this.#subscribers.add(cb);
    return () => this.#subscribers.delete(cb);
  }

  /** Wipe the registry. */
  async clear() {
    this.#entries = [];
    await this.#persist();
    this.#notify();
  }
}

export const _internals = { VERSION, FILE, generateDeviceId };
