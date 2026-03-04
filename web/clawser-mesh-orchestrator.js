/**
 * clawser-mesh-orchestrator.js -- Pod orchestration engine + tools.
 *
 * MeshOrchestrator coordinates pods across the P2P mesh network.
 * Each operation is also exposed as a BrowserTool subclass so the AI agent
 * can invoke them via structured tool_use.
 *
 * No browser-only imports at module level.
 *
 * Run tests:
 *   node --import ./web/test/_setup-globals.mjs --test web/test/clawser-mesh-orchestrator.test.mjs
 */

// Stub BrowserTool base class for Node.js testing
const BrowserTool = globalThis.BrowserTool || class {
  constructor() {}
}

// ---------------------------------------------------------------------------
// Wire constants
// ---------------------------------------------------------------------------

/** List all pods in the mesh */
export const ORCH_LIST_PODS = 0xd0
/** Get detailed pod status */
export const ORCH_POD_STATUS = 0xd1
/** Execute a command on a remote pod */
export const ORCH_EXEC = 0xd2
/** Deploy a skill to a remote pod */
export const ORCH_DEPLOY = 0xd3
/** Drain a pod (graceful disconnect) */
export const ORCH_DRAIN = 0xd4
/** Expose a pod's service */
export const ORCH_EXPOSE = 0xd5
/** Route a service to a target pod */
export const ORCH_ROUTE = 0xd6

// ---------------------------------------------------------------------------
// Valid enumerations
// ---------------------------------------------------------------------------

const VALID_POD_STATUSES = Object.freeze([
  'online', 'offline', 'draining', 'unknown',
])

// ---------------------------------------------------------------------------
// PodInfo
// ---------------------------------------------------------------------------

/**
 * Summary information about a pod in the mesh.
 */
export class PodInfo {
  /**
   * @param {object} opts
   * @param {string} opts.podId
   * @param {string} [opts.label]
   * @param {string} [opts.status]
   * @param {string[]} [opts.services]
   * @param {number} [opts.connections]
   * @param {boolean} [opts.isLocal]
   */
  constructor({
    podId,
    label = '',
    status = 'online',
    services = [],
    connections = 0,
    isLocal = false,
  }) {
    if (!podId || typeof podId !== 'string') {
      throw new Error('podId is required and must be a non-empty string')
    }
    this.podId = podId
    this.label = label
    this.status = status
    this.services = [...services]
    this.connections = connections
    this.isLocal = isLocal
  }

  toJSON() {
    return {
      podId: this.podId,
      label: this.label,
      status: this.status,
      services: [...this.services],
      connections: this.connections,
      isLocal: this.isLocal,
    }
  }

  /**
   * @param {object} data
   * @returns {PodInfo}
   */
  static fromJSON(data) {
    return new PodInfo(data)
  }
}

// ---------------------------------------------------------------------------
// PodStatus
// ---------------------------------------------------------------------------

/**
 * Detailed status of a specific pod.
 */
export class PodStatus {
  /**
   * @param {object} opts
   * @param {string} opts.podId
   * @param {string} [opts.status]
   * @param {string[]} [opts.capabilities]
   * @param {string[]} [opts.services]
   * @param {number} [opts.connections]
   * @param {number} [opts.uptime]
   * @param {object} [opts.resources]
   * @param {number} [opts.resources.cpu]
   * @param {number} [opts.resources.memory]
   * @param {number} [opts.resources.storage]
   * @param {boolean} [opts.isLocal]
   */
  constructor({
    podId,
    status = 'online',
    capabilities = [],
    services = [],
    connections = 0,
    uptime = 0,
    resources = {},
    isLocal = false,
  }) {
    if (!podId || typeof podId !== 'string') {
      throw new Error('podId is required and must be a non-empty string')
    }
    this.podId = podId
    this.status = status
    this.capabilities = [...capabilities]
    this.services = [...services]
    this.connections = connections
    this.uptime = uptime
    this.resources = {
      cpu: resources.cpu ?? 0,
      memory: resources.memory ?? 0,
      storage: resources.storage ?? 0,
    }
    this.isLocal = isLocal
  }

