// clawser-deploy-target.test.mjs

import { describe, it, beforeEach } from 'node:test'
import assert from 'node:assert/strict'

import {
  DeployAcl,
  DeployApprovals,
  DeployAuditLog,
  DeploySnapshotRing,
  buildCapabilityToken,
  enforceCapabilityRequest,
  CapabilityDeniedError,
  acceptPackage,
} from '../clawser-deploy-target.mjs'
import {
  buildSignedPackage,
  verifySignedPackage,
  ReplayCounterTracker,
} from '../clawser-deploy-package.mjs'

const enc = new TextEncoder()
const memStorage = () => {
  const map = new Map()
  return { async read(k) { return map.has(k) ? map.get(k) : null }, async write(k, v) { map.set(k, v) } }
}

// ── B.1 ACL ────────────────────────────────────────────────────────

describe('DeployAcl', () => {
  let acl
  beforeEach(() => { acl = new DeployAcl(memStorage()) })

  it('starts empty', async () => {
    assert.equal(await acl.isTrusted('did:foo'), false)
    assert.deepEqual(await acl.list(), [])
  })

  it('grant and isTrusted', async () => {
    await acl.grant('did:foo', 'My phone')
    assert.equal(await acl.isTrusted('did:foo'), true)
    const list = await acl.list()
    assert.equal(list.length, 1)
    assert.equal(list[0].label, 'My phone')
  })

  it('grant of an existing source updates label and clears revoke', async () => {
    await acl.grant('did:foo', 'Old')
    await acl.revoke('did:foo')
    assert.equal(await acl.isTrusted('did:foo'), false)
    await acl.grant('did:foo', 'New')
    assert.equal(await acl.isTrusted('did:foo'), true)
    assert.equal((await acl.list())[0].label, 'New')
  })

  it('revoke flips trust', async () => {
    await acl.grant('did:foo')
    assert.equal(await acl.revoke('did:foo'), true)
    assert.equal(await acl.isTrusted('did:foo'), false)
  })

  it('revoke unknown source is a no-op', async () => {
    assert.equal(await acl.revoke('did:nobody'), false)
  })
})

// ── B.1 Approvals ─────────────────────────────────────────────────

describe('DeployApprovals', () => {
  let approvals
  beforeEach(() => { approvals = new DeployApprovals(memStorage()) })

  it('first call returns false; approve makes subsequent true', async () => {
    assert.equal(await approvals.isApproved('did:1', 'h1'), false)
    await approvals.approve('did:1', 'h1')
    assert.equal(await approvals.isApproved('did:1', 'h1'), true)
  })

  it('different hash needs separate approval', async () => {
    await approvals.approve('did:1', 'h1')
    assert.equal(await approvals.isApproved('did:1', 'h2'), false)
  })

  it('approve is idempotent', async () => {
    await approvals.approve('did:1', 'h1')
    await approvals.approve('did:1', 'h1')
    const list = await approvals.list()
    assert.equal(list.length, 1)
  })

  it('revoke removes it', async () => {
    await approvals.approve('did:1', 'h1')
    assert.equal(await approvals.revoke('did:1', 'h1'), true)
    assert.equal(await approvals.isApproved('did:1', 'h1'), false)
  })
})

// ── B.2 Capability tokens ────────────────────────────────────────

describe('buildCapabilityToken / enforceCapabilityRequest', () => {
  const tok = buildCapabilityToken({ capabilities: { fs: ['/tmp/'], net: ['*.example.com', 'api.foo.io'], mesh: ['mesh:peer-list'] } })

  it('fs: allows prefix match', () => {
    enforceCapabilityRequest(tok, { kind: 'fs', target: '/tmp/foo.txt' })
  })
  it('fs: rejects unmatched path', () => {
    assert.throws(() => enforceCapabilityRequest(tok, { kind: 'fs', target: '/etc/passwd' }), CapabilityDeniedError)
  })
  it('net: exact host match', () => {
    enforceCapabilityRequest(tok, { kind: 'net', target: 'api.foo.io' })
  })
  it('net: wildcard suffix match', () => {
    enforceCapabilityRequest(tok, { kind: 'net', target: 'a.example.com' })
    enforceCapabilityRequest(tok, { kind: 'net', target: 'sub.deep.example.com' })
  })
  it('net: wildcard does NOT match the bare suffix', () => {
    assert.throws(
      () => enforceCapabilityRequest(tok, { kind: 'net', target: 'example.com' }),
      CapabilityDeniedError,
    )
  })
  it('net: rejects unknown host', () => {
    assert.throws(() => enforceCapabilityRequest(tok, { kind: 'net', target: 'evil.com' }), CapabilityDeniedError)
  })
  it('mesh: exact-string match', () => {
    enforceCapabilityRequest(tok, { kind: 'mesh', target: 'mesh:peer-list' })
    assert.throws(() => enforceCapabilityRequest(tok, { kind: 'mesh', target: 'mesh:other' }), CapabilityDeniedError)
  })
  it('rejects unknown kind', () => {
    assert.throws(() => enforceCapabilityRequest(tok, { kind: 'gpu', target: 'x' }), CapabilityDeniedError)
  })
  it('rejects null token', () => {
    assert.throws(() => enforceCapabilityRequest(null, { kind: 'fs', target: '/' }), CapabilityDeniedError)
  })
})

