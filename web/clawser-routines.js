// clawser-routines.js — Routines Engine (Event-Driven Automation)
//
// createRoutine: factory for routine definitions
// matchFilter: event payload filter matching
// RoutineEngine: cron + event + webhook triggers with guardrails
// Agent tools: routine_create, routine_list, routine_delete, routine_run

import { BrowserTool } from './clawser-tools.js';
import { silentCatch } from './clawser-silent-catch.mjs'

// ── Constants ───────────────────────────────────────────────────

export const TRIGGER_TYPES = Object.freeze({
  CRON: 'cron',
  EVENT: 'event',
  WEBHOOK: 'webhook',
});

export const ACTION_TYPES = Object.freeze({
  PROMPT: 'prompt',
  TOOL: 'tool',
  CHAIN: 'chain',
});

export const DEFAULT_GUARDRAILS = Object.freeze({
  maxRunsPerHour: 3,
  maxCostPerRun: 0.50,
  timeoutMs: 300_000,
  requireApproval: false,
  notifyOnFailure: true,
  notifyOnSuccess: false,
  retryOnFailure: 1,
});

export const AUTO_DISABLE_THRESHOLD = 5;

let routineCounter = 0;

/** Reset counter (for testing). */
export function resetRoutineCounter() {
  routineCounter = 0;
}

// ── Routine Factory ─────────────────────────────────────────────

/**
 * Create a routine definition.
 * @param {object} opts
 * @returns {object}
 */
export function createRoutine(opts = {}) {
  return {
    id: opts.id || `routine_${++routineCounter}`,
    name: opts.name || 'Unnamed routine',
    enabled: opts.enabled !== false,
    trigger: {
      type: opts.trigger?.type || TRIGGER_TYPES.CRON,
      cron: opts.trigger?.cron || null,
      timezone: opts.trigger?.timezone || null,
      event: opts.trigger?.event || null,
      filter: opts.trigger?.filter || null,
      webhookPath: opts.trigger?.webhookPath || null,
      hmacSecret: opts.trigger?.hmacSecret || null,
    },
    jitterMs: opts.jitterMs ?? 0,
    action: {
      type: opts.action?.type || ACTION_TYPES.PROMPT,
      prompt: opts.action?.prompt || null,
      command: opts.action?.command || null,
      tool: opts.action?.tool || null,
      args: opts.action?.args || null,
      steps: opts.action?.steps || null,
      target: opts.action?.target || null,
      intent: opts.action?.intent || null,
      operation: opts.action?.operation || null,
      path: opts.action?.path || null,
      data: opts.action?.data || null,
      constraints: opts.action?.constraints || null,
    },
    guardrails: {
      ...DEFAULT_GUARDRAILS,
      ...(opts.guardrails || {}),
    },
    state: {
      lastRun: null,
      lastResult: null,
      runCount: 0,
      consecutiveFailures: 0,
      runsThisHour: 0,
      hourStart: null,
      history: [],
      ...(opts.state || {}),
    },
    meta: opts.meta || null,
  };
}

// ── Filter Matching ─────────────────────────────────────────────

/**
 * Match an event payload against a filter object.
 * Each key in filter must exist in payload and match (string equality or glob).
 * @param {object} filter
 * @param {object} payload
 * @returns {boolean}
 */
export function matchFilter(filter, payload) {
  if (!filter || !payload) return true;
  for (const [key, pattern] of Object.entries(filter)) {
    const value = payload[key];
    if (value === undefined) return false;
    if (typeof pattern === 'string' && pattern.includes('*')) {
      // Glob-like matching
      const re = new RegExp('^' + pattern.replace(/\*/g, '.*') + '$');
      if (!re.test(String(value))) return false;
    } else if (value !== pattern) {
      return false;
    }
  }
  return true;
}

// ── HMAC Verification ───────────────────────────────────────────

/**
 * Verify an HMAC-SHA256 signature.
 * Supports both Web Crypto (browser) and Node.js crypto.
 * @param {string} secret
 * @param {string} body - Raw request body string
 * @param {string} signature - e.g. "sha256=<hex>"
 * @returns {Promise<boolean>}
 */
