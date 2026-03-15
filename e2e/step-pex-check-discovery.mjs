// Check what PEX has discovered on this browser.
// Returns the list of all PEX-discovered peers, known peers, and
// the signaling-visible peers for comparison.
;(async () => {
  const { state } = await import('./clawser-state.js')
  const localPodId = state.pod.podId

  const pexDiscovered = (window.__pexDiscovered || [])
  const sigPeers = (window.__sigPeers || []).filter(p => p !== localPodId)
  const knownPeers = window.__pex ? window.__pex.knownPeers() : []
  const rtcConns = Object.keys(window.__rtcConns || {})

  return JSON.stringify({
    localPodId: localPodId.slice(0, 12),
    pexDiscovered: pexDiscovered.map(p => p.slice(0, 12)),
    pexDiscoveredFull: pexDiscovered,
    sigPeers: sigPeers.map(p => p.slice(0, 12)),
    sigPeersFull: sigPeers,
    knownPeers: knownPeers.map(p => p.slice(0, 12)),
    rtcConnections: rtcConns.map(p => p.slice(0, 12)),
    pexDiscoveredCount: pexDiscovered.length,
    sigPeerCount: sigPeers.length,
  }, null, 2)
})()
