// Run with: node --import ./web/test/_setup-globals.mjs --test web/test/clawser-mesh-webrtc.test.mjs
import { describe, it, beforeEach } from 'node:test'
import assert from 'node:assert/strict'

// ---------------------------------------------------------------------------
// Mock RTCPeerConnection & RTCDataChannel before importing the module
// ---------------------------------------------------------------------------

class MockRTCDataChannel {
  readyState = 'open'
  onopen = null
  onmessage = null
  onclose = null
  onerror = null
  _lastSent = null

  send(data) {
    this._lastSent = data
  }

  close() {
    this.readyState = 'closed'
    if (this.onclose) this.onclose()
  }
}

class MockRTCPeerConnection {
  #localDesc = null
  #remoteDesc = null
  onicecandidate = null
  ondatachannel = null
  onconnectionstatechange = null
  connectionState = 'new'
  _lastCandidate = null

  constructor(config) {
    this.config = config
  }

  createDataChannel(label, opts) {
    const dc = new MockRTCDataChannel()
    dc.label = label
    return dc
  }

  async createOffer() {
    return { type: 'offer', sdp: 'mock-offer-sdp' }
  }

  async createAnswer() {
    return { type: 'answer', sdp: 'mock-answer-sdp' }
  }

  async setLocalDescription(desc) {
    this.#localDesc = desc
  }

  async setRemoteDescription(desc) {
    this.#remoteDesc = desc
  }

  addIceCandidate(c) {
    this._lastCandidate = c
  }

  close() {}
}

globalThis.RTCPeerConnection = MockRTCPeerConnection

// ---------------------------------------------------------------------------
// Import module under test (after globals are set up)
// ---------------------------------------------------------------------------

import {
  supportsWebRTC,
  WebRTCPeerConnection,
  WebRTCMeshManager,
  WebRTCTransportAdapter,
  WebRTCAdapterFactory,
} from '../clawser-mesh-webrtc.js'

// ── supportsWebRTC ─────────────────────────────────────────────────────

describe('supportsWebRTC', () => {
  it('returns true when RTCPeerConnection is defined', () => {
    assert.equal(supportsWebRTC(), true)
  })
})

// ── WebRTCPeerConnection ───────────────────────────────────────────────

