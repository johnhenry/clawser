// Run with: node --import ./web/test/_setup-globals.mjs --test web/test/clawser-mesh-orchestrator.test.mjs
import { describe, it, beforeEach } from 'node:test'
import assert from 'node:assert/strict'

import {
  ORCH_LIST_PODS,
  ORCH_POD_STATUS,
  ORCH_EXEC,
  ORCH_DEPLOY,
  ORCH_DRAIN,
  ORCH_EXPOSE,
  ORCH_ROUTE,
  PodInfo,
  PodStatus,
  PodResourceInfo,
  MeshOrchestrator,
  MeshctlPodsTool,
  MeshctlStatusTool,
  MeshctlExecTool,
  MeshctlDeployTool,
  MeshctlTopTool,
  MeshctlExposeTool,
  MeshctlDrainTool,
  registerMeshctlBuiltins,
  createMeshctlTools,
} from '../clawser-mesh-orchestrator.js'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makePeerNode(overrides = {}) {
  return {
    podId: 'local-pod',
    id: 'local-pod',
    label: 'Local Pod',
    capabilities: ['wasm', 'gpu'],
    services: [],
    resources: { cpu: 8, memory: 16384, storage: 102400 },
    uptime: 60000,
    activeTasks: 2,
    ...overrides,
  }
}

function makeOrchestrator(overrides = {}) {
  return new MeshOrchestrator({
    peerNode: makePeerNode(),
    ...overrides,
  })
}

function makeRemotePeer(overrides = {}) {
  return {
    label: 'Remote Pod',
    status: 'online',
    capabilities: ['js'],
    services: ['api'],
    resources: { cpu: 4, memory: 8192, storage: 51200 },
    connections: 3,
    uptime: 30000,
    activeTasks: 1,
    ...overrides,
  }
}

// ---------------------------------------------------------------------------
// Wire constants
// ---------------------------------------------------------------------------

describe('Wire constants', () => {
  it('ORCH_LIST_PODS equals 0xD0', () => {
    assert.equal(ORCH_LIST_PODS, 0xd0)
  })

  it('ORCH_POD_STATUS equals 0xD1', () => {
    assert.equal(ORCH_POD_STATUS, 0xd1)
  })

  it('ORCH_EXEC equals 0xD2', () => {
    assert.equal(ORCH_EXEC, 0xd2)
  })

  it('ORCH_DEPLOY equals 0xD3', () => {
    assert.equal(ORCH_DEPLOY, 0xd3)
  })

  it('ORCH_DRAIN equals 0xD4', () => {
    assert.equal(ORCH_DRAIN, 0xd4)
  })

  it('ORCH_EXPOSE equals 0xD5', () => {
    assert.equal(ORCH_EXPOSE, 0xd5)
  })

  it('ORCH_ROUTE equals 0xD6', () => {
    assert.equal(ORCH_ROUTE, 0xd6)
  })
})

// ---------------------------------------------------------------------------
// PodInfo
// ---------------------------------------------------------------------------

describe('PodInfo', () => {
  it('constructor sets all fields', () => {
    const p = new PodInfo({
      podId: 'pod-a',
      label: 'Alpha',
      status: 'online',
      services: ['web', 'api'],
      connections: 5,
      isLocal: true,
    })
    assert.equal(p.podId, 'pod-a')
    assert.equal(p.label, 'Alpha')
    assert.equal(p.status, 'online')
    assert.deepEqual(p.services, ['web', 'api'])
    assert.equal(p.connections, 5)
    assert.equal(p.isLocal, true)
  })

  it('applies defaults', () => {
    const p = new PodInfo({ podId: 'pod-b' })
    assert.equal(p.label, '')
    assert.equal(p.status, 'online')
    assert.deepEqual(p.services, [])
    assert.equal(p.connections, 0)
    assert.equal(p.isLocal, false)
  })

  it('throws when podId is missing', () => {
    assert.throws(() => new PodInfo({}), /podId is required/)
  })

  it('round-trips via JSON', () => {
    const p = new PodInfo({ podId: 'pod-c', label: 'Charlie', services: ['db'] })
    const p2 = PodInfo.fromJSON(p.toJSON())
    assert.deepEqual(p2.toJSON(), p.toJSON())
  })

  it('copies services array', () => {
    const svcs = ['a', 'b']
    const p = new PodInfo({ podId: 'pod-d', services: svcs })
    svcs.push('c')
    assert.deepEqual(p.services, ['a', 'b'])
  })
})

