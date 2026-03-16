/**
 * compat-npm-packages.test.mjs — Compatibility tests verifying that
 * npm-published packages export identical APIs and produce identical
 * results to the local web/packages/* copies.
 *
 * Run:
 *   node --import ./web/test/_setup-globals.mjs --test web/test/compat-npm-packages.test.mjs
 *
 * This suite is the gate for Wave 5: if all tests pass, the bridge files
 * can safely swap from local imports to npm imports.
 */

import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

// ── Local imports (current) ─────────────────────────────────────────

import * as localPrimitives from '../packages-mesh-primitives.js'
import * as localNetway from '../packages-netway.js'
import * as localPod from '../packages-pod.js'
import * as localWsh from '../packages-wsh.js'
import * as localAndbox from '../packages-andbox.js'

// ── npm imports (published) ─────────────────────────────────────────

import * as npmPrimitives from 'browsermesh-primitives'
import * as npmNetway from 'browsermesh-netway'
import * as npmPod from 'browsermesh-pod'
import * as npmWsh from 'wsh-upon-star'
import * as npmAndbox from 'andbox'

// ── Helpers ─────────────────────────────────────────────────────────

function getExportNames(mod) {
  return Object.keys(mod).sort()
}

function compareExports(name, local, npm) {
  describe(`${name} — export parity`, () => {
    const localExports = getExportNames(local)
    const npmExports = getExportNames(npm)

    it('npm has all local exports', () => {
      const missing = localExports.filter(k => !npmExports.includes(k))
      assert.deepEqual(missing, [], `npm is missing: ${missing.join(', ')}`)
    })

    it('export types match', () => {
      for (const key of localExports) {
        if (!(key in npm)) continue
        assert.equal(
          typeof npm[key], typeof local[key],
          `${key}: local=${typeof local[key]}, npm=${typeof npm[key]}`
        )
      }
    })

    it('class constructors have same name', () => {
      for (const key of localExports) {
        if (typeof local[key] !== 'function') continue
        if (!(key in npm)) continue
        // Class constructors should have matching names
        if (local[key].prototype && npm[key].prototype) {
          assert.equal(npm[key].name, local[key].name, `Class name mismatch: ${key}`)
        }
      }
    })
  })
}

// ── Export parity tests ─────────────────────────────────────────────

compareExports('browsermesh-primitives', localPrimitives, npmPrimitives)
compareExports('browsermesh-netway', localNetway, npmNetway)
compareExports('browsermesh-pod', localPod, npmPod)
compareExports('wsh-upon-star', localWsh, npmWsh)
compareExports('andbox', localAndbox, npmAndbox)

// ── Behavioral parity: mesh-primitives ──────────────────────────────

