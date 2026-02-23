// clawser-mount.js — Local Filesystem Mounting (File System Access API)
//
// MountableFs: extends WorkspaceFs with virtual mount table
// - OPFS at root, local directories under /mnt/
// - Transparent routing: resolve() checks mounts before falling back to OPFS
// - Handle persistence via IndexedDB for cross-session re-mount
// - Mount list tool for agent visibility

import { WorkspaceFs, BrowserTool } from './clawser-tools.js';

// ── MountableFs ─────────────────────────────────────────────────

/**
 * Filesystem abstraction with virtual mount table.
 * Routes paths through mounts before falling back to OPFS.
 *
 * Mount table example:
 *   /mnt/myapp   → FileSystemDirectoryHandle (local ~/Projects/myapp)
 *   /mnt/data    → FileSystemDirectoryHandle (local ~/Documents/datasets)
 *   /mnt/file.csv → FileSystemFileHandle (single file)
 */
export class MountableFs extends WorkspaceFs {
  /**
   * @type {Map<string, { handle: FileSystemDirectoryHandle|FileSystemFileHandle, readOnly: boolean, kind: 'directory'|'file' }>}
   */
  #mounts = new Map();

  /**
   * Mount a local directory or file at a path.
   * @param {string} mountPoint - e.g. '/mnt/myapp'
   * @param {FileSystemDirectoryHandle|FileSystemFileHandle} handle
   * @param {object} [opts]
   * @param {boolean} [opts.readOnly=false]
   */
  mount(mountPoint, handle, opts = {}) {
    const normalized = this.#normalizeMountPath(mountPoint);
    if (!normalized.startsWith('/mnt/')) {
      throw new Error('Mount points must be under /mnt/');
    }
    this.#mounts.set(normalized, {
      handle,
      readOnly: opts.readOnly || false,
      kind: handle.kind || 'directory',
    });
  }

  /**
   * Unmount a path.
   * @param {string} mountPoint
   * @returns {boolean} True if mount existed
   */
  unmount(mountPoint) {
    return this.#mounts.delete(this.#normalizeMountPath(mountPoint));
  }

  /**
   * Check if a mount point exists.
   * @param {string} mountPoint
   * @returns {boolean}
   */
  isMounted(mountPoint) {
    return this.#mounts.has(this.#normalizeMountPath(mountPoint));
  }

  /**
   * Resolve a user path to the correct handle + relative path.
   * Checks mounts first (longest prefix match), falls back to OPFS path.
   *
   * @param {string} userPath
   * @returns {{ type: 'mount'|'opfs', mountPoint?: string, handle?: object, relative: string, readOnly?: boolean, opfsPath?: string }}
   */
  resolveMount(userPath) {
    const abs = this.#toAbsolute(userPath);

    // Find longest matching mount point
    let bestMount = null;
    let bestLen = 0;

    for (const [mp, entry] of this.#mounts) {
      if ((abs === mp || abs.startsWith(mp + '/')) && mp.length > bestLen) {
        bestMount = mp;
        bestLen = mp.length;
      }
    }

    if (bestMount) {
      const entry = this.#mounts.get(bestMount);
      const relative = abs === bestMount ? '' : abs.slice(bestMount.length + 1);
      return {
        type: 'mount',
        mountPoint: bestMount,
        handle: entry.handle,
        relative,
        readOnly: entry.readOnly,
        kind: entry.kind,
      };
    }

    // Fall back to OPFS
    return {
      type: 'opfs',
      relative: abs.startsWith('/') ? abs.slice(1) : abs,
      opfsPath: super.resolve(abs),
    };
  }

  /**
   * Get the mount table for display/system prompt.
   * @returns {Array<{path: string, name: string, kind: string, readOnly: boolean}>}
   */
  get mountTable() {
    return [...this.#mounts.entries()].map(([path, entry]) => ({
      path,
      name: entry.handle.name || path.split('/').pop(),
      kind: entry.kind,
      readOnly: entry.readOnly,
    }));
  }

  /** Number of active mounts */
  get mountCount() {
    return this.#mounts.size;
  }

  /**
   * Clear all mounts.
   */
  unmountAll() {
    this.#mounts.clear();
  }

  /**
   * Serialize mount metadata (handle names, not the handles themselves).
   * Handles must be persisted separately in IndexedDB.
   * @returns {Array<{path: string, name: string, kind: string, readOnly: boolean}>}
   */
  exportMounts() {
    return this.mountTable;
  }

  // ── Path helpers ──────────────────────────────────────────────

  #normalizeMountPath(p) {
    // Ensure leading slash, remove trailing slash, collapse double slashes
    let s = '/' + p.replace(/^\/+/, '').replace(/\/+$/, '');
    return s.replace(/\/+/g, '/');
  }

  #toAbsolute(userPath) {
    if (!userPath || userPath === '/') return '/';
    return this.#normalizeMountPath(userPath);
  }
}

// ── Handle Persistence (IndexedDB) ─────────────────────────────

const DB_NAME = 'clawser-mounts';
const STORE_NAME = 'handles';
const DB_VERSION = 1;

/**
 * Open the mounts IndexedDB database.
 * @returns {Promise<IDBDatabase>}
 */
function openMountDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      req.result.createObjectStore(STORE_NAME);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

/**
 * Persist a FileSystemHandle in IndexedDB for cross-session re-mount.
 * @param {string} mountPoint
 * @param {FileSystemDirectoryHandle|FileSystemFileHandle} handle
 * @param {object} [meta] - Additional metadata (readOnly, etc.)
 */
export async function persistHandle(mountPoint, handle, meta = {}) {
  const db = await openMountDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).put({ handle, ...meta }, mountPoint);
    tx.oncomplete = () => { db.close(); resolve(); };
    tx.onerror = () => { db.close(); reject(tx.error); };
  });
}

/**
 * Retrieve a persisted handle and verify permission.
 * @param {string} mountPoint
 * @param {string} [mode='readwrite']
 * @returns {Promise<{handle: FileSystemHandle, meta: object}|null>}
 */
export async function restoreHandle(mountPoint, mode = 'readwrite') {
  const db = await openMountDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const req = tx.objectStore(STORE_NAME).get(mountPoint);
    req.onsuccess = async () => {
      db.close();
      const record = req.result;
      if (!record || !record.handle) { resolve(null); return; }
      try {
        const perm = await record.handle.requestPermission({ mode });
        if (perm === 'granted') {
          resolve({ handle: record.handle, meta: record });
        } else {
          resolve(null); // Permission denied
        }
      } catch {
        resolve(null); // Handle invalid or permission error
      }
    };
    req.onerror = () => { db.close(); reject(req.error); };
  });
}

/**
 * Remove a persisted handle.
 * @param {string} mountPoint
 */
export async function removePersistedHandle(mountPoint) {
  const db = await openMountDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).delete(mountPoint);
    tx.oncomplete = () => { db.close(); resolve(); };
    tx.onerror = () => { db.close(); reject(tx.error); };
  });
}

/**
 * List all persisted mount points.
 * @returns {Promise<string[]>}
 */
export async function listPersistedMounts() {
  const db = await openMountDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const req = tx.objectStore(STORE_NAME).getAllKeys();
    req.onsuccess = () => { db.close(); resolve(req.result); };
    req.onerror = () => { db.close(); reject(req.error); };
  });
}

// ── Directory Picker Wrapper ────────────────────────────────────

/**
 * Check if the File System Access API is available.
 * @returns {boolean}
 */
export function isFileSystemAccessSupported() {
  return typeof globalThis.showDirectoryPicker === 'function';
}

/**
 * Show directory picker and return handle.
 * @param {object} [opts]
 * @param {string} [opts.mode='readwrite']
 * @returns {Promise<FileSystemDirectoryHandle>}
 */
export async function pickDirectory(opts = {}) {
  if (!isFileSystemAccessSupported()) {
    throw new Error('File System Access API not supported in this browser');
  }
  return globalThis.showDirectoryPicker({
    mode: opts.mode || 'readwrite',
  });
}

/**
 * Show file picker and return handle.
 * @param {object} [opts]
 * @returns {Promise<FileSystemFileHandle>}
 */
export async function pickFile(opts = {}) {
  if (typeof globalThis.showOpenFilePicker !== 'function') {
    throw new Error('File picker not supported in this browser');
  }
  const [handle] = await globalThis.showOpenFilePicker(opts);
  return handle;
}

// ── Agent Tools ─────────────────────────────────────────────────

/**
 * Agent tool: list current mounts.
 */
export class MountListTool extends BrowserTool {
  #fs;

  constructor(fs) {
    super();
    this.#fs = fs;
  }

  get name() { return 'mount_list'; }
  get description() { return 'List all mounted local directories and their status.'; }
  get parameters() { return { type: 'object', properties: {} }; }
  get permission() { return 'read'; }

  async execute() {
    const table = this.#fs.mountTable;
    if (table.length === 0) {
      return { success: true, output: 'No local directories mounted. The user can mount a folder using the Mount button.' };
    }
    const lines = table.map(m =>
      `${m.path}  → ${m.name} (${m.kind}, ${m.readOnly ? 'readonly' : 'readwrite'})`
    );
    return { success: true, output: 'Mounted directories:\n' + lines.join('\n') };
  }
}

/**
 * Agent tool: resolve a path to determine if it's mounted or OPFS.
 */
export class MountResolveTool extends BrowserTool {
  #fs;

  constructor(fs) {
    super();
    this.#fs = fs;
  }

  get name() { return 'mount_resolve'; }
  get description() { return 'Check whether a path resolves to a local mount or OPFS.'; }
  get parameters() {
    return {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Path to check' },
      },
      required: ['path'],
    };
  }
  get permission() { return 'read'; }

  async execute({ path }) {
    const resolved = this.#fs.resolveMount(path);
    if (resolved.type === 'mount') {
      return {
        success: true,
        output: `${path} → local mount at ${resolved.mountPoint} (${resolved.readOnly ? 'readonly' : 'readwrite'}), relative: "${resolved.relative}"`,
      };
    }
    return {
      success: true,
      output: `${path} → OPFS (workspace storage), opfs path: "${resolved.opfsPath}"`,
    };
  }
}
