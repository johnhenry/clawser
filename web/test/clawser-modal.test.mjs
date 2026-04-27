/**
 * clawser-modal.test.mjs — Tests for modal dialog system
 *
 * Covers: alert/confirm/prompt dialogs, button rendering,
 * input handling, cancel behavior, and danger mode styling.
 */
import { describe, it, beforeEach } from 'node:test'
import assert from 'node:assert/strict'

// ── Stub browser globals ───────────────────────��────────────────

const store = {}
globalThis.localStorage = {
  getItem: (k) => store[k] ?? null,
  setItem: (k, v) => { store[k] = String(v) },
  removeItem: (k) => { delete store[k] },
  clear: () => { for (const k of Object.keys(store)) delete store[k] },
}

// Track appended overlays
let _bodyChildren = []
let _lastOverlay = null

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
    children,
    classList: {
      _classes: new Set(),
      add(...cls) { cls.forEach(c => this._classes.add(c)) },
      remove(...cls) { cls.forEach(c => this._classes.delete(c)) },
      contains(c) { return this._classes.has(c) },
    },
    addEventListener(evt, fn) { (listeners[evt] ||= []).push(fn) },
    _listeners: listeners,
    appendChild(c) { children.push(c); return c },
    remove() { const i = _bodyChildren.indexOf(el); if (i >= 0) _bodyChildren.splice(i, 1) },
    querySelector(sel) {
      // Search children recursively
      for (const c of children) {
        if (c.id && sel === `#${c.id}`) return c
        if (c.className && sel === `.${c.className.split(' ')[0]}`) return c
        const found = c.querySelector?.(sel)
        if (found) return found
      }
      // Also check innerHTML-generated elements (simulation)
      return el._queryMap?.[sel] || null
    },
    querySelectorAll() { return [] },
    setAttribute() {},
    focus() { el._focused = true },
    select() { el._selected = true },
    click() {
      const fns = listeners.click || []
      for (const fn of fns) fn()
    },
    _focused: false,
    _selected: false,
    get lastChild() { return children[children.length - 1] || null },
    get scrollHeight() { return 500 },
    scrollTop: 0,
  }
  return el
}

globalThis.document = {
  getElementById: () => null,
  createElement: (tag) => {
    const el = makeMockEl(tag)
    // When innerHTML is set, simulate querySelector by parsing IDs
    const origInnerHTMLDescriptor = Object.getOwnPropertyDescriptor(el, 'innerHTML')
    let _innerHtml = ''
    Object.defineProperty(el, 'innerHTML', {
      get() { return _innerHtml },
      set(v) {
        _innerHtml = v
        // Create mock elements for IDs found in the HTML
        el._queryMap = {}
        const idMatches = v.matchAll(/id="([^"]+)"/g)
        for (const m of idMatches) {
          const mockChild = makeMockEl('div')
          mockChild.id = m[1]
          // Check if it's an input
          if (v.includes(`<input`) && m[1] === '_modal_input') {
            mockChild.tagName = 'input'
            mockChild.value = ''
            // Extract value attribute
            const valMatch = v.match(/value="([^"]*)"/)
            if (valMatch) mockChild.value = valMatch[1]
          }
          el._queryMap[`#${m[1]}`] = mockChild
        }
      },
      configurable: true,
    })
    return el
  },
  createTextNode: (t) => ({ textContent: t }),
  addEventListener: () => {},
  querySelectorAll: () => [],
  querySelector: () => null,
  head: { appendChild() {} },
  body: {
    appendChild(c) { _bodyChildren.push(c); _lastOverlay = c },
  },
}

globalThis.window = globalThis
globalThis.location = { search: '', hash: '', href: '' }
globalThis.history = { replaceState() {} }
try {
  globalThis.navigator = { clipboard: { writeText: async () => {} } }
} catch {}
globalThis.BroadcastChannel = class { postMessage() {} close() {} onmessage() {} }
globalThis.URL = globalThis.URL || URL
globalThis.TextEncoder = globalThis.TextEncoder || TextEncoder
globalThis.TextDecoder = globalThis.TextDecoder || TextDecoder

// ── Import module under test ────────────────────────────────────

import { modal } from '../clawser-modal.js'

// ── Setup ───────────────────────────────────────────────────────

beforeEach(() => {
  _bodyChildren = []
  _lastOverlay = null
})

// ── modal.alert ─────────────────────────��───────────────────────