describe('browsermesh-primitives — behavioral parity', () => {
  it('MESH_TYPE constants are identical', () => {
    assert.deepEqual(
      Object.entries(localPrimitives.MESH_TYPE),
      Object.entries(npmPrimitives.MESH_TYPE)
    )
  })

  it('MESH_ERROR constants are identical', () => {
    assert.deepEqual(
      Object.entries(localPrimitives.MESH_ERROR),
      Object.entries(npmPrimitives.MESH_ERROR)
    )
  })

  it('wire encode/decode produces identical results', () => {
    const msg = {
      type: localPrimitives.MESH_TYPE.UNICAST,
      from: 'pod-a',
      to: 'pod-b',
      payload: { data: [1, 2, 3] },
      ttl: 30,
    }
    const localBytes = localPrimitives.encodeMeshMessage(msg)
    const npmBytes = npmPrimitives.encodeMeshMessage(msg)
    assert.deepEqual(localBytes, npmBytes)

    const localDecoded = localPrimitives.decodeMeshMessage(npmBytes)
    const npmDecoded = npmPrimitives.decodeMeshMessage(localBytes)
    assert.deepEqual(localDecoded, npmDecoded)
  })

  it('CRDTs produce identical results independently', () => {
    // Note: cross-merging instances from different module copies fails
    // due to private field isolation. This is expected JS behavior.
    // What matters is that both produce identical results for same ops.
    const localClock = new localPrimitives.VectorClock()
    localClock.increment('a')
    localClock.increment('a')
    localClock.increment('b')

    const npmClock = new npmPrimitives.VectorClock()
    npmClock.increment('a')
    npmClock.increment('a')
    npmClock.increment('b')

    assert.deepEqual(localClock.toJSON(), npmClock.toJSON())

    // Same-module merge works
    const localClock2 = new localPrimitives.VectorClock()
    localClock2.increment('c')
    const merged = localClock.merge(localClock2)
    assert.equal(merged.get('a'), 2)
    assert.equal(merged.get('c'), 1)

    const npmClock2 = new npmPrimitives.VectorClock()
    npmClock2.increment('c')
    const npmMerged = npmClock.merge(npmClock2)
    assert.deepEqual(merged.toJSON(), npmMerged.toJSON())
  })

  it('LWWMap works identically', () => {
    const local = new localPrimitives.LWWMap()
    local.set('key1', 'val1', 100, 'node-a')
    local.set('key2', 'val2', 200, 'node-b')

    const npm = new npmPrimitives.LWWMap()
    npm.set('key1', 'val1', 100, 'node-a')
    npm.set('key2', 'val2', 200, 'node-b')

    assert.deepEqual(local.toJSON(), npm.toJSON())
    assert.equal(local.get('key1'), npm.get('key1'))
  })

  it('CapabilityToken works identically', () => {
    const localToken = new localPrimitives.CapabilityToken({
      issuer: 'pod-a',
      subject: 'pod-b',
      scopes: ['mesh:read:*'],
      expiresAt: Date.now() + 60000,
    })
    const npmToken = new npmPrimitives.CapabilityToken({
      issuer: 'pod-a',
      subject: 'pod-b',
      scopes: ['mesh:read:*'],
      expiresAt: Date.now() + 60000,
    })
    assert.equal(localToken.covers('mesh:read:data'), npmToken.covers('mesh:read:data'))
    assert.equal(localToken.covers('mesh:write:data'), npmToken.covers('mesh:write:data'))
  })

  it('scope matching works identically', () => {
    assert.equal(
      localPrimitives.matchScope('mesh:*:*', 'mesh:read:data'),
      npmPrimitives.matchScope('mesh:*:*', 'mesh:read:data')
    )
    assert.equal(
      localPrimitives.matchScope('mesh:read:*', 'mesh:write:data'),
      npmPrimitives.matchScope('mesh:read:*', 'mesh:write:data')
    )
  })

  it('base64url encoding works identically', () => {
    const bytes = new Uint8Array([0, 1, 2, 127, 128, 255])
    assert.equal(
      localPrimitives.encodeBase64url(bytes),
      npmPrimitives.encodeBase64url(bytes)
    )
  })

  it('LocalChannel + TestMesh exports match', () => {
    assert.equal(typeof npmPrimitives.LocalChannel, 'function')
    assert.equal(typeof npmPrimitives.createLocalChannelPair, 'function')
    assert.equal(typeof npmPrimitives.TestMesh, 'function')
    assert.equal(typeof npmPrimitives.DeterministicRNG, 'function')
  })
})

// ── Behavioral parity: netway ───────────────────────────────────────

describe('browsermesh-netway — behavioral parity', () => {
  it('VirtualNetwork constructs identically', () => {
    const local = new localNetway.VirtualNetwork()
    const npm = new npmNetway.VirtualNetwork()
    assert.equal(typeof local.listen, typeof npm.listen)
    assert.equal(typeof local.connect, typeof npm.connect)
  })

  it('parseAddress works identically', () => {
    if (localNetway.parseAddress && npmNetway.parseAddress) {
      const localResult = localNetway.parseAddress('tcp://0.0.0.0:8080')
      const npmResult = npmNetway.parseAddress('tcp://0.0.0.0:8080')
      assert.deepEqual(localResult, npmResult)
    }
  })

  it('error classes match', () => {
    if (localNetway.SocketError && npmNetway.SocketError) {
      const local = new localNetway.SocketError('test')
      const npm = new npmNetway.SocketError('test')
      assert.equal(local.message, npm.message)
      assert.equal(local.constructor.name, npm.constructor.name)
    }
  })
})

