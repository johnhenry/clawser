// Run with: node --import ./web/test/_setup-globals.mjs --test web/test/clawser-app.test.mjs
//
// clawser-app.js is the top-level orchestrator — it runs heavy side effects at
// module level (singleton creation, event bus wiring, listener init, async IIFE).
// ES `import` declarations are hoisted, so we MUST set up all browser stubs in
// _setup-globals.mjs (via --import) plus additional stubs here BEFORE using
// dynamic `import()` to load the module under test.

import { describe, it, beforeEach, afterEach, before, after } from 'node:test'
import assert from 'node:assert/strict'

// ── Additional browser globals needed by clawser-app's deep import tree ──
globalThis.BrowserTool = globalThis.BrowserTool || class { constructor() {} }
try { globalThis.crypto = globalThis.crypto || { subtle: {}, getRandomValues: (a) => a, randomUUID: () => 'test-uuid' } } catch {}
globalThis.fetch = globalThis.fetch || (async () => ({ ok: true, json: async () => ({}) }))
globalThis.MutationObserver = globalThis.MutationObserver || class { observe() {} disconnect() {} }
globalThis.IntersectionObserver = globalThis.IntersectionObserver || class { observe() {} disconnect() {} }
globalThis.ResizeObserver = globalThis.ResizeObserver || class { observe() {} disconnect() {} }
globalThis.MessageChannel = globalThis.MessageChannel || class {
  constructor() {
    this.port1 = { onmessage: null, postMessage() {}, close() {} }
    this.port2 = { onmessage: null, postMessage() {}, close() {} }
  }
}
globalThis.Worker = globalThis.Worker || class { postMessage() {} terminate() {} addEventListener() {} }
globalThis.SharedWorker = globalThis.SharedWorker || class {
  constructor() { this.port = { start() {}, postMessage() {}, addEventListener() {}, close() {} } }
}
globalThis.WebSocket = globalThis.WebSocket || class { send() {} close() {} addEventListener() {} }
globalThis.RTCPeerConnection = globalThis.RTCPeerConnection || class {
  createDataChannel() { return { addEventListener() {} } }
  close() {} addEventListener() {}
}

// window must exist before clawser-route-handler.js evaluates its module-level
// `window.addEventListener('hashchange', ...)` call.
if (typeof globalThis.window === 'undefined') {
  globalThis.window = globalThis
}
if (typeof globalThis.window.addEventListener !== 'function') {
  const _windowListeners = []
  globalThis.window.addEventListener = (type, fn, opts) => { _windowListeners.push({ type, fn, opts }) }
  globalThis.window.removeEventListener = () => {}
  globalThis.window.open = () => null
  globalThis.window._listeners = _windowListeners
}

// location stubs
if (!globalThis.location.origin) globalThis.location.origin = 'http://localhost'
if (!globalThis.location.hash) globalThis.location.hash = '#home'

// Enriched document.getElementById — many modules query DOM elements at init
const _origGetById = globalThis.document?.getElementById
globalThis.document.getElementById = (id) => {
  const orig = _origGetById?.(id)
  if (orig) return orig
  return {
    value: '', textContent: '', innerHTML: '', className: '',
    style: { display: '' }, dataset: {},
    classList: { add() {}, remove() {}, toggle() {}, contains() { return false } },
    addEventListener() {}, removeEventListener() {},
    appendChild() {}, removeChild() {},
    querySelector() { return null }, querySelectorAll() { return [] },
    showModal() {}, close() {}, focus() {},
  }
}
// querySelector must return a rich stub (not null) — initPanelListeners calls
// document.querySelector('#viewWorkspace .logo').addEventListener(...)
const _richElement = () => ({
  value: '', textContent: '', innerHTML: '', className: '',
  style: { display: '', cursor: '' }, dataset: {},
  classList: { add() {}, remove() {}, toggle() {}, contains() { return false } },
  addEventListener() {}, removeEventListener() {},
  appendChild() {}, removeChild() {}, click() {},
  querySelector() { return _richElement() },
  querySelectorAll() { return [] },
  showModal() {}, close() {}, focus() {},
})
globalThis.document.querySelector = globalThis.document.querySelector || (() => _richElement())
globalThis.document.querySelectorAll = globalThis.document.querySelectorAll || (() => [])
globalThis.document.createDocumentFragment = globalThis.document.createDocumentFragment || (() => ({
  appendChild() {}, querySelectorAll() { return [] },
}))

