// clawser-self-repair.js — Self-Repair / Stuck Job Recovery
//
// StuckDetector: detects stuck states via configurable thresholds
// RECOVERY_STRATEGIES: per-issue recovery action lists
// SelfRepairEngine: watchdog that detects and applies recovery
// Agent tools: self_repair_status, self_repair_configure
//
// Naming convention (3-way):
//   Module name:  clawser-self-repair   (kebab-case file name, used in imports)
//   Class name:   SelfRepairEngine      (PascalCase, used in code)
//   Tool prefix:  self_repair_          (snake_case, used in agent tool names)

import { BrowserTool } from './clawser-tools.js';

// ── Constants ───────────────────────────────────────────────────

export const DEFAULT_THRESHOLDS = Object.freeze({
  toolTimeout: 60000,
  noProgress: 120000,
  loopDetection: 3,
  contextPressure: 0.95,
  consecutiveErrors: 5,
  costRunaway: 2.0,
});

export const ISSUE_TYPES = Object.freeze({
  TOOL_TIMEOUT: 'tool_timeout',
  NO_PROGRESS: 'no_progress',
  LOOP_DETECTED: 'loop_detected',
  CONTEXT_PRESSURE: 'context_pressure',
  CONSECUTIVE_ERRORS: 'consecutive_errors',
  COST_RUNAWAY: 'cost_runaway',
});

// ── Recovery Strategies ─────────────────────────────────────────

export const RECOVERY_STRATEGIES = Object.freeze({
  [ISSUE_TYPES.TOOL_TIMEOUT]: [
    { action: 'cancel_tool', description: 'Cancel timed-out tool and report error to agent' },
    { action: 'retry_tool', maxRetries: 1, description: 'Retry tool once with same args' },
    { action: 'skip_tool', description: 'Skip tool and tell agent to try alternative' },
  ],
  [ISSUE_TYPES.NO_PROGRESS]: [
    { action: 'nudge', prompt: 'You appear to be stuck. Summarize what you have so far and try a different approach.' },
    { action: 'compact', description: 'Force context compaction to free space' },
    { action: 'abort', description: 'Abort current goal, report to user' },
  ],
  [ISSUE_TYPES.LOOP_DETECTED]: [
    { action: 'break_loop', prompt: 'You are calling {tool} repeatedly with the same arguments. This is not making progress. Try a completely different approach.' },
    { action: 'abort', description: 'Abort if loop persists after nudge' },
  ],
  [ISSUE_TYPES.CONTEXT_PRESSURE]: [
    { action: 'compact', description: 'Emergency context compaction' },
    { action: 'checkpoint_and_restart', description: 'Save state, start fresh context with summary' },
  ],
  [ISSUE_TYPES.CONSECUTIVE_ERRORS]: [
    { action: 'diagnose', prompt: 'The last {count} tool calls failed. Analyze the errors and determine if you should: (a) try a different tool, (b) ask the user for help, or (c) abort this goal.' },
    { action: 'fallback_provider', description: 'Switch to fallback LLM provider' },
  ],
  [ISSUE_TYPES.COST_RUNAWAY]: [
    { action: 'pause', description: 'Pause execution, notify user of high cost' },
    { action: 'downgrade_model', description: 'Switch to cheaper model for remaining work' },
  ],
});

// ── Duplicate Detection Helper ──────────────────────────────────

/**
 * Find consecutive duplicate tool calls (same name + same args).
 * @param {Array<{name: string, arguments: string}>} calls
 * @returns {Array<{name: string, arguments: string}>} Consecutive duplicates
 */
export function findDuplicateSequences(calls) {
  if (!calls || calls.length < 2) return [];

  const duplicates = [];
  let lastKey = null;
  let streak = 0;

  for (const call of calls) {
    const key = `${call.name}:${call.arguments || ''}`;
    if (key === lastKey) {
      streak++;
      if (streak >= 1) {
        duplicates.push(call);
      }
    } else {
      lastKey = key;
      streak = 0;
    }
  }

  return duplicates;
}

// ── StuckDetector ───────────────────────────────────────────────

/**
 * Detects stuck agent states based on configurable thresholds.
 */
export class StuckDetector {
  #thresholds;

  /**
   * @param {object} [thresholds] Override default thresholds
   */
  constructor(thresholds = {}) {
    this.#thresholds = { ...DEFAULT_THRESHOLDS, ...thresholds };
  }

