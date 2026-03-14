;(async () => {
  const { state } = await import('./clawser-state.js')
  const localPodId = state.pod.podId
  if (window.__sigWs && window.__sigWs.readyState === 1) {
    return JSON.stringify({ registered: true, existing: true })
  }
  const port = window.__sigPort || 8787
  const ws = new WebSocket('ws://127.0.0.1:' + port)
  await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; setTimeout(j, 5000) })
  ws.send(JSON.stringify({ type: 'register', podId: localPodId }))
  window.__sigWs = ws
  window.__sigPeers = []
  window.__sigRegistered = false
  ws.onmessage = (e) => {
    const msg = JSON.parse(e.data)
    if (msg.type === 'registered') window.__sigRegistered = true
    if (msg.type === 'peers') window.__sigPeers = msg.peers
    if (msg.type === 'peer-joined' && !window.__sigPeers.includes(msg.podId)) window.__sigPeers.push(msg.podId)
    if (msg.type === 'peer-left') window.__sigPeers = window.__sigPeers.filter(p => p !== msg.podId)
  }
  await new Promise(r => setTimeout(r, 500))
  return JSON.stringify({ registered: window.__sigRegistered })
})()
