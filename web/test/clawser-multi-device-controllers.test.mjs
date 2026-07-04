// clawser-multi-device-controllers.test.mjs

import { describe, it, beforeEach } from 'node:test'
import assert from 'node:assert/strict'

import {
  buildMyDevicesController,
  buildTrustedPublishersController,
} from '../clawser-multi-device-controllers.mjs'
import { PairedDevicesStore } from '../clawser-paired-devices.mjs'

const memStorage = () => {
  const m = new Map()
  return { async read(n) { return m.has(n) ? m.get(n) : null }, async write(n, v) { m.set(n, v) } }
}

// ── My Devices controller ────────────────────────────────────────

describe('buildMyDevicesController — onPairNew', () => {
  it('opens the pair modal with a generator that uses the active identity', async () => {
    const opens = []
    const ctrl = buildMyDevicesController({
      state: {
        identityManager: {
          getDefault: () => ({ podId: 'pod1' }),
          export: async () => ({ kty: 'OKP' }),
        },
      },
      showPairModal: async (opts) => { opens.push(opts); return null },
    })
    await ctrl.onPairNew()
    assert.equal(opens.length, 1)
    assert.equal(typeof opens[0].generatePayload, 'function')
    const payload = await opens[0].generatePayload()
    assert.match(payload, /CLAWSER-PAIR:/)
    assert.match(payload, /Code: \d{6}/)
  })

  it('reports gracefully when no active identity exists', async () => {
    const captured = []
    const ctrl = buildMyDevicesController({
      state: { identityManager: null },
      showPairModal: async (opts) => { captured.push(await opts.generatePayload()) },
    })
    await ctrl.onPairNew()
    assert.match(captured[0], /no active identity/)
  })
})

describe('buildMyDevicesController — onToggleSync', () => {
  it('updates the device entry with syncEnabled', async () => {
    const pairedDevices = new PairedDevicesStore(memStorage())
    await pairedDevices.add({ deviceId: 'd1', label: 'Phone' })
    const ctrl = buildMyDevicesController({ state: { pairedDevices } })
    assert.equal(await ctrl.onToggleSync('d1', true), true)
    const entry = await pairedDevices.get('d1')
    assert.equal(entry.syncEnabled, true)
    await ctrl.onToggleSync('d1', false)
    const after = await pairedDevices.get('d1')
    assert.equal(after.syncEnabled, false)
  })

  it('returns false when device is missing', async () => {
    const pairedDevices = new PairedDevicesStore(memStorage())
    const ctrl = buildMyDevicesController({ state: { pairedDevices } })
    assert.equal(await ctrl.onToggleSync('nope', true), false)
  })

  it('returns false when no pairedDevices store', async () => {
    const ctrl = buildMyDevicesController({ state: {} })
    assert.equal(await ctrl.onToggleSync('d1', true), false)
  })
})

describe('buildMyDevicesController — onUnpair', () => {
  it('confirms then removes the device', async () => {
    const pairedDevices = new PairedDevicesStore(memStorage())
    await pairedDevices.add({ deviceId: 'd1' })
    const ctrl = buildMyDevicesController({
      state: { pairedDevices },
      confirm: async () => true,
    })
    assert.equal(await ctrl.onUnpair('d1'), true)
    assert.equal(await pairedDevices.get('d1'), null)
  })

  it('aborts on confirm=false', async () => {
    const pairedDevices = new PairedDevicesStore(memStorage())
    await pairedDevices.add({ deviceId: 'd1' })
    const ctrl = buildMyDevicesController({
      state: { pairedDevices },
      confirm: async () => false,
    })
    assert.equal(await ctrl.onUnpair('d1'), false)
    assert.notEqual(await pairedDevices.get('d1'), null)
  })

  it('returns false on unknown device', async () => {
    const pairedDevices = new PairedDevicesStore(memStorage())
    const ctrl = buildMyDevicesController({ state: { pairedDevices }, confirm: async () => true })
    assert.equal(await ctrl.onUnpair('nope'), false)
  })
})

describe('buildMyDevicesController — onDeployNow', () => {
  async function buildIdentity() {
    const kp = await crypto.subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify'])
    return { privateKey: kp.privateKey, publicKey: kp.publicKey }
  }

  it('happy path: picker → publishDeploy succeeds', async () => {
    const pairedDevices = new PairedDevicesStore(memStorage())
    await pairedDevices.add({ deviceId: 'd1', label: 'Mac', peerPublicKey: 'pk_mac' })
    const sent = []
    const pod = { sendMessage: async (peer, env) => { sent.push({ peer, env }) } }
    const id = await buildIdentity()
    const pickedItems = [{ kind: 'config', itemId: 'autonomy', payload: { level: 5 } }]
    const ctrl = buildMyDevicesController({
      state: { pairedDevices, pod },
      showPickerModalFn: async () => ({
        items: pickedItems,
        manifest: { sourceLabel: 'src', items: pickedItems.map(i => ({ kind: i.kind, itemId: i.itemId })), capabilities: { config: ['autonomy'] }, createdAt: 1 },
      }),
      getSigningKey: async () => id.privateKey,
      getSourceDid: () => 'did:key:z6MkSrc',
      resolveItems: async () => ({ skills: [], configs: [pickedItems[0]], memory: [] }),
    })
    const r = await ctrl.onDeployNow('d1')
    assert.equal(r.ok, true)
    assert.equal(sent.length, 1)
    assert.equal(sent[0].peer, 'pk_mac')
    assert.equal(sent[0].env.type, 'deploy')
    // recordSync called → lastSyncAt updated
    const after = await pairedDevices.get('d1')
    assert.equal(typeof after.lastSyncAt, 'number')
  })

  it('cancelled picker returns ok:false / cancelled', async () => {
    const pairedDevices = new PairedDevicesStore(memStorage())
    await pairedDevices.add({ deviceId: 'd1', peerPublicKey: 'pk' })
    const ctrl = buildMyDevicesController({
      state: { pairedDevices, pod: { sendMessage: async () => {} } },
      showPickerModalFn: async () => null,  // user cancelled
      getSigningKey: async () => null,
      getSourceDid: () => 'did:key:z',
      resolveItems: async () => ({ skills: [], configs: [], memory: [] }),
    })
    const r = await ctrl.onDeployNow('d1')
    assert.equal(r.ok, false)
    assert.match(r.error, /cancelled/)
  })

  it('reports missing peer key', async () => {
    const pairedDevices = new PairedDevicesStore(memStorage())
    await pairedDevices.add({ deviceId: 'd1', label: 'Half-paired' })
    const ctrl = buildMyDevicesController({
      state: { pairedDevices, pod: { sendMessage: async () => {} } },
    })
    const r = await ctrl.onDeployNow('d1')
    assert.equal(r.ok, false)
    assert.match(r.error, /peerPublicKey/)
  })

  it('reports unknown device', async () => {
    const pairedDevices = new PairedDevicesStore(memStorage())
    const ctrl = buildMyDevicesController({ state: { pairedDevices, pod: { sendMessage: async () => {} } } })
    const r = await ctrl.onDeployNow('nope')
    assert.equal(r.ok, false)
    assert.match(r.error, /not found/)
  })
})

