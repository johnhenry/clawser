/**
 * clawser-fs-config.mjs — Config migration from localStorage to OPFS files
 *
 * Maps localStorage config domains to OPFS file paths under ~/.config/clawser/.
 * Provides read/write with fallback and a one-time migration function.
 *
 * @module clawser-fs-config
 */

import { resolveVirtualPath, opfsWalk, withLock } from './clawser-opfs.js';

// ── Config domain → OPFS path mapping ────────────────────────────

/**
 * Maps each config domain name to its OPFS virtual path (relative to workspace home).
 *
 * @example
 * CONFIG_MAP.autonomy // → '~/.config/clawser/autonomy.json'
 */
export const CONFIG_MAP = {
  autonomy: '~/.config/clawser/autonomy.json',
  identity: '~/.config/clawser/identity.json',
  security: '~/.config/clawser/security.json',
  hooks: '~/.config/clawser/hooks.json',
  peripherals: '~/.config/clawser/peripherals.json',
  routines: '~/.config/clawser/routines.json',
  modelConfig: '~/.config/clawser/model.json',
  terminalRenderer: '~/.config/clawser/terminal.json',
  selfRepair: '~/.config/clawser/selfrepair.json',
  sandbox: '~/.config/clawser/sandbox.json',
  heartbeat: '~/.config/clawser/daemon.json',
};

// ── localStorage key helpers ──────────────────────────────────────

/**
 * Derive the localStorage key for a given config domain and workspace.
 * Follows the existing lsKey pattern: `clawser_{domain}_{wsId}`.
 *
 * @param {string} domain - Config domain name (e.g. 'autonomy')
 * @param {string} wsId - Workspace ID
 * @returns {string}
 */
const lsKeyFor = (domain, wsId) => `clawser_${domain}_${wsId}`;

// ── Read config ───────────────────────────────────────────────────

/**
 * Read a config value for a domain.
 * Tries OPFS file first, falls back to localStorage.
 *
 * @param {string} domain - Config domain (key in CONFIG_MAP)
 * @param {string} wsId - Workspace ID
 * @returns {Promise<object|null>} Parsed config object or null if not found
 *
 * @example
 * const cfg = await readConfig('autonomy', 'default');
 * // → { level: 3, confirm: true }
 */
export const readConfig = async (domain, wsId) => {
  const virtualPath = CONFIG_MAP[domain];
  if (!virtualPath) return null;

  // Try OPFS first
  try {
    const opfsPath = resolveVirtualPath(virtualPath, wsId);
    const { dir, name } = await opfsWalk(opfsPath);
    const fh = await dir.getFileHandle(name);
    const file = await fh.getFile();
    const text = await file.text();
    return JSON.parse(text);
  } catch {
    // OPFS file doesn't exist or parse failed — fall back to localStorage
  }

  // Fallback to localStorage
  try {
    const raw = localStorage.getItem(lsKeyFor(domain, wsId));
    if (raw) return JSON.parse(raw);
  } catch {
    // bad JSON in localStorage
  }

  return null;
};

// ── Write config ──────────────────────────────────────────────────

/**
 * Write a config value for a domain.
 * Writes to OPFS file (using withLock) and also to localStorage for backward compat.
 *
 * @param {string} domain - Config domain (key in CONFIG_MAP)
 * @param {string} wsId - Workspace ID
 * @param {object} value - Config value to persist
 * @returns {Promise<void>}
 *
 * @example
 * await writeConfig('autonomy', 'default', { level: 5, confirm: false });
 */
export const writeConfig = async (domain, wsId, value) => {
  const virtualPath = CONFIG_MAP[domain];
  if (!virtualPath) return;

  const json = JSON.stringify(value);

  // Write to OPFS with lock
  const opfsPath = resolveVirtualPath(virtualPath, wsId);
  await withLock(`clawser:config:${domain}`, async () => {
    const { dir, name } = await opfsWalk(opfsPath, { create: true });
    const fh = await dir.getFileHandle(name, { create: true });
    const w = await fh.createWritable();
    await w.write(json);
    await w.close();
  });

  // Also write to localStorage for backward compatibility
  try {
    localStorage.setItem(lsKeyFor(domain, wsId), json);
  } catch {
    // localStorage may be full or unavailable
  }
};

// ── Migration ─────────────────────────────────────────────────────

/**
 * One-time migration: reads all localStorage configs for a workspace and
 * writes them to OPFS files. Idempotent — safe to call multiple times.
 *
 * @param {string} wsId - Workspace ID to migrate
 * @returns {Promise<string[]>} List of domain names that were migrated
 *
 * @example
 * const migrated = await migrateConfigToFs('default');
 * // → ['autonomy', 'identity', 'hooks']
 */
export const migrateConfigToFs = async (wsId) => {
  const migrated = [];

  for (const [domain, virtualPath] of Object.entries(CONFIG_MAP)) {
    try {
      const raw = localStorage.getItem(lsKeyFor(domain, wsId));
      if (!raw) continue;

      const value = JSON.parse(raw);
      const opfsPath = resolveVirtualPath(virtualPath, wsId);

      await withLock(`clawser:config:${domain}`, async () => {
        const { dir, name } = await opfsWalk(opfsPath, { create: true });
        const fh = await dir.getFileHandle(name, { create: true });
        const w = await fh.createWritable();
        await w.write(JSON.stringify(value));
        await w.close();
      });

      migrated.push(domain);
    } catch {
      // Skip domains that fail — non-fatal
    }
  }

  return migrated;
};
