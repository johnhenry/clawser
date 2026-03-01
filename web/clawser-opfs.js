/**
 * clawser-opfs.js — Shared OPFS path-walking utilities
 *
 * Extracts the common "split path, walk directory handles" pattern
 * used by tools, shell, server, and app modules into a single place.
 *
 * @module clawser-opfs
 */

/**
 * Walk an OPFS path and return the parent directory handle + filename.
 * Useful for file operations (read, write, delete).
 *
 * @param {string} path - Slash-delimited OPFS path (e.g. "clawser_workspaces/default/file.txt")
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
 * @param {string} path - Slash-delimited OPFS path (e.g. "clawser_workspaces/default/docs")
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