// ── Trusted Publishers controller ────────────────────────────────

describe('buildTrustedPublishersController', () => {
  function makeState() {
    const acl = {
      _list: [],
      list: async () => acl._list.slice(),
      isTrusted: async (s) => acl._list.some(e => e.source === s && !e.revokedAt),
      grant: async (s, label) => {
        const existing = acl._list.find(e => e.source === s)
        if (existing) { existing.revokedAt = null; if (label) existing.label = label }
        else acl._list.push({ source: s, label: label || null, addedAt: 1, revokedAt: null })
      },
      revoke: async (s) => {
        const e = acl._list.find(e => e.source === s)
        if (!e) return false
        e.revokedAt = Date.now(); return true
      },
    }
    const approvals = {
      _list: [],
      revoke: async (s, h) => {
        const i = approvals._list.findIndex(a => a.source === s && a.manifestHash === h)
        if (i < 0) return false
        approvals._list.splice(i, 1); return true
      },
    }
    const snapshots = {
      restore: async (eventId) => {
        if (eventId === 'evt-good') return { source: 'did:key:z', snapshotId: 'snap-1' }
        throw new Error(`No snapshot for ${eventId}`)
      },
    }
    return { state: { deployTarget: { deployAcl: acl, deployApprovals: approvals, deploySnapshots: snapshots } }, acl, approvals, snapshots }
  }

  it('onRevokeSource confirms, then revokes', async () => {
    const { state, acl } = makeState()
    await acl.grant('did:key:z6MkAlice')
    const ctrl = buildTrustedPublishersController({ state, confirm: async () => true })
    assert.equal(await ctrl.onRevokeSource('did:key:z6MkAlice'), true)
    assert.equal(await acl.isTrusted('did:key:z6MkAlice'), false)
  })

  it('onRevokeSource bails on confirm=false', async () => {
    const { state, acl } = makeState()
    await acl.grant('did:key:z6MkAlice')
    const ctrl = buildTrustedPublishersController({ state, confirm: async () => false })
    assert.equal(await ctrl.onRevokeSource('did:key:z6MkAlice'), false)
    assert.equal(await acl.isTrusted('did:key:z6MkAlice'), true)
  })

  it('onRetrustSource re-grants without confirm', async () => {
    const { state, acl } = makeState()
    await acl.grant('did:key:z6MkAlice', 'Alice')
    await acl.revoke('did:key:z6MkAlice')
    const ctrl = buildTrustedPublishersController({ state, confirm: async () => false /* should be ignored */ })
    await ctrl.onRetrustSource('did:key:z6MkAlice')
    assert.equal(await acl.isTrusted('did:key:z6MkAlice'), true)
  })

  it('onRevokeApproval confirms then revokes', async () => {
    const { state, approvals } = makeState()
    approvals._list.push({ source: 'did:key:z', manifestHash: 'abcd' })
    const ctrl = buildTrustedPublishersController({ state, confirm: async () => true })
    assert.equal(await ctrl.onRevokeApproval('did:key:z', 'abcd'), true)
    assert.equal(approvals._list.length, 0)
  })

  it('onRollback confirms then restores; returns ok with snapshotId', async () => {
    const { state } = makeState()
    const ctrl = buildTrustedPublishersController({ state, confirm: async () => true })
    const r = await ctrl.onRollback('evt-good')
    assert.equal(r.ok, true)
    assert.equal(r.restored.snapshotId, 'snap-1')
  })

  it('onRollback bails on confirm=false', async () => {
    const { state } = makeState()
    const ctrl = buildTrustedPublishersController({ state, confirm: async () => false })
    const r = await ctrl.onRollback('evt-good')
    assert.equal(r.ok, false)
    assert.match(r.error, /cancelled/)
  })

  it('onRollback reports a clean error on snapshot miss', async () => {
    const { state } = makeState()
    const ctrl = buildTrustedPublishersController({ state, confirm: async () => true })
    const r = await ctrl.onRollback('evt-missing')
    assert.equal(r.ok, false)
    assert.match(r.error, /No snapshot/)
  })
})
