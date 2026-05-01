/**
 * clawser-fs-guest-mount.mjs — Phase 9: v86 Guest Mount Points
 *
 * Enables mounting a v86 guest filesystem into the clawser virtual filesystem
 * so that shell commands on /mnt/guest/ paths delegate to the guest OS
 * via serial commands (ls, cat, stat).
 *
 * Uses GuestFsController from clawser-ui-guest-fs.mjs for actual I/O.
 * Uses MountableFs.mountAdapter() to hook into the VirtualFs layer.
 *
 * @module clawser-fs-guest-mount
 *
 * @example
 *   import { mountGuest, umountGuest } from './clawser-fs-guest-mount.mjs';
 *   const handle = await mountGuest('/mnt/guest', guest, mountableFs);
 *   // Now: cat /mnt/guest/etc/hostname → reads from the guest
 *   umountGuest('/mnt/guest', mountableFs);
 */

import {
  parseLsOutput,
  parseStatOutput,
  extractCommandOutput,
  stripAnsi,
} from './clawser-ui-guest-fs.mjs';

// ── Guest Filesystem Adapter ──────────────────────────────────────

/**
 * Create a filesystem adapter for a v86 LinuxGuest that can be passed
 * to MountableFs.mountAdapter().
 *
 * The adapter translates filesystem operations into serial console commands
 * executed on the guest.
 *
 * @param {import('./clawser-v86-guest.mjs').LinuxGuest} guest
 * @returns {object} Adapter with readFile, writeFile, listDir, stat, metadata
 *
 * @example
 *   const adapter = createGuestFsAdapter(guest);
 *   const content = await adapter.readFile('/etc/hostname');
 */
