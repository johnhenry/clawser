/**
 * packages-pod — Module loading, export verification, and basic API tests.
 *
 * Run: node --import ./web/test/_setup-globals.mjs --test web/test/packages-pod.test.mjs
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

import {
  Pod,
  detectPodKind,
  detectCapabilities,
  POD_HELLO, POD_HELLO_ACK, POD_GOODBYE, POD_MESSAGE,
  POD_RPC_REQUEST, POD_RPC_RESPONSE,
  createHello, createHelloAck, createGoodbye, createMessage,
  createRpcRequest, createRpcResponse,
  InjectedPod,
  installPodRuntime, createRuntime, createClient, createServer,
} from '../packages/pod/src/index.mjs'

// ── 1. Exports exist ───────────────────────────────────────────────────

describe('pod — exports', () => {
  it('exports Pod class', () => {
    assert.equal(typeof Pod, 'function')
  })

  it('exports detection functions', () => {
    assert.equal(typeof detectPodKind, 'function')
    assert.equal(typeof detectCapabilities, 'function')
  })

  it('exports message type constants', () => {
    assert.equal(POD_HELLO, 'pod:hello')
    assert.equal(POD_HELLO_ACK, 'pod:hello-ack')
    assert.equal(POD_GOODBYE, 'pod:goodbye')
    assert.equal(POD_MESSAGE, 'pod:message')
    assert.equal(POD_RPC_REQUEST, 'pod:rpc-request')
    assert.equal(POD_RPC_RESPONSE, 'pod:rpc-response')
  })

  it('exports message factory functions', () => {
    for (const fn of [createHello, createHelloAck, createGoodbye, createMessage, createRpcRequest, createRpcResponse]) {
      assert.equal(typeof fn, 'function')
    }
  })

  it('exports InjectedPod and runtime functions', () => {
    assert.equal(typeof InjectedPod, 'function')
    assert.equal(typeof installPodRuntime, 'function')
  })
})

// ── 2. Message factories ───────────────────────────────────────────────

describe('pod — message factories', () => {
  it('createHello returns correct shape', () => {
    const msg = createHello({ podId: 'pod-1', kind: 'window', capabilities: { foo: true } })
    assert.equal(msg.type, POD_HELLO)
    assert.equal(msg.podId, 'pod-1')
    assert.equal(msg.kind, 'window')
    assert.equal(typeof msg.ts, 'number')
  })

  it('createHelloAck returns correct shape', () => {
    const msg = createHelloAck({ podId: 'pod-2', kind: 'iframe', targetPodId: 'pod-1' })
    assert.equal(msg.type, POD_HELLO_ACK)
    assert.equal(msg.targetPodId, 'pod-1')
  })

  it('createMessage includes from/to/payload', () => {
    const msg = createMessage({ from: 'a', to: 'b', payload: { x: 1 } })
    assert.equal(msg.type, POD_MESSAGE)
    assert.equal(msg.from, 'a')
    assert.equal(msg.to, 'b')
    assert.deepEqual(msg.payload, { x: 1 })
  })

  it('createRpcRequest/Response round-trip ids', () => {
    const req = createRpcRequest({ from: 'a', to: 'b', method: 'echo', params: [1], requestId: 'r1' })
    assert.equal(req.type, POD_RPC_REQUEST)
    assert.equal(req.method, 'echo')
    assert.equal(req.requestId, 'r1')

    const res = createRpcResponse({ from: 'b', to: 'a', requestId: 'r1', result: 42 })
    assert.equal(res.type, POD_RPC_RESPONSE)
    assert.equal(res.requestId, 'r1')
    assert.equal(res.result, 42)
  })
})

// ── 3. detectPodKind ───────────────────────────────────────────────────

describe('pod — detectPodKind', () => {
  it('returns "server" for bare global', () => {
    // No window or document
    const kind = detectPodKind({})
    assert.equal(kind, 'server')
  })

  it('returns "window" for top-level window context', () => {
    const g = {
      window: null,
      document: {},
    }
    // self-referencing window where parent === self (top-level)
    g.window = g
    g.parent = g
    const kind = detectPodKind(g)
    assert.equal(kind, 'window')
  })

  it('returns "iframe" when parent differs from self', () => {
    const parent = {}
    const g = { window: {}, document: {} }
    g.window = g
    g.window.parent = parent
    const kind = detectPodKind(g)
    assert.equal(kind, 'iframe')
  })
})

// ── 4. detectCapabilities ──────────────────────────────────────────────

describe('pod — detectCapabilities', () => {
  it('returns structured capabilities object', () => {
    const caps = detectCapabilities({})
    assert.ok(caps.messaging)
    assert.ok(caps.network)
    assert.ok(caps.storage)
    assert.ok(caps.compute)
    assert.equal(caps.messaging.postMessage, false)
    assert.equal(caps.network.fetch, false)
  })

  it('detects fetch when present', () => {
    const caps = detectCapabilities({ fetch: () => {} })
    assert.equal(caps.network.fetch, true)
  })
})

// ── 5. Pod class basics ────────────────────────────────────────────────

describe('pod — Pod class', () => {
  it('constructs in idle state with no identity', () => {
    const pod = new Pod()
    assert.equal(pod.state, 'idle')
    assert.equal(pod.podId, null)
    assert.equal(pod.role, 'autonomous')
    assert.equal(pod.kind, null)
    assert.equal(pod.peers.size, 0)
  })

  it('supports event listener registration', () => {
    const pod = new Pod()
    const events = []
    const cb = (d) => events.push(d)
    pod.on('test', cb)
    pod.off('test', cb)
    // No crash
  })

  it('toJSON returns serializable snapshot', () => {
    const pod = new Pod()
    const json = pod.toJSON()
    assert.equal(json.state, 'idle')
    assert.equal(json.role, 'autonomous')
    assert.equal(json.peerCount, 0)
  })

  it('shutdown on idle pod is a no-op', async () => {
    const pod = new Pod()
    await pod.shutdown()
    assert.equal(pod.state, 'idle')
  })
})
