// clawser-state.js — Shared state singleton, DOM helpers, event bus

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
};

/** @type {object} Shared mutable state singleton — single owner per field, set in clawser-app.js */
export const state = {
  agent: null,
  isSending: false,
  sessionCost: 0,
  activeConversationId: null,
  activeConversationName: null,
  toolCallLog: [],
  eventLog: [],
  eventCount: 0,
  activeSkillPrompts: new Map(),
  currentRoute: null,

  agentInitialized: false,
  switchingViaRouter: false,
  pendingInlineTools: new Map(),
  cmdSelectedSpec: null,
  slashSelectedIdx: -1,
  pendingImportBlob: null,
  skillRegistry: null,
  shell: null,
  responseCache: null,
  // Service singletons (set by clawser-app.js)
  workspaceFs: null,
  browserTools: null,
  providers: null,
  mcpManager: null,
  vault: null,
};

// ── State transition helpers ──────────────────────────────────

/**
 * Set sending state and coerce to boolean.
 * @param {boolean} value - Whether a message send is in progress.
 */
export function setSending(value) {
  state.isSending = !!value;
}

/**
 * Set the active conversation identity (id + name).
 * @param {string|null} id - Conversation ID, or null to clear.
 * @param {string|null} name - Display name, or null to clear.
 */
export function setConversation(id, name) {
  state.activeConversationId = id;
  state.activeConversationName = name;
  emit('conversationChanged', { id, name });
}

/**
 * Reset transient per-conversation state (cost, skills, inline tools).
 * Also deactivates any active skills in the skill registry.
 */
export function resetConversationState() {
  state.sessionCost = 0;
  state.activeSkillPrompts.clear();
  state.pendingInlineTools.clear();
  // Deactivate all active skills in the registry
  if (state.skillRegistry?.activeSkills) {
    for (const name of [...state.skillRegistry.activeSkills.keys()]) {
      state.skillRegistry.deactivate(name);
    }
  }
  state.activeConversationId = null;
  state.activeConversationName = null;
  emit('conversationChanged', { id: null, name: null });
}

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