// ---------------------------------------------------------------------------
// PodStatus
// ---------------------------------------------------------------------------

describe('PodStatus', () => {
  it('constructor sets all fields', () => {
    const s = new PodStatus({
      podId: 'pod-a',
      status: 'online',
      capabilities: ['gpu'],
      services: ['api'],
      connections: 3,
      uptime: 60000,
      resources: { cpu: 8, memory: 16384, storage: 1024 },
      isLocal: true,
    })
    assert.equal(s.podId, 'pod-a')
    assert.equal(s.status, 'online')
    assert.deepEqual(s.capabilities, ['gpu'])
    assert.equal(s.connections, 3)
    assert.equal(s.uptime, 60000)
    assert.equal(s.resources.cpu, 8)
    assert.equal(s.isLocal, true)
  })

  it('applies defaults', () => {
    const s = new PodStatus({ podId: 'pod-b' })
    assert.equal(s.status, 'online')
    assert.deepEqual(s.capabilities, [])
    assert.equal(s.resources.cpu, 0)
  })

  it('throws when podId is missing', () => {
    assert.throws(() => new PodStatus({}), /podId is required/)
  })

  it('round-trips via JSON', () => {
    const s = new PodStatus({ podId: 'pod-c', capabilities: ['wasm'] })
    const s2 = PodStatus.fromJSON(s.toJSON())
    assert.deepEqual(s2.toJSON(), s.toJSON())
  })
})

// ---------------------------------------------------------------------------
// MeshOrchestrator — construction
// ---------------------------------------------------------------------------

