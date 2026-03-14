// Exercise Mesh Chat — send by room ID
;(async () => {
  const { state } = await import('./clawser-state.js')
  const mc = state.meshChat
  const results = {}

  // Get existing rooms
  const rooms = mc.listRooms()
  results.rooms = rooms

  if (rooms.length > 0) {
    const roomId = rooms[0].id
    results.usingRoom = roomId

    // Send a message using the room ID
    try {
      const msg = mc.send(roomId, 'Hello from ' + state.pod.podId.slice(0, 8))
      results.sent = msg
    } catch (e) { results.sendError = e.message }

    // Subscribe to the room
    try {
      const sub = mc.subscribe(roomId, function(msg) {
        window.__chatMessages = window.__chatMessages || []
        window.__chatMessages.push(msg)
      })
      results.subscribed = !!sub
    } catch (e) { results.subError = e.message }

    // Get room details
    try {
      const room = mc.getRoom(roomId)
      results.roomDetail = room ? { id: room.id, name: room.name, members: room.memberCount || room.members?.size } : null
    } catch (e) { results.roomError = e.message }
  }

  return JSON.stringify(results, null, 2)
})()