async function verifyHmac(secret, body, signature) {
  const prefix = 'sha256=';
  if (!signature.startsWith(prefix)) return false;
  const provided = signature.slice(prefix.length);

  // Prefer Node.js crypto (available in test env and server contexts)
  try {
    const { createHmac } = await import('node:crypto');
    const expected = createHmac('sha256', secret).update(body).digest('hex');
    return expected === provided;
  } catch {
    // Fallback: Web Crypto API (browser)
    const enc = new TextEncoder();
    const key = await crypto.subtle.importKey(
      'raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'],
    );
    const sig = await crypto.subtle.sign('HMAC', key, enc.encode(body));
    const expected = [...new Uint8Array(sig)].map(b => b.toString(16).padStart(2, '0')).join('');
    return expected === provided;
  }
}

// ── RoutineEngine ───────────────────────────────────────────────

/**
 * Manages routine lifecycle, cron ticking, event reactions, and guardrail enforcement.
 */
export class RoutineEngine {
  /** @type {Map<string, object>} */
  #routines = new Map();

  /** @type {any} Cron ticker interval */
  #cronTicker = null;

  /** @type {Function|null} */
  #executeFn;

  /** @type {Function|null} */
  #onNotify;

  /** @type {Function|null} */
  #onLog;

  /** @type {Function|null} */
  #onChange;

  /** @type {number} Cron tick interval in ms */
  #tickInterval;

  /** @type {boolean} */
  #running = false;

  /** @type {number|null} Timestamp of last cron tick (for catch-up) */
  #lastTickTime = null;

  /** @type {boolean} Whether to catch up missed executions on start */
  #catchUpMissed;

  /** @type {number} Max catch-up window in ms (default 24h) */
  #maxCatchUpMs;

  /** @type {Map<string, object>} Per-routine health metrics */
  #healthMetrics = new Map();

  /**
   * @param {object} [opts]
   * @param {Function} [opts.executeFn] - (routine, triggerEvent) => Promise<any>
   * @param {Function} [opts.onNotify] - (routine, message) => void
   * @param {Function} [opts.onLog] - (message) => void
   * @param {Function} [opts.onChange] - () => void — called after any routine CRUD mutation
   * @param {number} [opts.tickInterval=60000] - Cron check interval
   * @param {boolean} [opts.catchUpMissed=true] - Execute missed jobs on start
   * @param {number} [opts.maxCatchUpMs=86400000] - Max catch-up window (default 24h)
   */
  constructor(opts = {}) {
    this.#executeFn = opts.executeFn || null;
    this.#onNotify = opts.onNotify || null;
    this.#onLog = opts.onLog || null;
    this.#onChange = opts.onChange || null;
    this.#tickInterval = opts.tickInterval || 60_000;
    this.#catchUpMissed = opts.catchUpMissed !== false;
    this.#maxCatchUpMs = opts.maxCatchUpMs ?? 86_400_000;
  }