describe('MeshOrchestrator', () => {
  let orch

  beforeEach(() => {
    orch = makeOrchestrator()
  })

  it('constructor requires peerNode', () => {
    assert.throws(() => new MeshOrchestrator({}), /peerNode is required/)
  })

  it('constructor accepts optional dependencies', () => {
    const o = new MeshOrchestrator({
      peerNode: makePeerNode(),
      serviceAdvertiser: { advertise() {} },
      serviceBrowser: {},
      router: {},
      onLog: () => {},
    })
    assert.ok(o)
  })

  // -- listPods -------------------------------------------------------------

  it('listPods includes local pod', async () => {
    const pods = await orch.listPods()
    assert.equal(pods.length, 1)
    assert.equal(pods[0].podId, 'local-pod')
    assert.equal(pods[0].isLocal, true)
  })

  it('listPods includes remote peers', async () => {
    orch.addPeer('remote-1', makeRemotePeer())
    const pods = await orch.listPods()
    assert.equal(pods.length, 2)
    const remote = pods.find(p => p.podId === 'remote-1')
    assert.ok(remote)
    assert.equal(remote.isLocal, false)
  })

  it('listPods filters by status', async () => {
    orch.addPeer('remote-1', makeRemotePeer({ status: 'online' }))
    orch.addPeer('remote-2', makeRemotePeer({ status: 'offline' }))
    const online = await orch.listPods('online')
    // local-pod is online + remote-1 is online
    assert.equal(online.length, 2)
    const offline = await orch.listPods('offline')
    assert.equal(offline.length, 1)
    assert.equal(offline[0].podId, 'remote-2')
  })

  it('listPods with "all" filter returns everything', async () => {
    orch.addPeer('remote-1', makeRemotePeer({ status: 'offline' }))
    const all = await orch.listPods('all')
    assert.equal(all.length, 2)
  })

  // -- getPodStatus ---------------------------------------------------------

  it('getPodStatus returns detailed info for local pod', async () => {
    const status = await orch.getPodStatus('local-pod')
    assert.ok(status)
    assert.equal(status.podId, 'local-pod')
    assert.equal(status.isLocal, true)
    assert.deepEqual(status.capabilities, ['wasm', 'gpu'])
    assert.equal(status.uptime, 60000)
    assert.equal(status.resources.cpu, 8)
  })

  it('getPodStatus returns detailed info for remote pod', async () => {
    orch.addPeer('remote-1', makeRemotePeer({ capabilities: ['js', 'wasm'] }))
    const status = await orch.getPodStatus('remote-1')
    assert.ok(status)
    assert.equal(status.podId, 'remote-1')
    assert.equal(status.isLocal, false)
    assert.deepEqual(status.capabilities, ['js', 'wasm'])
  })

  it('getPodStatus returns null for unknown pod', async () => {
    const status = await orch.getPodStatus('nonexistent')
    assert.equal(status, null)
  })

  // -- execOnPod ------------------------------------------------------------

  it('execOnPod delegates to peer terminal (mock)', async () => {
    orch.addPeer('remote-1', makeRemotePeer({
      exec: async (cmd) => ({ output: `ran: ${cmd}`, exitCode: 0 }),
    }))
    const result = await orch.execOnPod('remote-1', 'echo hello')
    assert.equal(result.output, 'ran: echo hello')
    assert.equal(result.exitCode, 0)
  })

  it('execOnPod falls back to send if no exec', async () => {
    let sent = null
    orch.addPeer('remote-2', makeRemotePeer({
      send: (msg) => { sent = msg },
    }))
    const result = await orch.execOnPod('remote-2', 'ls')
    assert.equal(result.exitCode, 0)
    assert.deepEqual(sent, { type: 'exec', command: 'ls' })
  })

  it('execOnPod throws for unknown pod', async () => {
    await assert.rejects(
      () => orch.execOnPod('nonexistent', 'echo hello'),
      /not found/,
    )
  })

  it('execOnPod throws when command is empty', async () => {
    await assert.rejects(
      () => orch.execOnPod('local-pod', ''),
      /command is required/,
    )
  })

  it('execOnPod executes locally when peerNode has exec', async () => {
    const o = makeOrchestrator({
      peerNode: makePeerNode({
        exec: async (cmd) => ({ output: `local: ${cmd}`, exitCode: 0 }),
      }),
    })
    const result = await o.execOnPod('local-pod', 'pwd')
    assert.equal(result.output, 'local: pwd')
  })

  // -- deploySkill ----------------------------------------------------------

  it('deploySkill sends content to remote pod (mock)', async () => {
    let deployed = null
    orch.addPeer('remote-1', makeRemotePeer({
      deploySkill: async (content) => { deployed = content; return { success: true } },
    }))
    const result = await orch.deploySkill('remote-1', '# My Skill\nname: test')
    assert.equal(result.success, true)
    assert.equal(deployed, '# My Skill\nname: test')
  })

  it('deploySkill falls back to send', async () => {
    let sent = null
    orch.addPeer('remote-2', makeRemotePeer({
      send: (msg) => { sent = msg },
    }))
    const result = await orch.deploySkill('remote-2', 'skill content')
    assert.equal(result.success, true)
    assert.deepEqual(sent, { type: 'deploy_skill', content: 'skill content' })
  })

  it('deploySkill fails for unknown pod', async () => {
    const result = await orch.deploySkill('nonexistent', 'content')
    assert.equal(result.success, false)
    assert.match(result.error, /not found/)
  })

  it('deploySkill fails for empty content', async () => {
    orch.addPeer('remote-1', makeRemotePeer())
    const result = await orch.deploySkill('remote-1', '')
    assert.equal(result.success, false)
    assert.match(result.error, /skillContent is required/)
  })

  // -- drainPod -------------------------------------------------------------

  it('drainPod disconnects peer and returns success', async () => {
    orch.addPeer('remote-1', makeRemotePeer())
    const result = await orch.drainPod('remote-1')
    assert.equal(result.success, true)
    assert.equal(orch.peerCount, 0)
  })

  it('drainPod invokes drain callback if available', async () => {
    let drained = false
    orch.addPeer('remote-1', makeRemotePeer({
      drain: async () => { drained = true; return { migrated: 3 } },
    }))
    const result = await orch.drainPod('remote-1')
    assert.equal(result.success, true)
    assert.equal(result.migrated, 3)
    assert.ok(drained)
  })

  it('drainPod fails for unknown pod', async () => {
    const result = await orch.drainPod('nonexistent')
    assert.equal(result.success, false)
  })

  it('drainPod marks pod as draining in listings', async () => {
    // Drain the local pod (stays in listings)
    await orch.drainPod('local-pod')
    const pods = await orch.listPods()
    assert.equal(pods[0].status, 'draining')
  })

  // -- topPods --------------------------------------------------------------

  it('topPods returns resource snapshot for local pod', async () => {
    const { pods } = await orch.topPods()
    assert.equal(pods.length, 1)
    assert.equal(pods[0].podId, 'local-pod')
    assert.equal(pods[0].cpu, 8)
    assert.equal(pods[0].memory, 16384)
    assert.equal(pods[0].activeTasks, 2)
  })

  it('topPods includes remote peers', async () => {
    orch.addPeer('remote-1', makeRemotePeer({ activeTasks: 5 }))
    const { pods } = await orch.topPods()
    assert.equal(pods.length, 2)
    const remote = pods.find(p => p.podId === 'remote-1')
    assert.ok(remote)
    assert.equal(remote.activeTasks, 5)
  })

  // -- exposePod / routeService ---------------------------------------------

  it('exposePod registers a service', async () => {
    const result = await orch.exposePod('local-pod', 8080, 'web')
    assert.equal(result.success, true)
    assert.equal(result.address, 'local-pod:8080')
  })

  it('exposePod shows up in listPods services', async () => {
    await orch.exposePod('local-pod', 8080, 'web')
    const pods = await orch.listPods()
    assert.ok(pods[0].services.includes('web'))
  })

  it('exposePod calls serviceAdvertiser if available', async () => {
    let advertised = null
    const o = makeOrchestrator({
      serviceAdvertiser: { advertise: (svc) => { advertised = svc } },
    })
    await o.exposePod('local-pod', 3000, 'api')
    assert.deepEqual(advertised, { name: 'api', type: 'http-proxy', podId: 'local-pod', port: 3000 })
  })

  it('exposePod fails with invalid port', async () => {
    const result = await orch.exposePod('local-pod', 0, 'web')
    assert.equal(result.success, false)
  })

  it('routeService registers a route', async () => {
    const result = await orch.routeService('db', 'remote-1')
    assert.equal(result.success, true)
  })

  it('routeService calls router.addRoute if available', async () => {
    let routed = null
    const o = makeOrchestrator({
      router: { addRoute: (target, nextHop, hops) => { routed = { target, nextHop, hops } } },
    })
    await o.routeService('api', 'pod-x')
    assert.deepEqual(routed, { target: 'pod-x', nextHop: 'pod-x', hops: 1 })
  })

  it('routeService fails with empty name', async () => {
    const result = await orch.routeService('', 'pod-x')
    assert.equal(result.success, false)
  })

  // -- tunnelPort -----------------------------------------------------------

  it('tunnelPort creates a tunnel', async () => {
    const result = await orch.tunnelPort('remote-1', 5432, 15432)
    assert.equal(result.success, true)
    assert.ok(result.tunnelId)
    assert.match(result.tunnelId, /^tunnel_/)
  })

  it('tunnelPort fails with invalid port', async () => {
    const result = await orch.tunnelPort('remote-1', 0, 15432)
    assert.equal(result.success, false)
  })

  // -- peer management ------------------------------------------------------

  it('addPeer / removePeer manage known peers', () => {
    orch.addPeer('remote-1', makeRemotePeer())
    assert.equal(orch.peerCount, 1)
    orch.removePeer('remote-1')
    assert.equal(orch.peerCount, 0)
  })

  it('removePeer returns false for unknown peer', () => {
    assert.equal(orch.removePeer('nope'), false)
  })
})

