// clawser-pod-tracing.test.mjs — distributed tracing MVP (mesh Phase 11
// item 17/18): ClawserPod.sendMessage/onMessage carry a traceId inside our
// own message envelope (not the browsermesh-primitives wire schema) and
// report mesh.send/mesh.recv events through an injectable sink, wired to
// KernelIntegration.traceMeshEvent() in production (see
// clawser-workspace-init-mesh.js).
//
// Run with: node --import ./web/test/_setup-globals.mjs --test web/test/clawser-pod-tracing.test.mjs

import { describe, it, after } from 'node:test'
import assert from 'node:assert/strict'
import { ClawserPod } from '../clawser-pod.js'

class StubBroadcastChannel {
  constructor(name) { this.name = name; this.onmessage = null }
  postMessage() {}
  close() {}
}
if (!globalThis.BroadcastChannel) globalThis.BroadcastChannel = StubBroadcastChannel

describe('ClawserPod.setTraceEmit', () => {
  it('accepts a function and ignores non-function values', () => {
    const pod = new ClawserPod()
    assert.doesNotThrow(() => pod.setTraceEmit(() => {}))
    assert.doesNotThrow(() => pod.setTraceEmit(null))
    assert.doesNotThrow(() => pod.setTraceEmit('not a function'))
    assert.doesNotThrow(() => pod.setTraceEmit(undefined))
  })
})

describe('ClawserPod.sendMessage — trace emission', () => {
  let pod

  after(async () => {
    if (pod && typeof pod.shutdown === 'function') {
      try { await pod.shutdown() } catch { /* best-effort */ }
    }
  })

  it('emits a mesh.send event with a generated traceId before rejecting on no active session', async () => {
    pod = new ClawserPod()
    await pod.initMesh({})

    const events = []
    pod.setTraceEmit((event) => events.push(event))

    await assert.rejects(
      () => pod.sendMessage('nonexistent-peer', { type: 'ping' }),
      /no active session/,
    )

    assert.equal(events.length, 1)
    assert.equal(events[0].type, 'mesh.send')
    assert.equal(events[0].peerId, 'nonexistent-peer')
    assert.equal(events[0].messageType, 'ping')
    assert.equal(typeof events[0].traceId, 'string')
    assert.match(events[0].traceId, /^trace_/)
  })

  it('preserves an existing envelope.traceId instead of generating a new one', async () => {
    const otherPod = new ClawserPod()
    try {
      await otherPod.initMesh({})
      const events = []
      otherPod.setTraceEmit((event) => events.push(event))

      await assert.rejects(
        () => otherPod.sendMessage('nonexistent-peer', { type: 'sync', traceId: 'trace_preexisting' }),
      )

      assert.equal(events.length, 1)
      assert.equal(events[0].traceId, 'trace_preexisting')
    } finally {
      try { await otherPod.shutdown() } catch { /* best-effort */ }
    }
  })

  it('generates a different traceId for each independently-sent message', async () => {
    const p = new ClawserPod()
    try {
      await p.initMesh({})
      const events = []
      p.setTraceEmit((event) => events.push(event))

      await assert.rejects(() => p.sendMessage('peer-a', { type: 'ping' }))
      await assert.rejects(() => p.sendMessage('peer-b', { type: 'ping' }))

      assert.equal(events.length, 2)
      assert.notEqual(events[0].traceId, events[1].traceId)
    } finally {
      try { await p.shutdown() } catch { /* best-effort */ }
    }
  })

  it('does not throw when no trace sink is set', async () => {
    const p = new ClawserPod()
    try {
      await p.initMesh({})
      await assert.rejects(() => p.sendMessage('nonexistent-peer', { type: 'ping' }))
    } finally {
      try { await p.shutdown() } catch { /* best-effort */ }
    }
  })
})

// ── Receive-side: replicate pod.onMessage's dispatch contract ──────────
//
// ClawserPod hides #peerNode behind real private fields, and the real
// PeerNode only fans out inbound data through a live transport session
// (see clawser-peer-node.js — the same constraint documented in
// clawser-pod-onmessage.test.mjs). We verify the receive-side tracing
// logic by replicating the exact contract onMessage()'s callback body
// implements, matching the existing test convention for this file.

describe('ClawserPod.onMessage — trace emission (dispatch contract)', () => {
  function dispatch(traceEmit, envelopeJson, pubKey, handler) {
    let envelope
    try { envelope = typeof envelopeJson === 'string' ? JSON.parse(envelopeJson) : envelopeJson }
    catch { return }
    if (!envelope || typeof envelope !== 'object') return
    if (envelope.traceId) {
      traceEmit?.({ type: 'mesh.recv', traceId: envelope.traceId, peerId: pubKey, messageType: envelope.type })
    }
    handler(envelope, pubKey)
  }

  it('emits mesh.recv when the envelope carries a traceId', () => {
    const events = []
    const seen = []
    dispatch((e) => events.push(e), '{"type":"sync","traceId":"trace_123"}', 'peerA', (env, peer) => seen.push({ env, peer }))

    assert.equal(events.length, 1)
    assert.equal(events[0].type, 'mesh.recv')
    assert.equal(events[0].traceId, 'trace_123')
    assert.equal(events[0].peerId, 'peerA')
    assert.equal(events[0].messageType, 'sync')
    assert.equal(seen.length, 1, 'handler still runs regardless of tracing')
  })

  it('does not emit when the envelope has no traceId', () => {
    const events = []
    dispatch((e) => events.push(e), '{"type":"deploy"}', 'peerB', () => {})
    assert.equal(events.length, 0)
  })

  it('does not throw when no trace sink is set', () => {
    assert.doesNotThrow(() => {
      dispatch(null, '{"type":"sync","traceId":"trace_1"}', 'peerC', () => {})
    })
  })
})