  /** Whether engine is running. */
  get running() { return this.#running; }

  /** Number of routines. */
  get routineCount() { return this.#routines.size; }

  // ── CRUD ──────────────────────────────────────────────

  /**
   * Add a routine.
   * @param {object} opts
   * @returns {object} The created routine
   */
  addRoutine(opts) {
    const routine = createRoutine(opts);
    this.#routines.set(routine.id, routine);
    this.#log(`Routine added: ${routine.id} (${routine.name})`);
    this.#emitChange();
    return routine;
  }

  /**
   * Get a routine by ID.
   * @param {string} id
   * @returns {object|undefined}
   */
  getRoutine(id) {
    return this.#routines.get(id);
  }

  /**
   * List all routines.
   * @returns {object[]}
   */
  listRoutines() {
    return [...this.#routines.values()];
  }

  /**
   * Update a routine's configuration.
   * @param {string} id
   * @param {object} updates - Fields to update (name, trigger, action, enabled, guardrails)
   * @returns {boolean}
   */
  updateRoutine(id, updates) {
    const routine = this.#routines.get(id);
    if (!routine) return false;
    for (const key of ['name', 'trigger', 'action', 'enabled', 'guardrails']) {
      if (updates[key] !== undefined) routine[key] = updates[key];
    }
    this.#log(`Routine updated: ${id}`);
    this.#emitChange();
    return true;
  }

  /**
   * Remove a routine.
   * @param {string} id
   * @returns {boolean}
   */
  removeRoutine(id) {
    const removed = this.#routines.delete(id);
    if (removed) {
      this.#log(`Routine removed: ${id}`);
      this.#emitChange();
    }
    return removed;
  }

  /**
   * Enable or disable a routine.
   * @param {string} id
   * @param {boolean} enabled
   * @returns {boolean}
   */
  setEnabled(id, enabled) {
    const routine = this.#routines.get(id);
    if (!routine) return false;
    routine.enabled = enabled;
    this.#emitChange();
    return true;
  }

  /**
   * Enable a routine.
   * @param {string} id
   * @returns {boolean}
   */
  enableRoutine(id) {
    return this.setEnabled(id, true);
  }

  /**
   * Disable a routine.
   * @param {string} id
   * @returns {boolean}
   */
  disableRoutine(id) {
    return this.setEnabled(id, false);
  }

  // ── Lifecycle ──────────────────────────────────────────

  /**
   * Start the engine (cron ticker).
   * If catchUpMissed is enabled and lastTickTime is set, catches up missed executions.
   * @returns {Promise<Array>} Catch-up results (empty if none)
   */
  async start() {
    if (this.#running) return [];
    this.#running = true;

    let catchUpResults = [];
    if (this.#catchUpMissed && this.#lastTickTime) {
      catchUpResults = await this.#catchUp();
    }

    this.#cronTicker = setInterval(() => this.#tickCron(), this.#tickInterval);
    this.#log('Routine engine started');
    return catchUpResults;
  }

  /**
   * Stop the engine.
   */
  stop() {
    if (this.#cronTicker) {
      clearInterval(this.#cronTicker);
      this.#cronTicker = null;
    }
    this.#running = false;
    this.#log('Routine engine stopped');
  }

  // ── Event Handling ────────────────────────────────────

  /**
   * Handle an incoming event. Checks all event-triggered routines.
   * @param {string} eventType
   * @param {object} [payload]
   * @returns {Promise<Array<{ routineId: string, result: string }>>}
   */
  async handleEvent(eventType, payload = {}) {
    const results = [];
    for (const routine of this.#routines.values()) {
      if (!routine.enabled) continue;
      if (routine.trigger.type !== TRIGGER_TYPES.EVENT) continue;
      if (routine.trigger.event !== eventType) continue;
      if (routine.trigger.filter && !matchFilter(routine.trigger.filter, payload)) continue;

      const result = await this.#enqueue(routine, { type: eventType, payload });
      results.push({ routineId: routine.id, result });
    }
    return results;
  }

  /**
   * Handle an incoming webhook. Checks all webhook-triggered routines.
   * @param {string} path
   * @param {object} [payload]
   * @param {object} [opts] - { signature?: string, rawBody?: string }
   * @returns {Promise<object|null>}
   */
  async handleWebhook(path, payload = {}, opts = {}) {
    for (const routine of this.#routines.values()) {
      if (!routine.enabled) continue;
      if (routine.trigger.type !== TRIGGER_TYPES.WEBHOOK) continue;
      if (routine.trigger.webhookPath !== path) continue;

      // HMAC signature verification
      if (routine.trigger.hmacSecret) {
        if (!opts.signature || !opts.rawBody) {
          return { routineId: routine.id, result: 'signature_invalid' };
        }
        const valid = await verifyHmac(routine.trigger.hmacSecret, opts.rawBody, opts.signature);
        if (!valid) {
          return { routineId: routine.id, result: 'signature_invalid' };
        }
      }

      const result = await this.#enqueue(routine, { type: 'webhook.received', payload });
      return { routineId: routine.id, result };
    }
    return null;
  }

  /**
   * Manually trigger a routine (bypass schedule).
   * Skips execution if the routine is disabled.
   * @param {string} id
   * @returns {Promise<string>}
   */
  async triggerManual(id) {
    const routine = this.#routines.get(id);
    if (!routine) throw new Error(`Routine not found: ${id}`);
    if (!routine.enabled) {
      this.#log(`Skipped disabled routine: ${routine.name}`);
      return 'skipped_disabled';
    }
    return this.#enqueue(routine, { type: 'manual.trigger' });
  }

  // ── Cron ──────────────────────────────────────────────

  /**
   * Tick cron: check all cron routines against current time.
   * Exposed for testing.
   * @param {Date} [now]
   * @returns {Promise<Array>}
   */
  async tickCron(now) {
    return this.#tickCron(now);
  }

  async #tickCron(now) {
    const time = now || new Date();
    const results = [];

    // Track tick time for catch-up
    this.#lastTickTime = time.getTime ? time.getTime() : Date.now();

    // Cron routines — each wrapped in its own try/catch for error isolation
    for (const routine of this.#routines.values()) {
      if (!routine.enabled) continue;
      if (routine.trigger.type !== TRIGGER_TYPES.CRON) continue;
      if (!routine.trigger.cron) continue;

      try {
        if (this.#cronMatchesTz(routine.trigger.cron, time, routine.trigger.timezone)) {
          // Apply jitter: skip this tick and defer if jitter hasn't elapsed
          if (routine.jitterMs > 0) {
            const jitterKey = `${routine.id}:jitter`;
            if (!routine._jitterTarget) {
              routine._jitterTarget = time.getTime() + Math.floor(Math.random() * routine.jitterMs);
            }
            if (time.getTime() < routine._jitterTarget) continue;
            routine._jitterTarget = null; // Reset for next match
          }

          const start = Date.now();
          const result = await this.#enqueue(routine, { type: 'cron.tick', time });
          this.#recordMetric(routine.id, result, Date.now() - start, time);
          results.push({ routineId: routine.id, result });
        }
      } catch (err) {
        this.#log(`Error ticking routine ${routine.id}: ${err.message}`);
        this.#recordMetric(routine.id, 'error', 0, time, err.message);
        results.push({ routineId: routine.id, result: 'error', error: err.message });
      }
    }

    // Interval and once routines — also with error isolation
    for (const routine of this.#routines.values()) {
      if (!routine.enabled) continue;
      if (!routine.meta?.source) continue;

      const nowMs = time.getTime ? time.getTime() : Date.now();

      try {
        if (routine.meta.scheduleType === 'once' && !routine.meta.fired && nowMs >= routine.meta.fireAt) {
          routine.meta.fired = true;
          const start = Date.now();
          const result = await this.#enqueue(routine, { type: 'once.fire', time });
          this.#recordMetric(routine.id, result, Date.now() - start, time);
          results.push({ routineId: routine.id, result });
        } else if (routine.meta.scheduleType === 'interval') {
          const lastFired = routine.meta.lastFired || 0;
          if (nowMs >= lastFired + routine.meta.intervalMs) {
            routine.meta.lastFired = nowMs;
            const start = Date.now();
            const result = await this.#enqueue(routine, { type: 'interval.fire', time });
            this.#recordMetric(routine.id, result, Date.now() - start, time);
            results.push({ routineId: routine.id, result });
          }
        }
      } catch (err) {
        this.#log(`Error ticking routine ${routine.id}: ${err.message}`);
        this.#recordMetric(routine.id, 'error', 0, time, err.message);
        results.push({ routineId: routine.id, result: 'error', error: err.message });
      }
    }

    return results;
  }

  // ── Missed Execution Catch-Up ──────────────────────────────

  /**
   * Check for missed cron executions between lastTickTime and now,
   * and run them. Only fires once per missed minute (not per missed tick).
   * @returns {Promise<Array>}
   */
  async #catchUp() {
    const now = Date.now();
    const since = this.#lastTickTime;
    if (!since || since >= now) return [];

    // Cap the catch-up window
    const start = Math.max(since, now - this.#maxCatchUpMs);
    const results = [];

    for (const routine of this.#routines.values()) {
      if (!routine.enabled) continue;
      if (routine.trigger.type !== TRIGGER_TYPES.CRON) continue;
      if (!routine.trigger.cron) continue;

      // Walk minute-by-minute from start to now and check for matches
      let missed = false;
      const stepMs = 60_000;
      for (let t = start; t < now; t += stepMs) {
        const d = new Date(t);
        if (this.#cronMatchesTz(routine.trigger.cron, d, routine.trigger.timezone)) {
          missed = true;
          break; // Only catch up once per routine, not per missed minute
        }
      }

      if (missed) {
        try {
          this.#log(`Catch-up: executing missed routine ${routine.id} (${routine.name})`);
          const startMs = Date.now();
          const result = await this.#enqueue(routine, { type: 'cron.catchup', time: new Date() });
          this.#recordMetric(routine.id, result, Date.now() - startMs, new Date());
          results.push({ routineId: routine.id, result, catchUp: true });
        } catch (err) {
          this.#log(`Catch-up error for ${routine.id}: ${err.message}`);
          results.push({ routineId: routine.id, result: 'error', error: err.message, catchUp: true });
        }
      }
    }

    return results;
  }

  /**
   * Get or set the last tick time (for persistence across reloads).
   * @param {number} [ts] - If provided, sets lastTickTime
   * @returns {number|null}
   */
  get lastTickTime() { return this.#lastTickTime; }
  set lastTickTime(ts) { this.#lastTickTime = ts; }

  // ── Timezone-Aware Cron Matching ──────────────────────────

  /**
   * Cron field matching with optional timezone support.
   * @param {string} expr - 5-field cron expression
   * @param {Date} date
   * @param {string|null} [timezone] - IANA timezone (e.g. 'America/New_York')
   * @returns {boolean}
   */
  #cronMatchesTz(expr, date, timezone) {
    const parts = expr.trim().split(/\s+/);
    if (parts.length < 5) return false;

    let minute, hour, day, month, dow;

    if (timezone) {
      const resolved = RoutineEngine.#resolveInTimezone(date, timezone);
      minute = resolved.minute;
      hour = resolved.hour;
      day = resolved.day;
      month = resolved.month;
      dow = resolved.dow;
    } else {
      minute = date.getMinutes();
      hour = date.getHours();
      day = date.getDate();
      month = date.getMonth() + 1;
      dow = date.getDay();
    }

    const fields = [minute, hour, day, month, dow];
    for (let i = 0; i < 5; i++) {
      if (!RoutineEngine.#fieldMatches(parts[i], fields[i])) return false;
    }
    return true;
  }

  /**
   * Resolve date components in a specific IANA timezone.
   * @param {Date} date
   * @param {string} timezone
   * @returns {{ minute: number, hour: number, day: number, month: number, dow: number }}
   */
  static #resolveInTimezone(date, timezone) {
    // Use Intl.DateTimeFormat to extract parts in the target timezone
    const fmt = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
      hour: 'numeric',
      minute: 'numeric',
      weekday: 'short',
      hour12: false,
    });
    const parts = {};
    for (const { type, value } of fmt.formatToParts(date)) {
      parts[type] = value;
    }
    const dowMap = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
    return {
      minute: parseInt(parts.minute, 10),
      hour: parseInt(parts.hour, 10) % 24, // Intl can return 24 for midnight
      day: parseInt(parts.day, 10),
      month: parseInt(parts.month, 10),
      dow: dowMap[parts.weekday] ?? 0,
    };
  }

  /**
   * Expose timezone resolution for testing.
   * @param {Date} date
   * @param {string} timezone
   * @returns {{ minute: number, hour: number, day: number, month: number, dow: number }}
   */
  static resolveInTimezone(date, timezone) {
    return RoutineEngine.#resolveInTimezone(date, timezone);
  }

  static #fieldMatches(pattern, value) {
    if (pattern === '*') return true;

    // Step: */n
    if (pattern.startsWith('*/')) {
      const step = parseInt(pattern.slice(2));
      return step > 0 && value % step === 0;
    }

    // Comma-separated values
    const values = pattern.split(',');
    for (const v of values) {
      // Range: a-b
      if (v.includes('-')) {
        const [a, b] = v.split('-').map(Number);
        if (value >= a && value <= b) return true;
      } else {
        if (parseInt(v) === value) return true;
      }
    }
    return false;
  }

  // Keep instance-level alias for backward compat within this class
  #cronMatches(expr, date) {
    return this.#cronMatchesTz(expr, date, null);
  }

  // ── Health Metrics ──────────────────────────────────────────

  /**
   * Record a metric for a routine execution.
   * @param {string} routineId
   * @param {string} result
   * @param {number} durationMs
   * @param {Date} time
   * @param {string} [error]
   */
  #recordMetric(routineId, result, durationMs, time, error) {
    let m = this.#healthMetrics.get(routineId);
    if (!m) {
      m = { successCount: 0, failureCount: 0, errorCount: 0, totalDurationMs: 0, lastRunTime: null, lastResult: null, lastError: null };
      this.#healthMetrics.set(routineId, m);
    }
    if (result === 'success') m.successCount++;
    else if (result === 'failure') m.failureCount++;
    else if (result === 'error') m.errorCount++;
    m.totalDurationMs += durationMs;
    m.lastRunTime = time.getTime ? time.getTime() : time;
    m.lastResult = result;
    if (error) m.lastError = error;
  }

