;(async () => {
  const msgs = window.__rtcMessages || []
  const broadcasts = msgs.filter(m => (m.data && m.data.type === 'e2e-broadcast') || (m.type === 'e2e-broadcast'))
  return JSON.stringify({ receivedCount: broadcasts.length, total: msgs.length })
})()
