// clawser-state.js — Shared state singleton, DOM helpers, event bus

// ── Configurable Defaults (Gap 10.5) ──────────────────────────────
// Centralizes hardcoded limits scattered across the codebase.
// Import and reference these instead of magic numbers.
export const DEFAULTS = Object.freeze({
  maxResultLength: 12000,
  maxHistoryTokens: 12000,
  contextCompactThreshold: 12000,
  maxTokens: 4096,
  costTrackingPrecision: 6,
  memoryRecallCacheSize: 50,
  memoryRecallCacheTTL: 120_000,
  configCacheDebounceMs: 500,
  codeExecTimeoutMs: 30_000,
  mcpTimeoutMs: 30_000,
  maxSchedulerJobs: 50,
  filePageSize: 50,
});

/** @param {string} id @returns {HTMLElement|null} */
export const $ = id => document.getElementById(id);

/**
 * Escape HTML special characters to prevent XSS.
 * @param {string} s
 * @returns {string}
 */
export function esc(s) {
  return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// ── localStorage key builders (centralized to avoid scattered string literals) ──
/** @type {{ memories(wsId: string): string, config(wsId: string): string, toolPerms(wsId: string): string, security(wsId: string): string, skillsEnabled(wsId: string): string }} */
export const lsKey = {
  memories:      wsId => `clawser_memories_${wsId}`,
  config:        wsId => `clawser_config_${wsId}`,
  toolPerms:     wsId => `clawser_tool_perms_${wsId}`,
  security:      wsId => `clawser_security_${wsId}`,
  skillsEnabled: wsId => `clawser_skills_enabled_${wsId}`,
  autonomy:      wsId => `clawser_autonomy_${wsId}`,
  identity:      wsId => `clawser_identity_${wsId}`,
  selfRepair:    wsId => `clawser_selfrepair_${wsId}`,
  sandbox:       wsId => `clawser_sandbox_${wsId}`,
  heartbeat:     wsId => `clawser_heartbeat_${wsId}`,
  routines:      wsId => `clawser_routines_${wsId}`,
  termSessions:  wsId => `clawser_terminal_sessions_${wsId}`,
};

/** @type {object} Shared mutable state singleton — single owner per field, set in clawser-app.js */
export const state = {
  // ── Namespaced groups ──────────────────────────────────────────

  /** UI-related transient state */
  ui: {
    isSending: false,
    currentRoute: null,
    switchingViaRouter: false,
    slashSelectedIdx: -1,
    pendingImportBlob: null,
    cmdSelectedSpec: null,
  },

  /** Service singletons (set by clawser-app.js) */
  services: {
    agent: null,
    providers: null,
    browserTools: null,
    mcpManager: null,
    vault: null,
    workspaceFs: null,
    responseCache: null,
    shell: null,
    skillRegistry: null,
  },

  /** Feature module singletons (set by clawser-app.js) */
  features: {
    toolBuilder: null,
    channelManager: null,
    delegateManager: null,
    gitBehavior: null,
    gitMemory: null,
    automationManager: null,
    sandboxManager: null,
    peripheralManager: null,
    pairingManager: null,
    bridgeManager: null,
    goalManager: null,
    skillRegistryClient: null,
    terminalSessions: null,
    agentStorage: null,
  },

  /** Per-conversation session state */
  session: {
    sessionCost: 0,
    activeConversationId: null,
    activeConversationName: null,
    activeSkillPrompts: new Map(),
    toolCallLog: [],
    eventLog: [],
    eventCount: 0,
    pendingInlineTools: new Map(),
  },

  // ── Remaining flat fields (not namespaced) ─────────────────────
  agentInitialized: false,
  identityManager: null,
  // Block 36: Tool usage tracking
  toolUsageStats: {},
  toolLastUsed: {},
};

// ── Backward-compatible flat aliases (deprecated — use state.ui.X, state.services.X, etc.) ──
for (const [ns, fields] of [
  ['ui', ['isSending', 'currentRoute', 'switchingViaRouter', 'slashSelectedIdx', 'pendingImportBlob', 'cmdSelectedSpec']],
  ['services', ['agent', 'providers', 'browserTools', 'mcpManager', 'vault', 'workspaceFs', 'responseCache', 'shell', 'skillRegistry']],
  ['features', ['toolBuilder', 'channelManager', 'delegateManager', 'gitBehavior', 'gitMemory', 'automationManager', 'sandboxManager', 'peripheralManager', 'pairingManager', 'bridgeManager', 'goalManager', 'skillRegistryClient', 'terminalSessions', 'agentStorage']],
  ['session', ['sessionCost', 'activeConversationId', 'activeConversationName', 'activeSkillPrompts', 'toolCallLog', 'eventLog', 'eventCount', 'pendingInlineTools']],
]) {
  for (const field of fields) {
    if (!(field in state)) {
      Object.defineProperty(state, field, {
        get() { return state[ns][field]; },
        set(v) { state[ns][field] = v; },
        enumerable: true,
        configurable: true,
      });
    }
  }
}

// ── State transition helpers ──────────────────────────────────

/**
 * Set sending state and coerce to boolean.
 * @param {boolean} value - Whether a message send is in progress.
 */
export function setSending(value) {
  state.ui.isSending = !!value;
}

/**
 * Set the active conversation identity (id + name).
 * @param {string|null} id - Conversation ID, or null to clear.
 * @param {string|null} name - Display name, or null to clear.
 */
export function setConversation(id, name) {
  state.session.activeConversationId = id;
  state.session.activeConversationName = name;
  emit('conversationChanged', { id, name });
}

/**
 * Reset transient per-conversation state (cost, skills, inline tools).
 * Also deactivates any active skills in the skill registry.
 */
export function resetConversationState() {
  state.session.sessionCost = 0;
  state.session.activeSkillPrompts.clear();
  state.session.pendingInlineTools.clear();
  // Deactivate all active skills in the registry
  if (state.services.skillRegistry?.activeSkills) {
    for (const name of [...state.services.skillRegistry.activeSkills.keys()]) {
      state.services.skillRegistry.deactivate(name);
    }
  }
  state.session.activeConversationId = null;
  state.session.activeConversationName = null;
  emit('conversationChanged', { id: null, name: null });
}

// ── ConfigCache (Gap 10.4) ─────────────────────────────────────
// Batches localStorage reads/writes to reduce I/O overhead.

/**
 * ConfigCache — an in-memory cache for localStorage with debounced writes.
 * Reads are lazy-loaded from localStorage on first access.
 * Writes go to memory immediately and are flushed to localStorage after 500ms.
 */
export class ConfigCache {
  /** @type {Map<string, string|null>} In-memory cache */
  #cache = new Map();
  /** @type {Set<string>} Keys that have been modified but not yet flushed */
  #dirty = new Set();
  /** @type {number|null} Debounce timer ID */
  #flushTimer = null;
  /** @type {number} Debounce delay in ms */
  #debounceMs;

  /**
   * @param {number} [debounceMs=500] - Delay before flushing dirty keys to localStorage
   */
  constructor(debounceMs = 500) {
    this.#debounceMs = debounceMs;
  }

  /**
   * Get a value by key. Lazy-loads from localStorage on first access.
   * @param {string} key
   * @returns {string|null}
   */
  get(key) {
    if (this.#cache.has(key)) {
      return this.#cache.get(key);
    }
    // Lazy load from localStorage
    const value = localStorage.getItem(key);
    this.#cache.set(key, value);
    return value;
  }

  /**
   * Set a value by key. Writes to in-memory cache immediately,
   * debounces the flush to localStorage.
   * @param {string} key
   * @param {string|null} value - null to remove the key
   */
  set(key, value) {
    this.#cache.set(key, value);
    this.#dirty.add(key);
    this.#scheduleFlush();
  }

  /**
   * Remove a key from both cache and localStorage.
   * @param {string} key
   */
  remove(key) {
    this.set(key, null);
  }

  /**
   * Force-write all dirty keys to localStorage immediately.
   */
  flush() {
    if (this.#flushTimer !== null) {
      clearTimeout(this.#flushTimer);
      this.#flushTimer = null;
    }
    for (const key of this.#dirty) {
      const value = this.#cache.get(key);
      if (value === null || value === undefined) {
        localStorage.removeItem(key);
      } else {
        localStorage.setItem(key, value);
      }
    }
    this.#dirty.clear();
  }

  /**
   * Invalidate a cached key, forcing a re-read from localStorage on next get().
   * @param {string} key
   */
  invalidate(key) {
    this.#cache.delete(key);
    this.#dirty.delete(key);
  }

  /**
   * Clear the entire cache and dirty set.
   */
  clear() {
    if (this.#flushTimer !== null) {
      clearTimeout(this.#flushTimer);
      this.#flushTimer = null;
    }
    this.#cache.clear();
    this.#dirty.clear();
  }

  /** @private Schedule a debounced flush. */
  #scheduleFlush() {
    if (this.#flushTimer !== null) return;
    this.#flushTimer = setTimeout(() => {
      this.#flushTimer = null;
      this.flush();
    }, this.#debounceMs);
  }
}

/** Shared ConfigCache instance for the application. */
export const configCache = new ConfigCache();

// ── Event bus ─────────────────────────────────────────────────
// Registered events (producers → consumers):
//   'refreshFiles'        — ui-chat, cmd-palette → app (calls refreshFiles())
//   'renderGoals'         — ui-chat              → app (calls renderGoals())
//   'renderSkills'        — ui-chat              → app (calls renderSkills())
//   'saveConfig'          — ui-chat              → app (calls saveConfig())
//   'conversationChanged' — transitions          → consumers (signals conv switch)
//   'newShellSession'     — ui-chat              → app (creates fresh shell)
//   'error'               — ui-chat              → consumers (error occurred)
const _listeners = {};

/**
 * Register a listener for an event bus topic.
 * @param {string} event
 * @param {Function} fn
 */
export function on(event, fn) {
  (_listeners[event] ||= []).push(fn);
}

/**
 * Remove a specific listener from an event bus topic.
 * @param {string} event
 * @param {Function} fn - The exact function reference passed to on().
 */
export function off(event, fn) {
  const list = _listeners[event];
  if (!list) return;
  const idx = list.indexOf(fn);
  if (idx !== -1) list.splice(idx, 1);
}

/**
 * Emit an event, calling all registered listeners.
 *
 * Each listener is invoked inside a try/catch so that an error thrown by one
 * listener does not prevent subsequent listeners from executing. Caught errors
 * are logged to `console.error` with the event name as context but are **not**
 * propagated to the caller. This means `emit()` never throws, regardless of
 * listener behavior.
 *
 * @param {string} event - Event bus topic name.
 * @param {...*} args - Arguments forwarded to every registered listener.
 */
export function emit(event, ...args) {
  for (const fn of _listeners[event] || []) {
    try { fn(...args); } catch (e) { console.error(`[event:${event}]`, e); }
  }
}
