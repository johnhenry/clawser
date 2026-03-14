// E2E probe script — injected into browser to inspect mesh state
// Usage: agent-browser --session X eval "$(cat e2e/probe.mjs)"

;(async () => {
  const { state } = await import('./clawser-state.js')
  const result = {}

  // List all non-null state keys
  const keys = []
  for (const k of Object.keys(state)) {
    if (state[k] != null) keys.push(k)
  }
  result.stateKeys = keys

  // Mesh subsystem availability
  result.subsystems = {
    pod: !!state.pod,
    peerNode: !!state.peerNode,
    discoveryManager: !!state.discoveryManager,
    meshChat: !!state.meshChat,
    meshRouter: !!state.meshRouter,
    fileTransfer: !!state.fileTransfer,
    serviceDirectory: !!state.serviceDirectory,
    sessionManager: !!state.sessionManager,
    healthMonitor: !!state.healthMonitor,
    streamMultiplexer: !!state.streamMultiplexer,
    swarmCoordinator: !!state.swarmCoordinator,
    auditChain: !!state.auditChain,
    meshScheduler: !!state.meshScheduler,
    meshACL: !!state.meshACL,
    deltaSync: !!state.deltaSync,
    namResolver: !!state.namResolver,
    relayClient: !!state.relayClient,
    gatewayNode: !!state.gatewayNode,
    consensusEngine: !!state.consensusEngine,
    transportNegotiator: !!state.transportNegotiator,
    capabilityValidator: !!state.capabilityValidator,
  }

  // Peer info
  result.podId = state.pod ? state.pod.podId : null
  result.peerCount = state.peerNode ? state.peerNode.listPeers().length : 0
  result.peers = state.peerNode ? state.peerNode.listPeers() : []

  return JSON.stringify(result, null, 2)
})()
