;(async () => {
  const { state } = await import('./clawser-state.js')
  const mr = state.meshRouter
  const routes = mr.listRoutes().length
  const directPeers = mr.listDirectPeers().length
  const peers = state.peerNode.listPeers()
  let routeSuccess = false
  if (peers.length > 0) {
    const r = mr.route(peers[0].fingerprint, { type: 'test', ts: Date.now() })
    routeSuccess = r && r.success === true
  }
  return JSON.stringify({ routes, directPeers, routeSuccess })
})()
