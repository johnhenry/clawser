// Exercise ALL mesh features between peers
;(async () => {
  const { state } = await import('./clawser-state.js')
  const podId = state.pod.podId
  const shortId = podId.slice(0, 8)
  const peers = state.peerNode.listPeers()
  const peerFp = peers.length > 0 ? peers[0].fingerprint : null
  const results = {}

  // ── 1. MESH CHAT ──
  try {
    const mc = state.meshChat
    const rooms = mc.listRooms()
    const roomId = rooms.length > 0 ? rooms[0].id : mc.createRoom('p2p-chat').id

    // Subscribe for incoming
    mc.subscribe(roomId, function(msg) {
      window.__chatInbox = window.__chatInbox || []
      window.__chatInbox.push({ from: msg.sender, body: msg.body, type: msg.type })
    })

    // Send a text message
    const sent = mc.send(roomId, 'text', 'Hello from ' + shortId)
    results.chat = {
      ok: true,
      roomId: roomId,
      sent: { id: sent.id, body: sent.body, sender: sent.sender },
      stats: mc.getStats(),
    }
  } catch (e) { results.chat = { error: e.message } }

  // ── 2. FILE TRANSFER ──
  try {
    const ft = state.fileTransfer

    // Create a file offer for the peer
    if (peerFp) {
      const offer = ft.createOffer({
        name: 'test-file.txt',
        size: 13,
        type: 'text/plain',
        recipient: peerFp,
      })
      results.fileTransfer = {
        ok: true,
        offerId: offer ? offer.id || offer.offerId : null,
        offer: offer,
        transfers: ft.listTransfers(),
      }
    } else {
      results.fileTransfer = { ok: false, reason: 'no peer connected' }
    }
  } catch (e) { results.fileTransfer = { error: e.message } }

  // ── 3. SERVICE DIRECTORY ──
  try {
    const sd = state.serviceDirectory

    // Register a test service
    sd.register({
      name: 'echo-' + shortId,
      type: 'echo',
      podId: podId,
      endpoint: 'local',
      metadata: { version: '1.0' },
    })

    results.serviceDirectory = {
      ok: true,
      local: sd.listLocal(),
      remote: sd.listRemote(),
      all: sd.listAll(),
    }
  } catch (e) { results.serviceDirectory = { error: e.message } }

  // ── 4. SESSION MANAGER ──
  try {
    const sm = state.sessionManager

    if (peerFp) {
      const session = sm.createSession(peerFp, { purpose: 'e2e-test' })
      results.sessionManager = {
        ok: true,
        sessionId: session ? session.id || session.sessionId : null,
        session: session,
        sessions: sm.listSessions(),
        size: sm.size(),
      }
    } else {
      results.sessionManager = { ok: false, reason: 'no peer' }
    }
  } catch (e) { results.sessionManager = { error: e.message } }

  // ── 5. HEALTH MONITOR ──
  try {
    const hm = state.healthMonitor

    if (peerFp) {
      hm.recordHeartbeat(peerFp, { latency: 42 })
      const health = hm.getPeerHealth(peerFp)
      results.healthMonitor = {
        ok: true,
        peerHealth: health,
        status: hm.getStatus(),
      }
    } else {
      results.healthMonitor = { ok: false, reason: 'no peer' }
    }
  } catch (e) { results.healthMonitor = { error: e.message } }

  // ── 6. STREAM MULTIPLEXER ──
  try {
    const sm = state.streamMultiplexer

    // Open a stream to the peer
    if (peerFp) {
      const stream = sm.open(peerFp, { label: 'test-stream' })
      results.streamMultiplexer = {
        ok: true,
        streamId: stream ? stream.id || stream.streamId : null,
        stream: stream,
        activeCount: sm.activeCount(),
        streams: sm.listStreams(),
      }
    } else {
      results.streamMultiplexer = { ok: false, reason: 'no peer' }
    }
  } catch (e) { results.streamMultiplexer = { error: e.message } }

  // ── 7. MESH ROUTER ──
  try {
    const mr = state.meshRouter
    results.meshRouter = {
      ok: true,
      routes: mr.listRoutes(),
      directPeers: mr.listDirectPeers(),
    }
    // Test routing a message
    if (peerFp) {
      const routed = mr.route(peerFp, { type: 'test', data: 'hello' })
      results.meshRouter.routed = routed
    }
  } catch (e) { results.meshRouter = { error: e.message } }

  // ── 8. MESH ACL ──
  try {
    const acl = state.meshACL

    // List templates
    results.meshACL = {
      ok: true,
      templates: acl.listTemplates(),
      entries: acl.listEntries(),
    }

    // Add an entry for the peer
    if (peerFp) {
      acl.addEntry(peerFp, { permissions: ['read', 'chat'] })
      results.meshACL.entries = acl.listEntries()
      results.meshACL.checkRead = acl.check(peerFp, 'read')
      results.meshACL.checkWrite = acl.check(peerFp, 'write')
    }
  } catch (e) { results.meshACL = { error: e.message } }

  // ── 9. AUDIT CHAIN ──
  try {
    const ac = state.auditChain
    ac.append({ action: 'e2e-test', actor: podId, data: 'test entry' })
    results.auditChain = {
      ok: true,
      length: ac.length,
      lastEntry: ac.get(ac.length - 1),
      verified: ac.verify(),
    }
  } catch (e) { results.auditChain = { error: e.message } }

  // ── 10. MESH SCHEDULER ──
  try {
    const ms = state.meshScheduler

    // Submit a task
    const task = ms.submit({
      type: 'compute',
      payload: { operation: 'echo', input: 'hello from ' + shortId },
      priority: 1,
    })

    results.meshScheduler = {
      ok: true,
      taskId: task ? task.id || task.taskId : null,
      task: task,
      queueDepth: ms.getQueueDepth(),
      runningCount: ms.getRunningCount(),
      stats: ms.getStats(),
    }
  } catch (e) { results.meshScheduler = { error: e.message } }

  // ── 11. SWARM COORDINATOR ──
  try {
    const sc = state.swarmCoordinator
    results.swarmCoordinator = {
      ok: true,
      swarmSize: sc.swarmSize(),
      isLeader: sc.isLeader(),
    }
  } catch (e) { results.swarmCoordinator = { error: e.message } }

  // ── 12. CONSENSUS MANAGER ──
  try {
    const cm = state.consensusManager

    const proposal = cm.propose({
      topic: 'test-vote',
      description: 'E2E test proposal from ' + shortId,
      options: ['yes', 'no'],
      ttl: 60000,
    })

    results.consensusManager = {
      ok: true,
      proposalId: proposal ? proposal.id || proposal.proposalId : null,
      proposal: proposal,
      proposals: cm.listProposals(),
    }
  } catch (e) { results.consensusManager = { error: e.message } }

  // ── 13. GATEWAY NODE ──
  try {
    const gn = state.gatewayNode
    results.gatewayNode = {
      ok: true,
      localPodId: gn.localPodId(),
      isRelay: gn.isRelayEnabled(),
      connectedPeers: gn.connectedPeers(),
      routeTable: gn.routeTable(),
      stats: gn.stats(),
    }
  } catch (e) { results.gatewayNode = { error: e.message } }

  // ── 14. TORRENT MANAGER ──
  try {
    const tm = state.torrentManager
    results.torrentManager = {
      ok: true,
      available: tm.available(),
      torrents: tm.listTorrents(),
      stats: tm.getStats(),
    }
  } catch (e) { results.torrentManager = { error: e.message } }

  return JSON.stringify(results, null, 2)
})()
