// clawser-deploy-publish.test.mjs

import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

import { publishDeploy, publishDeployToAll, normalizePayloads } from '../clawser-deploy-publish.mjs'
import { verifySignedPackage } from '../clawser-deploy-package.mjs'
import { resolveDidKey } from '../clawser-did-key.mjs'
import { MeshIdentityManager, InMemoryIdentityStorage } from '../clawser-mesh-identity.js'

// ── normalizePayloads ────────────────────────────────────────────

describe('normalizePayloads', () => {
  it('Uint8Array passes through', () => {
    const u = new Uint8Array([1, 2, 3])
    const r = normalizePayloads([{ itemId: 'a', payload: u, kind: 'skill' }])
    assert.equal(r.a, u)
  })
  it('string → UTF-8 bytes', () => {
    const r = normalizePayloads([{ itemId: 'a', payload: 'hello', kind: 'skill' }])
    assert.deepEqual(r.a, new TextEncoder().encode('hello'))
  })
  it('object → JSON UTF-8', () => {
    const r = normalizePayloads([{ itemId: 'a', payload: { x: 1 }, kind: 'config' }])
    assert.deepEqual(r.a, new TextEncoder().encode('{"x":1}'))
  })
})

// ── publishDeploy ────────────────────────────────────────────────

async function makeIdentity() {
  const mgr = new MeshIdentityManager(new InMemoryIdentityStorage())
  const sum = await mgr.create('test')
  const jwk = await mgr.export(sum.podId)
  const privateKey = await crypto.subtle.importKey('jwk', jwk, { name: 'Ed25519' }, false, ['sign'])
  return { mgr, summary: sum, privateKey }
}

describe('publishDeploy — happy path', () => {
  it('builds, signs, and sends; result verifies against did:key', async () => {
    const { summary, privateKey } = await makeIdentity()
    const sent = []
    const pod = { sendMessage: async (peerId, env) => { sent.push({ peerId, env }) } }

    const r = await publishDeploy({
      items: [
        { kind: 'skill', itemId: 'my-skill', payload: { files: { 'SKILL.md': '# Hi' } } },
        { kind: 'config', itemId: 'autonomy', payload: { level: 'supervised' } },
      ],
      targetPubKey: 'targetPeer123',
      manifestExtras: {
        sourceLabel: 'My Source',
        capabilities: { fs: ['/tmp/'], config: ['autonomy'] },
      },
      signingKey: privateKey,
      sourceDid: summary.did,
      pod,
    })

    assert.equal(r.ok, true)
    assert.equal(typeof r.counter, 'number')
    assert.equal(sent.length, 1)
    assert.equal(sent[0].peerId, 'targetPeer123')
    assert.equal(sent[0].env.type, 'deploy')

    // Verify the signature by the source's did:key
    const verifyKey = await resolveDidKey(summary.did)
    const verify = await verifySignedPackage(sent[0].env.package, verifyKey)
    assert.equal(verify.ok, true)
  })

  it('counter increments on each call', async () => {
    const { summary, privateKey } = await makeIdentity()
    const pod = { sendMessage: async () => {} }
    const opts = {
      items: [{ kind: 'config', itemId: 'autonomy', payload: 1 }],
      targetPubKey: 't',
      signingKey: privateKey,
      sourceDid: summary.did,
      pod,
    }
    const r1 = await publishDeploy(opts)
    const r2 = await publishDeploy(opts)
    assert.equal(r1.ok, true)
    assert.equal(r2.ok, true)
    assert.ok(r2.counter > r1.counter, 'counter must monotonically increase')
  })

  it('respects an injected nextCounter', async () => {
    const { summary, privateKey } = await makeIdentity()
    const pod = { sendMessage: async () => {} }
    let n = 100
    const r = await publishDeploy({
      items: [{ kind: 'config', itemId: 'autonomy', payload: 1 }],
      targetPubKey: 't',
      signingKey: privateKey,
      sourceDid: summary.did,
      pod,
      nextCounter: () => ++n,
    })
    assert.equal(r.counter, 101)
  })
})

// ── publishDeploy — error paths ──────────────────────────────────

