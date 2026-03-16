import { describe, it, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { MESH_TYPE } from '../packages/mesh-primitives/src/constants.mjs'
import {
  ClawserTransportAdapter,
  PodKeyMapping,
  PBFT_WIRE_CODES,
  PBFT_TYPE_TO_CODE,
  PBFT_CODE_TO_TYPE,
  encodePBFTPayload,
  decodePBFTPayload,
  pbftTypeToWireCode,
  wireCodeToPbftType,
  _encodeValue,
  _decodeValue,
  _uint8ToBase64url,
  _base64urlToUint8,
} from '../clawser-raijin-bridge.js'
import {
  createLocalChannelPair,
  TestMesh,
} from '../packages/mesh-primitives/src/test-transport.mjs'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeKey(id) {
  const key = new Uint8Array(32)
  key[0] = id
  return key
}

// ---------------------------------------------------------------------------
// Wire code allocation
// ---------------------------------------------------------------------------

describe('PBFT wire codes', () => {
  it('maps all 5 PBFT message types', () => {
    assert.equal(PBFT_TYPE_TO_CODE['pre-prepare'], 0xed)
    assert.equal(PBFT_TYPE_TO_CODE['prepare'], 0xee)
    assert.equal(PBFT_TYPE_TO_CODE['commit'], 0xef)
    assert.equal(PBFT_TYPE_TO_CODE['view-change'], 0xf4)
    assert.equal(PBFT_TYPE_TO_CODE['new-view'], 0xf5)
  })

  it('reverse mapping is consistent', () => {
    for (const [type, code] of Object.entries(PBFT_TYPE_TO_CODE)) {
      assert.equal(PBFT_CODE_TO_TYPE[code], type)
    }
  })

  it('wire codes are registered in MESH_TYPE', () => {
    assert.equal(MESH_TYPE.PBFT_PRE_PREPARE, 0xed)
    assert.equal(MESH_TYPE.PBFT_PREPARE, 0xee)
    assert.equal(MESH_TYPE.PBFT_COMMIT, 0xef)
    assert.equal(MESH_TYPE.PBFT_VIEW_CHANGE, 0xf4)
    assert.equal(MESH_TYPE.PBFT_NEW_VIEW, 0xf5)
  })

  it('SWIM codes are registered in MESH_TYPE', () => {
    assert.equal(MESH_TYPE.SWIM_PING, 0xf0)
    assert.equal(MESH_TYPE.SWIM_PING_REQ, 0xf1)
    assert.equal(MESH_TYPE.SWIM_ACK, 0xf2)
    assert.equal(MESH_TYPE.SWIM_MEMBERSHIP, 0xf3)
  })

  it('no wire code collisions in MESH_TYPE', () => {
    const values = Object.values(MESH_TYPE)
    const unique = new Set(values)
    assert.equal(unique.size, values.length, 'Duplicate wire code detected')
  })

  it('PBFT_WIRE_CODES contains exactly 5 codes', () => {
    assert.equal(PBFT_WIRE_CODES.size, 5)
    assert.ok(PBFT_WIRE_CODES.has(0xed))
    assert.ok(PBFT_WIRE_CODES.has(0xee))
    assert.ok(PBFT_WIRE_CODES.has(0xef))
    assert.ok(PBFT_WIRE_CODES.has(0xf4))
    assert.ok(PBFT_WIRE_CODES.has(0xf5))
  })
})

// ---------------------------------------------------------------------------
// Serialization helpers
// ---------------------------------------------------------------------------

describe('serialization helpers', () => {
  it('encodes and decodes bigint', () => {
    const encoded = _encodeValue(123456789n)
    assert.deepEqual(encoded, { __bigint: '123456789' })
    assert.equal(_decodeValue(encoded), 123456789n)
  })

  it('encodes and decodes large bigint', () => {
    const big = 2n ** 256n - 1n
    const roundTripped = _decodeValue(_encodeValue(big))
    assert.equal(roundTripped, big)
  })

  it('encodes and decodes Uint8Array', () => {
    const bytes = new Uint8Array([0, 1, 2, 255])
    const encoded = _encodeValue(bytes)
    assert.ok('__bytes' in encoded)
    const decoded = _decodeValue(encoded)
    assert.ok(decoded instanceof Uint8Array)
    assert.deepEqual(decoded, bytes)
  })

  it('encodes and decodes nested objects', () => {
    const original = {
      view: 42n,
      digest: new Uint8Array([10, 20, 30]),
      nested: { seq: 1n },
      arr: [1n, new Uint8Array([1])],
    }
    const roundTripped = _decodeValue(_encodeValue(original))
    assert.equal(roundTripped.view, 42n)
    assert.deepEqual(roundTripped.digest, new Uint8Array([10, 20, 30]))
    assert.equal(roundTripped.nested.seq, 1n)
    assert.equal(roundTripped.arr[0], 1n)
    assert.deepEqual(roundTripped.arr[1], new Uint8Array([1]))
  })

  it('handles null and undefined', () => {
    assert.equal(_encodeValue(null), null)
    assert.equal(_encodeValue(undefined), undefined)
    assert.equal(_decodeValue(null), null)
    assert.equal(_decodeValue(undefined), undefined)
  })

  it('handles primitives', () => {
    assert.equal(_encodeValue(42), 42)
    assert.equal(_encodeValue('hello'), 'hello')
    assert.equal(_encodeValue(true), true)
  })

  it('base64url round-trips', () => {
    const bytes = new Uint8Array(256)
    for (let i = 0; i < 256; i++) bytes[i] = i
    const b64 = _uint8ToBase64url(bytes)
    assert.ok(!b64.includes('+'))
    assert.ok(!b64.includes('/'))
    assert.ok(!b64.includes('='))
    const decoded = _base64urlToUint8(b64)
    assert.deepEqual(decoded, bytes)
  })
})

// ---------------------------------------------------------------------------
// PodKeyMapping
// ---------------------------------------------------------------------------

describe('PodKeyMapping', () => {
  let mapping

  beforeEach(() => {
    mapping = new PodKeyMapping()
  })

  it('registers and retrieves mappings', () => {
    const key = makeKey(1)
    mapping.register('pod-1', key)
    assert.deepEqual(mapping.podIdToKey('pod-1'), key)
    assert.equal(mapping.keyToPodId(key), 'pod-1')
  })

  it('tracks size', () => {
    assert.equal(mapping.size, 0)
    mapping.register('a', makeKey(1))
    mapping.register('b', makeKey(2))
    assert.equal(mapping.size, 2)
  })

  it('has/hasKey check existence', () => {
    const key = makeKey(1)
    assert.equal(mapping.has('pod-1'), false)
    assert.equal(mapping.hasKey(key), false)
    mapping.register('pod-1', key)
    assert.equal(mapping.has('pod-1'), true)
    assert.equal(mapping.hasKey(key), true)
  })

  it('throws on unknown podId', () => {
    assert.throws(() => mapping.podIdToKey('unknown'), /No key registered/)
  })

  it('throws on unknown key', () => {
    assert.throws(() => mapping.keyToPodId(makeKey(99)), /No podId registered/)
  })

  it('rejects invalid podId', () => {
    assert.throws(() => mapping.register('', makeKey(1)), /non-empty string/)
    assert.throws(() => mapping.register(null, makeKey(1)), /non-empty string/)
  })

  it('rejects invalid publicKey', () => {
    assert.throws(() => mapping.register('pod-1', 'not-bytes'), /Uint8Array/)
  })
})

// ---------------------------------------------------------------------------
// encodePBFTPayload / decodePBFTPayload round-trip
// ---------------------------------------------------------------------------

describe('PBFT payload round-trip', () => {
  it('round-trips pre-prepare message', () => {
    const msg = {
      type: 'pre-prepare',
      view: 0n,
      sequence: 1n,
      block: {
        header: {
          number: 1n,
          parentHash: new Uint8Array(32),
          stateRoot: new Uint8Array(32),
          txRoot: new Uint8Array(32),
          receiptRoot: new Uint8Array(32),
          timestamp: 1700000000000,
          proposer: makeKey(0),
        },
        transactions: [],
        signatures: [],
      },
      digest: new Uint8Array(32).fill(0xab),
    }

    const payload = encodePBFTPayload(msg)
    const decoded = decodePBFTPayload(0xed, payload)

    assert.equal(decoded.type, 'pre-prepare')
    assert.equal(decoded.view, 0n)
    assert.equal(decoded.sequence, 1n)
    assert.equal(decoded.block.header.number, 1n)
    assert.deepEqual(decoded.digest, msg.digest)
  })

  it('round-trips pre-prepare with transactions containing bigint/Uint8Array fields', () => {
    const tx = {
      from: makeKey(1),
      nonce: 42n,
      to: makeKey(2),
      value: 1000000n,
      data: new Uint8Array([0x01, 0x02, 0x03]),
      signature: new Uint8Array(64).fill(0xdd),
      chainId: 1n,
    }
    const msg = {
      type: 'pre-prepare',
      view: 0n,
      sequence: 1n,
      block: {
        header: {
          number: 5n,
          parentHash: new Uint8Array(32).fill(0x11),
          stateRoot: new Uint8Array(32).fill(0x22),
          txRoot: new Uint8Array(32).fill(0x33),
          receiptRoot: new Uint8Array(32).fill(0x44),
          timestamp: 1700000000000,
          proposer: makeKey(0),
        },
        transactions: [tx],
        signatures: [new Uint8Array(64).fill(0xee)],
      },
      digest: new Uint8Array(32).fill(0xff),
    }

    const payload = encodePBFTPayload(msg)
    const decoded = decodePBFTPayload(0xed, payload)

    assert.equal(decoded.block.header.number, 5n)
    assert.equal(decoded.block.transactions.length, 1)
    const decodedTx = decoded.block.transactions[0]
    assert.deepEqual(decodedTx.from, makeKey(1))
    assert.equal(decodedTx.nonce, 42n)
    assert.deepEqual(decodedTx.to, makeKey(2))
    assert.equal(decodedTx.value, 1000000n)
    assert.deepEqual(decodedTx.data, new Uint8Array([0x01, 0x02, 0x03]))
    assert.deepEqual(decodedTx.signature, new Uint8Array(64).fill(0xdd))
    assert.equal(decodedTx.chainId, 1n)
    assert.equal(decoded.block.signatures.length, 1)
    assert.deepEqual(decoded.block.signatures[0], new Uint8Array(64).fill(0xee))
  })

  it('round-trips prepare message', () => {
    const msg = {
      type: 'prepare',
      view: 1n,
      sequence: 5n,
      digest: new Uint8Array(32).fill(0xcd),
      from: makeKey(2),
    }

    const payload = encodePBFTPayload(msg)
    const decoded = decodePBFTPayload(0xee, payload)

    assert.equal(decoded.type, 'prepare')
    assert.equal(decoded.view, 1n)
    assert.equal(decoded.sequence, 5n)
    assert.deepEqual(decoded.digest, msg.digest)
    assert.deepEqual(decoded.from, msg.from)
  })

  it('round-trips commit message', () => {
    const msg = {
      type: 'commit',
      view: 2n,
      sequence: 3n,
      digest: new Uint8Array(32).fill(0xef),
      from: makeKey(1),
      signature: new Uint8Array(64).fill(0x77),
    }

    const payload = encodePBFTPayload(msg)
    const decoded = decodePBFTPayload(0xef, payload)

    assert.equal(decoded.type, 'commit')
    assert.equal(decoded.view, 2n)
    assert.deepEqual(decoded.signature, msg.signature)
  })

  it('round-trips view-change message', () => {
    const msg = {
      type: 'view-change',
      newView: 3n,
      sequence: 10n,
      from: makeKey(3),
    }

    const payload = encodePBFTPayload(msg)
    const decoded = decodePBFTPayload(0xf4, payload)

    assert.equal(decoded.type, 'view-change')
    assert.equal(decoded.newView, 3n)
    assert.equal(decoded.sequence, 10n)
  })

  it('round-trips new-view message with embedded view-changes', () => {
    const msg = {
      type: 'new-view',
      view: 3n,
      viewChanges: [
        { type: 'view-change', newView: 3n, sequence: 10n, from: makeKey(1) },
        { type: 'view-change', newView: 3n, sequence: 10n, from: makeKey(2) },
      ],
    }

    const payload = encodePBFTPayload(msg)
    const decoded = decodePBFTPayload(0xf5, payload)

    assert.equal(decoded.type, 'new-view')
    assert.equal(decoded.view, 3n)
    assert.equal(decoded.viewChanges.length, 2)
    assert.equal(decoded.viewChanges[0].newView, 3n)
    assert.deepEqual(decoded.viewChanges[0].from, makeKey(1))
  })
})

// ---------------------------------------------------------------------------
// pbftTypeToWireCode / wireCodeToPbftType
// ---------------------------------------------------------------------------

describe('type/code conversion', () => {
  it('converts all types to codes', () => {
    assert.equal(pbftTypeToWireCode('pre-prepare'), 0xed)
    assert.equal(pbftTypeToWireCode('prepare'), 0xee)
    assert.equal(pbftTypeToWireCode('commit'), 0xef)
    assert.equal(pbftTypeToWireCode('view-change'), 0xf4)
    assert.equal(pbftTypeToWireCode('new-view'), 0xf5)
  })

  it('converts all codes to types', () => {
    assert.equal(wireCodeToPbftType(0xed), 'pre-prepare')
    assert.equal(wireCodeToPbftType(0xee), 'prepare')
    assert.equal(wireCodeToPbftType(0xef), 'commit')
    assert.equal(wireCodeToPbftType(0xf4), 'view-change')
    assert.equal(wireCodeToPbftType(0xf5), 'new-view')
  })

  it('throws for unknown type', () => {
    assert.throws(() => pbftTypeToWireCode('unknown'), /Unknown PBFT type/)
  })

  it('throws for unknown code', () => {
    assert.throws(() => wireCodeToPbftType(0x00), /Unknown PBFT wire code/)
  })
})

// ---------------------------------------------------------------------------
// ClawserTransportAdapter
// ---------------------------------------------------------------------------

describe('ClawserTransportAdapter', () => {
  let mapping
  let broadcasts
  let unicasts
  let adapter

  beforeEach(() => {
    mapping = new PodKeyMapping()
    mapping.register('pod-0', makeKey(0))
    mapping.register('pod-1', makeKey(1))
    mapping.register('pod-2', makeKey(2))
    mapping.register('pod-3', makeKey(3))

    broadcasts = []
    unicasts = []

    adapter = new ClawserTransportAdapter('pod-0', mapping, {
      sendToAll: (msg) => broadcasts.push(msg),
      sendTo: (podId, msg) => unicasts.push({ podId, msg }),
    })
  })

  it('broadcast encodes and sends to all', () => {
    adapter.broadcast({
      type: 'prepare',
      view: 1n,
      sequence: 2n,
      digest: new Uint8Array(32),
      from: makeKey(0),
    })

    assert.equal(broadcasts.length, 1)
    assert.equal(broadcasts[0].type, MESH_TYPE.PBFT_PREPARE)
    assert.equal(broadcasts[0].from, 'pod-0')
    assert.ok(broadcasts[0].payload.view.__bigint)
  })

  it('send encodes and sends to specific peer', () => {
    adapter.send(makeKey(2), {
      type: 'commit',
      view: 0n,
      sequence: 1n,
      digest: new Uint8Array(32),
      from: makeKey(0),
      signature: new Uint8Array(64),
    })

    assert.equal(unicasts.length, 1)
    assert.equal(unicasts[0].podId, 'pod-2')
    assert.equal(unicasts[0].msg.type, MESH_TYPE.PBFT_COMMIT)
  })

  it('handleIncoming dispatches to registered handler', () => {
    const received = []
    adapter.onMessage((from, msg) => {
      received.push({ from, msg })
    })

    const payload = encodePBFTPayload({
      type: 'prepare',
      view: 1n,
      sequence: 2n,
      digest: new Uint8Array(32).fill(0xab),
      from: makeKey(1),
    })

    adapter.handleIncoming('pod-1', MESH_TYPE.PBFT_PREPARE, payload)

    assert.equal(received.length, 1)
    assert.deepEqual(received[0].from, makeKey(1))
    assert.equal(received[0].msg.type, 'prepare')
    assert.equal(received[0].msg.view, 1n)
  })

  it('handleIncoming ignores non-PBFT wire codes', () => {
    const received = []
    adapter.onMessage((from, msg) => received.push(msg))
    adapter.handleIncoming('pod-1', MESH_TYPE.PING, {})
    assert.equal(received.length, 0)
  })

  it('handleIncoming does nothing without handler', () => {
    // Should not throw
    adapter.handleIncoming('pod-1', MESH_TYPE.PBFT_PREPARE, {})
  })

  it('broadcast throws for unknown message type', () => {
    assert.throws(
      () => adapter.broadcast({ type: 'unknown' }),
      /Unknown PBFT message type/
    )
  })
})

// ---------------------------------------------------------------------------
// Integration: 4-node PBFT over TestMesh
// ---------------------------------------------------------------------------

describe('4-node PBFT over TestMesh', () => {
  it('broadcasts and receives messages across all nodes', async () => {
    const mesh = await TestMesh.create(4)
    const mapping = new PodKeyMapping()
    const keys = [makeKey(0), makeKey(1), makeKey(2), makeKey(3)]

    for (let i = 0; i < 4; i++) {
      mapping.register(mesh.pods[i].id, keys[i])
    }

    // Create adapters for each node
    const adapters = []
    const received = [[], [], [], []]

    for (let i = 0; i < 4; i++) {
      const podId = mesh.pods[i].id
      const adapter = new ClawserTransportAdapter(podId, mapping, {
        sendToAll: (wireMsg) => {
          // Send to all other pods
          for (let j = 0; j < 4; j++) {
            if (j === i) continue
            const ch = mesh.pods[i].channels.get(j)
            if (ch && ch.state === 'open') {
              ch.send(wireMsg)
            }
          }
        },
        sendTo: (targetPodId, wireMsg) => {
          const targetIdx = mesh.pods.findIndex((p) => p.id === targetPodId)
          const ch = mesh.pods[i].channels.get(targetIdx)
          if (ch && ch.state === 'open') {
            ch.send(wireMsg)
          }
        },
      })

      adapter.onMessage((from, msg) => {
        received[i].push({ from, msg })
      })

      adapters.push(adapter)

      // Wire up channel handlers to dispatch to adapter
      for (const [j, ch] of mesh.pods[i].channels) {
        ch.onmessage = (event) => {
          const wireMsg = event.data
          if (PBFT_WIRE_CODES.has(wireMsg.type)) {
            adapter.handleIncoming(wireMsg.from, wireMsg.type, wireMsg.payload)
          }
        }
      }
    }

    // Node 0 broadcasts a prepare message
    adapters[0].broadcast({
      type: 'prepare',
      view: 0n,
      sequence: 1n,
      digest: new Uint8Array(32).fill(0xaa),
      from: keys[0],
    })

    // All other nodes should receive it
    assert.equal(received[0].length, 0) // sender doesn't receive own broadcast
    assert.equal(received[1].length, 1)
    assert.equal(received[2].length, 1)
    assert.equal(received[3].length, 1)

    // Verify message content
    assert.equal(received[1][0].msg.type, 'prepare')
    assert.equal(received[1][0].msg.view, 0n)
    assert.deepEqual(received[1][0].from, keys[0])

    // Node 2 sends unicast to node 3
    adapters[2].send(keys[3], {
      type: 'commit',
      view: 0n,
      sequence: 1n,
      digest: new Uint8Array(32).fill(0xbb),
      from: keys[2],
      signature: new Uint8Array(64).fill(0xcc),
    })

    assert.equal(received[3].length, 2) // broadcast + unicast
    assert.equal(received[3][1].msg.type, 'commit')
    assert.deepEqual(received[3][1].from, keys[2])

    await mesh.shutdown()
  })

  it('handles partition — messages blocked between groups', async () => {
    const mesh = await TestMesh.create(4)
    const mapping = new PodKeyMapping()
    const keys = [makeKey(10), makeKey(11), makeKey(12), makeKey(13)]

    for (let i = 0; i < 4; i++) {
      mapping.register(mesh.pods[i].id, keys[i])
    }

    const received = [[], [], [], []]
    const adapters = []

    for (let i = 0; i < 4; i++) {
      const podId = mesh.pods[i].id
      const adapter = new ClawserTransportAdapter(podId, mapping, {
        sendToAll: (wireMsg) => {
          for (let j = 0; j < 4; j++) {
            if (j === i) continue
            const ch = mesh.pods[i].channels.get(j)
            if (ch && ch.state === 'open') {
              ch.send(wireMsg)
            }
          }
        },
        sendTo: () => {},
      })

      adapter.onMessage((from, msg) => received[i].push(msg))
      adapters.push(adapter)

      for (const [j, ch] of mesh.pods[i].channels) {
        ch.onmessage = (event) => {
          const wireMsg = event.data
          if (PBFT_WIRE_CODES.has(wireMsg.type)) {
            adapter.handleIncoming(wireMsg.from, wireMsg.type, wireMsg.payload)
          }
        }
      }
    }

    // Partition: pods 0-1 vs pods 2-3
    mesh.injectFault({
      type: 'partition',
      groupA: ['test-pod-0', 'test-pod-1'],
      groupB: ['test-pod-2', 'test-pod-3'],
    })

    // Node 0 broadcasts
    adapters[0].broadcast({
      type: 'prepare',
      view: 0n,
      sequence: 1n,
      digest: new Uint8Array(32),
      from: keys[0],
    })

    // Only node 1 receives (same partition group)
    assert.equal(received[1].length, 1)
    assert.equal(received[2].length, 0) // partitioned
    assert.equal(received[3].length, 0) // partitioned

    await mesh.shutdown()
  })

  it('view-change messages round-trip correctly', async () => {
    const mesh = await TestMesh.create(4)
    const mapping = new PodKeyMapping()
    const keys = [makeKey(20), makeKey(21), makeKey(22), makeKey(23)]

    for (let i = 0; i < 4; i++) {
      mapping.register(mesh.pods[i].id, keys[i])
    }

    const received = []
    const adapters = []

    for (let i = 0; i < 4; i++) {
      const podId = mesh.pods[i].id
      const adapter = new ClawserTransportAdapter(podId, mapping, {
        sendToAll: (wireMsg) => {
          for (let j = 0; j < 4; j++) {
            if (j === i) continue
            const ch = mesh.pods[i].channels.get(j)
            if (ch?.state === 'open') ch.send(wireMsg)
          }
        },
        sendTo: () => {},
      })

      if (i > 0) {
        adapter.onMessage((from, msg) => received.push({ node: i, from, msg }))
      }
      adapters.push(adapter)

      for (const [_, ch] of mesh.pods[i].channels) {
        ch.onmessage = (event) => {
          const wireMsg = event.data
          if (PBFT_WIRE_CODES.has(wireMsg.type)) {
            adapter.handleIncoming(wireMsg.from, wireMsg.type, wireMsg.payload)
          }
        }
      }
    }

    // Node 0 broadcasts view-change
    adapters[0].broadcast({
      type: 'view-change',
      newView: 5n,
      sequence: 10n,
      from: keys[0],
    })

    assert.equal(received.length, 3) // nodes 1, 2, 3
    for (const r of received) {
      assert.equal(r.msg.type, 'view-change')
      assert.equal(r.msg.newView, 5n)
      assert.equal(r.msg.sequence, 10n)
      assert.deepEqual(r.from, keys[0])
    }

    await mesh.shutdown()
  })
})
