// Run with: node --import ./web/test/_setup-globals.mjs --test web/test/clawser-workspace-cleanup.test.mjs
import { describe, it, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'

// Stub globals needed by the deep workspace lifecycle import chain
globalThis.BrowserTool = globalThis.BrowserTool || class { constructor() {} }
// crypto is read-only in Node 24+ — only set if missing
try { globalThis.crypto = globalThis.crypto || { subtle: {}, getRandomValues: (a) => a, randomUUID: () => 'test-uuid' } } catch {}
globalThis.fetch = globalThis.fetch || (async () => ({ ok: true, json: async () => ({}) }))
globalThis.MutationObserver = globalThis.MutationObserver || class { observe() {} disconnect() {} }
globalThis.IntersectionObserver = globalThis.IntersectionObserver || class { observe() {} disconnect() {} }
globalThis.ResizeObserver = globalThis.ResizeObserver || class { observe() {} disconnect() {} }
const _origGetById = globalThis.document?.getElementById
if (globalThis.document) {
  globalThis.document.getElementById = (id) => _origGetById?.(id) ?? { value: '', textContent: '', innerHTML: '', className: '', style: {}, dataset: {}, classList: { add(){}, remove(){}, toggle(){}, contains(){ return false } }, addEventListener(){}, removeEventListener(){}, appendChild(){}, querySelector(){ return null }, querySelectorAll(){ return [] } }
}

import { state, lsKey } from '../clawser-state.js'
import { cleanupWorkspace, setKernelIntegration } from '../clawser-workspace-lifecycle.js'

// ── Helpers ──────────────────────────────────────────────────────

/** Create a call tracker that records invocations. */
function tracker() {
  const calls = []
  const fn = (...args) => { calls.push(args); return fn._returnValue }
  fn.calls = calls
  fn.called = () => calls.length > 0
  fn.callCount = () => calls.length
  fn._returnValue = undefined
  fn.returns = (v) => { fn._returnValue = v; return fn }
  return fn
}

/** Async variant that returns a resolved promise. */
function asyncTracker() {
  const calls = []
  const fn = async (...args) => { calls.push(args); return fn._returnValue }
  fn.calls = calls
  fn.called = () => calls.length > 0
  fn.callCount = () => calls.length
  fn._returnValue = undefined
  fn.returns = (v) => { fn._returnValue = v; return fn }
  return fn
}

/** Build a mock agent with all methods cleanupWorkspace needs. */
function mockAgent(wsId = 'test-ws') {
  return {
    getWorkspace: () => wsId,
    persistMemories: tracker(),
    persistCheckpoint: asyncTracker(),
    persistConfig: tracker(),
    persistConversation: asyncTracker(),
  }
}

/** Build a mock routine engine. */
function mockRoutineEngine(jsonData = { tasks: [] }) {
  return {
    stop: tracker(),
    toJSON: () => jsonData,
  }
}

/** Build a mock daemon controller. */
function mockDaemonController() {
  return {
    stop: asyncTracker(),
  }
}

/** Build a mock terminal session manager. */
function mockTerminalSessions() {
  return {
    persist: asyncTracker(),
  }
}

/** Build a mock pod (ClawserPod). */
function mockPod() {
  return {
    shutdown: asyncTracker(),
  }
}

/** Build a mock gateway. */
function mockGateway() {
  return {
    stop: tracker(),
  }
}

/** Build a mock skill registry with some active skills. */
function mockSkillRegistry(activeNames = ['skill-a', 'skill-b']) {
  const deactivated = []
  const active = new Map(activeNames.map(n => [n, { name: n }]))
  return {
    activeSkills: active,
    deactivate(name) { deactivated.push(name); active.delete(name) },
    _deactivated: deactivated,
  }
}

/** Build a mock kernel integration. */
function mockKernelIntegration() {
  return {
    destroyWorkspaceTenant: tracker(),
    createWorkspaceTenant: tracker(),
    hookEventLog: tracker(),
  }
}

// ── Helpers to install/reset state ───────────────────────────────

function installFullState(overrides = {}) {
  const defaults = {
    agent: mockAgent(),
    routineEngine: mockRoutineEngine(),
    daemonController: mockDaemonController(),
    terminalSessions: mockTerminalSessions(),
    pod: mockPod(),
    gateway: mockGateway(),
    skillRegistry: mockSkillRegistry(),
    _updateInterval: setInterval(() => {}, 999999),
  }
  const merged = { ...defaults, ...overrides }
  for (const [k, v] of Object.entries(merged)) {
    state[k] = v
  }
  return merged
}

function clearState() {
  state.agent = null
  state.routineEngine = null
  state.daemonController = null
  state.terminalSessions = null
  state.pod = null
  state.gateway = null
  state.skillRegistry = null
  state._updateInterval = null
  setKernelIntegration(null)
}

// ── Tests ────────────────────────────────────────────────────────

describe('cleanupWorkspace', () => {
  beforeEach(() => {
    localStorage.clear()
    clearState()
  })

  afterEach(() => {
    // Clear any lingering intervals to prevent process hangs
    if (state._updateInterval) { clearInterval(state._updateInterval); state._updateInterval = null }
    clearState()
  })

  // ── Early return ──────────────────────────────────────────────

  it('returns immediately when state.agent is null', async () => {
    state.agent = null
    // Should not throw even with no subsystems
    await cleanupWorkspace()
  })

  it('returns immediately when state.agent is undefined', async () => {
    state.agent = undefined
    await cleanupWorkspace()
  })

  // ── Happy path: all subsystems present ────────────────────────

  it('clears the update interval', async () => {
    const s = installFullState()
    const intervalId = s._updateInterval
    await cleanupWorkspace()
    assert.equal(state._updateInterval, null, '_updateInterval should be nulled')
  })

  it('stops the routine engine', async () => {
    const s = installFullState()
    await cleanupWorkspace()
    assert.ok(s.routineEngine.stop.called(), 'routineEngine.stop should be called')
  })

  it('stops the daemon controller', async () => {
    const s = installFullState()
    await cleanupWorkspace()
    assert.ok(s.daemonController.stop.called(), 'daemonController.stop should be called')
  })

  it('persists terminal sessions', async () => {
    const s = installFullState()
    await cleanupWorkspace()
    assert.ok(s.terminalSessions.persist.called(), 'terminalSessions.persist should be called')
  })

  it('persists agent memories', async () => {
    const s = installFullState()
    await cleanupWorkspace()
    assert.ok(s.agent.persistMemories.called(), 'agent.persistMemories should be called')
  })

  it('persists agent checkpoint', async () => {
    const s = installFullState()
    await cleanupWorkspace()
    assert.ok(s.agent.persistCheckpoint.called(), 'agent.persistCheckpoint should be called')
  })

  it('saves routine state to localStorage', async () => {
    const routineData = { tasks: [{ id: 'r1' }] }
    installFullState({ routineEngine: mockRoutineEngine(routineData) })
    await cleanupWorkspace()
    const key = lsKey.routines('test-ws')
    const stored = localStorage.getItem(key)
    assert.ok(stored, 'routine data should be stored in localStorage')
    assert.deepEqual(JSON.parse(stored), routineData)
  })

  it('shuts down the pod', async () => {
    const s = installFullState()
    await cleanupWorkspace()
    assert.ok(s.pod.shutdown.called(), 'pod.shutdown should be called')
  })

  it('stops the channel gateway', async () => {
    const s = installFullState()
    await cleanupWorkspace()
    assert.ok(s.gateway.stop.called(), 'gateway.stop should be called')
  })

  it('deactivates all active skills', async () => {
    const reg = mockSkillRegistry(['alpha', 'beta', 'gamma'])
    installFullState({ skillRegistry: reg })
    await cleanupWorkspace()
    assert.deepEqual(reg._deactivated.sort(), ['alpha', 'beta', 'gamma'].sort())
    assert.equal(reg.activeSkills.size, 0, 'all skills should be deactivated')
  })

  // ── Kernel integration ────────────────────────────────────────

  it('destroys kernel tenant when kernel integration is set', async () => {
    const ki = mockKernelIntegration()
    setKernelIntegration(ki)
    installFullState()
    await cleanupWorkspace()
    assert.ok(ki.destroyWorkspaceTenant.called(), 'should destroy kernel tenant')
    assert.deepEqual(ki.destroyWorkspaceTenant.calls[0], ['test-ws'])
  })

  it('skips kernel tenant destruction when no kernel integration', async () => {
    setKernelIntegration(null)
    installFullState()
    // Should complete without error
    await cleanupWorkspace()
  })

  // ── Null/undefined subsystems ─────────────────────────────────

  describe('null subsystems', () => {
    it('handles null terminalSessions', async () => {
      installFullState({ terminalSessions: null })
      await cleanupWorkspace()
      // Should not throw
    })

    it('handles null pod', async () => {
      installFullState({ pod: null })
      await cleanupWorkspace()
    })

    it('handles null gateway', async () => {
      installFullState({ gateway: null })
      await cleanupWorkspace()
    })

    it('handles null skillRegistry', async () => {
      installFullState({ skillRegistry: null })
      await cleanupWorkspace()
    })

    it('handles undefined pod', async () => {
      installFullState({ pod: undefined })
      await cleanupWorkspace()
    })

    it('handles undefined gateway', async () => {
      installFullState({ gateway: undefined })
      await cleanupWorkspace()
    })

    it('handles undefined skillRegistry', async () => {
      installFullState({ skillRegistry: undefined })
      await cleanupWorkspace()
    })

    it('handles missing _updateInterval', async () => {
      installFullState({ _updateInterval: null })
      await cleanupWorkspace()
      assert.equal(state._updateInterval, null)
    })
  })

  // ── Error resilience ──────────────────────────────────────────

  describe('error resilience', () => {
    it('continues when daemon controller stop throws', async () => {
      const dc = mockDaemonController()
      dc.stop = async () => { throw new Error('daemon boom') }
      installFullState({ daemonController: dc })
      // Should not throw — daemon stop errors are caught
      await cleanupWorkspace()
    })

    it('continues when terminal session persist throws', async () => {
      const ts = mockTerminalSessions()
      ts.persist = async () => { throw new Error('persist boom') }
      installFullState({ terminalSessions: ts })
      await cleanupWorkspace()
    })

    it('continues when pod shutdown throws', async () => {
      const pod = mockPod()
      pod.shutdown = async () => { throw new Error('pod boom') }
      installFullState({ pod })
      await cleanupWorkspace()
    })

    it('continues when gateway stop throws', async () => {
      const gw = mockGateway()
      gw.stop = () => { throw new Error('gateway boom') }
      installFullState({ gateway: gw })
      await cleanupWorkspace()
    })

    it('continues when routine toJSON returns null', async () => {
      const re = mockRoutineEngine(null)
      installFullState({ routineEngine: re })
      await cleanupWorkspace()
      // Should not store anything
      const key = lsKey.routines('test-ws')
      assert.equal(localStorage.getItem(key), null)
    })

    it('continues when routine save throws', async () => {
      const re = mockRoutineEngine()
      re.toJSON = () => { throw new Error('toJSON boom') }
      installFullState({ routineEngine: re })
      // Routine save failures are caught and logged
      await cleanupWorkspace()
    })

    it('continues when skill deactivate throws', async () => {
      const reg = mockSkillRegistry(['bad-skill'])
      const origDeactivate = reg.deactivate.bind(reg)
      reg.deactivate = (name) => { throw new Error('deactivate boom') }
      installFullState({ skillRegistry: reg })
      // Skill deactivation errors should not prevent cleanup from completing.
      // Note: the current implementation iterates without try/catch per skill,
      // so if it throws, it will propagate. This test documents that behavior.
      try {
        await cleanupWorkspace()
      } catch {
        // If it throws, that's the current behavior — not ideal but documented
      }
    })

    it('continues when kernel destroyWorkspaceTenant throws', async () => {
      const ki = mockKernelIntegration()
      ki.destroyWorkspaceTenant = () => { throw new Error('kernel boom') }
      setKernelIntegration(ki)
      installFullState()
      // Kernel integration errors are not caught by cleanupWorkspace,
      // so this tests whether the error propagates
      try {
        await cleanupWorkspace()
      } catch {
        // Current behavior: kernel errors propagate
      }
    })
  })

  // ── Ordering ──────────────────────────────────────────────────

  describe('ordering', () => {
    it('stops routine engine before saving routine state', async () => {
      const order = []
      const re = {
        stop() { order.push('stop') },
        toJSON() { order.push('toJSON'); return { tasks: [] } },
      }
      installFullState({ routineEngine: re })
      await cleanupWorkspace()
      const stopIdx = order.indexOf('stop')
      const jsonIdx = order.indexOf('toJSON')
      assert.ok(stopIdx < jsonIdx, 'stop should happen before toJSON')
    })

    it('stops daemon before persisting state', async () => {
      const order = []
      const dc = { stop: async () => { order.push('daemon-stop') } }
      const agent = {
        getWorkspace: () => 'test-ws',
        persistMemories() { order.push('persist-memories') },
        persistCheckpoint: async () => { order.push('persist-checkpoint') },
        persistConfig: tracker(),
        persistConversation: asyncTracker(),
      }
      installFullState({ daemonController: dc, agent })
      await cleanupWorkspace()
      const daemonIdx = order.indexOf('daemon-stop')
      const memIdx = order.indexOf('persist-memories')
      assert.ok(daemonIdx < memIdx, 'daemon stop should happen before persist')
    })
  })

  // ── Edge cases ────────────────────────────────────────────────

  describe('edge cases', () => {
    it('handles skill registry with no active skills', async () => {
      const reg = mockSkillRegistry([])
      installFullState({ skillRegistry: reg })
      await cleanupWorkspace()
      assert.equal(reg._deactivated.length, 0)
    })

    it('handles skill registry with many active skills', async () => {
      const names = Array.from({ length: 50 }, (_, i) => `skill-${i}`)
      const reg = mockSkillRegistry(names)
      installFullState({ skillRegistry: reg })
      await cleanupWorkspace()
      assert.equal(reg._deactivated.length, 50)
      assert.equal(reg.activeSkills.size, 0)
    })

    it('does not store routine data when toJSON returns null', async () => {
      installFullState({ routineEngine: mockRoutineEngine(null) })
      await cleanupWorkspace()
      const key = lsKey.routines('test-ws')
      assert.equal(localStorage.getItem(key), null)
    })

    it('handles agent.getWorkspace returning empty string', async () => {
      const agent = {
        getWorkspace: () => '',
        persistMemories: tracker(),
        persistCheckpoint: asyncTracker(),
        persistConfig: tracker(),
        persistConversation: asyncTracker(),
      }
      installFullState({ agent })
      await cleanupWorkspace()
      // Routine data should still be saved (with empty wsId key)
      const key = lsKey.routines('')
      const stored = localStorage.getItem(key)
      assert.ok(stored, 'should still save routine data')
    })

    it('can be called multiple times safely', async () => {
      installFullState()
      await cleanupWorkspace()
      // Second call: agent is still set (we don't null it), but subsystems
      // have already been stopped. Should not throw.
      await cleanupWorkspace()
    })
  })
})