// ---------------------------------------------------------------------------
// BrowserTool subclasses — shared basics
// ---------------------------------------------------------------------------

describe('BrowserTool subclasses — basics', () => {
  let orch
  let tools

  beforeEach(() => {
    orch = makeOrchestrator()
    tools = createMeshctlTools(orch)
  })

  it('createMeshctlTools returns array of 7 tools', () => {
    assert.equal(tools.length, 7)
  })

  it('all have unique names', () => {
    const names = tools.map(t => t.name)
    assert.equal(new Set(names).size, 7)
  })

  it('all have descriptions', () => {
    for (const tool of tools) {
      assert.ok(tool.description.length > 0, `${tool.name} needs description`)
    }
  })

  it('all have parameters with type object', () => {
    for (const tool of tools) {
      assert.equal(tool.parameters.type, 'object', `${tool.name} params`)
    }
  })

  it('all have correct permission levels', () => {
    const expected = {
      meshctl_pods: 'read',
      meshctl_status: 'read',
      meshctl_exec: 'network',
      meshctl_deploy: 'write',
      meshctl_top: 'read',
      meshctl_expose: 'network',
      meshctl_drain: 'network',
    }
    for (const tool of tools) {
      assert.equal(tool.permission, expected[tool.name], `${tool.name} permission`)
    }
  })

  it('tool names are meshctl_pods, meshctl_status, meshctl_exec, meshctl_deploy, meshctl_top, meshctl_expose, meshctl_drain', () => {
    const names = tools.map(t => t.name).sort()
    assert.deepEqual(names, [
      'meshctl_deploy',
      'meshctl_drain',
      'meshctl_exec',
      'meshctl_expose',
      'meshctl_pods',
      'meshctl_status',
      'meshctl_top',
    ])
  })
})