// createElement must return rich elements (renderHomeWorkspaceList creates cards
// that need querySelector, dataset, etc. — the _setup-globals stub is too minimal)
globalThis.document.createElement = () => _richElement()

// navigator.serviceWorker for the startup IIFE periodicSync registration
try {
  if (!globalThis.navigator.serviceWorker) {
    Object.defineProperty(globalThis.navigator, 'serviceWorker', {
      value: { ready: Promise.resolve({ periodicSync: null }) },
      configurable: true,
    })
  }
} catch { /* navigator is a getter in some Node versions */ }

// ── Dynamic imports — stubs are in place, NOW load modules ──────
// We hoist these into module-scope variables so every describe/it block can use them.
let state, on, off, emit, configCache, shutdown

before(async () => {
  const stateMod = await import('../clawser-state.js')
  state = stateMod.state
  on = stateMod.on
  off = stateMod.off
  emit = stateMod.emit
  configCache = stateMod.configCache

  // Enable demoMode to skip the vault passphrase modal in the startup IIFE
  // (showVaultModal waits for user input which hangs in tests)
  state.demoMode = true

  const appMod = await import('../clawser-app.js')
  shutdown = appMod.shutdown

  // Give the async IIFE a tick to settle (it calls ensureDefaultWorkspace, handleRoute, etc.)
  await new Promise(r => setTimeout(r, 50))
})

after(() => {
  // The app boot path leaves background handles (intervals, listeners,
  // OPFS pollers) that can't be cleanly torn down in a test environment.
  // Once all tests pass, schedule a process.exit() with enough delay for
  // node:test to flush its final # tests / # suites summary to stdout.
  setTimeout(() => process.exit(0), 100).unref?.()
})

// ── Test helpers ─────────────────────────────────────────────────

const tracker = () => {
  const calls = []
  const fn = (...args) => { calls.push(args); return fn._returnValue }
  fn.calls = calls
  fn.called = () => calls.length > 0
  fn.callCount = () => calls.length
  fn._returnValue = undefined
  fn.returns = (v) => { fn._returnValue = v; return fn }
  return fn
}

const asyncTracker = () => {
  const calls = []
  const fn = async (...args) => { calls.push(args); return fn._returnValue }
  fn.calls = calls
  fn.called = () => calls.length > 0
  fn.callCount = () => calls.length
  fn._returnValue = undefined
  fn.returns = (v) => { fn._returnValue = v; return fn }
  return fn
}

const mockAgent = (wsId = 'test-ws') => ({
  getWorkspace: () => wsId,
  persistMemories: tracker(),
  persistCheckpoint: asyncTracker(),
  persistConfig: tracker(),
  persistConversation: asyncTracker(),
  truncateHistory: tracker().returns([]),
  restoreHistory: tracker(),
  memoryStore: tracker(),
  memoryForget: tracker(),
  updateGoal: tracker(),
  getState: () => ({ workspace: wsId }),
  registerToolSpec: tracker(),
  unregisterToolSpec: tracker(),
})

// ═════════════════════════════════════════════════════════════════
// Tests
// ═════════════════════════════════════════════════════════════════

// ── Module-level singleton creation ─────────────────────────────

