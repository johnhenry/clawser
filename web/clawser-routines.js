// clawser-routines.js — Routines Engine (Event-Driven Automation)
//
// createRoutine: factory for routine definitions
// matchFilter: event payload filter matching
// RoutineEngine: cron + event + webhook triggers with guardrails
// Agent tools: routine_create, routine_list, routine_delete, routine_run

import { BrowserTool } from './clawser-tools.js';

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
      event: opts.trigger?.event || null,
      filter: opts.trigger?.filter || null,
      webhookPath: opts.trigger?.webhookPath || null,
      hmacSecret: opts.trigger?.hmacSecret || null,
    },
    action: {
      type: opts.action?.type || ACTION_TYPES.PROMPT,
      prompt: opts.action?.prompt || null,
      tool: opts.action?.tool || null,
      args: opts.action?.args || null,
      steps: opts.action?.steps || null,
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

  /** @type {number} Cron tick interval in ms */
  #tickInterval;

  /** @type {boolean} */
  #running = false;

  /**
   * @param {object} [opts]
   * @param {Function} [opts.executeFn] - (routine, triggerEvent) => Promise<any>
   * @param {Function} [opts.onNotify] - (routine, message) => void
   * @param {Function} [opts.onLog] - (message) => void
   * @param {number} [opts.tickInterval=60000] - Cron check interval
   */
  constructor(opts = {}) {
    this.#executeFn = opts.executeFn || null;
    this.#onNotify = opts.onNotify || null;
    this.#onLog = opts.onLog || null;
    this.#tickInterval = opts.tickInterval || 60_000;
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
   * Remove a routine.
   * @param {string} id
   * @returns {boolean}
   */
  removeRoutine(id) {
    const removed = this.#routines.delete(id);
    if (removed) this.#log(`Routine removed: ${id}`);
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
   */
  start() {
    if (this.#running) return;
    this.#running = true;
    this.#cronTicker = setInterval(() => this.#tickCron(), this.#tickInterval);
    this.#log('Routine engine started');
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
    for (const routine of this.#routines.values()) {
      if (!routine.enabled) continue;
      if (routine.trigger.type !== TRIGGER_TYPES.CRON) continue;
      if (!routine.trigger.cron) continue;

      if (this.#cronMatches(routine.trigger.cron, time)) {
        const result = await this.#enqueue(routine, { type: 'cron.tick', time });
        results.push({ routineId: routine.id, result });
      }
    }
    return results;
  }

  /**
   * Simple cron field matching (minute hour dom month dow).
   * Supports: *, specific values, ranges (1-5), step (star/n).
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
   * Serialize all routines for persistence.
   * @returns {object[]}
   */
  toJSON() {
    return this.listRoutines();
  }

  /**
   * Load routines from serialized data.
   * @param {object[]} data
   */
  fromJSON(data) {
    this.#routines.clear();
    for (const r of data) {
      this.#routines.set(r.id, r);
    }
  }

  #log(msg) {
    if (this.#onLog) this.#onLog(msg);
  }

  #notify(routine, message) {
    if (this.#onNotify) this.#onNotify(routine, message);
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