// ---------------------------------------------------------------------------
// MeshctlPodsTool
// ---------------------------------------------------------------------------

describe('MeshctlPodsTool', () => {
  let orch, tool

  beforeEach(() => {
    orch = makeOrchestrator()
    tool = new MeshctlPodsTool(orch)
  })

  it('lists pods with success', async () => {
    const result = await tool.execute()
    assert.ok(result.success)
    assert.match(result.output, /local-pod/)
    assert.match(result.output, /local/)
  })

  it('includes remote pods', async () => {
    orch.addPeer('remote-1', makeRemotePeer())
    const result = await tool.execute()
    assert.ok(result.success)
    assert.match(result.output, /remote-1/)
  })

  it('filters by status', async () => {
    orch.addPeer('remote-1', makeRemotePeer({ status: 'offline' }))
    const result = await tool.execute({ filter: 'offline' })
    assert.ok(result.success)
    assert.match(result.output, /remote-1/)
    // local-pod is online, should not appear
    assert.ok(!result.output.includes('local-pod'))
  })
})

// ---------------------------------------------------------------------------
// MeshctlStatusTool
// ---------------------------------------------------------------------------

describe('MeshctlStatusTool', () => {
  let orch, tool

  beforeEach(() => {
    orch = makeOrchestrator()
    tool = new MeshctlStatusTool(orch)
  })

  it('returns detailed status', async () => {
    const result = await tool.execute({ podId: 'local-pod' })
    assert.ok(result.success)
    assert.match(result.output, /local-pod/)
    assert.match(result.output, /wasm/)
    assert.match(result.output, /cpu=8/)
  })

  it('returns error for unknown pod', async () => {
    const result = await tool.execute({ podId: 'nonexistent' })
    assert.equal(result.success, false)
    assert.match(result.error, /not found/)
  })
})

