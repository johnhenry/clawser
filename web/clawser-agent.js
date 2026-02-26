/**
 * Clawser Agent — Pure JavaScript agent core
 *
 * Replaces the Rust/WASM core + clawser-host.js bridge with a single
 * async/await agent class. All state (history, goals, memory, scheduler)
 * lives in JS. The run loop is a straightforward async loop instead of
 * a step/status/deliver trampoline.
 *
 * Usage:
 *   import { ClawserAgent } from './clawser-agent.js';
 *   import { createDefaultRegistry } from './clawser-tools.js';
 *   import { createDefaultProviders } from './clawser-providers.js';
 *
 *   const agent = await ClawserAgent.create({
 *     browserTools: createDefaultRegistry(),
 *     providers: createDefaultProviders(),
 *   });
 *
 *   agent.init({});
 *   agent.setSystemPrompt('You are a browser agent with tools.');
 *   agent.sendMessage('Fetch the content of example.com');
 *   const result = await agent.run();
 */

import { lsKey } from './clawser-state.js';
import { Codex } from './clawser-codex.js';
import { SafetyPipeline } from './clawser-safety.js';
import { SemanticMemory } from './clawser-memory.js';

let _providersModule = null;
async function getProvidersModule() {
  if (!_providersModule) _providersModule = await import('./clawser-providers.js');
  return _providersModule;
}

const TEXT_ENCODER = new TextEncoder();
const TEXT_DECODER = new TextDecoder();

// ── EventLog ─────────────────────────────────────────────────────
// Append-only event log for event-sourced persistence.
// All conversation state (messages, tool calls, goals) can be derived
// from this single stream. Serialized as JSONL for OPFS storage.

class EventLog {
  #events = [];
  #seq = 0;

  /**
   * Append a new event.
   * @param {string} type - Event type (user_message, agent_message, tool_call, etc.)
   * @param {object} data - Type-specific payload
   * @param {string} source - 'agent' | 'user' | 'system'
   * @returns {object} The created event
   */
  append(type, data, source = 'system') {
    const event = {
      id: `evt_${Date.now()}_${this.#seq++}`,
      type,
      timestamp: Date.now(),
      data,
      source,
    };
    this.#events.push(event);
    return event;
  }

