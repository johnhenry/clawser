// Exercise Mesh Chat between peers
;(async () => {
  const { state } = await import('./clawser-state.js')
  const mc = state.meshChat
  const results = {}

  // Create a chat room
  try {
    const room = mc.createRoom('test-room')
    results.roomCreated = !!room
    results.roomId = room ? 'test-room' : null
  } catch (e) { results.createError = e.message }

  // List rooms
  try {
    results.rooms = mc.listRooms()
  } catch (e) { results.listError = e.message }

  // Send a message to the room
  try {
    const msg = mc.send('test-room', 'Hello from ' + state.pod.podId.slice(0, 8))
    results.sent = msg
  } catch (e) { results.sendError = e.message }

  // Get room stats
  try {
    results.stats = mc.getStats()
  } catch (e) { results.statsError = e.message }

  return JSON.stringify(results, null, 2)
})()
