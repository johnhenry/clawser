;(async () => {
  const { state } = await import('./clawser-state.js')
  const acl = state.meshACL
  const peers = state.peerNode.listPeers()
  if (peers.length === 0) return JSON.stringify({ chatRead: false, filesWrite: false, error: 'no peers' })
  const fp = peers[0].fingerprint
  const cr = acl.check(fp, 'chat:read')
  const fw = acl.check(fp, 'files:write')
  return JSON.stringify({ chatRead: cr && cr.allowed, filesWrite: fw && fw.allowed })
})()