  /** @returns {Array<object>} Full event array */
  get events() { return this.#events; }

  /** Reset the log for new conversations */
  clear() {
    this.#events = [];
    this.#seq = 0;
  }

  /** Restore from a parsed event array */
  load(events) {
    this.#events = events;
    this.#seq = events.length;
  }

  /** Serialize to JSONL (one JSON object per line) */
  toJSONL() {
    return this.#events.map(e => JSON.stringify(e)).join('\n');
  }

  /** Deserialize from JSONL text */
  static fromJSONL(text) {
    const log = new EventLog();
    if (!text || !text.trim()) return log;
    const events = text.trim().split('\n').filter(Boolean).map(line => JSON.parse(line));
    log.load(events);
    return log;
  }

  /**
   * Rebuild LLM-compatible session history from events.
   * System prompt is prepended if provided.
   * @param {string} [systemPrompt]
   * @returns {Array<object>} History array for provider.chat()
   */
  deriveSessionHistory(systemPrompt) {
    const history = [];
    if (systemPrompt) {
      history.push({ role: 'system', content: systemPrompt });
    }

    let lastAssistant = null;

    for (const evt of this.#events) {
      switch (evt.type) {
        case 'user_message':
          lastAssistant = null;
          history.push({ role: 'user', content: evt.data.content });
          break;
        case 'agent_message':
          lastAssistant = { role: 'assistant', content: evt.data.content || '' };
          history.push(lastAssistant);
          break;
        case 'tool_call':
          if (lastAssistant) {
            if (!lastAssistant.tool_calls) lastAssistant.tool_calls = [];
            lastAssistant.tool_calls.push({
              id: evt.data.call_id,
              name: evt.data.name,
              function: {
                name: evt.data.name,
                arguments: typeof evt.data.arguments === 'string'
                  ? evt.data.arguments
                  : JSON.stringify(evt.data.arguments),
              },
            });
          }
          break;
        case 'tool_result':
          history.push({
            role: 'tool',
            tool_call_id: evt.data.call_id,
            name: evt.data.name,
            content: evt.data.result.success
              ? evt.data.result.output
              : `Error: ${evt.data.result.error || 'unknown error'}`,
          });
          break;
        // goal_added, goal_updated, memory_stored, memory_forgotten, error, system_message
        // are not part of LLM context — skipped
      }
    }

    return history;
  }

  /** Rebuild tool call log for the Tools panel */
  deriveToolCallLog() {
    const log = [];
    const pending = new Map();

    for (const evt of this.#events) {
      if (evt.type === 'tool_call') {
        pending.set(evt.data.call_id, {
          name: evt.data.name,
          params: evt.data.arguments,
          time: new Date(evt.timestamp).toLocaleTimeString(),
        });
      } else if (evt.type === 'tool_result') {
        const p = pending.get(evt.data.call_id);
        log.unshift({
          name: evt.data.name,
          params: p?.params || {},
          result: evt.data.result,
          time: p?.time || new Date(evt.timestamp).toLocaleTimeString(),
        });
        pending.delete(evt.data.call_id);
      }
    }

    return log;
  }

  /**
   * Slice events up to the end of the turn containing the given event ID.
   * A "turn" starts at a user_message and extends through all subsequent events
   * until the next user_message. Returns null if eventId not found.
   * @param {string} eventId
   * @returns {Array<object>|null}
   */
  sliceToTurnEnd(eventId) {
    const idx = this.#events.findIndex(e => e.id === eventId);
    if (idx === -1) return null;
    let end = idx;
    for (let i = idx + 1; i < this.#events.length; i++) {
      if (this.#events[i].type === 'user_message') break;
      end = i;
    }
    return this.#events.slice(0, end + 1);
  }

  /** Rebuild goals array from goal_added/goal_updated events */
  deriveGoals() {
    const goals = new Map();

    for (const evt of this.#events) {
      if (evt.type === 'goal_added') {
        goals.set(evt.data.id, {
          id: evt.data.id,
          description: evt.data.description,
          status: 'active',
          created_at: evt.timestamp,
          updated_at: evt.timestamp,
          sub_goals: [],
          artifacts: [],
        });
      } else if (evt.type === 'goal_updated') {
        const g = goals.get(evt.data.id);
        if (g) {
          g.status = evt.data.status;
          g.updated_at = evt.timestamp;
        }
      }
    }

    return [...goals.values()];
  }
}

// ── HookPipeline ──────────────────────────────────────────────
// Lifecycle hooks allow intercepting the agent pipeline at 6 points:
//   beforeInbound, beforeToolCall, beforeOutbound, transformResponse,
//   onSessionStart, onSessionEnd

/** @typedef {'beforeInbound'|'beforeToolCall'|'beforeOutbound'|'transformResponse'|'onSessionStart'|'onSessionEnd'} HookPoint */
/** @typedef {{action: 'continue'|'block'|'modify'|'skip', reason?: string, data?: object}} HookResult */

export const HOOK_POINTS = ['beforeInbound', 'beforeToolCall', 'beforeOutbound', 'transformResponse', 'onSessionStart', 'onSessionEnd'];

export class HookPipeline {
  /** @type {Map<string, Array<{name: string, point: string, priority: number, enabled: boolean, execute: Function}>>} */
  #hooks = new Map();

  /**
   * Register a hook at a specific pipeline point.
   * @param {{name: string, point: HookPoint, priority?: number, enabled?: boolean, execute: Function}} hook
   */
  register(hook) {
    if (!HOOK_POINTS.includes(hook.point)) {
      throw new Error(`Invalid hook point: ${hook.point}`);
    }
    const entry = {
      name: hook.name,
      point: hook.point,
      priority: hook.priority ?? 100,
      enabled: hook.enabled !== false,
      execute: hook.execute,
    };
    const list = this.#hooks.get(hook.point) || [];
    list.push(entry);
    list.sort((a, b) => a.priority - b.priority);
    this.#hooks.set(hook.point, list);
  }

  /**
   * Remove a hook by name and point.
   * @param {string} name
   * @param {HookPoint} point
   */
  unregister(name, point) {
    const list = this.#hooks.get(point);
    if (!list) return;
    const idx = list.findIndex(h => h.name === name);
    if (idx !== -1) list.splice(idx, 1);
  }

  /**
   * Enable or disable a hook by name.
   * @param {string} name
   * @param {boolean} enabled
   */
  setEnabled(name, enabled) {
    for (const list of this.#hooks.values()) {
      for (const h of list) {
        if (h.name === name) h.enabled = enabled;
      }
    }
  }

  /**
   * Run all hooks at a given pipeline point.
   * Hooks run in priority order (lower = first). A `block` result halts the pipeline.
   * A `modify` result merges data into the context for subsequent hooks.
   * @param {HookPoint} point
   * @param {object} ctx - Context object specific to the hook point
   * @returns {Promise<{blocked: boolean, reason?: string, ctx: object}>}
   */
  async run(point, ctx) {
    const hooks = this.#hooks.get(point) || [];
    let currentCtx = { ...ctx };

    for (const hook of hooks) {
      if (!hook.enabled) continue;
      let result;
      try {
        result = await hook.execute(currentCtx);
      } catch (e) {
        // Fail-open: hook errors don't block the pipeline
        console.error(`[hook:${hook.name}]`, e);
        continue;
      }

      if (!result || typeof result !== 'object') continue;

      switch (result.action) {
        case 'block':
          return { blocked: true, reason: result.reason || hook.name, ctx: currentCtx };
        case 'modify':
          if (result.data && typeof result.data === 'object') {
            currentCtx = { ...currentCtx, ...result.data };
          }
          break;
        case 'skip':
        case 'continue':
        default:
          break;
      }
    }

    return { blocked: false, ctx: currentCtx };
  }

  /**
   * List all registered hooks.
   * @returns {Array<{name: string, point: string, priority: number, enabled: boolean}>}
   */
  list() {
    const result = [];
    for (const list of this.#hooks.values()) {
      for (const h of list) {
        result.push({ name: h.name, point: h.point, priority: h.priority, enabled: h.enabled });
      }
    }
    return result;
  }

  /** Get count of registered hooks across all points. */
  get size() {
    let total = 0;
    for (const list of this.#hooks.values()) total += list.length;
    return total;
  }
}

/**
 * Built-in audit logger hook. Records all tool calls to the event log.
 * @param {Function} onLog - Called with (toolName, args, timestamp) on each tool call
 * @returns {object} Hook definition for HookPipeline.register()
 */
export function createAuditLoggerHook(onLog) {
  return {
    name: 'audit-logger',
    point: 'beforeToolCall',
    priority: 10,
    execute: async (ctx) => {
      onLog(ctx.toolName, ctx.args, Date.now());
      return { action: 'continue' };
    },
  };
}

// ── AutonomyController ─────────────────────────────────────────
// Enforces autonomy levels (readonly, supervised, full) and rate/cost limits.

/** @type {readonly ['readonly', 'supervised', 'full']} */
const AUTONOMY_LEVELS = ['readonly', 'supervised', 'full'];

/** Tool permission categories that are read-only (allowed in readonly mode). */
const READ_PERMISSIONS = new Set(['internal', 'read']);

export class AutonomyController {
  #level = 'supervised';
  #actionsThisHour = 0;
  #costTodayCents = 0;
  #hourStart = Date.now();
  #dayStart = AutonomyController.#startOfDay();

  // Configurable limits (Infinity = no limit)
  #maxActionsPerHour;
  #maxCostPerDayCents;

  /**
   * @param {object} [opts]
   * @param {'readonly'|'supervised'|'full'} [opts.level='supervised']
   * @param {number} [opts.maxActionsPerHour=Infinity]
   * @param {number} [opts.maxCostPerDayCents=Infinity]
   */
  constructor(opts = {}) {
    if (opts.level && AUTONOMY_LEVELS.includes(opts.level)) this.#level = opts.level;
    this.#maxActionsPerHour = opts.maxActionsPerHour ?? Infinity;
    this.#maxCostPerDayCents = opts.maxCostPerDayCents ?? Infinity;
  }

  static #startOfDay() {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d.getTime();
  }

  /** @returns {'readonly'|'supervised'|'full'} */
  get level() { return this.#level; }
  set level(v) {
    if (AUTONOMY_LEVELS.includes(v)) this.#level = v;
  }

  get maxActionsPerHour() { return this.#maxActionsPerHour; }
  set maxActionsPerHour(v) { this.#maxActionsPerHour = v; }

  get maxCostPerDayCents() { return this.#maxCostPerDayCents; }
  set maxCostPerDayCents(v) { this.#maxCostPerDayCents = v; }

  /**
   * Check if a tool is allowed at the current autonomy level.
   * @param {{permission: string}} tool - Tool or spec with a permission field
   * @returns {boolean}
   */
  canExecuteTool(tool) {
    if (this.#level === 'readonly') {
      return READ_PERMISSIONS.has(tool.permission);
    }
    return true;
  }

  /**
   * Check if a tool needs user approval at the current autonomy level.
   * @param {{permission: string}} tool
   * @returns {boolean}
   */
  needsApproval(tool) {
    if (this.#level === 'full') return false;
    if (this.#level === 'readonly') return false; // blocked entirely, not awaiting approval
    // supervised: non-read tools need approval
    return !READ_PERMISSIONS.has(tool.permission);
  }

  /**
   * Check rate and cost limits. Resets counters if the time window has elapsed.
   * @returns {{blocked: boolean, reason?: string}}
   */
  checkLimits() {
    const now = Date.now();

    // Reset hourly counter
    if (now - this.#hourStart > 3_600_000) {
      this.#actionsThisHour = 0;
      this.#hourStart = now;
    }

    // Reset daily counter
    if (now - this.#dayStart > 86_400_000) {
      this.#costTodayCents = 0;
      this.#dayStart = AutonomyController.#startOfDay();
    }

    if (this.#actionsThisHour >= this.#maxActionsPerHour) {
      const minsUntilReset = Math.ceil((3_600_000 - (now - this.#hourStart)) / 60_000);
      return {
        blocked: true,
        reason: `Rate limit: ${this.#maxActionsPerHour} actions/hour exceeded. Resets in ~${minsUntilReset} min.`,
        stats: this.stats,
      };
    }
    if (this.#costTodayCents >= this.#maxCostPerDayCents) {
      const hoursUntilReset = Math.ceil((86_400_000 - (now - this.#dayStart)) / 3_600_000);
      return {
        blocked: true,
        reason: `Cost limit: $${(this.#maxCostPerDayCents / 100).toFixed(2)}/day exceeded. Resets in ~${hoursUntilReset}h.`,
        stats: this.stats,
      };
    }
    return { blocked: false };
  }

  /** Record one tool action. */
  recordAction() { this.#actionsThisHour++; }

  /** Record cost in cents. @param {number} cents */
  recordCost(cents) { this.#costTodayCents += cents; }

  /** Get current stats for UI display. */
  get stats() {
    return {
      level: this.#level,
      actionsThisHour: this.#actionsThisHour,
      maxActionsPerHour: this.#maxActionsPerHour,
      costTodayCents: this.#costTodayCents,
      maxCostPerDayCents: this.#maxCostPerDayCents,
    };
  }

  /** Reset all counters (e.g. for testing). */
  reset() {
    this.#actionsThisHour = 0;
    this.#costTodayCents = 0;
    this.#hourStart = Date.now();
    this.#dayStart = AutonomyController.#startOfDay();
  }
}

export class ClawserAgent {
  // ── Agent state ──────────────────────────────────────────────
  #history = [];          // Array<{role, content, tool_call_id?, name?, tool_calls?}>
  #systemPrompt = '';     // Current system prompt text
  #goals = [];            // Array<{id, description, status, created_at, updated_at, sub_goals, artifacts}>
  #goalNextId = 1;
  #toolSpecs = [];        // Array<{name, description, parameters, required_permission}>
  #config = { maxToolIterations: 20, maxHistoryMessages: 50 };

  // ── Memory backend ───────────────────────────────────────────
  /** @type {SemanticMemory} */
  #memory = new SemanticMemory();

  // ── Memory Recall LRU Cache (Gap 10.1) ──────────────────────
  /** @type {Map<string, {result: Array, timestamp: number}>} */
  #recallCache = new Map();
  #recallCacheMax = 50;
  #recallCacheTTL = 120000; // 2 minutes

  // ── Scheduler ────────────────────────────────────────────────
  #schedulerJobs = [];    // Array<ScheduledJob>
  #schedulerNextId = 1;

  // ── Provider state ───────────────────────────────────────────
  #activeProvider = 'echo';
  #apiKey = '';
  #model = null;

  // ── Event log ────────────────────────────────────────────────
  #eventLog = new EventLog();

  // ── Dependencies ─────────────────────────────────────────────
  /** @type {import('./clawser-tools.js').BrowserToolRegistry} */
  #browserTools = null;
  /** @type {import('./clawser-mcp.js').McpManager} */
  #mcpManager = null;
  /** @type {import('./clawser-providers.js').ProviderRegistry} */
  #providers = null;
  /** @type {import('./clawser-tools.js').WorkspaceFs} */
  #workspaceFs = null;
  /** @type {Codex} */
  #codex = null;
  /** @type {import('./clawser-providers.js').ResponseCache|null} */
  #responseCache = null;
  /** @type {AutonomyController} */
  #autonomy = new AutonomyController();
  /** @type {HookPipeline} */
  #hooks = new HookPipeline();
  /** @type {SafetyPipeline} */
  #safety = new SafetyPipeline();
  /** @type {import('./clawser-fallback.js').FallbackExecutor|null} */
  #fallbackExecutor = null;
  /** @type {import('./clawser-self-repair.js').SelfRepairEngine|null} */
  #selfRepairEngine = null;
  /** @type {import('./clawser-undo.js').UndoManager|null} */
  #undoManager = null;

  // ── Workspace ────────────────────────────────────────────────
  #workspaceId = 'default';

  // ── Callbacks ────────────────────────────────────────────────
  #onEvent = () => {};
  #onLog = () => {};
  #onToolCall = () => {};

  // ── Lifecycle ────────────────────────────────────────────────

  /**
   * Create and initialize a ClawserAgent.
   * @param {Object} opts
   * @param {import('./clawser-tools.js').BrowserToolRegistry} [opts.browserTools]
   * @param {import('./clawser-tools.js').WorkspaceFs} [opts.workspaceFs]
   * @param {import('./clawser-providers.js').ProviderRegistry} [opts.providers]
   * @param {import('./clawser-mcp.js').McpManager} [opts.mcpManager]
   * @param {import('./clawser-providers.js').ResponseCache} [opts.responseCache]
   * @param {AutonomyController} [opts.autonomy]
   * @param {SemanticMemory} [opts.memory]
   * @param {Function} [opts.onEvent]
   * @param {Function} [opts.onLog]
   * @param {Function} [opts.onToolCall]
   */
  static async create(opts) {
    const agent = new ClawserAgent();
    agent.#onEvent = opts.onEvent || (() => {});
    agent.#onLog = opts.onLog || ((level, msg) => {
      const methods = ['debug', 'debug', 'info', 'warn', 'error'];
      console[methods[level] || 'log'](`[clawser] ${msg}`);
    });
    agent.#browserTools = opts.browserTools || null;
    agent.#workspaceFs = opts.workspaceFs || null;
    agent.#mcpManager = opts.mcpManager || null;
    agent.#providers = opts.providers || null;
    agent.#responseCache = opts.responseCache || null;
    if (opts.autonomy) agent.#autonomy = opts.autonomy;
    if (opts.hooks) agent.#hooks = opts.hooks;
    if (opts.safety || opts.safetyPipeline) agent.#safety = opts.safety || opts.safetyPipeline;
    if (opts.memory) agent.#memory = opts.memory;
    if (opts.fallbackExecutor) agent.#fallbackExecutor = opts.fallbackExecutor;
    if (opts.selfRepairEngine) agent.#selfRepairEngine = opts.selfRepairEngine;
    if (opts.undoManager) agent.#undoManager = opts.undoManager;
    if (opts.maxResultLength != null) agent.#maxResultLen = opts.maxResultLength;
    agent.#onToolCall = opts.onToolCall || (() => {});

    if (agent.#browserTools) {
      agent.#codex = new Codex(agent.#browserTools, { onLog: agent.#onLog });
    }

    return agent;
  }

  /**
   * Initialize the agent with a config object.
   * Registers browser tool specs and MCP tool specs.
   * @param {Object} config
   * @returns {number} 0 on success
   */
  init(config = {}) {
    this.#config = { ...this.#config, ...config };
    this.#toolSpecs = [];
    this.#registerExternalTools();
    return 0;
  }

  /**
   * Re-initialize the agent (for workspace switching).
   * Clears history, goals, scheduler, event log. Keeps memories.
   * @param {Object} config
   * @returns {number} 0 on success
   */
  reinit(config = {}) {
    this.#history = [];
    this.#goals = [];
    this.#goalNextId = 1;
    this.#schedulerJobs = [];
    this.#schedulerNextId = 1;
    // Preserve memories across reinit (workspace switch, new conversation)
    this.#eventLog.clear();
    return this.init(config);
  }

  /** Register all browser tools and MCP tools */
  #registerExternalTools() {
    if (this.#browserTools) {
      for (const spec of this.#browserTools.allSpecs()) {
        this.registerToolSpec(spec);
      }
    }
    if (this.#mcpManager) {
      for (const spec of this.#mcpManager.allToolSpecs()) {
        this.registerToolSpec(spec);
      }
    }
  }

  /**
   * Register a single tool spec.
   * @param {object} spec - {name, description, parameters, required_permission}
   * @returns {number} 0 on success
   */
  registerToolSpec(spec) {
    // Deduplicate by name
    const idx = this.#toolSpecs.findIndex(s => s.name === spec.name);
    if (idx >= 0) {
      this.#toolSpecs[idx] = spec;
    } else {
      this.#toolSpecs.push(spec);
    }
    return 0;
  }

  /**
   * Remove a tool spec by name.
   * @param {string} name
   * @returns {boolean} true if removed
   */
  unregisterToolSpec(name) {
    const idx = this.#toolSpecs.findIndex(s => s.name === name);
    if (idx >= 0) {
      this.#toolSpecs.splice(idx, 1);
      return true;
    }
    return false;
  }

  /**
   * Re-scan browser tools and MCP tools to pick up any newly registered tools.
   * Use instead of calling init() a second time.
   */
  refreshToolSpecs() {
    this.#registerExternalTools();
  }

  // ── Provider management ─────────────────────────────────────

  /** Set the active provider by name */
  setProvider(name) { this.#activeProvider = name; }

  /** Set the API key for providers that need one */
  setApiKey(key) { this.#apiKey = key; }

  /** Set the model override (null = use provider default) */
  setModel(model) { this.#model = model || null; }

  /** Get the current model override */
  getModel() { return this.#model; }

  /** Get the autonomy controller for level/limit management */
  get autonomy() { return this.#autonomy; }

  /** Get the hook pipeline for registering lifecycle hooks */
  get hooks() { return this.#hooks; }

  /** Get the safety pipeline for input/output scanning */
  get safety() { return this.#safety; }

  /**
   * Apply autonomy config to the internal AutonomyController.
   * @param {object} cfg
   * @param {'readonly'|'supervised'|'full'} [cfg.level]
   * @param {number} [cfg.maxActionsPerHour]
   * @param {number} [cfg.maxCostPerDayCents]
   */
  applyAutonomyConfig(cfg) {
    if (cfg.level) this.#autonomy.level = cfg.level;
    if (cfg.maxActionsPerHour != null) this.#autonomy.maxActionsPerHour = cfg.maxActionsPerHour;
    if (cfg.maxCostPerDayCents != null) this.#autonomy.maxCostPerDayCents = cfg.maxCostPerDayCents;
  }

  /**
   * Set the fallback executor for provider failover.
   * @param {import('./clawser-fallback.js').FallbackExecutor} executor
   */
  setFallbackExecutor(executor) { this.#fallbackExecutor = executor; }

  // ── Agent definitions ─────────────────────────────────────

  /** @type {Object|null} Currently applied agent definition */
  #activeAgent = null;

  /** Get the active agent definition (if any). */
  get activeAgent() { return this.#activeAgent; }

  /**
   * Apply an agent definition to the engine. Sets provider, model, API key,
   * system prompt, and config overrides from the agent config.
   * @param {Object} agentDef — AgentDefinition from clawser-agent-storage.js
   */
  applyAgent(agentDef) {
    this.#activeAgent = agentDef;

    // Set provider / model
    if (agentDef.provider) this.#activeProvider = agentDef.provider;
    if (agentDef.model) this.#model = agentDef.model;

    // Set system prompt
    if (agentDef.systemPrompt) this.setSystemPrompt(agentDef.systemPrompt);

    // Apply config overrides
    if (agentDef.maxTurnsPerRun != null) {
      this.#config.maxToolIterations = agentDef.maxTurnsPerRun;
    }
  }

  /**
   * Set the maximum tool call iterations per run (Gap 11.3).
   * @param {number} n
   */
  setMaxToolIterations(n) {
    if (typeof n === 'number' && n > 0) this.#config.maxToolIterations = n;
  }

  /** Get available providers with availability info */
  async getProviders() {
    if (!this.#providers) return [];
    return this.#providers.listWithAvailability();
  }

  // ── Agent control ───────────────────────────────────────────

  /**
   * Set the system prompt. Updates or inserts at history[0].
   * @param {string} prompt
   */
  setSystemPrompt(prompt) {
    this.#systemPrompt = prompt;
    if (this.#history.length > 0 && this.#history[0].role === 'system') {
      this.#history[0].content = prompt;
    } else {
      this.#history.unshift({ role: 'system', content: prompt });
    }
  }

  /**
   * Push a user message to history and record a user_message event.
   * @param {string} text
   */
  sendMessage(text) {
    this.#history.push({ role: 'user', content: text });
    this.#eventLog.append('user_message', { content: text }, 'user');
  }

  /**
   * Check if the active provider uses native tool calling.
   * @returns {boolean}
   */
  #providerHasNativeTools() {
    if (!this.#providers) return false;
    const provider = this.#providers.get(this.#activeProvider);
    return provider?.supportsNativeTools ?? false;
  }

  /** Access the Codex instance (for sandbox tool integration). */
  get codex() { return this.#codex; }

  /**
   * Get the Codex tool prompt for non-native providers.
   * @returns {string|null}
   */
  getCodexPrompt() {
    if (this.#providerHasNativeTools() || !this.#codex) return null;
    return this.#codex.buildToolPrompt();
  }

  /**
   * Check if a tool is external.
   * Stub -- always returns true. Reserved for future use.
   * In the pure-JS agent all tools are browser-based or MCP-based, so every
   * tool is considered external. This method exists for API compatibility and
   * may be extended later to distinguish internal agent tools.
   * @param {string} name - Tool name.
   * @returns {boolean} Always `true`.
   */
  isToolExternal(name) { return true; }

  /**
   * Route and execute tool calls to the appropriate handler.
   * @param {Array<{id, name, arguments}>} toolCalls
   * @returns {Promise<Array<{id, name, result}>>}
   */
  async #executeToolCalls(toolCalls) {
    const results = [];

    for (const call of toolCalls) {
      let params;
      try {
        params = typeof call.arguments === 'string'
          ? JSON.parse(call.arguments || '{}')
          : call.arguments || {};
      } catch {
        const result = { success: false, output: '', error: `Invalid JSON in tool arguments: ${String(call.arguments).slice(0, 200)}` };
        this.#onToolCall(call.name, {}, result);
        results.push({ id: call.id, name: call.name, result });
        continue;
      }

      let result;

      // Lifecycle hook: beforeToolCall
      const hookResult = await this.#hooks.run('beforeToolCall', {
        toolName: call.name,
        args: params,
        conversationId: null,
      });
      if (hookResult.blocked) {
        result = { success: false, output: '', error: `Blocked by hook: ${hookResult.reason}` };
        this.#onToolCall(call.name, params, result);
        results.push({ id: call.id, name: call.name, result });
        continue;
      }
      // Hooks may modify args
      if (hookResult.ctx.args !== params) {
        params = hookResult.ctx.args;
      }

      // Safety: validate tool call arguments
      const validation = this.#safety.validateToolCall(call.name, params);
      if (!validation.valid) {
        const msg = validation.issues[0]?.msg || 'Validation failed';
        result = { success: false, output: '', error: `Safety: ${msg}` };
        this.#onToolCall(call.name, params, result);
        results.push({ id: call.id, name: call.name, result });
        continue;
      }

      // Autonomy: check if tool is allowed at current level
      const toolObj = this.#browserTools?.get(call.name);
      if (toolObj && !this.#autonomy.canExecuteTool(toolObj)) {
        result = { success: false, output: '', error: `Blocked: agent is in ${this.#autonomy.level} mode` };
        this.#onToolCall(call.name, params, result);
        results.push({ id: call.id, name: call.name, result });
        continue;
      }

      // Autonomy: check rate limits before each tool execution
      const limitCheck = this.#autonomy.checkLimits();
      if (limitCheck.blocked) {
        result = { success: false, output: '', error: limitCheck.reason };
        this.#onToolCall(call.name, params, result);
        results.push({ id: call.id, name: call.name, result });
        continue;
      }

      // 1. Check browser tools first
      if (this.#browserTools?.has(call.name)) {
        this.#onToolCall(call.name, params, null);
        result = await this.#browserTools.execute(call.name, params);
        this.#autonomy.recordAction();
        this.#onToolCall(call.name, params, result);
      }
      // 2. Check MCP tools
      else if (this.#mcpManager?.findClient(call.name)) {
        this.#onToolCall(call.name, params, null);
        result = await this.#mcpManager.executeTool(call.name, params);
        this.#autonomy.recordAction();
        this.#onToolCall(call.name, params, result);
      }
      // 3. Unknown tool
      else {
        result = { success: false, output: '', error: `Tool not found: ${call.name}` };
        this.#onToolCall(call.name, params, result);
      }

      // Safety: scan tool output for leaked secrets
      if (result && result.output) {
        const scanResult = this.#safety.scanOutput(result.output);
        if (scanResult.findings.length > 0) {
          result = { ...result, output: scanResult.content };
        }
      }

      results.push({ id: call.id, name: call.name, result });
    }

    return results;
  }

  /** Max chars for a single tool result shown in chat (default, overridable via opts.maxResultLength) */
  static #MAX_RESULT_LEN = 1500;
  #maxResultLen = 1500;

  /**
   * Execute code blocks from an LLM response and perform a follow-up LLM call
   * to summarize the results. This is the Codex execution pipeline used for
   * providers that lack native tool calling (e.g. Chrome AI, Perplexity).
   *
   * Pipeline steps:
   * 1. **Code extraction**: Passes `response.content` to `Codex.execute()`, which
   *    extracts fenced code blocks, normalizes Python-isms, auto-inserts `await`,
   *    and runs each block in an andbox Worker sandbox.
   * 2. **History injection**: For each tool call produced by Codex execution, the
   *    method pushes an assistant message (with `tool_calls`) and corresponding
   *    tool-result messages into `#history`, and records matching events in the
   *    event log. This keeps the conversation state consistent for future LLM calls.
   * 3. **Follow-up LLM call**: Builds a new message sequence that includes the
   *    original conversation, the code/text output, and a user message containing
   *    truncated tool results. The LLM is asked to interpret results conversationally
   *    without writing additional code blocks. The summarized response is returned
   *    with `tool_calls` cleared to prevent further tool-call looping.
   * 4. **Fallback**: If the follow-up LLM call fails, returns the raw tool results
   *    concatenated with the cleaned text as a best-effort response.
   *
   * Returns `null` when the LLM response contained no code blocks, signaling the
   * caller to treat the response as plain text.
   *
   * @param {object} response - The ChatResponse from the initial LLM call. Must have
   *   a `content` string that may contain fenced code blocks.
   * @param {object} originalRequest - The original `{messages, tools}` request object,
   *   used as the base for the follow-up summarization call.
   * @returns {Promise<object|null>} A ChatResponse with summarized content and empty
   *   `tool_calls`, or `null` if no code blocks were found in the response.
   */
  async #executeAndSummarize(response, originalRequest) {
    const { text: cleanText, results, toolCalls } = await this.#codex.execute(response.content);
    if (results.length === 0) return null;

    // Record agent_message for the code/text content
    this.#eventLog.append('agent_message', { content: cleanText || '' }, 'agent');

    // Log tool calls to the UI and persist in history
    const codexToolCallsForHistory = [];
    for (const tc of toolCalls) {
      let parsedArgs;
      try { parsedArgs = JSON.parse(tc.arguments); } catch (e) { console.warn('[clawser] invalid tool args JSON', e); parsedArgs = {}; }
      this.#onToolCall(tc.name, parsedArgs, tc._result);
      codexToolCallsForHistory.push({
        id: tc.id,
        name: tc.name,
        function: { name: tc.name, arguments: tc.arguments },
      });

      // Record tool_call event
      this.#eventLog.append('tool_call', {
        call_id: tc.id,
        name: tc.name,
        arguments: tc.arguments,
      }, 'agent');
    }

    // Push assistant message with tool_calls into history
    this.#history.push({
      role: 'assistant',
      content: cleanText || '',
      tool_calls: codexToolCallsForHistory,
    });

    // Push tool results into history and record events
    for (const tc of toolCalls) {
      const result = tc._result;
      this.#history.push({
        role: 'tool',
        tool_call_id: tc.id,
        name: tc.name,
        content: result.success ? result.output : `Error: ${result.error || 'unknown error'}`,
      });

      // Record tool_result event
      this.#eventLog.append('tool_result', {
        call_id: tc.id,
        name: tc.name,
        result: result,
      }, 'system');
    }

    this.#onEvent('codex.executed', `${results.length} code block(s)`);

    // Truncate results to prevent flooding
    const maxLen = this.#maxResultLen;
    const resultSummaries = results.map(r => {
      if (r.error) return `Error: ${r.error}`;
      if (!r.output || r.output === '(no output)') return '(no output)';
      if (r.output.length > maxLen) {
        this.#eventLog.append('tool_result_truncated', { tool: r.name || 'unknown', original: r.output.length, truncated: maxLen }, 'system');
        return r.output.slice(0, maxLen) + `\n... (${r.output.length} chars total, truncated)`;
      }
      return r.output;
    });

    // Build follow-up prompt: ask LLM to interpret the tool results
    const toolResultText = resultSummaries.join('\n---\n');
    const followUpMessages = [
      ...originalRequest.messages,
      { role: 'assistant', content: cleanText || '(executing tools)' },
      { role: 'user', content: `Tool execution results:\n${toolResultText}\n\nBased on these results, provide a helpful response to the user's original request. Be concise and conversational. Do NOT write any code blocks.` },
    ];

    // Make follow-up LLM call for summarization
    try {
      if (this.#providers) {
        const provider = this.#providers.get(this.#activeProvider);
        if (!provider) throw new Error(`Provider not found: ${this.#activeProvider}`);
        const summary = await provider.chat({ ...originalRequest, messages: followUpMessages }, this.#apiKey, this.#model);
        if (summary?.content) {
          return { ...summary, tool_calls: [] };
        }
      }
    } catch (e) {
      this.#onLog(3, `codex summarization failed: ${e.message}`);
    }

    // Fallback: return truncated results directly
    const fallback = [cleanText, ...resultSummaries].filter(Boolean).join('\n\n');
    return { ...response, content: fallback, tool_calls: [] };
  }

  /**
   * Run the agent loop: call LLM, handle tool calls, return final response.
   *
   * Replaces the WASM trampoline with direct async/await:
   *   1. Build provider request
   *   2. Call provider.chat()
   *   3. If Codex path: execute code blocks → summarize → return
   *   4. If tool_calls: execute tools → push results → loop
   *   5. If plain text: push assistant message → return
   *
   * Events are recorded alongside history for persistence.
   *
   * @returns {Promise<{status: number, data: string}>}
   */
  async run() {
    // Autonomy: check limits before starting
    const limitsCheck = this.#autonomy.checkLimits();
    if (limitsCheck.blocked) {
      this.#eventLog.append('autonomy_blocked', { reason: limitsCheck.reason }, 'system');
      return { status: -1, data: limitsCheck.reason };
    }

    // Lifecycle hook: beforeInbound (last user message)
    const lastUserMsg = this.#history.findLast(m => m.role === 'user');
    if (lastUserMsg) {
      const inbound = await this.#hooks.run('beforeInbound', { message: lastUserMsg.content });
      if (inbound.blocked) {
        return { status: -1, data: `Blocked: ${inbound.reason}` };
      }
      if (inbound.ctx.message !== lastUserMsg.content) {
        lastUserMsg.content = inbound.ctx.message;
      }
    }

    // Undo: begin turn checkpoint
    if (this.#undoManager) {
      this.#undoManager.beginTurn({ historyLength: this.#history.length });
    }

    let maxIterations = this.#config.maxToolIterations || 20;
    let codexDone = false;

    while (maxIterations-- > 0) {
      // Build the request
      const useNative = this.#providerHasNativeTools();
      const request = {
        messages: [...this.#history],
        tools: useNative ? this.#toolSpecs : [],
      };

      // Inject Codex tool prompt for non-native providers (first call only)
      const useCodex = !codexDone && !useNative && this.#codex;
      if (useCodex) {
        const toolPrompt = this.#codex.buildToolPrompt();
        const sysIdx = request.messages.findIndex(m => m.role === 'system');
        if (sysIdx >= 0) {
          request.messages[sysIdx] = {
            ...request.messages[sysIdx],
            content: request.messages[sysIdx].content + '\n\n' + toolPrompt,
          };
        } else {
          request.messages.unshift({ role: 'system', content: toolPrompt });
        }
      }

      // Call the LLM
      if (!this.#providers) throw new Error('No provider available');
      const provider = this.#providers.get(this.#activeProvider);
      if (!provider) throw new Error(`Provider not found: ${this.#activeProvider}`);

      // Response cache lookup (skip on first iteration when tools may be pending)
      let cacheKey = null;
      if (this.#responseCache) {
        const { ResponseCache } = await getProvidersModule();
        cacheKey = ResponseCache.cacheKey(request.messages, this.#model);
        const cached = this.#responseCache.get(cacheKey);
        if (cached) {
          this.#eventLog.append('cache_hit', { key: cacheKey }, 'system');
          this.#history.push({ role: 'assistant', content: cached.content });
          this.#eventLog.append('agent_message', { content: cached.content }, 'agent');
          return { status: 1, data: cached.content, usage: cached.usage, model: cached.model, cached: true };
        }
      }

      let response;
      try {
        if (this.#fallbackExecutor) {
          const { result } = await this.#fallbackExecutor.execute(
            (pid, mdl) => this.#providers.get(pid).chat(request, this.#apiKey, mdl)
          );
          response = result;
        } else {
          response = await provider.chat(request, this.#apiKey, this.#model);
        }
      } catch (e) {
        this.#eventLog.append('error', { message: e.message }, 'system');
        return { status: -1, data: `Provider error: ${e.message}` };
      }

      // Autonomy: record cost after LLM call
      if (response.usage) {
        const { estimateCost } = await getProvidersModule();
        const cost = estimateCost(response.model, response.usage);
        this.#autonomy.recordCost(Math.round(cost * 100));
      }

      // For non-native providers: execute code blocks, then follow-up LLM call
      if (useCodex && (!response.tool_calls || response.tool_calls.length === 0)) {
        const codexResult = await this.#executeAndSummarize(response, request);
        codexDone = true;
        if (codexResult) {
          // Push the summarized response to history and record event
          this.#history.push({ role: 'assistant', content: codexResult.content });
          this.#eventLog.append('agent_message', { content: codexResult.content }, 'agent');
          return { status: 1, data: codexResult.content };
        }
      }

      // No tool calls — plain text response
      if (!response.tool_calls || response.tool_calls.length === 0) {
        // Store in response cache
        if (this.#responseCache && cacheKey) {
          this.#responseCache.set(cacheKey, response, response.model);
        }
        this.#history.push({ role: 'assistant', content: response.content });
        this.#eventLog.append('agent_message', { content: response.content }, 'agent');
        return { status: 1, data: response.content, usage: response.usage, model: response.model };
      }

      // Has tool calls — record agent_message event, then push assistant message with tool_calls
      this.#eventLog.append('agent_message', { content: response.content || '' }, 'agent');

      this.#history.push({
        role: 'assistant',
        content: response.content || '',
        tool_calls: response.tool_calls,
      });

      // Record tool_call events
      for (const tc of response.tool_calls) {
        const name = tc.function?.name || tc.name;
        const args = tc.function?.arguments || tc.arguments || '{}';
        this.#eventLog.append('tool_call', {
          call_id: tc.id,
          name,
          arguments: args,
        }, 'agent');
      }

      const toolResults = await this.#executeToolCalls(response.tool_calls);

      // Push tool results as individual messages and record events
      for (const tr of toolResults) {
        this.#history.push({
          role: 'tool',
          tool_call_id: tr.id,
          name: tr.name,
          content: tr.result.success
            ? tr.result.output
            : `Error: ${tr.result.error || 'unknown error'}`,
        });

        this.#eventLog.append('tool_result', {
          call_id: tr.id,
          name: tr.name,
          result: tr.result,
        }, 'system');

        // Undo: record file/memory ops for revert
        if (this.#undoManager && tr.result.success) {
          if (tr.name === 'fs_write' || tr.name === 'browser_fs_write') {
            this.#undoManager.recordFileOp?.({ type: 'write', path: tr.name });
          } else if (tr.name === 'fs_delete' || tr.name === 'browser_fs_delete') {
            this.#undoManager.recordFileOp?.({ type: 'delete', path: tr.name });
          } else if (tr.name === 'memory_store') {
            this.#undoManager.recordMemoryOp?.({ type: 'store' });
          } else if (tr.name === 'memory_forget') {
            this.#undoManager.recordMemoryOp?.({ type: 'forget' });
          }
        }
      }

      // Self-repair: stuck detection after tool loop iteration
      if (this.#selfRepairEngine) {
        const jobState = {
          lastActivityAt: Date.now(),
          recentToolCalls: toolResults.map(tr => ({ name: tr.name, success: tr.result.success })),
          tokenUsage: this.estimateHistoryTokens(),
          contextLimit: this.#config.contextLimit || 128000,
          consecutiveErrors: toolResults.filter(tr => !tr.result.success).length,
        };
        try {
          const repairs = await this.#selfRepairEngine.check(jobState);
          for (const r of repairs) {
            if (r.strategy?.action === 'nudge' && r.strategy.prompt) {
              this.#history.push({ role: 'system', content: r.strategy.prompt });
            } else if (r.strategy?.action === 'compact') {
              await this.compactContext();
            }
          }
        } catch (e) {
          this.#onLog(3, `self-repair check failed: ${e.message}`);
        }
      }

      // Loop back to call LLM again with tool results
      continue;
    }

    return { status: -1, data: 'max iterations reached' };
  }

  /**
   * Streaming variant of run(). Yields stream chunks as they arrive.
   * Falls back to non-streaming run() for providers that don't support it.
   *
   * @param {object} [options] - {max_tokens, temperature, signal}
   * @yields {object} StreamChunk — {type: 'text'|'tool_start'|'tool_delta'|'done'|'error', ...}
   * @returns {AsyncGenerator}
   */
  async *runStream(options = {}) {
    // Autonomy: check limits before starting
    const limitsCheck = this.#autonomy.checkLimits();
    if (limitsCheck.blocked) {
      this.#eventLog.append('autonomy_blocked', { reason: limitsCheck.reason }, 'system');
      yield { type: 'error', error: limitsCheck.reason };
      return;
    }

    // Lifecycle hook: beforeInbound
    const lastUserMsg = this.#history.findLast(m => m.role === 'user');
    if (lastUserMsg) {
      const inbound = await this.#hooks.run('beforeInbound', { message: lastUserMsg.content });
      if (inbound.blocked) {
        yield { type: 'error', error: `Blocked: ${inbound.reason}` };
        return;
      }
      if (inbound.ctx.message !== lastUserMsg.content) {
        lastUserMsg.content = inbound.ctx.message;
      }
    }

    // Undo: begin turn checkpoint
    if (this.#undoManager) {
      this.#undoManager.beginTurn({ historyLength: this.#history.length });
    }

    let maxIterations = this.#config.maxToolIterations || 20;
    let codexDone = false;

    while (maxIterations-- > 0) {
      const useNative = this.#providerHasNativeTools();
      const request = {
        messages: [...this.#history],
        tools: useNative ? this.#toolSpecs : [],
      };

      // Inject Codex tool prompt for non-native providers
      const useCodex = !codexDone && !useNative && this.#codex;
      if (useCodex) {
        const toolPrompt = this.#codex.buildToolPrompt();
        const sysIdx = request.messages.findIndex(m => m.role === 'system');
        if (sysIdx >= 0) {
          request.messages[sysIdx] = {
            ...request.messages[sysIdx],
            content: request.messages[sysIdx].content + '\n\n' + toolPrompt,
          };
        } else {
          request.messages.unshift({ role: 'system', content: toolPrompt });
        }
      }

      if (!this.#providers) throw new Error('No provider available');
      const provider = this.#providers.get(this.#activeProvider);
      if (!provider) throw new Error(`Provider not found: ${this.#activeProvider}`);

      // Response cache lookup
      let cacheKey = null;
      if (this.#responseCache) {
        const { ResponseCache } = await getProvidersModule();
        cacheKey = ResponseCache.cacheKey(request.messages, this.#model);
        const cached = this.#responseCache.get(cacheKey);
        if (cached) {
          this.#eventLog.append('cache_hit', { key: cacheKey }, 'system');
          this.#history.push({ role: 'assistant', content: cached.content });
          this.#eventLog.append('agent_message', { content: cached.content }, 'agent');
          yield { type: 'text', text: cached.content };
          yield { type: 'done', response: cached };
          return;
        }
      }

      // Check if streaming is supported
      if (!provider.supportsStreaming) {
        // Fall back to non-streaming but yield intermediate events so UI stays informed
        let response;
        if (this.#fallbackExecutor) {
          const { result } = await this.#fallbackExecutor.execute(
            (pid, mdl) => this.#providers.get(pid).chat(request, this.#apiKey, mdl)
          );
          response = result;
        } else {
          response = await provider.chat(request, this.#apiKey, this.#model);
        }

        // Codex path
        if (useCodex && (!response.tool_calls || response.tool_calls.length === 0)) {
          const codexResult = await this.#executeAndSummarize(response, request);
          codexDone = true;
          if (codexResult) {
            this.#history.push({ role: 'assistant', content: codexResult.content });
            this.#eventLog.append('agent_message', { content: codexResult.content }, 'agent');
            yield { type: 'text', text: codexResult.content };
            yield { type: 'done', response: codexResult };
            return;
          }
        }

        // No tool calls — plain text
        if (!response.tool_calls || response.tool_calls.length === 0) {
          if (this.#responseCache && cacheKey) {
            this.#responseCache.set(cacheKey, response, response.model);
          }
          this.#history.push({ role: 'assistant', content: response.content });
          this.#eventLog.append('agent_message', { content: response.content }, 'agent');
          yield { type: 'text', text: response.content };
          yield { type: 'done', response };
          return;
        }

        // Has tool calls — handle them, then continue the outer loop
        this.#eventLog.append('agent_message', { content: response.content || '' }, 'agent');
        this.#history.push({ role: 'assistant', content: response.content || '', tool_calls: response.tool_calls });
        if (response.content) yield { type: 'text', text: response.content };

        for (const tc of response.tool_calls) {
          const name = tc.function?.name || tc.name;
          const args = tc.function?.arguments || tc.arguments || '{}';
          yield { type: 'tool_start', name, id: tc.id };
          this.#eventLog.append('tool_call', { call_id: tc.id, name, arguments: args }, 'agent');
        }

        const toolResults = await this.#executeToolCalls(response.tool_calls);
        for (const tr of toolResults) {
          this.#history.push({
            role: 'tool', tool_call_id: tr.id, name: tr.name,
            content: tr.result.success ? tr.result.output : `Error: ${tr.result.error || 'unknown error'}`,
          });
          this.#eventLog.append('tool_result', { call_id: tr.id, name: tr.name, result: tr.result }, 'system');
          yield { type: 'tool_result', name: tr.name, result: tr.result };
        }

        // Self-repair: stuck detection (non-streaming path)
        if (this.#selfRepairEngine) {
          try {
            const repairs = await this.#selfRepairEngine.check({
              lastActivityAt: Date.now(),
              recentToolCalls: toolResults.map(tr => ({ name: tr.name, success: tr.result.success })),
              tokenUsage: this.estimateHistoryTokens(),
              contextLimit: this.#config.contextLimit || 128000,
              consecutiveErrors: toolResults.filter(tr => !tr.result.success).length,
            });
            for (const r of repairs) {
              if (r.strategy?.action === 'nudge' && r.strategy.prompt) {
                this.#history.push({ role: 'system', content: r.strategy.prompt });
              } else if (r.strategy?.action === 'compact') {
                await this.compactContext();
              }
            }
          } catch (e) { this.#onLog(3, `self-repair check failed: ${e.message}`); }
        }

        continue; // next iteration of the agent loop
      }

      // Collect the full response from stream chunks
      let fullContent = '';
      let fullToolCalls = [];
      let fullResponse = null;

      try {
        for await (const chunk of provider.chatStream(request, this.#apiKey, this.#model, options)) {
          yield chunk;

          if (chunk.type === 'text') {
            fullContent += chunk.text;
          } else if (chunk.type === 'done') {
            fullResponse = chunk.response;
            fullContent = chunk.response.content || fullContent;
            fullToolCalls = chunk.response.tool_calls || [];
          } else if (chunk.type === 'error') {
            return;
          }
        }
      } catch (streamErr) {
        // Stream interrupted (network drop, timeout, etc.)
        this.#eventLog.append('stream_error', {
          message: streamErr.message,
          partialContentLength: fullContent.length,
        }, 'system');

        if (fullContent) {
          // Partial content was received — keep it and continue
          this.#onLog(3, `Stream interrupted with ${fullContent.length} chars of partial content: ${streamErr.message}`);
          fullResponse = {
            content: fullContent, tool_calls: [],
            usage: { input_tokens: 0, output_tokens: 0 },
            model: this.#model || '',
          };
        } else {
          // No content received — yield error and stop
          yield { type: 'error', error: `Stream error: ${streamErr.message}` };
          return;
        }
      }

      if (!fullResponse) {
        fullResponse = { content: fullContent, tool_calls: fullToolCalls, usage: { input_tokens: 0, output_tokens: 0 }, model: '' };
      }

      // Codex path for non-native providers
      if (useCodex && fullToolCalls.length === 0) {
        const codexResult = await this.#executeAndSummarize(fullResponse, request);
        codexDone = true;
        if (codexResult) {
          this.#history.push({ role: 'assistant', content: codexResult.content });
          this.#eventLog.append('agent_message', { content: codexResult.content }, 'agent');
          yield { type: 'text', text: codexResult.content };
          yield { type: 'done', response: codexResult };
          return;
        }
      }

      // No tool calls — done
      if (fullToolCalls.length === 0) {
        if (this.#responseCache && cacheKey) {
          this.#responseCache.set(cacheKey, fullResponse, fullResponse.model);
        }
        this.#history.push({ role: 'assistant', content: fullContent });
        this.#eventLog.append('agent_message', { content: fullContent }, 'agent');
        return;
      }

      // Has tool calls — execute them and loop
      this.#eventLog.append('agent_message', { content: fullContent || '' }, 'agent');
      this.#history.push({
        role: 'assistant',
        content: fullContent || '',
        tool_calls: fullToolCalls,
      });

      for (const tc of fullToolCalls) {
        const name = tc.function?.name || tc.name;
        const args = tc.function?.arguments || tc.arguments || '{}';
        this.#eventLog.append('tool_call', { call_id: tc.id, name, arguments: args }, 'agent');
      }

      const toolResults = await this.#executeToolCalls(fullToolCalls);

      for (const tr of toolResults) {
        this.#history.push({
          role: 'tool',
          tool_call_id: tr.id,
          name: tr.name,
          content: tr.result.success
            ? tr.result.output
            : `Error: ${tr.result.error || 'unknown error'}`,
        });
        this.#eventLog.append('tool_result', { call_id: tr.id, name: tr.name, result: tr.result }, 'system');
        yield { type: 'tool_result', name: tr.name, result: tr.result };
      }

      // Self-repair: stuck detection (streaming path)
      if (this.#selfRepairEngine) {
        try {
          const repairs = await this.#selfRepairEngine.check({
            lastActivityAt: Date.now(),
            recentToolCalls: toolResults.map(tr => ({ name: tr.name, success: tr.result.success })),
            tokenUsage: this.estimateHistoryTokens(),
            contextLimit: this.#config.contextLimit || 128000,
            consecutiveErrors: toolResults.filter(tr => !tr.result.success).length,
          });
          for (const r of repairs) {
            if (r.strategy?.action === 'nudge' && r.strategy.prompt) {
              this.#history.push({ role: 'system', content: r.strategy.prompt });
            } else if (r.strategy?.action === 'compact') {
              await this.compactContext();
            }
          }
        } catch (e) { this.#onLog(3, `self-repair check failed: ${e.message}`); }
      }

      continue;
    }

    yield { type: 'error', error: 'max iterations reached' };
  }

  // ── Context Compaction ─────────────────────────────────────

  /**
   * Estimate token count from text using character-based heuristic.
   * ~4 chars per token on average for English text.
   * @param {string} text
   * @returns {number}
   */
  static estimateTokens(text) {
    if (!text) return 0;
    return Math.ceil(text.length / 4);
  }

  /**
   * Estimate total tokens in the current history.
   * @returns {number}
   */
  estimateHistoryTokens() {
    let total = 0;
    for (const msg of this.#history) {
      total += ClawserAgent.estimateTokens(msg.content || '');
      if (msg.tool_calls) {
        for (const tc of msg.tool_calls) {
          total += ClawserAgent.estimateTokens(tc.arguments || tc.function?.arguments || '');
        }
      }
    }
    return total;
  }

  /**
   * Compact the context by summarizing older messages.
   * Keeps the system prompt and the most recent N messages intact.
   * Older messages are replaced with a summary generated by the LLM.
   *
   * @param {object} [opts] - {maxTokens, keepRecent, summaryProvider}
   * @returns {Promise<boolean>} true if compaction was performed
   */
  async compactContext(opts = {}) {
    const maxTokens = opts.maxTokens || 8000;
    const keepRecent = opts.keepRecent || 10;
    const currentTokens = this.estimateHistoryTokens();

    if (currentTokens <= maxTokens) return false;

    // Separate system prompt from conversation
    const hasSystem = this.#history[0]?.role === 'system';
    const systemMsg = hasSystem ? this.#history[0] : null;
    const conversation = hasSystem ? this.#history.slice(1) : [...this.#history];

    if (conversation.length <= keepRecent) return false;

    // Split into old messages (to summarize) and recent (to keep)
    const oldMessages = conversation.slice(0, conversation.length - keepRecent);
    const recentMessages = conversation.slice(conversation.length - keepRecent);

    // Build summary request
    const summaryText = oldMessages
      .filter(m => m.role === 'user' || m.role === 'assistant')
      .map(m => `${m.role}: ${(m.content || '').slice(0, 500)}`)
      .join('\n');

    let summary;
    if (this.#providers) {
      const provider = this.#providers.get(this.#activeProvider);
      if (provider) {
        try {
          const resp = await provider.chat({
            messages: [
              { role: 'system', content: 'Summarize this conversation history concisely. Focus on key decisions, facts learned, and the current task. Be brief but comprehensive.' },
              { role: 'user', content: summaryText },
            ],
            tools: [],
          }, this.#apiKey, this.#model, { max_tokens: 500 });
          summary = resp.content;
        } catch (e) {
          this.#onLog(3, `compaction LLM call failed: ${e.message}`);
        }
      }
    }

    // Fallback: simple truncation
    if (!summary) {
      summary = `[Earlier conversation summarized: ${oldMessages.length} messages covering topics including ${
        oldMessages.filter(m => m.role === 'user').slice(0, 3).map(m => (m.content || '').slice(0, 50)).join('; ')
      }]`;
    }

    // Rebuild history
    this.#history = [];
    if (systemMsg) this.#history.push(systemMsg);
    this.#history.push({
      role: 'user',
      content: `[Context summary from earlier conversation]\n${summary}`,
    });
    this.#history.push({
      role: 'assistant',
      content: 'Understood. I have the context from our earlier conversation. How can I continue helping?',
    });
    this.#history.push(...recentMessages);

    this.#onLog(2, `context compacted: ${currentTokens} → ~${this.estimateHistoryTokens()} tokens (${oldMessages.length} messages summarized)`);
    this.#eventLog.append('context_compacted', {
      oldTokens: currentTokens,
      newTokens: this.estimateHistoryTokens(),
      messagesSummarized: oldMessages.length,
    }, 'system');

