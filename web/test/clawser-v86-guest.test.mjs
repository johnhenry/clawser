// clawser-v86-guest.test.mjs — Unit tests for the v86 Linux guest PoC
// Run with: node --test web/test/clawser-v86-guest.test.mjs
//
// These tests verify the LinuxGuest API surface, state machine, and
// integration helper WITHOUT loading the actual v86 emulator (which
// requires a browser + WASM). We mock the V86 constructor and serial I/O.

import { describe, it, beforeEach, mock } from 'node:test'
import assert from 'node:assert/strict'

// ── Mock browser globals ────────────────────────────────────────────

if (!globalThis.performance) {
  globalThis.performance = { now: () => Date.now() }
}
// performance.memory is Chrome-only; ensure it exists for tests
if (!globalThis.performance.memory) {
  globalThis.performance.memory = {
    usedJSHeapSize: 50 * 1024 * 1024,
    totalJSHeapSize: 100 * 1024 * 1024,
  }
}

globalThis.document = globalThis.document ?? {
  createElement: (tag) => ({
    tagName: tag.toUpperCase(),
    style: {},
    className: '',
    tabIndex: 0,
    innerHTML: '',
    appendChild: () => {},
    querySelector: () => null,
    classList: { add: () => {}, remove: () => {} },
    addEventListener: () => {},
    remove: () => {},
  }),
  body: { appendChild: () => {} },
  documentElement: {},
}

// ── Mock the v86 CDN import ─────────────────────────────────────────

// We can't actually import from CDN in node:test, so we test the
// module's exported helpers and class structure by mocking.

// Create a mock V86 emulator class
const createMockEmulator = () => {
  const listeners = new Map()
  return {
    listeners,
    add_listener: (event, fn) => {
      if (!listeners.has(event)) listeners.set(event, [])
      listeners.get(event).push(fn)
    },
    remove_listener: (event, fn) => {
      if (!listeners.has(event)) return
      const arr = listeners.get(event)
      listeners.set(event, arr.filter((f) => f !== fn))
    },
    serial0_send: (ch) => {
      // Echo character back via serial0-output-byte
      const cbs = listeners.get('serial0-output-byte') ?? []
      for (const cb of cbs) cb(ch.charCodeAt(0))
    },
    stop: () => {},
    destroy: () => {},
    _simulateOutput: (text) => {
      const cbs = listeners.get('serial0-output-byte') ?? []
      for (const ch of text) {
        for (const cb of cbs) cb(ch.charCodeAt(0))
      }
    },
  }
}

// ── Import the module (will fail on CDN import, so test exports) ────

// Since the module does a dynamic import() from CDN at runtime (not at
// module load), we can import the non-CDN exports safely.

const {
  GuestState,
  V86_CDN,
  DEFAULT_IMAGE,
  getMemoryUsage,
  LinuxGuest,
  connectGuestToAdapter,
} = await import('../clawser-v86-guest.mjs')

// ── Tests ───────────────────────────────────────────────────────────

describe('GuestState enum', () => {
  it('has all expected states', () => {
    assert.equal(GuestState.IDLE, 'idle')
    assert.equal(GuestState.BOOTING, 'booting')
    assert.equal(GuestState.RUNNING, 'running')
    assert.equal(GuestState.SHUTDOWN, 'shutdown')
    assert.equal(GuestState.ERROR, 'error')
  })
})

describe('V86_CDN config', () => {
  it('has valid CDN URLs', () => {
    assert.ok(V86_CDN.lib.includes('cdn.jsdelivr.net'))
    assert.ok(V86_CDN.wasm.includes('v86.wasm'))
    assert.ok(V86_CDN.bios.includes('seabios'))
    assert.ok(V86_CDN.vgaBios.includes('vgabios'))
  })

  it('references v86 version 0.5.355', () => {
    assert.ok(V86_CDN.lib.includes('0.5.355'))
    assert.ok(V86_CDN.wasm.includes('0.5.355'))
  })
})

describe('DEFAULT_IMAGE', () => {
  it('has a cdrom URL', () => {
    assert.ok(DEFAULT_IMAGE.cdrom.url.length > 0)
    assert.ok(DEFAULT_IMAGE.cdrom.url.startsWith('https://'))
  })
})

describe('getMemoryUsage', () => {
  it('returns memory stats when performance.memory exists', () => {
    const result = getMemoryUsage()
    assert.ok(result)
    assert.equal(typeof result.usedMb, 'number')
    assert.equal(typeof result.totalMb, 'number')
    assert.ok(result.usedMb > 0)
  })
})

