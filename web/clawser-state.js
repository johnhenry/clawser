// clawser-state.js — Shared state singleton, DOM helpers, event bus

export const $ = id => document.getElementById(id);

export function esc(s) {
  return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

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
  // Service singletons (set by clawser-app.js)
  workspaceFs: null,
  browserTools: null,
  providers: null,
  mcpManager: null,
};

// Minimal callback bus for cross-module triggers (avoids circular imports)
const _listeners = {};

export function on(event, fn) {
  (_listeners[event] ||= []).push(fn);
}

export function emit(event, ...args) {
  for (const fn of _listeners[event] || []) {
    try { fn(...args); } catch (e) { console.error(`[event:${event}]`, e); }
  }
}