    return true;
  }

  // ── State ───────────────────────────────────────────────────

  /**
   * Get the current agent state summary.
   * @returns {object}
   */
  getState() {
    return {
      agent_state: 'Idle',
      history_len: this.#history.length,
      goals: this.#goals,
      memory_count: this.#memory.size,
      scheduler_jobs: this.#schedulerJobs.length,
    };
  }

  /**
   * Get a checkpoint JSON object for persistence.
   * @returns {object}
   */
  getCheckpointJSON() {
    return {
      id: `ckpt_${Date.now()}`,
      timestamp: Date.now(),
      agent_state: 'Idle',
      session_history: this.#history,
      active_goals: this.#goals,
      scheduler_snapshot: this.#schedulerJobs,
      version: '1.0.0',
    };
  }

  // ── Memory backend ──────────────────────────────────────────

  /**
   * Store a memory entry.
   * @param {object} entry - {key, content, category?, id?, timestamp?}
   * @returns {string} Assigned memory ID
   */
  memoryStore(entry) {
    const id = this.#memory.store({
      ...entry,
      category: entry.category || 'core',
      timestamp: entry.timestamp || Date.now(),
    });
    this.#recallCache.clear(); // Invalidate recall cache on memory change
    this.#eventLog.append('memory_stored', {
      id,
      key: entry.key,
      content: entry.content,
      category: entry.category || 'core',
    }, 'system');
    return id;
  }

  /**
   * Recall memories by keyword query (sync wrapper for backward compat).
   * For async hybrid search, use memoryRecallAsync().
   * Empty query returns all entries.
   * @param {string} query
   * @param {object} [opts] - {limit, category, minScore, vectorWeight, keywordWeight}
   * @returns {Array<object>} Matching entries with scores
   */
  memoryRecall(query, opts) {
    // Synchronous path: use internal sync recall (BM25 only, no async embedding)
    // For full hybrid search, callers should use memoryRecallAsync()
    if (!query || query.trim() === '') {
      const entries = opts?.category ? this.#memory.all(opts.category) : this.#memory.all();
      return entries.map(e => ({
        id: e.id, key: e.key, content: e.content, category: e.category, timestamp: e.timestamp, score: 1.0,
      })).slice(0, opts?.limit || 1000);
    }

    // LRU cache lookup (Gap 10.1)
    const cacheKey = `${query}|${opts?.category || ''}|${opts?.limit || 20}`;
    const cached = this.#recallCache.get(cacheKey);
    if (cached && (Date.now() - cached.timestamp) < this.#recallCacheTTL) {
      // Move to end (most recently used) by re-inserting
      this.#recallCache.delete(cacheKey);
      this.#recallCache.set(cacheKey, cached);
      return cached.result;
    }
    // Remove stale entry if expired
    if (cached) this.#recallCache.delete(cacheKey);

    // Synchronous TF-IDF search (no embeddings, backward compat)
    // For full hybrid BM25+vector search, use memoryRecallAsync()
    const allEntries = opts?.category ? this.#memory.all(opts.category) : this.#memory.all();
    if (allEntries.length === 0) return [];

    const queryTerms = query.toLowerCase().split(/[^a-z0-9]+/).filter(t => t.length > 1);
    const N = allEntries.length;
    const df = {};
    for (const term of queryTerms) df[term] = 0;
    for (const entry of allEntries) {
      const text = `${entry.key} ${entry.content}`.toLowerCase();
      for (const term of queryTerms) {
        if (text.includes(term)) df[term]++;
      }
    }

    const scored = [];
    for (const entry of allEntries) {
      const contentLower = (entry.content || '').toLowerCase();
      const keyLower = (entry.key || '').toLowerCase();
      let score = 0;
      for (const term of queryTerms) {
        const idf = Math.log((N + 1) / ((df[term] || 0) + 1)) + 1;
        const tf = (contentLower.split(term).length - 1) + (keyLower.split(term).length - 1) * 2;
        score += tf * idf;
      }
      if (score > 0) {
        scored.push({
          id: entry.id, key: entry.key, content: entry.content,
          category: entry.category, timestamp: entry.timestamp,
          score: Math.round(score * 100) / 100,
        });
      }
    }

    scored.sort((a, b) => b.score - a.score);
    const result = scored.slice(0, opts?.limit || 20);

    // Store in LRU cache
    if (this.#recallCache.size >= this.#recallCacheMax) {
      // Evict oldest entry (first key in Map iteration order)
      const oldestKey = this.#recallCache.keys().next().value;
      this.#recallCache.delete(oldestKey);
    }
    this.#recallCache.set(cacheKey, { result, timestamp: Date.now() });

    return result;
  }

  /**
   * Recall memories using async hybrid search (BM25 + vector).
   * @param {string} query
   * @param {object} [opts]
   * @returns {Promise<Array<object>>}
   */
  async memoryRecallAsync(query, opts) {
    return this.#memory.recall(query, opts);
  }

  /**
   * Delete a memory entry by ID.
   * @param {string} id
   * @returns {number} 1 if deleted, 0 if not found
   */
  memoryForget(id) {
    if (this.#memory.delete(id)) {
      this.#recallCache.clear(); // Invalidate recall cache on memory change
      this.#eventLog.append('memory_forgotten', { id }, 'system');
      return 1;
    }
    return 0;
  }

  /**
   * Memory hygiene: remove duplicate and stale entries.
   * Deduplicates by key (keeps newest), purges entries older than maxAge.
   * @param {object} [opts] - {maxAge: milliseconds, maxEntries: number}
   * @returns {number} Number of entries removed
   */
  memoryHygiene(opts = {}) {
    const removed = this.#memory.hygiene(opts);
    if (removed > 0) {
      this.#recallCache.clear(); // Invalidate recall cache after hygiene
      this.#onLog(2, `memory hygiene: removed ${removed} entries`);
    }
    return removed;
  }

  /** Get the underlying SemanticMemory instance for advanced operations */
  get memory() { return this.#memory; }

  // ── Goals ───────────────────────────────────────────────────

  /**
   * Add a new goal.
   * @param {string} description
   * @returns {string} Goal ID
   */
  addGoal(description) {
    const now = Date.now();
    const id = `goal_${this.#goalNextId++}`;
    const goal = {
      id,
      description,
      status: 'active',
      created_at: now,
      updated_at: now,
      sub_goals: [],
      artifacts: [],
    };
    this.#goals.push(goal);
    this.#onEvent('goal.added', description);
    this.#eventLog.append('goal_added', { id, description }, 'system');
    return id;
  }

  /**
   * Complete a goal by ID.
   * @param {string} id
   * @returns {boolean} true if found and completed
   */
  completeGoal(id) {
    const goal = this.#goals.find(g => g.id === id);
    if (!goal) return false;
    goal.status = 'completed';
    goal.updated_at = Date.now();
    this.#onEvent('goal.completed', goal.description);
    this.#eventLog.append('goal_updated', { id, status: 'completed' }, 'system');
    return true;
  }

  /**
   * Update a goal's status.
   * @param {string} id
   * @param {'active'|'completed'|'failed'} status
   * @returns {boolean} true if found and updated
   */
  updateGoal(id, status) {
    const goal = this.#goals.find(g => g.id === id);
    if (!goal) return false;
    goal.status = status;
    goal.updated_at = Date.now();
    this.#onEvent(`goal.${status}`, goal.description);
    this.#eventLog.append('goal_updated', { id, status }, 'system');
    return true;
  }

  // ── Scheduler ───────────────────────────────────────────────

  /**
   * Parse a 5-field cron expression into { minute, hour, dayOfMonth, month, dayOfWeek }.
   * Each field can be: *, a number, or a comma-separated list.
   * @param {string} expr - e.g. "0 9 * * 1-5"
   * @returns {object|null} Parsed cron or null if invalid
   */
  static parseCron(expr) {
    const parts = (expr || '').trim().split(/\s+/);
    if (parts.length !== 5) return null;

    function parseField(field, min, max) {
      if (field === '*') return null; // matches all
      const values = new Set();
      for (const segment of field.split(',')) {
        if (segment.includes('/')) {
          // Handle */step and range/step (e.g. */5, 0-30/5, 1-12/3)
          const [base, stepStr] = segment.split('/');
          const step = parseInt(stepStr, 10);
          if (isNaN(step) || step <= 0) return undefined;
          let lo = min, hi = max;
          if (base !== '*') {
            const rm = base.match(/^(\d+)-(\d+)$/);
            if (rm) { lo = parseInt(rm[1], 10); hi = parseInt(rm[2], 10); }
            else if (base.match(/^\d+$/)) { lo = parseInt(base, 10); hi = max; }
            else return undefined;
          }
          for (let i = lo; i <= hi; i += step) values.add(i);
        } else if (segment.match(/^(\d+)-(\d+)$/)) {
          const rm = segment.match(/^(\d+)-(\d+)$/);
          const lo = parseInt(rm[1], 10);
          const hi = parseInt(rm[2], 10);
          for (let i = lo; i <= hi; i++) values.add(i);
        } else if (segment.match(/^\d+$/)) {
          values.add(parseInt(segment, 10));
        } else {
          return undefined; // invalid
        }
      }
      return values;
    }

    const minute = parseField(parts[0], 0, 59);
    const hour = parseField(parts[1], 0, 23);
    const dayOfMonth = parseField(parts[2], 1, 31);
    const month = parseField(parts[3], 1, 12);
    const dayOfWeek = parseField(parts[4], 0, 6);

    if (minute === undefined || hour === undefined || dayOfMonth === undefined ||
        month === undefined || dayOfWeek === undefined) return null;

    return { minute, hour, dayOfMonth, month, dayOfWeek };
  }

  /**
   * Check if a cron expression matches a given Date.
   * @param {object} cron - Parsed cron from parseCron()
   * @param {Date} date
   * @returns {boolean}
   */
  static #cronMatches(cron, date) {
    if (cron.minute && !cron.minute.has(date.getMinutes())) return false;
    if (cron.hour && !cron.hour.has(date.getHours())) return false;
    if (cron.dayOfMonth && !cron.dayOfMonth.has(date.getDate())) return false;
    if (cron.month && !cron.month.has(date.getMonth() + 1)) return false;
    if (cron.dayOfWeek && !cron.dayOfWeek.has(date.getDay())) return false;
    return true;
  }

  /**
   * Tick the scheduler: fire any jobs that are due.
   * @param {number} nowMs - Current time in milliseconds
   * @returns {number} Number of jobs fired
   */
  tick(nowMs = Date.now()) {
    let fired = 0;
    const nowDate = new Date(nowMs);

    for (const job of this.#schedulerJobs) {
      if (job.paused) continue;

      let shouldFire = false;
      if (job.schedule_type === 'once' && !job.fired && nowMs >= job.fire_at) {
        shouldFire = true;
        job.fired = true;
      } else if (job.schedule_type === 'interval' && nowMs >= (job.last_fired || 0) + job.interval_ms) {
        shouldFire = true;
        job.last_fired = nowMs;
      } else if (job.schedule_type === 'cron' && job.cron) {
        // Only fire once per minute
        const lastMinute = job.last_fired ? Math.floor(job.last_fired / 60000) : 0;
        const thisMinute = Math.floor(nowMs / 60000);
        if (thisMinute > lastMinute && ClawserAgent.#cronMatches(job.cron, nowDate)) {
          shouldFire = true;
          job.last_fired = nowMs;
        }
      }

      if (shouldFire && job.action_type === 'AgentPrompt') {
        this.#history.push({ role: 'user', content: job.prompt });
        this.#eventLog.append('scheduler_fired', { job_id: job.id, prompt: job.prompt }, 'system');
        fired++;
      }
    }
    return fired;
  }

  // ── Public Scheduler API ──────────────────────────────────

  /**
   * Add a scheduled job.
   * @param {object} spec - {schedule_type: 'once'|'interval'|'cron', prompt, fire_at?, interval_ms?, cron_expr?}
   * @returns {string} Job ID
   */
  addSchedulerJob(spec) {
    const id = `job_${this.#schedulerNextId++}`;
    const job = {
      id,
      schedule_type: spec.schedule_type,
      action_type: 'AgentPrompt',
      prompt: spec.prompt,
      paused: false,
      fired: false,
      last_fired: 0,
    };

    if (spec.schedule_type === 'once') {
      job.fire_at = spec.fire_at || (Date.now() + (spec.delay_ms || 60000));
    } else if (spec.schedule_type === 'interval') {
      job.interval_ms = spec.interval_ms || 60000;
    } else if (spec.schedule_type === 'cron') {
      const cron = ClawserAgent.parseCron(spec.cron_expr);
      if (!cron) throw new Error(`Invalid cron expression: ${spec.cron_expr}`);
      job.cron = cron;
      job.cron_expr = spec.cron_expr;
    }

    this.#schedulerJobs.push(job);
    this.#eventLog.append('scheduler_added', { id, spec }, 'system');
    return id;
  }

  /**
   * List all scheduled jobs.
   * @returns {Array<object>}
   */
  listSchedulerJobs() {
    return this.#schedulerJobs.map(j => ({
      id: j.id,
      schedule_type: j.schedule_type,
      prompt: j.prompt,
      paused: j.paused,
      fired: j.fired,
      cron_expr: j.cron_expr || null,
      interval_ms: j.interval_ms || null,
    }));
  }

  /**
   * Remove a scheduled job by ID.
   * @param {string} id
   * @returns {boolean}
   */
  removeSchedulerJob(id) {
    const idx = this.#schedulerJobs.findIndex(j => j.id === id);
    if (idx >= 0) {
      this.#schedulerJobs.splice(idx, 1);
      this.#eventLog.append('scheduler_removed', { id }, 'system');
      return true;
    }
    return false;
  }

  // ── Event log public API ──────────────────────────────────────

  /**
   * Record an event from external code (e.g. command palette, UI).
   * @param {string} type
   * @param {object} data
   * @param {string} source - 'agent' | 'user' | 'system'
   * @returns {object} The created event
   */
  recordEvent(type, data, source = 'system') {
    return this.#eventLog.append(type, data, source);
  }

  /** Get the event log instance for replay */
  getEventLog() { return this.#eventLog; }

  /** Clear the event log (for new conversations) */
  clearEventLog() { this.#eventLog.clear(); }

  /**
   * Execute a tool directly (bypasses LLM). Used by command palette.
   * @param {string} name - Tool name
   * @param {object} params - Tool parameters
   * @returns {Promise<{success: boolean, output: string, error?: string}>}
   */
  async executeToolDirect(name, params) {
    if (this.#browserTools?.has(name)) {
      return await this.#browserTools.execute(name, params);
    }
    if (this.#mcpManager?.findClient(name)) {
      return await this.#mcpManager.executeTool(name, params);
    }
    return { success: false, output: '', error: `Tool not found: ${name}` };
  }

  // ── Checkpoint / Restore ────────────────────────────────────

  /**
   * Create a checkpoint as bytes (JSON encoded).
   * @returns {Uint8Array}
   */
  checkpoint() {
    const json = JSON.stringify(this.getCheckpointJSON());
    return TEXT_ENCODER.encode(json);
  }

  /**
   * Restore agent state from checkpoint bytes.
   * @param {Uint8Array} bytes
   * @returns {number} 0 on success, -1 on error
   */
  restore(bytes) {
    try {
      const json = TEXT_DECODER.decode(bytes);
      const data = JSON.parse(json);
      this.#history = data.session_history || [];
      this.#goals = data.active_goals || [];
      this.#schedulerJobs = data.scheduler_snapshot || [];

      // Sync goalNextId past any restored goals
      for (const g of this.#goals) {
        const num = parseInt((g.id || '').replace('goal_', ''), 10);
        if (!isNaN(num) && num >= this.#goalNextId) {
          this.#goalNextId = num + 1;
        }
      }

      return 0;
    } catch (e) {
      this.#onLog(4, `restore failed: ${e.message}`);
      return -1;
    }
  }

  // ── Workspace / Persistence ─────────────────────────────────

  /** Set the active workspace ID (affects all persistence key namespacing) */
  setWorkspace(id) {
    this.#workspaceId = id;
    this.#workspaceFs?.setWorkspace(id);
  }

  /** Get the active workspace ID */
  getWorkspace() { return this.#workspaceId; }

  /** Persist all memories to localStorage for survival across reloads */
  persistMemories() {
    try {
      const all = this.#memory.exportToFlatArray();
      localStorage.setItem(lsKey.memories(this.#workspaceId), JSON.stringify(all));
    } catch (e) {
      this.#onLog(3, `persist memories failed: ${e.message}`);
    }
  }

  /** Restore memories from localStorage into the memory backend */
  restoreMemories() {
    try {
      const raw = localStorage.getItem(lsKey.memories(this.#workspaceId));
      if (!raw) return 0;
      const entries = JSON.parse(raw);
      // Clear existing memories to avoid duplicates on repeated restore
      this.#memory.clear();
      const count = this.#memory.importFromFlatArray(entries);
      this.#onLog(2, `restored ${count} memories from localStorage`);
      return count;
    } catch (e) {
      this.#onLog(3, `restore memories failed: ${e.message}`);
      return 0;
    }
  }

  /** Get (or create) the workspace home directory: /clawser_workspaces/{wsId}/ */
  async #getWorkspaceDir(root, create = false) {
    const base = await root.getDirectoryHandle('clawser_workspaces', { create });
    return base.getDirectoryHandle(this.#workspaceId, { create });
  }

  /** Save checkpoint to OPFS for persistence across reloads */
  async persistCheckpoint() {
    try {
      const bytes = this.checkpoint();
      if (bytes.length === 0) return;
      const root = await navigator.storage.getDirectory();
      const wsDir = await this.#getWorkspaceDir(root, true);
      const cpDir = await wsDir.getDirectoryHandle('.checkpoints', { create: true });
      const file = await cpDir.getFileHandle('latest.bin', { create: true });
      // Atomic write: per WHATWG File System spec, createWritable() writes to a
      // swap file; the original is only replaced when close() succeeds. If close()
      // is never called (crash, error), the previous file remains intact.
      const writable = await file.createWritable();
      await writable.write(bytes);
      await writable.close();
      this.#onLog(2, `checkpoint saved to OPFS (${bytes.length} bytes)`);
    } catch (e) {
      this.#onLog(3, `persist checkpoint failed: ${e.message}`);
    }
  }

  /** Restore checkpoint from OPFS (tries new path, then old path with fallback) */
  async restoreCheckpoint() {
    try {
      const root = await navigator.storage.getDirectory();

      // 1. Try new path: /clawser_workspaces/{wsId}/.checkpoints/latest.bin
      try {
        const wsDir = await this.#getWorkspaceDir(root);
        const cpDir = await wsDir.getDirectoryHandle('.checkpoints');
        const file = await cpDir.getFileHandle('latest.bin');
        const blob = await (await file.getFile()).arrayBuffer();
        const bytes = new Uint8Array(blob);
        if (bytes.length > 0 && this.restore(bytes) === 0) {
          this.#onLog(2, `checkpoint restored from OPFS (${bytes.length} bytes)`);
          return true;
        }
      } catch (e) { console.debug('[clawser] checkpoint not found at new path, trying old', e); }

      // 2. Fallback: old path /clawser_checkpoints/{wsId}/latest.bin
      try {
        const dir = await root.getDirectoryHandle('clawser_checkpoints');
        const wsDir = await dir.getDirectoryHandle(this.#workspaceId);
        const file = await wsDir.getFileHandle('latest.bin');
        const blob = await (await file.getFile()).arrayBuffer();
        const bytes = new Uint8Array(blob);
        if (bytes.length > 0 && this.restore(bytes) === 0) {
          this.#onLog(2, `checkpoint restored from old OPFS path (${bytes.length} bytes)`);
          return true;
        }
      } catch (e) { console.debug('[clawser] checkpoint not found at old path either', e); }

      // 3. Ancient fallback: /clawser_checkpoints/latest.bin (non-scoped, default only)
      if (this.#workspaceId === 'default') {
        try {
          const dir = await root.getDirectoryHandle('clawser_checkpoints');
          const file = await dir.getFileHandle('latest.bin');
          const blob = await (await file.getFile()).arrayBuffer();
          const bytes = new Uint8Array(blob);
          if (bytes.length > 0 && this.restore(bytes) === 0) {
            this.#onLog(2, `checkpoint restored from ancient OPFS path (${bytes.length} bytes)`);
            return true;
          }
        } catch (e) { console.debug('[clawser] checkpoint not found at ancient path', e); }
      }

      return false;
    } catch (e) {
      console.debug('[clawser] restoreCheckpoint outer error', e);
      return false;
    }
  }

  /** Save provider and API key preferences to localStorage */
  persistConfig() {
    try {
      const config = {
        provider: this.#activeProvider,
        apiKey: this.#apiKey,
        model: this.#model,
      };
      localStorage.setItem(lsKey.config(this.#workspaceId), JSON.stringify(config));
    } catch (e) { console.warn('[clawser] failed to persist config', e); }
  }

  /** Restore provider and API key preferences from localStorage */
  restoreConfig() {
    try {
      const raw = localStorage.getItem(lsKey.config(this.#workspaceId));
      if (!raw) return null;
      return JSON.parse(raw);
    } catch (e) { console.debug('[clawser] restoreConfig parse error', e); return null; }
  }

  // ── Conversation persistence (v2: event-sourced) ─────────────

  /**
   * Save current conversation as v2 format (directory with meta.json + events.jsonl).
   * Also writes checkpoint as crash-recovery fallback.
   * @param {string} convId - Conversation ID
   * @param {object} [metadata] - { name, created }
   */
  async persistConversation(convId, metadata = {}) {
    try {
      const root = await navigator.storage.getDirectory();
      const wsDir = await this.#getWorkspaceDir(root, true);
      const convDir = await wsDir.getDirectoryHandle('.conversations', { create: true });
      const convIdDir = await convDir.getDirectoryHandle(convId, { create: true });

      // Write meta.json
      // Atomic write: createWritable() uses a swap file; original only replaced on close().
      const meta = {
        id: convId,
        name: metadata.name || convId,
        created: metadata.created || Date.now(),
        lastUsed: Date.now(),
        version: 2,
      };
      const metaFile = await convIdDir.getFileHandle('meta.json', { create: true });
      const metaWritable = await metaFile.createWritable();
      await metaWritable.write(JSON.stringify(meta));
      await metaWritable.close();

      // Write events.jsonl (same atomic guarantee via createWritable swap file)
      const eventsFile = await convIdDir.getFileHandle('events.jsonl', { create: true });
      const eventsWritable = await eventsFile.createWritable();
      await eventsWritable.write(this.#eventLog.toJSONL());
      await eventsWritable.close();

      this.#onLog(2, `conversation ${convId} saved (v2, ${this.#eventLog.events.length} events)`);

      // Clean up old v1 .json file if it exists
      try { await convDir.removeEntry(`${convId}.json`); } catch (e) { console.debug('[clawser] v1 conversation cleanup:', e); }

      return true;
    } catch (e) {
      this.#onLog(3, `persist conversation failed: ${e.message}`);
      return false;
    }
  }

  /**
   * Restore a saved conversation. Tries v2 (events) first, falls back to v1 (JSON).
   * On v1 fallback, migrates to events so next save writes v2.
   * @returns {object|null} Conversation metadata or null
   */
  async restoreConversation(convId) {
    try {
      const root = await navigator.storage.getDirectory();

      // 1. Try v2: directory with meta.json + events.jsonl
      try {
        const wsDir = await this.#getWorkspaceDir(root);
        const convDir = await wsDir.getDirectoryHandle('.conversations');
        const convIdDir = await convDir.getDirectoryHandle(convId);

        const metaFile = await convIdDir.getFileHandle('meta.json');
        const metaText = await (await metaFile.getFile()).text();
        const meta = JSON.parse(metaText);

        const eventsFile = await convIdDir.getFileHandle('events.jsonl');
        const eventsText = await (await eventsFile.getFile()).text();
        this.#eventLog = EventLog.fromJSONL(eventsText);

        // Derive session history and goals from events
        this.#history = this.#eventLog.deriveSessionHistory(this.#systemPrompt);
        this.#goals = this.#eventLog.deriveGoals();

        // Sync goalNextId past any restored goals
        for (const g of this.#goals) {
          const num = parseInt((g.id || '').replace('goal_', ''), 10);
          if (!isNaN(num) && num >= this.#goalNextId) {
            this.#goalNextId = num + 1;
          }
        }

        this.#onLog(2, `conversation ${convId} restored from v2 (${this.#eventLog.events.length} events)`);
        return meta;
      } catch (e) { console.debug('[clawser] conversation not found at v2 path', e); }

      // 2. Try v1: single JSON file at .conversations/{convId}.json
      try {
        const wsDir = await this.#getWorkspaceDir(root);
        const convDir = await wsDir.getDirectoryHandle('.conversations');
        const file = await convDir.getFileHandle(`${convId}.json`);
        const text = await (await file.getFile()).text();
        const convData = JSON.parse(text);

        if (convData.checkpoint) {
          const bytes = TEXT_ENCODER.encode(JSON.stringify(convData.checkpoint));
          const rc = this.restore(bytes);
          if (rc !== 0) return null;

          // Migrate v1 → events
          this.#migrateV1ToEvents(convData);

          this.#onLog(2, `conversation ${convId} restored from v1 (migrating to v2)`);
          return {
            id: convId,
            name: convData.name || convId,
            created: convData.created || Date.now(),
            lastUsed: convData.lastUsed || Date.now(),
            version: 2,
          };
        }
      } catch (e) { console.debug('[clawser] conversation not found at v1 path', e); }

      // 3. Fallback: old binary path /clawser_checkpoints/{wsId}/{convId}.bin
      try {
        const dir = await root.getDirectoryHandle('clawser_checkpoints');
        const wsDir = await dir.getDirectoryHandle(this.#workspaceId);
        const file = await wsDir.getFileHandle(`${convId}.bin`);
        const blob = await (await file.getFile()).arrayBuffer();
        const bytes = new Uint8Array(blob);
        if (bytes.length === 0) return null;
        const rc = this.restore(bytes);
        if (rc !== 0) return null;

        // Migrate from checkpoint
        this.#migrateV1ToEvents({ checkpoint: this.getCheckpointJSON() });

        this.#onLog(2, `conversation ${convId} restored from old .bin path (migrating)`);
        return { id: convId, name: convId, created: Date.now(), lastUsed: Date.now(), version: 2 };
      } catch (e) { console.debug('[clawser] conversation not found at old .bin path', e); }

      return null;
    } catch (e) {
      this.#onLog(3, `restore conversation failed: ${e.message}`);
      return null;
    }
  }

  /**
   * Migrate v1 conversation data to event log.
   * Scans session_history and creates equivalent events.
   * @param {object} convData - v1 conversation data with checkpoint
   */
  #migrateV1ToEvents(convData) {
    this.#eventLog.clear();
    const history = convData.checkpoint?.session_history || this.#history;

    for (const msg of history) {
      if (msg.role === 'system') continue;

      if (msg.role === 'user') {
        this.#eventLog.append('user_message', { content: msg.content }, 'user');
      } else if (msg.role === 'assistant') {
        this.#eventLog.append('agent_message', { content: msg.content || '' }, 'agent');
        if (msg.tool_calls) {
          for (const tc of msg.tool_calls) {
            const name = tc.function?.name || tc.name || 'unknown';
            const args = tc.function?.arguments || tc.arguments || '{}';
            this.#eventLog.append('tool_call', {
              call_id: tc.id,
              name,
              arguments: args,
            }, 'agent');
          }
        }
      } else if (msg.role === 'tool') {
        let result;
        try { result = JSON.parse(msg.content); } catch { result = { success: true, output: msg.content }; }
        this.#eventLog.append('tool_result', {
          call_id: msg.tool_call_id,
          name: msg.name || 'tool',
          result,
        }, 'system');
      }
    }

    // Migrate goals
    const goals = convData.checkpoint?.active_goals || this.#goals;
    for (const g of goals) {
      this.#eventLog.append('goal_added', { id: g.id, description: g.description }, 'system');
      if (g.status !== 'active') {
        this.#eventLog.append('goal_updated', { id: g.id, status: g.status }, 'system');
      }
    }
  }

  /** Delete a saved conversation from OPFS (tries v2 directory, v1 JSON, and old .bin) */
  async deleteConversation(convId) {
    const root = await navigator.storage.getDirectory();
    let deleted = false;

    // Try v2 directory path
    try {
      const wsDir = await this.#getWorkspaceDir(root);
      const convDir = await wsDir.getDirectoryHandle('.conversations');
      await convDir.removeEntry(convId, { recursive: true });
      deleted = true;
    } catch (e) { console.debug('[clawser] deleteConversation v2 path:', e); }

    // Try v1 JSON path
    try {
      const wsDir = await this.#getWorkspaceDir(root);
      const convDir = await wsDir.getDirectoryHandle('.conversations');
      await convDir.removeEntry(`${convId}.json`);
      deleted = true;
    } catch (e) { console.debug('[clawser] deleteConversation v1 path:', e); }

    // Also try old .bin path (cleanup)
    try {
      const dir = await root.getDirectoryHandle('clawser_checkpoints');
      const wsDir = await dir.getDirectoryHandle(this.#workspaceId);
      await wsDir.removeEntry(`${convId}.bin`);
      deleted = true;
    } catch (e) { console.debug('[clawser] deleteConversation .bin path:', e); }

    if (deleted) {
      this.#onLog(2, `conversation ${convId} deleted`);
    } else {
      this.#onLog(3, `delete conversation: ${convId} not found`);
    }
    return deleted;
  }

  // ── MCP management ──────────────────────────────────────────

  /** Connect to an MCP server and register its tools */
  async addMcpServer(name, endpoint) {
    if (!this.#mcpManager) return null;
    const client = await this.#mcpManager.addServer(name, endpoint);
    // Register newly discovered tools with the agent
    for (const spec of client.toolSpecs) {
      this.registerToolSpec(spec);
    }
    return client;
  }

  removeMcpServer(name) {
    this.#mcpManager?.removeServer(name);
  }
}
