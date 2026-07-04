/**
 * clawser-opfs.js — Shared OPFS path-walking utilities + virtual path resolution
 *
 * Extracts the common "split path, walk directory handles" pattern
 * used by tools, shell, server, and app modules into a single place.
 *
 * Phase 0 adds:
 *  - CLAWSER_ROOT namespace constant
 *  - resolveVirtualPath() — maps Unix-conventional virtual paths to OPFS paths
 *  - withLock() — Web Locks wrapper for safe concurrent OPFS writes
 *
 * @module clawser-opfs
 */

// ── OPFS namespace ─────────────────────────────────────────────────

/**
 * Top-level OPFS directory that namespaces all clawser data.
 * All resolved OPFS paths start with this prefix.
 *
 * @example
 * // Global config lives at:
 * `${CLAWSER_ROOT}/etc/clawser/motd`  // → "clawser/etc/clawser/motd"
 *
 * // Workspace files live at:
 * `${CLAWSER_ROOT}/workspaces/default/file.txt`
 */
export const CLAWSER_ROOT = 'clawser';

/**
 * Map a Unix-conventional virtual path to a concrete OPFS path.
 *
 * Global system paths (`/etc/`, `/var/`, `/run/`, `/dev/`, `/proc/`, `/sys/`, `/tmp/`)
 * are prefixed with CLAWSER_ROOT directly. Tilde (`~/`) expands to the workspace
 * home directory. All other paths are treated as workspace-relative.
 *
 * @param {string} virtualPath - Unix-style path (e.g. "/etc/clawser/motd", "~/file.txt", "docs/readme.md")
 * @param {string} wsId - Active workspace ID
 * @returns {string} OPFS-relative path (no leading slash)
 *
 * @example
 * resolveVirtualPath('/etc/clawser/motd', 'default')
 * // → "clawser/etc/clawser/motd"
 *
 * @example
 * resolveVirtualPath('~/notes.md', 'ws_abc')
 * // → "clawser/workspaces/ws_abc/notes.md"
 *
 * @example
 * resolveVirtualPath('docs/readme.md', 'default')
 * // → "clawser/workspaces/default/docs/readme.md"
 */
export const resolveVirtualPath = (virtualPath, wsId, opts = {}) => {
  if (virtualPath.startsWith('/etc/'))  return `${CLAWSER_ROOT}${virtualPath}`;
  if (virtualPath.startsWith('/var/'))  return `${CLAWSER_ROOT}${virtualPath}`;
  if (virtualPath.startsWith('/run/'))  return `${CLAWSER_ROOT}${virtualPath}`;
  if (virtualPath.startsWith('/dev/'))  return `${CLAWSER_ROOT}${virtualPath}`;
  if (virtualPath.startsWith('/proc/')) return `${CLAWSER_ROOT}${virtualPath}`;
  if (virtualPath.startsWith('/sys/'))  return `${CLAWSER_ROOT}${virtualPath}`;
  if (virtualPath.startsWith('/tmp/'))  return `${CLAWSER_ROOT}${virtualPath}`;
  if (virtualPath.startsWith('~/'))     return `${CLAWSER_ROOT}/workspaces/${wsId}/${virtualPath.slice(2)}`;
  // /home/<active-name>/... is the user-facing alias for ~/.
  // Cross-workspace access is intentionally not supported: any
  // /home/<other-name>/... resolves to a unique non-existent OPFS
  // path so realFs operations naturally ENOENT, keeping workspaces
  // fully isolated. The active sanitized name is supplied via
  // opts.activeHomeName by the shell layer; when omitted, /home/...
  // paths fall through to the workspace-relative branch (matches
  // the legacy behavior).
  if (virtualPath === '/home' || virtualPath === '/home/') {
    return `${CLAWSER_ROOT}/_isolated_/__virtual_home_root__`;
  }
  if (virtualPath.startsWith('/home/')) {
    const rest = virtualPath.slice('/home/'.length);
    const slashIdx = rest.indexOf('/');
    const name = slashIdx === -1 ? rest : rest.slice(0, slashIdx);
    const tail = slashIdx === -1 ? '' : rest.slice(slashIdx + 1);
    if (opts.activeHomeName && name === opts.activeHomeName) {
      return tail
        ? `${CLAWSER_ROOT}/workspaces/${wsId}/${tail}`
        : `${CLAWSER_ROOT}/workspaces/${wsId}`;
    }
    // Cross-workspace path → route to a never-created subtree so reads
    // ENOENT and writes can be guarded by ShellFs.
    return `${CLAWSER_ROOT}/_isolated_/${name}/${tail}`;
  }
  // Workspace-relative paths (strip leading / if present)
  return `${CLAWSER_ROOT}/workspaces/${wsId}/${virtualPath.replace(/^\//, '')}`;
};

