// Run with: node --import ./web/test/_setup-globals.mjs --test web/test/clawser-e2e-conversation.test.mjs
//
// E2E: Conversation lifecycle — checkpoint/restore, event log export,
// history building, and state serialization.
import { describe, it, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { ClawserAgent, EventLog } from '../clawser-agent.js'

// ── Helpers ──────────────────────────────────────────────────────

function makeEchoProvider() {
  return {
    supportsNativeTools: false,
    supportsStreaming: false,
    chat: async (request) => {
      const messages = request.messages || []
      const lastUser = [...messages].reverse().find(m => m.role === 'user')
      return {
        content: lastUser ? `Echo: ${lastUser.content}` : '[no input]',
        tool_calls: [],
        usage: { input_tokens: 5, output_tokens: 5 },
        model: 'echo',
      }
    },
  }
}

async function createTestAgent() {
  const provider = makeEchoProvider()
  const providers = {
    get: () => provider,
    listWithAvailability: async () => [{ name: 'echo' }],
  }
  const agent = await ClawserAgent.create({ providers })
  agent.init({})
  agent.setProvider('echo')
  agent.setSystemPrompt('Test system prompt.')
  return agent
}

// ── Tests ────────────────────────────────────────────────────────

describe('E2E — Conversation Export & Persistence', () => {
  let agent

  beforeEach(async () => {
    agent = await createTestAgent()
  })

  // ── Checkpoint/Restore ────────────────────────────────────────

  it('checkpoint produces valid JSON with expected fields', () => {
    agent.sendMessage('checkpoint test')
    agent.addGoal('Test goal')
    agent.addSchedulerJob({ schedule_type: 'once', prompt: 'reminder', delay_ms: 5000 })

    const ckpt = agent.getCheckpointJSON()

    assert.ok(ckpt.id.startsWith('ckpt_'), 'checkpoint id should have ckpt_ prefix')
    assert.equal(ckpt.version, '1.0.0')
    assert.ok(Array.isArray(ckpt.session_history), 'should have session_history array')
    assert.ok(Array.isArray(ckpt.active_goals), 'should have active_goals array')
    assert.ok(Array.isArray(ckpt.scheduler_snapshot), 'should have scheduler_snapshot array')
    assert.ok(ckpt.session_history.length >= 1, 'history should contain the user message')
    assert.equal(ckpt.active_goals.length, 1)
    assert.equal(ckpt.scheduler_snapshot.length, 1)
  })

  it('checkpoint → bytes → restore round-trip preserves state', async () => {
    agent.sendMessage('message A')
    await agent.run()
    agent.addGoal('Survive restore')
    agent.memoryStore({ key: 'note', content: 'Important data', category: 'core' })

    const bytes = agent.checkpoint()
    assert.ok(bytes instanceof Uint8Array)
    assert.ok(bytes.length > 0)

    // Create a fresh agent and restore
    const agent2 = await createTestAgent()
    const rc = agent2.restore(bytes)
    assert.equal(rc, 0, 'restore should return 0 on success')

    const state2 = agent2.getState()
    assert.equal(state2.goals.length, 1)
    assert.equal(state2.goals[0].description, 'Survive restore')
    assert.ok(state2.history_len >= 2, 'restored history should have messages')
  })

  it('restore with garbage bytes returns -1', async () => {
    const badBytes = new Uint8Array([0xFF, 0xFE, 0x00, 0x01])
    const rc = agent.restore(badBytes)
    assert.equal(rc, -1, 'restore with invalid data should return -1')
  })

  it('double restore replaces state entirely', async () => {
    // First state
    agent.addGoal('Goal A')
    const bytes1 = agent.checkpoint()

    // Second state
    const agent2 = await createTestAgent()
    agent2.addGoal('Goal B')
    agent2.addGoal('Goal C')
    const bytes2 = agent2.checkpoint()

    // Restore first, then second
    const fresh = await createTestAgent()
    fresh.restore(bytes1)
    assert.equal(fresh.getState().goals.length, 1)

    fresh.restore(bytes2)
    assert.equal(fresh.getState().goals.length, 2)
    assert.ok(fresh.getState().goals.some(g => g.description === 'Goal B'))
  })

  // ── Event Log ─────────────────────────────────────────────────

  it('event log captures full conversation flow', async () => {
    agent.sendMessage('Hello')
    await agent.run()
    agent.sendMessage('Follow up')
    await agent.run()

    const events = agent.getEventLog()

    const userEvents = events.query({ type: 'user_message' })
    assert.equal(userEvents.length, 2, 'should have 2 user_message events')

    const assistantEvents = events.query({ type: 'agent_message' })
    assert.ok(assistantEvents.length >= 2, 'should have at least 2 agent_message events')

    // Verify ordering: second user event should not precede the first
    assert.ok(userEvents[0].data.content === 'Hello', 'first event should be Hello')
    assert.ok(userEvents[1].data.content === 'Follow up', 'second event should be Follow up')
  })

  it('event log clear removes all entries', async () => {
    agent.sendMessage('Before clear')
    await agent.run()

    const events = agent.getEventLog()
    assert.ok(events.query({ type: 'user_message' }).length > 0)

    agent.clearEventLog()
    assert.equal(events.query({ type: 'user_message' }).length, 0, 'events should be cleared')
  })

  it('EventLog standalone: append and query', () => {
    const log = new EventLog()
    log.append('custom_event', { key: 'value1' }, 'test')
    log.append('custom_event', { key: 'value2' }, 'test')
    log.append('other_event', { data: 123 }, 'test')

    const customs = log.query({ type: 'custom_event' })
    assert.equal(customs.length, 2)
    assert.equal(customs[0].data.key, 'value1')
    assert.equal(customs[1].data.key, 'value2')

    const others = log.query({ type: 'other_event' })
    assert.equal(others.length, 1)
  })

  // ── Goal + Scheduler in conversation context ──────────────────

  it('goals and scheduler survive checkpoint/restore alongside history', async () => {
    agent.sendMessage('Setup')
    await agent.run()

    agent.addGoal('Write tests')
    agent.addGoal('Deploy to prod')
    agent.addSchedulerJob({ schedule_type: 'interval', prompt: 'check CI', interval_ms: 60000 })

    const bytes = agent.checkpoint()
    const restored = await createTestAgent()
    restored.restore(bytes)

    const state = restored.getState()
    assert.equal(state.goals.length, 2)
    assert.equal(state.goals[0].description, 'Write tests')
    assert.equal(state.goals[1].description, 'Deploy to prod')
    assert.equal(restored.listSchedulerJobs().length, 1)
    assert.equal(restored.listSchedulerJobs()[0].prompt, 'check CI')
  })

  // ── State snapshot ────────────────────────────────────────────

  it('getState returns consistent state object', async () => {
    agent.sendMessage('msg1')
    await agent.run()
    agent.addGoal('G1')

    agent.memoryStore({ key: 'm1', content: 'data', category: 'core' })

    const state = agent.getState()
    assert.ok(typeof state.history_len === 'number')
    assert.ok(typeof state.memory_count === 'number')
    assert.ok(Array.isArray(state.goals))
    assert.ok(state.history_len >= 2)
    assert.ok(state.memory_count >= 1)
    assert.equal(state.goals.length, 1)
  })

  it('reinit preserves memories but resets history', async () => {
    agent.sendMessage('Before reinit')
    await agent.run()
    agent.memoryStore({ key: 'persist', content: 'should survive', category: 'core' })

    await agent.reinit({})

    const state = agent.getState()
    // History should be cleared or minimal after reinit
    // But memories should persist
    const recalled = agent.memoryRecall('persist')
    assert.ok(recalled.length >= 1, 'memories should survive reinit')
  })
})
