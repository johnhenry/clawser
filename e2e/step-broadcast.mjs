;(async () => {
  const { state } = await import('./clawser-state.js')
  const id = state.pod.podId
  let count = 0
  for (const [, conn] of Object.entries(window.__rtcConns || {})) {
    if (conn.isOpen) {
      conn.send({ type: 'e2e-broadcast', from: id.slice(0, 12), ts: Date.now() })
      count++
    }
  }
  return JSON.stringify({ sent: count })
})()
