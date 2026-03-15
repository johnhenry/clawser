// Connect to signaling and register, but only record peers from __sigAllowList.
// This lets us control which peers each browser "sees" via signaling,
// so alpha never discovers gamma through signaling alone.
;(async () => {
  const { state } = await import('./clawser-state.js')
  const localPodId = state.pod.podId
  if (window.__sigWs && window.__sigWs.readyState === 1) {
    return JSON.stringify({ registered: true, existing: true })
  }
  const port = window.__sigPort || 8787
  const allowList = window.__sigAllowList || [] // podIds this node is allowed to see

  const ws = new WebSocket('ws://127.0.0.1:' + port)
  await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; setTimeout(j, 5000) })
  ws.send(JSON.stringify({ type: 'register', podId: localPodId }))
  window.__sigWs = ws
  window.__sigPeers = []
  window.__sigRegistered = false

  ws.onmessage = (e) => {
    const msg = JSON.parse(e.data)
    if (msg.type === 'registered') window.__sigRegistered = true
    if (msg.type === 'peers') {
      // Only keep peers that are on our allow list
      window.__sigPeers = msg.peers.filter(p => allowList.includes(p))
    }
    if (msg.type === 'peer-joined') {
      if (allowList.includes(msg.podId) && !window.__sigPeers.includes(msg.podId)) {
        window.__sigPeers.push(msg.podId)
      }
    }
    if (msg.type === 'peer-left') {
      window.__sigPeers = window.__sigPeers.filter(p => p !== msg.podId)
    }
  }
  await new Promise(r => setTimeout(r, 500))
  return JSON.stringify({ registered: window.__sigRegistered })
})()
