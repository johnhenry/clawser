// clawser-multi-device-wiring.test.mjs — end-to-end wiring of the
// per-workspace sync + deploy services through pod.onMessage.

import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

import {
  installMultiDeviceWiring,
  uninstallMultiDeviceWiring,
} from '../clawser-multi-device.mjs'
import { buildSignedPackage } from '../clawser-deploy-package.mjs'

const enc = new TextEncoder()

// ── helpers ───────────────────────────────────────────────────────

function makePod() {
  const handlers = []
  return {
    onMessage(h) {
      handlers.push(h)
      return () => { const i = handlers.indexOf(h); if (i >= 0) handlers.splice(i, 1) }
    },
    _deliver(envelope, fromPeerId = 'peerA', meta = { sessionId: 's', transport: 'mock' }) {
      return Promise.all(handlers.map(h => h(envelope, fromPeerId, meta)))
    },
    _handlerCount() { return handlers.length },
  }
}

function makeState() { return {} }

async function genIdentity() {
  return crypto.subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify'])
}

const FAKE_DID = 'did:key:z6MkTestSubject'

// ── installMultiDeviceWiring ──────────────────────────────────────

describe('installMultiDeviceWiring — installs per-workspace services on state', () => {
  it('populates state.syncFlags, state.deployTarget; subscribes to pod.onMessage', () => {
    const pod = makePod()
    const state = makeState()
    const ctx = installMultiDeviceWiring({ pod, state, wsId: 'default' })
    assert.ok(state.syncFlags, 'state.syncFlags must be set')
    assert.ok(state.deployTarget, 'state.deployTarget must be set')
    assert.equal(state.deployTarget.syncFlags, ctx.syncFlags)
    assert.equal(pod._handlerCount(), 1, 'must register exactly one onMessage handler')
  })

  it('rejects bad inputs', () => {
    assert.throws(() => installMultiDeviceWiring({}), /pod with onMessage required/)
    assert.throws(() => installMultiDeviceWiring({ pod: makePod() }), /state required/)
    assert.throws(() => installMultiDeviceWiring({ pod: makePod(), state: {} }), /wsId required/)
  })
})

// ── uninstallMultiDeviceWiring ────────────────────────────────────

describe('uninstallMultiDeviceWiring — clears state and unsubscribes', () => {
  it('clears state.syncFlags + state.deployTarget; removes the pod handler', () => {
    const pod = makePod()
    const state = makeState()
    installMultiDeviceWiring({ pod, state, wsId: 'default' })
    assert.equal(pod._handlerCount(), 1)
    uninstallMultiDeviceWiring(state)
    assert.equal(state.syncFlags, null)
    assert.equal(state.deployTarget, null)
    assert.equal(pod._handlerCount(), 0)
  })

  it('idempotent on a fresh state', () => {
    uninstallMultiDeviceWiring({})
    uninstallMultiDeviceWiring(null)
    uninstallMultiDeviceWiring(undefined)
    // No throw
  })
})

// ── inbound dispatch ──────────────────────────────────────────────