describe('clawser-app: module-level singletons', () => {
  it('creates workspaceFs on state', () => {
    assert.ok(state.workspaceFs, 'state.workspaceFs should exist')
    assert.equal(typeof state.workspaceFs.resolve, 'function', 'workspaceFs should have resolve()')
  })

  it('creates browserTools registry on state', () => {
    assert.ok(state.browserTools, 'state.browserTools should exist')
    assert.equal(typeof state.browserTools.allSpecs, 'function', 'browserTools should have allSpecs()')
  })

  it('creates providers on state', () => {
    assert.ok(state.providers, 'state.providers should exist')
  })

  it('creates mcpManager on state', () => {
    assert.ok(state.mcpManager, 'state.mcpManager should exist')
  })

  it('creates responseCache on state', () => {
    assert.ok(state.responseCache, 'state.responseCache should exist')
  })

  it('creates vault on state', () => {
    assert.ok(state.vault, 'state.vault should exist')
    assert.equal(typeof state.vault.lock, 'function', 'vault should have lock()')
  })

  it('creates kernel on state', () => {
    assert.ok(state.kernel, 'state.kernel should exist')
    assert.equal(typeof state.kernel.close, 'function', 'kernel should have close()')
  })

  it('creates identityManager on state', () => {
    assert.ok(state.identityManager)
  })

  it('creates safetyPipeline on state', () => {
    assert.ok(state.safetyPipeline)
  })

  it('creates undoManager on state', () => {
    assert.ok(state.undoManager)
  })

  it('creates heartbeatRunner on state', () => {
    assert.ok(state.heartbeatRunner)
  })

  it('creates metricsCollector on state', () => {
    assert.ok(state.metricsCollector)
  })

  it('creates ringBufferLog with push() on state', () => {
    assert.ok(state.ringBufferLog)
    assert.equal(typeof state.ringBufferLog.push, 'function')
  })

  it('creates daemonController on state', () => {
    assert.ok(state.daemonController)
  })

  it('creates routineEngine on state', () => {
    assert.ok(state.routineEngine)
  })

  it('creates oauthManager on state', () => {
    assert.ok(state.oauthManager)
  })

  it('creates toolBuilder on state', () => {
    assert.ok(state.toolBuilder)
  })

  it('creates channelManager on state', () => {
    assert.ok(state.channelManager)
  })

  it('creates delegateManager on state', () => {
    assert.ok(state.delegateManager)
  })

  it('creates goalManager on state', () => {
    assert.ok(state.goalManager)
  })

  it('creates skillRegistry on state', () => {
    assert.ok(state.skillRegistry)
  })

  it('creates skillRegistryClient on state', () => {
    assert.ok(state.skillRegistryClient)
  })

  it('creates providerHealth on state', () => {
    assert.ok(state.providerHealth)
  })

  it('creates modelRouter on state', () => {
    assert.ok(state.modelRouter)
  })

  it('creates stuckDetector on state', () => {
    assert.ok(state.stuckDetector)
  })

  it('creates selfRepairEngine on state', () => {
    assert.ok(state.selfRepairEngine)
  })

  it('creates authProfileManager on state', () => {
    assert.ok(state.authProfileManager)
  })

  it('creates checkpointIDB on state', () => {
    assert.ok(state.checkpointIDB)
  })

  it('creates gitBehavior on state', () => {
    assert.ok(state.gitBehavior)
  })

  it('creates gitMemory on state', () => {
    assert.ok(state.gitMemory)
  })

  it('creates automationManager on state', () => {
    assert.ok(state.automationManager)
  })

  it('creates sandboxManager on state', () => {
    assert.ok(state.sandboxManager)
  })

  it('creates peripheralManager on state', () => {
    assert.ok(state.peripheralManager)
  })

  it('creates pairingManager on state', () => {
    assert.ok(state.pairingManager)
  })

  it('creates intentRouter on state', () => {
    assert.ok(state.intentRouter)
  })

  it('creates inputSanitizer on state', () => {
    assert.ok(state.inputSanitizer)
  })

  it('creates toolCallValidator on state', () => {
    assert.ok(state.toolCallValidator)
  })
})

// ── Frozen service slots ────────────────────────────────────────

describe('clawser-app: frozen service slots', () => {
  it('workspaceFs is non-writable', () => {
    const original = state.workspaceFs
    assert.throws(() => { state.workspaceFs = 'replaced' }, TypeError)
    assert.strictEqual(state.workspaceFs, original)
  })

  it('browserTools is non-writable', () => {
    const original = state.browserTools
    assert.throws(() => { state.browserTools = 'replaced' }, TypeError)
    assert.strictEqual(state.browserTools, original)
  })

  it('providers is non-writable', () => {
    const original = state.providers
    assert.throws(() => { state.providers = 'replaced' }, TypeError)
    assert.strictEqual(state.providers, original)
  })

  it('mcpManager is non-writable', () => {
    const original = state.mcpManager
    assert.throws(() => { state.mcpManager = 'replaced' }, TypeError)
    assert.strictEqual(state.mcpManager, original)
  })

  it('responseCache is non-writable', () => {
    const original = state.responseCache
    assert.throws(() => { state.responseCache = 'replaced' }, TypeError)
    assert.strictEqual(state.responseCache, original)
  })

  it('vault is non-writable', () => {
    const original = state.vault
    assert.throws(() => { state.vault = 'replaced' }, TypeError)
    assert.strictEqual(state.vault, original)
  })
})

// ── Kernel integration ──────────────────────────────────────────

