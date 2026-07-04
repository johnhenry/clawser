// clawser-workspace-init-ui.test.mjs
//
// Tests the registerLazyPanelRenders helper, particularly its
// workspace-switch reactivity behavior: panels that are currently
// visible (have `.active-panel` class) re-render eagerly after a
// switch instead of waiting for the next click.

import { describe, it, beforeEach } from 'node:test'
import assert from 'node:assert/strict'

// Build a minimal DOM-shape the helper needs:
//  - getElementById(id) → element
//  - element.classList.contains('active-panel')
//  - element.addEventListener / removeEventListener / dispatchEvent
const buildFakeDom = () => {
  const elements = new Map()
  const make = (id) => {
    const listeners = new Map()
    const classList = {
      _set: new Set(),
      add(c) { this._set.add(c) },
      remove(c) { this._set.delete(c) },
      contains(c) { return this._set.has(c) },
      toggle(c, v) { v ? this.add(c) : this.remove(c) },
    }
    return {
      id,
      classList,
      _listeners: listeners,
      addEventListener(name, fn, _opts) {
        if (!listeners.has(name)) listeners.set(name, new Set())
        listeners.get(name).add(fn)
      },
      removeEventListener(name, fn) {
        listeners.get(name)?.delete(fn)
      },
      dispatchEvent(ev) {
        for (const fn of listeners.get(ev.type) || []) fn(ev)
      },
    }
  }
  // Pre-create elements for each panel id we test
  for (const id of ['panelChat', 'panelTools', 'panelFiles', 'panelGoals']) {
    elements.set(id, make(id))
  }
  return {
    elements,
    getElementById: (id) => elements.get(id) || null,
  }
}

const fakeDom = buildFakeDom()
globalThis.document = fakeDom
// Class events:
globalThis.CustomEvent = class CustomEvent {
  constructor(type, init = {}) {
    this.type = type
    this.detail = init.detail || null
  }
}

const { registerLazyPanelRenders } = await import('../clawser-workspace-init-ui.js')
const { resetRenderedPanels } = await import('../clawser-router.js')

describe('registerLazyPanelRenders', () => {
  beforeEach(() => {
    resetRenderedPanels()
    for (const el of fakeDom.elements.values()) {
      el.classList._set.clear()
      el._listeners.clear()
    }
    fakeDom.elements.get('panelChat').classList.add('active-panel')
  })

  it('eagerly renders the currently-visible panel even when not yet rendered', () => {
    // Simulate workspace switch with user on Files panel
    fakeDom.elements.get('panelChat').classList.remove('active-panel')
    fakeDom.elements.get('panelFiles').classList.add('active-panel')

    let toolsCalls = 0
    let filesCalls = 0
    let goalsCalls = 0
    registerLazyPanelRenders({
      tools: () => toolsCalls++,
      files: () => filesCalls++,
      goals: () => goalsCalls++,
    })

    assert.equal(filesCalls, 1, 'visible panel rendered eagerly')
    assert.equal(toolsCalls, 0, 'non-visible deferred')
    assert.equal(goalsCalls, 0, 'non-visible deferred')
  })

  it('defers rendering of non-visible panels until first activation', () => {
    let filesCalls = 0
    registerLazyPanelRenders({ files: () => filesCalls++ })
    assert.equal(filesCalls, 0)
    fakeDom.elements.get('panelFiles').dispatchEvent({ type: 'panel:firstrender' })
    assert.equal(filesCalls, 1)
  })

  it('replaces prior deferred handlers on a second register call', () => {
    let first = 0
    let second = 0
    registerLazyPanelRenders({ files: () => first++ })
    registerLazyPanelRenders({ files: () => second++ })
    fakeDom.elements.get('panelFiles').dispatchEvent({ type: 'panel:firstrender' })
    assert.equal(first, 0, 'first handler unregistered before firstrender')
    assert.equal(second, 1, 'second handler fires')
  })
})
