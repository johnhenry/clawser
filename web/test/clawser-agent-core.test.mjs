// Run with: node --import ./web/test/_setup-globals.mjs --test web/test/clawser-agent-core.test.mjs
import { describe, it, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { ClawserAgent, EventLog, AutonomyController, HookPipeline } from '../clawser-agent.js'

// ── Minimal stubs ──────────────────────────────────────────────────

function makeEchoProvider() {
  return {
    supportsNativeTools: false,
    supportsStreaming: false,
    chat: async (messages) => ({
      content: 'Echo: ' + (messages[messages.length - 1]?.content || ''),
      tool_calls: [],
      usage: { input_tokens: 10, output_tokens: 5 },
      model: 'echo',
    }),
  }
}

function makeProviderRegistry(provider) {
  const map = new Map([['echo', provider]])
  return {
    get: (name) => map.get(name),
    listWithAvailability: async () => [{ name: 'echo' }],
  }
}

function makeToolRegistry() {
  const tools = new Map()
  return {
    allSpecs: () => [...tools.values()],
    get: (name) => tools.get(name),
    has: (name) => tools.has(name),
    register: (tool) => tools.set(tool.name, tool),
  }
}

/** Helper: create a minimal agent for testing */
async function createTestAgent(opts = {}) {
  const provider = makeEchoProvider()
  const agent = await ClawserAgent.create({
    providers: makeProviderRegistry(provider),
    ...opts,
  })
  agent.init({})
  agent.setProvider('echo')
  return agent
}

// ── Construction ──────────────────────────────────────────────────

describe('ClawserAgent — construction', () => {
  it('creates an agent via static factory without throwing', async () => {
    const agent = await createTestAgent()
    assert.ok(agent instanceof ClawserAgent)
  })

  it('creates with no options at all', async () => {
    const agent = await ClawserAgent.create({})
    assert.ok(agent instanceof ClawserAgent)
  })

  it('init returns 0 on success', async () => {
    const agent = await ClawserAgent.create({})
    const result = agent.init({})
    assert.equal(result, 0)
  })
})

// ── System prompt ─────────────────────────────────────────────────

describe('ClawserAgent — setSystemPrompt', () => {
  it('sets system prompt without error', async () => {
    const agent = await createTestAgent()
    agent.setSystemPrompt('You are a helpful agent.')
    // Verify via checkpoint that history[0] is system message
    const ckpt = agent.getCheckpointJSON()
    assert.equal(ckpt.session_history[0].role, 'system')
    assert.equal(ckpt.session_history[0].content, 'You are a helpful agent.')
  })

  it('replaces existing system prompt', async () => {
    const agent = await createTestAgent()
    agent.setSystemPrompt('First prompt')
    agent.setSystemPrompt('Second prompt')
    const ckpt = agent.getCheckpointJSON()
    assert.equal(ckpt.session_history[0].content, 'Second prompt')
    // Should only have one system message, not two
    const systemMsgs = ckpt.session_history.filter(m => m.role === 'system')
    assert.equal(systemMsgs.length, 1)
  })
})

// ── sendMessage ───────────────────────────────────────────────────

describe('ClawserAgent — sendMessage', () => {
  it('adds a user message to history', async () => {
    const agent = await createTestAgent()
    agent.sendMessage('Hello agent')
    const ckpt = agent.getCheckpointJSON()
    const userMsgs = ckpt.session_history.filter(m => m.role === 'user')
    assert.equal(userMsgs.length, 1)
    assert.equal(userMsgs[0].content, 'Hello agent')
  })

  it('records a user_message event in the event log', async () => {
    const agent = await createTestAgent()
    agent.sendMessage('Test message')
    const events = agent.eventLog.query({ type: 'user_message' })
    assert.equal(events.length, 1)
    assert.equal(events[0].data.content, 'Test message')
  })

  it('supports source option', async () => {
    const agent = await createTestAgent()
    agent.sendMessage('From telegram', { source: 'telegram' })
    const events = agent.eventLog.query({ type: 'user_message' })
    assert.equal(events[0].source, 'telegram')
  })
})

// ── cancel / isRunning ────────────────────────────────────────────

describe('ClawserAgent — cancel / isRunning', () => {
  it('isRunning is false initially', async () => {
    const agent = await createTestAgent()
    assert.equal(agent.isRunning, false)
  })

  it('cancel is safe to call when idle', async () => {
    const agent = await createTestAgent()
    agent.cancel() // should not throw
    assert.equal(agent.isRunning, false)
  })
})

// ── isRunning after run() ────────────────────────────────────────

describe('ClawserAgent — isRunning cleared after run()', () => {
  it('isRunning is false after a successful run()', async () => {
    const agent = await createTestAgent()
    agent.setSystemPrompt('You are a test agent.')
    agent.sendMessage('hello')
    const result = await agent.run()
    assert.equal(result.status, 1, 'run should succeed')
    assert.equal(agent.isRunning, false, 'isRunning must be false after run completes')
  })

  it('isRunning is false after runStream() completes', async () => {
    const agent = await createTestAgent()
    agent.setSystemPrompt('You are a test agent.')
    agent.sendMessage('hello')
    // Exhaust the async generator
    for await (const _chunk of agent.runStream()) { /* consume */ }
    assert.equal(agent.isRunning, false, 'isRunning must be false after runStream completes')
  })
})

// ── pause / resume ────────────────────────────────────────────────

describe('ClawserAgent — isPaused / pauseAgent / resumeAgent', () => {
  it('agent is not paused by default', async () => {
    const agent = await createTestAgent()
    assert.equal(agent.isPaused, false)
  })

  it('pauseAgent sets isPaused to true', async () => {
    const agent = await createTestAgent()
    agent.pauseAgent()
    assert.equal(agent.isPaused, true)
  })

  it('resumeAgent clears isPaused', async () => {
    const agent = await createTestAgent()
    agent.pauseAgent()
    assert.equal(agent.isPaused, true)
    agent.resumeAgent()
    assert.equal(agent.isPaused, false)
  })

  it('pause/resume cycle is idempotent', async () => {
    const agent = await createTestAgent()
    agent.pauseAgent()
    agent.pauseAgent()
    assert.equal(agent.isPaused, true)
    agent.resumeAgent()
    assert.equal(agent.isPaused, false)
    agent.resumeAgent()
    assert.equal(agent.isPaused, false)
  })
})

// ── Goal management ───────────────────────────────────────────────

describe('ClawserAgent — goal management', () => {
  it('addGoal returns a goal ID', async () => {
    const agent = await createTestAgent()
    const id = agent.addGoal('Build a widget')
    assert.ok(id.startsWith('goal_'))
  })

  it('addGoal records goal in state', async () => {
    const agent = await createTestAgent()
    agent.addGoal('First goal')
    const state = agent.getState()
    assert.equal(state.goals.length, 1)
    assert.equal(state.goals[0].description, 'First goal')
    assert.equal(state.goals[0].status, 'active')
  })

  it('completeGoal marks goal as completed', async () => {
    const agent = await createTestAgent()
    const id = agent.addGoal('Finish task')
    const result = agent.completeGoal(id)
    assert.equal(result, true)
    const state = agent.getState()
    assert.equal(state.goals[0].status, 'completed')
  })

  it('completeGoal returns false for non-existent ID', async () => {
    const agent = await createTestAgent()
    assert.equal(agent.completeGoal('goal_999'), false)
  })

  it('removeGoal removes the goal', async () => {
    const agent = await createTestAgent()
    const id = agent.addGoal('Temporary goal')
    const removed = agent.removeGoal(id)
    assert.equal(removed, true)
    assert.equal(agent.getState().goals.length, 0)
  })

  it('removeGoal returns false for non-existent ID', async () => {
    const agent = await createTestAgent()
    assert.equal(agent.removeGoal('goal_999'), false)
  })

  it('updateGoal changes the status', async () => {
    const agent = await createTestAgent()
    const id = agent.addGoal('In-progress goal')
    const updated = agent.updateGoal(id, 'failed')
    assert.equal(updated, true)
    assert.equal(agent.getState().goals[0].status, 'failed')
  })

  it('updateGoal returns false for non-existent ID', async () => {
    const agent = await createTestAgent()
    assert.equal(agent.updateGoal('goal_999', 'completed'), false)
  })

  it('goals appear in event log', async () => {
    const agent = await createTestAgent()
    const id = agent.addGoal('Tracked goal')
    agent.updateGoal(id, 'completed')
    const addedEvts = agent.eventLog.query({ type: 'goal_added' })
    const updatedEvts = agent.eventLog.query({ type: 'goal_updated' })
    assert.equal(addedEvts.length, 1)
    assert.equal(updatedEvts.length, 1)
    assert.equal(updatedEvts[0].data.status, 'completed')
  })
})

// ── estimateHistoryTokens ─────────────────────────────────────────

describe('ClawserAgent — estimateHistoryTokens', () => {
  it('returns 0 for empty history', async () => {
    const agent = await createTestAgent()
    const tokens = agent.estimateHistoryTokens()
    assert.equal(typeof tokens, 'number')
    assert.equal(tokens, 0)
  })

  it('returns a positive number after adding messages', async () => {
    const agent = await createTestAgent()
    agent.setSystemPrompt('System prompt with some content')
    agent.sendMessage('Hello, how are you?')
    const tokens = agent.estimateHistoryTokens()
    assert.ok(tokens > 0)
  })

  it('increases as more messages are added', async () => {
    const agent = await createTestAgent()
    agent.sendMessage('First message')
    const t1 = agent.estimateHistoryTokens()
    agent.sendMessage('Second message with more text')
    const t2 = agent.estimateHistoryTokens()
    assert.ok(t2 > t1)
  })
})

// ── Provider management ───────────────────────────────────────────

describe('ClawserAgent — provider management', () => {
  it('getProvider returns the active provider name', async () => {
    const agent = await createTestAgent()
    assert.equal(agent.getProvider(), 'echo')
  })

  it('setProvider changes the active provider', async () => {
    const agent = await createTestAgent()
    agent.setProvider('openai')
    assert.equal(agent.getProvider(), 'openai')
  })

  it('setModel / getModel round-trips', async () => {
    const agent = await createTestAgent()
    assert.equal(agent.getModel(), null)
    agent.setModel('gpt-4')
    assert.equal(agent.getModel(), 'gpt-4')
  })

  it('setModel(null) clears model override', async () => {
    const agent = await createTestAgent()
    agent.setModel('gpt-4')
    agent.setModel(null)
    assert.equal(agent.getModel(), null)
  })
})

// ── Config ────────────────────────────────────────────────────────

describe('ClawserAgent — config', () => {
  it('getConfig returns default config values', async () => {
    const agent = await createTestAgent()
    const cfg = agent.getConfig()
    assert.equal(typeof cfg.maxToolIterations, 'number')
    assert.equal(typeof cfg.compactionThreshold, 'number')
  })

  it('init merges config overrides', async () => {
    const agent = await ClawserAgent.create({})
    agent.init({ maxToolIterations: 5 })
    const cfg = agent.getConfig()
    assert.equal(cfg.maxToolIterations, 5)
  })
})

// ── Accessors ─────────────────────────────────────────────────────

describe('ClawserAgent — accessors', () => {
  it('eventLog is accessible', async () => {
    const agent = await createTestAgent()
    assert.ok(agent.eventLog instanceof EventLog)
  })

  it('autonomy is accessible', async () => {
    const agent = await createTestAgent()
    assert.ok(agent.autonomy instanceof AutonomyController)
  })

  it('hooks is accessible', async () => {
    const agent = await createTestAgent()
    assert.ok(agent.hooks instanceof HookPipeline)
  })

  it('memory accessor is available', async () => {
    const agent = await createTestAgent()
    assert.ok(agent.memory != null)
  })
})

// ── Tool spec management ──────────────────────────────────────────

describe('ClawserAgent — tool spec registration', () => {
  it('registerToolSpec adds a tool and returns 0', async () => {
    const agent = await createTestAgent()
    const result = agent.registerToolSpec({
      name: 'test_tool',
      description: 'A test tool',
      parameters: {},
    })
    assert.equal(result, 0)
  })

  it('unregisterToolSpec removes a tool', async () => {
    const agent = await createTestAgent()
    agent.registerToolSpec({ name: 'temp_tool', description: 'Temporary', parameters: {} })
    const removed = agent.unregisterToolSpec('temp_tool')
    assert.equal(removed, true)
  })

  it('unregisterToolSpec returns false for non-existent tool', async () => {
    const agent = await createTestAgent()
    assert.equal(agent.unregisterToolSpec('nonexistent'), false)
  })
})

// ── Checkpoint / restore ──────────────────────────────────────────

describe('ClawserAgent — checkpoint / restore', () => {
  it('getCheckpointJSON returns structured data', async () => {
    const agent = await createTestAgent()
    agent.setSystemPrompt('Test prompt')
    agent.sendMessage('Hello')
    agent.addGoal('Test goal')

    const ckpt = agent.getCheckpointJSON()
    assert.ok(ckpt.id.startsWith('ckpt_'))
    assert.ok(ckpt.timestamp > 0)
    assert.equal(ckpt.version, '1.0.0')
    assert.ok(Array.isArray(ckpt.session_history))
    assert.ok(Array.isArray(ckpt.active_goals))
    assert.equal(ckpt.active_goals.length, 1)
  })

  it('checkpoint returns Uint8Array bytes', async () => {
    const agent = await createTestAgent()
    agent.sendMessage('test')
    const bytes = agent.checkpoint()
    assert.ok(bytes instanceof Uint8Array)
    assert.ok(bytes.length > 0)
  })

  it('restore round-trips checkpoint data', async () => {
    const agent = await createTestAgent()
    agent.setSystemPrompt('Restore test')
    agent.sendMessage('Message to restore')
    agent.addGoal('Goal to restore')
    const bytes = agent.checkpoint()

    // Create a fresh agent and restore into it
    const agent2 = await createTestAgent()
    const result = agent2.restore(bytes)
    assert.equal(result, 0)

    const ckpt = agent2.getCheckpointJSON()
    assert.equal(ckpt.active_goals.length, 1)
    assert.equal(ckpt.active_goals[0].description, 'Goal to restore')
    // History should contain the system + user messages
    assert.ok(ckpt.session_history.length >= 2)
  })
})

// ── clearHistory ──────────────────────────────────────────────────

describe('ClawserAgent — clearHistory', () => {
  it('clears history and event log', async () => {
    const agent = await createTestAgent()
    agent.setSystemPrompt('System')
    agent.sendMessage('Hello')
    await agent.clearHistory()

    const ckpt = agent.getCheckpointJSON()
    assert.equal(ckpt.session_history.length, 0)
    assert.equal(agent.eventLog.size, 0)
  })
})

// ── reinit ────────────────────────────────────────────────────────

describe('ClawserAgent — reinit', () => {
  it('clears history and goals but returns 0', async () => {
    const agent = await createTestAgent()
    agent.sendMessage('message')
    agent.addGoal('goal')
    const result = await agent.reinit({})
    assert.equal(result, 0)
    assert.equal(agent.getState().goals.length, 0)
    assert.equal(agent.getState().history_len, 0)
  })
})

// ── Scheduler (legacy path) ──────────────────────────────────────

describe('ClawserAgent — scheduler (legacy)', () => {
  it('addSchedulerJob creates a job and returns an ID', async () => {
    const agent = await createTestAgent()
    const id = agent.addSchedulerJob({
      schedule_type: 'once',
      prompt: 'Remind me',
      delay_ms: 60000,
    })
    assert.ok(id.startsWith('job_'))
  })

  it('listSchedulerJobs returns created jobs', async () => {
    const agent = await createTestAgent()
    agent.addSchedulerJob({ schedule_type: 'once', prompt: 'Task 1' })
    agent.addSchedulerJob({ schedule_type: 'interval', prompt: 'Task 2', interval_ms: 5000 })
    const jobs = agent.listSchedulerJobs()
    assert.equal(jobs.length, 2)
  })

  it('removeSchedulerJob removes a job', async () => {
    const agent = await createTestAgent()
    const id = agent.addSchedulerJob({ schedule_type: 'once', prompt: 'To remove' })
    const removed = agent.removeSchedulerJob(id)
    assert.equal(removed, true)
    assert.equal(agent.listSchedulerJobs().length, 0)
  })
})

// ── parseCron (static) ────────────────────────────────────────────

describe('ClawserAgent.parseCron', () => {
  it('parses a valid 5-field cron expression', () => {
    const result = ClawserAgent.parseCron('0 9 * * 1-5')
    assert.ok(result != null)
    assert.ok(result.minute.has(0))
    assert.ok(result.hour.has(9))
    assert.equal(result.dayOfMonth, null) // * = all
    assert.equal(result.month, null)
  })

  it('returns null for invalid expression', () => {
    assert.equal(ClawserAgent.parseCron('bad'), null)
    assert.equal(ClawserAgent.parseCron(''), null)
    assert.equal(ClawserAgent.parseCron('1 2 3'), null) // only 3 fields
  })
})
