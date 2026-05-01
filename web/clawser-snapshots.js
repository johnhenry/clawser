/**
 * clawser-snapshots.js — Atomic Workspace Snapshots
 *
 * Save and restore complete workspace state as a single compressed
 * IndexedDB blob. All subsystem state is serialized into one object,
 * compressed with fflate, and stored atomically.
 *
 * Subsystems captured:
 *   - EventLog (JSONL)
 *   - SemanticMemory (flat array)
 *   - Goals (derived from events or agent checkpoint)
 *   - Scheduler/Routine jobs (RoutineEngine.toJSON())
 *   - Config (provider, model, system prompt)
 *   - Shell state (env, cwd, aliases, history)
 *   - Skill activations
 *   - Agent definitions (checkpoint JSON)
 *   - Hook pipeline
 *   - Autonomy settings
 *   - Identity settings
 *
 * @example
 *   import { SnapshotManager } from './clawser-snapshots.js';
 *   const mgr = new SnapshotManager({ idb });
 *   const meta = await mgr.createAtomicSnapshot({ agent, routineEngine, shell, ... });
 *   await mgr.restoreAtomicSnapshot(meta.id);
 */

// ── Constants ──────────────────────────────────────────────────

const DB_NAME = 'clawser_snapshots';
const DB_VERSION = 1;
const STORE_NAME = 'snapshots';
const META_STORE = 'snapshot_meta';
const SNAPSHOT_VERSION = 1;

// ── IndexedDB helpers ──────────────────────────────────────────

/**
 * Open the snapshots IndexedDB database.
 * @returns {Promise<IDBDatabase>}
 */
const openDB = () => new Promise((resolve, reject) => {
  const req = indexedDB.open(DB_NAME, DB_VERSION);
  req.onupgradeneeded = () => {
    const db = req.result;
    if (!db.objectStoreNames.contains(STORE_NAME)) {
      db.createObjectStore(STORE_NAME);
    }
    if (!db.objectStoreNames.contains(META_STORE)) {
      db.createObjectStore(META_STORE);
    }
  };
  req.onsuccess = () => resolve(req.result);
  req.onerror = () => reject(req.error);
});

/**
 * Run a transaction across one or more stores.
 * @template T
 * @param {string|string[]} stores
 * @param {'readonly'|'readwrite'} mode
 * @param {(getStore: (name: string) => IDBObjectStore) => IDBRequest|IDBRequest[]} fn
 * @returns {Promise<T>}
 */
const withTx = async (stores, mode, fn) => {
  const db = await openDB();
  const storeNames = Array.isArray(stores) ? stores : [stores];
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeNames, mode);
    const getStore = (name) => tx.objectStore(name);
    const result = fn(getStore);
    const req = Array.isArray(result) ? result[result.length - 1] : result;
    if (req && req.onsuccess !== undefined) {
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => { db.close(); reject(req.error); };
    }
    tx.oncomplete = () => {
      db.close();
      // If no IDBRequest was returned, resolve on tx completion
      if (!req || req.onsuccess === undefined) resolve(undefined);
    };
    tx.onabort = () => { db.close(); reject(tx.error || new Error('Transaction aborted')); };
    tx.onerror = () => { db.close(); reject(tx.error); };
  });
};

// ── Snapshot serialization helpers ─────────────────────────────

/**
 * Collect all workspace state into a single serializable object.
 *
 * @param {object} opts
 * @param {import('./clawser-agent.js').ClawserAgent} opts.agent
 * @param {import('./clawser-routines.js').RoutineEngine} [opts.routineEngine]
 * @param {import('./clawser-shell.js').ClawserShell} [opts.shell]
 * @param {import('./clawser-skills.js').SkillRegistry} [opts.skillRegistry]
 * @param {string} [opts.wsId]
 * @returns {object}
 */
