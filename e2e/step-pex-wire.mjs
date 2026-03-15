// Wire PexStrategy on this browser.
// Creates a PexStrategy, adds it to the DiscoveryManager, and registers
// all currently-connected WebRTC peers with send functions.
// Also sets up an onDiscovered callback that stores discovered podIds.
;(async () => {
  const { state } = await import('./clawser-state.js')
  const { PexStrategy } = await import('./clawser-mesh-discovery.js')

  const localPodId = state.pod.podId
  const results = { localPodId: localPodId.slice(0, 12), steps: [] }

  // Create PexStrategy if not already created
  if (!window.__pex) {
    const pex = new PexStrategy({ localId: localPodId, exchangeIntervalMs: 2000 })
    state.discoveryManager.addStrategy(pex)
    await pex.start()
    window.__pex = pex

    // Track peers discovered via PEX
    window.__pexDiscovered = []
    pex.onDiscovered((record) => {
      if (!window.__pexDiscovered.includes(record.podId)) {
        window.__pexDiscovered.push(record.podId)
        console.log('[pex] discovered:', record.podId.slice(0, 12), 'source:', record.source)
      }
    })

    results.steps.push('pex created')
  } else {
    results.steps.push('pex already exists')
  }

  // Register all open WebRTC connections with PEX
  const conns = window.__rtcConns || {}
  for (const [remotePodId, conn] of Object.entries(conns)) {
    if (!conn.isOpen) continue
    window.__pex.addPeer(remotePodId, (msg) => {
      conn.send(msg)
    })
    results.steps.push('pex addPeer: ' + remotePodId.slice(0, 12))
  }

  results.knownPeers = window.__pex.knownPeers().map(p => p.slice(0, 12))
  results.connectedCount = window.__pex.connectedCount
  results.pexDiscovered = (window.__pexDiscovered || []).map(p => p.slice(0, 12))

  return JSON.stringify(results, null, 2)
})()
