// Create WebRTC offer — run ONLY on the INITIATOR side
// The other side's webrtc-connect.mjs will auto-handle the offer
;(async () => {
  const conn = window.__rtcConn
  if (!conn) return JSON.stringify({ error: 'run webrtc-connect.mjs first' })

  const ws = window.__sigWs
  const { state } = await import('./clawser-state.js')
  const peers = state.peerNode.listPeers()
  const remotePodId = peers[0].fingerprint

  console.log('[webrtc] creating offer...')
  const offer = await conn.createOffer()
  console.log('[webrtc] offer created, sending via signaling')

  ws.send(JSON.stringify({
    type: 'offer',
    target: remotePodId,
    sdp: offer.sdp,
  }))

  // Wait for connection to establish
  let attempts = 0
  while (!conn.isOpen && attempts < 50) {
    await new Promise(r => setTimeout(r, 200))
    attempts++
  }

  return JSON.stringify({
    ok: conn.isOpen,
    state: conn.state,
    isOpen: conn.isOpen,
    stats: conn.stats,
    attempts,
  })
})()