// ── Behavioral parity: wsh ──────────────────────────────────────────

describe('wsh-upon-star — behavioral parity', () => {
  it('CBOR encode/decode produces identical results', () => {
    const data = { hello: 'world', num: 42, arr: [1, 2, 3] }
    const localBytes = localWsh.cborEncode(data)
    const npmBytes = npmWsh.cborEncode(data)
    assert.deepEqual(localBytes, npmBytes)

    const localDecoded = localWsh.cborDecode(npmBytes)
    const npmDecoded = npmWsh.cborDecode(localBytes)
    assert.deepEqual(localDecoded, npmDecoded)
  })

  it('MSG constants are identical', () => {
    // Compare a subset of critical message constants
    for (const key of ['HELLO', 'AUTH', 'OPEN', 'CLOSE', 'PING', 'PONG', 'ERROR']) {
      if (key in localWsh.MSG && key in npmWsh.MSG) {
        assert.equal(localWsh.MSG[key], npmWsh.MSG[key], `MSG.${key} mismatch`)
      }
    }
  })

  it('message factories produce identical output', () => {
    const localPing = localWsh.ping()
    const npmPing = npmWsh.ping()
    assert.deepEqual(localPing, npmPing)

    const localPong = localWsh.pong()
    const npmPong = npmWsh.pong()
    assert.deepEqual(localPong, npmPong)
  })

  it('frame encoding is identical', () => {
    const data = { type: 1, payload: 'test' }
    const localFrame = localWsh.frameEncode(localWsh.cborEncode(data))
    const npmFrame = npmWsh.frameEncode(npmWsh.cborEncode(data))
    assert.deepEqual(localFrame, npmFrame)
  })
})

// ── Behavioral parity: andbox ───────────────────────────────────────

describe('andbox — behavioral parity', () => {
  it('gateCapabilities works identically', () => {
    if (localAndbox.gateCapabilities && npmAndbox.gateCapabilities) {
      const localResult = localAndbox.gateCapabilities(['fetch', 'storage'], { fetch: true, storage: false })
      const npmResult = npmAndbox.gateCapabilities(['fetch', 'storage'], { fetch: true, storage: false })
      // Can't deepEqual functions — compare structure
      assert.deepEqual(Object.keys(localResult.gated).sort(), Object.keys(npmResult.gated).sort())
      assert.equal(typeof localResult.stats, typeof npmResult.stats)
    }
  })

  it('DEFAULT_TIMEOUT_MS matches', () => {
    assert.equal(localAndbox.DEFAULT_TIMEOUT_MS, npmAndbox.DEFAULT_TIMEOUT_MS)
  })

  it('DEFAULT_LIMITS matches', () => {
    assert.deepEqual(localAndbox.DEFAULT_LIMITS, npmAndbox.DEFAULT_LIMITS)
  })
})

// ── Behavioral parity: pod ──────────────────────────────────────────

describe('browsermesh-pod — behavioral parity', () => {
  it('Pod constructor works', () => {
    const local = new localPod.Pod()
    const npm = new npmPod.Pod()
    // Both start with null podId (set during boot)
    assert.equal(local.podId, npm.podId)
    assert.equal(local.state, npm.state)
  })

  it('detectPodKind returns consistent results', () => {
    if (localPod.detectPodKind && npmPod.detectPodKind) {
      assert.equal(localPod.detectPodKind(), npmPod.detectPodKind())
    }
  })

  it('message factories produce consistent output', () => {
    if (localPod.createMessage && npmPod.createMessage) {
      const local = localPod.createMessage('test', { data: 1 })
      const npm = npmPod.createMessage('test', { data: 1 })
      assert.equal(local.type, npm.type)
      assert.deepEqual(local.payload, npm.payload)
    }
  })
})
