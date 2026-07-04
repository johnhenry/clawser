// clawser-ui-mesh-relay.test.mjs — Settings UI for Mesh / Relay endpoints
// Run: node --import ./web/test/_setup-globals.mjs --test web/test/clawser-ui-mesh-relay.test.mjs

import { describe, it, beforeEach } from 'node:test'
import assert from 'node:assert/strict'

// Stub minimal browser globals before importing the module under test.
// The dirty-tracker reads document.activeElement to decide whether to set.
const inputs = new Map()
function makeInput({ id, type = 'text' }) {
  const el = {
    id,
    type,
    value: '',
    checked: false,
    _listeners: {},
    addEventListener(event, cb) { (this._listeners[event] ||= []).push(cb) },
    removeEventListener(event, cb) {
      const list = this._listeners[event]
      if (!list) return
      const i = list.indexOf(cb)
      if (i >= 0) list.splice(i, 1)
    },
    dispatchEvent(event) {
      (this._listeners[event.type] || []).forEach(cb => cb(event))
    },
    dataset: {},
  }
  inputs.set(id, el)
  return el
}

globalThis.document = {
  getElementById: (id) => inputs.get(id) || null,
  activeElement: null,
  // Used by other code paths; harmless here
  createElement: () => ({ appendChild() {}, addEventListener() {} }),
}

globalThis.localStorage = {
  _store: new Map(),
  getItem(k) { return this._store.has(k) ? this._store.get(k) : null },
  setItem(k, v) { this._store.set(k, String(v)) },
  removeItem(k) { this._store.delete(k) },
  clear() { this._store.clear() },
}

// Set up fields the Mesh/Relay UI section uses, then import the module.
makeInput({ id: 'cfgRelayUrl' })
makeInput({ id: 'cfgSignalingUrl' })
makeInput({ id: 'cfgRelayAutoConnect', type: 'checkbox' })

const mod = await import('../clawser-ui-config.js')
const { readMeshRelaySettings, renderMeshRelaySection, applyMeshRelaySettings } = mod

describe('readMeshRelaySettings', () => {
  beforeEach(() => { localStorage.clear() })

  it('returns empty strings + false when nothing is stored', () => {
    const s = readMeshRelaySettings()
    assert.equal(s.relayUrl, '')
    assert.equal(s.signalingUrl, '')
    assert.equal(s.autoConnect, false)
  })

  it('reads stored values from localStorage', () => {
    localStorage.setItem('clawser_relay_url', 'wss://my-relay.example')
    localStorage.setItem('clawser_signaling_url', 'wss://my-signaling.example')
    localStorage.setItem('clawser_relay_auto_connect', 'true')
    const s = readMeshRelaySettings()
    assert.equal(s.relayUrl, 'wss://my-relay.example')
    assert.equal(s.signalingUrl, 'wss://my-signaling.example')
    assert.equal(s.autoConnect, true)
  })

  it('treats any non-"true" string as false (forward-compat)', () => {
    localStorage.setItem('clawser_relay_auto_connect', '1')
    assert.equal(readMeshRelaySettings().autoConnect, false)
    localStorage.setItem('clawser_relay_auto_connect', 'yes')
    assert.equal(readMeshRelaySettings().autoConnect, false)
    localStorage.setItem('clawser_relay_auto_connect', 'true')
    assert.equal(readMeshRelaySettings().autoConnect, true)
  })
})

describe('renderMeshRelaySection', () => {
  beforeEach(() => {
    localStorage.clear()
    inputs.get('cfgRelayUrl').value = ''
    inputs.get('cfgSignalingUrl').value = ''
    inputs.get('cfgRelayAutoConnect').checked = false
    document.activeElement = null
  })

  it('populates form fields from stored values', () => {
    localStorage.setItem('clawser_relay_url', 'wss://r.example')
    localStorage.setItem('clawser_signaling_url', 'wss://s.example')
    localStorage.setItem('clawser_relay_auto_connect', 'true')
    renderMeshRelaySection()
    assert.equal(inputs.get('cfgRelayUrl').value, 'wss://r.example')
    assert.equal(inputs.get('cfgSignalingUrl').value, 'wss://s.example')
    assert.equal(inputs.get('cfgRelayAutoConnect').checked, true)
  })

  it('does not overwrite the checkbox the user is currently focused on', () => {
    const cb = inputs.get('cfgRelayAutoConnect')
    cb.checked = true
    document.activeElement = cb
    localStorage.setItem('clawser_relay_auto_connect', '') // would clear
    renderMeshRelaySection()
    assert.equal(cb.checked, true)
  })
})

describe('applyMeshRelaySettings', () => {
  beforeEach(() => {
    localStorage.clear()
    inputs.get('cfgRelayUrl').value = ''
    inputs.get('cfgSignalingUrl').value = ''
    inputs.get('cfgRelayAutoConnect').checked = false
  })

  it('writes set values to localStorage', () => {
    inputs.get('cfgRelayUrl').value = 'wss://new-relay.example'
    inputs.get('cfgSignalingUrl').value = 'wss://new-signaling.example'
    inputs.get('cfgRelayAutoConnect').checked = true
    applyMeshRelaySettings()
    assert.equal(localStorage.getItem('clawser_relay_url'), 'wss://new-relay.example')
    assert.equal(localStorage.getItem('clawser_signaling_url'), 'wss://new-signaling.example')
    assert.equal(localStorage.getItem('clawser_relay_auto_connect'), 'true')
  })

  it('removes the localStorage key when an input is empty', () => {
    localStorage.setItem('clawser_relay_url', 'wss://old.example')
    localStorage.setItem('clawser_signaling_url', 'wss://old-s.example')
    localStorage.setItem('clawser_relay_auto_connect', 'true')
    inputs.get('cfgRelayUrl').value = ''
    inputs.get('cfgSignalingUrl').value = ''
    inputs.get('cfgRelayAutoConnect').checked = false
    applyMeshRelaySettings()
    assert.equal(localStorage.getItem('clawser_relay_url'), null)
    assert.equal(localStorage.getItem('clawser_signaling_url'), null)
    assert.equal(localStorage.getItem('clawser_relay_auto_connect'), null)
  })

  it('trims whitespace from URLs', () => {
    inputs.get('cfgRelayUrl').value = '  wss://trimmed.example  '
    applyMeshRelaySettings()
    assert.equal(localStorage.getItem('clawser_relay_url'), 'wss://trimmed.example')
  })

  it('round-trips: apply → read returns same values', () => {
    inputs.get('cfgRelayUrl').value = 'wss://round.example'
    inputs.get('cfgRelayAutoConnect').checked = true
    applyMeshRelaySettings()
    const s = readMeshRelaySettings()
    assert.equal(s.relayUrl, 'wss://round.example')
    assert.equal(s.autoConnect, true)
  })
})