  /**
   * Get health metrics for a specific routine.
   * @param {string} routineId
   * @returns {object|null}
   */
  getRoutineHealth(routineId) {
    const routine = this.#routines.get(routineId);
    if (!routine) return null;
    const m = this.#healthMetrics.get(routineId) || {
      successCount: 0, failureCount: 0, errorCount: 0,
      totalDurationMs: 0, lastRunTime: null, lastResult: null, lastError: null,
    };
    const totalRuns = m.successCount + m.failureCount + m.errorCount;
    return {
      routineId,
      routineName: routine.name,
      enabled: routine.enabled,
      successCount: m.successCount,
      failureCount: m.failureCount,
      errorCount: m.errorCount,
      totalRuns,
      avgDurationMs: totalRuns > 0 ? Math.round(m.totalDurationMs / totalRuns) : 0,
      lastRunTime: m.lastRunTime,
      lastResult: m.lastResult,
      lastError: m.lastError,
      nextFireTime: RoutineEngine.nextFireTime(routine),
    };
  }

  /**
   * Get health metrics for all routines.
   * @returns {object[]}
   */
  getAllHealth() {
    const results = [];
    for (const id of this.#routines.keys()) {
      results.push(this.getRoutineHealth(id));
    }
    return results;
  }

  // ── Execution with Guardrails ─────────────────────────

  async #enqueue(routine, triggerEvent) {
    // Rate limit check
    this.#resetHourlyCountIfNeeded(routine);
    if (routine.state.runsThisHour >= routine.guardrails.maxRunsPerHour) {
      this.#log(`Rate limited: ${routine.name}`);
      return 'rate_limited';
    }

    try {
      let result;
      if (this.#executeFn) {
        result = await this.#executeFn(routine, triggerEvent);
      }

      routine.state.lastRun = Date.now();
      routine.state.lastResult = 'success';
      routine.state.runCount++;
      routine.state.runsThisHour++;
      routine.state.consecutiveFailures = 0;
      routine.state.history.push({
        timestamp: routine.state.lastRun,
        result: 'success',
        trigger: triggerEvent.type,
      });

      // Trim history
      if (routine.state.history.length > 50) {
        routine.state.history = routine.state.history.slice(-50);
      }

      if (routine.guardrails.notifyOnSuccess && this.#onNotify) {
        this.#onNotify(routine, `Routine succeeded: ${routine.name}`);
      }

      return 'success';
    } catch (err) {
      routine.state.lastRun = Date.now();
      routine.state.lastResult = 'failure';
      routine.state.runCount++;
      routine.state.runsThisHour++;
      routine.state.consecutiveFailures++;
      routine.state.history.push({
        timestamp: routine.state.lastRun,
        result: 'failure',
        error: err.message,
        trigger: triggerEvent.type,
      });

      if (routine.guardrails.notifyOnFailure && this.#onNotify) {
        this.#onNotify(routine, `Routine failed: ${routine.name} — ${err.message}`);
      }

      // Auto-disable after threshold
      if (routine.state.consecutiveFailures >= AUTO_DISABLE_THRESHOLD) {
        routine.enabled = false;
        this.#log(`Auto-disabled: ${routine.name} (${AUTO_DISABLE_THRESHOLD} consecutive failures)`);
        if (this.#onNotify) {
          this.#onNotify(routine, `Routine auto-disabled: ${routine.name}`);
        }
        this.#emitChange();
      }

      return 'failure';
    }
  }

  #resetHourlyCountIfNeeded(routine) {
    const now = Date.now();
    if (!routine.state.hourStart || now - routine.state.hourStart >= 3_600_000) {
      routine.state.runsThisHour = 0;
      routine.state.hourStart = now;
    }
  }

  // ── Event Bus Integration ────────────────────────────────

  /** @type {EventTarget|null} */
  #eventBus = null;

  /** @type {Function|null} bound handler for removeEventListener */
  #eventBusHandler = null;

  /** @type {Set<string>} event types we're subscribed to */
  #subscribedEvents = new Set();

  /**
   * Connect to an EventTarget-based event bus.
   * Subscribes to all event types used by EVENT-triggered routines.
   * @param {EventTarget} bus
   */
  connectEventBus(bus) {
    this.disconnectEventBus(); // clear previous
    this.#eventBus = bus;
    this.#eventBusHandler = (e) => {
      this.handleEvent(e.type, e.detail || {});
    };

    // Subscribe to all event types from current routines
    for (const routine of this.#routines.values()) {
      if (routine.trigger.type === TRIGGER_TYPES.EVENT && routine.trigger.event) {
        if (!this.#subscribedEvents.has(routine.trigger.event)) {
          this.#subscribedEvents.add(routine.trigger.event);
          bus.addEventListener(routine.trigger.event, this.#eventBusHandler);
        }
      }
    }
  }

  /**
   * Disconnect from the event bus.
   */
  disconnectEventBus() {
    if (this.#eventBus && this.#eventBusHandler) {
      for (const eventType of this.#subscribedEvents) {
        this.#eventBus.removeEventListener(eventType, this.#eventBusHandler);
      }
    }
    this.#eventBus = null;
    this.#eventBusHandler = null;
    this.#subscribedEvents.clear();
  }

  /**
   * Serialize all routines and engine state for persistence.
   * @returns {{ routines: object[], lastTickTime: number|null, healthMetrics: object }}
   */
  toJSON() {
    const healthObj = {};
    for (const [id, m] of this.#healthMetrics) {
      healthObj[id] = { ...m };
    }
    return {
      routines: this.listRoutines(),
      lastTickTime: this.#lastTickTime,
      healthMetrics: healthObj,
    };
  }

  /**
   * Load routines from serialized data.
   * Accepts both legacy array format and new object format.
   * @param {object[]|object} data
   */
  fromJSON(data) {
    this.#routines.clear();
    this.#healthMetrics.clear();

    // Support both legacy array and new object format
    const routines = Array.isArray(data) ? data : (data.routines || []);
    for (const r of routines) {
      this.#routines.set(r.id, r);
    }

    if (!Array.isArray(data)) {
      if (data.lastTickTime) this.#lastTickTime = data.lastTickTime;
      if (data.healthMetrics) {
        for (const [id, m] of Object.entries(data.healthMetrics)) {
          this.#healthMetrics.set(id, { ...m });
        }
      }
    }

    this.#emitChange();
  }

  /**
   * Compute next fire time for a routine.
   * @param {object} routine
   * @returns {number|null} Timestamp of next fire, or null if unknown
   */
  static nextFireTime(routine) {
    if (routine.meta?.scheduleType === 'once') {
      return routine.meta.fired ? null : routine.meta.fireAt;
    }
    if (routine.meta?.scheduleType === 'interval') {
      return (routine.meta.lastFired || 0) + routine.meta.intervalMs;
    }
    // For cron routines, we can't easily compute without parsing
    return null;
  }

  #log(msg) {
    if (this.#onLog) this.#onLog(msg);
  }

  #notify(routine, message) {
    if (this.#onNotify) this.#onNotify(routine, message);
  }

  #emitChange() {
    if (this.#onChange) {
      try { this.#onChange(); } catch (e) { silentCatch('clawser-routines', 'this', e) }
    }
  }
}

