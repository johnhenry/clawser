// clawser-fs-observer.js — FileSystem Observer for mounted directories
//
// FsObserver: watches mounted filesystem paths for changes via FileSystemObserver API.
// Feature-detects 'FileSystemObserver' in globalThis.
// On change -> debounce 500ms -> fire 'mount:changed' event.
// Graceful no-op if the API is unavailable.

// ── Constants ───────────────────────────────────────────────────

const DEBOUNCE_MS = 500;

// ── FsObserver ──────────────────────────────────────────────────

/**
 * Observes mounted filesystem paths for changes.
 * Uses the FileSystemObserver API when available (Chrome 129+).
 * Falls back to a no-op when the API is not present.
 *
 * Extends EventTarget to dispatch 'mount:changed' events.
 */
export class FsObserver extends EventTarget {
  /** @type {Map<string, { handle: FileSystemDirectoryHandle|null, observer: object|null }>} */
  #watches = new Map();

  /** @type {Map<string, { timer: any, changes: Array }>} */
  #pending = new Map();

  // ── Public API ─────────────────────────────────────────────────

  /**
   * Whether the FileSystemObserver API is available in this environment.
   * @returns {boolean}
   */
  get available() {
    return 'FileSystemObserver' in globalThis;
  }

  /**
   * List of currently watched paths.
   * @returns {string[]}
   */
  get watchedPaths() {
    return [...this.#watches.keys()];
  }

  /**
   * Check if a specific path is being watched.
   * @param {string} path
   * @returns {boolean}
   */
  isWatching(path) {
    return this.#watches.has(path);
  }

  /**
   * Start watching a mount path for filesystem changes.
   * If FileSystemObserver is unavailable, the path is tracked but not actively observed.
   * @param {string} path - Mount path (e.g. '/mnt/myapp')
   * @param {FileSystemDirectoryHandle} [handle] - Optional handle to observe
   */
  watchMount(path, handle = null) {
    if (this.#watches.has(path)) return;

    let observer = null;
    if (this.available && handle) {
      try {
        observer = new FileSystemObserver((records) => {
          const changes = records.map(r => ({
            type: r.type || 'modified',
            name: r.relativePathComponents?.[0] || r.name || '',
          }));
          this._notifyChange(path, changes);
        });
        observer.observe(handle);
      } catch {
        observer = null; // Graceful fallback
      }
    }

    this.#watches.set(path, { handle, observer });
  }

  /**
   * Stop watching a mount path.
   * @param {string} path
   * @returns {boolean} True if the path was being watched
   */
  unwatchMount(path) {
    const entry = this.#watches.get(path);
    if (!entry) return false;

    if (entry.observer && typeof entry.observer.disconnect === 'function') {
      entry.observer.disconnect();
    }

    this.#watches.delete(path);
    this.#clearPending(path);
    return true;
  }

  /**
   * Stop watching all paths and clean up.
   */
  destroy() {
    for (const path of [...this.#watches.keys()]) {
      this.unwatchMount(path);
    }
    for (const [, pending] of this.#pending) {
      clearTimeout(pending.timer);
    }
    this.#pending.clear();
  }

  // ── Change notification (debounced) ────────────────────────────

  /**
   * Queue a change notification for debouncing.
   * After 500ms of quiet, dispatches a 'mount:changed' CustomEvent.
   * @param {string} path
   * @param {Array<{type: string, name: string}>} changes
   */
  _notifyChange(path, changes) {
    let pending = this.#pending.get(path);
    if (pending) {
      clearTimeout(pending.timer);
      pending.changes.push(...changes);
    } else {
      pending = { timer: null, changes: [...changes] };
      this.#pending.set(path, pending);
    }

    pending.timer = setTimeout(() => {
      const collected = pending.changes.slice();
      this.#pending.delete(path);
      this.dispatchEvent(new CustomEvent('mount:changed', {
        detail: { path, changes: collected },
      }));
    }, DEBOUNCE_MS);
  }

  // ── Internal helpers ───────────────────────────────────────────

  #clearPending(path) {
    const pending = this.#pending.get(path);
    if (pending) {
      clearTimeout(pending.timer);
      this.#pending.delete(path);
    }
  }
}
