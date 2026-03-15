;(async () => {
  const { state } = await import('./clawser-state.js')
  const sm = state.streamMultiplexer
  const peers = Object.keys(window.__rtcConns || {}).filter(
    rp => window.__rtcConns[rp].isOpen
  )
  if (peers.length === 0) return JSON.stringify({ error: 'no connected peers' })

  // Open a stream — the onSend callback routes frames through WebRTC
  const stream = sm.open('e2e/test-stream', {
    metadata: { purpose: 'e2e-test' },
  })

  await new Promise(r => setTimeout(r, 500))

  return JSON.stringify({
    streamOpened: !!stream,
    streamId: stream.hexId,
    streamState: stream.state,
    method: stream.method,
  })
})()
