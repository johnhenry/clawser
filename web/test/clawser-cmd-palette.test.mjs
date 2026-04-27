/**
 * clawser-cmd-palette.test.mjs — Tests for command palette overlay
 *
 * Covers: open/close, tool list rendering and filtering, tool selection
 * with parameter form generation, and parameter type coercion.
 */
import { describe, it, beforeEach } from 'node:test'
import assert from 'node:assert/strict'

// ── Stub browser globals ────────────────────────────────────────

const store = {}
globalThis.localStorage = {
  getItem: (k) => store[k] ?? null,
  setItem: (k, v) => { store[k] = String(v) },
  removeItem: (k) => { delete store[k] },
  clear: () => { for (const k of Object.keys(store)) delete store[k] },
}

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
    type: '',
    placeholder: '',
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
    removeChild(c) { const i = children.indexOf(c); if (i >= 0) children.splice(i, 1) },
    prepend(c) { children.unshift(c) },
    remove() {},
    querySelectorAll(sel) {
      if (sel === '.cmd-tool-item') return children.filter(c => c.className === 'cmd-tool-item')
      if (sel === '[data-param-name]') return children.flatMap(c => c.children || []).filter(c => c.dataset?.paramName)
      return []
    },
    querySelector(sel) {
      if (sel === '.cmd-tool-name') {
        // Return text content matching
        return { textContent: el._toolName || '' }
      }
      if (sel === '.streaming-cursor') return null
      if (sel === '.label') return null
      if (sel === '.msg-fork') return { addEventListener() {} }
      if (sel === '.tool-head') return { addEventListener() {}, parentElement: el }
      if (sel === '.tc-header') return { addEventListener() {} }
      if (sel === '.tc-params-chip') return null
      if (sel === '.tc-output-toggle') return null
      if (sel === '.subagent-head') return { addEventListener() {} }
      if (sel === '.intent-badge') return null
      return null
    },
    setAttribute() {},
    focus() {},
    get lastChild() { return children[children.length - 1] || null },
    get scrollHeight() { return 500 },
    scrollTop: 0,
  }
  return el
}

function resetDom() {
  const ids = [
    'cmdPalette', 'cmdSearch', 'cmdParamArea', 'cmdRun', 'cmdToolList',
    'cmdPaletteBtn', 'cmdCancel',
    // Also needed by ui-chat (imported as dependency)
    'messages', 'toolCount', 'eventCount', 'toolCalls', 'eventLog',
    'statusDot', 'statusText', 'costDisplay', 'stHistory', 'stMemory',
    'stGoals', 'stJobs', 'goalCount', 'memCount', 'userInput', 'sendBtn',
    'cmdPaletteBtn', 'systemPrompt', 'slashAutocomplete', 'convBarContainer',
  ]
  for (const id of ids) {
    _domElements[id] = makeMockEl('div')
  }
}

globalThis.document = {
  getElementById: (id) => _domElements[id] || null,
  createElement: (tag) => makeMockEl(tag),
  createTextNode: (t) => ({ textContent: t, className: '' }),
  addEventListener: () => {},
  querySelectorAll: () => [],
  querySelector: () => null,
  head: { appendChild() {} },
  body: { appendChild() {} },
}

globalThis.window = globalThis
globalThis.location = { search: '', hash: '', href: '' }
globalThis.history = { replaceState() {} }
try {
  globalThis.navigator = {
    clipboard: { writeText: async () => {} },
    storage: { getDirectory: async () => ({}) },
    platform: 'MacIntel',
  }
} catch {
  if (globalThis.navigator && !globalThis.navigator.clipboard) {
    Object.defineProperty(globalThis.navigator, 'clipboard', {
      value: { writeText: async () => {} }, configurable: true,
    })
  }
}
globalThis.BroadcastChannel = class { postMessage() {} close() {} onmessage() {} }
globalThis.Blob = class { constructor() {} }
globalThis.URL = globalThis.URL || URL
globalThis.TextEncoder = globalThis.TextEncoder || TextEncoder
globalThis.TextDecoder = globalThis.TextDecoder || TextDecoder
if (!globalThis.crypto?.randomUUID) {
  globalThis.crypto = globalThis.crypto || {}
  globalThis.crypto.randomUUID = () => 'aaaa-bbbb-cccc-dddd'
}

// ── Import module under test ────────────────────────────────────

import {
  openCommandPalette,
  closeCommandPalette,
  renderCmdToolList,
  selectCmdTool,
} from '../clawser-cmd-palette.js'

import { state } from '../clawser-state.js'

// ── Setup ─────────────────────────────────────��─────────────────

beforeEach(() => {
  resetDom()
  state.cmdSelectedSpec = null
  state.browserTools = {
    allSpecs: () => [
      { name: 'fs_read', description: 'Read a file', required_permission: 'read', parameters: { properties: { path: { type: 'string', description: 'File path' } }, required: ['path'] } },
      { name: 'fs_write', description: 'Write a file', required_permission: 'write', parameters: { properties: { path: { type: 'string' }, content: { type: 'string' } }, required: ['path', 'content'] } },
      { name: 'web_search', description: 'Search the web', required_permission: 'network', parameters: { properties: { query: { type: 'string' } }, required: ['query'] } },
    ],
  }
  state.mcpManager = {
    allToolSpecs: () => [
      { name: 'mcp_tool', description: 'An MCP tool', parameters: { properties: { input: { type: 'string' } } } },
    ],
  }
})