describe('WebRTCPeerConnection', () => {
  it('constructor requires localPodId', () => {
    assert.throws(
      () => new WebRTCPeerConnection({ remotePodId: 'b' }),
      /localPodId is required/,
    )
  })

  it('constructor requires remotePodId', () => {
    assert.throws(
      () => new WebRTCPeerConnection({ localPodId: 'a' }),
      /remotePodId is required/,
    )
  })

  it('starts in new state', () => {
    const conn = new WebRTCPeerConnection({ localPodId: 'a', remotePodId: 'b' })
    assert.equal(conn.state, 'new')
  })

  it('exposes localPodId and remotePodId', () => {
    const conn = new WebRTCPeerConnection({ localPodId: 'a', remotePodId: 'b' })
    assert.equal(conn.localPodId, 'a')
    assert.equal(conn.remotePodId, 'b')
  })

  it('stats starts at zero', () => {
    const conn = new WebRTCPeerConnection({ localPodId: 'a', remotePodId: 'b' })
    assert.equal(conn.stats.bytesSent, 0)
    assert.equal(conn.stats.bytesReceived, 0)
  })

  it('stats returns a copy', () => {
    const conn = new WebRTCPeerConnection({ localPodId: 'a', remotePodId: 'b' })
    const s = conn.stats
    s.bytesSent = 9999
    assert.equal(conn.stats.bytesSent, 0)
  })

  it('createOffer returns offer with sdp', async () => {
    const conn = new WebRTCPeerConnection({ localPodId: 'a', remotePodId: 'b' })
    const offer = await conn.createOffer()
    assert.equal(offer.type, 'offer')
    assert.equal(typeof offer.sdp, 'string')
    assert.ok(offer.sdp.length > 0)
    assert.equal(conn.state, 'connecting')
  })

  it('handleOffer returns answer with sdp', async () => {
    const conn = new WebRTCPeerConnection({ localPodId: 'a', remotePodId: 'b' })
    const answer = await conn.handleOffer({ type: 'offer', sdp: 'remote-offer-sdp' })
    assert.equal(answer.type, 'answer')
    assert.equal(typeof answer.sdp, 'string')
    assert.ok(answer.sdp.length > 0)
    assert.equal(conn.state, 'connecting')
  })

  it('handleOffer rejects missing sdp', async () => {
    const conn = new WebRTCPeerConnection({ localPodId: 'a', remotePodId: 'b' })
    await assert.rejects(
      () => conn.handleOffer({}),
      /Invalid offer: missing sdp/,
    )
  })

  it('handleAnswer throws without prior createOffer', async () => {
    const conn = new WebRTCPeerConnection({ localPodId: 'a', remotePodId: 'b' })
    await assert.rejects(
      () => conn.handleAnswer({ type: 'answer', sdp: 'x' }),
      /No peer connection/,
    )
  })

  it('handleAnswer applies remote description after createOffer', async () => {
    const conn = new WebRTCPeerConnection({ localPodId: 'a', remotePodId: 'b' })
    await conn.createOffer()
    // should not throw
    await conn.handleAnswer({ type: 'answer', sdp: 'remote-answer-sdp' })
  })

  it('addIceCandidate throws without peer connection', () => {
    const conn = new WebRTCPeerConnection({ localPodId: 'a', remotePodId: 'b' })
    assert.throws(
      () => conn.addIceCandidate({ candidate: 'c' }),
      /No peer connection/,
    )
  })

  it('send throws when no data channel exists', () => {
    const conn = new WebRTCPeerConnection({ localPodId: 'a', remotePodId: 'b' })
    assert.throws(
      () => conn.send('hello'),
      /No data channel/,
    )
  })

  it('send works after createOffer sets up data channel', async () => {
    const conn = new WebRTCPeerConnection({ localPodId: 'a', remotePodId: 'b' })
    await conn.createOffer()
    // DataChannel is created with readyState 'open' (mock)
    conn.send('test-message')
    assert.equal(conn.stats.bytesSent, 'test-message'.length)
  })

  it('send JSON-serializes objects', async () => {
    const conn = new WebRTCPeerConnection({ localPodId: 'a', remotePodId: 'b' })
    await conn.createOffer()
    conn.send({ type: 'ping' })
    assert.ok(conn.stats.bytesSent > 0)
  })

  it('close sets state to closed', () => {
    const conn = new WebRTCPeerConnection({ localPodId: 'a', remotePodId: 'b' })
    conn.close()
    assert.equal(conn.state, 'closed')
  })

  it('close is idempotent', async () => {
    const conn = new WebRTCPeerConnection({ localPodId: 'a', remotePodId: 'b' })
    await conn.createOffer()
    conn.close()
    conn.close() // should not throw
    assert.equal(conn.state, 'closed')
  })

  it('close fires close callbacks', () => {
    const conn = new WebRTCPeerConnection({ localPodId: 'a', remotePodId: 'b' })
    let fired = false
    conn.onClose(() => { fired = true })
    conn.close()
    assert.equal(fired, true)
  })

  it('createOffer throws after close', async () => {
    const conn = new WebRTCPeerConnection({ localPodId: 'a', remotePodId: 'b' })
    conn.close()
    await assert.rejects(
      () => conn.createOffer(),
      /Connection is closed/,
    )
  })

  it('onIceCandidate fires when ICE candidate is gathered', async () => {
    const conn = new WebRTCPeerConnection({ localPodId: 'a', remotePodId: 'b' })
    const candidates = []
    conn.onIceCandidate((c) => candidates.push(c))
    await conn.createOffer()
    // No real ICE gathering in mock, just verifying registration works
    assert.equal(candidates.length, 0)
  })

  it('onLog callback is invoked', async () => {
    const logs = []
    const conn = new WebRTCPeerConnection({
      localPodId: 'a',
      remotePodId: 'b',
      onLog: (msg) => logs.push(msg),
    })
    await conn.createOffer()
    assert.ok(logs.length > 0)
    assert.ok(logs.some(l => l.includes('offer')))
  })
})

