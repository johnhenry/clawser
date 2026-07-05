// clawser-ui-mesh.test.mjs — Connectivity Metrics section of the mesh
// dashboard panel (mesh Phase 11 item 19: health metrics + alert rules).
// Run: node --import ./web/test/_setup-globals.mjs --test web/test/clawser-ui-mesh.test.mjs

import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

import { renderMeshPanel } from '../clawser-ui-mesh.js'

describe('renderMeshPanel — Connectivity Metrics section', () => {
  it('renders an empty state when connectivity is absent', () => {
    const html = renderMeshPanel({})
    assert.match(html, /Connectivity Metrics/)
    assert.match(html, /No connectivity metrics yet/)
  })

  it('renders an empty state when connectivity is inactive', () => {
    const html = renderMeshPanel({ connectivity: { active: false, connectionCount: 0, stats: [] } })
    assert.match(html, /No connectivity metrics yet/)
  })

  it('renders an empty state when active but stats is empty', () => {
    const html = renderMeshPanel({ connectivity: { active: true, connectionCount: 0, stats: [] } })
    assert.match(html, /No connectivity metrics yet/)
  })

  it('renders a row per peer with rtt and packet loss', () => {
    const html = renderMeshPanel({
      connectivity: {
        active: true,
        connectionCount: 1,
        stats: [{ remotePodId: 'peer-abc123456789', roundTripTime: 0.123, packetLossRatio: 0.02 }],
      },
    })
    assert.match(html, /mesh-metric-row/)
    assert.match(html, /123ms/)
    assert.match(html, /2\.0% loss/)
    assert.doesNotMatch(html, /No connectivity metrics yet/)
  })

  it('renders an error row for a failed stats query without throwing', () => {
    const html = renderMeshPanel({
      connectivity: {
        active: true,
        connectionCount: 1,
        stats: [{ remotePodId: 'peer-broken', error: 'no peer connection — call createOffer() first' }],
      },
    })
    assert.match(html, /mesh-metric-row/)
    assert.match(html, /no peer connection/)
    assert.match(html, /mesh-badge-err/)
  })

  it('renders -- for missing rtt/loss values', () => {
    const html = renderMeshPanel({
      connectivity: { active: true, connectionCount: 1, stats: [{ remotePodId: 'p1', roundTripTime: null, packetLossRatio: null }] },
    })
    assert.match(html, /--ms|--<\/span>/) // rtt shows literal "--"
  })

  it('escapes attacker-controlled remotePodId and error text', () => {
    const html = renderMeshPanel({
      connectivity: {
        active: true,
        connectionCount: 1,
        stats: [{ remotePodId: '<script>x</script>', error: '<img onerror=alert(1)>' }],
      },
    })
    assert.doesNotMatch(html, /<script>x<\/script>/)
    assert.doesNotMatch(html, /<img onerror=alert\(1\)>/)
  })
})