  toJSON() {
    return {
      podId: this.podId,
      status: this.status,
      capabilities: [...this.capabilities],
      services: [...this.services],
      connections: this.connections,
      uptime: this.uptime,
      resources: { ...this.resources },
      isLocal: this.isLocal,
    }
  }

  /**
   * @param {object} data
   * @returns {PodStatus}
   */
  static fromJSON(data) {
    return new PodStatus(data)
  }
}

// ---------------------------------------------------------------------------
// PodResourceInfo
// ---------------------------------------------------------------------------

/**
 * Resource usage snapshot for a single pod (used by topPods).
 */
export class PodResourceInfo {
  /**
   * @param {object} opts
   * @param {string} opts.podId
   * @param {number} [opts.cpu]
   * @param {number} [opts.memory]
   * @param {number} [opts.storage]
   * @param {number} [opts.activeTasks]
   * @param {string} [opts.status]
   */
  constructor({
    podId,
    cpu = 0,
    memory = 0,
    storage = 0,
    activeTasks = 0,
    status = 'online',
  }) {
    this.podId = podId
    this.cpu = cpu
    this.memory = memory
    this.storage = storage
    this.activeTasks = activeTasks
    this.status = status
  }

  toJSON() {
    return {
      podId: this.podId,
      cpu: this.cpu,
      memory: this.memory,
      storage: this.storage,
      activeTasks: this.activeTasks,
      status: this.status,
    }
  }
}

// ---------------------------------------------------------------------------
// MeshOrchestrator
// ---------------------------------------------------------------------------

/**
 * Coordinates pods across the P2P mesh network.
 * Provides pod queries, remote execution, deployment, draining,
 * resource monitoring, and service operations.
 */
export class MeshOrchestrator {
  /** @type {object|null} PeerNode -- the local peer */
  #peerNode
  /** @type {object|null} ServiceAdvertiser */
  #serviceAdvertiser
  /** @type {object|null} ServiceBrowser */
  #serviceBrowser
  /** @type {object|null} MeshRouter */
  #router
  /** @type {Function|null} */
  #onLog
  /** @type {Map<string, object>} podId -> peer info */
  #knownPeers = new Map()
  /** @type {Map<string, object>} name -> { podId, port } */
  #exposedServices = new Map()
  /** @type {Map<string, object>} name -> targetPodId */
  #routes = new Map()
  /** @type {Map<string, object>} tunnelId -> tunnel record */
  #tunnels = new Map()
  /** @type {Set<string>} podIds currently draining */
  #draining = new Set()
  /** @type {number} */
  #tunnelCounter = 0

  /**
   * @param {object} opts
   * @param {object} opts.peerNode        - PeerNode -- the local peer
   * @param {object} [opts.serviceAdvertiser] - ServiceAdvertiser or null
   * @param {object} [opts.serviceBrowser]    - ServiceBrowser or null
   * @param {object} [opts.router]            - MeshRouter or null
   * @param {Function} [opts.onLog]           - Logging callback
   */
  constructor({ peerNode, serviceAdvertiser, serviceBrowser, router, onLog }) {
    if (!peerNode) {
      throw new Error('peerNode is required')
    }
    this.#peerNode = peerNode
    this.#serviceAdvertiser = serviceAdvertiser ?? null
    this.#serviceBrowser = serviceBrowser ?? null
    this.#router = router ?? null
    this.#onLog = onLog ?? null
  }

  /** @returns {object} The local peer node */
  get peerNode() {
    return this.#peerNode
  }

  /** @returns {string} Local pod ID (cached from peerNode) */
  get localPodId() {
    return this.#peerNode.podId || this.#peerNode.id || 'local'
  }

  // -- Logging --------------------------------------------------------------