// ── WebRTCMeshManager ──────────────────────────────────────────────────

describe('WebRTCMeshManager', () => {
  it('constructor requires localPodId', () => {
    assert.throws(
      () => new WebRTCMeshManager({}),
      /localPodId is required/,
    )
  })

  it('exposes localPodId', () => {
    const mgr = new WebRTCMeshManager({ localPodId: 'node-1' })
    assert.equal(mgr.localPodId, 'node-1')
  })

  it('starts with zero connections', () => {
    const mgr = new WebRTCMeshManager({ localPodId: 'node-1' })
    assert.equal(mgr.connectionCount, 0)
    assert.deepEqual(mgr.listConnections(), [])
  })

  it('connectToPeer creates a new connection', async () => {
    const mgr = new WebRTCMeshManager({ localPodId: 'node-1' })
    const conn = await mgr.connectToPeer('node-2')
    assert.ok(conn instanceof WebRTCPeerConnection)
    assert.equal(conn.remotePodId, 'node-2')
    assert.equal(mgr.connectionCount, 1)
  })

  it('connectToPeer returns same connection for duplicate remotePodId', async () => {
    const mgr = new WebRTCMeshManager({ localPodId: 'node-1' })
    const conn1 = await mgr.connectToPeer('node-2')
    const conn2 = await mgr.connectToPeer('node-2')
    assert.equal(conn1, conn2)
    assert.equal(mgr.connectionCount, 1)
  })

  it('getConnection returns null for unknown pod', () => {
    const mgr = new WebRTCMeshManager({ localPodId: 'node-1' })
    assert.equal(mgr.getConnection('unknown'), null)
  })

  it('getConnection returns the connection for a known pod', async () => {
    const mgr = new WebRTCMeshManager({ localPodId: 'node-1' })
    const conn = await mgr.connectToPeer('node-2')
    assert.equal(mgr.getConnection('node-2'), conn)
  })

  it('hasConnection returns false then true', async () => {
    const mgr = new WebRTCMeshManager({ localPodId: 'node-1' })
    assert.equal(mgr.hasConnection('node-2'), false)
    await mgr.connectToPeer('node-2')
    assert.equal(mgr.hasConnection('node-2'), true)
  })

  it('listConnections returns connection info', async () => {
    const mgr = new WebRTCMeshManager({ localPodId: 'node-1' })
    await mgr.connectToPeer('node-2')
    await mgr.connectToPeer('node-3')
    const list = mgr.listConnections()
    assert.equal(list.length, 2)
    const ids = list.map(c => c.remotePodId).sort()
    assert.deepEqual(ids, ['node-2', 'node-3'])
    assert.ok(list.every(c => typeof c.state === 'string'))
  })

  it('closePeer removes a specific connection', async () => {
    const mgr = new WebRTCMeshManager({ localPodId: 'node-1' })
    await mgr.connectToPeer('node-2')
    await mgr.connectToPeer('node-3')
    assert.equal(mgr.closePeer('node-2'), true)
    assert.equal(mgr.connectionCount, 1)
    assert.equal(mgr.getConnection('node-2'), null)
  })

  it('closePeer returns false for unknown pod', () => {
    const mgr = new WebRTCMeshManager({ localPodId: 'node-1' })
    assert.equal(mgr.closePeer('unknown'), false)
  })

  it('closeAll clears all connections', async () => {
    const mgr = new WebRTCMeshManager({ localPodId: 'node-1' })
    await mgr.connectToPeer('node-2')
    await mgr.connectToPeer('node-3')
    await mgr.connectToPeer('node-4')
    mgr.closeAll()
    assert.equal(mgr.connectionCount, 0)
    assert.deepEqual(mgr.listConnections(), [])
  })
})