// ── Path walking ───────────────────────────────────────────────────

/**
 * Walk an OPFS path and return the parent directory handle + filename.
 * Useful for file operations (read, write, delete).
 *
 * @param {string} path - Slash-delimited OPFS path (e.g. "clawser/workspaces/default/file.txt")
 * @param {object} [opts]
 * @param {boolean} [opts.create=false] - Create intermediate directories if missing
 * @returns {Promise<{dir: FileSystemDirectoryHandle, name: string}>}
 */
export async function opfsWalk(path, opts = {}) {
  const parts = path.split('/').filter(Boolean);
  const root = await navigator.storage.getDirectory();
  let dir = root;
  for (const part of parts.slice(0, -1)) {
    dir = await dir.getDirectoryHandle(part, { create: !!opts.create });
  }
  return { dir, name: parts[parts.length - 1] };
}

/**
 * Walk an OPFS path and return the directory handle at the end.
 * Useful for listing or traversing directories.
 *
 * @param {string} path - Slash-delimited OPFS path (e.g. "clawser/workspaces/default/docs")
 * @param {object} [opts]
 * @param {boolean} [opts.create=false] - Create intermediate directories if missing
 * @returns {Promise<FileSystemDirectoryHandle>}
 */
export async function opfsWalkDir(path, opts = {}) {
  const parts = path.split('/').filter(Boolean);
  const root = await navigator.storage.getDirectory();
  let dir = root;
  for (const part of parts) {
    dir = await dir.getDirectoryHandle(part, { create: !!opts.create });
  }
  return dir;
}

// ── Web Locks wrapper ──────────────────────────────────────────────

/**
 * Acquire a Web Lock before running an async callback.
 * Prevents multi-tab race conditions on OPFS config writes.
 *
 * Falls back to executing `fn` directly if the Web Locks API is unavailable
 * (e.g. in Node test environments or older browsers).
 *
 * @param {string} lockName - Lock resource name (e.g. "clawser:config:autonomy.json")
 * @param {() => Promise<T>} fn - Async function to run while holding the lock
 * @returns {Promise<T>} Result of `fn`
 *
 * @example
 * await withLock('clawser:config:autonomy.json', async () => {
 *   const { dir, name } = await opfsWalk(path, { create: true });
 *   const fh = await dir.getFileHandle(name, { create: true });
 *   const w = await fh.createWritable();
 *   await w.write(JSON.stringify(config));
 *   await w.close();
 * });
 */
export const withLock = async (lockName, fn) => {
  if (typeof navigator !== 'undefined' && navigator.locks) {
    return navigator.locks.request(lockName, fn);
  }
  // No Web Locks available — execute without locking
  return fn();
};

// ── Workspace directory helpers ───────────────────────────────────

/**
 * Get the workspace directory handle for a given workspace ID.
 * Navigates: OPFS root → clawser → workspaces → {wsId}
 *
 * @param {string} wsId - Workspace ID
 * @param {object} [opts]
 * @param {boolean} [opts.create=false] - Create intermediate directories if missing
 * @returns {Promise<FileSystemDirectoryHandle>}
 *
 * @example
 * const wsDir = await getWorkspaceDir('default', { create: true });
 * const file = await wsDir.getFileHandle('readme.md');
 */
export const getWorkspaceDir = async (wsId, { create = false } = {}) => {
  const root = await navigator.storage.getDirectory();
  const clawser = await root.getDirectoryHandle('clawser', { create });
  const workspaces = await clawser.getDirectoryHandle('workspaces', { create });
  return workspaces.getDirectoryHandle(wsId, { create });
};

/**
 * Get the workspaces root directory (clawser/workspaces/).
 *
 * @param {object} [opts]
 * @param {boolean} [opts.create=false] - Create intermediate directories if missing
 * @returns {Promise<FileSystemDirectoryHandle>}
 *
 * @example
 * const wsRoot = await getWorkspacesRoot({ create: true });
 * for await (const [name] of wsRoot) { console.log(name); }
 */
export const getWorkspacesRoot = async ({ create = false } = {}) => {
  const root = await navigator.storage.getDirectory();
  const clawser = await root.getDirectoryHandle('clawser', { create });
  return clawser.getDirectoryHandle('workspaces', { create });
};
