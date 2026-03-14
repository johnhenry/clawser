// Test all wired subsystems over WebRTC
;(async () => {
  const { state } = await import('./clawser-state.js')
  const conn = window.__rtcConn
  const peers = state.peerNode.listPeers()
  const remotePodId = peers[0].fingerprint
  const localPodId = state.pod.podId
  const r = {}

  // ── 1. File Transfer — create offer, should route via WebRTC ──
  try {
    const ft = state.fileTransfer
    const offer = ft.createOffer({
      name: 'hello.txt',
      size: 5,
      type: 'text/plain',
      recipient: remotePodId,
    })
    r.fileTransfer = {
      ok: true,
      offerId: offer.transferId,
      transfers: ft.listTransfers().length,
    }
  } catch (e) { r.fileTransfer = { error: e.message } }

  // ── 2. Stream Multiplexer — open a stream ──
  try {
    const sm = state.streamMultiplexer
    const stream = sm.open(remotePodId, { label: 'test' })
    r.streamMux = {
      ok: true,
      streamId: stream.id || stream.streamId,
      streams: sm.listStreams().length,
    }
  } catch (e) { r.streamMux = { error: e.message } }

  // ── 3. Session — send a message through the session ──
  try {
    const session = window.__peerSession
    if (session && typeof session.send === 'function') {
      session.send({ type: 'chat', text: 'Hello via session from ' + localPodId.slice(0, 8) })
      r.session = { ok: true, sent: true }
    } else {
      r.session = { ok: false, hasSession: !!session, hasSend: typeof session?.send }
    }
  } catch (e) { r.session = { error: e.message } }

  // ── 4. Mesh Router — route a message ──
  try {
    const mr = state.meshRouter
    const result = mr.route(remotePodId, {
      type: 'ping',
      from: localPodId,
      timestamp: Date.now(),
    })
    r.router = { ok: true, result }
    r.routerState = {
      routes: mr.listRoutes().length,
      directPeers: mr.listDirectPeers().length,
    }
  } catch (e) { r.router = { error: e.message } }

  // ── 5. Health Monitor — check peer health ──
  try {
    const health = state.healthMonitor.getPeerHealth(remotePodId)
    r.health = { ok: true, ...health }
  } catch (e) { r.health = { error: e.message } }

  // ── 6. ACL — check permissions ──
  try {
    const acl = state.meshACL
    r.acl = {
      ok: true,
      entries: acl.listEntries().length,
      checkRead: acl.check(remotePodId, 'read'),
      checkWrite: acl.check(remotePodId, 'write'),
    }
  } catch (e) { r.acl = { error: e.message } }

  // ── 7. Gateway — check connectivity ──
  try {
    const gn = state.gatewayNode
    const canRoute = gn.canRoute(remotePodId)
    r.gateway = {
      ok: true,
      canRoute,
      stats: typeof gn.stats === 'function' ? gn.stats() : gn.stats,
    }
  } catch (e) { r.gateway = { error: e.message } }

  // ── 8. Raw WebRTC stats ──
  r.webrtc = {
    state: conn.state,
    isOpen: conn.isOpen,
    stats: conn.stats,
  }

  // ── 9. Received messages so far ──
  r.receivedMessages = (window.__rtcMessages || []).length

  return JSON.stringify(r, null, 2)
})()
