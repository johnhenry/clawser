// clawser-approval-modal.test.mjs

import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

import { renderApprovalBody, showApprovalModal } from '../clawser-approval-modal.mjs'

const SAMPLE = {
  source: 'did:key:z6Mka1B2c3D4e5F6g7H8i9J0kAlice',
  manifestHash: 'a1b2c3d4e5f6c001abcdef1234567890fedcba9876543210',
  manifest: {
    sourceLabel: 'Alice MBP',
    items: [
      { kind: 'skill', itemId: 'code-review' },
      { kind: 'config', itemId: 'autonomy' },
    ],
    capabilities: {
      fs: ['/tmp/'],
      net: ['api.github.com', '*.example.com'],
      mesh: [],
      config: ['autonomy'],
      memory: [],
    },
  },
}

describe('renderApprovalBody', () => {
  it('renders source label + short DID + manifest hash + capabilities + items', () => {
    const html = renderApprovalBody(SAMPLE)
    assert.match(html, /Alice MBP/)
    assert.match(html, /did:key:z6Mka1B2c3D4/, 'short DID prefix must be visible')
    assert.match(html, /a1b2c3d4/) // hash short form
    assert.match(html, />fs</)
    assert.match(html, />net</)
    assert.match(html, />config</)
    assert.match(html, /api\.github\.com/)
    assert.match(html, /code-review/)
    assert.match(html, /autonomy/)
  })

  it('shows "(none requested)" for empty capability arrays', () => {
    const html = renderApprovalBody({
      source: 'did:key:z',
      manifestHash: 'h',
      manifest: { items: [], capabilities: { fs: [], net: [], mesh: [], config: [], memory: [] } },
    })
    // All five rows show "(none requested)"
    const matches = html.match(/\(none requested\)/g) || []
    assert.equal(matches.length, 5)
  })

  it('shows "(no items)" when items is empty', () => {
    const html = renderApprovalBody({
      source: 'did:key:z', manifestHash: 'h', manifest: { items: [], capabilities: {} },
    })
    assert.match(html, /\(no items\)/)
  })

  it('escapes HTML in user-controlled fields', () => {
    const evil = renderApprovalBody({
      source: 'did:key:z6Mk<script>',
      manifestHash: '<img onerror=x>',
      manifest: {
        sourceLabel: '<b>not bold</b>',
        items: [{ kind: '<x>', itemId: '<y>' }],
        capabilities: { fs: ['<dangerous>'] },
      },
    })
    assert.doesNotMatch(evil, /<script>/)
    assert.doesNotMatch(evil, /<img/)
    assert.doesNotMatch(evil, /<b>not bold/)
    assert.match(evil, /&lt;script&gt;|&lt;script>/)
  })
})

// ── DOM modal flow with a fake document ──────────────────────────

function makeFakeDoc() {
  // Minimal DOM stub sufficient for the modal's createElement +
  // appendChild + querySelector + addEventListener pattern.
  const made = []
  const buttons = new Map()
  function makeEl(tag) {
    const listeners = {}
    const el = {
      tagName: tag.toUpperCase(),
      _children: [],
      _listeners: listeners,
      style: {},
      classList: { add() {}, remove() {}, toggle() {}, contains() { return false } },
      className: '',
      _innerHTML: '',
      get innerHTML() { return this._innerHTML },
      set innerHTML(v) {
        this._innerHTML = v
        // Synthesize child buttons based on the IDs we expect
        for (const id of ['_approval_deny', '_approval_approve']) {
          if (v.includes(`id="${id}"`)) {
            buttons.set(id, makeEl('button'))
          }
        }
      },
      appendChild(child) { this._children.push(child); return child },
      remove() {
        // Mark removed
        el._removed = true
      },
      addEventListener(event, cb) { (listeners[event] ||= []).push(cb) },
      removeEventListener(event, cb) {
        const arr = listeners[event] || []; const i = arr.indexOf(cb); if (i >= 0) arr.splice(i, 1)
      },
      querySelector(sel) {
        // Match #_approval_deny / #_approval_approve
        if (sel.startsWith('#')) {
          const id = sel.slice(1)
          return buttons.get(id) || null
        }
        return null
      },
      focus() { /* no-op */ },
    }
    made.push(el)
    return el
  }

  const body = makeEl('body')
  return {
    body,
    createElement: (tag) => makeEl(tag),
    _madeElements: made,
    _buttons: buttons,
  }
}

describe('showApprovalModal — async DOM flow', () => {
  it('Approve button resolves true, modal removed', async () => {
    const doc = makeFakeDoc()
    const closes = []
    const promise = showApprovalModal(SAMPLE, { _doc: doc, _onClose: (v) => closes.push(v) })
    // Fire the approve button's click listener
    const approve = doc._buttons.get('_approval_approve')
    const handlers = approve._listeners.click || []
    assert.ok(handlers.length > 0)
    handlers[0]()
    const result = await promise
    assert.equal(result, true)
    assert.deepEqual(closes, [true])
  })

  it('Deny button resolves false', async () => {
    const doc = makeFakeDoc()
    const promise = showApprovalModal(SAMPLE, { _doc: doc })
    const deny = doc._buttons.get('_approval_deny')
    deny._listeners.click[0]()
    const result = await promise
    assert.equal(result, false)
  })

  it('returns false when no DOM is available', async () => {
    const result = await showApprovalModal(SAMPLE, { _doc: null })
    assert.equal(result, false)
  })

  it('test hook _onClose receives the same approve/deny value', async () => {
    const doc = makeFakeDoc()
    const captured = []
    const promise = showApprovalModal(SAMPLE, { _doc: doc, _onClose: (v) => captured.push(v) })
    doc._buttons.get('_approval_deny')._listeners.click[0]()
    await promise
    assert.deepEqual(captured, [false])
  })
})
