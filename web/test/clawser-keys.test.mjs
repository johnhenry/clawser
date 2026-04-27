/**
 * clawser-keys.test.mjs — Tests for keyboard shortcut module
 *
 * Covers: Escape closing overlays, Cmd+Enter send, Cmd+K palette,
 * Cmd+N new conversation, Cmd+1..9 panel switching, modifier key detection.
 */
import { describe, it, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'

// ── Stub browser globals ────────────────────────────────────────

const store = {}
globalThis.localStorage = {
  getItem: (k) => store[k] ?? null,
  setItem: (k, v) => { store[k] = String(v) },
  removeItem: (k) => { delete store[k] },
  clear: () => { for (const k of Object.keys(store)) delete store[k] },
}

// Track keydown listener registered by initKeyboardShortcuts
let _keydownHandlers = []

const _domElements = {}

function makeMockEl(tag) {
  const children = []
  const listeners = {}
  const el = {
    tagName: tag,
    style: {},
    className: '',
    textContent: '',
    innerHTML: '',
    dataset: {},
    value: '',
    disabled: false,
    children,
    classList: {
      _classes: new Set(),
      add(...cls) { cls.forEach(c => this._classes.add(c)) },
      remove(...cls) { cls.forEach(c => this._classes.delete(c)) },
      contains(c) { return this._classes.has(c) },
      toggle(c) { if (this._classes.has(c)) { this._classes.delete(c); return false } else { this._classes.add(c); return true } },
    },
    addEventListener(evt, fn) { (listeners[evt] ||= []).push(fn) },
    _listeners: listeners,
    appendChild(c) { children.push(c); return c },
    remove() {},
    querySelectorAll() { return [] },
    querySelector(sel) {
      if (sel === '.item-bar-new') return _domElements._newConvBtn || null
      return null
    },
    setAttribute() {},
    dispatchEvent() {},
    focus() { el._focused = true },
    click() {
      el._clicked = true
      const fns = listeners.click || []
      for (const fn of fns) fn()
    },
    _focused: false,
    _clicked: false,
    get lastChild() { return children[children.length - 1] || null },
    get scrollHeight() { return 500 },
    scrollTop: 0,
  }
  return el
}

function resetDom() {
  _keydownHandlers = []
  const ids = [
    'slashAutocomplete', 'cmdPalette', 'wsDropdown', 'sendBtn',
    'cmdPaletteBtn', 'userInput',
    // Dependencies from ui-chat
    'messages', 'toolCount', 'eventCount', 'toolCalls', 'eventLog',
    'statusDot', 'statusText', 'costDisplay', 'stHistory', 'stMemory',
    'stGoals', 'stJobs', 'goalCount', 'memCount',
    'systemPrompt', 'convBarContainer', 'cmdSearch', 'cmdParamArea',
    'cmdRun', 'cmdToolList', 'cmdCancel',
  ]
  for (const id of ids) {
    _domElements[id] = makeMockEl('div')
    _domElements[id]._clicked = false
    _domElements[id]._focused = false
  }
  _domElements._newConvBtn = makeMockEl('button')
  _domElements._newConvBtn._clicked = false
}

// Default mock element for any unknown ID (avoids null errors from activatePanel etc.)
const _defaultEl = makeMockEl('div')
globalThis.document = {
  getElementById: (id) => _domElements[id] || _defaultEl,
  createElement: (tag) => makeMockEl(tag),
  createTextNode: (t) => ({ textContent: t, className: '' }),
  addEventListener: (evt, fn) => {
    if (evt === 'keydown') _keydownHandlers.push(fn)
  },
  querySelectorAll: () => [],
  querySelector: (sel) => {
    if (sel === '.item-bar-new') return _domElements._newConvBtn || null
    return null
  },
  head: { appendChild() {} },
  body: { appendChild() {} },
}

globalThis.window = globalThis
globalThis.location = { search: '', hash: '', href: '' }
globalThis.history = { replaceState() {} }
// navigator is effectively read-only in Node — patch individual properties
if (globalThis.navigator) {
  try {
    Object.defineProperty(globalThis.navigator, 'platform', {
      value: 'MacIntel', configurable: true, writable: true,
    })
  } catch { /* already patched */ }
  try {
    Object.defineProperty(globalThis.navigator, 'clipboard', {
      value: { writeText: async () => {} }, configurable: true,
    })
  } catch { /* already patched */ }
  try {
    Object.defineProperty(globalThis.navigator, 'storage', {
      value: { getDirectory: async () => ({}) }, configurable: true,
    })
  } catch { /* already patched */ }
}
globalThis.BroadcastChannel = class { postMessage() {} close() {} onmessage() {} }
globalThis.CustomEvent = globalThis.CustomEvent || class CustomEvent { constructor(type, opts) { this.type = type; this.detail = opts?.detail } }
globalThis.Blob = class { constructor() {} }
globalThis.URL = globalThis.URL || URL
globalThis.TextEncoder = globalThis.TextEncoder || TextEncoder
globalThis.TextDecoder = globalThis.TextDecoder || TextDecoder
if (!globalThis.crypto?.randomUUID) {
  globalThis.crypto = globalThis.crypto || {}
  globalThis.crypto.randomUUID = () => 'aaaa-bbbb-cccc-dddd'
}

// Stub activatePanel to track calls
let _lastActivatedPanel = null
// We need to stub the router module before import
// Since clawser-keys imports activatePanel from clawser-router,
// and clawser-router uses $ and state, they'll work with our stubs

import { state } from '../clawser-state.js'
import { initKeyboardShortcuts } from '../clawser-keys.js'

// ── Helpers ─────────────────────────────────────────────────────

function fireKey(key, opts = {}) {
  const event = {
    key,
    metaKey: opts.metaKey || false,
    ctrlKey: opts.ctrlKey || false,
    shiftKey: opts.shiftKey || false,
    _prevented: false,
    preventDefault() { this._prevented = true },
  }
  for (const handler of _keydownHandlers) {
    handler(event)
  }
  return event
}

// ── Setup ───────────────────────────────────────────────────────

beforeEach(() => {
  resetDom()
  // Re-register handlers
  initKeyboardShortcuts()
})

// ── Escape key ──────────────────────────────────────────────────

describe('Escape key', () => {
  it('closes slash autocomplete when visible', () => {
    _domElements.slashAutocomplete.classList.add('visible')
    const e = fireKey('Escape')
    assert.ok(!_domElements.slashAutocomplete.classList.contains('visible'))
    assert.ok(e._prevented)
  })

  it('closes command palette when visible', () => {
    _domElements.cmdPalette.classList.add('visible')
    const e = fireKey('Escape')
    assert.ok(!_domElements.cmdPalette.classList.contains('visible'))
    assert.ok(e._prevented)
  })

  it('closes workspace dropdown when visible', () => {
    _domElements.wsDropdown.classList.add('visible')
    const e = fireKey('Escape')
    assert.ok(!_domElements.wsDropdown.classList.contains('visible'))
    assert.ok(e._prevented)
  })

  it('prioritizes autocomplete over palette', () => {
    _domElements.slashAutocomplete.classList.add('visible')
    _domElements.cmdPalette.classList.add('visible')
    fireKey('Escape')
    // Autocomplete should close first
    assert.ok(!_domElements.slashAutocomplete.classList.contains('visible'))
    // Palette should still be visible (handled in next Escape press)
    assert.ok(_domElements.cmdPalette.classList.contains('visible'))
  })

  it('does nothing when nothing is open', () => {
    const e = fireKey('Escape')
    assert.ok(!e._prevented)
  })
})

// ── Cmd+Enter — Send message ──────────────────────────────────

describe('Cmd+Enter', () => {
  it('clicks send button on Mac (metaKey)', () => {
    _domElements.sendBtn.disabled = false
    const e = fireKey('Enter', { metaKey: true })
    assert.ok(_domElements.sendBtn._clicked)
    assert.ok(e._prevented)
  })

  it('does not click disabled send button', () => {
    _domElements.sendBtn.disabled = true
    fireKey('Enter', { metaKey: true })
    assert.ok(!_domElements.sendBtn._clicked)
  })

  it('does nothing without modifier', () => {
    _domElements.sendBtn.disabled = false
    fireKey('Enter')
    assert.ok(!_domElements.sendBtn._clicked)
  })
})

// ── Cmd+K — Command palette ──────────────────────────────────

describe('Cmd+K', () => {
  it('clicks palette button when enabled', () => {
    _domElements.cmdPaletteBtn.disabled = false
    const e = fireKey('k', { metaKey: true })
    assert.ok(_domElements.cmdPaletteBtn._clicked)
    assert.ok(e._prevented)
  })

  it('focuses input as fallback when palette button disabled', () => {
    _domElements.cmdPaletteBtn.disabled = true
    fireKey('k', { metaKey: true })
    assert.ok(_domElements.userInput._focused)
  })

  it('works with uppercase K', () => {
    _domElements.cmdPaletteBtn.disabled = false
    const e = fireKey('K', { metaKey: true })
    assert.ok(_domElements.cmdPaletteBtn._clicked)
    assert.ok(e._prevented)
  })
})

// ── Cmd+N — New conversation ────────────────────────────────────

describe('Cmd+N', () => {
  it('clicks new conversation button', () => {
    const e = fireKey('n', { metaKey: true })
    assert.ok(_domElements._newConvBtn._clicked)
    assert.ok(e._prevented)
  })

  it('skips when shift is also held (browser new-window)', () => {
    const e = fireKey('n', { metaKey: true, shiftKey: true })
    assert.ok(!_domElements._newConvBtn._clicked)
  })

  it('works with uppercase N', () => {
    fireKey('N', { metaKey: true })
    assert.ok(_domElements._newConvBtn._clicked)
  })
})

// ── Cmd+1..9 — Panel switching ──────────────────────────────────

describe('Cmd+1..9 panel switching', () => {
  // We can't easily verify activatePanel was called without deeper mocking,
  // but we can verify preventDefault is called for valid digits

  it('prevents default for Cmd+1', () => {
    const e = fireKey('1', { metaKey: true })
    assert.ok(e._prevented)
  })

  it('prevents default for Cmd+9', () => {
    const e = fireKey('9', { metaKey: true })
    assert.ok(e._prevented)
  })

  it('does not prevent default without modifier', () => {
    const e = fireKey('1')
    assert.ok(!e._prevented)
  })

  it('does not prevent default for Cmd+0', () => {
    const e = fireKey('0', { metaKey: true })
    // 0 is not in 1-9 range, parseInt('0') = 0
    assert.ok(!e._prevented)
  })
})

// ── No-modifier passthrough ─────────────────────────────────────

describe('No-modifier passthrough', () => {
  it('ignores regular letter keys', () => {
    const e = fireKey('a')
    assert.ok(!e._prevented)
  })

  it('ignores numbers without modifier', () => {
    const e = fireKey('5')
    assert.ok(!e._prevented)
  })
})