describe('modal.alert', () => {
  it('creates an overlay in body', async () => {
    const p = modal.alert('Hello world')
    assert.ok(_lastOverlay)
    assert.equal(_lastOverlay.className, 'modal-overlay')
    // Click OK to resolve
    const okBtn = _lastOverlay.querySelector('#_modal_ok')
    assert.ok(okBtn, 'should have OK button')
    okBtn.click()
    const result = await p
    assert.equal(result, true)
  })

  it('includes body text in HTML', async () => {
    const p = modal.alert('Test message')
    assert.ok(_lastOverlay.children[0].innerHTML.includes('Test message'))
    _lastOverlay.querySelector('#_modal_ok').click()
    await p
  })

  it('does not show cancel button', async () => {
    const p = modal.alert('No cancel here')
    const cancelBtn = _lastOverlay.querySelector('#_modal_cancel')
    assert.equal(cancelBtn, null)
    _lastOverlay.querySelector('#_modal_ok').click()
    await p
  })

  it('supports custom title', async () => {
    const p = modal.alert('body', { title: 'Custom Title' })
    assert.ok(_lastOverlay.children[0].innerHTML.includes('Custom Title'))
    _lastOverlay.querySelector('#_modal_ok').click()
    await p
  })

  it('supports custom OK label', async () => {
    const p = modal.alert('body', { okLabel: 'Got it' })
    assert.ok(_lastOverlay.children[0].innerHTML.includes('Got it'))
    _lastOverlay.querySelector('#_modal_ok').click()
    await p
  })
})

// ── modal.confirm ───────────────────────────────────────────────

describe('modal.confirm', () => {
  it('returns true when OK clicked', async () => {
    const p = modal.confirm('Are you sure?')
    _lastOverlay.querySelector('#_modal_ok').click()
    assert.equal(await p, true)
  })

  it('returns false when Cancel clicked', async () => {
    const p = modal.confirm('Are you sure?')
    const cancelBtn = _lastOverlay.querySelector('#_modal_cancel')
    assert.ok(cancelBtn, 'should have Cancel button')
    cancelBtn.click()
    assert.equal(await p, false)
  })

  it('returns false when clicking overlay background', async () => {
    const p = modal.confirm('Test')
    // Simulate clicking the overlay itself (not the box)
    const clickHandlers = _lastOverlay._listeners.click || []
    for (const fn of clickHandlers) fn({ target: _lastOverlay })
    assert.equal(await p, false)
  })

  it('uses danger styling when danger option is true', async () => {
    const p = modal.confirm('Delete everything?', { danger: true })
    assert.ok(_lastOverlay.children[0].innerHTML.includes('modal-btn-danger'))
    _lastOverlay.querySelector('#_modal_ok').click()
    await p
  })

  it('supports custom button labels', async () => {
    const p = modal.confirm('Continue?', { okLabel: 'Yes', cancelLabel: 'No' })
    const html = _lastOverlay.children[0].innerHTML
    assert.ok(html.includes('Yes'))
    assert.ok(html.includes('No'))
    _lastOverlay.querySelector('#_modal_ok').click()
    await p
  })
})

// ── modal.prompt ────────────────────────────────────────────────

describe('modal.prompt', () => {
  it('returns input value when OK clicked', async () => {
    const p = modal.prompt('Enter name:', 'default')
    const inputEl = _lastOverlay.querySelector('#_modal_input')
    assert.ok(inputEl, 'should have input element')
    inputEl.value = 'John'
    _lastOverlay.querySelector('#_modal_ok').click()
    const result = await p
    assert.equal(result, 'John')
  })

  it('returns null when Cancel clicked', async () => {
    const p = modal.prompt('Enter name:', '')
    _lastOverlay.querySelector('#_modal_cancel').click()
    assert.equal(await p, null)
  })

  it('returns null when clicking overlay background', async () => {
    const p = modal.prompt('Enter name:', '')
    const clickHandlers = _lastOverlay._listeners.click || []
    for (const fn of clickHandlers) fn({ target: _lastOverlay })
    assert.equal(await p, null)
  })

  it('focuses and selects input', async () => {
    const p = modal.prompt('Enter:', 'hello')
    const inputEl = _lastOverlay.querySelector('#_modal_input')
    assert.ok(inputEl._focused)
    assert.ok(inputEl._selected)
    _lastOverlay.querySelector('#_modal_ok').click()
    await p
  })

  it('sets default value on input', async () => {
    const p = modal.prompt('Name:', 'Alice')
    const inputEl = _lastOverlay.querySelector('#_modal_input')
    // The default value is set via innerHTML attribute
    assert.ok(_lastOverlay.children[0].innerHTML.includes('Alice'))
    _lastOverlay.querySelector('#_modal_ok').click()
    await p
  })
})

// ── HTML escaping ───────────────────────────────────────────────

describe('HTML escaping', () => {
  it('escapes body text to prevent XSS', async () => {
    const p = modal.alert('<script>alert(1)</script>')
    const html = _lastOverlay.children[0].innerHTML
    assert.ok(!html.includes('<script>'))
    assert.ok(html.includes('&lt;script&gt;'))
    _lastOverlay.querySelector('#_modal_ok').click()
    await p
  })

  it('escapes title text', async () => {
    const p = modal.alert('body', { title: '<img onerror=alert(1)>' })
    const html = _lastOverlay.children[0].innerHTML
    assert.ok(!html.includes('<img'))
    _lastOverlay.querySelector('#_modal_ok').click()
    await p
  })
})
