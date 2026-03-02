// Run with: node --import ./web/test/_setup-globals.mjs --test web/test/clawser-shared-worker-config.test.mjs
import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

// Mock elements for $() calls
const _elements = {};
globalThis.document = {
  ...globalThis.document,
  getElementById(id) {
    if (!_elements[id]) {
      _elements[id] = makeMockEl(id);
    }
    return _elements[id];
  },
  createElement(tag) { return makeMockEl(tag); },
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
    checked: false,
    disabled: false,
    className: '',
    style: {},
    dataset: {},
    classList: {
      _classes: new Set(),
      add(c) { this._classes.add(c); },
      remove(c) { this._classes.delete(c); },
      toggle(c) { this._classes.has(c) ? this._classes.delete(c) : this._classes.add(c); },
      contains(c) { return this._classes.has(c); },
    },
    appendChild() {},
    addEventListener() {},
    querySelectorAll() { return []; },
    setAttribute() {},
    getAttribute() { return null; },
  };
}

import {
  loadSharedWorkerConfig,
  saveSharedWorkerConfig,
  isSharedWorkerAvailable,
  updateSharedWorkerStatus,
  renderSharedWorkerSection,
} from '../clawser-ui-config-shared-worker.js';

// ── loadSharedWorkerConfig / saveSharedWorkerConfig ──────────────

describe('SharedWorker config persistence', () => {
  beforeEach(() => {
    localStorage.clear();
    for (const k of Object.keys(_elements)) delete _elements[k];
  });

  it('returns default disabled when nothing saved', () => {
    const config = loadSharedWorkerConfig();
    assert.deepStrictEqual(config, { enabled: false });
  });

  it('round-trips enabled state', () => {
    saveSharedWorkerConfig({ enabled: true });
    const loaded = loadSharedWorkerConfig();
    assert.equal(loaded.enabled, true);
  });

  it('round-trips disabled state', () => {
    saveSharedWorkerConfig({ enabled: false });
    const loaded = loadSharedWorkerConfig();
    assert.equal(loaded.enabled, false);
  });

  it('handles corrupted data gracefully', () => {
    localStorage.setItem('clawser_shared_worker_undefined', '{broken');
    const config = loadSharedWorkerConfig();
    assert.deepStrictEqual(config, { enabled: false });
  });
});

// ── isSharedWorkerAvailable ─────────────────────────────────────

describe('isSharedWorkerAvailable', () => {
  it('returns false when SharedWorker is not defined', () => {
    const orig = globalThis.SharedWorker;
    delete globalThis.SharedWorker;
    assert.equal(isSharedWorkerAvailable(), false);
    if (orig) globalThis.SharedWorker = orig;
  });

  it('returns true when SharedWorker is defined', () => {
    globalThis.SharedWorker = class {};
    assert.equal(isSharedWorkerAvailable(), true);
    delete globalThis.SharedWorker;
  });
});

// ── updateSharedWorkerStatus ────────────────────────────────────

describe('updateSharedWorkerStatus', () => {
  beforeEach(() => {
    localStorage.clear();
    for (const k of Object.keys(_elements)) delete _elements[k];
  });

  it('shows disconnected when no client but SharedWorker available', () => {
    // Define SharedWorker so the feature-detect passes
    globalThis.SharedWorker = class {};
    updateSharedWorkerStatus();
    const dot = globalThis.document.getElementById('swStatusDot');
    const label = globalThis.document.getElementById('swStatusLabel');
    assert.equal(dot.className, 'sw-status-dot off');
    assert.equal(label.textContent, 'Disconnected');
    delete globalThis.SharedWorker;
  });

  it('shows unavailable when SharedWorker is not in browser', () => {
    delete globalThis.SharedWorker;
    updateSharedWorkerStatus();
    const label = globalThis.document.getElementById('swStatusLabel');
    assert.ok(label.textContent.includes('Unavailable'));
  });
});

// ── renderSharedWorkerSection ───────────────────────────────────

describe('renderSharedWorkerSection', () => {
  beforeEach(() => {
    localStorage.clear();
    for (const k of Object.keys(_elements)) delete _elements[k];
  });

  it('sets checkbox to saved state', () => {
    saveSharedWorkerConfig({ enabled: true });
    renderSharedWorkerSection();
    const checkbox = globalThis.document.getElementById('sharedWorkerEnabled');
    assert.equal(checkbox.checked, true);
  });

  it('defaults checkbox to unchecked', () => {
    renderSharedWorkerSection();
    const checkbox = globalThis.document.getElementById('sharedWorkerEnabled');
    assert.equal(checkbox.checked, false);
  });
});