const collectState = (opts) => {
  const { agent, routineEngine, shell, skillRegistry, wsId } = opts;
  const snapshot = { version: SNAPSHOT_VERSION, wsId: wsId || agent?.getWorkspace?.() || 'default' };

  // 1. EventLog
  try {
    const eventLog = agent?.getEventLog?.();
    snapshot.eventLog = eventLog ? eventLog.toJSONL() : '';
  } catch { snapshot.eventLog = ''; }

  // 2. Checkpoint (includes session_history, active_goals, scheduler_snapshot)
  try {
    snapshot.checkpoint = agent?.getCheckpointJSON?.() || null;
  } catch { snapshot.checkpoint = null; }

  // 3. Memories
  try {
    snapshot.memories = agent?.memory?.exportToFlatArray?.() || [];
  } catch { snapshot.memories = []; }

  // 4. Config
  try {
    snapshot.config = agent?.getConfig?.() || {};
  } catch { snapshot.config = {}; }

  // 5. Routines / Scheduler
  try {
    snapshot.routines = routineEngine?.toJSON?.() || null;
  } catch { snapshot.routines = null; }

  // 6. Shell state
  try {
    if (shell?.state) {
      const s = shell.state;
      snapshot.shell = {
        cwd: s.cwd,
        env: s.env instanceof Map ? Object.fromEntries(s.env) : {},
        history: Array.isArray(s.history) ? s.history : [],
        aliases: s.aliases instanceof Map ? Object.fromEntries(s.aliases) : {},
        lastExitCode: s.lastExitCode ?? 0,
      };
    } else {
      snapshot.shell = null;
    }
  } catch { snapshot.shell = null; }

  // 7. Skill activations
  try {
    if (skillRegistry?.activeSkills) {
      snapshot.skillActivations = [...skillRegistry.activeSkills.keys()];
    } else {
      snapshot.skillActivations = [];
    }
  } catch { snapshot.skillActivations = []; }

  // 8. Hooks
  try {
    snapshot.hooks = agent?.hooks?.serialize?.() || null;
  } catch { snapshot.hooks = null; }

  // 9. localStorage-backed settings (autonomy, identity, security, etc.)
  try {
    const id = snapshot.wsId;
    if (typeof localStorage !== 'undefined') {
      const lsKeys = [
        'autonomy', 'identity', 'security', 'toolPerms', 'selfRepair',
        'sandbox', 'heartbeat', 'skillsEnabled', 'showDotfiles', 'modelConfig',
      ];
      snapshot.localStorage = {};
      for (const key of lsKeys) {
        const fullKey = `clawser_v1_${key.replace(/[A-Z]/g, c => '_' + c.toLowerCase())}_${id}`;
        // Try direct lsKey-style key
        const val = localStorage.getItem(fullKey);
        if (val !== null) {
          snapshot.localStorage[key] = val;
        } else {
          // Try camelCase-to-snake variations
          const snakeKey = key.replace(/[A-Z]/g, c => '_' + c.toLowerCase());
          const altVal = localStorage.getItem(`clawser_v1_${snakeKey}_${id}`);
          if (altVal !== null) snapshot.localStorage[key] = altVal;
        }
      }
    }
  } catch { snapshot.localStorage = {}; }

  return snapshot;
};

/**
 * Restore subsystem state from a deserialized snapshot object.
 *
 * @param {object} data - Deserialized snapshot
 * @param {object} opts
 * @param {import('./clawser-agent.js').ClawserAgent} opts.agent
 * @param {import('./clawser-routines.js').RoutineEngine} [opts.routineEngine]
 * @param {import('./clawser-shell.js').ClawserShell} [opts.shell]
 * @param {import('./clawser-skills.js').SkillRegistry} [opts.skillRegistry]
 * @returns {{ restored: string[], skipped: string[], errors: string[] }}
 */
