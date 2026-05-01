/**
 * clawser-fs-bootstrap.mjs — First-boot OPFS directory structure + default configs
 *
 * Phase 0 of the Unix filesystem architecture. Creates the canonical
 * directory tree under the `clawser/` OPFS namespace and writes
 * sensible default config files when they don't already exist.
 *
 * @module clawser-fs-bootstrap
 */

import { opfsWalk, opfsWalkDir, CLAWSER_ROOT, resolveVirtualPath, withLock } from './clawser-opfs.js';

// ── Directory trees ────────────────────────────────────────────────

/**
 * Global directories created once regardless of workspace.
 * Paths are relative to OPFS root.
 */
export const GLOBAL_DIRS = Object.freeze([
  `${CLAWSER_ROOT}/etc/clawser`,
  `${CLAWSER_ROOT}/etc/clawser/defaults`,
  `${CLAWSER_ROOT}/var/log/clawser`,
  `${CLAWSER_ROOT}/run/clawser`,
  `${CLAWSER_ROOT}/run/clawser/tabs`,
  `${CLAWSER_ROOT}/dev/clawser/providers`,
  `${CLAWSER_ROOT}/dev/clawser/channels`,
  `${CLAWSER_ROOT}/dev/clawser/hardware`,
  `${CLAWSER_ROOT}/dev/clawser/mesh/peers`,
  `${CLAWSER_ROOT}/proc/clawser`,
  `${CLAWSER_ROOT}/proc/kernel/tenants`,
  `${CLAWSER_ROOT}/sys/kernel`,
  `${CLAWSER_ROOT}/sys/services`,
  `${CLAWSER_ROOT}/tmp/clawser`,
]);

/**
 * Per-workspace directories, relative to the workspace root.
 * Prefixed with `clawser/workspaces/{wsId}/` at creation time.
 */
export const WORKSPACE_DIRS = Object.freeze([
  '.config/clawser',
  '.config/clawser/providers',
  '.config/clawser/agents',
  '.local/share/clawser/memory',
  '.local/share/clawser/goals',
  '.local/share/clawser/skills',
  '.local/share/clawser/vault',
  '.local/share/clawser/conversations',
  '.local/share/clawser/checkpoints',
  '.local/share/clawser/snapshots',
  '.local/share/clawser/agents',
  '.local/share/clawser/terminal',
]);

// ── Default config files ───────────────────────────────────────────

/**
 * Default config file contents keyed by virtual path.
 * Paths use `~/` prefix (workspace-relative) or `/etc/` (global).
 *
 * Values are either strings (written verbatim) or objects (JSON-stringified).
 */
export const DEFAULT_CONFIGS = Object.freeze({
  '~/.config/clawser/autonomy.json': {
    level: 'supervised',
    rateLimit: { perHour: 60 },
    costLimit: { perDay: 5.00 },
  },
  '~/.config/clawser/identity.json': {
    name: 'clawser',
    systemPrompt: '',
  },
  '~/.config/clawser/security.json': {
    inputSanitization: true,
    outputScanning: true,
    xssPrevention: true,
  },
  '~/.config/clawser/daemon.json': {
    enabled: false,
    checkpointInterval: 300_000,
  },
  '~/.config/clawser/terminal.json': {
    renderer: 'auto',
  },
  '~/.config/clawser/hooks.json': {
    hooks: [],
  },
  '/etc/clawser/motd': 'Welcome to clawser — browser agent workspace',
  '/etc/clawser/profile': '# clsh profile — runs on workspace init\n',
});

// ── Core functions ─────────────────────────────────────────────────

/**
 * Create the full directory tree — global dirs plus workspace-specific dirs.
 * Safe to call multiple times; `getDirectoryHandle({ create: true })` is idempotent.
 *
 * @param {string} wsId - Workspace ID to create directories for
 * @returns {Promise<void>}
 *
 * @example
 * await ensureDirectoryStructure('default');
 * // Creates clawser/etc/clawser/, clawser/workspaces/default/.config/clawser/, etc.
 */
export const ensureDirectoryStructure = async (wsId) => {
  // Global dirs
  for (const dir of GLOBAL_DIRS) {
    await opfsWalkDir(dir, { create: true });
  }
  // Workspace dirs
  for (const dir of WORKSPACE_DIRS) {
    await opfsWalkDir(`${CLAWSER_ROOT}/workspaces/${wsId}/${dir}`, { create: true });
  }
};

/**
 * Write a single file to OPFS if it doesn't already exist.
 * Uses Web Locks to prevent concurrent writes from racing.
 *
 * @param {string} opfsPath - Full OPFS path (e.g. "clawser/etc/clawser/motd")
 * @param {string} content - File content to write
 * @returns {Promise<boolean>} true if the file was created, false if it already existed
 *
 * @example
 * const created = await writeIfMissing('clawser/etc/clawser/motd', 'Hello');
 * // created === true on first call, false on subsequent calls
 */
export const writeIfMissing = async (opfsPath, content) => {
  const filename = opfsPath.split('/').pop();

  return withLock(`clawser:config:${filename}`, async () => {
    const { dir, name } = await opfsWalk(opfsPath, { create: true });

    // Check if file already exists
    try {
      await dir.getFileHandle(name, { create: false });
      return false; // already exists
    } catch {
      // File doesn't exist — create it
    }

    const fh = await dir.getFileHandle(name, { create: true });
    const writable = await fh.createWritable();
    await writable.write(content);
    await writable.close();
    return true;
  });
};

/**
 * Write all default config files that don't already exist.
 * Serializes objects as pretty-printed JSON; strings are written verbatim.
 *
 * @param {string} wsId - Workspace ID (used to resolve `~/` paths)
 * @returns {Promise<string[]>} List of virtual paths that were created
 *
 * @example
 * const created = await writeDefaultConfigs('default');
 * // created → ['~/.config/clawser/autonomy.json', '/etc/clawser/motd', ...]
 */
export const writeDefaultConfigs = async (wsId) => {
  const created = [];

  for (const [virtualPath, value] of Object.entries(DEFAULT_CONFIGS)) {
    const opfsPath = resolveVirtualPath(virtualPath, wsId);
    const content = typeof value === 'string' ? value : JSON.stringify(value, null, 2);
    const wasCreated = await writeIfMissing(opfsPath, content);
    if (wasCreated) created.push(virtualPath);
  }

  return created;
};

/**
 * Full first-boot initialization: create directories + write default configs.
 * Called early in the app startup sequence. Idempotent — safe to call on every boot.
 *
 * @param {string} wsId - Workspace ID (defaults to 'default')
 * @returns {Promise<{ dirs: boolean, configs: string[] }>}
 *
 * @example
 * const result = await bootstrapFilesystem('default');
 * // result → { dirs: true, configs: ['~/.config/clawser/autonomy.json', ...] }
 */
export const bootstrapFilesystem = async (wsId = 'default') => {
  await ensureDirectoryStructure(wsId);
  const configs = await writeDefaultConfigs(wsId);
  console.log(`[clawser] filesystem bootstrap complete for workspace "${wsId}"`, {
    configsCreated: configs.length,
    configs,
  });
  return { dirs: true, configs };
};
