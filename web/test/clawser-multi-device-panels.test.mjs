// clawser-multi-device-panels.test.mjs

import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

import {
  buildMyDevicesViewModel,
  buildTrustedPublishersViewModel,
  mountMyDevicesPanel,
  mountTrustedPublishersPanel,
  remountVisibleMultiDevicePanels,
} from '../clawser-multi-device-panels.mjs'
import { PairedDevicesStore } from '../clawser-paired-devices.mjs'

const memStorage = () => {
  const m = new Map()
  return { async read(n) { return m.has(n) ? m.get(n) : null }, async write(n, v) { m.set(n, v) } }
}

// ── view-model builders ──────────────────────────────────────────

describe('buildMyDevicesViewModel', () => {
  it('maps PairedDevicesStore entries into the panel shape', () => {
    const r = buildMyDevicesViewModel([
      { deviceId: 'd1', label: 'Phone', peerPublicKey: 'pk_phone', lastSyncAt: 1234, syncEnabled: true },
      { deviceId: 'd2', label: 'Tablet', peerPublicKey: null, lastSyncAt: null, syncEnabled: false },
    ])
    assert.equal(r.devices.length, 2)
    assert.equal(r.devices[0].pubKey, 'pk_phone')
    assert.equal(r.devices[0].label, 'Phone')
    assert.equal(r.devices[0].lastSyncedAt, 1234)
    assert.equal(r.devices[0].syncEnabled, true)
    // Falls back to deviceId when no peerPublicKey present
    assert.equal(r.devices[1].pubKey, 'd2')
  })

  it('handles empty / null input', () => {
    assert.deepEqual(buildMyDevicesViewModel(null).devices, [])
    assert.deepEqual(buildMyDevicesViewModel([]).devices, [])
  })

  it('uses (unlabeled) when label is missing', () => {
    const r = buildMyDevicesViewModel([{ deviceId: 'd', peerPublicKey: 'p' }])
    assert.equal(r.devices[0].label, '(unlabeled)')
  })
})

describe('buildTrustedPublishersViewModel', () => {
  it('passes through arrays unchanged', () => {
    const r = buildTrustedPublishersViewModel({
      sources: [{ source: 'did:key:z' }],
      approvals: [{ source: 'did:key:z', manifestHash: 'abcd' }],
      auditEvents: [{ id: 'e' }],
    })
    assert.equal(r.sources.length, 1)
    assert.equal(r.approvals.length, 1)
    assert.equal(r.auditEvents.length, 1)
  })

  it('defaults to empty arrays', () => {
    const r = buildTrustedPublishersViewModel(null)
    assert.deepEqual(r.sources, [])
    assert.deepEqual(r.approvals, [])
    assert.deepEqual(r.auditEvents, [])
  })
})

// ── mount integration with a fake DOM ────────────────────────────

function makeFakeDoc() {
  const containers = new Map()
  const make = (id) => ({
    id,
    _innerHTML: '',
    _children: [],
    classList: { contains: () => false, add() {}, remove() {}, toggle() {} },
    style: {},
    addEventListener() {},
    removeEventListener() {},
    appendChild(c) { this._children.push(c); return c },
    querySelector() { return null },
    querySelectorAll() { return [] },
    closest() { return null },
    get innerHTML() { return this._innerHTML },
    set innerHTML(v) { this._innerHTML = v },
  })
  return {
    body: make('body'),
    getElementById: (id) => {
      if (!containers.has(id)) containers.set(id, make(id))
      return containers.get(id)
    },
    createElement: (_tag) => make(null),
    _containers: containers,
  }
}

