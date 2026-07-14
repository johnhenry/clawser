/**
 * clawser-mesh-alert-rules.mjs -- Mesh health metrics: rolling window +
 * alert evaluation over per-peer WebRTC connection stats.
 *
 * Pure functions only — no browser/DOM/network imports. Callers (the
 * mesh UI panel, workspace init) own the polling loop and decide how to
 * surface a violation (e.g. addMsg('system', ...)).
 *
 * Run tests:
 *   node --import ./web/test/_setup-globals.mjs --test web/test/clawser-mesh-alert-rules.test.mjs
 */

/** Default thresholds, per the mesh Phase 11 health-metrics spec. */
export const DEFAULT_ALERT_RULES = Object.freeze({
  maxRoundTripTimeSec: 2,
  maxPacketLossRatio: 0.05,
  peerDrop: true,
})

/**
 * Append a stats sample to a rolling window and prune entries older than
 * `maxAgeMs`. Returns a NEW array (does not mutate the input) so callers
 * can hold the returned value as their new window reference.
 *
 * @param {Array<{timestamp: number}>} window - Existing samples, oldest first
 * @param {object} sample - Any object; a `timestamp` field is added/overwritten
 * @param {number} timestamp - Current time (caller-supplied — avoids Date.now() inside a pure module)
 * @param {object} [opts]
 * @param {number} [opts.maxAgeMs=60000] - Rolling window size (default 1 minute)
 * @returns {Array<{timestamp: number}>}
 */
export function recordMetricSample(window, sample, timestamp, { maxAgeMs = 60_000 } = {}) {
  const withTimestamp = { ...sample, timestamp }
  const cutoff = timestamp - maxAgeMs
  return [...(window || []), withTimestamp].filter(entry => entry.timestamp >= cutoff)
}

/**
 * Evaluate a set of per-peer connection stats against alert thresholds.
 * Pure function — returns violations, does not surface them anywhere.
 *
 * @param {Array<{remotePodId: string, roundTripTime?: number|null,
 *   packetLossRatio?: number, error?: string}>} statsEntries - Latest
 *   per-peer stats (e.g. from WebRTCMeshManager.getAllConnectionStats())
 * @param {Array<string>} [previousPeerIds] - PodIds seen in the prior
 *   sample, used to detect a peer that dropped out of statsEntries
 *   entirely (peerDrop rule). Omit to skip peer-drop detection.
 * @param {object} [rules=DEFAULT_ALERT_RULES]
 * @returns {Array<{remotePodId: string, rule: string, message: string, value?: number}>}
 */
export function evaluateAlertRules(statsEntries, previousPeerIds = null, rules = DEFAULT_ALERT_RULES) {
  const violations = []
  const entries = Array.isArray(statsEntries) ? statsEntries : []

  for (const entry of entries) {
    if (!entry || entry.error) continue
    if (typeof rules.maxRoundTripTimeSec === 'number' && typeof entry.roundTripTime === 'number'
        && entry.roundTripTime > rules.maxRoundTripTimeSec) {
      violations.push({
        remotePodId: entry.remotePodId,
        rule: 'latency',
        message: `High latency to ${entry.remotePodId}: ${entry.roundTripTime.toFixed(2)}s (threshold ${rules.maxRoundTripTimeSec}s)`,
        value: entry.roundTripTime,
      })
    }
    if (typeof rules.maxPacketLossRatio === 'number' && typeof entry.packetLossRatio === 'number'
        && entry.packetLossRatio > rules.maxPacketLossRatio) {
      violations.push({
        remotePodId: entry.remotePodId,
        rule: 'packet_loss',
        message: `High packet loss to ${entry.remotePodId}: ${(entry.packetLossRatio * 100).toFixed(1)}% (threshold ${(rules.maxPacketLossRatio * 100).toFixed(0)}%)`,
        value: entry.packetLossRatio,
      })
    }
  }

  if (rules.peerDrop && Array.isArray(previousPeerIds)) {
    const currentIds = new Set(entries.map(e => e.remotePodId))
    for (const podId of previousPeerIds) {
      if (!currentIds.has(podId)) {
        violations.push({
          remotePodId: podId,
          rule: 'peer_drop',
          message: `Peer ${podId} dropped from the mesh`,
        })
      }
    }
  }

  return violations
}
