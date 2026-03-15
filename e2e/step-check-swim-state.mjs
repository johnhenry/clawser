;(async () => {
  const swim = window.__swim
  if (!swim) return JSON.stringify({ error: 'SWIM not initialized' })

  const json = swim.toJSON()
  const events = window.__swimEvents || []

  // Collect member states
  const memberStates = {}
  for (const [podId, entry] of Object.entries(json.members)) {
    if (podId !== json.localId) {
      memberStates[podId.slice(0, 12)] = entry.state
    }
  }

  return JSON.stringify({
    localId: json.localId.slice(0, 12),
    aliveCount: swim.aliveCount,
    totalMembers: swim.size,
    memberStates,
    events: events.slice(-10),
    hasSuspectOrDead: events.some(e => e.type === 'suspect' || e.type === 'dead'),
  })
})()