const applyState = (data, opts) => {
  const { agent, routineEngine, shell, skillRegistry } = opts;
  const restored = [];
  const skipped = [];
  const errors = [];

  // 1. EventLog
  try {
    if (data.eventLog && agent?.getEventLog?.()) {
      const { EventLog } = { EventLog: agent.getEventLog().constructor };
      const parsed = EventLog.fromJSONL?.(data.eventLog);
      if (parsed) {
        agent.getEventLog().clear?.();
        agent.getEventLog().load?.(parsed.events || []);
        restored.push('eventLog');
      } else {
        skipped.push('eventLog');
      }
    } else {
      skipped.push('eventLog');
    }
  } catch (e) { errors.push(`eventLog: ${e.message}`); }

  // 2. Checkpoint (session history, goals, scheduler)
  try {
    if (data.checkpoint && agent?.restore) {
      const bytes = new TextEncoder().encode(JSON.stringify(data.checkpoint));
      agent.restore(bytes);
      restored.push('checkpoint');
    } else {
      skipped.push('checkpoint');
    }
  } catch (e) { errors.push(`checkpoint: ${e.message}`); }

  // 3. Memories
  try {
    if (data.memories?.length > 0 && agent?.memory) {
      agent.memory.clear?.();
      agent.memory.importFromFlatArray?.(data.memories);
      restored.push('memories');
    } else {
      skipped.push('memories');
    }
  } catch (e) { errors.push(`memories: ${e.message}`); }

  // 4. Config
  try {
    if (data.config && agent) {
      if (data.config.model) agent.setModel?.(data.config.model);
      if (data.config.systemPrompt) agent.setSystemPrompt?.(data.config.systemPrompt);
      restored.push('config');
    } else {
      skipped.push('config');
    }
  } catch (e) { errors.push(`config: ${e.message}`); }

  // 5. Routines
  try {
    if (data.routines && routineEngine?.fromJSON) {
      routineEngine.fromJSON(data.routines);
      restored.push('routines');
    } else {
      skipped.push('routines');
    }
  } catch (e) { errors.push(`routines: ${e.message}`); }

  // 6. Shell state
  try {
    if (data.shell && shell?.state) {
      const s = shell.state;
      if (data.shell.cwd) s.cwd = data.shell.cwd;
      if (data.shell.env) {
        s.env.clear();
        for (const [k, v] of Object.entries(data.shell.env)) s.env.set(k, v);
      }
      if (data.shell.aliases) {
        s.aliases.clear();
        for (const [k, v] of Object.entries(data.shell.aliases)) s.aliases.set(k, v);
      }
      if (Array.isArray(data.shell.history)) s.history = data.shell.history;
      if (typeof data.shell.lastExitCode === 'number') s.lastExitCode = data.shell.lastExitCode;
      restored.push('shell');
    } else {
      skipped.push('shell');
    }
  } catch (e) { errors.push(`shell: ${e.message}`); }

  // 7. Skill activations
  try {
    if (data.skillActivations?.length > 0 && skillRegistry) {
      for (const name of data.skillActivations) {
        skillRegistry.activate?.(name);
      }
      restored.push('skillActivations');
    } else {
      skipped.push('skillActivations');
    }
  } catch (e) { errors.push(`skillActivations: ${e.message}`); }

  // 8. Hooks — skip if no factories available (restore requires factory map)
  // Hooks are serialized for record-keeping but can only be restored
  // when factory functions are available. Caller should handle this.
  if (data.hooks) {
    skipped.push('hooks (requires factories)');
  }

  // 9. localStorage settings
  try {
    if (data.localStorage && typeof localStorage !== 'undefined') {
      const id = data.wsId || 'default';
      for (const [key, val] of Object.entries(data.localStorage)) {
        const snakeKey = key.replace(/[A-Z]/g, c => '_' + c.toLowerCase());
        localStorage.setItem(`clawser_v1_${snakeKey}_${id}`, val);
      }
      restored.push('localStorage');
    }
  } catch (e) { errors.push(`localStorage: ${e.message}`); }

  return { restored, skipped, errors };
};

// ── SnapshotManager ────────────────────────────────────────────

