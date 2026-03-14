// Fix remaining unwired subsystems
;(async () => {
  const { state } = await import('./clawser-state.js')
  const localPodId = state.pod.podId
  const peers = state.peerNode.listPeers()
  const wired = []
  const errors = []

  // ── 1. ServiceDirectory — register(name, type, podId, handler) ──
  try {
    const sd = state.serviceDirectory
    sd.register(
      localPodId.slice(0, 8) + '-echo',
      'echo',
      localPodId,
      async (request) => ({ echo: request })
    )
    const local = sd.listLocal()
    wired.push('serviceDirectory.register (' + local.length + ' local services)')
  } catch (e) { errors.push('serviceDirectory: ' + e.message) }

  // ── 2. ConsensusManager — propose(authorPodId, topic, opts) ──
  try {
    const cm = state.consensusManager
    const proposal = cm.propose(localPodId, 'mesh-greeting', {
      description: 'Should peers say hello?',
      options: ['yes', 'no', 'abstain'],
      ttl: 120000,
    })
    wired.push('consensusManager.propose (id: ' + (proposal.id || proposal.proposalId || JSON.stringify(proposal).slice(0, 40)) + ')')

    // Vote on it
    const voteResult = cm.vote(proposal.id || proposal.proposalId, localPodId, 'yes')
    wired.push('consensusManager.vote: ' + JSON.stringify(voteResult))
  } catch (e) { errors.push('consensusManager: ' + e.message) }

  // ── 3. MeshACL — create a proper template with scopes ──
  try {
    const acl = state.meshACL
    // Add a permissive template
    acl.addTemplate('trusted-peer', {
      scopes: ['read', 'write', 'chat', 'files', 'compute'],
      maxRate: 100,
      ttl: 3600000,
    })

    // Re-add entries for all peers with the new template
    for (const p of peers) {
      try { acl.removeEntry(p.fingerprint) } catch {}
      acl.addEntry(p.fingerprint, 'trusted-peer')
    }

    // Verify
    const fp = peers[0]?.fingerprint
    if (fp) {
      const checkRead = acl.check(fp, 'read')
      const checkWrite = acl.check(fp, 'write')
      wired.push('meshACL: read=' + JSON.stringify(checkRead) + ' write=' + JSON.stringify(checkWrite))
    }
  } catch (e) { errors.push('meshACL: ' + e.message) }

  // ── 4. SwarmCoordinator — fix getter access ──
  try {
    const sc = state.swarmCoordinator
    const size = typeof sc.swarmSize === 'function' ? sc.swarmSize() : sc.swarmSize
    const leader = typeof sc.isLeader === 'function' ? sc.isLeader() : sc.isLeader
    wired.push('swarmCoordinator: size=' + size + ' leader=' + leader)
  } catch (e) { errors.push('swarmCoordinator: ' + e.message) }

  // ── 5. TorrentManager — fix getter access ──
  try {
    const tm = state.torrentManager
    const avail = typeof tm.available === 'function' ? tm.available() : tm.available
    const loaded = typeof tm.loaded === 'function' ? tm.loaded() : tm.loaded
    wired.push('torrentManager: available=' + avail + ' loaded=' + loaded)
  } catch (e) { errors.push('torrentManager: ' + e.message) }

  // ── 6. GatewayNode — advertise route ──
  try {
    const gn = state.gatewayNode
    for (const p of peers) {
      gn.advertiseRoute(p.fingerprint, { hops: 1, via: localPodId })
    }
    const canRoute = gn.canRoute(peers[0]?.fingerprint)
    wired.push('gatewayNode.advertiseRoute: canRoute=' + canRoute)
  } catch (e) { errors.push('gatewayNode: ' + e.message) }

  return JSON.stringify({ wired, errors }, null, 2)
})()
