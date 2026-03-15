/**
 * clawser-ui-modules.test.mjs — Unit tests for UI rendering modules.
 *
 * Tests pure render functions that return HTML strings, and data-producing
 * helpers like computeDiff. Does NOT test event handlers or DOM manipulation.
 */
import { describe, it, beforeEach } from 'node:test'
import assert from 'node:assert/strict'

// ── Stub browser globals ─────────────────────────────────────────

const store = {}
globalThis.localStorage = {
  getItem: (k) => store[k] ?? null,
  setItem: (k, v) => { store[k] = String(v) },
  removeItem: (k) => { delete store[k] },
  clear: () => { for (const k of Object.keys(store)) delete store[k] },
}

globalThis.document = {
  getElementById: () => null,
  createElement: (tag) => ({
    tagName: tag,
    style: {},
    className: '',
    textContent: '',
    innerHTML: '',
    dataset: {},
    classList: { add() {}, remove() {}, contains() { return false } },
    addEventListener() {},
    appendChild(c) { return c },
    querySelectorAll() { return [] },
    querySelector() { return null },
    setAttribute() {},
    remove() {},
  }),
  createTextNode: (t) => ({ textContent: t }),
  addEventListener: () => {},
  querySelectorAll: () => [],
  querySelector: () => null,
  head: { appendChild() {} },
  body: { appendChild() {} },
}

globalThis.window = globalThis
globalThis.location = { search: '', hash: '', href: '' }
globalThis.history = { replaceState() {} }
try {
  globalThis.navigator = { clipboard: { writeText: async () => {} } }
} catch {
  // navigator is a getter in Node — patch individual properties
  if (globalThis.navigator) {
    if (!globalThis.navigator.clipboard) {
      Object.defineProperty(globalThis.navigator, 'clipboard', {
        value: { writeText: async () => {} },
        configurable: true,
      })
    }
  }
}
globalThis.BroadcastChannel = class { postMessage() {} close() {} onmessage() {} }
globalThis.Blob = class { constructor() {} }
globalThis.URL = globalThis.URL || URL
globalThis.TextEncoder = globalThis.TextEncoder || TextEncoder
globalThis.TextDecoder = globalThis.TextDecoder || TextDecoder

// ── Import modules under test ────────────────────────────────────

import { renderMeshPanel } from '../clawser-ui-mesh.js'
import { renderTransferPanel } from '../clawser-ui-transfers.js'
import { renderSwarmPanel, renderSwarmStats } from '../clawser-ui-swarms.js'
import { computeDiff } from '../clawser-ui-diff.js'

// ── renderMeshPanel ──────────────────────────────────────────────

describe('renderMeshPanel', () => {
  it('renders without throwing with empty opts', () => {
    const html = renderMeshPanel()
    assert.ok(typeof html === 'string')
    assert.ok(html.length > 0)
  })

  it('contains expected structural elements', () => {
    const html = renderMeshPanel()
    assert.ok(html.includes('mesh-panel'), 'should have mesh-panel class')
    assert.ok(html.includes('Mesh Dashboard'), 'should have title')
    assert.ok(html.includes('Pod Topology'), 'should have topology section')
    assert.ok(html.includes('Resource Usage'), 'should have resource section')
    assert.ok(html.includes('Service Directory'), 'should have service section')
    assert.ok(html.includes('Quick Actions'), 'should have actions section')
  })

  it('shows "No connected peers" when peers array is empty', () => {
    const html = renderMeshPanel({ peers: [] })
    assert.ok(html.includes('No connected peers'))
  })

  it('displays peer count in header', () => {
    const html = renderMeshPanel({ peers: [
      { podId: 'abc123', label: 'Peer A', latency: 50 },
      { podId: 'def456', label: 'Peer B', latency: 200 },
    ]})
    assert.ok(html.includes('2 peers connected'))
  })

  it('renders local pod info', () => {
    const html = renderMeshPanel({ localPod: { podId: 'my-pod-id', label: 'My Pod' } })
    assert.ok(html.includes('My Pod'))
    assert.ok(html.includes('mesh-pod-local'))
  })

  it('renders resource usage bars', () => {
    const html = renderMeshPanel({ resources: [
      { podId: 'abc', type: 'cpu', used: 70, capacity: 100 },
    ]})
    assert.ok(html.includes('mesh-resource-bar'))
    assert.ok(html.includes('70%'))
  })

  it('renders service directory entries', () => {
    const html = renderMeshPanel({ services: [
      { name: 'chat-service', podId: 'abc', version: '2.0', isLocal: true },
    ]})
    assert.ok(html.includes('chat-service'))
    assert.ok(html.includes('2.0'))
  })

  it('shows empty messages when no resources or services', () => {
    const html = renderMeshPanel({ resources: [], services: [] })
    assert.ok(html.includes('No resource data'))
    assert.ok(html.includes('No advertised services'))
  })
})