// ── Agent Tools ─────────────────────────────────────────────────

export class RoutineCreateTool extends BrowserTool {
  #engine;

  constructor(engine) {
    super();
    this.#engine = engine;
  }

  get name() { return 'routine_create'; }
  get description() { return 'Create a new routine (trigger + action + guardrails).'; }
  get parameters() {
    return {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Routine name' },
        trigger_type: { type: 'string', description: 'Trigger type: cron, event, or webhook' },
        cron: { type: 'string', description: 'Cron expression (for cron trigger)' },
        event: { type: 'string', description: 'Event name (for event trigger)' },
        prompt: { type: 'string', description: 'Prompt to run (for prompt action)' },
        max_runs_per_hour: { type: 'number', description: 'Rate limit (default 3)' },
      },
      required: ['name'],
    };
  }
  get permission() { return 'approve'; }

  async execute({ name, trigger_type, cron, event, prompt, max_runs_per_hour }) {
    const routine = this.#engine.addRoutine({
      name,
      trigger: {
        type: trigger_type || TRIGGER_TYPES.CRON,
        cron: cron || null,
        event: event || null,
      },
      action: {
        type: ACTION_TYPES.PROMPT,
        prompt: prompt || name,
      },
      guardrails: max_runs_per_hour != null ? { maxRunsPerHour: max_runs_per_hour } : {},
    });
    return { success: true, output: `Created routine: ${routine.id} (${routine.name})` };
  }
}