  #log(msg) {
    if (this.#onLog) this.#onLog(msg)
  }

  // -- Pod queries ----------------------------------------------------------

  /**
   * List all known pods (local + remote).
   * @param {string} [filter] - Status filter: 'online', 'offline', 'all'
   * @returns {Promise<PodInfo[]>}
   */
  async listPods(filter) {
    const pods = []

    // Local pod is always included
    const localPodId = this.localPodId
    const localServices = this.#getLocalServices()
    const localPod = new PodInfo({
      podId: localPodId,
      label: this.#peerNode.label || localPodId,
      status: this.#draining.has(localPodId) ? 'draining' : 'online',
      services: localServices,
      connections: this.#knownPeers.size,
      isLocal: true,
    })
    pods.push(localPod)

    // Add known remote peers
    for (const [podId, info] of this.#knownPeers) {
      const status = this.#draining.has(podId) ? 'draining' : (info.status || 'online')
      pods.push(new PodInfo({
        podId,
        label: info.label || podId,
        status,
        services: info.services || [],
        connections: info.connections ?? 0,
        isLocal: false,
      }))
    }

    // Apply filter
    if (filter && filter !== 'all') {
      return pods.filter(p => p.status === filter)
    }
    return pods
  }

  /**
   * Get detailed status for a specific pod.
   * @param {string} podId
   * @returns {Promise<PodStatus|null>}
   */
  async getPodStatus(podId) {
    const localPodId = this.localPodId

    if (podId === localPodId) {
      return new PodStatus({
        podId: localPodId,
        status: this.#draining.has(localPodId) ? 'draining' : 'online',
        capabilities: this.#peerNode.capabilities || [],
        services: this.#getLocalServices(),
        connections: this.#knownPeers.size,
        uptime: this.#peerNode.uptime ?? 0,
        resources: this.#peerNode.resources || {},
        isLocal: true,
      })
    }

    const info = this.#knownPeers.get(podId)
    if (!info) return null

    return new PodStatus({
      podId,
      status: this.#draining.has(podId) ? 'draining' : (info.status || 'online'),
      capabilities: info.capabilities || [],
      services: info.services || [],
      connections: info.connections ?? 0,
      uptime: info.uptime ?? 0,
      resources: info.resources || {},
      isLocal: false,
    })
  }

  // -- Remote execution -----------------------------------------------------

  /**
   * Execute a command on a remote pod via peer session.
   * @param {string} podId
   * @param {string} command
   * @returns {Promise<{ output: string, exitCode: number }>}
   */
  async execOnPod(podId, command) {
    if (!command || typeof command !== 'string') {
      throw new Error('command is required and must be a non-empty string')
    }

    const localPodId = this.localPodId
    if (podId === localPodId) {
      // Execute locally via peerNode if it has an exec method
      if (this.#peerNode.exec) {
        return await this.#peerNode.exec(command)
      }
      return { output: `Local execution not supported`, exitCode: 1 }
    }

    const info = this.#knownPeers.get(podId)
    if (!info) {
      throw new Error(`Pod "${podId}" not found`)
    }

    // Delegate to the peer's terminal/session if available
    if (info.exec) {
      return await info.exec(command)
    }
    if (info.send) {
      info.send({ type: 'exec', command })
      return { output: `Command sent to ${podId}`, exitCode: 0 }
    }

    throw new Error(`Pod "${podId}" does not support remote execution`)
  }

  // -- Deployment -----------------------------------------------------------

  /**
   * Deploy a skill (SKILL.md content) to a remote pod.
   * @param {string} podId
   * @param {string} skillContent - SKILL.md content to deploy
   * @returns {Promise<{ success: boolean, error?: string }>}
   */
  async deploySkill(podId, skillContent) {
    if (!skillContent || typeof skillContent !== 'string') {
      return { success: false, error: 'skillContent is required' }
    }

    const info = this.#knownPeers.get(podId)
    if (!info) {
      return { success: false, error: `Pod "${podId}" not found` }
    }

    this.#log(`Deploying skill to ${podId} (${skillContent.length} bytes)`)

    if (info.deploySkill) {
      return await info.deploySkill(skillContent)
    }
    if (info.send) {
      info.send({ type: 'deploy_skill', content: skillContent })
      return { success: true }
    }

    return { success: false, error: `Pod "${podId}" does not support deployment` }
  }