describe('publishDeploy — error paths', () => {
  const stub = async () => ({}) // silenced sendMessage

  it('rejects empty items', async () => {
    const r = await publishDeploy({
      items: [], targetPubKey: 't', signingKey: {}, sourceDid: 'did:key:z', pod: { sendMessage: stub },
    })
    assert.equal(r.ok, false)
    assert.match(r.error, /items array required/)
  })

  it('rejects bad sourceDid', async () => {
    const r = await publishDeploy({
      items: [{ kind: 'config', itemId: 'autonomy', payload: 1 }],
      targetPubKey: 't', signingKey: {}, sourceDid: 'did:web:foo', pod: { sendMessage: stub },
    })
    assert.equal(r.ok, false)
    assert.match(r.error, /did:key URI/)
  })

  it('rejects malformed items', async () => {
    const { summary, privateKey } = await makeIdentity()
    const r = await publishDeploy({
      items: [{ kind: 'config' /* missing itemId */, payload: 1 }],
      targetPubKey: 't', signingKey: privateKey, sourceDid: summary.did, pod: { sendMessage: stub },
    })
    assert.equal(r.ok, false)
    assert.match(r.error, /malformed item/)
  })

  it('rejects items with missing payload', async () => {
    const { summary, privateKey } = await makeIdentity()
    const r = await publishDeploy({
      items: [{ kind: 'config', itemId: 'autonomy' /* no payload */ }],
      targetPubKey: 't', signingKey: privateKey, sourceDid: summary.did, pod: { sendMessage: stub },
    })
    assert.equal(r.ok, false)
    assert.match(r.error, /missing payload/)
  })

  it('reports send failure cleanly', async () => {
    const { summary, privateKey } = await makeIdentity()
    const r = await publishDeploy({
      items: [{ kind: 'config', itemId: 'autonomy', payload: 1 }],
      targetPubKey: 't',
      signingKey: privateKey,
      sourceDid: summary.did,
      pod: { sendMessage: async () => { throw new Error('peer down') } },
    })
    assert.equal(r.ok, false)
    assert.match(r.error, /send failed/)
    assert.match(r.error, /peer down/)
  })
})

// ── publishDeployToAll ───────────────────────────────────────────

describe('publishDeployToAll — fan-out', () => {
  it('publishes to multiple targets independently', async () => {
    const { summary, privateKey } = await makeIdentity()
    const sent = []
    const pod = { sendMessage: async (p, e) => { sent.push({ p, e }) } }
    const results = await publishDeployToAll({
      targets: ['p1', 'p2', 'p3'],
      publishOpts: {
        items: [{ kind: 'config', itemId: 'autonomy', payload: 1 }],
        signingKey: privateKey, sourceDid: summary.did, pod,
      },
    })
    assert.equal(results.length, 3)
    for (const r of results) assert.equal(r.ok, true)
    assert.equal(sent.length, 3)
  })

  it('a failure to one peer does not abort the others', async () => {
    const { summary, privateKey } = await makeIdentity()
    const pod = {
      sendMessage: async (peerId) => {
        if (peerId === 'p2') throw new Error('p2 unreachable')
      },
    }
    const results = await publishDeployToAll({
      targets: ['p1', 'p2', 'p3'],
      publishOpts: {
        items: [{ kind: 'config', itemId: 'autonomy', payload: 1 }],
        signingKey: privateKey, sourceDid: summary.did, pod,
      },
    })
    const byTarget = Object.fromEntries(results.map(r => [r.targetPubKey, r]))
    assert.equal(byTarget.p1.ok, true)
    assert.equal(byTarget.p2.ok, false)
    assert.match(byTarget.p2.error, /p2 unreachable/)
    assert.equal(byTarget.p3.ok, true)
  })

  it('empty targets list returns []', async () => {
    const r = await publishDeployToAll({ targets: [], publishOpts: {} })
    assert.deepEqual(r, [])
  })
})

// ── Source-side publish + target-side accept ─────────────────────

describe('round-trip: published package verifies on target side', () => {
  it('source signs → target verifies via resolveDidKey', async () => {
    const { summary, privateKey } = await makeIdentity()
    const sent = []
    const pod = { sendMessage: async (p, e) => { sent.push({ p, e }) } }
    const r = await publishDeploy({
      items: [{ kind: 'skill', itemId: 's1', payload: { files: { 'SKILL.md': '#' } } }],
      targetPubKey: 'target',
      manifestExtras: { sourceLabel: 'src' },
      signingKey: privateKey,
      sourceDid: summary.did,
      pod,
    })
    assert.equal(r.ok, true)
    const pkg = sent[0].e.package

    // Target side: resolve DID, verify
    const pubKey = await resolveDidKey(summary.did)
    const verify = await verifySignedPackage(pkg, pubKey)
    assert.equal(verify.ok, true)
  })
})