// ---------------------------------------------------------------------------
// MeshctlExecTool
// ---------------------------------------------------------------------------

describe('MeshctlExecTool', () => {
  let orch, tool

  beforeEach(() => {
    orch = makeOrchestrator()
    tool = new MeshctlExecTool(orch)
  })

  it('executes and returns output', async () => {
    orch.addPeer('remote-1', makeRemotePeer({
      exec: async (cmd) => ({ output: `result: ${cmd}`, exitCode: 0 }),
    }))
    const result = await tool.execute({ podId: 'remote-1', command: 'ls' })
    assert.ok(result.success)
    assert.match(result.output, /result: ls/)
  })

  it('returns error on non-zero exit code', async () => {
    orch.addPeer('remote-1', makeRemotePeer({
      exec: async () => ({ output: 'fail', exitCode: 1 }),
    }))
    const result = await tool.execute({ podId: 'remote-1', command: 'bad' })
    assert.equal(result.success, false)
    assert.match(result.error, /Exit code/)
  })

  it('returns error for unknown pod', async () => {
    const result = await tool.execute({ podId: 'nonexistent', command: 'ls' })
    assert.equal(result.success, false)
    assert.match(result.error, /not found/)
  })
})

// ---------------------------------------------------------------------------
// MeshctlDeployTool
// ---------------------------------------------------------------------------

describe('MeshctlDeployTool', () => {
  let orch, tool

  beforeEach(() => {
    orch = makeOrchestrator()
    tool = new MeshctlDeployTool(orch)
  })

  it('deploys skill and returns success', async () => {
    orch.addPeer('remote-1', makeRemotePeer({
      deploySkill: async () => ({ success: true }),
    }))
    const result = await tool.execute({ podId: 'remote-1', skillContent: '# Skill\nname: test' })
    assert.ok(result.success)
    assert.match(result.output, /deployed/i)
  })

  it('returns error for unknown pod', async () => {
    const result = await tool.execute({ podId: 'nonexistent', skillContent: 'content' })
    assert.equal(result.success, false)
    assert.match(result.error, /not found/)
  })

  it('returns error for empty content', async () => {
    orch.addPeer('remote-1', makeRemotePeer())
    const result = await tool.execute({ podId: 'remote-1', skillContent: '' })
    assert.equal(result.success, false)
  })
})

// ---------------------------------------------------------------------------
// MeshctlTopTool
// ---------------------------------------------------------------------------

describe('MeshctlTopTool', () => {
  let orch, tool

  beforeEach(() => {
    orch = makeOrchestrator()
    tool = new MeshctlTopTool(orch)
  })

  it('returns resource snapshot', async () => {
    const result = await tool.execute()
    assert.ok(result.success)
    assert.match(result.output, /local-pod/)
    assert.match(result.output, /cpu: 8/)
    assert.match(result.output, /mem: 16384/)
  })

  it('includes remote peers', async () => {
    orch.addPeer('remote-1', makeRemotePeer())
    const result = await tool.execute()
    assert.ok(result.success)
    assert.match(result.output, /remote-1/)
  })
})

// ---------------------------------------------------------------------------
// MeshctlExposeTool
// ---------------------------------------------------------------------------

describe('MeshctlExposeTool', () => {
  let orch, tool

  beforeEach(() => {
    orch = makeOrchestrator()
    tool = new MeshctlExposeTool(orch)
  })

  it('exposes a service', async () => {
    const result = await tool.execute({ port: 8080, name: 'web' })
    assert.ok(result.success)
    assert.match(result.output, /web/)
    assert.match(result.output, /8080/)
  })

  it('uses provided podId', async () => {
    orch.addPeer('remote-1', makeRemotePeer())
    const result = await tool.execute({ podId: 'remote-1', port: 3000, name: 'api' })
    assert.ok(result.success)
    assert.match(result.output, /remote-1:3000/)
  })
})

