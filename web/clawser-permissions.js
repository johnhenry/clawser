/**
 * clawser-permissions.js — Virtual permission layer for the clawser filesystem
 *
 * Phase 4 of the Unix filesystem architecture. Stores file permissions in
 * a manifest persisted to OPFS at ~/.config/clawser/permissions.json.
 *
 * Supports Unix-like owner permission modes: read (r), write (w), execute (x).
 * Numeric modes are simplified to owner-only (e.g. 644 → rw-).
 *
 * @module clawser-permissions
 *
 * @example
 * const pm = new PermissionManager();
 * await pm.load(shellFs);
 * pm.setPermission('/etc/clawser/motd', 'r');
 * pm.checkWrite('/etc/clawser/motd'); // throws Error
 * pm.getPermission('/tmp/clawser/scratch.txt'); // 'rw'
 */

// ── Default permission rules ──────────────────────────────────────

/**
 * Default permission prefixes, ordered most-specific-first.
 * Paths matching these prefixes get the associated default mode
 * unless overridden in the manifest.
 *
 * @type {Array<[string, string]>}
 */
const DEFAULT_RULES = Object.freeze([
  // Read-only system paths
  ['/etc/clawser/',     'r'],
  ['/proc/clawser/',    'r'],
  ['/proc/kernel/',     'r'],
  ['/dev/clawser/',     'r'],
  ['/sys/',             'r'],
  ['/run/clawser/',     'r'],

  // Read-write user/data paths
  ['~/.config/clawser/',         'rw'],
  ['~/.local/share/clawser/',    'rw'],
  ['/var/log/clawser/',          'rw'],
  ['/tmp/clawser/',              'rw'],
]);

/** Fallback mode for paths that don't match any rule. */
const DEFAULT_MODE = 'rw';

/** The virtual path where the permissions manifest is stored. */
const MANIFEST_PATH = '~/.config/clawser/permissions.json';

// ── Helpers ───────────────────────────────────────────────────────

/**
 * Parse a numeric chmod mode (e.g. 644) into an rwx string for the owner.
 * Only owner bits (first octal digit) are considered.
 *
 * @param {string|number} numeric - Octal mode string or number (e.g. "755", 644)
 * @returns {string} Owner permission string like 'rwx', 'rw', 'r', etc.
 *
 * @example
 * numericToMode('755') // 'rwx'
 * numericToMode('644') // 'rw'
 * numericToMode('444') // 'r'
 */
const numericToMode = (numeric) => {
  const s = String(numeric).padStart(3, '0');
  const ownerOctal = parseInt(s[0], 10);
  let mode = '';
  if (ownerOctal & 4) mode += 'r';
  if (ownerOctal & 2) mode += 'w';
  if (ownerOctal & 1) mode += 'x';
  return mode || '-';
};

/**
 * Convert an rwx mode string to a numeric octal string.
 * Produces owner-only (group and other mirror owner).
 *
 * @param {string} mode - e.g. 'rwx', 'rw', 'r'
 * @returns {string} e.g. '755', '644', '444'
 *
 * @example
 * modeToNumeric('rwx') // '755'
 * modeToNumeric('rw')  // '644'
 * modeToNumeric('r')   // '444'
 */
const modeToNumeric = (mode) => {
  let bits = 0;
  if (mode.includes('r')) bits |= 4;
  if (mode.includes('w')) bits |= 2;
  if (mode.includes('x')) bits |= 1;
  // Mirror owner to group/other with reduced perms
  const groupOther = bits & 4 ? (bits & 1 ? 5 : 4) : 0;
  return `${bits}${groupOther}${groupOther}`;
};

/**
 * Format an rwx mode as a Unix-style permission string (e.g. "rw-").
 *
 * @param {string} mode
 * @returns {string}
 */
const formatRwx = (mode) => {
  const r = mode.includes('r') ? 'r' : '-';
  const w = mode.includes('w') ? 'w' : '-';
  const x = mode.includes('x') ? 'x' : '-';
  return `${r}${w}${x}`;
};

// ── PermissionManager ─────────────────────────────────────────────

/**
 * Manages virtual file permissions with OPFS-backed persistence.
 *
 * Permissions are stored as a flat JSON object mapping virtual paths
 * to mode strings ('r', 'rw', 'rwx', etc.). Paths not in the manifest
 * fall back to prefix-based defaults.
 */
export class PermissionManager {
  /**
   * In-memory permission manifest: path → mode string.
   * @type {Map<string, string>}
   */
  #manifest = new Map();

  /** Whether the manifest has been loaded from disk. */
  #loaded = false;

  /** Reference to the filesystem for persistence. */
  #fs = null;