  // -- Pod management -------------------------------------------------------

  /**
   * Gracefully drain a pod: mark it as draining, migrate tasks, disconnect.
   * @param {string} podId
   * @returns {Promise<{ success: boolean, migrated: number }>}
   */
  async drainPod(podId) {
    const info = this.#knownPeers.get(podId)
    const localPodId = this.localPodId

    if (podId !== localPodId && !info) {
      return { success: false, migrated: 0 }
    }

    this.#draining.add(podId)
    this.#log(`Draining pod ${podId}`)

    let migrated = 0

    // If the peer has a drain callback, invoke it
    if (info && info.drain) {
      const result = await info.drain()
      migrated = result?.migrated ?? 0
    }

    // Remove from known peers (disconnect)
    if (podId !== localPodId) {
      this.#knownPeers.delete(podId)
    }

    return { success: true, migrated }
  }

  // -- Resource usage -------------------------------------------------------

  /**
   * Snapshot of resource usage across all known pods.
   * @returns {Promise<{ pods: PodResourceInfo[] }>}
   */
  async topPods() {
    const pods = []
    const localPodId = this.localPodId
    const localRes = this.#peerNode.resources || {}

    pods.push(new PodResourceInfo({
      podId: localPodId,
      cpu: localRes.cpu ?? 0,
      memory: localRes.memory ?? 0,
      storage: localRes.storage ?? 0,
      activeTasks: this.#peerNode.activeTasks ?? 0,
      status: this.#draining.has(localPodId) ? 'draining' : 'online',
    }))

    for (const [podId, info] of this.#knownPeers) {
      const res = info.resources || {}
      pods.push(new PodResourceInfo({
        podId,
        cpu: res.cpu ?? 0,
        memory: res.memory ?? 0,
        storage: res.storage ?? 0,
        activeTasks: info.activeTasks ?? 0,
        status: this.#draining.has(podId) ? 'draining' : (info.status || 'online'),
      }))
    }

    return { pods }
  }

  // -- Service operations ---------------------------------------------------

  /**
   * Expose a pod service on the mesh.
   * @param {string} podId
   * @param {number} port
   * @param {string} name - Service name
   * @returns {Promise<{ success: boolean, address?: string }>}
   */
  async exposePod(podId, port, name) {
    if (!name || typeof name !== 'string') {
      return { success: false }
    }
    if (typeof port !== 'number' || !Number.isFinite(port) || port <= 0 || port > 65535) {
      return { success: false }
    }

    const address = `${podId}:${port}`
    this.#exposedServices.set(name, { podId, port, address })
    this.#log(`Exposed service "${name}" at ${address}`)

    // Advertise via service advertiser if available
    if (this.#serviceAdvertiser && this.#serviceAdvertiser.advertise) {
      this.#serviceAdvertiser.advertise({ name, type: 'http-proxy', podId, port })
    }

    return { success: true, address }
  }

  /**
   * Route a named service to a target pod.
   * @param {string} name - Service name
   * @param {string} targetPodId
   * @returns {Promise<{ success: boolean }>}
   */
  async routeService(name, targetPodId) {
    if (!name || typeof name !== 'string') {
      return { success: false }
    }
    if (!targetPodId || typeof targetPodId !== 'string') {
      return { success: false }
    }

    this.#routes.set(name, targetPodId)
    this.#log(`Routed service "${name}" to ${targetPodId}`)

    // Update router if available
    if (this.#router && this.#router.addRoute) {
      this.#router.addRoute(targetPodId, targetPodId, 1)
    }

    return { success: true }
  }

