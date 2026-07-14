// clawser-swarm-controller.test.mjs

import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

import { buildSwarmViewModel, buildSwarmController } from '../clawser-swarm-controller.mjs'

const fakeSC = (overrides = {}) => ({
  swarmSize: 0,
  isLeader: false,
  leader: 'leader-pod',
  joins: [],
  leaves: [],
  tasksSubmitted: [],
  tasksCancelled: [],
  listMembers() { return overrides.members || [] },
  listTasks() { return overrides.tasks || [] },
  join(podId) { this.joins.push(podId) },
  leave(podId) { this.leaves.push(podId) },
  submitTask(description, strategy, input) {
    const t = { taskId: `t${this.tasksSubmitted.length + 1}`, description, strategy, input }
    this.tasksSubmitted.push(t)
    return t
  },
  cancelTask(id) { this.tasksCancelled.push(id); return id !== 'missing' },
})

describe('buildSwarmViewModel', () => {
  it('returns empty when there is no coordinator', () => {
    const vm = buildSwarmViewModel(null, 'me')
    assert.deepEqual(vm.swarms, [])
  })

  it('synthesizes a single swarm with members + subtasks', () => {
    const sc = fakeSC({
      members: ['me', 'peer-1'],
      tasks: [
        { taskId: 't-1', description: 'A', status: 'pending', assignedTo: ['peer-1'], output: null },
        { taskId: 't-2', description: 'B', status: 'completed', assignedTo: ['me'], output: 'done' },
      ],
    })
    const vm = buildSwarmViewModel(sc, 'me')
    assert.equal(vm.swarms.length, 1)
    assert.equal(vm.swarms[0].id, 'local')
    assert.equal(vm.swarms[0].status, 'active')
    assert.deepEqual(vm.swarms[0].members, ['me', 'peer-1'])
    assert.equal(vm.swarms[0].subtasks.length, 2)
    assert.equal(vm.swarms[0].subtasks[0].id, 't-1')
    assert.deepEqual(vm.swarms[0].subtasks[0].assignee, ['peer-1'])
  })

  it('marks the swarm as forming when there are no members', () => {
    const sc = fakeSC({ members: [] })
    const vm = buildSwarmViewModel(sc, 'me')
    assert.equal(vm.swarms[0].status, 'forming')
  })

  it('lists one card per real swarm when listSwarms is available', () => {
    const sc = fakeSC()
    sc.listSwarms = () => ([
      { swarmId: 'local', size: 1, isLeader: true, leader: null, taskCount: 0 },
      { swarmId: 'team-a', size: 2, isLeader: false, leader: 'peer-1', taskCount: 1 },
    ])
    sc.listMembers = (swarmId) => (swarmId === 'team-a' ? ['me', 'peer-1'] : ['me'])
    sc.listTasks = (opts) => (opts?.swarmId === 'team-a' ? [{ taskId: 't-1', description: 'A', status: 'pending', assignedTo: ['peer-1'], output: null }] : [])

    const vm = buildSwarmViewModel(sc, 'me')
    assert.equal(vm.swarms.length, 2)
    assert.deepEqual(vm.swarms.map(s => s.id), ['local', 'team-a'])
    assert.equal(vm.swarms[1].leader, 'peer-1')
    assert.equal(vm.swarms[1].subtasks.length, 1)
    assert.deepEqual(vm.swarms[1].subtasks[0].assignee, ['peer-1']) // maps from task.assignedTo (SwarmTask has no .assignee field)
  })

  it("uses the swarmId itself as the goal label for non-local swarms", () => {
    const sc = fakeSC()
    sc.listSwarms = () => ([{ swarmId: 'team-a', size: 1, isLeader: false, leader: null, taskCount: 0 }])
    sc.listMembers = () => ['me']
    const vm = buildSwarmViewModel(sc, 'me')
    assert.equal(vm.swarms[0].goal, 'team-a')
  })
})

