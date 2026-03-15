/**
 * packages-netway — Module loading, export verification, and basic API tests.
 *
 * Run: node --import ./web/test/_setup-globals.mjs --test web/test/packages-netway.test.mjs
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

import {
  // Constants + errors
  DEFAULTS, GATEWAY_ERROR, CAPABILITY,
  NetwayError, ConnectionRefusedError, PolicyDeniedError,
  AddressInUseError, QueueFullError, UnknownSchemeError,
  SocketClosedError, OperationTimeoutError,
  // Core
  StreamSocket, DatagramSocket, Listener,
  // Policy + routing
  PolicyEngine, Router, parseAddress, OperationQueue,
  // Backends
  Backend, LoopbackBackend, GatewayBackend,
  ServiceBackend, ChaosBackendWrapper, FsServiceBackend,
  // Network
  VirtualNetwork, ScopedNetwork,
} from '../packages/netway/src/index.mjs'

// ── 1. Exports exist ───────────────────────────────────────────────────

describe('netway — exports', () => {
  it('exports all constants', () => {
    assert.ok(DEFAULTS)
    assert.ok(GATEWAY_ERROR)
    assert.ok(CAPABILITY)
    assert.equal(typeof DEFAULTS.EPHEMERAL_PORT_START, 'number')
    assert.equal(CAPABILITY.ALL, '*')
    assert.equal(GATEWAY_ERROR.CONNECTION_REFUSED, 1)
  })

  it('exports all error classes', () => {
    for (const Cls of [
      NetwayError, ConnectionRefusedError, PolicyDeniedError,
      AddressInUseError, QueueFullError, UnknownSchemeError,
      SocketClosedError, OperationTimeoutError,
    ]) {
      assert.equal(typeof Cls, 'function')
    }
  })

  it('exports core classes and functions', () => {
    assert.equal(typeof StreamSocket, 'function')
    assert.equal(typeof PolicyEngine, 'function')
    assert.equal(typeof Router, 'function')
    assert.equal(typeof parseAddress, 'function')
    assert.equal(typeof OperationQueue, 'function')
    assert.equal(typeof VirtualNetwork, 'function')
  })
})

// ── 2. Error hierarchy ─────────────────────────────────────────────────

describe('netway — errors', () => {
  it('NetwayError carries code', () => {
    const err = new NetwayError('test', 'ETEST')
    assert.ok(err instanceof Error)
    assert.equal(err.code, 'ETEST')
  })

  it('ConnectionRefusedError carries address', () => {
    const err = new ConnectionRefusedError('mem://localhost:80')
    assert.equal(err.code, 'ECONNREFUSED')
    assert.equal(err.address, 'mem://localhost:80')
  })

  it('PolicyDeniedError carries capability and address', () => {
    const err = new PolicyDeniedError('tcp:connect', 'tcp://example.com:443')
    assert.equal(err.code, 'EPOLICY')
    assert.equal(err.capability, 'tcp:connect')
  })
})

// ── 3. parseAddress ────────────────────────────────────────────────────

describe('netway — parseAddress', () => {
  it('parses scheme://host:port', () => {
    const r = parseAddress('tcp://example.com:443')
    assert.equal(r.scheme, 'tcp')
    assert.equal(r.host, 'example.com')
    assert.equal(r.port, 443)
  })

  it('defaults port to 0 when omitted', () => {
    const r = parseAddress('mem://localhost')
    assert.equal(r.port, 0)
  })

  it('throws on missing scheme', () => {
    assert.throws(() => parseAddress('no-scheme'), /no scheme/)
  })
})

// ── 4. PolicyEngine ────────────────────────────────────────────────────

describe('netway — PolicyEngine', () => {
  it('creates scopes and checks capabilities', async () => {
    const engine = new PolicyEngine()
    const scopeId = engine.createScope({ capabilities: [CAPABILITY.LOOPBACK] })
    assert.equal(typeof scopeId, 'string')

    assert.equal(await engine.check(scopeId, { capability: 'loopback' }), 'allow')
    assert.equal(await engine.check(scopeId, { capability: 'tcp:connect' }), 'deny')
  })

  it('wildcard scope allows everything', async () => {
    const engine = new PolicyEngine()
    const scopeId = engine.createScope({ capabilities: [CAPABILITY.ALL] })
    assert.equal(await engine.check(scopeId, { capability: 'tcp:connect' }), 'allow')
  })

  it('removed scope returns deny', async () => {
    const engine = new PolicyEngine()
    const scopeId = engine.createScope({ capabilities: [CAPABILITY.ALL] })
    engine.removeScope(scopeId)
    assert.equal(await engine.check(scopeId, { capability: 'loopback' }), 'deny')
  })
})

// ── 5. StreamSocket pair ───────────────────────────────────────────────

describe('netway — StreamSocket', () => {
  it('createPair enables bidirectional communication', async () => {
    const [a, b] = StreamSocket.createPair()
    assert.equal(a.closed, false)

    const data = new TextEncoder().encode('hello')
    await a.write(data)
    const received = await b.read()
    assert.deepEqual(received, data)

    await a.close()
    assert.equal(a.closed, true)
    // After close, read returns null
    const eof = await a.read()
    assert.equal(eof, null)
  })

  it('write after close throws SocketClosedError', async () => {
    const [a] = StreamSocket.createPair()
    await a.close()
    await assert.rejects(() => a.write(new Uint8Array([1])), SocketClosedError)
  })
})

// ── 6. OperationQueue ──────────────────────────────────────────────────

describe('netway — OperationQueue', () => {
  it('enqueue/drain round-trips operations', async () => {
    const queue = new OperationQueue({ maxSize: 4, drainTimeoutMs: 1000 })
    assert.equal(queue.size, 0)

    const p1 = queue.enqueue('op1')
    const p2 = queue.enqueue('op2')
    assert.equal(queue.size, 2)

    await queue.drain(async (op) => op.toUpperCase())
    assert.equal(await p1, 'OP1')
    assert.equal(await p2, 'OP2')
    assert.equal(queue.size, 0)
  })

  it('throws QueueFullError when capacity exceeded', () => {
    const queue = new OperationQueue({ maxSize: 1 })
    queue.enqueue('a')
    assert.throws(() => queue.enqueue('b'), QueueFullError)
  })
})

// ── 7. Router ──────────────────────────────────────────────────────────

describe('netway — Router', () => {
  it('registers and resolves routes', () => {
    const router = new Router()
    const fakeBackend = { name: 'test' }
    router.addRoute('test', fakeBackend)

    assert.ok(router.hasScheme('test'))
    assert.ok(!router.hasScheme('missing'))
    assert.deepEqual(router.schemes, ['test'])

    const { backend, parsed } = router.resolve('test://myhost:1234')
    assert.equal(backend, fakeBackend)
    assert.equal(parsed.host, 'myhost')
    assert.equal(parsed.port, 1234)
  })

  it('throws UnknownSchemeError for unregistered scheme', () => {
    const router = new Router()
    assert.throws(() => router.resolve('ftp://host:21'), UnknownSchemeError)
  })
})