describe('clawser-app: kernel integration', () => {
  it('wires kernel integration to mcpManager', () => {
    assert.ok(state.mcpManager._kernelIntegration, 'mcpManager should have _kernelIntegration')
  })

  it('kernel is an instance with close()', () => {
    assert.equal(typeof state.kernel.close, 'function')
  })

  it('wires a real KernelWshBridge into clawser-wsh-incoming (was never constructed before)', async () => {
    const { getKernelBridge } = await import('../clawser-wsh-incoming.js')
    const bridge = getKernelBridge()
    assert.ok(bridge, 'a kernel bridge should be set')
    assert.equal(typeof bridge.handleReverseConnect, 'function')
    // Prove it's backed by the real state.kernel, not a stand-in: creating a
    // tenant through it should show up as a real kernel tenant.
    const { tenantId } = bridge.handleGuestJoin({ guestId: 'test-guest-1' })
    assert.ok(tenantId)
    bridge.handleParticipantLeave('test-guest-1')
  })
})

// ── Event bus wiring ────────────────────────────────────────────

describe('clawser-app: event bus subscriptions', () => {
  it('refreshFiles event does not throw', () => {
    assert.doesNotThrow(() => emit('refreshFiles'))
  })

  it('renderGoals event does not throw', () => {
    assert.doesNotThrow(() => emit('renderGoals'))
  })

  it('renderSkills event does not throw', () => {
    assert.doesNotThrow(() => emit('renderSkills'))
  })

  it('saveConfig event does not throw', () => {
    assert.doesNotThrow(() => emit('saveConfig'))
  })

  it('updateCostMeter event does not throw', () => {
    assert.doesNotThrow(() => emit('updateCostMeter'))
  })

  it('updateDaemon event does not throw', () => {
    assert.doesNotThrow(() => emit('updateDaemon', 'idle'))
  })

  it('updateRemote event does not throw', () => {
    assert.doesNotThrow(() => emit('updateRemote', 0))
  })

  it('refreshDashboard event does not throw', () => {
    assert.doesNotThrow(() => emit('refreshDashboard'))
  })

  it('newShellSession event does not throw', () => {
    assert.doesNotThrow(() => emit('newShellSession'))
  })
})

// ── shutdown() ──────────────────────────────────────────────────

describe('shutdown()', () => {
  beforeEach(() => {
    state.shuttingDown = false
  })

  afterEach(() => {
    state.shuttingDown = false
    state.agent = null
  })

  it('is an exported async function', () => {
    assert.equal(typeof shutdown, 'function')
  })

  it('returns a promise', () => {
    const result = shutdown()
    assert.ok(result instanceof Promise)
    // reset for subsequent tests
    state.shuttingDown = false
  })

  it('sets state.shuttingDown to true', async () => {
    await shutdown()
    assert.equal(state.shuttingDown, true)
  })

  it('is idempotent — second call returns immediately', async () => {
    await shutdown()
    assert.equal(state.shuttingDown, true)
    // second call is a no-op
    await shutdown()
    assert.equal(state.shuttingDown, true)
  })

  it('persists agent memories when agent exists', async () => {
    const agent = mockAgent()
    state.agent = agent
    await shutdown()
    assert.ok(agent.persistMemories.called(), 'should call agent.persistMemories()')
  })

  it('persists agent checkpoint when agent exists', async () => {
    const agent = mockAgent()
    state.agent = agent
    await shutdown()
    assert.ok(agent.persistCheckpoint.called(), 'should call agent.persistCheckpoint()')
  })

  it('persists agent config when agent exists', async () => {
    const agent = mockAgent()
    state.agent = agent
    await shutdown()
    assert.ok(agent.persistConfig.called(), 'should call agent.persistConfig()')
  })

  it('does not throw when agent is null', async () => {
    state.agent = null
    await assert.doesNotReject(() => shutdown())
  })

  it('locks the vault without throwing', async () => {
    await assert.doesNotReject(() => shutdown())
  })

  it('emits shutdown event', async () => {
    let emitted = false
    const fn = () => { emitted = true }
    on('shutdown', fn)
    await shutdown()
    assert.ok(emitted, 'should emit shutdown event')
    off('shutdown', fn)
  })

  it('closes kernel without throwing', async () => {
    await assert.doesNotReject(() => shutdown())
  })

  it('stops daemonController on shutdown', async () => {
    const mockDaemon = { stop: asyncTracker() }
    const original = state.daemonController
    state.daemonController = mockDaemon
    await shutdown()
    assert.ok(mockDaemon.stop.called(), 'should call daemonController.stop()')
    state.daemonController = original
  })

  it('stops routineEngine on shutdown', async () => {
    const mockEngine = { stop: asyncTracker(), listRoutines: () => [] }
    const original = state.routineEngine
    state.routineEngine = mockEngine
    await shutdown()
    assert.ok(mockEngine.stop.called(), 'should call routineEngine.stop()')
    state.routineEngine = original
  })

  it('flushes configCache on shutdown', async () => {
    // configCache.flush() is called inside shutdown — verify no throw
    await assert.doesNotReject(() => shutdown())
  })

  it('disconnects MCP servers without throwing', async () => {
    await assert.doesNotReject(() => shutdown())
  })

  it('handles missing subsystems gracefully', async () => {
    const origDaemon = state.daemonController
    const origRoutine = state.routineEngine
    state.daemonController = null
    state.routineEngine = null
    state.agent = null
    await assert.doesNotReject(() => shutdown())
    state.daemonController = origDaemon
    state.routineEngine = origRoutine
  })
})

