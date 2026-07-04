/**
 * clawser-file-watcher.mjs — Polls OPFS config files for changes and emits events.
 *
 * OPFS has no native file-system watch API, so we poll on a configurable interval,
 * using modification timestamps as a fast-path and content comparison as fallback.
 *
 * @module clawser-file-watcher
 *
 * @example
 *   const watcher = new FileWatcher(shellFs, { intervalMs: 3000 });
 *   watcher.watch('~/.config/clawser/autonomy.json', ({ path, oldValue, newValue, timestamp }) => {
 *     console.log(`${path} changed`, newValue);
 *   });
 *   watcher.start();
 */

/**
 * @typedef {Object} FileChangeEvent
 * @property {string} path - Virtual path that changed
 * @property {*} oldValue - Previous parsed value (or raw string)
 * @property {*} newValue - New parsed value (or raw string)
 * @property {number} timestamp - When the change was detected (Date.now())
 */

/**
 * @typedef {Object} WatchEntry
 * @property {(event: FileChangeEvent) => void} callback
 * @property {number} lastModified - Last known mtime
 * @property {string|null} lastContent - Raw string content from last read
 * @property {*} lastValidParsed - Last successfully parsed value
 * @property {number|null} debounceTimer
 * @property {boolean} parseJson - Auto-parse as JSON
 * @property {boolean} keepPreviousOnError - Keep last valid config on parse failure
 */

export class FileWatcher {
  /** @type {import('./clawser-shell.js').ShellFs} */
  #fs;

  /** @type {number} */
  #intervalMs;

  /** @type {number} */
  #debounceMs;

  /** @type {Map<string, WatchEntry>} */
  #watches = new Map();

  /** @type {number|null} */
  #pollTimer = null;

  /** @type {boolean} */
  #enabled = true;

  /**
   * Timestamp of the last write performed by this instance.
   * Used to suppress self-notifications and avoid feedback loops.
   * Maps path → timestamp of last local write.
   * @type {Map<string, number>}
   */
  #lastWrittenByMe = new Map();

  /**
   * @param {import('./clawser-shell.js').ShellFs} fs - ShellFs instance for file I/O
   * @param {Object} [opts]
   * @param {number} [opts.intervalMs=3000] - Polling interval in milliseconds
   * @param {number} [opts.debounceMs=500] - Debounce window for rapid writes
   *
   * @example
   *   const watcher = new FileWatcher(shellFs);
   *   const watcher2 = new FileWatcher(shellFs, { intervalMs: 1000, debounceMs: 300 });
   */
  constructor(fs, { intervalMs = 3000, debounceMs = 500 } = {}) {
    this.#fs = fs;
    this.#intervalMs = intervalMs;
    this.#debounceMs = debounceMs;
  }

