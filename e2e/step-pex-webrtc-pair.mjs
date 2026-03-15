// Establish WebRTC DataChannel with each peer discovered via signaling.
// This is a simplified version of full-mesh-connect.mjs that only connects
// to __sigPeers (filtered by allow list) and wires PEX message routing.
;(async () => {
  const { state } = await import('./clawser-state.js')
  const { WebRTCPeerConnection } = await import('./clawser-mesh-webrtc.js')
  const { ManualStrategy, DiscoveryRecord } = await import('./clawser-mesh-discovery.js')

  const localPodId = state.pod.podId
  const results = { localPodId: localPodId.slice(0, 12), steps: [] }

  // Register signaling-discovered peers in PeerNode
  const remotePeers = (window.__sigPeers || []).filter(p => p !== localPodId)
  if (!window.__manualStrategy) {
    const ms = new ManualStrategy()
    state.discoveryManager.addStrategy(ms)
    window.__manualStrategy = ms
  }

  for (const rp of remotePeers) {
    if (state.peerNode.listPeers().find(p => p.fingerprint === rp)) continue
    window.__manualStrategy.addPeer(new DiscoveryRecord({
      podId: rp, label: rp.slice(0, 8), transport: 'webrtc', source: 'manual',
    }))
    state.peerNode.addPeer(rp, rp.slice(0, 8), [])
    await state.peerNode.connectToPeer(rp, {})
    results.steps.push('registered peer: ' + rp.slice(0, 12))
  }

  // Set up WebRTC connections
  window.__rtcConns = window.__rtcConns || {}
  window.__rtcMessages = window.__rtcMessages || []
  const ws = window.__sigWs

  // Override WS handler for signaling relay
  ws.onmessage = async (event) => {
    const msg = JSON.parse(event.data)

    if (msg.type === 'registered') window.__sigRegistered = true
    if (msg.type === 'peers') {
      const allowList = window.__sigAllowList || []
      window.__sigPeers = msg.peers.filter(p => allowList.includes(p))
    }
    if (msg.type === 'peer-joined') {
      const allowList = window.__sigAllowList || []
      if (allowList.includes(msg.podId) && !window.__sigPeers.includes(msg.podId)) {
        window.__sigPeers.push(msg.podId)
      }
    }
    if (msg.type === 'peer-left') window.__sigPeers = window.__sigPeers.filter(p => p !== msg.podId)

    // WebRTC signaling
    if (msg.type === 'offer' && msg.source) {
      let conn = window.__rtcConns[msg.source]
      if (!conn) {
        conn = new WebRTCPeerConnection({
          localPodId, remotePodId: msg.source,
          iceServers: [{ urls: 'stun:stun.l.google.com:19302' }],
        })
        wireConn(conn, msg.source)
        window.__rtcConns[msg.source] = conn
      }
      const answer = await conn.handleOffer({ type: 'offer', sdp: msg.sdp })
      ws.send(JSON.stringify({ type: 'answer', target: msg.source, sdp: answer.sdp }))
    }
    if (msg.type === 'answer' && msg.source) {
      const conn = window.__rtcConns[msg.source]
      if (conn) await conn.handleAnswer({ type: 'answer', sdp: msg.sdp })
    }
    if (msg.type === 'ice-candidate' && msg.source) {
      const conn = window.__rtcConns[msg.source]
      if (conn) await conn.addIceCandidate(msg.candidate)
    }
  }

  function wireConn(conn, remotePodId) {
    conn.onIceCandidate((candidate) => {
      ws.send(JSON.stringify({ type: 'ice-candidate', target: remotePodId, candidate }))
    })
    conn.onMessage((data) => {
      window.__rtcMessages.push({ from: remotePodId.slice(0, 12), data })
      // Route PEX messages to the PexStrategy
      if (data && data.type === 'pex-exchange' && window.__pex) {
        window.__pex.handleMessage(data.from, data)
      }
    })
    conn.onClose(() => console.log('[webrtc] closed:', remotePodId.slice(0, 12)))
  }

  // Initiate offers
  for (const rp of remotePeers) {
    if (window.__rtcConns[rp]) {
      results.steps.push('webrtc: already connected to ' + rp.slice(0, 12))
      continue
    }

    const conn = new WebRTCPeerConnection({
      localPodId, remotePodId: rp,
      iceServers: [{ urls: 'stun:stun.l.google.com:19302' }],
    })
    wireConn(conn, rp)
    window.__rtcConns[rp] = conn

    const offer = await conn.createOffer()
    ws.send(JSON.stringify({ type: 'offer', target: rp, sdp: offer.sdp }))

    // Wait for connection
    let attempts = 0
    while (!conn.isOpen && attempts < 30) {
      await new Promise(r => setTimeout(r, 200))
      attempts++
    }
    results.steps.push('webrtc ' + rp.slice(0, 12) + ': ' + (conn.isOpen ? 'connected' : 'timeout'))
  }

  const allConns = Object.entries(window.__rtcConns)
  results.connectedPeers = allConns.filter(([, c]) => c.isOpen).map(([id]) => id.slice(0, 12))
  return JSON.stringify(results, null, 2)
})()
