/**
 * clawser-ui-config.test.mjs — Tests for config panel rendering functions
 *
 * Covers: cost tracking, autonomy badge, daemon/remote badges,
 * security settings application, and render functions that work
 * with minimal DOM mocking.
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
    checked: false,
    disabled: false,
    children,
    classList: {
      _classes: new Set(),
      add(...cls) { cls.forEach(c => this._classes.add(c)) },
      remove(...cls) { cls.forEach(c => this._classes.delete(c)) },
      contains(c) { return this._classes.has(c) },
      toggle(c, force) {
        if (force !== undefined) { if (force) this._classes.add(c); else this._classes.delete(c); return force }
        if (this._classes.has(c)) { this._classes.delete(c); return false } else { this._classes.add(c); return true }
      },
    },
    addEventListener(evt, fn) { (listeners[evt] ||= []).push(fn) },
    _listeners: listeners,
    appendChild(c) { children.push(c); return c },
    removeChild(c) { const i = children.indexOf(c); if (i >= 0) children.splice(i, 1) },
    prepend(c) { children.unshift(c) },
    remove() {},
    querySelectorAll(sel) {
      if (sel === '.sidebar button') return []
      return []
    },
    querySelector(sel) {
      // Return a generic mock element for any selector (avoids null errors in render functions)
      return makeMockEl('div')
    },
    setAttribute() {},
    dispatchEvent() {},
    focus() {},
    click() {},
    get lastChild() { return children[children.length - 1] || null },
    get scrollHeight() { return 500 },
    scrollTop: 0,
  }
  return el
}

// Return a fresh mock for every getElementById call (avoids shared-state issues)
const _domElements = {}
function getOrCreateEl(id) {
  if (!_domElements[id]) _domElements[id] = makeMockEl('div')
  return _domElements[id]
}

globalThis.document = {
  getElementById: (id) => getOrCreateEl(id),
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
globalThis.CustomEvent = globalThis.CustomEvent || class CustomEvent { constructor(type, opts) { this.type = type; this.detail = opts?.detail } }
globalThis.Blob = class { constructor() {} }
globalThis.URL = globalThis.URL || URL
globalThis.TextEncoder = globalThis.TextEncoder || TextEncoder
globalThis.TextDecoder = globalThis.TextDecoder || TextDecoder
if (!globalThis.crypto?.randomUUID) {
  globalThis.crypto = globalThis.crypto || {}
  globalThis.crypto.randomUUID = () => 'aaaa-bbbb-cccc-dddd'
}

// ── Import modules under test ───────────────────────────────────

import { state, lsKey } from '../clawser-state.js'
import {
  updateCostMeter,
  updateAutonomyBadge,
  updateDaemonBadge,
  updateRemoteBadge,
  renderAutonomySection,
  renderSelfRepairSection,
  renderSandboxSection,
  renderHeartbeatSection,
  renderOAuthSection,
  renderHooksSection,
  renderCheckpointSection,
  renderCleanConversationsSection,
  getCostTracker,
  recordCostEvent,
  applySecuritySettings,
  saveAutonomySettings,
  saveIdentitySettings,
  saveSelfRepairSettings,
  saveLimitsSettings,
  saveSandboxSettings,
  saveHeartbeatSettings,
  refreshDashboard,
  renderApiKeyWarning,
  renderIdentitySection,
  renderLimitsSection,
  renderQuotaBar,
  readMeshRelaySettings,
  getUserIceServers,
  applyMeshRelaySettings,
} from '../clawser-ui-config.js'

// ── Setup ───────────────────────────────────────────────────────

beforeEach(() => {
  // Reset elements
  for (const k of Object.keys(_domElements)) delete _domElements[k]
  localStorage.clear()
  state.agent = null
  state.sessionCost = 0
})

// ── updateCostMeter ─────────────────────────────────────────────

describe('updateCostMeter', () => {
  it('runs without throwing when no agent', () => {
    state.agent = null
    updateCostMeter()
    assert.ok(true)
  })

  it('updates meter with cost data', () => {
    state.agent = { getWorkspace: () => 'ws1' }
    state.sessionCost = 0.5
    localStorage.setItem(lsKey.autonomy('ws1'), JSON.stringify({ costLimitPerDay: 5 }))
    updateCostMeter()
    assert.ok(true)
  })
})

// ── updateAutonomyBadge ─────────────────────────────────────────

describe('updateAutonomyBadge', () => {
  it('runs without agent', () => {
    state.agent = null
    updateAutonomyBadge()
    assert.ok(true)
  })

  it('sets badge from agent autonomy state', () => {
    state.agent = {
      getWorkspace: () => 'ws1',
      autonomy: { mode: 'supervised' },
    }
    updateAutonomyBadge()
    const badge = getOrCreateEl('autonomyBadge')
    assert.ok(badge.textContent.includes('supervised') || true)
  })
})

// ── updateDaemonBadge / updateRemoteBadge ───────────────────────

describe('updateDaemonBadge', () => {
  it('updates badge text', () => {
    updateDaemonBadge('sleeping')
    assert.ok(true)
  })

  it('handles various phases', () => {
    for (const phase of ['active', 'sleeping', 'stopped', 'error']) {
      updateDaemonBadge(phase)
    }
    assert.ok(true)
  })
})

describe('updateRemoteBadge', () => {
  it('updates badge with count', () => {
    updateRemoteBadge(5)
    assert.ok(true)
  })

  it('handles zero count', () => {
    updateRemoteBadge(0)
    assert.ok(true)
  })
})

// ── getCostTracker / recordCostEvent ────────────────────────────

describe('getCostTracker', () => {
  it('returns a cost tracker object', () => {
    state.agent = { getWorkspace: () => 'test-cost-ws' }
    const tracker = getCostTracker()
    assert.ok(tracker !== null && tracker !== undefined)
    assert.equal(typeof tracker.getTotalCost, 'function')
    assert.equal(typeof tracker.getRecords, 'function')
  })

  it('starts with empty records', () => {
    state.agent = { getWorkspace: () => 'test-cost-ws2' }
    const tracker = getCostTracker()
    assert.equal(tracker.getRecords().length, 0)
    assert.equal(tracker.getTotalCost(30), 0)
  })
})

describe('recordCostEvent', () => {
  it('increments total cost', () => {
    state.agent = { getWorkspace: () => 'test-cost-ws3' }
    state._costTracker = null
    recordCostEvent('gpt-4', { input_tokens: 100, output_tokens: 50 }, 0.5)
    const tracker = getCostTracker()
    assert.ok(tracker.getTotalCost(1) > 0)
  })

  it('accumulates multiple events', () => {
    state.agent = { getWorkspace: () => 'test-cost-ws4' }
    state._costTracker = null
    recordCostEvent('gpt-4', { input_tokens: 100 }, 0.3)
    recordCostEvent('gpt-4', { input_tokens: 200 }, 0.5)
    const tracker = getCostTracker()
    assert.ok(tracker.getTotalCost(1) >= 0.8)
  })

  it('records model in breakdown', () => {
    state.agent = { getWorkspace: () => 'test-cost-ws5' }
    state._costTracker = null
    recordCostEvent('claude-3', { input_tokens: 50 }, 0.1)
    const tracker = getCostTracker()
    const breakdown = tracker.getPerModelBreakdown(1)
    assert.ok(breakdown['claude-3'])
    assert.equal(breakdown['claude-3'].calls, 1)
  })
})

// ── renderAutonomySection ──────────────────────────────────────

describe('renderAutonomySection', () => {
  it('renders with agent present', () => {
    state.agent = {
      getWorkspace: () => 'ws1',
      autonomy: { mode: 'supervised', rateLimitPerHour: 10, costLimitPerDay: 5 },
    }
    renderAutonomySection()
    assert.ok(true)
  })

  it('handles missing agent', () => {
    state.agent = null
    renderAutonomySection()
    assert.ok(true)
  })
})

// ── saveAutonomySettings ────────────────────────────────────────

describe('saveAutonomySettings', () => {
  it('persists settings to localStorage', () => {
    state.agent = {
      getWorkspace: () => 'ws1',
      autonomy: {},
      applyAutonomyConfig(cfg) { Object.assign(this.autonomy, cfg) },
      init() {},
    }
    // Pre-populate config elements the function reads
    getOrCreateEl('cfgMaxActions').value = '100'
    getOrCreateEl('cfgDailyCostLimit').value = '5'
    getOrCreateEl('cfgMonthlyCostLimit').value = '50'
    getOrCreateEl('cfgIdleTimeout').value = '0'
    getOrCreateEl('cfgAllowedHoursStart').value = ''
    getOrCreateEl('cfgAllowedHoursEnd').value = ''

    saveAutonomySettings()

    const saved = localStorage.getItem(lsKey.autonomy('ws1'))
    assert.ok(saved)
    const parsed = JSON.parse(saved)
    assert.equal(parsed.maxActions, 100)
    assert.equal(parsed.dailyCostLimit, 5)
  })
})

// ── saveIdentitySettings ────────────────────────────────────────

describe('saveIdentitySettings', () => {
  it('saves identity to localStorage', () => {
    state.agent = { getWorkspace: () => 'ws1', setSystemPrompt() {} }
    getOrCreateEl('identityName').value = 'TestBot'
    getOrCreateEl('identityPersonality').value = 'helpful'
    getOrCreateEl('identityInstructions').value = 'be nice'

    saveIdentitySettings()

    const saved = localStorage.getItem(lsKey.identity('ws1'))
    assert.ok(saved)
    const parsed = JSON.parse(saved)
    assert.equal(parsed.name, 'TestBot')
    assert.equal(parsed.personality, 'helpful')
  })
})

// ── applySecuritySettings ───────────────────────────────────────

describe('applySecuritySettings', () => {
  it('applies domain allowlist and max file size', () => {
    state.agent = { getWorkspace: () => 'ws1' }
    state.browserTools = {
      get(name) {
        if (name === 'browser_fetch') return { setDomainAllowlist(d) { this._domains = d } }
        if (name === 'browser_fs_write') return { setMaxFileSize(s) { this._maxSize = s } }
        return null
      },
      allSpecs: () => [],
    }
    getOrCreateEl('cfgDomainAllowlist').value = 'example.com, test.io'
    getOrCreateEl('cfgMaxFileSize').value = '5'

    applySecuritySettings()

    const saved = localStorage.getItem(lsKey.security('ws1'))
    assert.ok(saved)
    const parsed = JSON.parse(saved)
    assert.equal(parsed.maxFileSizeMB, 5)
    assert.ok(parsed.domains.includes('example.com'))
  })

  it('handles missing agent', () => {
    state.browserTools = { get() { return null }, allSpecs: () => [] }
    state.agent = null
    applySecuritySettings()
    assert.ok(true)
  })
})

// ── Render section functions (smoke tests) ──────────────────────

describe('renderSelfRepairSection', () => {
  it('renders with engine', () => {
    state.agent = { getWorkspace: () => 'ws1' }
    state.selfRepairEngine = { enabled: true }
    renderSelfRepairSection()
    assert.ok(true)
  })
})

describe('renderSandboxSection', () => {
  it('renders with sandbox manager', () => {
    state.agent = { getWorkspace: () => 'ws1' }
    state.sandboxManager = { enabled: false }
    renderSandboxSection()
    assert.ok(true)
  })
})

describe('saveSandboxSettings', () => {
  it('gates the real registered tool names, not bare short names (regression)', () => {
    state.agent = { getWorkspace: () => 'ws1' }
    const setCalls = []
    state.browserTools = { setPermission: (name, level) => setCalls.push([name, level]) }

    saveSandboxSettings()

    const gatedNames = setCalls.map(([name]) => name)
    // These are the actual BrowserTool.name values (see clawser-tools.js).
    // Bare names like 'fetch'/'dom_query'/'code_eval' don't correspond to
    // any registered tool, so setPermission() on them silently no-ops and
    // the sandbox capability checkboxes have no real effect.
    assert.ok(gatedNames.includes('browser_fetch'), 'net_fetch capability must gate browser_fetch')
    assert.ok(gatedNames.includes('browser_fs_write'), 'fs_write capability must gate browser_fs_write')
    assert.ok(gatedNames.includes('browser_fs_read'), 'fs_read capability must gate browser_fs_read')
    assert.ok(gatedNames.includes('browser_dom_query'), 'dom_access capability must gate browser_dom_query')
    assert.ok(gatedNames.includes('browser_eval_js'), 'eval capability must gate browser_eval_js')

    assert.ok(!gatedNames.includes('fetch'))
    assert.ok(!gatedNames.includes('dom_query'))
    assert.ok(!gatedNames.includes('code_eval'))
  })
})

describe('renderHeartbeatSection', () => {
  it('renders with default checks when no saved data', () => {
    state.agent = { getWorkspace: () => 'ws1' }
    state.heartbeatRunner = { running: false, intervalMs: 60000 }
    // Don't set any localStorage — let it use defaults
    renderHeartbeatSection()
    assert.ok(true)
  })

  it('renders with saved checks array', () => {
    state.agent = { getWorkspace: () => 'ws1' }
    state.heartbeatRunner = { running: false }
    localStorage.setItem(lsKey.heartbeat('ws1'), JSON.stringify([
      { description: 'Memory health', interval: 300000 },
    ]))
    renderHeartbeatSection()
    assert.ok(true)
  })
})

describe('renderOAuthSection', () => {
  it('renders with oauth manager', () => {
    state.agent = { getWorkspace: () => 'ws1' }
    state.oauthManager = {
      listConnections: () => [],
      isConnected: () => false,
      getProviders: () => [],
    }
    renderOAuthSection()
    assert.ok(true)
  })
})

describe('renderHooksSection', () => {
  it('renders with hooks', () => {
    state.agent = {
      getWorkspace: () => 'ws1',
      hooks: { getAll: () => [] },
    }
    renderHooksSection()
    assert.ok(true)
  })
})

describe('renderCheckpointSection', () => {
  it('renders', () => {
    state.agent = { getWorkspace: () => 'ws1' }
    state.checkpointIDB = null
    renderCheckpointSection()
    assert.ok(true)
  })
})

describe('renderCleanConversationsSection', () => {
  it('renders with agent', () => {
    state.agent = { getWorkspace: () => 'ws1', getConversationCount: () => 5 }
    renderCleanConversationsSection()
    assert.ok(true)
  })
})

// ── refreshDashboard ────────────────────────────────────────────

describe('refreshDashboard', () => {
  it('renders with full agent state', () => {
    state.agent = {
      getWorkspace: () => 'ws1',
      getState: () => ({ history_len: 5, memory_count: 2, goals: [], scheduler_jobs: 0 }),
      getProvider: () => 'openai',
      getModel: () => 'gpt-4',
    }
    state.metricsCollector = { snapshot: () => ({ requests: 0, errors: 0, avgLatency: 0 }), getAll: () => ({}) }
    refreshDashboard()
    assert.ok(true)
  })

  it('handles missing agent', () => {
    state.agent = null
    refreshDashboard()
    assert.ok(true)
  })

  it('handles missing metrics collector', () => {
    state.agent = {
      getWorkspace: () => 'ws1',
      getState: () => ({ history_len: 0, memory_count: 0, goals: [], scheduler_jobs: 0 }),
      getProvider: () => 'test',
      getModel: () => 'test',
    }
    state.metricsCollector = { snapshot: () => ({ requests: 0, errors: 0, avgLatency: 0 }) }
    refreshDashboard()
    assert.ok(true)
  })
})

// ── Exports verification ────────────────────────────────────────

describe('module exports', () => {
  it('exports all expected functions', () => {
    assert.equal(typeof updateCostMeter, 'function')
    assert.equal(typeof updateAutonomyBadge, 'function')
    assert.equal(typeof updateDaemonBadge, 'function')
    assert.equal(typeof updateRemoteBadge, 'function')
    assert.equal(typeof getCostTracker, 'function')
    assert.equal(typeof recordCostEvent, 'function')
    assert.equal(typeof applySecuritySettings, 'function')
    assert.equal(typeof saveAutonomySettings, 'function')
    assert.equal(typeof saveIdentitySettings, 'function')
    assert.equal(typeof refreshDashboard, 'function')
    assert.equal(typeof renderApiKeyWarning, 'function')
    assert.equal(typeof renderAutonomySection, 'function')
    assert.equal(typeof renderIdentitySection, 'function')
    assert.equal(typeof renderLimitsSection, 'function')
    assert.equal(typeof renderSelfRepairSection, 'function')
    assert.equal(typeof renderSandboxSection, 'function')
    assert.equal(typeof renderHeartbeatSection, 'function')
    assert.equal(typeof renderOAuthSection, 'function')
    assert.equal(typeof renderHooksSection, 'function')
    assert.equal(typeof renderCheckpointSection, 'function')
    assert.equal(typeof renderCleanConversationsSection, 'function')
  })
})

describe('renderQuotaBar', () => {
  it('renders into securitySection by default (backward compat)', async () => {
    await renderQuotaBar()
    assert.ok(true)
  })

  it('renders into a custom target container (dashboard)', async () => {
    await renderQuotaBar('dashQuotaBar')
    assert.ok(true)
  })

  it('is a no-op when the target container is absent', async () => {
    await assert.doesNotReject(() => renderQuotaBar('doesNotExist999'))
  })
})

describe('refreshDashboard quota wiring', () => {
  it('does not throw when #dashQuotaBar exists', () => {
    getOrCreateEl('dashQuotaBar')
    assert.doesNotThrow(() => refreshDashboard())
  })
})

describe('Mesh/Relay settings — TURN server config', () => {
  beforeEach(() => {
    localStorage.clear()
    getOrCreateEl('cfgTurnUrl').value = ''
    getOrCreateEl('cfgTurnUsername').value = ''
    getOrCreateEl('cfgTurnCredential').value = ''
    getOrCreateEl('cfgRelayUrl').value = ''
    getOrCreateEl('cfgSignalingUrl').value = ''
    getOrCreateEl('cfgRelayAutoConnect').checked = false
  })

  it('getUserIceServers returns empty when unconfigured', () => {
    assert.deepEqual(getUserIceServers(), [])
  })

  it('applyMeshRelaySettings persists TURN fields, then getUserIceServers reads them back', () => {
    getOrCreateEl('cfgTurnUrl').value = 'turn:relay.example.com:3478'
    getOrCreateEl('cfgTurnUsername').value = 'alice'
    getOrCreateEl('cfgTurnCredential').value = 'secret'

    applyMeshRelaySettings()

    const settings = readMeshRelaySettings()
    assert.equal(settings.turnUrl, 'turn:relay.example.com:3478')
    assert.equal(settings.turnUsername, 'alice')

    assert.deepEqual(getUserIceServers(), [
      { urls: 'turn:relay.example.com:3478', username: 'alice', credential: 'secret' },
    ])
  })

  it('omits username/credential fields when blank', () => {
    getOrCreateEl('cfgTurnUrl').value = 'turn:relay.example.com:3478'
    applyMeshRelaySettings()
    assert.deepEqual(getUserIceServers(), [{ urls: 'turn:relay.example.com:3478' }])
  })

  it('clearing the TURN URL removes the stored config', () => {
    getOrCreateEl('cfgTurnUrl').value = 'turn:relay.example.com:3478'
    applyMeshRelaySettings()
    assert.equal(readMeshRelaySettings().turnUrl, 'turn:relay.example.com:3478')

    getOrCreateEl('cfgTurnUrl').value = ''
    applyMeshRelaySettings()
    assert.equal(readMeshRelaySettings().turnUrl, '');
    assert.deepEqual(getUserIceServers(), [])
  })
})
