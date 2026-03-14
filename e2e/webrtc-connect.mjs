// WebRTC connection script — inject into BOTH browsers
// Sets up WebRTC DataChannel via signaling server
// Usage: agent-browser --session X eval "$(cat e2e/webrtc-connect.mjs)"
;(async () => {
  const { state } = await import('./clawser-state.js')
  const { WebRTCPeerConnection } = await import('./clawser-mesh-webrtc.js')

  const localPodId = state.pod.podId
  const peers = state.peerNode.listPeers()
  if (peers.length === 0) return JSON.stringify({ error: 'no peers' })

  const remotePodId = peers[0].fingerprint
  const ws = window.__sigWs
  if (!ws || ws.readyState !== 1) return JSON.stringify({ error: 'signaling WS not connected' })

  // Create WebRTC peer connection
  const conn = new WebRTCPeerConnection({
    localPodId,
    remotePodId,
    iceServers: [{ urls: 'stun:stun.l.google.com:19302' }],
    onLog: (msg) => console.log('[webrtc]', msg),
  })

  // Store globally for access
  window.__rtcConn = conn

  // Wire ICE candidates through signaling
  conn.onIceCandidate((candidate) => {
    ws.send(JSON.stringify({
      type: 'ice-candidate',
      target: remotePodId,
      candidate,
    }))
  })

  // Listen for signaling messages from the remote peer
  const origOnMessage = ws.onmessage
  ws.onmessage = async (event) => {
    // Call original handler first
    if (origOnMessage) origOnMessage.call(ws, event)

    const msg = JSON.parse(event.data)

    if (msg.type === 'offer' && msg.source === remotePodId) {
      console.log('[webrtc] received offer from', msg.source)
      const answer = await conn.handleOffer({ type: 'offer', sdp: msg.sdp })
      ws.send(JSON.stringify({
        type: 'answer',
        target: remotePodId,
        sdp: answer.sdp,
      }))
      console.log('[webrtc] sent answer')
    }

    if (msg.type === 'answer' && msg.source === remotePodId) {
      console.log('[webrtc] received answer from', msg.source)
      await conn.handleAnswer({ type: 'answer', sdp: msg.sdp })
    }

    if (msg.type === 'ice-candidate' && msg.source === remotePodId) {
      await conn.addIceCandidate(msg.candidate)
    }
  }

  // Listen for messages on the DataChannel
  conn.onMessage((data) => {
    console.log('[webrtc] received:', data)
    window.__rtcMessages = window.__rtcMessages || []
    window.__rtcMessages.push(data)
  })

  conn.onClose(() => console.log('[webrtc] connection closed'))
  conn.onError((err) => console.error('[webrtc] error:', err))

  // Expose send helper
  window.__rtcSend = (data) => {
    if (conn.isOpen) {
      conn.send(data)
      return true
    }
    return false
  }

  return JSON.stringify({
    ok: true,
    localPodId: localPodId.slice(0, 12),
    remotePodId: remotePodId.slice(0, 12),
    state: conn.state,
    note: 'Ready. One side must call createOffer to initiate.',
  })
})()
