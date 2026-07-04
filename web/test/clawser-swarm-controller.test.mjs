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
        { taskId: 't-1', description: 'A', status: 'pending', assignee: 'peer-1', output: null },
        { taskId: 't-2', description: 'B', status: 'completed', assignee: 'me', output: 'done' },
      ],
    })
    const vm = buildSwarmViewModel(sc, 'me')
    assert.equal(vm.swarms.length, 1)
    assert.equal(vm.swarms[0].id, 'local')
    assert.equal(vm.swarms[0].status, 'active')
    assert.deepEqual(vm.swarms[0].members, ['me', 'peer-1'])
    assert.equal(vm.swarms[0].subtasks.length, 2)
    assert.equal(vm.swarms[0].subtasks[0].id, 't-1')
  })

  it('marks the swarm as forming when there are no members', () => {
    const sc = fakeSC({ members: [] })
    const vm = buildSwarmViewModel(sc, 'me')
    assert.equal(vm.swarms[0].status, 'forming')
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

  it('onDisband logs a clear unsupported message and returns ok:false', () => {
    let msg = ''
    const ctrl = buildSwarmController({ coordinator: fakeSC(), localPodId: 'me', onLog: (m) => { msg = m } })
    const r = ctrl.onDisband('local')
    assert.equal(r.ok, false)
    assert.match(msg, /does not support disband/)
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
})
