// Fix remaining subsystems — corrected API signatures
;(async () => {
  const { state } = await import('./clawser-state.js')
  const localPodId = state.pod.podId
  const peers = state.peerNode.listPeers()
  const wired = []
  const errors = []

  // ── 1. ServiceDirectory.register(name, handler, opts) ──
  try {
    const sd = state.serviceDirectory
    const svcName = 'echo-' + localPodId.slice(0, 6)
    sd.register(svcName, async (request) => {
      return { echo: request, from: localPodId.slice(0, 8) }
    }, { metadata: { version: '1.0' } })
    wired.push('serviceDirectory: registered ' + svcName + ', local=' + sd.listLocal().length)
  } catch (e) { errors.push('serviceDirectory: ' + e.message) }

  // ── 2. ConsensusManager.propose(authorPodId, title, options, voteType, opts) ──
  try {
    const cm = state.consensusManager
    const proposal = cm.propose(
      localPodId,
      'mesh-greeting',
      ['yes', 'no', 'abstain'],
      'simple-majority',
      { description: 'Should peers say hello?', ttl: 120000 }
    )
    const pid = proposal.id || proposal.proposalId
    wired.push('consensusManager: proposed ' + pid)

    // Vote yes
    const vote = cm.vote(pid, localPodId, 'yes')
    wired.push('consensusManager: voted ' + JSON.stringify(vote).slice(0, 60))

    // Check tally
    const tally = cm.getTally(pid)
    wired.push('consensusManager: tally=' + JSON.stringify(tally).slice(0, 80))
  } catch (e) { errors.push('consensusManager: ' + e.message) }

  // ── 3. MeshACL.addTemplate(name, scopes[], description) ──
  try {
    const acl = state.meshACL
    try { acl.addTemplate('trusted', ['chat:*', 'files:*', 'compute:*'], 'Full mesh access') } catch {}

    for (const p of peers) {
      try { acl.removeEntry(p.fingerprint) } catch {}
      acl.addEntry(p.fingerprint, 'trusted')
    }

    const fp = peers[0]?.fingerprint
    if (fp) {
      wired.push('meshACL: check chat:read=' + JSON.stringify(acl.check(fp, 'chat:read')))
      wired.push('meshACL: check files:write=' + JSON.stringify(acl.check(fp, 'files:write')))
    }
  } catch (e) { errors.push('meshACL: ' + e.message) }

  // ── 4. GatewayNode.advertiseRoute(fromPodId, toPodId, hopCount) ──
  try {
    const gn = state.gatewayNode
    for (const p of peers) {
      gn.advertiseRoute(localPodId, p.fingerprint, 1)
    }
    const canRoute = gn.canRoute(peers[0]?.fingerprint)
    const stats = typeof gn.stats === 'function' ? gn.stats() : gn.stats
    wired.push('gatewayNode: canRoute=' + canRoute + ' routes=' + stats.routeCount)
  } catch (e) { errors.push('gatewayNode: ' + e.message) }

  return JSON.stringify({ wired, errors }, null, 2)
})()
