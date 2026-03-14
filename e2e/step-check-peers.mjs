;(async () => {
  const { state } = await import('./clawser-state.js')
  const localPodId = state.pod.podId
  const remotePeers = (window.__sigPeers || []).filter(p => p !== localPodId)
  return JSON.stringify({ peerCount: remotePeers.length, peers: remotePeers.map(p => p.slice(0, 12)) })
})()
