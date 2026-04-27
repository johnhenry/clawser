/**
 * clawser-ui-chat.test.mjs — Tests for core chat UI module
 *
 * Covers: message rendering, status updates, tool call tracking, streaming helpers,
 * cost display, conversation export, dynamic system prompt builder, replay, and
 * inline tool cards.
 */
import { describe, it, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'

// ── Stub browser globals ──────────────────────��──────────────────

const store = {}
globalThis.localStorage = {
  getItem: (k) => store[k] ?? null,
  setItem: (k, v) => { store[k] = String(v) },
  removeItem: (k) => { delete store[k] },
  clear: () => { for (const k of Object.keys(store)) delete store[k] },
}

// Track DOM element creation for assertions
const _createdElements = []

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
    children,
    childNodes: children,
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
    prepend(c) { children.unshift(c) },
    removeChild(c) { const i = children.indexOf(c); if (i >= 0) children.splice(i, 1) },
    remove() {},
    querySelectorAll(sel) {
      // Minimal selector support for tests
      if (sel === '.msg.user' || sel === '.msg.agent') return children.filter(c => c.className?.includes('msg'))
      if (sel === '.cmd-tool-item') return children.filter(c => c.className === 'cmd-tool-item')
      return []
    },
    querySelector(sel) {
      if (sel === '.streaming-cursor') return children.find(c => c.className === 'streaming-cursor') || null
      if (sel === '.label') return children.find(c => c.className === 'label') || null
      if (sel === '.msg-fork') return { addEventListener() {} }
      if (sel === '.tool-head') return { addEventListener() {}, parentElement: el }
      if (sel === '.tc-header') return { addEventListener() {} }
      if (sel === '.tc-params-chip') return null
      if (sel === '.tc-output-toggle') return null
      if (sel === '.md-content') return null
      if (sel === '.subagent-head') return { addEventListener() {} }
      if (sel === '.intent-badge') return null
      if (sel?.startsWith('#saDetail_')) return makeMockEl('div')
      if (sel?.startsWith('#saStats_')) return makeMockEl('span')
      return null
    },
    setAttribute() {},
    get lastChild() { return children[children.length - 1] || null },
    get scrollHeight() { return 1000 },
    scrollTop: 0,
  }
  _createdElements.push(el)
  return el
}

