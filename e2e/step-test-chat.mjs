;(async () => {
  const { state } = await import('./clawser-state.js')
  const mc = state.meshChat
  let roomCreated = false, messageSent = false
  try {
    const rooms = mc.listRooms()
    const roomId = rooms.length > 0 ? rooms[0].id : mc.createRoom('e2e-chat').id
    roomCreated = true
    mc.send(roomId, 'text', 'E2E test from ' + state.pod.podId.slice(0, 8))
    messageSent = true
  } catch (e) { return JSON.stringify({ roomCreated, messageSent, error: e.message }) }
  return JSON.stringify({ roomCreated, messageSent, stats: mc.getStats() })
})()