// ── B.3 Audit log ─────────────────────────────────────────────────

describe('DeployAuditLog', () => {
  let log
  beforeEach(() => { log = new DeployAuditLog(memStorage(), { cap: 5 }) })

  it('appends entries with id + timestamp', async () => {
    const e = await log.append({ source: 'did:1', items: [], status: 'applied' })
    assert.match(e.id, /^evt-/)
    assert.equal(typeof e.timestamp, 'number')
  })

  it('list returns most-recent-first', async () => {
    for (let i = 0; i < 3; i++) await log.append({ source: 'did:1', items: [], status: 'applied', n: i })
    const arr = await log.list()
    assert.equal(arr[0].n, 2)
    assert.equal(arr[2].n, 0)
  })

  it('caps at the configured size (drops oldest)', async () => {
    for (let i = 0; i < 8; i++) await log.append({ source: 'did:1', items: [], status: 'applied', n: i })
    const arr = await log.list({ limit: 100 })
    assert.equal(arr.length, 5)
    assert.equal(arr[arr.length - 1].n, 3) // oldest kept = #3
  })

  it('list filters by source', async () => {
    await log.append({ source: 'did:a', items: [], status: 'applied' })
    await log.append({ source: 'did:b', items: [], status: 'applied' })
    const a = await log.list({ sourceFilter: 'did:a' })
    assert.equal(a.length, 1)
    assert.equal(a[0].source, 'did:a')
  })
})

// ── B.4 Snapshot ring ─────────────────────────────────────────────

describe('DeploySnapshotRing', () => {
  it('records and prunes per-source', async () => {
    const deleted = []
    const driver = {
      delete: async (id) => { deleted.push(id) },
      restore: async () => {},
    }
    const ring = new DeploySnapshotRing(memStorage(), driver, 3)
    for (let i = 0; i < 6; i++) {
      await ring.record('did:1', `evt-${i}`, `snap-${i}`)
    }
    const list = await ring.listFor('did:1')
    assert.equal(list.length, 3)
    assert.deepEqual(list.map(e => e.eventId), ['evt-3', 'evt-4', 'evt-5'])
    assert.deepEqual(deleted, ['snap-0', 'snap-1', 'snap-2'])
  })

  it('per-source rings are independent', async () => {
    const ring = new DeploySnapshotRing(memStorage(), { delete: async () => {}, restore: async () => {} }, 3)
    await ring.record('did:1', 'a', 's1')
    await ring.record('did:2', 'b', 's2')
    assert.equal((await ring.listFor('did:1'))[0].eventId, 'a')
    assert.equal((await ring.listFor('did:2'))[0].eventId, 'b')
  })

  it('findByEvent locates an event across sources', async () => {
    const ring = new DeploySnapshotRing(memStorage(), { delete: async () => {}, restore: async () => {} }, 3)
    await ring.record('did:1', 'evt-x', 'snap-x')
    const found = await ring.findByEvent('evt-x')
    assert.equal(found.source, 'did:1')
    assert.equal(found.snapshotId, 'snap-x')
  })

  it('restore calls the driver', async () => {
    const restored = []
    const driver = { restore: async (id) => { restored.push(id) }, delete: async () => {} }
    const ring = new DeploySnapshotRing(memStorage(), driver, 3)
    await ring.record('did:1', 'evt-x', 'snap-x')
    await ring.restore('evt-x')
    assert.deepEqual(restored, ['snap-x'])
  })

  it('restore throws when event id is unknown', async () => {
    const ring = new DeploySnapshotRing(memStorage(), { delete: async () => {}, restore: async () => {} })
    await assert.rejects(() => ring.restore('evt-nope'), /No snapshot/)
  })
})

// ── End-to-end acceptPackage ──────────────────────────────────────

async function genId() {
  const kp = await crypto.subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify'])
  return kp
}

function makeApplyTransport(snapshotId = 'snap-1') {
  const captured = []
  return {
    captured,
    snapshotId,
    applyBatch: async (items) => {
      captured.push(items)
      return { ok: true, applied: items.map(i => i.itemId), snapshotId }
    },
  }
}