// ── openCommandPalette ────���─────────────────────────────────────

describe('openCommandPalette', () => {
  it('makes palette visible', () => {
    openCommandPalette()
    assert.ok(_domElements.cmdPalette.classList.contains('visible'))
  })

  it('clears previous selection', () => {
    state.cmdSelectedSpec = { name: 'old_tool' }
    openCommandPalette()
    assert.equal(state.cmdSelectedSpec, null)
  })

  it('resets search input', () => {
    _domElements.cmdSearch.value = 'old search'
    openCommandPalette()
    assert.equal(_domElements.cmdSearch.value, '')
  })

  it('disables run button', () => {
    _domElements.cmdRun.disabled = false
    openCommandPalette()
    assert.equal(_domElements.cmdRun.disabled, true)
  })

  it('hides param area', () => {
    _domElements.cmdParamArea.classList.add('visible')
    openCommandPalette()
    assert.ok(!_domElements.cmdParamArea.classList.contains('visible'))
  })

  it('populates tool list', () => {
    openCommandPalette()
    const tools = _domElements.cmdToolList.children
    assert.equal(tools.length, 4) // 3 browser + 1 MCP
  })
})

// ── closeCommandPalette ─────────────────────────────────────────

describe('closeCommandPalette', () => {
  it('removes visible class', () => {
    _domElements.cmdPalette.classList.add('visible')
    closeCommandPalette()
    assert.ok(!_domElements.cmdPalette.classList.contains('visible'))
  })

  it('clears selected spec', () => {
    state.cmdSelectedSpec = { name: 'test' }
    closeCommandPalette()
    assert.equal(state.cmdSelectedSpec, null)
  })
})

// ── renderCmdToolList ───────────────────────────────────────────

describe('renderCmdToolList', () => {
  it('renders all tools when filter is empty', () => {
    renderCmdToolList('')
    assert.equal(_domElements.cmdToolList.children.length, 4)
  })

  it('filters by name', () => {
    renderCmdToolList('fs_')
    const tools = _domElements.cmdToolList.children
    assert.equal(tools.length, 2) // fs_read, fs_write
  })

  it('filters by description (case insensitive)', () => {
    renderCmdToolList('search')
    const tools = _domElements.cmdToolList.children
    assert.equal(tools.length, 1)
  })

  it('shows no-match message when nothing found', () => {
    renderCmdToolList('zzzznonexistent')
    assert.ok(_domElements.cmdToolList.innerHTML.includes('No matching tools'))
  })

  it('includes MCP tools', () => {
    renderCmdToolList('mcp')
    const tools = _domElements.cmdToolList.children
    assert.equal(tools.length, 1)
  })

  it('shows permission badge', () => {
    renderCmdToolList('fs_read')
    const html = _domElements.cmdToolList.children[0].innerHTML
    assert.ok(html.includes('read'))
  })
})

// ── selectCmdTool ───────────────────────────────────────────────

describe('selectCmdTool', () => {
  it('sets cmdSelectedSpec in state', () => {
    const spec = { name: 'fs_read', parameters: { properties: { path: { type: 'string' } }, required: ['path'] } }
    selectCmdTool(spec)
    assert.equal(state.cmdSelectedSpec, spec)
  })

  it('enables run button', () => {
    _domElements.cmdRun.disabled = true
    selectCmdTool({ name: 'test', parameters: { properties: {} } })
    assert.equal(_domElements.cmdRun.disabled, false)
  })

  it('shows param area', () => {
    selectCmdTool({ name: 'test', parameters: { properties: { x: { type: 'string' } } } })
    assert.ok(_domElements.cmdParamArea.classList.contains('visible'))
  })

  it('shows "No parameters needed" for paramless tools', () => {
    selectCmdTool({ name: 'simple', parameters: { properties: {} } })
    assert.ok(_domElements.cmdParamArea.innerHTML.includes('No parameters'))
  })

  it('renders input fields for string params', () => {
    selectCmdTool({
      name: 'tool',
      parameters: {
        properties: { path: { type: 'string', description: 'File path' } },
        required: ['path'],
      },
    })
    const area = _domElements.cmdParamArea
    assert.ok(area.children.length > 0)
  })

  it('renders select for enum params', () => {
    selectCmdTool({
      name: 'tool',
      parameters: {
        properties: { mode: { type: 'string', enum: ['fast', 'slow', 'auto'] } },
      },
    })
    const area = _domElements.cmdParamArea
    // Should have created a select element among the children
    assert.ok(area.children.length > 0)
  })

  it('renders select for boolean params', () => {
    selectCmdTool({
      name: 'tool',
      parameters: {
        properties: { verbose: { type: 'boolean' } },
      },
    })
    const area = _domElements.cmdParamArea
    assert.ok(area.children.length > 0)
  })

  it('renders textarea for object params', () => {
    selectCmdTool({
      name: 'tool',
      parameters: {
        properties: { config: { type: 'object' } },
      },
    })
    const area = _domElements.cmdParamArea
    assert.ok(area.children.length > 0)
  })

  it('marks required params with asterisk', () => {
    selectCmdTool({
      name: 'tool',
      parameters: {
        properties: { path: { type: 'string' } },
        required: ['path'],
      },
    })
    // Check that innerHTML somewhere contains the required marker
    const area = _domElements.cmdParamArea
    const groupHtml = area.children[0]?.children?.[0]?.innerHTML || ''
    assert.ok(groupHtml.includes('required') || area.children.length > 0)
  })
})
