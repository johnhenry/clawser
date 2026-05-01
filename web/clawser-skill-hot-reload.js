/**
 * clawser-skill-hot-reload.js — Hot-reload watcher for skills
 *
 * Watches skill directories for changes and automatically re-discovers
 * and re-activates affected skills without restarting.
 *
 * Browser: polls OPFS modification timestamps (no native watch support).
 * CLI/Node.js: uses fs.watch for real filesystem directories.
 *
 * @example
 *   const reloader = new SkillHotReloader({
 *     registry: state.skillRegistry,
 *     wsId: 'my-workspace',
 *     onLog: (level, msg) => console.log(msg),
 *     onReload: (changed) => renderSkills(),
 *   });
 *   reloader.start();
 *   // ... later
 *   reloader.stop();
 */

import { SkillStorage, SkillParser, computeSkillHash } from './clawser-skills.js';

// ── Constants ───────────────────────────────────────────────────

const DEFAULT_POLL_INTERVAL_MS = 3000;
const MIN_POLL_INTERVAL_MS = 500;

// ── SkillHotReloader (Browser / OPFS polling) ──────────────────

/**
 * Polls OPFS skill directories for changes by tracking content hashes.
 * OPFS File objects expose `lastModified`, but support varies — we use
 * content hashing (FNV-1a via computeSkillHash) as the reliable signal.
 *
 * On change:
 *   1. Re-runs registry.discover(wsId) to pick up new/removed skills
 *   2. For active skills whose content changed, deactivates then reactivates
 *   3. Fires onReload callback with list of changed skill names
 *
 * Errors in individual skills are caught and logged; the previous
 * working version stays active.
 */
export class SkillHotReloader {
  /** @type {import('./clawser-skills.js').SkillRegistry} */
  #registry;

  /** @type {string} */
  #wsId;

  /** @type {number} */
  #intervalMs;

  /** @type {number|null} */
  #timerId = null;

  /** @type {boolean} */
  #running = false;

  /** @type {boolean} */
  #polling = false;

  /** @type {Map<string, string>} skillName → content hash */
  #hashes = new Map();

  /** @type {Map<string, number>} skillName → lastModified timestamp */
  #timestamps = new Map();

  /** @type {Function} */
  #onLog;

  /** @type {Function} */
  #onReload;

  /**
   * @param {object} opts
   * @param {import('./clawser-skills.js').SkillRegistry} opts.registry
   * @param {string} opts.wsId
   * @param {number} [opts.intervalMs=3000] - Polling interval
   * @param {Function} [opts.onLog] - (level: number, msg: string) => void
   * @param {Function} [opts.onReload] - (changedSkills: string[]) => void
   */
  constructor(opts) {
    this.#registry = opts.registry;
    this.#wsId = opts.wsId;
    this.#intervalMs = Math.max(opts.intervalMs ?? DEFAULT_POLL_INTERVAL_MS, MIN_POLL_INTERVAL_MS);
    this.#onLog = opts.onLog ?? (() => {});
    this.#onReload = opts.onReload ?? (() => {});
  }