// ── renderTransferPanel ──────────────────────────────────────────

describe('renderTransferPanel', () => {
  it('renders without throwing with empty opts', () => {
    const html = renderTransferPanel()
    assert.ok(typeof html === 'string')
    assert.ok(html.length > 0)
  })

  it('contains expected structural elements', () => {
    const html = renderTransferPanel()
    assert.ok(html.includes('transfer-panel'), 'should have transfer-panel class')
    assert.ok(html.includes('File Transfers'), 'should have title')
    assert.ok(html.includes('Active Transfers'), 'should have active section')
    assert.ok(html.includes('History'), 'should have history section')
    assert.ok(html.includes('transfer-dropzone'), 'should have dropzone')
  })

  it('shows empty message when no active transfers', () => {
    const html = renderTransferPanel({ active: [] })
    assert.ok(html.includes('No active transfers'))
  })

  it('renders active transfer with progress', () => {
    const html = renderTransferPanel({ active: [
      { id: 'tx1', filename: 'data.csv', peerId: 'peer1', direction: 'upload', transferredSize: 500, totalSize: 1000, speed: 100 },
    ]})
    assert.ok(html.includes('data.csv'))
    assert.ok(html.includes('transfer-progress-bar'))
    assert.ok(html.includes('50%'))
  })

  it('renders transfer history', () => {
    const html = renderTransferPanel({ history: [
      { filename: 'report.pdf', peerId: 'peer2', direction: 'download', totalSize: 2048, status: 'completed', completedAt: Date.now() },
    ]})
    assert.ok(html.includes('report.pdf'))
    assert.ok(html.includes('transfer-status-ok'))
    assert.ok(html.includes('completed'))
  })

  it('shows empty message when no transfer history', () => {
    const html = renderTransferPanel({ history: [] })
    assert.ok(html.includes('No transfer history'))
  })
})

// ── renderSwarmPanel ─────────────────────────────────────────────

describe('renderSwarmPanel', () => {
  it('renders without throwing with empty opts', () => {
    const html = renderSwarmPanel()
    assert.ok(typeof html === 'string')
    assert.ok(html.length > 0)
  })

  it('contains expected structural elements', () => {
    const html = renderSwarmPanel()
    assert.ok(html.includes('swarm-panel'), 'should have swarm-panel class')
    assert.ok(html.includes('Swarm Management'), 'should have title')
    assert.ok(html.includes('Create Swarm'), 'should have create button')
  })

  it('shows empty message when no swarms', () => {
    const html = renderSwarmPanel({ swarms: [] })
    assert.ok(html.includes('No active swarms'))
  })

  it('renders swarm cards with members', () => {
    const html = renderSwarmPanel({ swarms: [
      { id: 'sw1', goal: 'Research task', strategy: 'round_robin', status: 'active', leader: 'pod1', members: ['pod1', 'pod2'] },
    ]})
    assert.ok(html.includes('Research task'))
    assert.ok(html.includes('swarm-card'))
    assert.ok(html.includes('round_robin'))
    assert.ok(html.includes('2 members'))
  })

  it('shows join button for non-member swarms', () => {
    const html = renderSwarmPanel({
      swarms: [{ id: 'sw1', goal: 'Test', status: 'active', leader: 'other', members: ['other'] }],
      localPodId: 'me',
    })
    assert.ok(html.includes('swarm-join-btn'))
  })

  it('shows leave button for member swarms', () => {
    const html = renderSwarmPanel({
      swarms: [{ id: 'sw1', goal: 'Test', status: 'active', leader: 'other', members: ['other', 'me'] }],
      localPodId: 'me',
    })
    assert.ok(html.includes('swarm-leave-btn'))
  })

  it('renders subtask progress', () => {
    const html = renderSwarmPanel({ swarms: [
      {
        id: 'sw1', goal: 'Multi-task', status: 'executing', leader: 'pod1', members: ['pod1'],
        subtasks: [
          { id: 't1', description: 'Step 1', status: 'completed', assignee: 'pod1' },
          { id: 't2', description: 'Step 2', status: 'running', assignee: 'pod1' },
        ],
      },
    ]})
    assert.ok(html.includes('swarm-progress'))
    assert.ok(html.includes('1/2'))
    assert.ok(html.includes('50%'))
  })
})

