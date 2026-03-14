// Mesh feature exploration probe
// Usage: agent-browser --session X eval "$(cat e2e/explore-mesh.mjs)"
;(async () => {
  const { state } = await import('./clawser-state.js')
  const results = {}

  // ── 1. Mesh Chat ──
  try {
    const mc = state.meshChat
    results.meshChat = {
      available: !!mc,
      methods: mc ? Object.getOwnPropertyNames(Object.getPrototypeOf(mc)).filter(m => m !== 'constructor') : [],
      rooms: mc && mc.listRooms ? mc.listRooms() : null,
    }
  } catch (e) { results.meshChat = { error: e.message } }

  // ── 2. File Transfer ──
  try {
    const ft = state.fileTransfer
    results.fileTransfer = {
      available: !!ft,
      methods: ft ? Object.getOwnPropertyNames(Object.getPrototypeOf(ft)).filter(m => m !== 'constructor') : [],
    }
  } catch (e) { results.fileTransfer = { error: e.message } }

  // ── 3. Service Directory ──
  try {
    const sd = state.serviceDirectory
    results.serviceDirectory = {
      available: !!sd,
      methods: sd ? Object.getOwnPropertyNames(Object.getPrototypeOf(sd)).filter(m => m !== 'constructor') : [],
      services: sd && sd.list ? sd.list() : null,
    }
  } catch (e) { results.serviceDirectory = { error: e.message } }

  // ── 4. Session Manager ──
  try {
    const sm = state.sessionManager
    results.sessionManager = {
      available: !!sm,
      methods: sm ? Object.getOwnPropertyNames(Object.getPrototypeOf(sm)).filter(m => m !== 'constructor') : [],
      sessions: sm && sm.listSessions ? sm.listSessions() : null,
    }
  } catch (e) { results.sessionManager = { error: e.message } }

  // ── 5. Health Monitor ──
  try {
    const hm = state.healthMonitor
    results.healthMonitor = {
      available: !!hm,
      methods: hm ? Object.getOwnPropertyNames(Object.getPrototypeOf(hm)).filter(m => m !== 'constructor') : [],
    }
  } catch (e) { results.healthMonitor = { error: e.message } }

  // ── 6. Stream Multiplexer ──
  try {
    const sm = state.streamMultiplexer
    results.streamMultiplexer = {
      available: !!sm,
      methods: sm ? Object.getOwnPropertyNames(Object.getPrototypeOf(sm)).filter(m => m !== 'constructor') : [],
    }
  } catch (e) { results.streamMultiplexer = { error: e.message } }

  // ── 7. Mesh Router ──
  try {
    const mr = state.meshRouter
    results.meshRouter = {
      available: !!mr,
      methods: mr ? Object.getOwnPropertyNames(Object.getPrototypeOf(mr)).filter(m => m !== 'constructor') : [],
      routes: mr && mr.listRoutes ? mr.listRoutes() : null,
    }
  } catch (e) { results.meshRouter = { error: e.message } }

  // ── 8. Mesh ACL ──
  try {
    const acl = state.meshACL
    results.meshACL = {
      available: !!acl,
      methods: acl ? Object.getOwnPropertyNames(Object.getPrototypeOf(acl)).filter(m => m !== 'constructor') : [],
    }
  } catch (e) { results.meshACL = { error: e.message } }

  // ── 9. Audit Chain ──
  try {
    const ac = state.auditChain
    results.auditChain = {
      available: !!ac,
      methods: ac ? Object.getOwnPropertyNames(Object.getPrototypeOf(ac)).filter(m => m !== 'constructor') : [],
      length: ac && ac.length != null ? ac.length : null,
    }
  } catch (e) { results.auditChain = { error: e.message } }

  // ── 10. Mesh Scheduler ──
  try {
    const ms = state.meshScheduler
    results.meshScheduler = {
      available: !!ms,
      methods: ms ? Object.getOwnPropertyNames(Object.getPrototypeOf(ms)).filter(m => m !== 'constructor') : [],
    }
  } catch (e) { results.meshScheduler = { error: e.message } }

  // ── 11. Swarm Coordinator ──
  try {
    const sc = state.swarmCoordinator
    results.swarmCoordinator = {
      available: !!sc,
      methods: sc ? Object.getOwnPropertyNames(Object.getPrototypeOf(sc)).filter(m => m !== 'constructor') : [],
    }
  } catch (e) { results.swarmCoordinator = { error: e.message } }

  // ── 12. Torrent Manager ──
  try {
    const tm = state.torrentManager
    results.torrentManager = {
      available: !!tm,
      methods: tm ? Object.getOwnPropertyNames(Object.getPrototypeOf(tm)).filter(m => m !== 'constructor') : [],
    }
  } catch (e) { results.torrentManager = { error: e.message } }

  // ── 13. Gateway Node ──
  try {
    const gn = state.gatewayNode
    results.gatewayNode = {
      available: !!gn,
      methods: gn ? Object.getOwnPropertyNames(Object.getPrototypeOf(gn)).filter(m => m !== 'constructor') : [],
    }
  } catch (e) { results.gatewayNode = { error: e.message } }

  // ── 14. Consensus Manager ──
  try {
    const cm = state.consensusManager
    results.consensusManager = {
      available: !!cm,
      methods: cm ? Object.getOwnPropertyNames(Object.getPrototypeOf(cm)).filter(m => m !== 'constructor') : [],
    }
  } catch (e) { results.consensusManager = { error: e.message } }

  return JSON.stringify(results, null, 2)
})()