// ---------------------------------------------------------------------------
// MeshctlDrainTool
// ---------------------------------------------------------------------------

describe('MeshctlDrainTool', () => {
  let orch, tool

  beforeEach(() => {
    orch = makeOrchestrator()
    tool = new MeshctlDrainTool(orch)
  })

  it('drains a pod', async () => {
    orch.addPeer('remote-1', makeRemotePeer())
    const result = await tool.execute({ podId: 'remote-1' })
    assert.ok(result.success)
    assert.match(result.output, /drained/i)
  })

  it('returns error for unknown pod', async () => {
    const result = await tool.execute({ podId: 'nonexistent' })
    assert.equal(result.success, false)
    assert.match(result.error, /not found/)
  })
})

// ---------------------------------------------------------------------------
// registerMeshctlBuiltins
// ---------------------------------------------------------------------------

describe('registerMeshctlBuiltins', () => {
  it('registers meshctl command', () => {
    const registered = {}
    const shellRegistry = {
      register(name, handler, meta) { registered[name] = { handler, meta } },
    }
    const orch = makeOrchestrator()
    registerMeshctlBuiltins(shellRegistry, orch)
    assert.ok(registered.meshctl)
    assert.equal(registered.meshctl.meta.category, 'mesh')
  })

  it('meshctl pods subcommand works', async () => {
    const registered = {}
    const shellRegistry = {
      register(name, handler, meta) { registered[name] = { handler, meta } },
    }
    const orch = makeOrchestrator()
    registerMeshctlBuiltins(shellRegistry, orch)
    const result = await registered.meshctl.handler({ args: ['pods'] })
    assert.equal(result.exitCode, 0)
    assert.match(result.stdout, /local-pod/)
  })

  it('meshctl status subcommand requires podId', async () => {
    const registered = {}
    const shellRegistry = {
      register(name, handler, meta) { registered[name] = { handler, meta } },
    }
    const orch = makeOrchestrator()
    registerMeshctlBuiltins(shellRegistry, orch)
    const result = await registered.meshctl.handler({ args: ['status'] })
    assert.equal(result.exitCode, 1)
    assert.match(result.stderr, /Usage/)
  })

  it('meshctl unknown subcommand returns error', async () => {
    const registered = {}
    const shellRegistry = {
      register(name, handler, meta) { registered[name] = { handler, meta } },
    }
    const orch = makeOrchestrator()
    registerMeshctlBuiltins(shellRegistry, orch)
    const result = await registered.meshctl.handler({ args: ['bogus'] })
    assert.equal(result.exitCode, 1)
    assert.match(result.stderr, /Unknown subcommand/)
  })

  it('meshctl top subcommand returns resource info', async () => {
    const registered = {}
    const shellRegistry = {
      register(name, handler, meta) { registered[name] = { handler, meta } },
    }
    const orch = makeOrchestrator()
    registerMeshctlBuiltins(shellRegistry, orch)
    const result = await registered.meshctl.handler({ args: ['top'] })
    assert.equal(result.exitCode, 0)
    assert.match(result.stdout, /local-pod/)
  })

  it('meshctl expose subcommand requires all args', async () => {
    const registered = {}
    const shellRegistry = {
      register(name, handler, meta) { registered[name] = { handler, meta } },
    }
    const orch = makeOrchestrator()
    registerMeshctlBuiltins(shellRegistry, orch)
    const result = await registered.meshctl.handler({ args: ['expose', 'pod-a'] })
    assert.equal(result.exitCode, 1)
    assert.match(result.stderr, /Usage/)
  })

  it('meshctl drain subcommand requires podId', async () => {
    const registered = {}
    const shellRegistry = {
      register(name, handler, meta) { registered[name] = { handler, meta } },
    }
    const orch = makeOrchestrator()
    registerMeshctlBuiltins(shellRegistry, orch)
    const result = await registered.meshctl.handler({ args: ['drain'] })
    assert.equal(result.exitCode, 1)
    assert.match(result.stderr, /Usage/)
  })
})
