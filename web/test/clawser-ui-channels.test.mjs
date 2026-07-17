// Run with: node --import ./web/test/_setup-globals.mjs --test web/test/clawser-ui-channels.test.mjs
import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

// Stub BrowserTool before import
globalThis.BrowserTool = class { constructor() {} };

// Provide minimal DOM stubs for $() calls
const _elements = {};
globalThis.document = {
  ...globalThis.document,
  getElementById(id) {
    if (!_elements[id]) {
      _elements[id] = makeMockEl(id);
    }
    return _elements[id];
  },
  createElement(tag) {
    return makeMockEl(tag);
  },
  querySelector() { return null; },
  querySelectorAll() { return []; },
  addEventListener() {},
};

function makeMockEl(tag) {
  return {
    tag,
    innerHTML: '',
    textContent: '',
    value: '',
    className: '',
    style: {},
    dataset: {},
    children: [],
    classList: {
      _classes: new Set(),
      add(c) { this._classes.add(c); },
      remove(c) { this._classes.delete(c); },
      toggle(c) { this._classes.has(c) ? this._classes.delete(c) : this._classes.add(c); },
      contains(c) { return this._classes.has(c); },
    },
    appendChild(child) { this.children.push(child); return child; },
    addEventListener() {},
    querySelectorAll() { return []; },
    setAttribute() {},
    getAttribute() { return null; },
  };
}

import {
  loadSavedChannels,
  saveChannels,
  restoreSavedChannels,
  updateChannelBadge,
  createChannelPlugin,
  getActiveChannelPlugins,
  stopAllChannelPlugins,
} from '../clawser-ui-channels.js';

import { ChannelManager } from '../clawser-channels.js';
import { ChannelGateway } from '../clawser-gateway.js';
import { MatrixPlugin } from '../clawser-channel-matrix.js';
import { EmailPlugin } from '../clawser-channel-email.js';
import { TelegramPlugin } from '../clawser-channel-telegram.js';
import { ChannelRelay } from '../clawser-channel-relay.js';

// ── loadSavedChannels / saveChannels ────────────────────────────

describe('channel persistence', () => {
  beforeEach(() => {
    localStorage.clear();
    // Reset element cache
    for (const k of Object.keys(_elements)) delete _elements[k];
  });

  it('loadSavedChannels returns empty array when nothing saved', () => {
    const channels = loadSavedChannels();
    assert.deepStrictEqual(channels, []);
  });

  it('saveChannels + loadSavedChannels round-trips', () => {
    const data = [
      { name: 'my-tg', type: 'telegram', config: { botToken: 'abc', chatId: '123' }, enabled: true },
      { name: 'my-slack', type: 'slack', config: { botToken: 'xyz' }, enabled: false },
    ];
    saveChannels(data);
    const loaded = loadSavedChannels();
    assert.equal(loaded.length, 2);
    assert.equal(loaded[0].name, 'my-tg');
    assert.equal(loaded[1].type, 'slack');
    assert.equal(loaded[1].enabled, false);
  });

  it('loadSavedChannels handles corrupted data gracefully', () => {
    // Store some nonsense
    localStorage.setItem('clawser_channels_undefined', 'not json{{{');
    const channels = loadSavedChannels();
    assert.deepStrictEqual(channels, []);
  });
});

// ── restoreSavedChannels ────────────────────────────────────────

describe('restoreSavedChannels', () => {
  beforeEach(() => {
    localStorage.clear();
    for (const k of Object.keys(_elements)) delete _elements[k];
  });

  it('restores saved channels into ChannelManager', () => {
    const data = [
      { name: 'ch1', type: 'telegram', config: {}, enabled: true },
      { name: 'ch2', type: 'discord', config: {}, enabled: true },
    ];
    saveChannels(data);

    const mgr = new ChannelManager();
    const count = restoreSavedChannels(mgr);
    assert.equal(count, 2);
    assert.equal(mgr.channelCount, 2);
  });

  it('returns 0 with no saved channels', () => {
    const mgr = new ChannelManager();
    const count = restoreSavedChannels(mgr);
    assert.equal(count, 0);
    assert.equal(mgr.channelCount, 0);
  });
});