  /** Whether the watcher is currently running. */
  get running() { return this.#running; }

  /** Current polling interval in ms. */
  get intervalMs() { return this.#intervalMs; }

  /** Current workspace ID being watched. */
  get wsId() { return this.#wsId; }

  /**
   * Update the workspace ID (e.g. on workspace switch).
   * Clears cached hashes so the next poll does a full scan.
   * @param {string} wsId
   */
  setWorkspace(wsId) {
    this.#wsId = wsId;
    this.#hashes.clear();
    this.#timestamps.clear();
  }

  /**
   * Update polling interval. Takes effect on next cycle.
   * @param {number} ms
   */
  setInterval(ms) {
    this.#intervalMs = Math.max(ms, MIN_POLL_INTERVAL_MS);
  }

  /**
   * Start polling for changes.
   * Safe to call multiple times — subsequent calls are no-ops.
   */
  start() {
    if (this.#running) return;
    this.#running = true;
    this.#onLog(2, `[hot-reload] Started (interval: ${this.#intervalMs}ms)`);
    this.#scheduleNext();
  }

  /**
   * Stop polling. In-flight polls are allowed to finish but their
   * results are discarded.
   */
  stop() {
    if (!this.#running) return;
    this.#running = false;
    if (this.#timerId !== null) {
      clearTimeout(this.#timerId);
      this.#timerId = null;
    }
    this.#onLog(2, '[hot-reload] Stopped');
  }

  /**
   * Force an immediate poll (useful after manual skill install/edit).
   * Returns the list of changed skill names.
   * @returns {Promise<string[]>}
   */
  async pollNow() {
    return this.#poll();
  }

  /**
   * Take a snapshot of current skill hashes without triggering reload.
   * Call this after initial discover() to seed the baseline.
   * @returns {Promise<void>}
   */
  async snapshot() {
    await this.#buildSnapshot();
  }

  // ── Internal ──────────────────────────────────────────────────

  #scheduleNext() {
    if (!this.#running) return;
    this.#timerId = setTimeout(async () => {
      if (!this.#running) return;
      try {
        await this.#poll();
      } catch (e) {
        this.#onLog(4, `[hot-reload] Poll error: ${e.message}`);
      }
      this.#scheduleNext();
    }, this.#intervalMs);
  }

  /**
   * Single poll cycle: scan all skill dirs, compare hashes, reload changed.
   * @returns {Promise<string[]>} Names of skills that were reloaded
   */
  async #poll() {
    if (this.#polling) return []; // prevent overlapping polls
    this.#polling = true;
    try {
      return await this.#doPoll();
    } finally {
      this.#polling = false;
    }
  }

  async #doPoll() {
    const currentHashes = new Map();
    const currentTimestamps = new Map();
    const changed = [];

    // Scan global skills
    try {
      const globalDir = await SkillStorage.getGlobalSkillsDir();
      await this.#scanDir(globalDir, currentHashes, currentTimestamps);
    } catch { /* global dir may not exist yet */ }

    // Scan workspace skills
    try {
      const wsDir = await SkillStorage.getWorkspaceSkillsDir(this.#wsId);
      await this.#scanDir(wsDir, currentHashes, currentTimestamps);
    } catch { /* workspace dir may not exist yet */ }

    // Detect removed skills (in old hashes but not in current)
    for (const name of this.#hashes.keys()) {
      if (!currentHashes.has(name)) {
        changed.push(name);
      }
    }

    // Detect new or modified skills
    for (const [name, hash] of currentHashes) {
      const oldHash = this.#hashes.get(name);
      if (oldHash !== hash) {
        changed.push(name);
      }
    }

    // Update stored state
    this.#hashes = currentHashes;
    this.#timestamps = currentTimestamps;

    if (changed.length === 0) return [];

    this.#onLog(2, `[hot-reload] Changes detected: ${changed.join(', ')}`);

    // Track which active skills need re-activation
    const activeSkills = this.#registry.activeSkills;
    const toReactivate = changed.filter(name => activeSkills.has(name));

    // Re-discover (picks up new skills, removes deleted ones)
    try {
      await this.#registry.discover(this.#wsId);
    } catch (e) {
      this.#onLog(4, `[hot-reload] Re-discover failed: ${e.message}`);
      return [];
    }

    // Re-activate skills that were active before the change
    for (const name of toReactivate) {
      // Only reactivate if the skill still exists after discovery
      if (!this.#registry.skills.has(name)) {
        this.#onLog(3, `[hot-reload] Skill "${name}" removed — was active, now deactivated`);
        continue;
      }

      try {
        // Deactivate first to clean up old tools
        this.#registry.deactivate(name);
        // Reactivate with fresh content
        const result = await this.#registry.activate(name, '', { force: false });
        if (result) {
          this.#onLog(2, `[hot-reload] Reactivated "${name}"`);
        } else {
          this.#onLog(3, `[hot-reload] Failed to reactivate "${name}" — keeping deactivated`);
        }
      } catch (e) {
        this.#onLog(4, `[hot-reload] Error reactivating "${name}": ${e.message}`);
        // Skill stays deactivated — the user can manually activate once fixed
      }
    }

    this.#onReload(changed);
    return changed;
  }

  /**
   * Scan a parent directory for skill subdirs, reading SKILL.md hashes.
   * Uses lastModified timestamps as a fast-path for SKILL.md, but always
   * checks script files since they have independent timestamps.
   */
  async #scanDir(parentDir, hashMap, tsMap) {
    for await (const [dirName, handle] of parentDir) {
      if (handle.kind !== 'directory') continue;

      try {
        const fileHandle = await handle.getFileHandle('SKILL.md');
        const file = await fileHandle.getFile();

        const ts = file.lastModified;
        const oldTs = this.#timestamps.get(dirName);
        tsMap.set(dirName, ts);

        // Read SKILL.md content — use cached hash only if timestamp unchanged
        let skillHash;
        if (oldTs !== undefined && oldTs === ts) {
          const cached = this.#hashes.get(dirName);
          // Extract just the SKILL.md portion (first 8 chars)
          skillHash = cached ? cached.slice(0, 8) : null;
        }
        if (!skillHash) {
          const content = await file.text();
          skillHash = computeSkillHash(content);
        }

        // Always scan scripts/ — they may change independently
        let scriptHash = '';
        try {
          const scriptsDir = await handle.getDirectoryHandle('scripts');
          for await (const [sName, sHandle] of scriptsDir) {
            if (sHandle.kind === 'file') {
              const sFile = await sHandle.getFile();
              const sContent = await sFile.text();
              scriptHash += computeSkillHash(sContent);
            }
          }
        } catch { /* no scripts dir */ }

        hashMap.set(dirName, skillHash + scriptHash);
      } catch {
        // No SKILL.md → not a valid skill dir, skip
      }
    }
  }

  /**
   * Build initial hash snapshot without triggering any reloads.
   */
  async #buildSnapshot() {
    this.#hashes.clear();
    this.#timestamps.clear();

    try {
      const globalDir = await SkillStorage.getGlobalSkillsDir();
      await this.#scanDir(globalDir, this.#hashes, this.#timestamps);
    } catch { /* no global dir */ }

    try {
      const wsDir = await SkillStorage.getWorkspaceSkillsDir(this.#wsId);
      await this.#scanDir(wsDir, this.#hashes, this.#timestamps);
    } catch { /* no workspace dir */ }

    this.#onLog(2, `[hot-reload] Snapshot: ${this.#hashes.size} skills indexed`);
  }
}

// ── SkillFsWatcher (Node.js / real filesystem) ──────────────────

/**
 * Uses Node.js fs.watch to monitor skill directories on the real filesystem.
 * Intended for CLI usage where skills live on disk rather than OPFS.
 *
 * Debounces rapid filesystem events (e.g. editor save → rename → write)
 * and triggers re-discovery + re-activation of affected skills.
 *
 * @example
 *   const watcher = new SkillFsWatcher({
 *     registry,
 *     wsId: 'default',
 *     dirs: ['/home/user/.clawser/skills', './project/.skills'],
 *     onLog: console.log,
 *     onReload: (changed) => {},
 *   });
 *   watcher.start();
 */
export class SkillFsWatcher {
  /** @type {import('./clawser-skills.js').SkillRegistry} */
  #registry;

  /** @type {string} */
  #wsId;

  /** @type {string[]} */
  #dirs;

  /** @type {number} */
  #debounceMs;

  /** @type {Function} */
  #onLog;

  /** @type {Function} */
  #onReload;

  /** @type {Array<import('fs').FSWatcher>} */
  #watchers = [];

  /** @type {boolean} */
  #running = false;

  /** @type {Map<string, NodeJS.Timeout>} dirName → debounce timer */
  #pending = new Map();

  /** @type {Set<string>} accumulated changed dir names in current debounce window */
  #changedDirs = new Set();

  /** @type {NodeJS.Timeout|null} */
  #debounceTimer = null;

  /**
   * @param {object} opts
   * @param {import('./clawser-skills.js').SkillRegistry} opts.registry
   * @param {string} opts.wsId
   * @param {string[]} opts.dirs - Absolute paths to skill directories to watch
   * @param {number} [opts.debounceMs=500] - Debounce interval for filesystem events
   * @param {Function} [opts.onLog]
   * @param {Function} [opts.onReload]
   */
  constructor(opts) {
    this.#registry = opts.registry;
    this.#wsId = opts.wsId;
    this.#dirs = opts.dirs || [];
    this.#debounceMs = opts.debounceMs ?? 500;
    this.#onLog = opts.onLog ?? (() => {});
    this.#onReload = opts.onReload ?? (() => {});
  }

  /** Whether the watcher is currently running. */
  get running() { return this.#running; }

  /** Whether fs.watch is available in this environment. */
  static get available() {
    try {
      return typeof process !== 'undefined' && typeof process.versions?.node === 'string';
    } catch {
      return false;
    }
  }

  /**
   * Update the workspace ID.
   * @param {string} wsId
   */
  setWorkspace(wsId) {
    this.#wsId = wsId;
  }

  /**
   * Start watching all configured directories.
   * Creates recursive fs.watch watchers for each dir.
   */
  async start() {
    if (this.#running) return;
    if (!SkillFsWatcher.available) {
      this.#onLog(3, '[hot-reload:fs] fs.watch not available in this environment');
      return;
    }

    this.#running = true;

    const fs = await import('node:fs');
    const path = await import('node:path');

    for (const dir of this.#dirs) {
      try {
        // Verify directory exists
        fs.accessSync(dir, fs.constants.R_OK);

        const watcher = fs.watch(dir, { recursive: true }, (eventType, filename) => {
          if (!this.#running) return;
          if (!filename) return;

          // Only care about SKILL.md and scripts/*.js changes
          const basename = path.basename(filename);
          if (basename !== 'SKILL.md' && !filename.includes('scripts/')) return;

          // Extract skill directory name (first path component)
          const parts = filename.split(path.sep);
          const skillDirName = parts[0];
          if (skillDirName) {
            this.#changedDirs.add(skillDirName);
            this.#scheduleReload();
          }
        });

        watcher.on('error', (err) => {
          this.#onLog(4, `[hot-reload:fs] Watch error on "${dir}": ${err.message}`);
        });

        this.#watchers.push(watcher);
        this.#onLog(2, `[hot-reload:fs] Watching "${dir}"`);
      } catch (e) {
        this.#onLog(3, `[hot-reload:fs] Cannot watch "${dir}": ${e.message}`);
      }
    }
  }

  /**
   * Stop all watchers and clean up.
   */
  stop() {
    if (!this.#running) return;
    this.#running = false;

    for (const watcher of this.#watchers) {
      watcher.close();
    }
    this.#watchers = [];

    if (this.#debounceTimer) {
      clearTimeout(this.#debounceTimer);
      this.#debounceTimer = null;
    }
    this.#changedDirs.clear();

    this.#onLog(2, '[hot-reload:fs] Stopped');
  }

  // ── Internal ──────────────────────────────────────────────────

  #scheduleReload() {
    if (this.#debounceTimer) clearTimeout(this.#debounceTimer);
    this.#debounceTimer = setTimeout(() => this.#doReload(), this.#debounceMs);
  }

  async #doReload() {
    const changed = [...this.#changedDirs];
    this.#changedDirs.clear();
    this.#debounceTimer = null;

    if (changed.length === 0) return;

    this.#onLog(2, `[hot-reload:fs] Changes detected: ${changed.join(', ')}`);

    // Track active skills that need re-activation
    const activeSkills = this.#registry.activeSkills;
    const toReactivate = changed.filter(name => activeSkills.has(name));

    // Re-discover
    try {
      await this.#registry.discover(this.#wsId);
    } catch (e) {
      this.#onLog(4, `[hot-reload:fs] Re-discover failed: ${e.message}`);
      return;
    }

    // Re-activate affected skills
    for (const name of toReactivate) {
      if (!this.#registry.skills.has(name)) {
        this.#onLog(3, `[hot-reload:fs] Skill "${name}" removed — was active, now deactivated`);
        continue;
      }

      try {
        this.#registry.deactivate(name);
        const result = await this.#registry.activate(name, '', { force: false });
        if (result) {
          this.#onLog(2, `[hot-reload:fs] Reactivated "${name}"`);
        } else {
          this.#onLog(3, `[hot-reload:fs] Failed to reactivate "${name}" — keeping deactivated`);
        }
      } catch (e) {
        this.#onLog(4, `[hot-reload:fs] Error reactivating "${name}": ${e.message}`);
      }
    }

    this.#onReload(changed);
  }
}

// ── Factory ─────────────────────────────────────────────────────

/**
 * Create the appropriate hot-reloader for the current environment.
 * Returns a SkillFsWatcher on Node.js (when dirs are provided),
 * otherwise returns a SkillHotReloader (OPFS poller).
 *
 * @param {object} opts
 * @param {import('./clawser-skills.js').SkillRegistry} opts.registry
 * @param {string} opts.wsId
 * @param {string[]} [opts.dirs] - Filesystem paths (Node.js only)
 * @param {number} [opts.intervalMs] - Poll interval for browser
 * @param {number} [opts.debounceMs] - Debounce interval for Node.js
 * @param {Function} [opts.onLog]
 * @param {Function} [opts.onReload]
 * @returns {SkillHotReloader|SkillFsWatcher}
 */
export const createSkillWatcher = (opts) => {
  if (SkillFsWatcher.available && opts.dirs?.length > 0) {
    return new SkillFsWatcher(opts);
  }
  return new SkillHotReloader(opts);
};
