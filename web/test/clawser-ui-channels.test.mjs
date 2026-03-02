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
} from '../clawser-ui-channels.js';

import { ChannelManager } from '../clawser-channels.js';

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
