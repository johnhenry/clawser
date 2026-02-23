// clawser-heartbeat.js — Heartbeat Checklist
//
// parseChecklist: parses HEARTBEAT.md format into check items
// HeartbeatRunner: interval-based self-checks with silent-when-healthy alerting
// ALERT_STRATEGIES: log, inject, remediate
// Agent tools: heartbeat_status, heartbeat_run

import { BrowserTool } from './clawser-tools.js';

// ── Constants ───────────────────────────────────────────────────

export const INTERVAL_WAKE = 'wake';

export const DEFAULT_HEARTBEAT = `
## Every 5 minutes
- [ ] Context under 80% capacity
- [ ] No stuck scheduler jobs

## Every 30 minutes
- [ ] Cost under daily cap
- [ ] Storage under 90%

## On wake
- [ ] Provider reachable
`.trim();

// ── Checklist Parser ────────────────────────────────────────────

const INTERVAL_RE = /^##\s+Every\s+(\d+)\s+(minutes?|hours?)/i;
const WAKE_RE = /^##\s+On wake/i;
const CHECK_RE = /^-\s+\[[ x]\]\s+(.+?)(?:\s*→\s*`(.+?)`)?$/;

/**
 * Parse a HEARTBEAT.md checklist string into check items.
 * @param {string} md
 * @returns {Array<{ description: string, code: string|null, interval: number|'wake', lastRun: null, lastResult: null, consecutiveFailures: number }>}
 */
export function parseChecklist(md) {
  const checks = [];
  let currentInterval = null;

  for (const line of md.split('\n')) {
    const intervalMatch = INTERVAL_RE.exec(line);
    if (intervalMatch) {
      const n = parseInt(intervalMatch[1]);
      const unit = intervalMatch[2].startsWith('hour') ? 60 : 1;
      currentInterval = n * unit * 60_000;
      continue;
    }

    if (WAKE_RE.test(line)) {
      currentInterval = INTERVAL_WAKE;
      continue;
    }

    const checkMatch = CHECK_RE.exec(line);
    if (checkMatch && currentInterval !== null) {
      checks.push({
        description: checkMatch[1].trim(),
        code: checkMatch[2] || null,
        interval: currentInterval,
        lastRun: null,
        lastResult: null,
        consecutiveFailures: 0,
      });
    }
  }

  return checks;
}

// ── Alert Strategies ────────────────────────────────────────────

export const ALERT_STRATEGIES = Object.freeze({
  /**
   * Log failures to console.
   * @param {Array} failures
   */
  log(failures) {
    const msg = failures.map(f =>
      `HEARTBEAT FAIL: ${f.description}${f.error ? ` (${f.error})` : ''}`
    ).join('\n');
    console.warn(msg);
  },

  /**
   * Format failures as a message string.
   * @param {Array} failures
   * @returns {string}
   */
  format(failures) {
    return 'Heartbeat check detected issues:\n' +
      failures.map(f => `- ${f.description} (failed ${f.consecutiveFailures}x)`).join('\n');
  },
});

// ── HeartbeatRunner ─────────────────────────────────────────────

/**
 * Runs periodic health checks from a parsed checklist.
 * Silent when healthy — only reports failures.
 */
export class HeartbeatRunner {
  /** @type {Array} Parsed check items */
  #checks = [];

  /** @type {Map<number, any>} Interval timers by interval ms */
  #timers = new Map();

  /** @type {Function} Alert callback */
  #onAlert;

  /** @type {Function|null} Check evaluator */
  #evalFn;

  /** @type {boolean} Whether runner is active */
  #running = false;

  /**
   * @param {object} [opts]
   * @param {Function} [opts.onAlert] - (failures: Array) => void
   * @param {Function} [opts.evalFn] - (code: string) => Promise<boolean> — custom evaluator
   */
  constructor(opts = {}) {
    this.#onAlert = opts.onAlert || ALERT_STRATEGIES.log;
    this.#evalFn = opts.evalFn || null;
  }

  /**
   * Load a checklist from markdown string and start scheduling.
   * @param {string} md
   */
  loadChecklist(md) {
    this.stop();
    this.#checks = parseChecklist(md);
    this.#scheduleAll();
    this.#running = true;
  }

  /**
   * Load the default checklist.
   */
  loadDefault() {
    this.loadChecklist(DEFAULT_HEARTBEAT);
  }

