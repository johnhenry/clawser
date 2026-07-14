/**
 * clawser-background-runner.js — Background scheduler runner
 *
 * Loads checkpoint + routine state from IndexedDB, finds due routines,
 * executes them, and saves results. Shared by:
 *   - Extension background.js (chrome.alarms, Tier 1)
 *   - Service worker (periodicSync, Tier 3)
 *
 * Tier 2 (tab open) uses RoutineEngine's own setInterval ticker directly.
 */

import { CheckpointIndexedDB } from './clawser-checkpoint-idb.js';

const ROUTINE_STATE_KEY = 'background_routine_state';
const EXECUTION_LOG_KEY = 'background_execution_log';

/** Consecutive failures before a routine is skipped rather than retried. */
const MAX_CONSECUTIVE_FAILURES = 3;

const CRON_FIELD_RANGES = [
  ['minute', 0, 59],
  ['hour', 0, 23],
  ['day-of-month', 1, 31],
  ['month', 1, 12],
  ['day-of-week', 0, 6],
];

/**
 * Validate one field of a 5-field cron expression against its range.
 * @param {string} pattern
 * @param {number} min
 * @param {number} max
 * @returns {string|null} Error description, or null if valid
 */
function validateCronField(pattern, min, max) {
  if (pattern === '*') return null;
  if (pattern.startsWith('*/')) {
    const step = parseInt(pattern.slice(2), 10);
    return step > 0 ? null : `invalid step "${pattern}"`;
  }
  for (const v of pattern.split(',')) {
    if (v.includes('-')) {
      const [a, b] = v.split('-').map(Number);
      if (Number.isNaN(a) || Number.isNaN(b) || a > b || a < min || b > max) {
        return `invalid range "${v}" (expected ${min}-${max})`;
      }
    } else {
      const n = parseInt(v, 10);
      if (Number.isNaN(n) || n < min || n > max) {
        return `invalid value "${v}" (expected ${min}-${max})`;
      }
    }
  }
  return null;
}

/**
 * Validate a 5-field cron expression: field count and per-field ranges.
 * Without this, a malformed expression (wrong field count, out-of-range
 * values) silently never matches — indistinguishable from "not due yet".
 *
 * @param {string} expr
 * @returns {string|null} Error description, or null if valid
 */
export function validateCronExpression(expr) {
  if (typeof expr !== 'string' || !expr.trim()) return 'cron expression must be a non-empty string';
  const parts = expr.trim().split(/\s+/);
  if (parts.length !== 5) return `expected 5 fields, got ${parts.length}`;
  for (let i = 0; i < 5; i++) {
    const [name, min, max] = CRON_FIELD_RANGES[i];
    const err = validateCronField(parts[i], min, max);
    if (err) return `${name} field: ${err}`;
  }
  return null;
}

export class BackgroundSchedulerRunner {
  #idb;
  #executeFn;
  #onLog;

  /**
   * @param {object} [opts]
   * @param {CheckpointIndexedDB} [opts.idb] - IndexedDB storage (default: new instance)
   * @param {(routine: object) => Promise<any>} [opts.executeFn] - Execute a routine's action
   * @param {(msg: string) => void} [opts.onLog]
   */
  constructor(opts = {}) {
    this.#idb = opts.idb || new CheckpointIndexedDB();
    this.#executeFn = opts.executeFn || (async () => ({ success: true }));
    this.#onLog = opts.onLog || (() => {});
  }

  /**
   * Load saved routine state from IndexedDB.
   * @returns {Promise<object[]>} Array of routine objects
   */
  async loadRoutines() {
    const data = await this.#idb.read(ROUTINE_STATE_KEY);
    return Array.isArray(data) ? data : [];
  }

  /**
   * Save routine state to IndexedDB.
   * @param {object[]} routines
   */
  async saveRoutines(routines) {
    await this.#idb.write(ROUTINE_STATE_KEY, routines);
  }

  /**
   * Find routines that are due for execution.
   * @param {object[]} routines
   * @param {number} [nowMs=Date.now()]
   * @returns {object[]} Due routines
   */
  findDueRoutines(routines, nowMs = Date.now()) {
    const due = [];
    const nowDate = new Date(nowMs);

    for (const r of routines) {
      if (!r.enabled) continue;

      // Cron check
      if (r.trigger?.type === 'cron' && r.trigger?.cron) {
        const lastMinute = r.state?.lastCronMinute || 0;
        const thisMinute = Math.floor(nowMs / 60000);
        if (thisMinute > lastMinute && this.#cronMatches(r.trigger.cron, nowDate)) {
          due.push(r);
          continue;
        }
      }

      // Interval check (via meta) — only for agent-originated routines
      if (r.meta?.scheduleType === 'interval' && r.meta?.source === 'agent') {
        const lastFired = r.meta.lastFired || 0;
        if (nowMs >= lastFired + (r.meta.intervalMs || 60000)) {
          due.push(r);
          continue;
        }
      }

      // Once check (via meta) — only for agent-originated routines
      if (r.meta?.scheduleType === 'once' && !r.meta.fired && r.meta?.source === 'agent') {
        if (nowMs >= (r.meta.fireAt || 0)) {
          due.push(r);
          continue;
        }
      }
    }

    return due;
  }