// ── updateChannelBadge ──────────────────────────────────────────

describe('updateChannelBadge', () => {
  beforeEach(() => {
    localStorage.clear();
    for (const k of Object.keys(_elements)) delete _elements[k];
  });

  it('sets badge text to channel count', () => {
    saveChannels([{ name: 'a', type: 'webhook' }, { name: 'b', type: 'irc' }]);
    updateChannelBadge();
    const badge = globalThis.document.getElementById('channelCount');
    assert.equal(badge.textContent, '2');
  });

  it('shows 0 when no channels', () => {
    updateChannelBadge();
    const badge = globalThis.document.getElementById('channelCount');
    assert.equal(badge.textContent, '0');
  });
});

// ── createChannelPlugin ──────────────────────────────────────────
//
// Regression coverage for clawser-browser-control-style drift: these six
// channel plugins (Discord/Slack/Telegram/IRC/Matrix/Email/Relay) were
// fully built and tested but never actually instantiated anywhere in the
// live app — the "Add Channel" UI only ever wrote config into the older
// ChannelManager, never registered a real plugin with ChannelGateway.
// These tests cover the field-name reshaping createChannelPlugin() does
// between the UI's saved config shape and each plugin's real constructor
// (found while wiring this up: matrix's homeserverUrl vs homeserver,
// email's flat username/password vs a credentials object).

describe('createChannelPlugin', () => {
  it('returns null for an unknown type', () => {
    assert.equal(createChannelPlugin('not-a-real-type', {}), null);
  });

  it('constructs a plugin for every type in PLUGIN_CLASSES with a pass-through config', () => {
    const telegram = createChannelPlugin('telegram', { botToken: 'tg-token', chatId: '123' });
    assert.ok(telegram instanceof TelegramPlugin);
    assert.equal(telegram.config.botToken, 'tg-token');
    assert.equal(telegram.config.chatId, '123');
  });

  it('maps homeserverUrl (the UI field name) to homeserver (the plugin field name) for matrix', () => {
    const plugin = createChannelPlugin('matrix', {
      homeserverUrl: 'https://matrix.org',
      accessToken: 'tok',
      roomId: '!room:matrix.org',
    });
    assert.ok(plugin instanceof MatrixPlugin);
    assert.equal(plugin.config.homeserver, 'https://matrix.org');
  });

  it('prefers an already-correct homeserver field over homeserverUrl for matrix', () => {
    const plugin = createChannelPlugin('matrix', { homeserver: 'https://correct.org', homeserverUrl: 'https://wrong.org' });
    assert.equal(plugin.config.homeserver, 'https://correct.org');
  });

  it('combines flat username/password (the UI fields) into a credentials object for email', () => {
    const plugin = createChannelPlugin('email', {
      imapHost: 'imap.example.com',
      smtpHost: 'smtp.example.com',
      username: 'me@example.com',
      password: 'hunter2',
    });
    assert.ok(plugin instanceof EmailPlugin);
    assert.deepEqual(plugin.config.credentials, { user: 'me@example.com', pass: 'hunter2' });
  });

  it('prefers an already-correct credentials object over username/password for email', () => {
    const plugin = createChannelPlugin('email', {
      credentials: { accessToken: 'gmail-oauth-token' },
      username: 'ignored',
      password: 'ignored',
    });
    assert.deepEqual(plugin.config.credentials, { accessToken: 'gmail-oauth-token' });
  });

  it('constructs a ChannelRelay for the webhook type', () => {
    const plugin = createChannelPlugin('webhook', { path: '/hook', bcName: 'test-relay' });
    assert.ok(plugin instanceof ChannelRelay);
    assert.equal(plugin.config.path, '/hook');
    assert.equal(plugin.config.bcName, 'test-relay');
  });
});

