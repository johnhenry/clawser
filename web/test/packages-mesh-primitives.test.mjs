/**
 * packages-mesh-primitives — Module loading, export verification, and basic API tests.
 *
 * Run: node --import ./web/test/_setup-globals.mjs --test web/test/packages-mesh-primitives.test.mjs
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

import {
  // Constants
  MESH_TYPE, MESH_ERROR,
  // Errors
  MeshError, MeshProtocolError, MeshCapabilityError,
  // Identity
  PodIdentity, derivePodId, encodeBase64url, decodeBase64url,
  // Wire
  messageTypeRegistry, encodeMeshMessage, decodeMeshMessage,
  // Capability
  parseScope, matchScope, CapabilityToken,
  // Trust
  TRUST_CATEGORIES, createTrustEdge, computeTransitiveTrust,
  // ACL
  matchResourcePattern, Permission, AccessGrant, ACLEngine, generateGrantId,
  // CRDTs
  VectorClock, LWWRegister, GCounter, PNCounter, ORSet, RGA, LWWMap,
} from '../packages/mesh-primitives/src/index.mjs'

// ── 1. Exports exist ───────────────────────────────────────────────────

describe('mesh-primitives — exports', () => {
  it('exports constants', () => {
    assert.ok(MESH_TYPE)
    assert.ok(MESH_ERROR)
    assert.equal(MESH_TYPE.UNICAST, 0xa0)
    assert.equal(MESH_ERROR.UNKNOWN, 0)
  })

  it('exports error classes', () => {
    assert.equal(typeof MeshError, 'function')
    assert.equal(typeof MeshProtocolError, 'function')
    assert.equal(typeof MeshCapabilityError, 'function')
  })

  it('exports identity, wire, capability, trust, ACL, and CRDT modules', () => {
    assert.equal(typeof PodIdentity, 'function')
    assert.equal(typeof encodeMeshMessage, 'function')
    assert.equal(typeof decodeMeshMessage, 'function')
    assert.equal(typeof parseScope, 'function')
    assert.equal(typeof matchScope, 'function')
    assert.equal(typeof CapabilityToken, 'function')
    assert.equal(typeof createTrustEdge, 'function')
    assert.equal(typeof computeTransitiveTrust, 'function')
    assert.equal(typeof ACLEngine, 'function')
    assert.equal(typeof VectorClock, 'function')
  })
})

// ── 2. Base64url round-trip ────────────────────────────────────────────

describe('mesh-primitives — base64url', () => {
  it('encodes and decodes round-trip', () => {
    const original = new Uint8Array([0, 1, 255, 128, 64])
    const encoded = encodeBase64url(original)
    assert.equal(typeof encoded, 'string')
    assert.ok(!encoded.includes('+'))
    assert.ok(!encoded.includes('/'))
    assert.ok(!encoded.includes('='))
    const decoded = decodeBase64url(encoded)
    assert.deepEqual(decoded, original)
  })
})

// ── 3. Wire format encode/decode ───────────────────────────────────────

describe('mesh-primitives — wire format', () => {
  it('messageTypeRegistry maps type codes to names', () => {
    assert.ok(messageTypeRegistry instanceof Map)
    assert.equal(messageTypeRegistry.get(MESH_TYPE.UNICAST), 'UNICAST')
  })

  it('encodeMeshMessage/decodeMeshMessage round-trip', () => {
    const msg = {
      type: MESH_TYPE.UNICAST,
      from: 'pod-a',
      to: 'pod-b',
      payload: { text: 'hello' },
      ttl: 30,
    }
    const bytes = encodeMeshMessage(msg)
    assert.ok(bytes instanceof Uint8Array)
    assert.ok(bytes.length > 5)

    const decoded = decodeMeshMessage(bytes)
    assert.equal(decoded.type, MESH_TYPE.UNICAST)
    assert.equal(decoded.from, 'pod-a')
    assert.equal(decoded.to, 'pod-b')
    assert.deepEqual(decoded.payload, { text: 'hello' })
    assert.equal(decoded.ttl, 30)
  })

  it('decodeMeshMessage throws on too-short input', () => {
    assert.throws(() => decodeMeshMessage(new Uint8Array([1, 2])), MeshProtocolError)
  })
})

// ── 4. Capability scope matching ───────────────────────────────────────

describe('mesh-primitives — capability', () => {
  it('parseScope splits namespace:resource:action', () => {
    const s = parseScope('mesh:crdt:write')
    assert.equal(s.namespace, 'mesh')
    assert.equal(s.resource, 'crdt')
    assert.equal(s.action, 'write')
  })

  it('matchScope with wildcards', () => {
    assert.ok(matchScope('*:*:*', 'mesh:crdt:write'))
    assert.ok(matchScope('mesh:*:*', 'mesh:crdt:write'))
    assert.ok(!matchScope('mesh:transport:*', 'mesh:crdt:write'))
  })

  it('CapabilityToken covers and expiry', () => {
    const token = new CapabilityToken({
      issuer: 'a', subject: 'b',
      scopes: ['mesh:*:*'],
      expiresAt: Math.floor(Date.now() / 1000) + 3600,
    })
    assert.ok(token.covers('mesh:crdt:write'))
    assert.ok(!token.covers('other:foo:bar'))
    assert.ok(!token.isExpired())

    const expired = new CapabilityToken({
      issuer: 'a', subject: 'b', scopes: ['*:*:*'], expiresAt: 1,
    })
    assert.ok(expired.isExpired())
  })
})

// ── 5. Trust edges and transitive trust ────────────────────────────────

describe('mesh-primitives — trust', () => {
  it('createTrustEdge validates value range', () => {
    assert.throws(() => createTrustEdge({ from: 'a', to: 'b', category: 'direct', value: 1.5 }), RangeError)
    const edge = createTrustEdge({ from: 'a', to: 'b', category: 'direct', value: 0.9 })
    assert.equal(edge.value, 0.9)
    assert.ok(Object.isFrozen(edge))
  })

  it('computeTransitiveTrust finds path through graph', () => {
    const edges = [
      createTrustEdge({ from: 'a', to: 'b', category: 'direct', value: 0.8 }),
      createTrustEdge({ from: 'b', to: 'c', category: 'direct', value: 0.5 }),
    ]
    // a -> b -> c = 0.8 * 0.5 = 0.4
    assert.equal(computeTransitiveTrust(edges, 'a', 'c'), 0.4)
    // self-trust is 1.0
    assert.equal(computeTransitiveTrust(edges, 'a', 'a'), 1.0)
    // no path returns 0
    assert.equal(computeTransitiveTrust(edges, 'c', 'a'), 0)
  })
})

// ── 6. ACL ─────────────────────────────────────────────────────────────

describe('mesh-primitives — ACL', () => {
  it('Permission.matches with glob patterns', () => {
    const perm = new Permission({ resource: 'svc://model/*', actions: ['read'] })
    assert.ok(perm.matches('svc://model/gpt4', 'read'))
    assert.ok(!perm.matches('svc://model/gpt4', 'write'))
    assert.ok(!perm.matches('svc://other/x', 'read'))
  })

  it('ACLEngine grant/check/revoke lifecycle', () => {
    const engine = new ACLEngine()
    const grant = new AccessGrant({
      id: 'g1', grantee: 'pod-b', grantor: 'pod-a',
      permissions: [{ resource: '*', actions: ['read'] }],
    })
    engine.addGrant(grant)
    assert.equal(engine.size, 1)

    const result = engine.check('pod-b', 'svc://anything', 'read')
    assert.ok(result.allowed)

    engine.revokeGrant('g1')
    const denied = engine.check('pod-b', 'svc://anything', 'read')
    assert.ok(!denied.allowed)
  })

  it('generateGrantId returns unique strings', () => {
    const id1 = generateGrantId()
    const id2 = generateGrantId()
    assert.notEqual(id1, id2)
    assert.ok(id1.startsWith('grant_'))
  })
})

// ── 7. CRDTs ───────────────────────────────────────────────────────────

describe('mesh-primitives — CRDTs', () => {
  it('VectorClock increment/merge/compare', () => {
    const vc1 = new VectorClock()
    vc1.increment('a')
    vc1.increment('a')
    assert.equal(vc1.get('a'), 2)

    const vc2 = new VectorClock()
    vc2.increment('b')
    const merged = vc1.merge(vc2)
    assert.equal(merged.get('a'), 2)
    assert.equal(merged.get('b'), 1)
    assert.equal(vc1.compare(vc2), 'concurrent')
  })

  it('GCounter increment and merge', () => {
    const c1 = new GCounter()
    c1.increment('a', 3)
    assert.equal(c1.value, 3)

    const c2 = new GCounter()
    c2.increment('b', 5)
    const merged = c1.merge(c2)
    assert.equal(merged.value, 8)
  })

  it('PNCounter supports decrement', () => {
    const pn = new PNCounter()
    pn.increment('a', 10)
    pn.decrement('a', 3)
    assert.equal(pn.value, 7)
  })

  it('ORSet add/remove/has', () => {
    const set = new ORSet()
    set.add('x', 'node-a')
    assert.ok(set.has('x'))
    set.remove('x')
    assert.ok(!set.has('x'))
    // Re-add after remove works (add wins over concurrent remove)
    set.add('x', 'node-a')
    assert.ok(set.has('x'))
  })

  it('LWWMap set/get/delete', () => {
    const map = new LWWMap()
    map.set('key1', 'val1', 1, 'a')
    assert.equal(map.get('key1'), 'val1')
    assert.equal(map.size, 1)
    assert.ok(map.has('key1'))

    map.delete('key1', 2, 'a')
    assert.equal(map.get('key1'), undefined)
    assert.equal(map.size, 0)
  })
})