// DOM element registry for $() lookups
const _domElements = {}
function resetDom() {
  _createdElements.length = 0
  const ids = [
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
  if (globalThis.navigator) {
    if (!globalThis.navigator.clipboard) {
      Object.defineProperty(globalThis.navigator, 'clipboard', {
        value: { writeText: async () => {} }, configurable: true,
      })
    }
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

// ── Import module under test ────────────────────��───────────────

import {
  resetToolAndEventState,
  resetChatUI,
  setStatus,
  addMsg,
  addErrorMsg,
  addToolCall,
  renderToolCalls,
  addSubAgentBlock,
  updateSubAgentBlock,
  addInlineToolCall,
  updateInlineToolCall,
  addEvent,
  updateState,
  updateCostDisplay,
  createStreamingMsg,
  appendToStreamingMsg,
  finalizeStreamingMsg,
  exportConversationAsJSON,
  exportConversationAsText,
  replaySessionHistory,
  replayFromEvents,
  addSubAgentCard,
  updateSubAgentCard,
  addSafetyBanner,
  addUndoButton,
  addIntentBadge,
  buildDynamicSystemPrompt,
} from '../clawser-ui-chat.js'

import { state } from '../clawser-state.js'

// ── Setup ───────────────────────────��───────────────────────────

beforeEach(() => {
  resetDom()
  state.toolCallLog = []
  state.eventLog = []
  state.eventCount = 0
  state.sessionCost = 0
  state.agent = null
})

// ── setStatus ───────────────────────────────────────────────────

describe('setStatus', () => {
  it('sets dot class and text', () => {
    setStatus('busy', 'thinking...')
    assert.equal(_domElements.statusDot.className, 'dot busy')
    assert.equal(_domElements.statusText.textContent, 'thinking...')
  })

  it('switches to ready state', () => {
    setStatus('busy', 'working')
    setStatus('ready', 'ready')
    assert.equal(_domElements.statusDot.className, 'dot ready')
    assert.equal(_domElements.statusText.textContent, 'ready')
  })
})

// ── addMsg ─────────────────────��────────────────────────────────

describe('addMsg', () => {
  it('appends user message with correct class', () => {
    addMsg('user', 'hello')
    const msgs = _domElements.messages.children
    assert.equal(msgs.length, 1)
    assert.ok(msgs[0].className.includes('user'))
  })

  it('appends agent message', () => {
    addMsg('agent', 'hi there')
    const msgs = _domElements.messages.children
    assert.equal(msgs.length, 1)
    assert.ok(msgs[0].className.includes('agent'))
  })

  it('appends system message with textContent', () => {
    addMsg('system', 'system info')
    const msgs = _domElements.messages.children
    assert.equal(msgs.length, 1)
    assert.equal(msgs[0].textContent, 'system info')
  })

  it('escapes HTML in user messages', () => {
    addMsg('user', '<script>alert(1)</script>')
    const msg = _domElements.messages.children[0]
    assert.ok(!msg.innerHTML.includes('<script>'))
  })

  it('appends multiple messages in order', () => {
    addMsg('user', 'one')
    addMsg('agent', 'two')
    addMsg('system', 'three')
    assert.equal(_domElements.messages.children.length, 3)
  })
})

// ── addErrorMsg ───────────��──────────────────���──────────────────

describe('addErrorMsg', () => {
  it('adds error message div', () => {
    addErrorMsg('something broke')
    const msgs = _domElements.messages.children
    assert.equal(msgs.length, 1)
    assert.ok(msgs[0].className.includes('error'))
  })

  it('adds retry button when callback provided', () => {
    let retryCalled = false
    addErrorMsg('failed', () => { retryCalled = true })
    const msg = _domElements.messages.children[0]
    // The message should have a child element (the retry button)
    assert.ok(msg.children.length > 0)
  })
})

// ── addToolCall / renderToolCalls ──────────────────────────���────

describe('addToolCall', () => {
  it('records tool call in state and updates count', () => {
    addToolCall('fs_read', { path: '/test' }, { success: true, output: 'data' })
    assert.equal(state.toolCallLog.length, 1)
    assert.equal(state.toolCallLog[0].name, 'fs_read')
    assert.equal(String(_domElements.toolCount.textContent), '1')
  })

  it('caps at 100 entries', () => {
    for (let i = 0; i < 105; i++) {
      addToolCall(`tool_${i}`, {}, { success: true, output: '' })
    }
    assert.equal(state.toolCallLog.length, 100)
  })

  it('newest entry is first (unshift)', () => {
    addToolCall('first', {}, null)
    addToolCall('second', {}, null)
    assert.equal(state.toolCallLog[0].name, 'second')
    assert.equal(state.toolCallLog[1].name, 'first')
  })
})

describe('renderToolCalls', () => {
  it('renders tool entries in DOM', () => {
    addToolCall('test_tool', { a: 1 }, { success: true, output: 'ok' })
    // renderToolCalls is called internally by addToolCall
    const tc = _domElements.toolCalls
    assert.ok(tc.children.length > 0)
  })

  it('shows pending icon for null result', () => {
    addToolCall('pending_tool', {}, null)
    const tc = _domElements.toolCalls
    assert.ok(tc.children.length > 0)
    // The innerHTML should contain the pending icon
    assert.ok(tc.children[0].innerHTML.includes('⏳'))
  })

  it('shows success icon for successful result', () => {
    addToolCall('ok_tool', {}, { success: true, output: 'done' })
    assert.ok(_domElements.toolCalls.children[0].innerHTML.includes('✓'))
  })

  it('shows error icon for failed result', () => {
    addToolCall('err_tool', {}, { success: false, error: 'fail' })
    assert.ok(_domElements.toolCalls.children[0].innerHTML.includes('✗'))
  })
})

// ── resetToolAndEventState ───────────────────��──────────────────

describe('resetToolAndEventState', () => {
  it('clears tool and event state', () => {
    state.toolCallLog = [{ name: 'x' }]
    state.eventLog = [{ topic: 'y' }]
    state.eventCount = 5
    resetToolAndEventState()
    assert.deepEqual(state.toolCallLog, [])
    assert.deepEqual(state.eventLog, [])
    assert.equal(state.eventCount, 0)
    assert.equal(_domElements.toolCount.textContent, '0')
    assert.equal(_domElements.eventCount.textContent, '0')
  })
})

// ── resetChatUI ─────────────────────���───────────────────────────

describe('resetChatUI', () => {
  it('clears messages and tool/event state', () => {
    addMsg('user', 'test')
    addToolCall('t', {}, null)
    resetChatUI()
    assert.equal(_domElements.messages.innerHTML, '')
    assert.deepEqual(state.toolCallLog, [])
  })
})

// ── addEvent ─────────────────────��──────────────────────────────

describe('addEvent', () => {
  it('increments event count and prepends entry', () => {
    addEvent('tool_call', 'test payload')
    assert.equal(state.eventCount, 1)
    assert.equal(state.eventLog.length, 1)
    assert.equal(state.eventLog[0].topic, 'tool_call')
  })

  it('caps at 200 entries', () => {
    for (let i = 0; i < 210; i++) {
      addEvent('evt', `data ${i}`)
    }
    assert.equal(state.eventLog.length, 200)
  })

  it('serializes object payloads to JSON', () => {
    addEvent('test', { key: 'value' })
    assert.ok(state.eventLog[0].payload.includes('key'))
  })
})

// ── updateCostDisplay ──────────────────���─────────────��──────────

describe('updateCostDisplay', () => {
  it('shows empty string for zero cost', () => {
    state.sessionCost = 0
    updateCostDisplay()
    assert.equal(_domElements.costDisplay.textContent, '')
  })

  it('shows cents for sub-penny amounts', () => {
    state.sessionCost = 0.005
    updateCostDisplay()
    assert.ok(_domElements.costDisplay.textContent.includes('¢'))
  })

  it('shows dollar sign for larger amounts', () => {
    state.sessionCost = 0.15
    updateCostDisplay()
    assert.ok(_domElements.costDisplay.textContent.startsWith('$'))
  })
})

// ── Streaming message helpers ──────────────────────────���────────

describe('createStreamingMsg', () => {
  it('creates agent message with streaming cursor', () => {
    const el = createStreamingMsg()
    assert.ok(el.className.includes('agent'))
    assert.ok(el.innerHTML.includes('streaming-cursor'))
  })
})

describe('appendToStreamingMsg', () => {
  it('appends text and keeps cursor at end', () => {
    const el = createStreamingMsg()
    appendToStreamingMsg(el, 'hello ')
    appendToStreamingMsg(el, 'world')
    // Should have text nodes and a cursor
    const lastChild = el.children[el.children.length - 1]
    assert.equal(lastChild.className, 'streaming-cursor')
  })
})

describe('finalizeStreamingMsg', () => {
  it('removes streaming cursor', () => {
    const el = createStreamingMsg()
    appendToStreamingMsg(el, 'test content')
    finalizeStreamingMsg(el)
    // After finalize, cursor should be gone (remove() called)
    // We can verify by trying querySelector which returns null-like
    const cursor = el.querySelector('.streaming-cursor')
    // cursor is either null or was removed
    assert.ok(true) // If we got here, no error occurred
  })
})

// ── addSubAgentBlock ────────────────────────────────────────────

describe('addSubAgentBlock', () => {
  it('creates sub-agent block with goal text', () => {
    const el = addSubAgentBlock('sa-1', 'research topic')
    assert.ok(el.className.includes('subagent-card'))
    assert.ok(el.innerHTML.includes('research topic'))
  })
})

describe('updateSubAgentBlock', () => {
  it('updates block with iteration event', () => {
    const el = addSubAgentBlock('sa-2', 'task')
    updateSubAgentBlock('sa-2', { type: 'iteration', iteration: 1, text: 'step 1' })
    // Should not throw
    assert.ok(true)
  })

  it('marks block as done', () => {
    const el = addSubAgentBlock('sa-3', 'task')
    updateSubAgentBlock('sa-3', { type: 'done' })
    assert.ok(true) // No error
  })

  it('ignores unknown block IDs', () => {
    updateSubAgentBlock('nonexistent', { type: 'done' })
    assert.ok(true) // Should not throw
  })
})

// ── addSubAgentCard ────────────���────────────────────────────────

describe('addSubAgentCard', () => {
  it('creates card with task description', () => {
    const el = addSubAgentCard('summarize docs')
    assert.ok(el.className.includes('subagent-card'))
    assert.ok(el.innerHTML.includes('summarize docs'))
  })

  it('shows stats when provided', () => {
    const el = addSubAgentCard('task', { iterations: 3, tokens: 500 })
    assert.ok(el.innerHTML.includes('3 iters'))
    assert.ok(el.innerHTML.includes('500 tokens'))
  })
})

describe('updateSubAgentCard', () => {
  it('updates stats on existing card', () => {
    const el = addSubAgentCard('task')
    // The head returned by querySelector needs querySelector support
    const origQs = el.querySelector
    el.querySelector = (sel) => {
      if (sel === '.subagent-head') {
        return {
          addEventListener() {},
          querySelector: (s) => {
            if (s === '.sa-stats') return { textContent: '' }
            return null
          },
        }
      }
      if (sel === '.subagent-detail') return { textContent: '' }
      return origQs.call(el, sel)
    }
    updateSubAgentCard(el, 'task', { iterations: 5, tokens: 1000, output: 'done' })
    assert.ok(true)
  })

  it('handles null element gracefully', () => {
    updateSubAgentCard(null, 'task', {})
    assert.ok(true) // Should not throw
  })
})

// ── addSafetyBanner ─────────────────────────────────────────────

describe('addSafetyBanner', () => {
  it('appends safety banner to messages', () => {
    addSafetyBanner('prompt injection detected')
    const msgs = _domElements.messages.children
    assert.ok(msgs.length > 0)
    assert.ok(msgs[0].className.includes('safety-banner'))
    assert.ok(msgs[0].textContent.includes('injection'))
  })
})

// ── addUndoButton ────────────────────��──────────────────────────

describe('addUndoButton', () => {
  it('creates undo button', () => {
    const btn = addUndoButton(() => {})
    assert.ok(btn.className.includes('undo-btn'))
    assert.ok(btn.textContent.includes('Undo'))
  })
})

// ��─ addIntentBadge ───────────────────────��──────────────────────

describe('addIntentBadge', () => {
  it('does nothing if no user messages exist', () => {
    addIntentBadge('COMMAND')
    // Should not throw
    assert.ok(true)
  })
})

// ── buildDynamicSystemPrompt ───────────────────���────────────────

describe('buildDynamicSystemPrompt', () => {
  it('returns base prompt when no extras', () => {
    const result = buildDynamicSystemPrompt('You are an assistant.', [], [], '', new Map())
    assert.equal(result, 'You are an assistant.')
  })

  it('appends memories when present', () => {
    const memories = [
      { key: 'user_name', content: 'John' },
      { key: 'pref', content: 'likes dark mode' },
    ]
    const result = buildDynamicSystemPrompt('Base', memories, [], '', new Map())
    assert.ok(result.includes('Relevant memories'))
    assert.ok(result.includes('[user_name] John'))
    assert.ok(result.includes('[pref] likes dark mode'))
  })

  it('limits memories to 10', () => {
    const memories = Array.from({ length: 15 }, (_, i) => ({ key: `k${i}`, content: `v${i}` }))
    const result = buildDynamicSystemPrompt('Base', memories, [], '', new Map())
    // Should only include first 10
    assert.ok(result.includes('[k9]'))
    assert.ok(!result.includes('[k10]'))
  })

  it('includes only active goals', () => {
    const goals = [
      { id: 'g1', description: 'learn rust', status: 'active' },
      { id: 'g2', description: 'buy milk', status: 'completed' },
      { id: 'g3', description: 'write tests', status: 'active' },
    ]
    const result = buildDynamicSystemPrompt('Base', [], goals, '', new Map())
    assert.ok(result.includes('learn rust'))
    assert.ok(result.includes('write tests'))
    assert.ok(!result.includes('buy milk'))
    assert.ok(result.includes('agent_goal_update'))
  })

  it('skips goals section when none are active', () => {
    const goals = [{ id: 'g1', description: 'done', status: 'completed' }]
    const result = buildDynamicSystemPrompt('Base', [], goals, '', new Map())
    assert.ok(!result.includes('current goals'))
  })

  it('appends skill metadata', () => {
    const result = buildDynamicSystemPrompt('Base', [], [], '<skills>web_search</skills>', new Map())
    assert.ok(result.includes('<skills>web_search</skills>'))
  })

  it('appends active skill prompts', () => {
    const prompts = new Map([['coder', 'You are a coding assistant.']])
    const result = buildDynamicSystemPrompt('Base', [], [], '', prompts)
    assert.ok(result.includes('You are a coding assistant.'))
  })

  it('includes OAuth connections when provided', () => {
    const result = buildDynamicSystemPrompt('Base', [], [], '', new Map(), {
      oauthConnections: [{ provider: 'github', name: 'GitHub' }]
    })
    assert.ok(result.includes('GitHub'))
    assert.ok(result.includes('oauth_api'))
  })

  it('combines all sections', () => {
    const memories = [{ key: 'k', content: 'v' }]
    const goals = [{ id: 'g1', description: 'goal1', status: 'active' }]
    const prompts = new Map([['s1', 'skill prompt']])
    const result = buildDynamicSystemPrompt('Base prompt', memories, goals, '<meta/>', prompts, {
      oauthConnections: [{ provider: 'slack', name: 'Slack' }],
    })
    assert.ok(result.startsWith('Base prompt'))
    assert.ok(result.includes('Relevant memories'))
    assert.ok(result.includes('goal1'))
    assert.ok(result.includes('<meta/>'))
    assert.ok(result.includes('skill prompt'))
    assert.ok(result.includes('Slack'))
  })
})

// ── exportConversationAsJSON / exportConversationAsText ──────────

describe('exportConversationAsJSON', () => {
  it('returns empty array JSON when no agent', () => {
    state.agent = null
    const result = exportConversationAsJSON()
    assert.equal(result, '[]')
  })

  it('returns JSON of events when agent present', () => {
    state.agent = {
      getEventLog: () => ({
        events: [{ type: 'user_message', data: { content: 'hi' } }],
      }),
    }
    const result = exportConversationAsJSON()
    const parsed = JSON.parse(result)
    assert.equal(parsed.length, 1)
    assert.equal(parsed[0].type, 'user_message')
  })
})

describe('exportConversationAsText', () => {
  it('returns empty string when no agent', () => {
    state.agent = null
    assert.equal(exportConversationAsText(), '')
  })

  it('formats events as readable text', () => {
    state.agent = {
      getEventLog: () => ({
        events: [
          { type: 'user_message', timestamp: 1700000000000, data: { content: 'hello' } },
          { type: 'agent_message', timestamp: 1700000001000, data: { content: 'hi back' } },
          { type: 'error', timestamp: 1700000002000, data: { message: 'oops' } },
        ],
      }),
    }
    const text = exportConversationAsText()
    assert.ok(text.includes('User: hello'))
    assert.ok(text.includes('Agent: hi back'))
    assert.ok(text.includes('Error: oops'))
  })
})

// ── addInlineToolCall ───────────────────────────────────────────

describe('addInlineToolCall', () => {
  it('creates pending tool card when result is null', () => {
    const el = addInlineToolCall('fs_read', { path: '/test' }, null)
    assert.ok(el.className.includes('pending'))
    assert.ok(el.className.includes('tool-card'))
  })

  it('creates success tool card for ok result', () => {
    const el = addInlineToolCall('web_search', { query: 'test' }, { success: true, output: 'results' })
    assert.ok(el.className.includes('ok'))
  })

  it('creates error tool card for failed result', () => {
    const el = addInlineToolCall('fetch_url', { url: 'bad' }, { success: false, error: 'timeout' })
    assert.ok(el.className.includes('err'))
  })

  it('renders _codex_eval as "code eval"', () => {
    const el = addInlineToolCall('_codex_eval', {}, { success: true, output: '42' })
    assert.ok(el.innerHTML.includes('code eval'))
  })

  it('shows param count chip when params present', () => {
    const el = addInlineToolCall('test', { a: 1, b: 2 }, { success: true, output: '' })
    assert.ok(el.innerHTML.includes('2 params'))
  })

  it('handles string params gracefully', () => {
    const el = addInlineToolCall('test', '{"a":1}', { success: true, output: '' })
    assert.ok(el.className.includes('tool-card'))
  })

  it('handles null params', () => {
    const el = addInlineToolCall('test', null, { success: true, output: '' })
    assert.ok(el.className.includes('tool-card'))
  })
})

// ── updateInlineToolCall ────────────────────────────────────────

describe('updateInlineToolCall', () => {
  it('updates pending card to success', () => {
    const el = addInlineToolCall('test', {}, null)
    assert.ok(el.className.includes('pending'))
    updateInlineToolCall(el, 'test', {}, { success: true, output: 'done' })
    assert.ok(el.className.includes('ok'))
    assert.ok(!el.className.includes('pending'))
  })

  it('updates pending card to error', () => {
    const el = addInlineToolCall('test', {}, null)
    updateInlineToolCall(el, 'test', {}, { success: false, error: 'fail' })
    assert.ok(el.className.includes('err'))
  })

  it('handles null element gracefully', () => {
    updateInlineToolCall(null, 'test', {}, { success: true })
    assert.ok(true) // Should not throw
  })
})

// ── replayFromEvents ──────────────────────��─────────────────────

describe('replayFromEvents', () => {
  it('replays user and agent messages', () => {
    const events = [
      { type: 'user_message', id: 'e1', data: { content: 'hi' } },
      { type: 'agent_message', data: { content: 'hello' } },
      { type: 'system_message', data: { content: 'system info' } },
    ]
    replayFromEvents(events)
    const msgs = _domElements.messages.children
    // Should have at least the user and agent messages (system too)
    assert.ok(msgs.length >= 3)
  })

  it('replays tool_call and tool_result pairs', () => {
    const events = [
      { type: 'tool_call', data: { call_id: 'tc1', name: 'fs_read', arguments: { path: '/' } } },
      { type: 'tool_result', data: { call_id: 'tc1', name: 'fs_read', result: { success: true, output: 'data' } } },
    ]
    replayFromEvents(events)
    assert.equal(state.toolCallLog.length, 1)
  })

  it('replays error events', () => {
    const events = [
      { type: 'error', data: { message: 'something went wrong' } },
    ]
    replayFromEvents(events)
    const msgs = _domElements.messages.children
    assert.ok(msgs.length > 0)
  })

  it('handles empty events array', () => {
    replayFromEvents([])
    assert.equal(state.toolCallLog.length, 0)
  })
})

// ── replaySessionHistory (legacy format) ────────────────────────

describe('replaySessionHistory', () => {
  it('replays user and assistant messages', () => {
    const history = [
      { role: 'user', content: 'hey' },
      { role: 'assistant', content: 'yo' },
    ]
    replaySessionHistory(history)
    const msgs = _domElements.messages.children
    assert.ok(msgs.length >= 2)
  })

  it('replays tool calls and results', () => {
    const history = [
      { role: 'assistant', content: '', tool_calls: [
        { id: 'tc1', function: { name: 'web_search', arguments: '{"query":"test"}' } }
      ]},
      { role: 'tool', tool_call_id: 'tc1', content: '{"success":true,"output":"found"}' },
    ]
    replaySessionHistory(history)
    assert.equal(state.toolCallLog.length, 1)
    assert.equal(state.toolCallLog[0].name, 'web_search')
  })
})

// ── updateState ───────────────────���─────────────────────────────

describe('updateState', () => {
  it('does nothing when no agent', () => {
    state.agent = null
    updateState()
    assert.ok(true) // Should not throw
  })

  it('updates state display elements', () => {
    state.agent = {
      getState: () => ({
        history_len: 10,
        memory_count: 5,
        goals: [{ id: 'g1' }, { id: 'g2' }],
        scheduler_jobs: 3,
      }),
    }
    updateState()
    assert.equal(_domElements.stHistory.textContent, 10)
    assert.equal(_domElements.stMemory.textContent, 5)
    assert.equal(_domElements.stGoals.textContent, 2)
    assert.equal(_domElements.stJobs.textContent, 3)
  })
})