describe('buildSwarmController', () => {
  it('onCreate calls submitTask + sc.join for each member', async () => {
    const sc = fakeSC()
    let logged = ''
    const ctrl = buildSwarmController({ coordinator: sc, localPodId: 'me', onLog: (m) => { logged = m } })
    const r = await ctrl.onCreate({ goal: 'ship it', strategy: 'leader-follower', members: ['p1', 'p2'], maxAgents: 5 })
    assert.equal(r.ok, true)
    assert.equal(sc.tasksSubmitted.length, 1)
    assert.equal(sc.tasksSubmitted[0].description, 'ship it')
    assert.deepEqual(sc.joins, ['p1', 'p2'])
    assert.match(logged, /max=5/)
    assert.match(logged, /2 members/)
  })

  it('onCreate rejects empty goal', async () => {
    const sc = fakeSC()
    const ctrl = buildSwarmController({ coordinator: sc, localPodId: 'me' })
    const r = await ctrl.onCreate({ goal: '' })
    assert.equal(r.ok, false)
  })

  it('onCreate creates a new (non-local) swarm and joins members into it when createSwarm is available', async () => {
    const sc = fakeSC()
    sc.created = []
    sc.createSwarm = (id) => { sc.created.push(id) }
    const joinedInto = []
    sc.join = (podId, caps, swarmId) => joinedInto.push({ podId, swarmId })
    const submittedTo = []
    sc.submitTask = (description, strategy, input, swarmId) => {
      submittedTo.push(swarmId)
      return { taskId: 't1', description, strategy, input }
    }
    const ctrl = buildSwarmController({ coordinator: sc, localPodId: 'me', generateSwarmId: () => 'swarm_fixed' })
    const r = await ctrl.onCreate({ goal: 'ship it', members: ['p1', 'p2'] })
    assert.equal(r.ok, true)
    assert.equal(r.swarmId, 'swarm_fixed')
    assert.deepEqual(sc.created, ['swarm_fixed'])
    assert.deepEqual(joinedInto, [{ podId: 'p1', swarmId: 'swarm_fixed' }, { podId: 'p2', swarmId: 'swarm_fixed' }])
    assert.deepEqual(submittedTo, ['swarm_fixed'])
  })

  it('onCreate falls back to the local swarm when createSwarm is unavailable', async () => {
    const sc = fakeSC()
    const ctrl = buildSwarmController({ coordinator: sc, localPodId: 'me' })
    const r = await ctrl.onCreate({ goal: 'ship it', members: ['p1'] })
    assert.equal(r.ok, true)
    assert.equal(r.swarmId, 'local')
  })

  it('onJoin uses promptForPodId to get the joining podId', async () => {
    const sc = fakeSC()
    const ctrl = buildSwarmController({ coordinator: sc, localPodId: 'me', promptForPodId: async () => 'peer-x' })
    const r = await ctrl.onJoin('local')
    assert.equal(r.ok, true)
    assert.deepEqual(sc.joins, ['peer-x'])
  })

  it('onJoin returns cancelled when prompt is null', async () => {
    const sc = fakeSC()
    const ctrl = buildSwarmController({ coordinator: sc, localPodId: 'me', promptForPodId: async () => null })
    const r = await ctrl.onJoin('local')
    assert.equal(r.ok, false)
    assert.equal(r.error, 'cancelled')
  })

  it('onLeave calls sc.leave with localPodId', () => {
    const sc = fakeSC()
    const ctrl = buildSwarmController({ coordinator: sc, localPodId: 'me' })
    ctrl.onLeave('local')
    assert.deepEqual(sc.leaves, ['me'])
  })

  it('onDisband refuses to disband the local swarm', () => {
    let msg = ''
    const ctrl = buildSwarmController({ coordinator: fakeSC(), localPodId: 'me', onLog: (m) => { msg = m } })
    const r = ctrl.onDisband('local')
    assert.equal(r.ok, false)
    assert.match(msg, /can't be disbanded/)
  })

  it('onDisband logs unsupported when the coordinator has no disbandSwarm', () => {
    let msg = ''
    const ctrl = buildSwarmController({ coordinator: fakeSC(), localPodId: 'me', onLog: (m) => { msg = m } })
    const r = ctrl.onDisband('team-a')
    assert.equal(r.ok, false)
    assert.match(msg, /does not support disbanding/)
  })

  it('onDisband disbands a real non-local swarm', () => {
    let msg = ''
    const sc = fakeSC()
    sc.disbandSwarm = (id) => { sc.disbanded = id; return true }
    const ctrl = buildSwarmController({ coordinator: sc, localPodId: 'me', onLog: (m) => { msg = m } })
    const r = ctrl.onDisband('team-a')
    assert.equal(r.ok, true)
    assert.equal(sc.disbanded, 'team-a')
    assert.match(msg, /disbanded/)
  })

  it('onDisband reports when the target swarm was not found', () => {
    const sc = fakeSC()
    sc.disbandSwarm = () => false
    const ctrl = buildSwarmController({ coordinator: sc, localPodId: 'me' })
    const r = ctrl.onDisband('team-a')
    assert.equal(r.ok, false)
  })

  it('onRemove cancels a task by id', () => {
    const sc = fakeSC()
    const ctrl = buildSwarmController({ coordinator: sc, localPodId: 'me' })
    const r = ctrl.onRemove('t-7')
    assert.equal(r.ok, true)
    assert.deepEqual(sc.tasksCancelled, ['t-7'])
  })

  it('onRemove rejects synthetic local id', () => {
    const ctrl = buildSwarmController({ coordinator: fakeSC(), localPodId: 'me' })
    const r = ctrl.onRemove('local')
    assert.equal(r.ok, false)
  })

  it('onRemove rejects any real swarmId when hasSwarm is available', () => {
    const sc = fakeSC()
    sc.hasSwarm = (id) => id === 'team-a'
    const ctrl = buildSwarmController({ coordinator: sc, localPodId: 'me' })
    const r = ctrl.onRemove('team-a')
    assert.equal(r.ok, false)
    assert.deepEqual(sc.tasksCancelled, [])
  })

  it('onRemove still cancels a real taskId when hasSwarm is available but does not match', () => {
    const sc = fakeSC()
    sc.hasSwarm = (id) => id === 'team-a'
    const ctrl = buildSwarmController({ coordinator: sc, localPodId: 'me' })
    const r = ctrl.onRemove('t-7')
    assert.equal(r.ok, true)
    assert.deepEqual(sc.tasksCancelled, ['t-7'])
  })
})