  // -- Tunnel (port forwarding concept) ------------------------------------

  /**
   * Create a port-forwarding tunnel to a remote pod.
   * @param {string} podId
   * @param {number} remotePort
   * @param {number} localPort
   * @returns {Promise<{ success: boolean, tunnelId?: string }>}
   */
  async tunnelPort(podId, remotePort, localPort) {
    if (!podId || typeof podId !== 'string') {
      return { success: false }
    }
    if (typeof remotePort !== 'number' || remotePort <= 0) {
      return { success: false }
    }
    if (typeof localPort !== 'number' || localPort <= 0) {
      return { success: false }
    }

    const tunnelId = `tunnel_${++this.#tunnelCounter}`
    this.#tunnels.set(tunnelId, { podId, remotePort, localPort, createdAt: Date.now() })
    this.#log(`Tunnel ${tunnelId}: local:${localPort} -> ${podId}:${remotePort}`)

    return { success: true, tunnelId }
  }

  // -- Peer management (used by the mesh layer to keep state in sync) ------

  /**
   * Register a known remote peer.
   * @param {string} podId
   * @param {object} info - { label, status, services, capabilities, resources, connections, uptime, exec?, send?, drain?, deploySkill? }
   */
  addPeer(podId, info) {
    this.#knownPeers.set(podId, info)
  }

  /**
   * Remove a known remote peer.
   * @param {string} podId
   * @returns {boolean}
   */
  removePeer(podId) {
    this.#draining.delete(podId)
    return this.#knownPeers.delete(podId)
  }

  /**
   * Number of known remote peers.
   * @returns {number}
   */
  get peerCount() {
    return this.#knownPeers.size
  }

  // -- Internal helpers -----------------------------------------------------

  #getLocalServices() {
    const services = []
    for (const [name, entry] of this.#exposedServices) {
      const localPodId = this.localPodId
      if (entry.podId === localPodId) {
        services.push(name)
      }
    }
    return services
  }
}

// ---------------------------------------------------------------------------
// BrowserTool subclasses
// ---------------------------------------------------------------------------

// ── meshctl_pods ──────────────────────────────────────────────────────

export class MeshctlPodsTool extends BrowserTool {
  #orchestrator

  constructor(orchestrator) {
    super()
    this.#orchestrator = orchestrator
  }

  get name() { return 'meshctl_pods' }
  get description() { return 'List all known pods (local + remote) with their status and services' }
  get parameters() {
    return {
      type: 'object',
      properties: {
        filter: { type: 'string', description: 'Status filter: online, offline, all (default: all)' },
      },
    }
  }
  get permission() { return 'read' }

  async execute({ filter } = {}) {
    try {
      const pods = await this.#orchestrator.listPods(filter)
      if (pods.length === 0) {
        return { success: true, output: 'No pods found.' }
      }
      const lines = pods.map(p => {
        const local = p.isLocal ? ' (local)' : ''
        const svcs = p.services.length > 0 ? ` [${p.services.join(', ')}]` : ''
        return `${p.podId} | ${p.status}${local} | conns: ${p.connections}${svcs}`
      })
      return {
        success: true,
        output: `POD | STATUS | CONNECTIONS | SERVICES\n${lines.join('\n')}`,
      }
    } catch (err) {
      return { success: false, output: '', error: `Failed to list pods: ${err.message}` }
    }
  }
}

// ── meshctl_status ────────────────────────────────────────────────────

export class MeshctlStatusTool extends BrowserTool {
  #orchestrator

  constructor(orchestrator) {
    super()
    this.#orchestrator = orchestrator
  }

  get name() { return 'meshctl_status' }
  get description() { return 'Get detailed status of a specific pod including resources, capabilities, and uptime' }
  get parameters() {
    return {
      type: 'object',
      properties: {
        podId: { type: 'string', description: 'Pod ID to query' },
      },
      required: ['podId'],
    }
  }
  get permission() { return 'read' }