// ── renderSwarmStats ─────────────────────────────────────────────

describe('renderSwarmStats', () => {
  it('renders without throwing with empty args', () => {
    const html = renderSwarmStats()
    assert.ok(typeof html === 'string')
    assert.ok(html.includes('swarm-stats-bar'))
  })

  it('counts active swarms', () => {
    const html = renderSwarmStats([
      { id: 's1', status: 'active', members: ['me'] },
      { id: 's2', status: 'disbanded', members: [] },
    ], 'me')
    assert.ok(html.includes('2 swarms'))
    assert.ok(html.includes('1 active'))
    assert.ok(html.includes('1 joined'))
  })

  it('shows leading count when applicable', () => {
    const html = renderSwarmStats([
      { id: 's1', status: 'active', leader: 'me', members: ['me'] },
    ], 'me')
    assert.ok(html.includes('1 leading'))
  })
})

// ── computeDiff ──────────────────────────────────────────────────

describe('computeDiff', () => {
  it('returns empty array for two empty strings', () => {
    const diff = computeDiff('', '')
    // Single empty line from split
    assert.equal(diff.length, 1)
    assert.equal(diff[0].type, 'equal')
  })

  it('detects added lines', () => {
    const diff = computeDiff('a', 'a\nb')
    const adds = diff.filter(d => d.type === 'add')
    assert.equal(adds.length, 1)
    assert.equal(adds[0].line, 'b')
  })

  it('detects deleted lines', () => {
    const diff = computeDiff('a\nb', 'a')
    const dels = diff.filter(d => d.type === 'del')
    assert.equal(dels.length, 1)
    assert.equal(dels[0].line, 'b')
  })

  it('detects equal lines', () => {
    const diff = computeDiff('a\nb\nc', 'a\nb\nc')
    assert.ok(diff.every(d => d.type === 'equal'))
    assert.equal(diff.length, 3)
  })

  it('handles complete replacement', () => {
    const diff = computeDiff('old1\nold2', 'new1\nnew2')
    const adds = diff.filter(d => d.type === 'add')
    const dels = diff.filter(d => d.type === 'del')
    assert.equal(adds.length, 2)
    assert.equal(dels.length, 2)
  })

  it('handles null/undefined inputs gracefully', () => {
    const diff = computeDiff(null, undefined)
    assert.ok(Array.isArray(diff))
  })
})

// ── renderMeshPanel with peers having various latencies ──────────

describe('renderMeshPanel health indicators', () => {
  it('shows good health for low latency', () => {
    const html = renderMeshPanel({ peers: [{ podId: 'p1', latency: 50 }] })
    assert.ok(html.includes('mesh-badge-ok'))
    assert.ok(html.includes('good'))
  })

  it('shows fair health for medium latency', () => {
    const html = renderMeshPanel({ peers: [{ podId: 'p1', latency: 300 }] })
    assert.ok(html.includes('mesh-badge-warn'))
    assert.ok(html.includes('fair'))
  })

  it('shows poor health for high latency', () => {
    const html = renderMeshPanel({ peers: [{ podId: 'p1', latency: 1000 }] })
    assert.ok(html.includes('mesh-badge-err'))
    assert.ok(html.includes('poor'))
  })
})