  /**
   * Detect stuck conditions from job state.
   * @param {object} jobState
   * @param {number} [jobState.activeToolStart] - Timestamp when current tool started
   * @param {string} [jobState.activeTool] - Name of currently running tool
   * @param {number} [jobState.lastActivityAt] - Timestamp of last activity
   * @param {Array} [jobState.recentToolCalls] - Recent tool call records
   * @param {number} [jobState.tokenUsage] - Current token usage
   * @param {number} [jobState.contextLimit] - Context window limit
   * @param {number} [jobState.consecutiveErrors] - Error count
   * @param {number} [jobState.turnCost] - Current turn cost in dollars
   * @returns {Array<{type: string, [key: string]: any}>} Detected issues
   */
  detect(jobState) {
    if (!jobState) return [];
    const issues = [];
    const now = Date.now();

    // Tool timeout
    if (jobState.activeToolStart && jobState.activeTool &&
        now - jobState.activeToolStart > this.#thresholds.toolTimeout) {
      issues.push({
        type: ISSUE_TYPES.TOOL_TIMEOUT,
        tool: jobState.activeTool,
        elapsed: now - jobState.activeToolStart,
      });
    }

    // No progress
    if (jobState.lastActivityAt &&
        now - jobState.lastActivityAt > this.#thresholds.noProgress) {
      issues.push({
        type: ISSUE_TYPES.NO_PROGRESS,
        idleMs: now - jobState.lastActivityAt,
      });
    }

    // Loop detection
    const recent = (jobState.recentToolCalls || []).slice(-10);
    const duplicates = findDuplicateSequences(recent);
    if (duplicates.length >= this.#thresholds.loopDetection) {
      issues.push({
        type: ISSUE_TYPES.LOOP_DETECTED,
        tool: duplicates[0].name,
        count: duplicates.length,
      });
    }

    // Context pressure
    if (jobState.tokenUsage && jobState.contextLimit &&
        jobState.tokenUsage / jobState.contextLimit > this.#thresholds.contextPressure) {
      issues.push({
        type: ISSUE_TYPES.CONTEXT_PRESSURE,
        usage: jobState.tokenUsage,
        limit: jobState.contextLimit,
        ratio: jobState.tokenUsage / jobState.contextLimit,
      });
    }

    // Consecutive errors
    if (jobState.consecutiveErrors >= this.#thresholds.consecutiveErrors) {
      issues.push({
        type: ISSUE_TYPES.CONSECUTIVE_ERRORS,
        count: jobState.consecutiveErrors,
      });
    }

    // Cost runaway
    if (jobState.turnCost > this.#thresholds.costRunaway) {
      issues.push({
        type: ISSUE_TYPES.COST_RUNAWAY,
        cost: jobState.turnCost,
      });
    }

    return issues;
  }

