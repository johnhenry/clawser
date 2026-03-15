;(async () => {
  const { state } = await import('./clawser-state.js')
  const localPodId = state.pod.podId
  const mr = state.meshRouter
  const peers = Object.keys(window.__rtcConns || {}).filter(
    rp => window.__rtcConns[rp].isOpen
  )
  if (peers.length === 0) return JSON.stringify({ error: 'no connected peers' })

  const target = peers[0]

  // Route a test message to the target peer
  const result = mr.route(target, {
    type: 'e2e-router-test',
    from: localPodId,
    ts: Date.now(),
    body: 'hello-from-router',
  })

  return JSON.stringify({
    routeResult: result,
    targetPodId: target.slice(0, 12),
    routes: mr.listRoutes().length,
    directPeers: mr.listDirectPeers().length,
  })
})()