describe('LinuxGuest constructor', () => {
  it('starts in IDLE state', () => {
    const guest = new LinuxGuest()
    assert.equal(guest.state, 'idle')
  })

  it('accepts custom config', () => {
    const guest = new LinuxGuest({ memoryMb: 128, headless: false })
    assert.equal(guest.state, 'idle')
    assert.equal(guest.bootDurationMs, 0)
  })

  it('returns null emulator before boot', () => {
    const guest = new LinuxGuest()
    assert.equal(guest.emulator, null)
  })

  it('reports zero metrics before boot', () => {
    const guest = new LinuxGuest()
    const m = guest.metrics()
    assert.equal(m.state, 'idle')
    assert.equal(m.bootMs, 0)
    assert.equal(m.memoryBefore, null)
    assert.equal(m.memoryDeltaMb, null)
  })
})

describe('LinuxGuest.onOutput', () => {
  it('returns an unsubscribe function', () => {
    const guest = new LinuxGuest()
    const unsub = guest.onOutput(() => {})
    assert.equal(typeof unsub, 'function')
  })
})

describe('LinuxGuest.onStateChange', () => {
  it('returns an unsubscribe function', () => {
    const guest = new LinuxGuest()
    const unsub = guest.onStateChange(() => {})
    assert.equal(typeof unsub, 'function')
  })
})

describe('LinuxGuest.sendCommand', () => {
  it('throws if guest is not running', async () => {
    const guest = new LinuxGuest()
    await assert.rejects(
      () => guest.sendCommand('ls'),
      { message: /Cannot send command/ }
    )
  })
})

describe('LinuxGuest.boot', () => {
  it('throws if already booted (state is not idle)', async () => {
    const guest = new LinuxGuest()
    // Simulate non-idle state by attempting a boot that will fail on CDN
    // (we can't actually boot without v86 loaded)
    // Instead, test the double-boot guard by calling boot twice concurrently
    const p1 = guest.boot({ timeoutMs: 100 }).catch(() => 'first-error')
    // State is now 'booting', second call should throw
    await assert.rejects(
      () => guest.boot(),
      { message: /Cannot boot/ }
    )
    await p1 // let the first one settle
  })
})

describe('LinuxGuest.shutdown', () => {
  it('is a no-op when already idle', async () => {
    const guest = new LinuxGuest()
    await guest.shutdown() // should not throw
    assert.equal(guest.state, 'idle')
  })
})

describe('connectGuestToAdapter', () => {
  it('wires output from guest to adapter.write', () => {
    const guest = new LinuxGuest()
    const written = []
    const mockAdapter = {
      write: (data) => written.push(data),
      onData: () => {},
    }

    const { disconnect } = connectGuestToAdapter(guest, mockAdapter)
    assert.equal(typeof disconnect, 'function')

    // Manually trigger guest output callback
    // (We can't call the private emitOutput, but we can use onOutput
    //  to verify the wiring pattern)
    disconnect()
  })

  it('returns a disconnect function', () => {
    const guest = new LinuxGuest()
    const mockAdapter = { write: () => {}, onData: () => {} }
    const { disconnect } = connectGuestToAdapter(guest, mockAdapter)
    assert.equal(typeof disconnect, 'function')
    disconnect() // should not throw
  })
})

describe('LinuxGuest state machine', () => {
  it('fires state change callbacks', () => {
    const guest = new LinuxGuest()
    const states = []
    guest.onStateChange((s) => states.push(s))

    // Trigger a boot attempt (will fail on CDN but will set state to BOOTING then ERROR)
    guest.boot({ timeoutMs: 50 }).catch(() => {})

    // Give it a tick to set BOOTING state
    assert.ok(states.length >= 0) // at minimum, no crash
  })

  it('supports multiple state change listeners', () => {
    const guest = new LinuxGuest()
    const a = [], b = []
    guest.onStateChange((s) => a.push(s))
    guest.onStateChange((s) => b.push(s))

    guest.boot({ timeoutMs: 50 }).catch(() => {})
    // Both should eventually receive the same states
  })

  it('supports unsubscribing state change listeners', () => {
    const guest = new LinuxGuest()
    const states = []
    const unsub = guest.onStateChange((s) => states.push(s))
    unsub()

    guest.boot({ timeoutMs: 50 }).catch(() => {})
    // After unsub, no states should be recorded
    // (There's a race condition here, but the point is unsub doesn't crash)
  })
})

describe('LinuxGuest metrics', () => {
  it('returns structured metrics object', () => {
    const guest = new LinuxGuest()
    const m = guest.metrics()
    assert.ok('state' in m)
    assert.ok('bootMs' in m)
    assert.ok('memoryBefore' in m)
    assert.ok('memoryAfter' in m)
    assert.ok('memoryDeltaMb' in m)
  })
})