  /** Whether runner is active. */
  get running() { return this.#running; }

  /** Number of checks loaded. */
  get checkCount() { return this.#checks.length; }

  /** Get all check items (copies). */
  get checks() {
    return this.#checks.map(c => ({
      description: c.description,
      code: c.code,
      interval: c.interval,
      lastRun: c.lastRun,
      lastResult: c.lastResult,
      consecutiveFailures: c.consecutiveFailures,
    }));
  }

  /**
   * Get status report of all checks.
   * @returns {Array<{ description: string, interval: number|string, lastRun: number|null, passed: boolean|null, consecutiveFailures: number }>}
   */
  get status() {
    return this.#checks.map(c => ({
      description: c.description,
      interval: c.interval,
      lastRun: c.lastRun,
      passed: c.lastResult,
      consecutiveFailures: c.consecutiveFailures,
    }));
  }

  /**
   * Manually run all checks in a specific interval group.
   * @param {number|'wake'} interval
   * @returns {Promise<Array>} Failures (empty if all passed)
   */
  async runGroup(interval) {
    const group = this.#checks.filter(c => c.interval === interval);
    return this.#runChecks(group);
  }

  /**
   * Run all checks regardless of interval.
   * @returns {Promise<Array>} Failures
   */
  async runAll() {
    return this.#runChecks(this.#checks);
  }

  /**
   * Run on-wake checks (called when agent resumes after idle).
   * @returns {Promise<Array>} Failures
   */
  async onWake() {
    return this.runGroup(INTERVAL_WAKE);
  }

  /**
   * Stop all heartbeat timers.
   */
  stop() {
    for (const timer of this.#timers.values()) {
      clearInterval(timer);
    }
    this.#timers.clear();
    this.#running = false;
  }

  /**
   * Clear all checks and stop.
   */
  clear() {
    this.stop();
    this.#checks = [];
  }

  // ── Internal ─────────────────────────────────────────

  #scheduleAll() {
    // Group checks by interval (skip 'wake')
    const groups = new Map();
    for (const check of this.#checks) {
      if (check.interval === INTERVAL_WAKE) continue;
      if (!groups.has(check.interval)) groups.set(check.interval, []);
      groups.get(check.interval).push(check);
    }

    for (const [interval, checks] of groups) {
      const timer = setInterval(() => this.#runChecks(checks), interval);
      this.#timers.set(interval, timer);
    }
  }

  async #runChecks(checks) {
    const failures = [];

    for (const check of checks) {
      try {
        let passed;
        if (check.code && this.#evalFn) {
          passed = await this.#evalFn(check.code);
        } else {
          // No code or no evaluator — treat as passed (manual check)
          passed = true;
        }

        check.lastRun = Date.now();
        check.lastResult = !!passed;

        if (passed) {
          check.consecutiveFailures = 0;
        } else {
          check.consecutiveFailures++;
          failures.push(check);
        }
      } catch (e) {
        check.lastRun = Date.now();
        check.lastResult = false;
        check.consecutiveFailures++;
        failures.push({ ...check, error: e.message });
      }
    }

    if (failures.length > 0) {
      this.#onAlert(failures);
    }

    return failures;
  }
}

// ── Agent Tools ─────────────────────────────────────────────────

export class HeartbeatStatusTool extends BrowserTool {
  #runner;

  constructor(runner) {
    super();
    this.#runner = runner;
  }

  get name() { return 'heartbeat_status'; }
  get description() { return 'Show heartbeat check status and recent results.'; }
  get parameters() { return { type: 'object', properties: {} }; }
  get permission() { return 'read'; }

  async execute() {
    const status = this.#runner.status;
    if (status.length === 0) {
      return { success: true, output: 'No heartbeat checks configured.' };
    }

    const lines = [
      `Heartbeat: ${this.#runner.running ? 'running' : 'stopped'} (${status.length} checks)`,
      '',
    ];

    for (const s of status) {
      const interval = s.interval === INTERVAL_WAKE ? 'on-wake'
        : s.interval >= 3_600_000 ? `every ${s.interval / 3_600_000}h`
        : `every ${s.interval / 60_000}min`;
      const result = s.passed === null ? 'not run'
        : s.passed ? 'OK' : `FAIL (${s.consecutiveFailures}x)`;
      lines.push(`[${result}] ${s.description} (${interval})`);
    }

    return { success: true, output: lines.join('\n') };
  }
}

export class HeartbeatRunTool extends BrowserTool {
  #runner;

  constructor(runner) {
    super();
    this.#runner = runner;
  }

  get name() { return 'heartbeat_run'; }
  get description() { return 'Manually run heartbeat checks (all or by interval group).'; }
  get parameters() {
    return {
      type: 'object',
      properties: {
        group: { type: 'string', description: 'Interval group: "all", "wake", or minutes (e.g. "5")' },
      },
    };
  }
  get permission() { return 'approve'; }

  async execute({ group } = {}) {
    try {
      let failures;
      if (!group || group === 'all') {
        failures = await this.#runner.runAll();
      } else if (group === 'wake') {
        failures = await this.#runner.onWake();
      } else {
        const ms = parseInt(group) * 60_000;
        failures = await this.#runner.runGroup(ms);
      }

      if (failures.length === 0) {
        return { success: true, output: 'All checks passed.' };
      }
      const lines = failures.map(f =>
        `FAIL: ${f.description}${f.error ? ` (${f.error})` : ''} [${f.consecutiveFailures}x]`
      );
      return { success: true, output: `${failures.length} check(s) failed:\n${lines.join('\n')}` };
    } catch (e) {
      return { success: false, output: '', error: e.message };
    }
  }
}