export class RoutineListTool extends BrowserTool {
  #engine;

  constructor(engine) {
    super();
    this.#engine = engine;
  }

  get name() { return 'routine_list'; }
  get description() { return 'List all routines with status.'; }
  get parameters() { return { type: 'object', properties: {} }; }
  get permission() { return 'read'; }

  async execute() {
    const routines = this.#engine.listRoutines();
    if (routines.length === 0) {
      return { success: true, output: 'No routines configured.' };
    }
    const lines = routines.map(r => {
      const trigger = r.trigger.type === 'cron' ? `cron(${r.trigger.cron})`
        : r.trigger.type === 'event' ? `event(${r.trigger.event})`
        : `webhook(${r.trigger.webhookPath})`;
      const status = r.enabled ? 'enabled' : 'DISABLED';
      const last = r.state.lastResult || 'never run';
      return `${r.id} | ${r.name} | ${trigger} | ${status} | ${last} | runs: ${r.state.runCount}`;
    });
    return { success: true, output: `Routines (${routines.length}):\n${lines.join('\n')}` };
  }
}

export class RoutineDeleteTool extends BrowserTool {
  #engine;

  constructor(engine) {
    super();
    this.#engine = engine;
  }

  get name() { return 'routine_delete'; }
  get description() { return 'Remove a routine.'; }
  get parameters() {
    return {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'Routine ID to remove' },
      },
      required: ['id'],
    };
  }
  get permission() { return 'approve'; }

  async execute({ id }) {
    if (this.#engine.removeRoutine(id)) {
      return { success: true, output: `Removed routine: ${id}` };
    }
    return { success: false, output: '', error: `Routine not found: ${id}` };
  }
}

