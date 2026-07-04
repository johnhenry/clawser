// clawser-ui-multi-device.test.mjs — render + bind for the two new panels

import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

import {
  renderMyDevicesPanel,
  bindMyDevicesPanel,
  renderTrustedPublishersPanel,
  bindTrustedPublishersPanel,
} from '../clawser-ui-multi-device.mjs'

// ── My Devices ───────────────────────────────────────────────────

describe('renderMyDevicesPanel', () => {
  it('empty state: shows the empty hint', () => {
    const html = renderMyDevicesPanel({ devices: [] })
    assert.match(html, /No paired devices yet/)
    assert.match(html, /id="md-pair-new"/)
  })

  it('populated: every device row has label, last-sync, sync toggle, deploy-now, unpair', () => {
    const html = renderMyDevicesPanel({
      devices: [
        { pubKey: 'pk_alice', label: 'Alice MBP', lastSyncedAt: 1714665600000, syncEnabled: true },
        { pubKey: 'pk_bob', label: '', lastSyncedAt: null, syncEnabled: false },
      ],
    })
    assert.match(html, /Alice MBP/)
    assert.match(html, /pk_alice/)
    assert.match(html, /\(unlabeled\)/) // bob has empty label
    assert.match(html, /Last sync: —/)
    assert.match(html, /data-md-action="toggle-sync"/)
    assert.match(html, /data-md-action="deploy-now"/)
    assert.match(html, /data-md-action="unpair"/)
    // First device's checkbox checked, second unchecked
    const occurrences = (html.match(/checkbox" data-md-action="toggle-sync" checked/g) || []).length
    assert.equal(occurrences, 1)
  })

  it('escapes HTML in user-supplied labels and pubkeys', () => {
    const html = renderMyDevicesPanel({
      devices: [{ pubKey: '<dangerous>', label: '<b>not bold</b>', lastSyncedAt: null, syncEnabled: false }],
    })
    assert.doesNotMatch(html, /<b>not bold/)
    assert.doesNotMatch(html, /<dangerous>/)
    assert.match(html, /&lt;b&gt;not bold/)
  })
})

describe('bindMyDevicesPanel — DOM event dispatch', () => {
  function mkDom() {
    const handlers = {}
    const make = (id, attr) => ({
      id,
      _attrs: attr || {},
      _listeners: {},
      checked: false,
      get textContent() { return this._text || '' },
      set textContent(v) { this._text = v },
      getAttribute(name) { return this._attrs[name] ?? null },
      addEventListener(ev, cb) { (this._listeners[ev] ||= []).push(cb) },
      closest(sel) { return this._closest?.(sel) || null },
      querySelector() { return null },
    })
    const pairBtn = make('md-pair-new')
    const aliceRow = {
      _attrs: { 'data-pubkey': 'pk_alice' },
      getAttribute(name) { return this._attrs[name] ?? null },
    }
    const aliceToggle = make(null, { 'data-md-action': 'toggle-sync' })
    aliceToggle._closest = (s) => s === '.md-row' ? aliceRow : null
    const aliceDeploy = make(null, { 'data-md-action': 'deploy-now' })
    aliceDeploy._closest = (s) => s === '.md-row' ? aliceRow : null
    const aliceUnpair = make(null, { 'data-md-action': 'unpair' })
    aliceUnpair._closest = (s) => s === '.md-row' ? aliceRow : null

    const container = {
      _listeners: {},
      addEventListener(ev, cb) { (this._listeners[ev] ||= []).push(cb) },
      removeEventListener(ev, cb) { const arr = this._listeners[ev] || []; const i = arr.indexOf(cb); if (i >= 0) arr.splice(i, 1) },
      querySelector(sel) { if (sel === '#md-pair-new') return pairBtn; return null },
    }
    return { container, pairBtn, aliceToggle, aliceDeploy, aliceUnpair }
  }

  it('Pair-new button → onPairNew', () => {
    const { container, pairBtn } = mkDom()
    const calls = []
    bindMyDevicesPanel(container, { onPairNew: () => calls.push('pair') })
    container._listeners.click[0]({ target: pairBtn })
    assert.deepEqual(calls, ['pair'])
  })

  it('toggle-sync → onToggleSync(pubKey, checked)', () => {
    const { container, aliceToggle } = mkDom()
    const calls = []
    bindMyDevicesPanel(container, { onToggleSync: (pk, en) => calls.push([pk, en]) })
    aliceToggle.checked = true
    container._listeners.change[0]({ target: aliceToggle })
    assert.deepEqual(calls, [['pk_alice', true]])
  })

  it('deploy-now → onDeployNow(pubKey)', () => {
    const { container, aliceDeploy } = mkDom()
    const calls = []
    bindMyDevicesPanel(container, { onDeployNow: (pk) => calls.push(pk) })
    container._listeners.click[0]({ target: aliceDeploy })
    assert.deepEqual(calls, ['pk_alice'])
  })

  it('unpair → onUnpair(pubKey)', () => {
    const { container, aliceUnpair } = mkDom()
    const calls = []
    bindMyDevicesPanel(container, { onUnpair: (pk) => calls.push(pk) })
    container._listeners.click[0]({ target: aliceUnpair })
    assert.deepEqual(calls, ['pk_alice'])
  })
})

// ── Trusted Publishers ──────────────────────────────────────────

describe('renderTrustedPublishersPanel', () => {
  it('empty state: all three sections show their empty hints', () => {
    const html = renderTrustedPublishersPanel({})
    assert.match(html, /No trusted sources/)
    assert.match(html, /No manifest approvals/)
    assert.match(html, /No deploy events/)
  })

  it('renders sources, approvals, and audit events', () => {
    const html = renderTrustedPublishersPanel({
      sources: [{ source: 'did:key:z6MkAlice', label: 'Alice', addedAt: 1, revokedAt: null }],
      approvals: [{ source: 'did:key:z6MkAlice', manifestHash: 'abcd1234ef', approvedAt: 2 }],
      auditEvents: [
        { id: 'evt-1', timestamp: 3, source: 'did:key:z6MkAlice', manifestHash: 'abcd1234ef',
          items: [{ kind: 'skill', itemId: 's1' }], status: 'applied', error: null },
        { id: 'evt-2', timestamp: 4, source: 'did:key:z6MkAlice', manifestHash: null,
          items: [], status: 'rejected', error: 'not trusted' },
      ],
    })
    assert.match(html, /Alice/)
    assert.match(html, /Trusted source DIDs/)
    assert.match(html, /Approved manifest fingerprints/)
    assert.match(html, /Deploy history/)
    assert.match(html, /skill:s1/)
    assert.match(html, /not trusted/)
    // Applied event has rollback button; rejected does NOT
    const rollbackCount = (html.match(/data-tp-action="rollback"/g) || []).length
    assert.equal(rollbackCount, 1)
  })

  it('revoked source shows "Re-trust" instead of "Revoke"', () => {
    const html = renderTrustedPublishersPanel({
      sources: [{ source: 'did:key:z6MkSneak', label: 'Sneak', addedAt: 1, revokedAt: 5 }],
    })
    assert.match(html, /Re-trust/)
    assert.match(html, /Revoked/)
  })

  it('escapes HTML in audit error messages and source labels', () => {
    const html = renderTrustedPublishersPanel({
      sources: [{ source: 'x', label: '<b>x</b>', addedAt: 1, revokedAt: null }],
      auditEvents: [{ id: 'e', timestamp: 1, source: 'x', items: [], status: 'rejected', error: '<script>alert(1)</script>' }],
    })
    assert.doesNotMatch(html, /<script>alert/)
    assert.doesNotMatch(html, /<b>x<\/b>/)
  })
})

describe('bindTrustedPublishersPanel — DOM event dispatch', () => {
  function mkDom(buttons) {
    const container = {
      _listeners: {},
      addEventListener(ev, cb) { (this._listeners[ev] ||= []).push(cb) },
      removeEventListener(ev, cb) { const arr = this._listeners[ev] || []; const i = arr.indexOf(cb); if (i >= 0) arr.splice(i, 1) },
    }
    return { container, ...buttons }
  }

  it('revoke-source → onRevokeSource(source)', () => {
    const row = { _attrs: { 'data-source': 'did:key:z6MkAlice' }, getAttribute(k) { return this._attrs[k] } }
    const btn = {
      textContent: 'Revoke',
      getAttribute: (k) => k === 'data-tp-action' ? 'revoke-source' : null,
      closest: (s) => s === '.tp-row' ? row : null,
    }
    const { container } = mkDom({ btn })
    const calls = []
    bindTrustedPublishersPanel(container, { onRevokeSource: (s) => calls.push(s) })
    container._listeners.click[0]({ target: btn })
    assert.deepEqual(calls, ['did:key:z6MkAlice'])
  })

  it('Re-trust button → onRetrustSource(source)', () => {
    const row = { _attrs: { 'data-source': 'did:key:z6MkAlice' }, getAttribute(k) { return this._attrs[k] } }
    const btn = {
      textContent: 'Re-trust',
      getAttribute: (k) => k === 'data-tp-action' ? 'revoke-source' : null,
      closest: (s) => s === '.tp-row' ? row : null,
    }
    const { container } = mkDom({ btn })
    const calls = []
    bindTrustedPublishersPanel(container, { onRetrustSource: (s) => calls.push(s) })
    container._listeners.click[0]({ target: btn })
    assert.deepEqual(calls, ['did:key:z6MkAlice'])
  })

  it('revoke-approval → onRevokeApproval(source, hash)', () => {
    const row = {
      _attrs: { 'data-source': 'did:key:z6MkAlice', 'data-hash': 'abcd' },
      getAttribute(k) { return this._attrs[k] },
    }
    const btn = {
      textContent: 'Revoke',
      getAttribute: (k) => k === 'data-tp-action' ? 'revoke-approval' : null,
      closest: (s) => s === '.tp-row' ? row : null,
    }
    const { container } = mkDom({ btn })
    const calls = []
    bindTrustedPublishersPanel(container, { onRevokeApproval: (s, h) => calls.push([s, h]) })
    container._listeners.click[0]({ target: btn })
    assert.deepEqual(calls, [['did:key:z6MkAlice', 'abcd']])
  })

  it('rollback → onRollback(eventId)', () => {
    const row = { _attrs: { 'data-event-id': 'evt-7' }, getAttribute(k) { return this._attrs[k] } }
    const btn = {
      getAttribute: (k) => k === 'data-tp-action' ? 'rollback' : null,
      closest: (s) => s === '.tp-audit-row' ? row : null,
    }
    const { container } = mkDom({ btn })
    const calls = []
    bindTrustedPublishersPanel(container, { onRollback: (id) => calls.push(id) })
    container._listeners.click[0]({ target: btn })
    assert.deepEqual(calls, ['evt-7'])
  })
})
