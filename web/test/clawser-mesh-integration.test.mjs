/**
 * Mesh integration test — multi-pod discovery, stream, and file transfer.
 *
 * These tests verify subsystem interop without requiring a real network.
 *
 * Run: node --import ./web/test/_setup-globals.mjs --test web/test/clawser-mesh-integration.test.mjs
 */
import { describe, it, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { ClawserPod } from '../clawser-pod.js'
import { StreamMultiplexer } from '../clawser-mesh-streams.js'
import { MeshFileTransfer, FileDescriptor } from '../clawser-mesh-files.js'
import { MeshSyncEngine } from '../clawser-mesh-sync.js'

// Stub BroadcastChannel for Node
class StubBroadcastChannel {
  constructor(name) { this.name = name; this.onmessage = null }
  postMessage() {}
  close() {}
}

function makeGlobal() {
  return {
    window: undefined,
    document: undefined,
    BroadcastChannel: StubBroadcastChannel,
    addEventListener: () => {},
    removeEventListener: () => {},
  }
}

describe('Multi-pod subsystem interop', () => {
  const pods = []

  afterEach(async () => {
    for (const p of pods) {
      if (p.state !== 'shutdown' && p.state !== 'idle') {
        await p.shutdown({ silent: true })
      }
    }
    pods.length = 0
  })

  it('two pods get distinct podIds', async () => {
    const p1 = new ClawserPod()
    const p2 = new ClawserPod()
    pods.push(p1, p2)

    await p1.boot({ globalThis: makeGlobal(), discoveryTimeout: 50, handshakeTimeout: 50 })
    await p2.boot({ globalThis: makeGlobal(), discoveryTimeout: 50, handshakeTimeout: 50 })

    await p1.initMesh()
    await p2.initMesh()

    assert.notEqual(p1.podId, p2.podId, 'Pods should have distinct identities')
  })
})

describe('StreamMultiplexer operations', () => {
  it('opens and closes streams', () => {
    const mux = new StreamMultiplexer()
    const sent = []
    mux.onSend((msg) => sent.push(msg))

    const s = mux.open('test/echo')
    assert.ok(s.id)
    assert.equal(mux.activeCount, 1)

    mux.closeAll()
    assert.equal(mux.activeCount, 0)
  })

  it('dispatches inbound stream open and data', () => {
    const mux = new StreamMultiplexer()
    const streams = []
    mux.onSend(() => {})
    mux.onStream((stream) => streams.push(stream))

    // Simulate inbound stream open message
    const streamId = new Uint8Array([1, 2, 3, 4])
    mux.dispatch({ t: 0xaf, p: { streamId, method: 'test/in', flags: 0x01 } })
    assert.equal(streams.length, 1)

    mux.closeAll()
  })
})

describe('MeshFileTransfer offer flow', () => {
  it('creates an offer and tracks it', () => {
    const ft = new MeshFileTransfer()

    const files = [new FileDescriptor({ name: 'test.txt', size: 100 })]
    const offer = ft.createOffer('recipient-pod', files)

    assert.ok(offer.transferId)
    assert.equal(offer.sender, 'local') // defaults to 'local'
    assert.equal(offer.recipient, 'recipient-pod')
    assert.equal(offer.files.length, 1)
    assert.equal(offer.files[0].name, 'test.txt')

    const retrieved = ft.getOffer(offer.transferId)
    assert.ok(retrieved)
  })
})

describe('MeshSyncEngine CRDT interop', () => {
  it('two engines can merge LWW-Register state', () => {
    const engine1 = new MeshSyncEngine({ nodeId: 'node-1' })
    const engine2 = new MeshSyncEngine({ nodeId: 'node-2' })

    // Create doc on engine1
    engine1.create('config', 'lww-register')
    engine1.update('config', (crdt) => crdt.set('dark-mode', Date.now(), 'node-1'))

    // Prepare sync payload and merge into engine2
    const payload = engine1.prepareSyncPayload('config')

    // engine2 needs its own doc first
    engine2.create('config', 'lww-register')
    engine2.merge('config', payload)

    const state1 = engine1.getState('config')
    const state2 = engine2.getState('config')

    assert.equal(state1, state2, 'Synced state should match')

    engine1.destroy()
    engine2.destroy()
  })
})
