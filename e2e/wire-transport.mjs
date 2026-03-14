// Wire the WebRTC DataChannel as the mesh transport for all subsystems
// Run on BOTH browsers after webrtc-connect + webrtc-offer
;(async () => {
  const { state } = await import('./clawser-state.js')
  const conn = window.__rtcConn
  if (!conn || !conn.isOpen) return JSON.stringify({ error: 'WebRTC not connected' })

  const localPodId = state.pod.podId
  const peers = state.peerNode.listPeers()
  const remotePodId = peers[0].fingerprint
  const wired = []
  const errors = []

  // ── Create a transport object wrapping the WebRTC DataChannel ──
  const transport = {
    send(data) {
      if (conn.isOpen) {
        conn.send(data)
        return true
      }
      return false
    },
    onMessage(cb) {
      conn.onMessage(cb)
    },
    close() {
      conn.close()
    },
    get connected() { return conn.isOpen },
  }
  window.__meshTransport = transport

  // ── 1. FileTransfer — wire onSend to route through WebRTC ──
  try {
    state.fileTransfer.onSend((msg) => {
      conn.send({ _mesh: 'file-transfer', payload: msg })
    })
    wired.push('fileTransfer.onSend')
  } catch (e) { errors.push('fileTransfer: ' + e.message) }

  // ── 2. StreamMultiplexer — wire onSend ──
  try {
    state.streamMultiplexer.onSend((msg) => {
      conn.send({ _mesh: 'stream-mux', payload: msg })
    })
    wired.push('streamMultiplexer.onSend')
  } catch (e) { errors.push('streamMultiplexer: ' + e.message) }

  // ── 3. SessionManager — create a real session with the transport ──
  try {
    const sm = state.sessionManager
    const session = sm.createSession(remotePodId, transport, [])
    window.__peerSession = session
    wired.push('sessionManager.createSession (id: ' + (session.id || session.sessionId || 'ok') + ')')
  } catch (e) { errors.push('sessionManager: ' + e.message) }

  // ── 4. MeshRouter — register the peer as a direct peer ──
  try {
    state.meshRouter.addDirectPeer(remotePodId, {
      send(msg) { conn.send({ _mesh: 'router', payload: msg }) },
    })
    // Re-add the route (may have expired)
    state.meshRouter.addRoute(remotePodId, remotePodId, 1)
    wired.push('meshRouter.addDirectPeer + addRoute')
  } catch (e) { errors.push('meshRouter: ' + e.message) }

  // ── 5. GatewayNode — register peer ──
  try {
    const gn = state.gatewayNode
    gn.registerPeer(remotePodId, {
      send(msg) { conn.send({ _mesh: 'gateway', payload: msg }) },
    })
    wired.push('gatewayNode.registerPeer')
  } catch (e) { errors.push('gatewayNode: ' + e.message) }

  // ── 6. HealthMonitor — start with the peer ──
  try {
    state.healthMonitor.recordHeartbeat(remotePodId, { latency: 5 })
    wired.push('healthMonitor.recordHeartbeat')
  } catch (e) { errors.push('healthMonitor: ' + e.message) }

  // ── 7. ServiceDirectory — register a test service ──
  try {
    const sd = state.serviceDirectory
    sd.register(localPodId.slice(0, 8) + '-echo', 'echo', localPodId, { version: '1.0' })
    wired.push('serviceDirectory.register')
  } catch (e) { errors.push('serviceDirectory: ' + e.message) }

  // ── 8. MeshACL — grant peer permissions ──
  try {
    const acl = state.meshACL
    // First check what templates exist
    const templates = acl.listTemplates()
    if (templates.length > 0) {
      acl.addEntry(remotePodId, templates[0].name || templates[0])
      wired.push('meshACL.addEntry (template: ' + (templates[0].name || templates[0]) + ')')
    } else {
      // Add a template first
      acl.addTemplate('peer-default', { read: true, write: true, execute: false })
      acl.addEntry(remotePodId, 'peer-default')
      wired.push('meshACL.addTemplate + addEntry')
    }
  } catch (e) { errors.push('meshACL: ' + e.message) }

  // ── 9. ConsensusManager — requires authorPodId ──
  try {
    const cm = state.consensusManager
    const proposal = cm.propose(localPodId, 'greeting', {
      description: 'Should we say hello?',
      options: ['yes', 'no'],
      ttl: 60000,
    })
    wired.push('consensusManager.propose (id: ' + (proposal.id || proposal.proposalId || 'ok') + ')')
  } catch (e) { errors.push('consensusManager: ' + e.message) }

  // ── 10. Wire incoming WebRTC messages to the right subsystem ──
  conn.onMessage((data) => {
    // Route mesh messages to the right subsystem
    if (data && data._mesh === 'file-transfer') {
      state.fileTransfer.dispatch(data.payload)
    } else if (data && data._mesh === 'stream-mux') {
      state.streamMultiplexer.dispatch(data.payload)
    } else if (data && data._mesh === 'router') {
      state.meshRouter.handleRoutedMessage(data.payload)
    } else {
      // Generic message — store it
      window.__rtcMessages = window.__rtcMessages || []
      window.__rtcMessages.push(data)
    }
  })
  wired.push('incoming message router')

  return JSON.stringify({ wired, errors }, null, 2)
})()