export const createGuestFsAdapter = (guest) => {
  /** Execute a command on the guest and extract output. */
  const exec = async (cmd) => {
    const raw = await guest.sendCommand(cmd);
    return extractCommandOutput(raw, cmd);
  };

  /** Escape a path for safe use in shell commands. */
  const shellEscape = (s) => "'" + s.replace(/'/g, "'\\''") + "'";

  const adapter = {
    readOnly: false,
    metadata: { source: 'v86-guest', type: 'linux' },

    /**
     * Read a file from the guest filesystem.
     * @param {string} path - Path relative to the mount point
     * @returns {Promise<string>}
     */
    async readFile(path) {
      const guestPath = normalizePath(path);
      const output = await exec(`cat ${shellEscape(guestPath)}`);
      return output;
    },

    /**
     * Write a file to the guest filesystem.
     * Encodes content via base64 to avoid serial-line issues.
     * @param {string} path - Path relative to the mount point
     * @param {string} content - File content to write
     * @returns {Promise<void>}
     */
    async writeFile(path, content) {
      const guestPath = normalizePath(path);
      // Use printf + base64 for reliable transfer over serial
      const b64 = typeof btoa === 'function'
        ? btoa(unescape(encodeURIComponent(content)))
        : Buffer.from(content, 'utf-8').toString('base64');
      await exec(`echo '${b64}' | base64 -d > ${shellEscape(guestPath)}`);
    },

    /**
     * List directory entries on the guest.
     * @param {string} path - Path relative to the mount point
     * @returns {Promise<Array<{name: string, kind: 'file'|'directory'}>>}
     */
    async listDir(path) {
      const guestPath = normalizePath(path || '/');
      const output = await exec(`ls -la ${shellEscape(guestPath)}`);
      const entries = parseLsOutput(output);
      return entries.map(e => ({
        name: e.name,
        kind: e.type === 'directory' ? 'directory' : 'file',
      }));
    },

    /**
     * Stat a file or directory on the guest.
     * @param {string} path
     * @returns {Promise<{kind: 'file'|'directory', size: number, lastModified: number}|null>}
     */
    async stat(path) {
      const guestPath = normalizePath(path);
      try {
        const output = await exec(`stat ${shellEscape(guestPath)}`);
        const parsed = parseStatOutput(output);
        if (!parsed) return null;
        const isDir = parsed.type?.toLowerCase().includes('directory');
        return {
          kind: isDir ? 'directory' : 'file',
          size: parsed.size || 0,
          lastModified: parsed.modify ? new Date(parsed.modify).getTime() : Date.now(),
        };
      } catch {
        return null;
      }
    },

    /**
     * Create a directory on the guest.
     * @param {string} path
     * @returns {Promise<void>}
     */
    async mkdir(path) {
      const guestPath = normalizePath(path);
      await exec(`mkdir -p ${shellEscape(guestPath)}`);
    },

    /**
     * Delete a file or directory on the guest.
     * @param {string} path
     * @param {boolean} [recursive=false]
     * @returns {Promise<void>}
     */
    async delete(path, recursive = false) {
      const guestPath = normalizePath(path);
      const flag = recursive ? '-rf' : '-f';
      await exec(`rm ${flag} ${shellEscape(guestPath)}`);
    },
  };

  return adapter;
};

// ── Mount / Umount API ────────────────────────────────────────────

/** @type {Map<string, {guest: object, adapter: object}>} mountPoint → info */
const activeMounts = new Map();

/**
 * Mount a v86 guest's filesystem at a path in the clawser virtual filesystem.
 *
 * @param {string} mountPoint - Where to mount (e.g. '/mnt/guest')
 * @param {import('./clawser-v86-guest.mjs').LinuxGuest} guest - Running guest instance
 * @param {import('./clawser-mount.js').MountableFs} mountableFs - The mountable filesystem
 * @param {object} [opts]
 * @param {boolean} [opts.readOnly=false]
 * @returns {{ mountPoint: string, adapter: object }}
 * @throws {Error} If guest is not running or mount point is invalid
 *
 * @example
 *   const handle = mountGuest('/mnt/guest', guest, mountableFs);
 *   // Now shell commands on /mnt/guest/ go through the guest
 */
export const mountGuest = (mountPoint, guest, mountableFs, opts = {}) => {
  if (!guest) {
    throw new Error('mountGuest: guest instance is required');
  }
  if (!mountableFs) {
    throw new Error('mountGuest: mountableFs is required');
  }

  const normalized = mountPoint.replace(/\/+$/, '');
  if (!normalized.startsWith('/mnt/')) {
    throw new Error(`mountGuest: mount point must be under /mnt/, got: ${mountPoint}`);
  }

  if (activeMounts.has(normalized)) {
    throw new Error(`mountGuest: ${normalized} is already mounted`);
  }

  const adapter = createGuestFsAdapter(guest);
  if (opts.readOnly) adapter.readOnly = true;

  mountableFs.mountAdapter(normalized, adapter, {
    readOnly: opts.readOnly || false,
    metadata: { source: 'v86-guest', type: 'linux', guestState: guest.state },
  });

  activeMounts.set(normalized, { guest, adapter });

  return { mountPoint: normalized, adapter };
};

/**
 * Unmount a previously mounted guest filesystem.
 *
 * @param {string} mountPoint - The mount point to remove
 * @param {import('./clawser-mount.js').MountableFs} mountableFs
 * @returns {boolean} True if the mount was found and removed
 *
 * @example
 *   umountGuest('/mnt/guest', mountableFs);
 */
export const umountGuest = (mountPoint, mountableFs) => {
  const normalized = mountPoint.replace(/\/+$/, '');
  const info = activeMounts.get(normalized);
  if (!info) return false;

  mountableFs.unmount(normalized);
  activeMounts.delete(normalized);
  return true;
};

/**
 * List all active guest mounts.
 * @returns {Array<{mountPoint: string, guestState: string}>}
 *
 * @example
 *   const mounts = listGuestMounts();
 *   // → [{ mountPoint: '/mnt/guest', guestState: 'running' }]
 */
export const listGuestMounts = () => {
  const result = [];
  for (const [mp, info] of activeMounts) {
    result.push({
      mountPoint: mp,
      guestState: info.guest?.state || 'unknown',
    });
  }
  return result;
};

/**
 * Check if a mount point is a guest mount.
 * @param {string} mountPoint
 * @returns {boolean}
 */
export const isGuestMount = (mountPoint) => {
  return activeMounts.has(mountPoint.replace(/\/+$/, ''));
};

// ── Helpers ──────────────────────────────────────────────────────

/**
 * Normalize a path for guest filesystem use.
 * Ensures leading slash, removes trailing slash, collapses doubles.
 * @param {string} path
 * @returns {string}
 */
const normalizePath = (path) => {
  let p = path.replace(/\/+/g, '/').replace(/\/+$/, '');
  if (!p.startsWith('/')) p = '/' + p;
  return p || '/';
};
