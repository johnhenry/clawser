// Run with: node --import ./web/test/_setup-globals.mjs --test web/test/clawser-terminal-sessions.test.mjs
import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

// ── Polyfills ────────────────────────────────────────────────────
// BrowserTool stub — clawser-shell.js imports from clawser-tools.js which exports BrowserTool
globalThis.BrowserTool = class { constructor() {} };

// crypto.randomUUID is needed by createTerminalSessionId
if (!globalThis.crypto?.randomUUID) {
  globalThis.crypto = globalThis.crypto || {};
  globalThis.crypto.randomUUID = () =>
    `${Math.random().toString(36).slice(2)}-${Date.now().toString(36)}`;
}

// ── Dynamic import (after polyfills) ─────────────────────────────
const { createTerminalSessionId, TerminalSessionManager } = await import('../clawser-terminal-sessions.js');

// ── 1. createTerminalSessionId ───────────────────────────────────

describe('createTerminalSessionId', () => {
  it('returns a string', () => {
    const id = createTerminalSessionId();
    assert.equal(typeof id, 'string');
  });

  it('starts with term_', () => {
    const id = createTerminalSessionId();
    assert.ok(id.startsWith('term_'), `expected id to start with "term_", got "${id}"`);
  });

  it('generates unique ids', () => {
    const ids = new Set();
    for (let i = 0; i < 50; i++) {
      ids.add(createTerminalSessionId());
    }
    assert.equal(ids.size, 50, 'expected 50 unique IDs');
  });

  it('has reasonable length (between 10 and 40 chars)', () => {
    const id = createTerminalSessionId();
    assert.ok(id.length >= 10, `id too short: ${id.length}`);
    assert.ok(id.length <= 40, `id too long: ${id.length}`);
  });
});

// ── 2. TerminalSessionManager (constructor only — OPFS not available in Node) ──

describe('TerminalSessionManager', () => {
  it('constructor accepts wsId and shell options', () => {
    const mgr = new TerminalSessionManager({ wsId: 'ws_test', shell: {} });
    // If construction succeeds without throwing, the test passes
    assert.ok(mgr);
  });

  it('activeId starts as null', () => {
    const mgr = new TerminalSessionManager({ wsId: 'ws_test', shell: {} });
    assert.equal(mgr.activeId, null);
  });

  it('list returns empty array initially', () => {
    const mgr = new TerminalSessionManager({ wsId: 'ws_test', shell: {} });
    assert.deepStrictEqual(mgr.list(), []);
  });

  it('events starts as empty array', () => {
    const mgr = new TerminalSessionManager({ wsId: 'ws_test', shell: {} });
    assert.deepStrictEqual(mgr.events, []);
  });
});
