// Run with: node --import ./web/test/_setup-globals.mjs --test web/test/clawser-router.test.mjs
import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import {
  PANELS,
  PANEL_NAMES,
  parseHash,
  navigate,
  isPanelRendered,
  resetRenderedPanels,
} from '../clawser-router.js';

// ── PANELS constant (3 tests) ───────────────────────────────────

describe('PANELS', () => {
  it('is a frozen object', () => {
    assert.ok(Object.isFrozen(PANELS));
  });

  it('has all expected panel keys', () => {
    const expected = [
      'chat', 'tools', 'files', 'memory', 'goals', 'events',
      'skills', 'terminal', 'dashboard', 'servers', 'toolMgmt',
      'agents', 'config',
    ];
    for (const key of expected) {
      assert.ok(key in PANELS, `missing panel key: ${key}`);
    }
  });

  it('each panel has id, btn, and label properties', () => {
    for (const [key, panel] of Object.entries(PANELS)) {
      assert.ok(typeof panel.id === 'string', `${key}.id should be a string`);
      assert.ok(typeof panel.btn === 'string', `${key}.btn should be a string`);
      assert.ok(typeof panel.label === 'string', `${key}.label should be a string`);
    }
  });
});

// ── PANEL_NAMES constant (3 tests) ──────────────────────────────

describe('PANEL_NAMES', () => {
  it('is a Set', () => {
    assert.ok(PANEL_NAMES instanceof Set);
  });

  it('contains all panel keys', () => {
    for (const key of Object.keys(PANELS)) {
      assert.ok(PANEL_NAMES.has(key), `PANEL_NAMES missing: ${key}`);
    }
  });

  it('has expected size matching PANELS keys', () => {
    assert.equal(PANEL_NAMES.size, Object.keys(PANELS).length);
  });
});

// ── parseHash (5 tests) ─────────────────────────────────────────

describe('parseHash', () => {
  beforeEach(() => {
    location.hash = '';
  });

  it('returns home route for empty hash', () => {
    location.hash = '';
    const result = parseHash();
    assert.equal(result.route, 'home');
  });

  it('parses workspace route', () => {
    location.hash = '#workspace/ws1';
    const result = parseHash();
    assert.equal(result.route, 'workspace');
    assert.equal(result.wsId, 'ws1');
    assert.equal(result.convId, null);
    assert.equal(result.panel, null);
  });

  it('parses workspace with panel', () => {
    location.hash = '#workspace/ws1/tools';
    const result = parseHash();
    assert.equal(result.route, 'workspace');
    assert.equal(result.wsId, 'ws1');
    assert.equal(result.panel, 'tools');
  });

  it('parses workspace with conversation', () => {
    location.hash = '#workspace/ws1/conversation/conv42';
    const result = parseHash();
    assert.equal(result.route, 'workspace');
    assert.equal(result.wsId, 'ws1');
    assert.equal(result.convId, 'conv42');
    assert.equal(result.panel, 'chat');
  });

  it('parses wsh-session route', () => {
    location.hash = '#wsh/session/abc123?token=XYZ&mode=read&host=example.com';
    const result = parseHash();
    assert.equal(result.route, 'wsh-session');
    assert.ok(result.wshSession);
    assert.equal(result.wshSession.sessionId, 'abc123');
    assert.equal(result.wshSession.token, 'XYZ');
    assert.equal(result.wshSession.mode, 'read');
    assert.equal(result.wshSession.host, 'example.com');
  });
});

// ── navigate (3 tests) ──────────────────────────────────────────

describe('navigate', () => {
  beforeEach(() => {
    location.hash = '';
  });

  it('sets hash for workspace route', () => {
    navigate('workspace', 'ws42');
    assert.equal(location.hash, '#workspace/ws42');
  });

  it('sets hash for workspace with conversation', () => {
    navigate('workspace', 'ws42', 'conv7');
    assert.equal(location.hash, '#workspace/ws42/conversation/conv7');
  });

  it('clears hash for home route', () => {
    location.hash = '#workspace/ws1';
    navigate('home');
    assert.equal(location.hash, '');
  });
});

// ── isPanelRendered / resetRenderedPanels (3 tests) ─────────────

describe('isPanelRendered / resetRenderedPanels', () => {
  it('chat is rendered by default', () => {
    // On module load, chat is added to renderedPanels
    assert.equal(isPanelRendered('chat'), true);
  });

  it('non-activated panels are not rendered', () => {
    // tools panel was never activated in tests
    assert.equal(isPanelRendered('tools'), false);
  });

  it('resetRenderedPanels clears all and re-adds chat', () => {
    resetRenderedPanels();
    assert.equal(isPanelRendered('chat'), true);
    assert.equal(isPanelRendered('tools'), false);
    assert.equal(isPanelRendered('memory'), false);
  });
});
