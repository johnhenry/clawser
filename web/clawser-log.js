/**
 * Clawser Log — Unified logging facade
 *
 * Pluggable backends for consistent logging across the app.
 * Provides debug/info/warn/error methods with module tagging.
 */

// ── Log levels ──────────────────────────────────────────────────

export const LogLevel = Object.freeze({
  DEBUG: 0,
  INFO: 1,
  WARN: 2,
  ERROR: 3,
});

// ── Backend adapters ────────────────────────────────────────────

/** Console backend — writes to console.debug/info/warn/error */
export class ConsoleBackend {
  write(level, module, msg, data) {
    const fn = level === LogLevel.DEBUG ? 'debug'
      : level === LogLevel.INFO ? 'info'
      : level === LogLevel.WARN ? 'warn'
      : 'error';
    if (data !== undefined) {
      console[fn](`[${module}]`, msg, data);
    } else {
      console[fn](`[${module}]`, msg);
    }
  }
}

/** Callback backend — wraps an (level, msg) => void callback */
export class CallbackBackend {
  #cb;
  constructor(cb) { this.#cb = cb; }
  write(level, module, msg, _data) {
    this.#cb(level, `[${module}] ${msg}`);
  }
}

/** EventLog backend — appends to an EventLog instance */
export class EventLogBackend {
  #eventLog;
  constructor(eventLog) { this.#eventLog = eventLog; }
  write(level, module, msg, data) {
    if (!this.#eventLog) return;
    this.#eventLog.append('log', { level, module, message: msg, data }, 'system');
  }
}

// ── LogFacade ───────────────────────────────────────────────────

/**
 * Unified logging facade with pluggable backends.
 */
export class LogFacade {
  /** @type {Array<{backend: object, minLevel: number}>} */
  #backends = [];

  /** @type {number} */
  #minLevel;

  /**
   * @param {object} [opts]
   * @param {number} [opts.minLevel=0] - Minimum log level (LogLevel.DEBUG by default)
   */
  constructor(opts = {}) {
    this.#minLevel = opts.minLevel ?? LogLevel.DEBUG;
  }

  /**
   * Add a backend.
   * @param {object} backend - Must have a write(level, module, msg, data) method
   * @param {number} [minLevel] - Override minimum level for this backend
   */
  addBackend(backend, minLevel) {
    this.#backends.push({ backend, minLevel: minLevel ?? this.#minLevel });
  }

  /**
   * Remove a backend.
   * @param {object} backend
   */
  removeBackend(backend) {
    this.#backends = this.#backends.filter(b => b.backend !== backend);
  }

  /**
   * Set global minimum log level.
   * @param {number} level
   */
  set minLevel(level) { this.#minLevel = level; }
  get minLevel() { return this.#minLevel; }

  /**
   * Log a message.
   * @param {number} level
   * @param {string} module
   * @param {string} msg
   * @param {*} [data]
   */
  log(level, module, msg, data) {
    if (level < this.#minLevel) return;
    for (const { backend, minLevel } of this.#backends) {
      if (level >= minLevel) {
        try { backend.write(level, module, msg, data); } catch { /* best-effort */ }
      }
    }
  }

  /** Log debug message. */
  debug(module, msg, data) { this.log(LogLevel.DEBUG, module, msg, data); }

  /** Log info message. */
  info(module, msg, data) { this.log(LogLevel.INFO, module, msg, data); }

  /** Log warning message. */
  warn(module, msg, data) { this.log(LogLevel.WARN, module, msg, data); }

  /** Log error message. */
  error(module, msg, data) { this.log(LogLevel.ERROR, module, msg, data); }

  /**
   * Create an (level, msg) => void callback adapter for a given module.
   * Compatible with existing onLog callbacks used throughout the codebase.
   * @param {string} module
   * @returns {(level: number, msg: string) => void}
   */
  asCallback(module) {
    return (level, msg) => this.log(level, module, msg);
  }
}
