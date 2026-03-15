;(async () => {
  const { state } = await import('./clawser-state.js')
  const { SwimMembership } = await import('./clawser-mesh-swarm.js')
  const localPodId = state.pod.podId
  const conns = window.__rtcConns || {}
  const peers = Object.keys(conns).filter(rp => conns[rp].isOpen)

  const pingIntervalMs = window.__swimPingInterval || 500
  const pingTimeoutMs = window.__swimPingTimeout || 300
  const suspectTimeoutMs = window.__swimSuspectTimeout || 2000

  // Create SWIM instance with sendFn that routes through WebRTC
  const swim = new SwimMembership({
    localId: localPodId,
    sendFn: (targetId, msg) => {
      const conn = conns[targetId]
      if (conn && conn.isOpen) {
        conn.send({ _mesh: 'swim', target: targetId, payload: msg })
      }
    },
    pingIntervalMs,
    pingTimeoutMs,
    suspectTimeoutMs,
    onJoin: (podId) => {
      window.__swimEvents = window.__swimEvents || []
      window.__swimEvents.push({ type: 'join', podId, ts: Date.now() })
    },
    onSuspect: (podId) => {
      window.__swimEvents = window.__swimEvents || []
      window.__swimEvents.push({ type: 'suspect', podId, ts: Date.now() })
    },
    onDead: (podId) => {
      window.__swimEvents = window.__swimEvents || []
      window.__swimEvents.push({ type: 'dead', podId, ts: Date.now() })
    },
    onLeave: (podId) => {
      window.__swimEvents = window.__swimEvents || []
      window.__swimEvents.push({ type: 'leave', podId, ts: Date.now() })
    },
  })

  // Add all connected peers as members
  for (const rp of peers) {
    swim.addMember(rp)
  }

  // Wire WebRTC message handler to route SWIM messages
  const origHandler = window.__sigWs?.onmessage
  // Patch rtc message handler to also handle SWIM messages
  for (const [rp, conn] of Object.entries(conns)) {
    const existingOnMsg = conn._e2eOnMessage
    conn._e2eOnMessage = (data) => {
      if (existingOnMsg) existingOnMsg(data)
      if (data && data._mesh === 'swim') {
        swim.handleMessage(rp, data.payload)
      }
    }
    // Re-wire the onMessage handler to include SWIM dispatch
    conn.onMessage((data) => {
      window.__rtcMessages = window.__rtcMessages || []
      window.__rtcMessages.push({ from: rp.slice(0, 12), data })
      // Existing mesh dispatches
      if (data && data._mesh === 'file-transfer') state.fileTransfer.dispatch(data.payload)
      else if (data && data._mesh === 'stream-mux') state.streamMultiplexer.dispatch(data.payload)
      else if (data && data._mesh === 'router') state.meshRouter.handleRoutedMessage(data.payload)
      else if (data && data._mesh === 'swim') swim.handleMessage(rp, data.payload)
    })
  }

  // Start SWIM
  swim.start()

  window.__swim = swim
  window.__swimEvents = []

  return JSON.stringify({
    wired: true,
    localId: localPodId.slice(0, 12),
    memberCount: swim.size,
    aliveCount: swim.aliveCount,
    peers: peers.map(p => p.slice(0, 12)),
  })
})()