/**
 * Manages atomic workspace snapshots in IndexedDB.
 *
 * @example
 *   const mgr = new SnapshotManager();
 *   const meta = await mgr.createAtomicSnapshot({
 *     agent: state.agent,
 *     routineEngine: state.routineEngine,
 *     shell: state.shell,
 *     skillRegistry: state.skillRegistry,
 *     name: 'before-refactor',
 *   });
 *   console.log(meta); // { id, name, timestamp, size, wsId, subsystems }
 *
 *   const result = await mgr.restoreAtomicSnapshot(meta.id, { agent, ... });
 *   console.log(result); // { restored: [...], skipped: [...], errors: [...] }
 */
export class SnapshotManager {
  /**
   * Create an atomic snapshot of all workspace state.
   *
   * @param {object} opts
   * @param {import('./clawser-agent.js').ClawserAgent} opts.agent
   * @param {import('./clawser-routines.js').RoutineEngine} [opts.routineEngine]
   * @param {import('./clawser-shell.js').ClawserShell} [opts.shell]
   * @param {import('./clawser-skills.js').SkillRegistry} [opts.skillRegistry]
   * @param {string} [opts.name] - Human-readable snapshot name
   * @param {string} [opts.wsId] - Workspace ID (defaults to agent workspace)
   * @returns {Promise<{ id: string, name: string, timestamp: number, size: number, compressedSize: number, wsId: string, subsystems: string[] }>}
   */
  async createAtomicSnapshot(opts) {
    const { name, ...stateOpts } = opts;
    const data = collectState(stateOpts);

    // Serialize to JSON bytes
    const jsonStr = JSON.stringify(data);
    const rawSize = jsonStr.length;

    // Compress with fflate
    const fflate = await import('fflate');
    const rawBytes = fflate.strToU8(jsonStr);
    const compressed = fflate.compressSync(rawBytes, { level: 6 });

    // Generate ID
    const id = `snap_${Date.now().toString(36)}_${crypto.randomUUID().slice(0, 6)}`;
    const timestamp = Date.now();

    const subsystems = [];
    if (data.eventLog) subsystems.push('eventLog');
    if (data.checkpoint) subsystems.push('checkpoint');
    if (data.memories?.length) subsystems.push('memories');
    if (data.config && Object.keys(data.config).length) subsystems.push('config');
    if (data.routines) subsystems.push('routines');
    if (data.shell) subsystems.push('shell');
    if (data.skillActivations?.length) subsystems.push('skillActivations');
    if (data.hooks) subsystems.push('hooks');
    if (data.localStorage && Object.keys(data.localStorage).length) subsystems.push('localStorage');

    const meta = {
      id,
      name: name || `snapshot-${new Date(timestamp).toISOString().slice(0, 19).replace(/[T:]/g, '-')}`,
      timestamp,
      size: rawSize,
      compressedSize: compressed.byteLength,
      wsId: data.wsId,
      subsystems,
      version: SNAPSHOT_VERSION,
    };

    // Store both blob and metadata in a single IDB transaction
    const db = await openDB();
    await new Promise((resolve, reject) => {
      const tx = db.transaction([STORE_NAME, META_STORE], 'readwrite');
      tx.objectStore(STORE_NAME).put(compressed, id);
      tx.objectStore(META_STORE).put(meta, id);
      tx.oncomplete = () => { db.close(); resolve(); };
      tx.onerror = () => { db.close(); reject(tx.error); };
      tx.onabort = () => { db.close(); reject(tx.error || new Error('Transaction aborted')); };
    });

    return meta;
  }

