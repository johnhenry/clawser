// Run with: node --import ./web/test/_setup-globals.mjs --test web/test/clawser-mesh-alert-rules.test.mjs

import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

import {
  DEFAULT_ALERT_RULES,
  recordMetricSample,
  evaluateAlertRules,
} from '../clawser-mesh-alert-rules.mjs'

describe('DEFAULT_ALERT_RULES', () => {
  it('matches the mesh Phase 11 spec thresholds', () => {
    assert.equal(DEFAULT_ALERT_RULES.maxRoundTripTimeSec, 2)
    assert.equal(DEFAULT_ALERT_RULES.maxPacketLossRatio, 0.05)
    assert.equal(DEFAULT_ALERT_RULES.peerDrop, true)
  })
})

describe('recordMetricSample', () => {
  it('appends a sample with the given timestamp', () => {
    const window = recordMetricSample([], { remotePodId: 'a' }, 1000)
    assert.equal(window.length, 1)
    assert.equal(window[0].remotePodId, 'a')
    assert.equal(window[0].timestamp, 1000)
  })

  it('does not mutate the input window', () => {
    const original = []
    recordMetricSample(original, { remotePodId: 'a' }, 1000)
    assert.equal(original.length, 0)
  })

  it('prunes entries older than maxAgeMs relative to the given timestamp', () => {
    let window = recordMetricSample([], { remotePodId: 'a' }, 0)
    window = recordMetricSample(window, { remotePodId: 'b' }, 30_000)
    window = recordMetricSample(window, { remotePodId: 'c' }, 70_000) // prunes 'a' (age 70s > 60s default)
    assert.deepEqual(window.map(e => e.remotePodId), ['b', 'c'])
  })

  it('respects a custom maxAgeMs', () => {
    let window = recordMetricSample([], { remotePodId: 'a' }, 0)
    window = recordMetricSample(window, { remotePodId: 'b' }, 5_000, { maxAgeMs: 4_000 })
    assert.deepEqual(window.map(e => e.remotePodId), ['b'])
  })

  it('keeps a sample exactly at the cutoff boundary', () => {
    let window = recordMetricSample([], { remotePodId: 'a' }, 0)
    window = recordMetricSample(window, { remotePodId: 'b' }, 60_000) // age exactly 60s
    assert.deepEqual(window.map(e => e.remotePodId), ['a', 'b'])
  })
})

describe('evaluateAlertRules', () => {
  it('returns no violations for healthy stats', () => {
    const stats = [{ remotePodId: 'p1', roundTripTime: 0.05, packetLossRatio: 0.01 }]
    assert.deepEqual(evaluateAlertRules(stats), [])
  })

  it('flags latency above the threshold', () => {
    const stats = [{ remotePodId: 'p1', roundTripTime: 2.5, packetLossRatio: 0 }]
    const violations = evaluateAlertRules(stats)
    assert.equal(violations.length, 1)
    assert.equal(violations[0].rule, 'latency')
    assert.equal(violations[0].remotePodId, 'p1')
    assert.match(violations[0].message, /High latency/)
  })

  it('does not flag latency exactly at the threshold', () => {
    const stats = [{ remotePodId: 'p1', roundTripTime: 2, packetLossRatio: 0 }]
    assert.deepEqual(evaluateAlertRules(stats), [])
  })

  it('flags packet loss above the threshold', () => {
    const stats = [{ remotePodId: 'p1', roundTripTime: 0.1, packetLossRatio: 0.12 }]
    const violations = evaluateAlertRules(stats)
    assert.equal(violations.length, 1)
    assert.equal(violations[0].rule, 'packet_loss')
    assert.match(violations[0].message, /High packet loss/)
  })

  it('flags both latency and packet loss for the same peer', () => {
    const stats = [{ remotePodId: 'p1', roundTripTime: 3, packetLossRatio: 0.2 }]
    const violations = evaluateAlertRules(stats)
    assert.equal(violations.length, 2)
    assert.deepEqual(violations.map(v => v.rule).sort(), ['latency', 'packet_loss'])
  })

  it('skips entries with an error field', () => {
    const stats = [{ remotePodId: 'p1', error: 'no peer connection' }]
    assert.deepEqual(evaluateAlertRules(stats), [])
  })

  it('detects a peer drop when previousPeerIds is provided', () => {
    const stats = [{ remotePodId: 'p1', roundTripTime: 0.1, packetLossRatio: 0 }]
    const violations = evaluateAlertRules(stats, ['p1', 'p2'])
    assert.equal(violations.length, 1)
    assert.equal(violations[0].rule, 'peer_drop')
    assert.equal(violations[0].remotePodId, 'p2')
  })

  it('does not check peer drop when previousPeerIds is omitted', () => {
    const stats = [{ remotePodId: 'p1', roundTripTime: 0.1, packetLossRatio: 0 }]
    assert.deepEqual(evaluateAlertRules(stats), [])
  })

  it('respects custom rule thresholds', () => {
    const stats = [{ remotePodId: 'p1', roundTripTime: 0.5, packetLossRatio: 0.02 }]
    const violations = evaluateAlertRules(stats, null, { maxRoundTripTimeSec: 0.2, maxPacketLossRatio: 0.01, peerDrop: false })
    assert.equal(violations.length, 2)
  })

  it('can disable peerDrop via rules', () => {
    const stats = []
    const violations = evaluateAlertRules(stats, ['p1'], { ...DEFAULT_ALERT_RULES, peerDrop: false })
    assert.deepEqual(violations, [])
  })

  it('handles an empty stats array', () => {
    assert.deepEqual(evaluateAlertRules([]), [])
  })

  it('handles non-array input gracefully', () => {
    assert.deepEqual(evaluateAlertRules(null), [])
    assert.deepEqual(evaluateAlertRules(undefined), [])
  })
})