  async execute({ podId }) {
    try {
      const status = await this.#orchestrator.getPodStatus(podId)
      if (!status) {
        return { success: false, output: '', error: `Pod "${podId}" not found.` }
      }
      const lines = [
        `Pod: ${status.podId}${status.isLocal ? ' (local)' : ''}`,
        `Status: ${status.status}`,
        `Uptime: ${status.uptime}ms`,
        `Connections: ${status.connections}`,
        `Capabilities: ${status.capabilities.join(', ') || 'none'}`,
        `Services: ${status.services.join(', ') || 'none'}`,
        `Resources: cpu=${status.resources.cpu}, memory=${status.resources.memory}MB, storage=${status.resources.storage}MB`,
      ]
      return { success: true, output: lines.join('\n') }
    } catch (err) {
      return { success: false, output: '', error: `Failed to get status: ${err.message}` }
    }
  }
}

// ── meshctl_exec ──────────────────────────────────────────────────────

export class MeshctlExecTool extends BrowserTool {
  #orchestrator

  constructor(orchestrator) {
    super()
    this.#orchestrator = orchestrator
  }

  get name() { return 'meshctl_exec' }
  get description() { return 'Execute a command on a remote pod via peer session' }
  get parameters() {
    return {
      type: 'object',
      properties: {
        podId: { type: 'string', description: 'Target pod ID' },
        command: { type: 'string', description: 'Command to execute' },
      },
      required: ['podId', 'command'],
    }
  }
  get permission() { return 'network' }

  async execute({ podId, command }) {
    try {
      const result = await this.#orchestrator.execOnPod(podId, command)
      return {
        success: result.exitCode === 0,
        output: result.output,
        error: result.exitCode !== 0 ? `Exit code: ${result.exitCode}` : undefined,
      }
    } catch (err) {
      return { success: false, output: '', error: `Exec failed: ${err.message}` }
    }
  }
}

// ── meshctl_deploy ────────────────────────────────────────────────────

export class MeshctlDeployTool extends BrowserTool {
  #orchestrator

  constructor(orchestrator) {
    super()
    this.#orchestrator = orchestrator
  }

  get name() { return 'meshctl_deploy' }
  get description() { return 'Deploy a skill (SKILL.md content) to a remote pod' }
  get parameters() {
    return {
      type: 'object',
      properties: {
        podId: { type: 'string', description: 'Target pod ID' },
        skillContent: { type: 'string', description: 'SKILL.md content to deploy' },
      },
      required: ['podId', 'skillContent'],
    }
  }
  get permission() { return 'write' }

  async execute({ podId, skillContent }) {
    try {
      const result = await this.#orchestrator.deploySkill(podId, skillContent)
      if (result.success) {
        return { success: true, output: `Skill deployed to ${podId} (${skillContent.length} bytes)` }
      }
      return { success: false, output: '', error: result.error || 'Deploy failed' }
    } catch (err) {
      return { success: false, output: '', error: `Deploy failed: ${err.message}` }
    }
  }
}

// ── meshctl_top ───────────────────────────────────────────────────────

export class MeshctlTopTool extends BrowserTool {
  #orchestrator

  constructor(orchestrator) {
    super()
    this.#orchestrator = orchestrator
  }

  get name() { return 'meshctl_top' }
  get description() { return 'Show resource usage across all pods (CPU, memory, storage, active tasks)' }
  get parameters() {
    return {
      type: 'object',
      properties: {},
    }
  }
  get permission() { return 'read' }

  async execute() {
    try {
      const { pods } = await this.#orchestrator.topPods()
      if (pods.length === 0) {
        return { success: true, output: 'No pods found.' }
      }
      const lines = pods.map(p =>
        `${p.podId} | ${p.status} | cpu: ${p.cpu} | mem: ${p.memory}MB | storage: ${p.storage}MB | tasks: ${p.activeTasks}`
      )
      return {
        success: true,
        output: `POD | STATUS | CPU | MEMORY | STORAGE | TASKS\n${lines.join('\n')}`,
      }
    } catch (err) {
      return { success: false, output: '', error: `Top failed: ${err.message}` }
    }
  }
}