// ── WebRTCAdapterFactory ───────────────────────────────────────────────

describe('WebRTCAdapterFactory', () => {
  it('canCreate returns true for webrtc', () => {
    const factory = new WebRTCAdapterFactory()
    assert.equal(factory.canCreate('webrtc'), true)
  })

  it('canCreate returns false for wsh-ws', () => {
    const factory = new WebRTCAdapterFactory()
    assert.equal(factory.canCreate('wsh-ws'), false)
  })

  it('canCreate returns false for wsh-wt', () => {
    const factory = new WebRTCAdapterFactory()
    assert.equal(factory.canCreate('wsh-wt'), false)
  })

  it('create throws without opts.connection', () => {
    const factory = new WebRTCAdapterFactory()
    assert.throws(
      () => factory.create('node-2', {}),
      /requires opts\.connection/,
    )
  })

  it('create returns a WebRTCTransportAdapter', () => {
    const factory = new WebRTCAdapterFactory()
    const conn = new WebRTCPeerConnection({ localPodId: 'a', remotePodId: 'b' })
    const adapter = factory.create('b', { connection: conn })
    assert.ok(adapter instanceof WebRTCTransportAdapter)
  })
})

// ── WebRTCTransportAdapter ─────────────────────────────────────────────

describe('WebRTCTransportAdapter', () => {
  it('constructor sets type to webrtc', () => {
    const conn = new WebRTCPeerConnection({ localPodId: 'a', remotePodId: 'b' })
    const adapter = new WebRTCTransportAdapter(conn)
    assert.equal(adapter.type, 'webrtc')
  })

  it('constructor throws without connection', () => {
    assert.throws(
      () => new WebRTCTransportAdapter(null),
      /connection is required/,
    )
  })

  it('starts in disconnected state', () => {
    const conn = new WebRTCPeerConnection({ localPodId: 'a', remotePodId: 'b' })
    const adapter = new WebRTCTransportAdapter(conn)
    assert.equal(adapter.state, 'disconnected')
  })

  it('connect transitions to connected state', async () => {
    const conn = new WebRTCPeerConnection({ localPodId: 'a', remotePodId: 'b' })
    const adapter = new WebRTCTransportAdapter(conn)
    await adapter.connect()
    assert.equal(adapter.state, 'connected')
    assert.equal(adapter.connected, true)
  })

  it('peerConnection exposes the underlying connection', () => {
    const conn = new WebRTCPeerConnection({ localPodId: 'a', remotePodId: 'b' })
    const adapter = new WebRTCTransportAdapter(conn)
    assert.equal(adapter.peerConnection, conn)
  })

  it('close sets state to closed', async () => {
    const conn = new WebRTCPeerConnection({ localPodId: 'a', remotePodId: 'b' })
    const adapter = new WebRTCTransportAdapter(conn)
    await adapter.connect()
    adapter.close()
    assert.equal(adapter.state, 'closed')
  })

  it('close fires onClose callback', async () => {
    const conn = new WebRTCPeerConnection({ localPodId: 'a', remotePodId: 'b' })
    const adapter = new WebRTCTransportAdapter(conn)
    let closed = false
    adapter.onClose(() => { closed = true })
    adapter.close()
    assert.equal(closed, true)
  })

  it('toJSON returns transport metadata', () => {
    const conn = new WebRTCPeerConnection({ localPodId: 'a', remotePodId: 'b' })
    const adapter = new WebRTCTransportAdapter(conn)
    const json = adapter.toJSON()
    assert.equal(json.type, 'webrtc')
    assert.equal(json.state, 'disconnected')
    assert.equal(json.latency, 0)
  })
})
