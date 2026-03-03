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

      // Interval check (via meta)
      if (r.meta?.scheduleType === 'interval') {
        const lastFired = r.meta.lastFired || 0;
        if (nowMs >= lastFired + (r.meta.intervalMs || 60000)) {
          due.push(r);
          continue;
        }
      }

      // Once check (via meta)
      if (r.meta?.scheduleType === 'once' && !r.meta.fired) {
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
      return { executed: 0, results: [] };
    }

    const due = this.findDueRoutines(routines, nowMs);
    const results = [];

    for (const routine of due) {
      try {
        await this.#executeFn(routine);

        // Update routine state
        routine.state = routine.state || {};
        routine.state.lastRun = nowMs;
        routine.state.lastResult = 'success';
        routine.state.runCount = (routine.state.runCount || 0) + 1;
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
        results.push({ routineId: routine.id, result: 'failure', error: err.message });
        this.#onLog(`Background failed: ${routine.name || routine.id} — ${err.message}`);
      }
    }

    // Persist updated routine state
    await this.saveRoutines(routines);

    // Append to execution log (for "while you were away" summary)
    await this.#appendLog(results, nowMs);

    return { executed: results.length, results };
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

  async #appendLog(results, nowMs) {
    if (results.length === 0) return;
    const log = await this.readLog();
    log.push({ timestamp: nowMs, results });
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