export class RoutineHistoryTool extends BrowserTool {
  #engine;

  constructor(engine) {
    super();
    this.#engine = engine;
  }

  get name() { return 'routine_history'; }
  get description() { return 'Get execution history for a routine.'; }
  get parameters() {
    return {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'Routine ID' },
        limit: { type: 'number', description: 'Max entries to return (default 20)' },
      },
      required: ['id'],
    };
  }
  get permission() { return 'read'; }

  async execute({ id, limit }) {
    const routine = this.#engine.getRoutine(id);
    if (!routine) {
      return { success: false, output: '', error: `Routine not found: ${id}` };
    }

    const max = limit || 20;
    const entries = routine.state.history.slice(-max);
    if (entries.length === 0) {
      return { success: true, output: `${routine.name}: No execution history.` };
    }

    const lines = entries.map((e, i) => {
      const ts = new Date(e.timestamp).toISOString();
      const err = e.error ? ` — ${e.error}` : '';
      return `${i + 1}. [${ts}] ${e.result} (${e.trigger})${err}`;
    });
    return {
      success: true,
      output: `${routine.name} — ${entries.length} entries:\n${lines.join('\n')}`,
    };
  }
}

export class RoutineRunTool extends BrowserTool {
  #engine;

  constructor(engine) {
    super();
    this.#engine = engine;
  }

