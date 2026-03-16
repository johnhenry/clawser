import { describe, it, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { cborEncode, cborDecode } from '../packages/wsh/src/cbor.mjs'
import {
  WshPBFTTransport,
  SessionKeyMapping,
} from '../clawser-raijin-wsh-adapter.js'
import {
  PBFT_WIRE_CODES,
  pbftTypeToWireCode,
  _encodeValue,
} from '../clawser-raijin-bridge.js'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeKey(id) {
  const key = new Uint8Array(32)
  key[0] = id
  return key
}

// ---------------------------------------------------------------------------
// SessionKeyMapping
// ---------------------------------------------------------------------------

describe('SessionKeyMapping', () => {
  let mapping

  beforeEach(() => {
    mapping = new SessionKeyMapping()
  })

  it('registers and retrieves session <-> key mappings', () => {
    const key = makeKey(1)
    mapping.register('sess-1', key)
    assert.deepEqual(mapping.sessionToKey('sess-1'), key)
    assert.equal(mapping.keyToSession(key), 'sess-1')
  })

  it('reports size correctly', () => {
    assert.equal(mapping.size, 0)
    mapping.register('sess-1', makeKey(1))
    mapping.register('sess-2', makeKey(2))
    assert.equal(mapping.size, 2)
  })

  it('has() and hasKey() work', () => {
    const key = makeKey(3)
    assert.equal(mapping.has('sess-3'), false)
    assert.equal(mapping.hasKey(key), false)
    mapping.register('sess-3', key)
    assert.equal(mapping.has('sess-3'), true)
    assert.equal(mapping.hasKey(key), true)
  })

  it('throws on invalid sessionId', () => {
    assert.throws(() => mapping.register('', makeKey(1)), /non-empty string/)
    assert.throws(() => mapping.register(null, makeKey(1)), /non-empty string/)
  })

  it('throws on invalid publicKey', () => {
    assert.throws(() => mapping.register('sess-1', 'not-bytes'), /Uint8Array/)
  })

  it('throws on unknown session lookup', () => {
    assert.throws(() => mapping.sessionToKey('unknown'), /No key registered/)
  })

  it('throws on unknown key lookup', () => {
    assert.throws(() => mapping.keyToSession(makeKey(99)), /No session registered/)
  })
})

// ---------------------------------------------------------------------------
// WshPBFTTransport
// ---------------------------------------------------------------------------

describe('WshPBFTTransport', () => {
  let mapping, transport
  let broadcasts, unicasts

  beforeEach(() => {
    mapping = new SessionKeyMapping()
    mapping.register('sess-0', makeKey(0))
    mapping.register('sess-1', makeKey(1))
    mapping.register('sess-2', makeKey(2))

    broadcasts = []
    unicasts = []

    transport = new WshPBFTTransport('sess-0', mapping, {
      sendToAll: (bytes) => broadcasts.push(bytes),
      sendTo: (sessionId, bytes) => unicasts.push({ sessionId, bytes }),
    })
  })

  it('broadcast() encodes ConsensusMessage to CBOR bytes', () => {
    transport.broadcast({ type: 'prepare', view: 1, sequence: 2 })

    assert.equal(broadcasts.length, 1)
    const envelope = cborDecode(broadcasts[0])
    assert.equal(envelope.w, pbftTypeToWireCode('prepare'))
    assert.equal(envelope.p.view, 1)
    assert.equal(envelope.p.sequence, 2)
    assert.equal(envelope.p.type, undefined) // type stripped from payload
  })

  it('send() routes to specific session by public key', () => {
    const targetKey = makeKey(2)
    transport.send(targetKey, { type: 'commit', view: 3, sequence: 4 })

    assert.equal(unicasts.length, 1)
    assert.equal(unicasts[0].sessionId, 'sess-2')
    const envelope = cborDecode(unicasts[0].bytes)
    assert.equal(envelope.w, pbftTypeToWireCode('commit'))
    assert.equal(envelope.p.view, 3)
  })

  it('onMessage + handleIncoming dispatches decoded messages', () => {
    const received = []
    transport.onMessage((from, msg) => received.push({ from, msg }))

    // Build a wire envelope as CBOR bytes
    const wireCode = pbftTypeToWireCode('pre-prepare')
    const payload = _encodeValue({ view: 1, sequence: 5, digest: new Uint8Array([0xaa, 0xbb]) })
    const bytes = cborEncode({ w: wireCode, p: payload })

    transport.handleIncoming('sess-1', bytes)

    assert.equal(received.length, 1)
    assert.deepEqual(received[0].from, makeKey(1))
    assert.equal(received[0].msg.type, 'pre-prepare')
    assert.equal(received[0].msg.view, 1)
    assert.equal(received[0].msg.sequence, 5)
    assert.ok(received[0].msg.digest instanceof Uint8Array)
    assert.deepEqual(received[0].msg.digest, new Uint8Array([0xaa, 0xbb]))
  })

  it('handleIncoming ignores non-PBFT wire codes', () => {
    const received = []
    transport.onMessage((from, msg) => received.push({ from, msg }))

    const bytes = cborEncode({ w: 0x01, p: {} })
    transport.handleIncoming('sess-1', bytes)

    assert.equal(received.length, 0)
  })

  it('handleIncoming is a no-op when no handler registered', () => {
    const wireCode = pbftTypeToWireCode('prepare')
    const bytes = cborEncode({ w: wireCode, p: { view: 1 } })
    // Should not throw
    transport.handleIncoming('sess-1', bytes)
  })

  it('round-trips bigint values through encode/decode', () => {
    const received = []
    transport.onMessage((from, msg) => received.push(msg))

    transport.broadcast({ type: 'view-change', view: 42n, newView: 43n })

    // Decode what was broadcast and feed it back as incoming
    const bytes = broadcasts[0]
    transport.handleIncoming('sess-1', bytes)

    assert.equal(received.length, 1)
    assert.equal(received[0].type, 'view-change')
    assert.equal(received[0].view, 42n)
    assert.equal(received[0].newView, 43n)
  })

  it('round-trips Uint8Array values through encode/decode', () => {
    const received = []
    transport.onMessage((from, msg) => received.push(msg))

    const sig = new Uint8Array([1, 2, 3, 4, 5])
    transport.broadcast({ type: 'commit', view: 0, signature: sig })

    transport.handleIncoming('sess-1', broadcasts[0])

    assert.equal(received.length, 1)
    assert.deepEqual(received[0].signature, sig)
  })

  it('handles all 5 PBFT message types', () => {
    const types = ['pre-prepare', 'prepare', 'commit', 'view-change', 'new-view']
    for (const type of types) {
      broadcasts.length = 0
      transport.broadcast({ type, view: 1 })
      assert.equal(broadcasts.length, 1, `broadcast failed for ${type}`)
      const envelope = cborDecode(broadcasts[0])
      assert.equal(envelope.w, pbftTypeToWireCode(type))
    }
  })

  it('throws on unknown PBFT message type in broadcast', () => {
    assert.throws(
      () => transport.broadcast({ type: 'unknown-type', view: 1 }),
      /Unknown PBFT type/
    )
  })
})