  /** Get current thresholds (copy). */
  get thresholds() { return { ...this.#thresholds }; }

  /**
   * Update thresholds.
   * @param {object} updates
   */
  setThresholds(updates) {
    Object.assign(this.#thresholds, updates);
  }
}

// ── SelfRepairEngine ────────────────────────────────────────────

/**
 * Watches agent state and applies recovery strategies when stuck.
 */
export class SelfRepairEngine {
  #detector;
  #handlers;
  #log;
  #repairLog = [];
  #enabled = true;

  /**
   * @param {object} opts
   * @param {StuckDetector} [opts.detector]
   * @param {object} [opts.handlers] - Map of action → async handler function
   * @param {Function} [opts.onLog] - (level, msg) logging callback
   */
  constructor(opts = {}) {
    this.#detector = opts.detector || new StuckDetector();
    this.#handlers = opts.handlers || {};
    this.#log = opts.onLog || (() => {});
  }

  /**
   * Check job state and apply recovery if issues detected.
   * @param {object} jobState
   * @returns {Promise<Array<{issue: object, strategy: object, success: boolean}>>}
   */
  async check(jobState) {
    if (!this.#enabled) return [];

    const issues = this.#detector.detect(jobState);
    if (issues.length === 0) return [];

    const results = [];

    for (const issue of issues) {
      this.#log(1, `Self-repair: detected ${issue.type}`);

      const strategies = RECOVERY_STRATEGIES[issue.type];
      if (!strategies) continue;

      for (const strategy of strategies) {
        const success = await this.#apply(strategy, issue, jobState);
        const entry = { issue, strategy, success, timestamp: Date.now() };
        results.push(entry);
        this.#repairLog.push(entry);

        if (success) break; // Move to next issue
      }
    }

    return results;
  }

  /**
   * Apply a single recovery strategy.
   * @param {object} strategy
   * @param {object} issue
   * @param {object} jobState
   * @returns {Promise<boolean>}
   */
  async #apply(strategy, issue, jobState) {
    const action = strategy.action;
    this.#log(2, `Self-repair: applying ${action} for ${issue.type}`);

    // Use registered handler if available
    if (this.#handlers[action]) {
      try {
        const result = await this.#handlers[action](strategy, issue, jobState);
        return result !== false;
      } catch (e) {
        this.#log(0, `Self-repair: handler ${action} threw: ${e.message}`);
        return false;
      }
    }

    // Default handling for strategies with prompts (nudge, break_loop, diagnose)
    if (strategy.prompt && this.#handlers['inject_message']) {
      const prompt = strategy.prompt
        .replace('{tool}', issue.tool || '')
        .replace('{count}', String(issue.count || 0));
      try {
        await this.#handlers['inject_message'](prompt);
        return true;
      } catch {
        return false;
      }
    }

    this.#log(2, `Self-repair: no handler for ${action}`);
    return false;
  }

  /** Enable or disable the repair engine. */
  set enabled(value) { this.#enabled = !!value; }
  get enabled() { return this.#enabled; }

  /** Get the underlying detector. */
  get detector() { return this.#detector; }

  /** Get repair log entries. */
  get repairLog() { return [...this.#repairLog]; }

  /** Clear repair log. */
  clearLog() { this.#repairLog = []; }

  /**
   * Check if a handler is registered for a given action.
   * @param {string} action
   * @returns {boolean}
   */
  hasHandler(action) {
    return !!this.#handlers[action];
  }

  /**
   * Register a handler for a recovery action.
   * @param {string} action
   * @param {Function} handler - async (strategy, issue, jobState) => boolean
   */
  registerHandler(action, handler) {
    this.#handlers[action] = handler;
  }

  /**
   * Unregister a recovery handler by action name.
   * @param {string} action
   * @returns {boolean}
   */
  unregisterHandler(action) {
    if (!(action in this.#handlers)) return false;
    delete this.#handlers[action];
    return true;
  }

  /**
   * Get summary of repair activity.
   * @returns {{ totalDetections: number, totalRecoveries: number, successRate: number, byType: object }}
   */
  getSummary() {
    const total = this.#repairLog.length;
    const successes = this.#repairLog.filter(e => e.success).length;
    const byType = {};

    for (const entry of this.#repairLog) {
      const t = entry.issue.type;
      if (!byType[t]) byType[t] = { detected: 0, recovered: 0 };
      byType[t].detected++;
      if (entry.success) byType[t].recovered++;
    }

    return {
      totalDetections: total,
      totalRecoveries: successes,
      successRate: total > 0 ? successes / total : 0,
      byType,
    };
  }
}

// ── Agent Tools ─────────────────────────────────────────────────

export class SelfRepairStatusTool extends BrowserTool {
  #engine;

  constructor(engine) {
    super();
    this.#engine = engine;
  }

  get name() { return 'self_repair_status'; }
  get description() { return 'Show self-repair engine status, thresholds, and recovery history.'; }
  get parameters() { return { type: 'object', properties: {} }; }
  get permission() { return 'read'; }

  async execute() {
    const summary = this.#engine.getSummary();
    const thresholds = this.#engine.detector.thresholds;
    const lines = [
      `Self-repair: ${this.#engine.enabled ? 'enabled' : 'disabled'}`,
      `Detections: ${summary.totalDetections}`,
      `Recoveries: ${summary.totalRecoveries}`,
      `Success rate: ${(summary.successRate * 100).toFixed(1)}%`,
      '',
      'Thresholds:',
      ...Object.entries(thresholds).map(([k, v]) => `  ${k}: ${v}`),
    ];

    if (Object.keys(summary.byType).length > 0) {
      lines.push('', 'By type:');
      for (const [type, data] of Object.entries(summary.byType)) {
        lines.push(`  ${type}: ${data.detected} detected, ${data.recovered} recovered`);
      }
    }

    return { success: true, output: lines.join('\n') };
  }
}

export class SelfRepairConfigureTool extends BrowserTool {
  #engine;

  constructor(engine) {
    super();
    this.#engine = engine;
  }

  get name() { return 'self_repair_configure'; }
  get description() { return 'Configure self-repair thresholds or enable/disable the engine.'; }
  get parameters() {
    return {
      type: 'object',
      properties: {
        enabled: { type: 'boolean', description: 'Enable or disable self-repair' },
        toolTimeout: { type: 'number', description: 'Tool timeout in ms' },
        noProgress: { type: 'number', description: 'No-progress timeout in ms' },
        loopDetection: { type: 'number', description: 'Loop detection threshold (count)' },
        contextPressure: { type: 'number', description: 'Context pressure ratio (0-1)' },
        consecutiveErrors: { type: 'number', description: 'Consecutive error threshold' },
        costRunaway: { type: 'number', description: 'Cost runaway threshold ($)' },
      },
    };
  }
  get permission() { return 'approve'; }

  async execute(params) {
    if (typeof params.enabled === 'boolean') {
      this.#engine.enabled = params.enabled;
    }

    const thresholdKeys = ['toolTimeout', 'noProgress', 'loopDetection', 'contextPressure', 'consecutiveErrors', 'costRunaway'];
    const updates = {};
    for (const key of thresholdKeys) {
      if (params[key] !== undefined && params[key] !== null) {
        updates[key] = params[key];
      }
    }

    if (Object.keys(updates).length > 0) {
      this.#engine.detector.setThresholds(updates);
    }

    return {
      success: true,
      output: `Self-repair ${this.#engine.enabled ? 'enabled' : 'disabled'}. Updated ${Object.keys(updates).length} threshold(s).`,
    };
  }
}