async function makeCtx({ acl = true, prePromptApprove = null, applyOk = true } = {}) {
  const storage = memStorage()
  const aclMod = new DeployAcl(storage)
  const approvals = new DeployApprovals(storage)
  const audit = new DeployAuditLog(storage, { cap: 100 })
  const snapDriver = { delete: async () => {}, restore: async () => {} }
  const snapshots = new DeploySnapshotRing(storage, snapDriver, 5)
  const replay = new ReplayCounterTracker(storage)
  const applyTransport = applyOk
    ? makeApplyTransport()
    : { applyBatch: async () => ({ ok: false, rolledBack: true, error: 'staged crash', snapshotId: 'snap-fail' }) }

  return {
    storage, aclMod, approvals, audit, snapshots, replay, applyTransport,
    ctx: {
      packageVerifier: { verifySignedPackage },
      replay,
      acl: aclMod,
      approvals,
      audit,
      snapshots,
      applyTransport,
      resolvePublicKey: null, // set per-test
      promptApprove: prePromptApprove,
    },
    grantAcl: async (did) => acl ? aclMod.grant(did) : null,
  }
}

describe('acceptPackage — end-to-end', () => {
  it('happy path: trusted source, first manifest, prompt approves, applies', async () => {
    const { privateKey, publicKey } = await genId()
    const did = 'did:key:z6Mktest'
    const pkg = await buildSignedPackage({
      source: did, privateKey, counter: 1,
      manifest: { sourceLabel: 'Mac', items: [{ kind: 'skill', itemId: 's1' }], capabilities: { fs: ['/tmp/'] }, createdAt: 1 },
      payloads: { s1: enc.encode('payload') },
    })

    const setup = await makeCtx({ prePromptApprove: async () => true })
    setup.ctx.resolvePublicKey = async () => publicKey
    await setup.grantAcl(did)
    const r = await acceptPackage(pkg, setup.ctx)
    assert.equal(r.ok, true)
    assert.deepEqual(r.applied, ['s1'])

    // Audit log captured the event
    const entries = await setup.audit.list()
    assert.equal(entries[0].status, 'applied')
    // Snapshot ring recorded the event
    const ring = await setup.snapshots.listFor(did)
    assert.equal(ring.length, 1)
  })

  it('rejects when source is not trusted', async () => {
    const { privateKey, publicKey } = await genId()
    const did = 'did:key:z6MkUntrusted'
    const pkg = await buildSignedPackage({
      source: did, privateKey, counter: 1,
      manifest: { items: [{ kind: 'skill', itemId: 's1' }], capabilities: {}, createdAt: 1 },
      payloads: { s1: enc.encode('p') },
    })
    const setup = await makeCtx({ acl: false })
    setup.ctx.resolvePublicKey = async () => publicKey
    const r = await acceptPackage(pkg, setup.ctx)
    assert.equal(r.ok, false)
    assert.match(r.rejected, /not trusted/)
    const entries = await setup.audit.list()
    assert.equal(entries[0].status, 'rejected')
  })

  it('rejects on signature mismatch', async () => {
    const { privateKey } = await genId()
    const { publicKey: wrong } = await genId()
    const did = 'did:key:z6MkA'
    const pkg = await buildSignedPackage({
      source: did, privateKey, counter: 1,
      manifest: { items: [{ kind: 'skill', itemId: 's1' }], capabilities: {}, createdAt: 1 },
      payloads: { s1: enc.encode('p') },
    })
    const setup = await makeCtx()
    setup.ctx.resolvePublicKey = async () => wrong
    await setup.grantAcl(did)
    const r = await acceptPackage(pkg, setup.ctx)
    assert.equal(r.ok, false)
    assert.match(r.rejected, /signature/)
  })

  it('rejects on replay (same counter twice)', async () => {
    const { privateKey, publicKey } = await genId()
    const did = 'did:key:z6MkA'
    const pkg = await buildSignedPackage({
      source: did, privateKey, counter: 1,
      manifest: { items: [{ kind: 'skill', itemId: 's1' }], capabilities: {}, createdAt: 1 },
      payloads: { s1: enc.encode('p') },
    })
    const setup = await makeCtx({ prePromptApprove: async () => true })
    setup.ctx.resolvePublicKey = async () => publicKey
    await setup.grantAcl(did)

    const r1 = await acceptPackage(pkg, setup.ctx)
    assert.equal(r1.ok, true)
    const r2 = await acceptPackage(pkg, setup.ctx)
    assert.equal(r2.ok, false)
    assert.match(r2.rejected, /replay/)
  })

  it('first manifest needs approval; second deploy with same hash auto-applies', async () => {
    const { privateKey, publicKey } = await genId()
    const did = 'did:key:z6MkA'
    let promptCalls = 0
    const setup = await makeCtx({ prePromptApprove: async () => { promptCalls++; return true } })
    setup.ctx.resolvePublicKey = async () => publicKey
    await setup.grantAcl(did)

    const buildPkg = (counter) => buildSignedPackage({
      source: did, privateKey, counter,
      manifest: { items: [{ kind: 'skill', itemId: 's1' }], capabilities: {}, createdAt: 1 },
      payloads: { s1: enc.encode('p') },
    })

    await acceptPackage(await buildPkg(1), setup.ctx)
    await acceptPackage(await buildPkg(2), setup.ctx)
    assert.equal(promptCalls, 1, 'second deploy with same manifest hash should not re-prompt')
  })

  it('manifest change re-prompts', async () => {
    const { privateKey, publicKey } = await genId()
    const did = 'did:key:z6MkA'
    let prompted = []
    const setup = await makeCtx({
      prePromptApprove: async (req) => { prompted.push(req.manifestHash); return true },
    })
    setup.ctx.resolvePublicKey = async () => publicKey
    await setup.grantAcl(did)

    const pkgA = await buildSignedPackage({
      source: did, privateKey, counter: 1,
      manifest: { items: [{ kind: 'skill', itemId: 's1' }], capabilities: { fs: [] }, createdAt: 1 },
      payloads: { s1: enc.encode('p') },
    })
    const pkgB = await buildSignedPackage({
      source: did, privateKey, counter: 2,
      manifest: { items: [{ kind: 'skill', itemId: 's1' }], capabilities: { fs: ['/tmp/'] }, createdAt: 1 }, // different caps → different hash
      payloads: { s1: enc.encode('p') },
    })
    await acceptPackage(pkgA, setup.ctx)
    await acceptPackage(pkgB, setup.ctx)
    assert.equal(prompted.length, 2)
    assert.notEqual(prompted[0], prompted[1])
  })

  it('rejects when no prompt configured and manifest is unapproved', async () => {
    const { privateKey, publicKey } = await genId()
    const did = 'did:key:z6MkA'
    const pkg = await buildSignedPackage({
      source: did, privateKey, counter: 1,
      manifest: { items: [{ kind: 'skill', itemId: 's1' }], capabilities: {}, createdAt: 1 },
      payloads: { s1: enc.encode('p') },
    })
    const setup = await makeCtx() // no promptApprove
    setup.ctx.resolvePublicKey = async () => publicKey
    await setup.grantAcl(did)
    const r = await acceptPackage(pkg, setup.ctx)
    assert.equal(r.ok, false)
    assert.match(r.rejected, /not approved/)
  })

  it('user-rejected prompt records rejection', async () => {
    const { privateKey, publicKey } = await genId()
    const did = 'did:key:z6MkA'
    const setup = await makeCtx({ prePromptApprove: async () => false })
    setup.ctx.resolvePublicKey = async () => publicKey
    await setup.grantAcl(did)
    const pkg = await buildSignedPackage({
      source: did, privateKey, counter: 1,
      manifest: { items: [{ kind: 'skill', itemId: 's1' }], capabilities: {}, createdAt: 1 },
      payloads: { s1: enc.encode('p') },
    })
    const r = await acceptPackage(pkg, setup.ctx)
    assert.equal(r.ok, false)
    assert.match(r.rejected, /user rejected/)
  })

  it('records snapshot id with the audit event so rollback can find it', async () => {
    const { privateKey, publicKey } = await genId()
    const did = 'did:key:z6MkA'
    const setup = await makeCtx({ prePromptApprove: async () => true })
    setup.ctx.resolvePublicKey = async () => publicKey
    await setup.grantAcl(did)
    const pkg = await buildSignedPackage({
      source: did, privateKey, counter: 1,
      manifest: { items: [{ kind: 'skill', itemId: 's1' }], capabilities: {}, createdAt: 1 },
      payloads: { s1: enc.encode('p') },
    })
    const r = await acceptPackage(pkg, setup.ctx)
    const found = await setup.snapshots.findByEvent(r.eventId)
    assert.equal(found.snapshotId, 'snap-1')
    assert.equal(found.source, did)
  })

  it('apply failure → audit reflects rolled-back status', async () => {
    const { privateKey, publicKey } = await genId()
    const did = 'did:key:z6MkA'
    const setup = await makeCtx({ prePromptApprove: async () => true, applyOk: false })
    setup.ctx.resolvePublicKey = async () => publicKey
    await setup.grantAcl(did)
    const pkg = await buildSignedPackage({
      source: did, privateKey, counter: 1,
      manifest: { items: [{ kind: 'skill', itemId: 's1' }], capabilities: {}, createdAt: 1 },
      payloads: { s1: enc.encode('p') },
    })
    const r = await acceptPackage(pkg, setup.ctx)
    assert.equal(r.ok, false)
    const entries = await setup.audit.list()
    assert.equal(entries[0].status, 'rolled-back')
  })
})