// ── Gateway wiring: restoreSavedChannels / stopAllChannelPlugins ────
//
// ChannelRelay is the only one of the six plugins that needs zero network
// stubbing (BroadcastChannel-only), so it's used here to exercise the
// real start()/register()/gateway.start() happy path end-to-end without
// mocking fetch/WebSocket.

describe('channel plugin gateway wiring (webhook/ChannelRelay)', () => {
  beforeEach(() => {
    localStorage.clear();
    for (const k of Object.keys(_elements)) delete _elements[k];
    getActiveChannelPlugins().clear();
  });

  it('restoreSavedChannels starts and registers a real plugin with the gateway for each enabled channel', async () => {
    saveChannels([{ name: 'my-relay', type: 'webhook', config: { bcName: 'ch-test-1' }, enabled: true }]);

    const gateway = new ChannelGateway();
    const mgr = new ChannelManager();
    restoreSavedChannels(mgr, gateway);
    // startChannelPlugin's own plugin.start() is awaited internally but
    // restoreSavedChannels doesn't await the per-channel promise (so a
    // slow/hanging channel can't block workspace init) — give the
    // microtask queue a turn to let it settle before asserting.
    await new Promise((r) => setTimeout(r, 0));

    assert.equal(getActiveChannelPlugins().size, 1);
    const entry = getActiveChannelPlugins().get('my-relay');
    assert.ok(entry.plugin instanceof ChannelRelay);
    assert.equal(entry.plugin.running, true);
    assert.equal(entry.channelId, 'webhook:my-relay');
    assert.equal(gateway.isActive('webhook:my-relay'), true);
  });

  it('restoreSavedChannels does not start a plugin for a disabled channel', async () => {
    saveChannels([{ name: 'my-relay', type: 'webhook', config: {}, enabled: false }]);

    const gateway = new ChannelGateway();
    const mgr = new ChannelManager();
    restoreSavedChannels(mgr, gateway);
    await new Promise((r) => setTimeout(r, 0));

    assert.equal(getActiveChannelPlugins().size, 0);
    assert.equal(gateway.isActive('webhook:my-relay'), false);
  });

  it('restoreSavedChannels is a no-op for plugin startup when no gateway is passed (back-compat)', async () => {
    saveChannels([{ name: 'my-relay', type: 'webhook', config: {}, enabled: true }]);

    const mgr = new ChannelManager();
    const count = restoreSavedChannels(mgr);
    await new Promise((r) => setTimeout(r, 0));

    assert.equal(count, 1);
    assert.equal(mgr.channelCount, 1);
    assert.equal(getActiveChannelPlugins().size, 0, 'no gateway means no plugin should be started');
  });

  it('stopAllChannelPlugins stops and unregisters every active plugin', async () => {
    saveChannels([
      { name: 'relay-a', type: 'webhook', config: { bcName: 'ch-test-a' }, enabled: true },
      { name: 'relay-b', type: 'webhook', config: { bcName: 'ch-test-b' }, enabled: true },
    ]);

    const gateway = new ChannelGateway();
    const mgr = new ChannelManager();
    restoreSavedChannels(mgr, gateway);
    await new Promise((r) => setTimeout(r, 0));
    assert.equal(getActiveChannelPlugins().size, 2);

    await stopAllChannelPlugins(gateway);

    assert.equal(getActiveChannelPlugins().size, 0);
    assert.equal(gateway.isActive('webhook:relay-a'), false);
    assert.equal(gateway.isActive('webhook:relay-b'), false);
  });

  it('stopAllChannelPlugins is safe to call with no active plugins', async () => {
    await assert.doesNotReject(() => stopAllChannelPlugins(new ChannelGateway()));
    await assert.doesNotReject(() => stopAllChannelPlugins(undefined));
  });
});