// ── meshctl_expose ────────────────────────────────────────────────────

export class MeshctlExposeTool extends BrowserTool {
  #orchestrator

  constructor(orchestrator) {
    super()
    this.#orchestrator = orchestrator
  }

  get name() { return 'meshctl_expose' }
  get description() { return 'Expose a pod service on the mesh network with a named endpoint' }
  get parameters() {
    return {
      type: 'object',
      properties: {
        podId: { type: 'string', description: 'Pod ID to expose (default: local pod)' },
        port: { type: 'number', description: 'Port number to expose' },
        name: { type: 'string', description: 'Service name for discovery' },
      },
      required: ['port', 'name'],
    }
  }
  get permission() { return 'network' }

  async execute({ podId, port, name }) {
    try {
      const effectivePodId = podId || this.#orchestrator.peerNode.podId || this.#orchestrator.peerNode.id || 'local'
      const result = await this.#orchestrator.exposePod(effectivePodId, port, name)
      if (result.success) {
        return { success: true, output: `Service "${name}" exposed at ${result.address}` }
      }
      return { success: false, output: '', error: 'Expose failed' }
    } catch (err) {
      return { success: false, output: '', error: `Expose failed: ${err.message}` }
    }
  }
}

// ── meshctl_drain ─────────────────────────────────────────────────────

export class MeshctlDrainTool extends BrowserTool {
  #orchestrator

  constructor(orchestrator) {
    super()
    this.#orchestrator = orchestrator
  }

  get name() { return 'meshctl_drain' }
  get description() { return 'Gracefully drain a pod: stop accepting work, migrate tasks, and disconnect' }
  get parameters() {
    return {
      type: 'object',
      properties: {
        podId: { type: 'string', description: 'Pod ID to drain' },
      },
      required: ['podId'],
    }
  }
  get permission() { return 'network' }

  async execute({ podId }) {
    try {
      const result = await this.#orchestrator.drainPod(podId)
      if (result.success) {
        return { success: true, output: `Pod ${podId} drained. Migrated ${result.migrated} tasks.` }
      }
      return { success: false, output: '', error: `Pod "${podId}" not found or already drained.` }
    } catch (err) {
      return { success: false, output: '', error: `Drain failed: ${err.message}` }
    }
  }
}

// ---------------------------------------------------------------------------
// Shell integration helper
// ---------------------------------------------------------------------------

/**
 * Register 'meshctl' as a compound command in the shell registry.
 * Subcommands: pods, status, exec, deploy, top, expose, drain
 *
 * @param {import('./clawser-shell.js').CommandRegistry} shellRegistry
 * @param {MeshOrchestrator} orchestrator
 */