  /**
   * Restore workspace state from a snapshot.
   *
   * @param {string} id - Snapshot ID
   * @param {object} opts - Same subsystem references as createAtomicSnapshot
   * @param {import('./clawser-agent.js').ClawserAgent} opts.agent
   * @param {import('./clawser-routines.js').RoutineEngine} [opts.routineEngine]
   * @param {import('./clawser-shell.js').ClawserShell} [opts.shell]
   * @param {import('./clawser-skills.js').SkillRegistry} [opts.skillRegistry]
   * @returns {Promise<{ meta: object, restored: string[], skipped: string[], errors: string[] }|null>}
   */
  async restoreAtomicSnapshot(id, opts) {
    // Read blob and meta
    const db = await openDB();
    const { blob, meta } = await new Promise((resolve, reject) => {
      const tx = db.transaction([STORE_NAME, META_STORE], 'readonly');
      const blobReq = tx.objectStore(STORE_NAME).get(id);
      const metaReq = tx.objectStore(META_STORE).get(id);
      tx.oncomplete = () => {
        db.close();
        resolve({ blob: blobReq.result, meta: metaReq.result });
      };
      tx.onerror = () => { db.close(); reject(tx.error); };
      tx.onabort = () => { db.close(); reject(tx.error || new Error('Transaction aborted')); };
    });

    if (!blob || !meta) return null;

    // Decompress
    const fflate = await import('fflate');
    const decompressed = fflate.decompressSync(new Uint8Array(blob));
    const jsonStr = fflate.strFromU8(decompressed);
    const data = JSON.parse(jsonStr);

    // Apply state
    const result = applyState(data, opts);
    return { meta, ...result };
  }

  /**
   * List all available snapshots with metadata.
   *
   * @param {object} [opts]
   * @param {string} [opts.wsId] - Filter by workspace ID
   * @returns {Promise<Array<{ id: string, name: string, timestamp: number, size: number, compressedSize: number, wsId: string, subsystems: string[] }>>}
   */
  async listSnapshots(opts = {}) {
    const db = await openDB();
    const metas = await new Promise((resolve, reject) => {
      const tx = db.transaction(META_STORE, 'readonly');
      const req = tx.objectStore(META_STORE).getAll();
      req.onsuccess = () => { db.close(); resolve(req.result || []); };
      req.onerror = () => { db.close(); reject(req.error); };
    });

    let result = metas;
    if (opts.wsId) {
      result = result.filter(m => m.wsId === opts.wsId);
    }

    // Sort newest first
    result.sort((a, b) => b.timestamp - a.timestamp);
    return result;
  }

  /**
   * Delete a snapshot by ID.
   *
   * @param {string} id
   * @returns {Promise<boolean>} true if found and deleted
   */
  async deleteSnapshot(id) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction([STORE_NAME, META_STORE], 'readwrite');
      let found = false;
      const metaReq = tx.objectStore(META_STORE).get(id);
      metaReq.onsuccess = () => {
        if (!metaReq.result) {
          found = false;
          return; // let the transaction complete naturally
        }
        found = true;
        tx.objectStore(STORE_NAME).delete(id);
        tx.objectStore(META_STORE).delete(id);
      };
      tx.oncomplete = () => { db.close(); resolve(found); };
      tx.onerror = () => { db.close(); reject(tx.error); };
      tx.onabort = () => { db.close(); reject(tx.error || new Error('Transaction aborted')); };
    });
  }

  /**
   * Get a specific snapshot's metadata without loading the blob.
   *
   * @param {string} id
   * @returns {Promise<object|null>}
   */
  async getSnapshotMeta(id) {
    return withTx(META_STORE, 'readonly', (getStore) => getStore(META_STORE).get(id));
  }

  /**
   * Delete all snapshots.
   * @returns {Promise<void>}
   */
  async clearAll() {
    const db = await openDB();
    await new Promise((resolve, reject) => {
      const tx = db.transaction([STORE_NAME, META_STORE], 'readwrite');
      tx.objectStore(STORE_NAME).clear();
      tx.objectStore(META_STORE).clear();
      tx.oncomplete = () => { db.close(); resolve(); };
      tx.onerror = () => { db.close(); reject(tx.error); };
    });
  }
}

// ── Convenience exports for direct use ─────────────────────────

/** Singleton instance for app-wide use. */
export const snapshotManager = new SnapshotManager();

// Re-export helpers for testing
export { collectState, applyState, SNAPSHOT_VERSION, DB_NAME, STORE_NAME, META_STORE };