describe('Inbound dispatcher routes by envelope.type', () => {
  it('"sync" envelopes hit syncEngine.handleIncoming', async () => {
    const pod = makePod()
    const state = makeState()
    const seen = []
    const syncEngine = {
      handleIncoming: async (env) => { seen.push(env); return { ok: true, applied: [env.itemId] } },
    }
    installMultiDeviceWiring({ pod, state, wsId: 'default', syncEngine })
    await pod._deliver({
      type: 'sync', kind: 'lww', itemId: 'apikey-openai', payload: 'sk-1',
      ts: 1, source: 'peerA',
    })
    assert.equal(seen.length, 1)
    assert.equal(seen[0].kind, 'lww')
    assert.equal(seen[0].itemId, 'apikey-openai')
  })

  it('"deploy" envelopes flow through acceptPackage and write the audit log', async () => {
    const pod = makePod()
    const state = makeState()
    const { privateKey, publicKey } = await genIdentity()
    const pkg = await buildSignedPackage({
      source: FAKE_DID, privateKey, counter: 1,
      manifest: {
        sourceLabel: 'Mac',
        items: [{ kind: 'skill', itemId: 's1' }],
        capabilities: { fs: ['/tmp/'] },
        createdAt: 1,
      },
      payloads: { s1: enc.encode('skill-bytes') },
    })
    let captured = null
    const applyTransport = {
      applyBatch: async (items) => { captured = items; return { ok: true, applied: items.map(i => i.itemId), snapshotId: 'snap-1' } },
    }
    installMultiDeviceWiring({
      pod, state, wsId: 'default',
      resolvePublicKey: async () => publicKey,
      promptApprove: async () => true,
      applyTransport,
    })
    // Trust the source first
    await state.deployTarget.deployAcl.grant(FAKE_DID, 'My Mac')

    await pod._deliver({ type: 'deploy', package: pkg })
    // Wait one microtask for the dispatcher to finish
    await new Promise(r => setTimeout(r, 5))

    assert.ok(captured, 'applyBatch should have been called via the dispatcher')
    assert.equal(captured.length, 1)
    assert.equal(captured[0].itemId, 's1')

    const events = await state.deployTarget.deployAudit.list()
    assert.ok(events.length >= 1, 'audit log should have at least one entry')
    assert.equal(events[0].source, FAKE_DID)
    assert.equal(events[0].status, 'applied')
  })

  it('untrusted source → audit logs rejection, applyTransport not called', async () => {
    const pod = makePod()
    const state = makeState()
    const { privateKey, publicKey } = await genIdentity()
    const pkg = await buildSignedPackage({
      source: FAKE_DID, privateKey, counter: 1,
      manifest: {
        items: [{ kind: 'skill', itemId: 's1' }],
        capabilities: {},
        createdAt: 1,
      },
      payloads: { s1: enc.encode('x') },
    })
    let applyCalls = 0
    installMultiDeviceWiring({
      pod, state, wsId: 'default',
      resolvePublicKey: async () => publicKey,
      promptApprove: async () => true,
      applyTransport: { applyBatch: async () => { applyCalls++; return { ok: true, applied: [] } } },
    })
    // No grant — source is untrusted

    await pod._deliver({ type: 'deploy', package: pkg })
    await new Promise(r => setTimeout(r, 5))

    assert.equal(applyCalls, 0, 'applyTransport must not be called for untrusted source')
    const events = await state.deployTarget.deployAudit.list()
    assert.ok(events.length >= 1)
    assert.equal(events[0].status, 'rejected')
    assert.match(events[0].error, /not trusted/)
  })

  it('non-sync, non-deploy envelopes are ignored', async () => {
    const pod = makePod()
    const state = makeState()
    const seen = []
    installMultiDeviceWiring({
      pod, state, wsId: 'default',
      syncEngine: { handleIncoming: async (e) => seen.push(e) },
    })
    await pod._deliver({ type: 'unrelated', payload: 'whatever' })
    assert.equal(seen.length, 0, 'unknown envelope types must not trigger any handler')
  })

  it('malformed envelopes are ignored (defense)', async () => {
    const pod = makePod()
    const state = makeState()
    installMultiDeviceWiring({ pod, state, wsId: 'default' })
    await pod._deliver(null)
    await pod._deliver(undefined)
    await pod._deliver('string-instead-of-object')
    // No throw, no audit-log entry expected
    const events = await state.deployTarget.deployAudit.list()
    assert.equal(events.length, 0)
  })
})

// ── per-workspace isolation ───────────────────────────────────────

describe('Per-workspace isolation: two wsIds get independent flag/ACL state', () => {
  it('flags set in wsA do not appear in wsB', async () => {
    // Each install builds its own SyncFlags backed by the in-memory
    // fallback (since the test env has no OPFS). Flag flips don't
    // bleed across workspaces.
    const pod = makePod()
    const stateA = {}
    const stateB = {}
    installMultiDeviceWiring({ pod, state: stateA, wsId: 'wsA' })
    installMultiDeviceWiring({ pod, state: stateB, wsId: 'wsB' })
    await stateA.syncFlags.setFlag('skill:my-skill', true)
    assert.equal(await stateA.syncFlags.isFlagged('skill:my-skill'), true)
    assert.equal(await stateB.syncFlags.isFlagged('skill:my-skill'), false,
      'wsB must NOT see flags set in wsA')
  })

  it('deploy ACL grants in wsA do not extend to wsB', async () => {
    const pod = makePod()
    const stateA = {}; const stateB = {}
    installMultiDeviceWiring({ pod, state: stateA, wsId: 'wsA' })
    installMultiDeviceWiring({ pod, state: stateB, wsId: 'wsB' })
    await stateA.deployTarget.deployAcl.grant('did:key:z6MkSomeone')
    assert.equal(await stateA.deployTarget.deployAcl.isTrusted('did:key:z6MkSomeone'), true)
    assert.equal(await stateB.deployTarget.deployAcl.isTrusted('did:key:z6MkSomeone'), false,
      'a trust in wsA must not transfer to wsB')
  })
})