  /**
   * Register a file to watch.
   *
   * @param {string} path - Virtual path (e.g. '~/.config/clawser/autonomy.json')
   * @param {(event: FileChangeEvent) => void} callback - Called on change
   * @param {Object} [opts]
   * @param {boolean} [opts.parseJson] - Parse content as JSON (default: true for .json files)
   * @param {boolean} [opts.keepPreviousOnError=true] - On JSON parse error, keep last valid value
   *
   * @example
   *   watcher.watch('~/.config/clawser/identity.json', ({ newValue }) => {
   *     state.identityManager?.update(newValue);
   *   });
   */
  watch(path, callback, opts = {}) {
    this.#watches.set(path, {
      callback,
      lastModified: 0,
      lastContent: null,
      lastValidParsed: null,
      debounceTimer: null,
      parseJson: opts.parseJson ?? path.endsWith('.json'),
      keepPreviousOnError: opts.keepPreviousOnError ?? true,
    });
  }

  /**
   * Remove a watch registration.
   * @param {string} path
   */
  unwatch(path) {
    const entry = this.#watches.get(path);
    if (entry?.debounceTimer) clearTimeout(entry.debounceTimer);
    this.#watches.delete(path);
    this.#lastWrittenByMe.delete(path);
  }

  /** Start the polling loop. Performs an immediate first check. */
  start() {
    if (this.#pollTimer) return;
    this.#poll();
    this.#pollTimer = setInterval(() => this.#poll(), this.#intervalMs);
  }

  /** Stop polling and clear all pending debounce timers. */
  stop() {
    if (this.#pollTimer) {
      clearInterval(this.#pollTimer);
      this.#pollTimer = null;
    }
    for (const entry of this.#watches.values()) {
      if (entry.debounceTimer) {
        clearTimeout(entry.debounceTimer);
        entry.debounceTimer = null;
      }
    }
  }

  /** Enable or disable reactivity. When disabled, polls are skipped. */
  set enabled(value) { this.#enabled = !!value; }
  get enabled() { return this.#enabled; }

  /**
   * Record that the current tab just wrote to a path.
   * The next poll cycle will suppress the notification for this path
   * if the detected mtime is within the debounce window of the write.
   *
   * When the written content is provided, it is stored in the watch entry
   * so the poll's content-hash check suppresses the notification
   * deterministically — even if the poll runs after the time window expires.
   *
   * @param {string} path - Virtual path that was written
   * @param {string} [content] - The content that was written (for exact suppression)
   *
   * @example
   *   await fs.writeFile(path, content);
   *   watcher.markWrittenByMe(path, content);
   */
  markWrittenByMe(path, content) {
    this.#lastWrittenByMe.set(path, Date.now());
    if (content === undefined) return;
    const entry = this.#watches.get(path);
    if (!entry) return;
    entry.lastContent = content;
    if (entry.parseJson) {
      try { entry.lastValidParsed = JSON.parse(content); } catch { /* keep previous */ }
    } else {
      entry.lastValidParsed = content;
    }
  }

  /**
   * Force re-read all watched files. Useful on workspace switch.
   * Resets cached mtime/content so the next poll detects everything as new.
   */
  async rescan() {
    for (const entry of this.#watches.values()) {
      entry.lastModified = 0;
      entry.lastContent = null;
    }
    this.#lastWrittenByMe.clear();
    await this.#poll();
  }

  /**
   * Get the last valid parsed content for a watched path.
   * Returns null if path isn't watched or hasn't been read yet.
   *
   * @param {string} path
   * @returns {*}
   */
  getCached(path) {
    return this.#watches.get(path)?.lastValidParsed ?? null;
  }

  // ── Private ─────────────────────────────────────────────────────

  async #poll() {
    if (!this.#enabled) return;

    for (const [path, entry] of this.#watches) {
      try {
        const stat = await this.#fs.stat(path);
        if (!stat || stat.kind !== 'file') continue;

        const modified = stat.lastModified || 0;

        // Fast path: mtime unchanged → skip
        if (modified <= entry.lastModified) continue;

        // Check self-write suppression: if we wrote this path recently,
        // suppress notification. "Recently" = within (debounceMs + intervalMs)
        // to account for timing jitter.
        const myWriteTs = this.#lastWrittenByMe.get(path);
        if (myWriteTs && (Date.now() - myWriteTs) < (this.#debounceMs + this.#intervalMs)) {
          // Update tracking so we don't re-read unnecessarily, but don't notify
          entry.lastModified = modified;
          const content = await this.#fs.readFile(path);
          entry.lastContent = content;
          if (entry.parseJson) {
            try { entry.lastValidParsed = JSON.parse(content); } catch { /* keep previous */ }
          } else {
            entry.lastValidParsed = content;
          }
          // Clear the self-write marker once we've consumed it
          this.#lastWrittenByMe.delete(path);
          continue;
        }

        // Read the actual content
        const content = await this.#fs.readFile(path);

        // Content-hash fallback: if raw content is identical, just update mtime
        if (content === entry.lastContent) {
          entry.lastModified = modified;
          continue;
        }

        entry.lastModified = modified;
        entry.lastContent = content;

        // Debounce rapid writes
        if (entry.debounceTimer) clearTimeout(entry.debounceTimer);
        entry.debounceTimer = setTimeout(() => {
          entry.debounceTimer = null;
          this.#deliver(path, entry, content);
        }, this.#debounceMs);

      } catch {
        // File doesn't exist or read error — skip silently
      }
    }
  }

  /**
   * Parse (if JSON) and deliver the change event to the callback.
   * On JSON parse error: log warning, keep previous valid config.
   */
  #deliver(path, entry, content) {
    const oldValue = entry.lastValidParsed;

    if (entry.parseJson) {
      try {
        const parsed = JSON.parse(content);
        entry.lastValidParsed = parsed;
        entry.callback({ path, oldValue, newValue: parsed, timestamp: Date.now() });
      } catch (e) {
        console.warn(`[FileWatcher] JSON parse error in ${path}: ${e.message}`);
        if (!entry.keepPreviousOnError) {
          entry.lastValidParsed = null;
          entry.callback({ path, oldValue, newValue: null, timestamp: Date.now() });
        }
        // keepPreviousOnError (default): silently retain last valid config
      }
    } else {
      entry.lastValidParsed = content;
      entry.callback({ path, oldValue, newValue: content, timestamp: Date.now() });
    }
  }
}
