;(async () => {
  const { state } = await import('./clawser-state.js')
  const cm = state.consensusManager
  const podId = state.pod.podId
  const p = cm.propose(podId, 'e2e-test', ['yes', 'no', 'abstain'], 'simple', { ttl: 60000 })
  const pid = p.id || p.proposalId
  const vote = cm.vote(pid, podId, 'yes')
  const tally = cm.getTally(pid)
  return JSON.stringify({ proposalId: pid, voted: !!vote, tally: !!tally })
})()