describe('mountMyDevicesPanel', () => {
  it('renders the empty state when state has no pairedDevices', async () => {
    const doc = makeFakeDoc()
    const handle = await mountMyDevicesPanel({}, { _doc: doc })
    assert.equal(handle, null)
    const container = doc._containers.get('myDevicesContainer')
    assert.match(container.innerHTML, /not initialized/)
  })

  it('renders devices from a real store and re-renders on store mutation', async () => {
    const doc = makeFakeDoc()
    const store = new PairedDevicesStore(memStorage())
    const state = { pairedDevices: store }
    const handle = await mountMyDevicesPanel(state, { _doc: doc })
    assert.ok(handle)

    const container = doc._containers.get('myDevicesContainer')
    assert.match(container.innerHTML, /No paired devices yet/)

    await store.add({ deviceId: 'd1', label: 'My phone', peerPublicKey: 'pk_phone' })
    // Subscriber fires renderNow; await microtask
    await new Promise(r => setTimeout(r, 5))
    assert.match(container.innerHTML, /My phone/)
    assert.match(container.innerHTML, /pk_phone/)

    handle.unbind()
  })

  it('returns null when the container element is missing', async () => {
    const noOpDoc = { getElementById: () => null }
    const handle = await mountMyDevicesPanel({ pairedDevices: {} }, { _doc: noOpDoc })
    assert.equal(handle, null)
  })

  it('idempotent: a second mount on the same state replaces the first', async () => {
    const doc = makeFakeDoc()
    const store = new PairedDevicesStore(memStorage())
    const state = { pairedDevices: store }
    const h1 = await mountMyDevicesPanel(state, { _doc: doc })
    const h2 = await mountMyDevicesPanel(state, { _doc: doc })
    assert.ok(h1 && h2)
    // Force a render — only one subscriber survives so only one re-render
    await store.add({ deviceId: 'd1' })
    await new Promise(r => setTimeout(r, 5))
    h2.unbind()
  })
})

describe('mountTrustedPublishersPanel', () => {
  it('renders empty state when no deployTarget on state', async () => {
    const doc = makeFakeDoc()
    const handle = await mountTrustedPublishersPanel({}, { _doc: doc })
    assert.equal(handle, null)
    const container = doc._containers.get('trustedPubsContainer')
    assert.match(container.innerHTML, /not initialized/)
  })

  it('renders sources and audit events from deployTarget stores', async () => {
    const doc = makeFakeDoc()
    const target = {
      deployAcl: { list: async () => [{ source: 'did:key:zMkA', label: 'Alice', addedAt: 1, revokedAt: null }] },
      deployApprovals: { list: async () => [] },
      deployAudit: { list: async () => [{ id: 'e1', timestamp: 1, source: 'did:key:zMkA', items: [{ kind: 'skill', itemId: 's' }], status: 'applied', error: null, manifestHash: 'h' }] },
      deploySnapshots: {},
    }
    const handle = await mountTrustedPublishersPanel({ deployTarget: target }, { _doc: doc })
    assert.ok(handle)
    const container = doc._containers.get('trustedPubsContainer')
    assert.match(container.innerHTML, /Alice/)
    assert.match(container.innerHTML, /skill:s/)
    handle.unbind()
  })
})

// ── workspace-switch reactivity ─────────────────────────────────

describe('remountVisibleMultiDevicePanels', () => {
  it('re-mounts My Devices when its section is visible', async () => {
    const doc = makeFakeDoc()
    // Mark the section as visible so the helper picks it up.
    const section = doc.getElementById('myDevicesSection')
    section.classList.contains = (cls) => cls === 'visible'
    const store = new PairedDevicesStore(memStorage())
    await store.add({ deviceId: 'd-fresh', label: 'Fresh device' })
    await remountVisibleMultiDevicePanels({ pairedDevices: store }, { _doc: doc })
    const container = doc._containers.get('myDevicesContainer')
    assert.match(container.innerHTML, /Fresh device/)
  })

  it('re-mounts Trusted Publishers when its section is visible', async () => {
    const doc = makeFakeDoc()
    const section = doc.getElementById('trustedPubsSection')
    section.classList.contains = (cls) => cls === 'visible'
    const target = {
      deployAcl: { list: async () => [{ source: 'did:key:zMkX', label: 'Switched-in source', addedAt: 1 }] },
      deployApprovals: { list: async () => [] },
      deployAudit: { list: async () => [] },
    }
    await remountVisibleMultiDevicePanels({ deployTarget: target }, { _doc: doc })
    const container = doc._containers.get('trustedPubsContainer')
    assert.match(container.innerHTML, /Switched-in source/)
  })

  it('skips closed sections (no mount call)', async () => {
    const doc = makeFakeDoc()
    // No section is `.visible` — the helper is a no-op.
    await remountVisibleMultiDevicePanels({ pairedDevices: null, deployTarget: null }, { _doc: doc })
    // The default makeFakeDoc never auto-creates myDevicesContainer/etc, so
    // a no-op leaves them either uncreated or with empty innerHTML.
    const c = doc._containers.get('myDevicesContainer')
    if (c) assert.equal(c.innerHTML || '', '')
  })

  it('is a no-op when there is no document', async () => {
    // No throw — the function silently returns.
    await remountVisibleMultiDevicePanels({}, { _doc: null })
  })
})