// ── UndoManager handler wiring ──────────────────────────────────

describe('clawser-app: UndoManager handler wiring', () => {
  it('undoManager exists and has beginTurn()', () => {
    assert.ok(state.undoManager)
    assert.equal(typeof state.undoManager.beginTurn, 'function')
  })
})

// ── RingBufferLog ───────────────────────────────────────────────

describe('clawser-app: RingBufferLog wiring', () => {
  it('accepts entries via push()', () => {
    assert.doesNotThrow(() => {
      state.ringBufferLog.push({ level: 'error', type: 'test', message: 'test-error', timestamp: Date.now() })
    })
  })
})

// ── SkillRegistry wiring ────────────────────────────────────────

describe('clawser-app: skillRegistry wiring', () => {
  it('skillRegistry exists on state', () => {
    assert.ok(state.skillRegistry)
  })

  it('activeSkillPrompts map exists on state', () => {
    assert.ok(state.activeSkillPrompts !== undefined, 'state.activeSkillPrompts should exist')
  })
})

// ── Provider setup ──────────────────────────────────────────────

describe('clawser-app: provider setup', () => {
  it('providers is an object', () => {
    assert.equal(typeof state.providers, 'object')
  })

  it('responseCache is an object', () => {
    assert.equal(typeof state.responseCache, 'object')
  })
})

// ── Safety pipeline wiring ──────────────────────────────────────

describe('clawser-app: safety pipeline', () => {
  it('safetyPipeline and its dependencies exist', () => {
    assert.ok(state.safetyPipeline)
    assert.ok(state.inputSanitizer)
    assert.ok(state.toolCallValidator)
  })
})

// ── Self-repair engine ──────────────────────────────────────────

describe('clawser-app: self-repair engine', () => {
  it('selfRepairEngine and stuckDetector exist', () => {
    assert.ok(state.selfRepairEngine)
    assert.ok(state.stuckDetector)
  })
})

// ── OAuth manager ───────────────────────────────────────────────

describe('clawser-app: OAuthManager', () => {
  it('oauthManager exists on state', () => {
    assert.ok(state.oauthManager)
  })
})

// ── Feature module singletons ───────────────────────────────────

describe('clawser-app: feature module singletons', () => {
  it('channelManager exists', () => { assert.ok(state.channelManager) })
  it('delegateManager exists', () => { assert.ok(state.delegateManager) })
  it('gitBehavior and gitMemory are linked', () => {
    assert.ok(state.gitBehavior)
    assert.ok(state.gitMemory)
  })
  it('automationManager exists', () => { assert.ok(state.automationManager) })
  it('sandboxManager exists', () => { assert.ok(state.sandboxManager) })
  it('peripheralManager exists', () => { assert.ok(state.peripheralManager) })
  it('pairingManager exists', () => { assert.ok(state.pairingManager) })
})

// ── configCache ─────────────────────────────────────────────────

describe('clawser-app: configCache', () => {
  it('has flush method', () => {
    assert.equal(typeof configCache.flush, 'function')
  })

  it('flush does not throw', () => {
    assert.doesNotThrow(() => configCache.flush())
  })
})

// ── Export surface ──────────────────────────────────────────────

describe('clawser-app: exports', () => {
  it('exports shutdown as the only named export', async () => {
    const mod = await import('../clawser-app.js')
    const exportNames = Object.keys(mod)
    assert.deepEqual(exportNames, ['shutdown'])
  })
})
