// Full mesh connection: signaling + WebRTC + all subsystems
// Run on each browser. The first to run will be the "listener",
// subsequent ones will initiate offers.
;(async () => {
  const { state } = await import('./clawser-state.js')
  const { WebRTCPeerConnection } = await import('./clawser-mesh-webrtc.js')
  const { ManualStrategy, DiscoveryRecord } = await import('./clawser-mesh-discovery.js')

  const localPodId = state.pod.podId
  const signalingPort = window.__sigPort || 8787
  const results = { localPodId: localPodId.slice(0, 12), steps: [] }

  // ── 1. Connect to signaling server ──
  if (window.__sigWs && window.__sigWs.readyState === 1) {
    results.steps.push('signaling: already connected')
  } else {
    const ws = new WebSocket('ws://127.0.0.1:' + signalingPort)
    await new Promise((resolve, reject) => {
      ws.onopen = () => {
        ws.send(JSON.stringify({ type: 'register', podId: localPodId }))
        resolve()
      }
      ws.onerror = reject
      setTimeout(reject, 5000)
    })
    window.__sigWs = ws
    window.__sigPeers = []
    window.__sigRegistered = false

    ws.onmessage = (event) => {
      const msg = JSON.parse(event.data)
      if (msg.type === 'registered') window.__sigRegistered = true
      if (msg.type === 'peers') window.__sigPeers = msg.peers
      if (msg.type === 'peer-joined' && !window.__sigPeers.includes(msg.podId)) window.__sigPeers.push(msg.podId)
      if (msg.type === 'peer-left') window.__sigPeers = window.__sigPeers.filter(p => p !== msg.podId)
    }
    await new Promise(r => setTimeout(r, 500))
    results.steps.push('signaling: connected, peers=' + window.__sigPeers.length)
  }

  // ── 2. Discover remote peers via signaling ──
  const remotePeers = window.__sigPeers.filter(p => p !== localPodId)
  results.remotePeers = remotePeers.map(p => p.slice(0, 12))

  // ── 3. Add ManualStrategy + register each peer ──
  if (!window.__manualStrategy) {
    const ms = new ManualStrategy()
    state.discoveryManager.addStrategy(ms)
    window.__manualStrategy = ms
  }

  for (const rp of remotePeers) {
    // Skip if already known
    if (state.peerNode.listPeers().find(p => p.fingerprint === rp)) continue

    window.__manualStrategy.addPeer(new DiscoveryRecord({
      podId: rp, label: rp.slice(0, 8), transport: 'webrtc', source: 'manual',
    }))
    state.peerNode.addPeer(rp, rp.slice(0, 8), [])
    await state.peerNode.connectToPeer(rp, {})
    results.steps.push('registered peer: ' + rp.slice(0, 12))
  }

  // ── 4. Establish WebRTC with each peer ──
  window.__rtcConns = window.__rtcConns || {}
  window.__rtcMessages = window.__rtcMessages || []

  const ws = window.__sigWs

  // Overwrite WS handler to manage multiple peer connections
  ws.onmessage = async (event) => {
    const msg = JSON.parse(event.data)

    if (msg.type === 'registered') window.__sigRegistered = true
    if (msg.type === 'peers') window.__sigPeers = msg.peers
    if (msg.type === 'peer-joined' && !window.__sigPeers.includes(msg.podId)) window.__sigPeers.push(msg.podId)
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
      // Route mesh messages
      if (data && data._mesh === 'file-transfer') state.fileTransfer.dispatch(data.payload)
      else if (data && data._mesh === 'stream-mux') state.streamMultiplexer.dispatch(data.payload)
      else if (data && data._mesh === 'router') state.meshRouter.handleRoutedMessage(data.payload)
    })
    conn.onClose(() => console.log('[webrtc] closed:', remotePodId.slice(0, 12)))
  }

  // Initiate offers to peers we don't have connections to yet
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

  // ── 5. Wire transport subsystems ──
  for (const [rp, conn] of Object.entries(window.__rtcConns)) {
    if (!conn.isOpen) continue

    // FileTransfer + StreamMux onSend (only once)
    if (!window.__transportWired) {
      state.fileTransfer.onSend((msg) => {
        // Send to all connected peers
        for (const [, c] of Object.entries(window.__rtcConns)) {
          if (c.isOpen) c.send({ _mesh: 'file-transfer', payload: msg })
        }
      })
      state.streamMultiplexer.onSend((msg) => {
        for (const [, c] of Object.entries(window.__rtcConns)) {
          if (c.isOpen) c.send({ _mesh: 'stream-mux', payload: msg })
        }
      })
      window.__transportWired = true
    }

    // Router + Gateway per-peer
    try {
      state.meshRouter.addDirectPeer(rp, {
        send(msg) { conn.send({ _mesh: 'router', payload: msg }) },
      })
      state.meshRouter.addRoute(rp, rp, 1)
    } catch {}

    try { state.gatewayNode.registerPeer(rp, { send(msg) { conn.send({ _mesh: 'gateway', payload: msg }) } }) } catch {}
    try { state.healthMonitor.recordHeartbeat(rp, { latency: 5 }) } catch {}
  }

  // ── 6. Summary ──
  const allConns = Object.entries(window.__rtcConns)
  results.connectedPeers = allConns.filter(([, c]) => c.isOpen).map(([id]) => id.slice(0, 12))
  results.totalPeers = state.peerNode.listPeers().length
  results.routes = state.meshRouter.listRoutes().length

  return JSON.stringify(results, null, 2)
})()