export function registerMeshctlBuiltins(shellRegistry, orchestrator) {
  shellRegistry.register('meshctl', async ({ args }) => {
    const subcommand = args[0]
    const rest = args.slice(1)

    switch (subcommand) {
      case 'pods': {
        const filter = rest[0] || 'all'
        const pods = await orchestrator.listPods(filter)
        if (pods.length === 0) return { stdout: 'No pods found.\n', stderr: '', exitCode: 0 }
        const lines = pods.map(p => {
          const local = p.isLocal ? ' (local)' : ''
          return `${p.podId}\t${p.status}${local}\tconns:${p.connections}`
        })
        return { stdout: lines.join('\n') + '\n', stderr: '', exitCode: 0 }
      }

      case 'status': {
        const podId = rest[0]
        if (!podId) return { stdout: '', stderr: 'Usage: meshctl status <podId>\n', exitCode: 1 }
        const status = await orchestrator.getPodStatus(podId)
        if (!status) return { stdout: '', stderr: `Pod "${podId}" not found.\n`, exitCode: 1 }
        return {
          stdout: JSON.stringify(status.toJSON(), null, 2) + '\n',
          stderr: '',
          exitCode: 0,
        }
      }

      case 'exec': {
        const podId = rest[0]
        const command = rest.slice(1).join(' ')
        if (!podId || !command) return { stdout: '', stderr: 'Usage: meshctl exec <podId> <command>\n', exitCode: 1 }
        try {
          const result = await orchestrator.execOnPod(podId, command)
          return { stdout: result.output + '\n', stderr: '', exitCode: result.exitCode }
        } catch (err) {
          return { stdout: '', stderr: err.message + '\n', exitCode: 1 }
        }
      }

      case 'deploy': {
        const podId = rest[0]
        const skillContent = rest.slice(1).join(' ')
        if (!podId || !skillContent) return { stdout: '', stderr: 'Usage: meshctl deploy <podId> <skillContent>\n', exitCode: 1 }
        const result = await orchestrator.deploySkill(podId, skillContent)
        if (result.success) return { stdout: `Deployed to ${podId}\n`, stderr: '', exitCode: 0 }
        return { stdout: '', stderr: result.error + '\n', exitCode: 1 }
      }

      case 'top': {
        const { pods } = await orchestrator.topPods()
        if (pods.length === 0) return { stdout: 'No pods.\n', stderr: '', exitCode: 0 }
        const lines = pods.map(p =>
          `${p.podId}\tcpu:${p.cpu}\tmem:${p.memory}\tstorage:${p.storage}\ttasks:${p.activeTasks}`
        )
        return { stdout: lines.join('\n') + '\n', stderr: '', exitCode: 0 }
      }

      case 'expose': {
        // meshctl expose <podId> <port> <name>
        const [ePodId, ePort, eName] = rest
        const parsedPort = parseInt(ePort, 10)
        if (!ePodId || !ePort || !eName || !Number.isFinite(parsedPort)) {
          return { stdout: '', stderr: 'Usage: meshctl expose <podId> <port> <name>\n', exitCode: 1 }
        }
        const result = await orchestrator.exposePod(ePodId, parsedPort, eName)
        if (result.success) return { stdout: `Exposed "${eName}" at ${result.address}\n`, stderr: '', exitCode: 0 }
        return { stdout: '', stderr: 'Expose failed.\n', exitCode: 1 }
      }

      case 'drain': {
        const podId = rest[0]
        if (!podId) return { stdout: '', stderr: 'Usage: meshctl drain <podId>\n', exitCode: 1 }
        const result = await orchestrator.drainPod(podId)
        if (result.success) return { stdout: `Drained ${podId}. Migrated ${result.migrated} tasks.\n`, stderr: '', exitCode: 0 }
        return { stdout: '', stderr: `Pod "${podId}" not found.\n`, exitCode: 1 }
      }

      default:
        return {
          stdout: '',
          stderr: `Unknown subcommand: ${subcommand || '(none)'}. Available: pods, status, exec, deploy, top, expose, drain\n`,
          exitCode: 1,
        }
    }
  }, {
    description: 'Pod orchestration commands for the mesh network',
    category: 'mesh',
    usage: 'meshctl <subcommand> [args...]',
  })
}

// ---------------------------------------------------------------------------
// Tool registration helper
// ---------------------------------------------------------------------------

/**
 * Create all meshctl BrowserTool instances for a given orchestrator.
 * @param {MeshOrchestrator} orchestrator
 * @returns {BrowserTool[]}
 */
export function createMeshctlTools(orchestrator) {
  return [
    new MeshctlPodsTool(orchestrator),
    new MeshctlStatusTool(orchestrator),
    new MeshctlExecTool(orchestrator),
    new MeshctlDeployTool(orchestrator),
    new MeshctlTopTool(orchestrator),
    new MeshctlExposeTool(orchestrator),
    new MeshctlDrainTool(orchestrator),
  ]
}
