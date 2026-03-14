;(async () => {
  const { state } = await import('./clawser-state.js')
  const hm = state.healthMonitor
  const peers = state.peerNode.listPeers()
  let healthyPeers = 0
  for (const p of peers) {
    hm.recordHeartbeat(p.fingerprint, { latency: 10 })
    const h = hm.getPeerHealth(p.fingerprint)
    if (h && h.status === 'healthy') healthyPeers++
  }
  return JSON.stringify({ healthyPeers, totalPeers: peers.length })
})()
