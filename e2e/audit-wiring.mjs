// Audit what each subsystem needs to work cross-peer
;(async () => {
  const { state } = await import('./clawser-state.js')
  const peers = state.peerNode.listPeers()
  const peerFp = peers.length > 0 ? peers[0].fingerprint : null
  const r = {}

  // What does each subsystem use to send data to peers?

  // 1. PeerNode — does it have a transport registered?
  try {
    const pn = state.peerNode
    r.peerNode = {
      methods: Object.getOwnPropertyNames(Object.getPrototypeOf(pn)).filter(m => m !== 'constructor'),
      peerCount: pn.listPeers().length,
      hasTransport: typeof pn.send === 'function',
      hasBroadcast: typeof pn.broadcast === 'function',
    }
  } catch (e) { r.peerNode = { error: e.message } }

  // 2. TransportNegotiator — what adapters are registered?
  try {
    const tn = state.transportNegotiator
    r.transportNegotiator = {
      methods: Object.getOwnPropertyNames(Object.getPrototypeOf(tn)).filter(m => m !== 'constructor'),
    }
  } catch (e) { r.transportNegotiator = { error: e.message } }

  // 3. TransportFactory
  try {
    const tf = state.transportFactory
    r.transportFactory = {
      available: !!tf,
      methods: tf ? Object.getOwnPropertyNames(Object.getPrototypeOf(tf)).filter(m => m !== 'constructor') : [],
    }
  } catch (e) { r.transportFactory = { error: e.message } }

  // 4. SessionManager — what does createSession need?
  try {
    const sm = state.sessionManager
    r.sessionManager = {
      methods: sm ? Object.getOwnPropertyNames(Object.getPrototypeOf(sm)).filter(m => m !== 'constructor') : [],
    }
    // Try creating with a mock transport
    if (peerFp) {
      const mockTransport = { send: (d) => console.log('[mock-transport]', d) }
      const sess = sm.createSession(peerFp, { transport: mockTransport, purpose: 'test' })
      r.sessionManager.sessionCreated = !!sess
      r.sessionManager.session = sess ? { id: sess.id || sess.sessionId, peer: sess.peerId || sess.peer } : null
    }
  } catch (e) { r.sessionManager = { ...r.sessionManager, createError: e.message } }

  // 5. MeshChat — how does it deliver messages to remote peers?
  try {
    const mc = state.meshChat
    r.meshChat = {
      hasOnSend: typeof mc._onSend === 'function' || typeof mc.onSend === 'function',
      hasSendCallback: !!mc._sendCallback,
    }
    // Check if there's a way to set a send transport
    const proto = Object.getOwnPropertyNames(Object.getPrototypeOf(mc))
    r.meshChat.allMethods = proto
  } catch (e) { r.meshChat = { error: e.message } }

  // 6. FileTransfer — how does it send chunks?
  try {
    const ft = state.fileTransfer
    r.fileTransfer = {
      hasOnSend: typeof ft._onSend === 'function' || typeof ft.onSend === 'function',
    }
    const proto = Object.getOwnPropertyNames(Object.getPrototypeOf(ft))
    r.fileTransfer.allMethods = proto
  } catch (e) { r.fileTransfer = { error: e.message } }

  // 7. StreamMultiplexer — how does it send frames?
  try {
    const sm = state.streamMultiplexer
    r.streamMultiplexer = {
      hasOnSend: typeof sm._onSend === 'function' || typeof sm.onSend === 'function',
    }
    const proto = Object.getOwnPropertyNames(Object.getPrototypeOf(sm))
    r.streamMultiplexer.allMethods = proto
  } catch (e) { r.streamMultiplexer = { error: e.message } }

  // 8. MeshRouter — how does it forward messages?
  try {
    const mr = state.meshRouter
    r.meshRouter = {
      hasOnSend: typeof mr._onSend === 'function' || typeof mr.onSend === 'function',
      hasSendFn: typeof mr._sendFn === 'function',
    }
    const proto = Object.getOwnPropertyNames(Object.getPrototypeOf(mr))
    r.meshRouter.allMethods = proto
  } catch (e) { r.meshRouter = { error: e.message } }

  // 9. HandshakeCoordinator
  try {
    const hc = state.handshakeCoordinator
    r.handshakeCoordinator = {
      available: !!hc,
      methods: hc ? Object.getOwnPropertyNames(Object.getPrototypeOf(hc)).filter(m => m !== 'constructor') : [],
    }
  } catch (e) { r.handshakeCoordinator = { error: e.message } }

  // 10. GatewayNode — does it have relay capability?
  try {
    const gn = state.gatewayNode
    r.gatewayNode = {
      connectedPeers: typeof gn.connectedPeers === 'function' ? gn.connectedPeers() : gn.connectedPeers,
      routeTable: typeof gn.routeTable === 'function' ? gn.routeTable() : gn.routeTable,
    }
  } catch (e) { r.gatewayNode = { error: e.message } }

  // 11. Check what onSend callbacks look like on fileTransfer
  try {
    const ft = state.fileTransfer
    // onSend registers a callback that fileTransfer uses to emit offers/chunks
    r.fileTransferOnSend = {
      type: typeof ft.onSend,
      desc: 'ft.onSend(cb) registers callback: cb(peerId, envelope) to send data',
    }
  } catch (e) { r.fileTransferOnSend = { error: e.message } }

  // 12. Check streamMultiplexer onSend
  try {
    const sm = state.streamMultiplexer
    r.streamMuxOnSend = {
      type: typeof sm.onSend,
      desc: 'sm.onSend(cb) registers callback: cb(peerId, frame) to send data',
    }
  } catch (e) { r.streamMuxOnSend = { error: e.message } }

  return JSON.stringify(r, null, 2)
})()