  /**
   * Load the permission manifest from the filesystem.
   * If the manifest file doesn't exist, starts with an empty map
   * (defaults still apply).
   *
   * @param {object} fs - ShellFs, MemoryFs, or VirtualFs instance
   * @returns {Promise<void>}
   *
   * @example
   * const pm = new PermissionManager();
   * await pm.load(shellFs);
   */
  async load(fs) {
    this.#fs = fs;
    try {
      // Read from the real fs if available, to avoid VirtualFs interception
      const realFs = fs.realFs || fs;
      const raw = await realFs.readFile(MANIFEST_PATH);
      const data = JSON.parse(raw);
      this.#manifest.clear();
      for (const [path, mode] of Object.entries(data)) {
        this.#manifest.set(path, mode);
      }
    } catch {
      // File doesn't exist yet — start empty, defaults apply
    }
    this.#loaded = true;
  }

  /**
   * Persist the manifest to disk.
   * @returns {Promise<void>}
   */
  async #save() {
    if (!this.#fs) return;
    const obj = Object.fromEntries(this.#manifest);
    const content = JSON.stringify(obj, null, 2);
    try {
      const realFs = this.#fs.realFs || this.#fs;
      await realFs.writeFile(MANIFEST_PATH, content);
    } catch (e) {
      console.warn('[clawser-permissions] failed to persist manifest:', e.message);
    }
  }

  /**
   * Get the effective permission mode for a path.
   * Checks the manifest first, then falls back to default rules.
   *
   * @param {string} path - Virtual path (e.g. '/etc/clawser/motd')
   * @returns {string} Mode string like 'r', 'rw', 'rwx'
   *
   * @example
   * pm.getPermission('/etc/clawser/motd')  // 'r' (default)
   * pm.getPermission('/tmp/clawser/foo')   // 'rw' (default)
   */
  getPermission(path) {
    // Exact match in manifest takes priority
    if (this.#manifest.has(path)) {
      return this.#manifest.get(path);
    }

    // Check default rules (most-specific-first)
    for (const [prefix, mode] of DEFAULT_RULES) {
      if (path.startsWith(prefix) || path === prefix.replace(/\/$/, '')) {
        return mode;
      }
    }

    return DEFAULT_MODE;
  }

  /**
   * Set the permission mode for a path and persist to disk.
   *
   * @param {string} path - Virtual path
   * @param {string} mode - Mode string ('r', 'rw', 'rwx', 'rx', etc.)
   * @returns {Promise<void>}
   *
   * @example
   * await pm.setPermission('/tmp/clawser/important.txt', 'r');
   */
  async setPermission(path, mode) {
    this.#manifest.set(path, mode);
    await this.#save();
  }

  /**
   * Set permissions recursively for all paths under a prefix.
   * Updates the manifest for all currently-known paths under the prefix,
   * plus stores the prefix itself.
   *
   * @param {string} prefix - Directory prefix (e.g. '/tmp/clawser/')
   * @param {string} mode - Mode string
   * @returns {Promise<void>}
   */
  async setPermissionRecursive(prefix, mode) {
    const norm = prefix.endsWith('/') ? prefix : prefix + '/';
    this.#manifest.set(prefix, mode);
    for (const [path] of this.#manifest) {
      if (path.startsWith(norm)) {
        this.#manifest.set(path, mode);
      }
    }
    await this.#save();
  }

  /**
   * Check if a path is writable. Throws if the path is read-only.
   *
   * @param {string} path - Virtual path
   * @throws {Error} If the path does not have write permission
   * @returns {boolean} true if writable
   *
   * @example
   * pm.checkWrite('/etc/clawser/motd');
   * // throws Error('Permission denied: /etc/clawser/motd is read-only (mode: r)')
   */
  checkWrite(path) {
    const mode = this.getPermission(path);
    if (!mode.includes('w')) {
      throw new Error(`Permission denied: ${path} is read-only (mode: ${formatRwx(mode)})`);
    }
    return true;
  }

  /**
   * Check if a path is readable.
   * Currently always returns true (all files are readable).
   *
   * @param {string} path
   * @returns {boolean}
   */
  checkRead(path) {
    const mode = this.getPermission(path);
    return mode.includes('r');
  }

  /**
   * Get the formatted rwx string for display.
   *
   * @param {string} path
   * @returns {string} e.g. 'rw-', 'r--', 'rwx'
   */
  formatMode(path) {
    return formatRwx(this.getPermission(path));
  }

  /**
   * Dump the full manifest as a JSON string (for /proc/clawser/permissions).
   *
   * @returns {string}
   */
  dump() {
    const obj = {};
    // Include all manifest entries
    for (const [path, mode] of this.#manifest) {
      obj[path] = { mode, rwx: formatRwx(mode), source: 'manifest' };
    }
    // Include default rules
    for (const [prefix, mode] of DEFAULT_RULES) {
      if (!obj[prefix]) {
        obj[prefix] = { mode, rwx: formatRwx(mode), source: 'default' };
      }
    }
    return JSON.stringify(obj, null, 2) + '\n';
  }

  /**
   * Get the raw manifest map (for testing).
   * @returns {Map<string, string>}
   */
  get manifest() {
    return new Map(this.#manifest);
  }
}

// ── chmod builtin registration ────────────────────────────────────

/**
 * Register the `chmod` shell builtin command.
 *
 * Supports:
 *   chmod +w /path       — make writable
 *   chmod -w /path       — make read-only
 *   chmod +x /path       — add execute
 *   chmod -x /path       — remove execute
 *   chmod 644 /path      — numeric mode
 *   chmod -R -w /path    — recursive
 *
 * @param {import('./clawser-shell.js').CommandRegistry} registry
 * @param {PermissionManager} permissions
 *
 * @example
 * registerChmodBuiltin(registry, permissionManager);
 * // shell: chmod -w /etc/clawser/motd
 */
export const registerChmodBuiltin = (registry, permissions) => {
  registry.register('chmod', async ({ args, state }) => {
    if (args.length < 2) {
      return {
        stdout: '',
        stderr: 'chmod: usage: chmod [-R] MODE PATH\n  MODE: +w, -w, +x, -x, or numeric (e.g. 644)',
        exitCode: 1,
      };
    }

    let recursive = false;
    const remaining = [];

    // Parse flags
    for (const arg of args) {
      if (arg === '-R') {
        recursive = true;
      } else {
        remaining.push(arg);
      }
    }

    if (remaining.length < 2) {
      return {
        stdout: '',
        stderr: 'chmod: missing operand after mode',
        exitCode: 1,
      };
    }

    const modeArg = remaining[0];
    const paths = remaining.slice(1);

    // Determine the new mode
    let resolveMode;

    if (/^\d{3}$/.test(modeArg)) {
      // Numeric mode (e.g. 644, 755)
      const parsed = numericToMode(modeArg);
      resolveMode = () => parsed;
    } else if (modeArg.startsWith('+') || modeArg.startsWith('-')) {
      // Symbolic mode (+w, -w, +x, -x)
      const adding = modeArg[0] === '+';
      const bit = modeArg.slice(1);
      if (!['r', 'w', 'x'].includes(bit)) {
        return {
          stdout: '',
          stderr: `chmod: invalid mode: ${modeArg}`,
          exitCode: 1,
        };
      }
      resolveMode = (currentMode) => {
        if (adding) {
          return currentMode.includes(bit) ? currentMode : currentMode + bit;
        } else {
          return currentMode.replace(bit, '');
        }
      };
    } else {
      return {
        stdout: '',
        stderr: `chmod: invalid mode: ${modeArg}`,
        exitCode: 1,
      };
    }

    for (const p of paths) {
      const resolved = state.resolvePath(p);
      if (recursive) {
        const current = permissions.getPermission(resolved);
        const newMode = resolveMode(current) || '-';
        await permissions.setPermissionRecursive(resolved, newMode);
      } else {
        const current = permissions.getPermission(resolved);
        const newMode = resolveMode(current) || '-';
        await permissions.setPermission(resolved, newMode);
      }
    }

    return { stdout: '', stderr: '', exitCode: 0 };
  }, {
    description: 'Change file permissions',
    category: 'File Operations',
    usage: 'chmod [-R] MODE PATH...',
    flags: {
      '-R': 'Recursive',
      '+w': 'Add write permission',
      '-w': 'Remove write permission',
      '+x': 'Add execute permission',
      '-x': 'Remove execute permission',
    },
  });

  // ── stat enhancement: show permissions ──
  // Override stat if already registered to include permissions
  const existingStat = registry.get('stat');
  if (existingStat) {
    const statMeta = registry.getMeta('stat');
    registry.register('stat', async (ctx) => {
      const result = await existingStat(ctx);
      if (result.exitCode === 0 && ctx.args.length > 0) {
        const resolved = ctx.state.resolvePath(ctx.args[ctx.args.length - 1]);
        const mode = permissions.formatMode(resolved);
        const numMode = modeToNumeric(permissions.getPermission(resolved));
        result.stdout = result.stdout.trimEnd() + `\n  Mode: ${mode} (${numMode})\n`;
      }
      return result;
    }, statMeta || { description: 'Display file status', category: 'File Operations', usage: 'stat FILE' });
  }
};

// ── Exports for testing ──────────────────────────────────────────

export { numericToMode, modeToNumeric, formatRwx, DEFAULT_RULES, DEFAULT_MODE, MANIFEST_PATH };