  get name() { return 'routine_run'; }
  get description() { return 'Manually trigger a routine (bypass schedule).'; }
  get parameters() {
    return {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'Routine ID to run' },
      },
      required: ['id'],
    };
  }
  get permission() { return 'approve'; }

  async execute({ id }) {
    try {
      const result = await this.#engine.triggerManual(id);
      return { success: true, output: `Routine ${id}: ${result}` };
    } catch (e) {
      return { success: false, output: '', error: e.message };
    }
  }
}

export class RoutineToggleTool extends BrowserTool {
  #engine;

  constructor(engine) {
    super();
    this.#engine = engine;
  }

  get name() { return 'routine_toggle'; }
  get description() { return 'Enable or disable a routine.'; }
  get parameters() {
    return {
      type: 'object',
      properties: {
        routine_id: { type: 'string', description: 'Routine ID to toggle' },
        enabled: { type: 'boolean', description: 'Whether to enable (true) or disable (false)' },
      },
      required: ['routine_id', 'enabled'],
    };
  }
  get permission() { return 'approve'; }

  async execute({ routine_id, enabled }) {
    if (this.#engine.setEnabled(routine_id, enabled)) {
      const state = enabled ? 'enabled' : 'disabled';
      return { success: true, output: `Routine ${routine_id}: ${state}` };
    }
    return { success: false, output: '', error: `Routine not found: ${routine_id}` };
  }
}

export class RoutineUpdateTool extends BrowserTool {
  #engine;

  constructor(engine) {
    super();
    this.#engine = engine;
  }

  get name() { return 'routine_update'; }
  get description() { return 'Update a routine\'s configuration (name, trigger, action).'; }
  get parameters() {
    return {
      type: 'object',
      properties: {
        routine_id: { type: 'string', description: 'Routine ID to update' },
        name: { type: 'string', description: 'New routine name' },
        trigger: { type: 'object', description: 'New trigger configuration' },
        action: { type: 'object', description: 'New action configuration' },
      },
      required: ['routine_id'],
    };
  }
  get permission() { return 'approve'; }

  async execute({ routine_id, ...updates }) {
    if (this.#engine.updateRoutine(routine_id, updates)) {
      return { success: true, output: `Routine ${routine_id} updated` };
    }
    return { success: false, output: '', error: `Routine not found: ${routine_id}` };
  }
}
