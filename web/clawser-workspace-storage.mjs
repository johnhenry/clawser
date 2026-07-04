/**
 * clawser-workspace-storage.mjs — per-workspace OPFS storage adapter
 * for SyncFlags + Deploy* services.
 *
 * Implements the `{read(name), write(name, bytes)}` contract those
 * classes expect, persisting under
 * `~/.config/clawser/<service-dir>/<name>.json` for the active
 * workspace. Each service gets its own subdirectory so file names
 * don't collide.
 *
 *   sync flags  → ~/.config/clawser/sync/<name>.json
 *   deploy ACL  → ~/.config/clawser/deploy/<name>.json
 *   deploy logs → ~/.config/clawser/deploy/<name>.json (same dir)
 *
 * In-memory fallback is used when running under Node tests where
 * OPFS isn't available.
 */

import { resolveVirtualPath, opfsWalk } from './clawser-opfs.js';

/**
 * Build a per-workspace storage adapter rooted at a virtual config
 * subdirectory.
 *
 * @param {string} wsId - active workspace id
 * @param {string} subdir - service subdir under `~/.config/clawser/`
 *                          (e.g. 'sync', 'deploy')
 * @returns {{read:(name:string)=>Promise<Uint8Array|null>, write:(name:string, bytes:Uint8Array)=>Promise<void>}}
 */
export function createWorkspaceConfigStorage(wsId, subdir) {
  if (typeof wsId !== 'string' || !wsId) throw new Error('wsId required');
  if (typeof subdir !== 'string' || !subdir) throw new Error('subdir required');

  const virtualBase = `~/.config/clawser/${subdir}`;

  // In-memory fallback for environments where OPFS isn't usable
  // (Node tests, privacy modes, certain Safari builds). The fallback
  // is per-adapter — different `(wsId, subdir)` pairs get
  // independent maps, preserving per-workspace isolation.
  const memMap = new Map();
  // Once we hit a failed OPFS write/read on this adapter, stay on
  // memory for subsequent ops in the same session — the most common
  // OPFS-unavailable cause is structural (no real handle), not transient.
  let opfsFailed = false;

  return {
    async read(name) {
      const virtualPath = `${virtualBase}/${name}.json`;
      if (opfsFailed) {
        return memMap.has(virtualPath) ? new Uint8Array(memMap.get(virtualPath)) : null;
      }
      try {
        const opfsPath = resolveVirtualPath(virtualPath, wsId);
        const { dir, name: filename } = await opfsWalk(opfsPath);
        const fh = await dir.getFileHandle(filename);
        const file = await fh.getFile();
        return new Uint8Array(await file.arrayBuffer());
      } catch (e) {
        // ENOENT for the specific file is normal (returns null below);
        // a structural failure (no `getDirectoryHandle` on the root)
        // means OPFS isn't usable — fall back to memory for the rest
        // of this adapter's lifetime.
        if (e?.message && /(getDirectoryHandle is not|navigator\.storage)/.test(e.message)) {
          opfsFailed = true;
          return memMap.has(virtualPath) ? new Uint8Array(memMap.get(virtualPath)) : null;
        }
        return null;
      }
    },
    async write(name, bytes) {
      const virtualPath = `${virtualBase}/${name}.json`;
      if (opfsFailed) {
        memMap.set(virtualPath, new Uint8Array(bytes));
        return;
      }
      try {
        const opfsPath = resolveVirtualPath(virtualPath, wsId);
        const { dir, name: filename } = await opfsWalk(opfsPath, { create: true });
        const fh = await dir.getFileHandle(filename, { create: true });
        const writable = await fh.createWritable();
        await writable.write(bytes);
        await writable.close();
      } catch (e) {
        // OPFS unavailable — switch to memory for this adapter.
        opfsFailed = true;
        memMap.set(virtualPath, new Uint8Array(bytes));
      }
    },
    /** Test helper — exposes the in-memory fallback's contents. */
    _memSnapshot() { return new Map(memMap); },
    /** Test helper — whether the adapter is in OPFS-failed (memory) mode. */
    _isOpfsFailed() { return opfsFailed; },
  };
}

/**
 * In-memory storage helper for tests that want a clean adapter.
 * @returns {{read:Function, write:Function, _store:Map<string, Uint8Array>}}
 */
export function createMemoryStorage() {
  const store = new Map();
  return {
    async read(name) {
      return store.has(name) ? new Uint8Array(store.get(name)) : null;
    },
    async write(name, bytes) {
      store.set(name, new Uint8Array(bytes));
    },
    _store: store,
  };
}
