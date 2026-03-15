;(async () => {
  const msgs = window.__rtcMessages || []
  // Stream mux messages come wrapped as { _mesh: 'stream-mux', payload: ... }
  const streamMsgs = msgs.filter(m =>
    m.data && m.data._mesh === 'stream-mux'
  )
  // Check for STREAM_OPEN frames specifically (0xaf = 175)
  const openFrames = streamMsgs.filter(m =>
    m.data.payload && (m.data.payload.t === 0xaf || m.data.payload.t === 175)
  )

  return JSON.stringify({
    totalMessages: msgs.length,
    streamMuxMessages: streamMsgs.length,
    openFrames: openFrames.length,
    receivedStreamFrame: streamMsgs.length > 0,
  })
})()
