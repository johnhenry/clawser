// Run with: node --import ./web/test/_setup-globals.mjs --test web/test/clawser-tab-views.test.mjs
import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import {
  TabViewManager,
  parseTabViewHash,
  buildTabViewUrl,
  TAB_VIEW_CHANNEL,
} from '../clawser-tab-views.js';

// ── Constants ───────────────────────────────────────────────────

describe('TAB_VIEW_CHANNEL', () => {
  it('is a non-empty string', () => {
    assert.equal(typeof TAB_VIEW_CHANNEL, 'string');
    assert.ok(TAB_VIEW_CHANNEL.length > 0);
  });
});

// ── parseTabViewHash ────────────────────────────────────────────

describe('parseTabViewHash', () => {
  it('parses workspace/wsId/panel hash', () => {
    const result = parseTabViewHash('#workspace/ws123/chat');
    assert.equal(result.wsId, 'ws123');
    assert.equal(result.panel, 'chat');
    assert.equal(result.singlePanel, true);
  });

  it('returns null for non-workspace hash', () => {
    const result = parseTabViewHash('#home');
    assert.equal(result, null);
  });

  it('returns null for empty hash', () => {
    const result = parseTabViewHash('');
    assert.equal(result, null);
  });

  it('returns null for hash with only workspace and wsId (no panel)', () => {
    const result = parseTabViewHash('#workspace/ws123');
    assert.equal(result, null);
  });

  it('handles leading slash in hash', () => {
    const result = parseTabViewHash('#/workspace/ws456/terminal');
    assert.equal(result.wsId, 'ws456');
    assert.equal(result.panel, 'terminal');
  });
});

// ── buildTabViewUrl ─────────────────────────────────────────────

describe('buildTabViewUrl', () => {
  it('builds a URL with workspace hash', () => {
    const url = buildTabViewUrl('ws-abc', 'files');
    assert.ok(url.includes('#workspace/ws-abc/files'));
  });

  it('includes origin in the URL', () => {
    const url = buildTabViewUrl('ws-abc', 'chat');
    // In test env, origin is empty string, so just check hash part
    assert.ok(url.endsWith('#workspace/ws-abc/chat'));
  });
});

// ── TabViewManager ──────────────────────────────────────────────

describe('TabViewManager', () => {
  let manager;

  beforeEach(() => {
    manager = new TabViewManager();
  });

  it('constructor initializes with empty open views', () => {
    assert.equal(manager.openViews.length, 0);
  });

  it('popOut records a view as open', () => {
    // window.open is not available in Node, mock it
    let openedUrl = null;
    manager._windowOpen = (url) => {
      openedUrl = url;
      return { closed: false };
    };
    manager.popOut('ws-1', 'files');
    assert.equal(manager.openViews.length, 1);
    assert.ok(openedUrl.includes('#workspace/ws-1/files'));
  });

  it('popOut does not duplicate existing view', () => {
    manager._windowOpen = () => ({ closed: false });
    manager.popOut('ws-1', 'files');
    manager.popOut('ws-1', 'files');
    assert.equal(manager.openViews.length, 1);
  });

  it('popOut allows different panels for same workspace', () => {
    manager._windowOpen = () => ({ closed: false });
    manager.popOut('ws-1', 'files');
    manager.popOut('ws-1', 'terminal');
    assert.equal(manager.openViews.length, 2);
  });

  it('closeView removes a view', () => {
    const win = { closed: false, close: () => {} };
    manager._windowOpen = () => win;
    manager.popOut('ws-1', 'chat');
    manager.closeView('ws-1', 'chat');
    assert.equal(manager.openViews.length, 0);
  });

  it('cleanupClosed removes views with closed windows', () => {
    const win1 = { closed: false };
    const win2 = { closed: true };
    manager._windowOpen = () => win1;
    manager.popOut('ws-1', 'files');
    manager._windowOpen = () => win2;
    manager.popOut('ws-1', 'terminal');
    manager.cleanupClosed();
    assert.equal(manager.openViews.length, 1);
    assert.equal(manager.openViews[0].panel, 'files');
  });

  it('broadcastSync sends sync message via BroadcastChannel', () => {
    const messages = [];
    const OrigBC = globalThis.BroadcastChannel;
    globalThis.BroadcastChannel = class {
      postMessage(data) { messages.push(data); }
      close() {}
    };

    manager.broadcastSync({ action: 'panel-update', wsId: 'ws-1', panel: 'chat' });

    globalThis.BroadcastChannel = OrigBC;

    assert.equal(messages.length, 1);
    assert.equal(messages[0].action, 'panel-update');
    assert.equal(messages[0].wsId, 'ws-1');
  });

  it('isSinglePanelMode detects single panel hash', () => {
    // Simulate being in a popped-out tab
    globalThis.location.hash = '#workspace/ws-1/files';
    const result = manager.isSinglePanelMode();
    assert.equal(result.singlePanel, true);
    assert.equal(result.panel, 'files');
    globalThis.location.hash = '';
  });

  it('isSinglePanelMode returns null for normal mode', () => {
    globalThis.location.hash = '';
    const result = manager.isSinglePanelMode();
    assert.equal(result, null);
  });
});
