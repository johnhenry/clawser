;(async () => {
  const { state } = await import('./clawser-state.js')
  const conns = window.__rtcConns || {}
  const wired = []
  const errors = []

  if (!window.__transportWired) {
    try {
      state.fileTransfer.onSend((msg) => {
        for (const [, c] of Object.entries(conns)) { if (c.isOpen) c.send({ _mesh: 'file-transfer', payload: msg }) }
      })
      wired.push('fileTransfer')
    } catch (e) { errors.push('fileTransfer: ' + e.message) }

    try {
      state.streamMultiplexer.onSend((msg) => {
        for (const [, c] of Object.entries(conns)) { if (c.isOpen) c.send({ _mesh: 'stream-mux', payload: msg }) }
      })
      wired.push('streamMultiplexer')
    } catch (e) { errors.push('streamMux: ' + e.message) }
    window.__transportWired = true
  } else { wired.push('fileTransfer (existing)', 'streamMultiplexer (existing)') }

  for (const [rp, conn] of Object.entries(conns)) {
    if (!conn.isOpen) continue
    try { state.meshRouter.addDirectPeer(rp, { send(msg) { conn.send({ _mesh: 'router', payload: msg }) } }); state.meshRouter.addRoute(rp, rp, 1) } catch {}
    try { state.gatewayNode.registerPeer(rp, { send(msg) { conn.send({ _mesh: 'gw', payload: msg }) } }) } catch {}
    try { state.healthMonitor.recordHeartbeat(rp, { latency: 5 }) } catch {}
  }
  wired.push('router', 'gateway', 'health')

  // ACL
  try {
    const acl = state.meshACL
    try { acl.addTemplate('trusted', ['chat:*', 'files:*', 'compute:*'], 'E2E test') } catch {}
    for (const [rp] of Object.entries(conns)) {
      try { acl.removeEntry(rp) } catch {}
      try { acl.addEntry(rp, 'trusted') } catch {}
    }
    wired.push('acl')
  } catch (e) { errors.push('acl: ' + e.message) }

  return JSON.stringify({ wired, errors })
})()