  /**
   * Execute due routines and log results.
   * @param {number} [nowMs=Date.now()]
   * @returns {Promise<{executed: number, results: Array<{routineId: string, result: string}>}>}
   */
  async run(nowMs = Date.now()) {
    const routines = await this.loadRoutines();
    if (routines.length === 0) {
      this.#onLog('No routines to check');
      return { executed: 0, results: [], skipped: [] };
    }

    // Cron validation: an invalid expression would otherwise just never
    // match, indistinguishable from "not due yet". Log once (not every
    // tick) and exclude from due-checking until the cron is corrected.
    const validRoutines = [];
    for (const r of routines) {
      if (r.trigger?.type === 'cron') {
        const err = validateCronExpression(r.trigger?.cron);
        if (err) {
          if (!r.state?.cronInvalidLogged) {
            r.state = r.state || {};
            r.state.cronInvalidLogged = true;
            this.#onLog(`Invalid cron for "${r.name || r.id}" — ${err}. This routine will not fire until corrected.`);
          }
          continue;
        }
      }
      validRoutines.push(r);
    }

    const due = this.findDueRoutines(validRoutines, nowMs);
    const results = [];
    const skipped = [];

    for (const routine of due) {
      const failures = routine.state?.consecutiveFailures || 0;
      if (failures >= MAX_CONSECUTIVE_FAILURES) {
        skipped.push({ routineId: routine.id, reason: 'previous failure' });
        this.#onLog(`Skipped (previous failure): ${routine.name || routine.id} — ${failures} consecutive failures; needs manual re-enable`);
        continue;
      }

      try {
        await this.#executeFn(routine);

        // Update routine state
        routine.state = routine.state || {};
        routine.state.lastRun = nowMs;
        routine.state.lastResult = 'success';
        routine.state.runCount = (routine.state.runCount || 0) + 1;
        routine.state.consecutiveFailures = 0;
        if (routine.trigger?.type === 'cron') {
          routine.state.lastCronMinute = Math.floor(nowMs / 60000);
        }
        if (routine.meta?.scheduleType === 'interval') {
          routine.meta.lastFired = nowMs;
        }
        if (routine.meta?.scheduleType === 'once') {
          routine.meta.fired = true;
        }

        results.push({ routineId: routine.id, result: 'success' });
        this.#onLog(`Background executed: ${routine.name || routine.id}`);
      } catch (err) {
        routine.state = routine.state || {};
        routine.state.lastRun = nowMs;
        routine.state.lastResult = 'failure';
        routine.state.consecutiveFailures = failures + 1;
        results.push({ routineId: routine.id, result: 'failure', error: err.message });
        this.#onLog(`Background failed: ${routine.name || routine.id} — ${err.message}`);
      }
    }

    // Persist updated routine state
    await this.saveRoutines(routines);

    // Append to execution log (for "while you were away" summary)
    await this.#appendLog(results, nowMs, skipped);

    return { executed: results.length, results, skipped };
  }

  /**
   * Read the background execution log.
   * @returns {Promise<Array<{timestamp: number, results: Array}>>}
   */
  async readLog() {
    const log = await this.#idb.read(EXECUTION_LOG_KEY);
    return Array.isArray(log) ? log : [];
  }

  /**
   * Clear the background execution log (e.g., after showing "while you were away").
   */
  async clearLog() {
    await this.#idb.delete(EXECUTION_LOG_KEY);
  }

  async #appendLog(results, nowMs, skipped = []) {
    if (results.length === 0 && skipped.length === 0) return;
    const log = await this.readLog();
    log.push({ timestamp: nowMs, results, skipped });
    // Keep last 100 entries
    while (log.length > 100) log.shift();
    await this.#idb.write(EXECUTION_LOG_KEY, log);
  }

  /**
   * Simple cron expression matching.
   * @param {string} expr - 5-field cron expression
   * @param {Date} date
   * @returns {boolean}
   */
  #cronMatches(expr, date) {
    const parts = expr.trim().split(/\s+/);
    if (parts.length < 5) return false;
    const fields = [
      date.getMinutes(),
      date.getHours(),
      date.getDate(),
      date.getMonth() + 1,
      date.getDay(),
    ];
    for (let i = 0; i < 5; i++) {
      if (!this.#fieldMatches(parts[i], fields[i])) return false;
    }
    return true;
  }

  #fieldMatches(pattern, value) {
    if (pattern === '*') return true;
    if (pattern.startsWith('*/')) {
      const step = parseInt(pattern.slice(2));
      return step > 0 && value % step === 0;
    }
    for (const v of pattern.split(',')) {
      if (v.includes('-')) {
        const [a, b] = v.split('-').map(Number);
        if (value >= a && value <= b) return true;
      } else if (parseInt(v) === value) return true;
    }
    return false;
  }
}
