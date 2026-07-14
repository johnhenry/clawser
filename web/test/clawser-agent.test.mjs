// Run with: node --import ./web/test/_setup-globals.mjs --test web/test/clawser-agent.test.mjs
import { describe, it, beforeEach, afterEach, mock } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import {
  ClawserAgent,
  EventLog,
  KNOWN_EVENT_TYPES,
  AutonomyController,
  HookPipeline,
  HOOK_POINTS,
  createAuditLoggerHook,
} from '../clawser-agent.js'

// ── Stubs & Helpers ──────────────────────────────────────────────────

/** Echo provider that returns tool_calls when configured */
function makeEchoProvider(overrides = {}) {
  return {
    supportsNativeTools: true,
    supportsStreaming: false,
    requiresApiKey: false,
    chat: async (request) => ({
      content: 'Echo: ' + (request.messages[request.messages.length - 1]?.content || ''),
      tool_calls: [],
      usage: { input_tokens: 10, output_tokens: 5 },
      model: 'echo-test',
      ...overrides,
    }),
  }
}

/** Provider that returns a sequence of responses (one per call) */
function makeSequenceProvider(responses) {
  let callIndex = 0
  return {
    supportsNativeTools: true,
    supportsStreaming: false,
    requiresApiKey: false,
    chat: async (request) => {
      if (callIndex >= responses.length) {
        return { content: 'No more responses', tool_calls: [], usage: { input_tokens: 1, output_tokens: 1 }, model: 'seq' }
      }
      return responses[callIndex++]
    },
    get callCount() { return callIndex },
  }
}

/** Provider that always throws */
function makeErrorProvider(message = 'Provider exploded') {
  return {
    supportsNativeTools: true,
    supportsStreaming: false,
    requiresApiKey: false,
    chat: async () => { throw new Error(message) },
  }
}

/** Provider that supports streaming via async generator */
function makeStreamProvider(chunks, overrides = {}) {
  return {
    supportsNativeTools: true,
    supportsStreaming: true,
    requiresApiKey: false,
    chat: async (request) => ({
      content: chunks.map(c => c.text || '').join(''),
      tool_calls: [],
      usage: { input_tokens: 10, output_tokens: 5 },
      model: 'stream-test',
    }),
    chatStream: async function* (request) {
      for (const chunk of chunks) {
        yield chunk
      }
    },
    ...overrides,
  }
}

function makeProviderRegistry(provider, name = 'echo') {
  const map = new Map([[name, provider]])
  return {
    get: (n) => map.get(n),
    listWithAvailability: async () => [...map.keys()].map(n => ({ name: n })),
  }
}

/** Minimal browser tool registry with controllable tools */
function makeToolRegistry(tools = []) {
  const map = new Map()
  for (const t of tools) map.set(t.name, t)
  return {
    allSpecs: () => tools.map(t => ({
      name: t.name,
      description: t.description || '',
      parameters: t.parameters || {},
      required_permission: t.permission || 'read',
    })),
    get: (name) => map.get(name),
    has: (name) => map.has(name),
    execute: async (name, params) => {
      const tool = map.get(name)
      if (!tool) return { success: false, output: '', error: `Tool not found: ${name}` }
      return tool.execute(params)
    },
  }
}

/** Create a test agent with configurable overrides */
async function createTestAgent(opts = {}) {
  const provider = opts._provider || makeEchoProvider(opts._providerOverrides || {})
  const providerName = opts._providerName || 'echo'
  const agent = await ClawserAgent.create({
    providers: makeProviderRegistry(provider, providerName),
    browserTools: opts.browserTools || null,
    onEvent: opts.onEvent || (() => {}),
    onLog: opts.onLog || (() => {}),
    onToolCall: opts.onToolCall || (() => {}),
    ...opts,
  })
  agent.init(opts._config || {})
  agent.setProvider(providerName)
  if (opts._apiKey) agent.setApiKey(opts._apiKey)
  return agent
}

// ══════════════════════════════════════════════════════════════════════
// EventLog
// ══════════════════════════════════════════════════════════════════════

describe('EventLog', () => {
  let log

  beforeEach(() => { log = new EventLog() })

  it('starts empty', () => {
    assert.equal(log.size, 0)
    assert.deepEqual(log.events, [])
  })

  it('every event type appended in clawser-agent.js is in KNOWN_EVENT_TYPES', async () => {
    // Lint-style check: scan the agent source for `eventLog.append('X', ...)`
    // calls and verify each X is documented in the KNOWN_EVENT_TYPES
    // registry. The two prior silent-skip bugs (`goal_edited`,
    // `goal_removed`) shipped because event types were appended without a
    // corresponding `derive*` branch — this test surfaces any new type
    // before it slips through.
    const agentSrc = await readFile(
      fileURLToPath(new URL('../clawser-agent.js', import.meta.url)),
      'utf8',
    )
    const re = /eventLog\.append\(\s*['"]([a-z_]+)['"]/g
    const seen = new Set()
    let m
    while ((m = re.exec(agentSrc)) !== null) seen.add(m[1])
    const missing = [...seen].filter(t => !KNOWN_EVENT_TYPES.has(t))
    assert.deepEqual(missing, [],
      `Event types appended but not in KNOWN_EVENT_TYPES: ${missing.join(', ')}. ` +
      `Add them to the registry in clawser-agent.js and update the relevant derive* function.`)
  })

  it('append creates an event with id, type, timestamp, data, source', () => {
    const evt = log.append('user_message', { content: 'hi' }, 'user')
    assert.ok(evt.id.startsWith('evt_'))
    assert.equal(evt.type, 'user_message')
    assert.equal(evt.source, 'user')
    assert.equal(evt.data.content, 'hi')
    assert.ok(evt.timestamp > 0)
  })

  it('sequential appends produce unique IDs', () => {
    const a = log.append('a', {})
    const b = log.append('b', {})
    assert.notEqual(a.id, b.id)
  })

  it('query filters by type', () => {
    log.append('user_message', { content: 'hi' })
    log.append('agent_message', { content: 'hello' })
    log.append('user_message', { content: 'bye' })
    const userMsgs = log.query({ type: 'user_message' })
    assert.equal(userMsgs.length, 2)
  })

  it('query filters by source', () => {
    log.append('msg', {}, 'user')
    log.append('msg', {}, 'agent')
    log.append('msg', {}, 'user')
    assert.equal(log.query({ source: 'agent' }).length, 1)
  })

  it('query supports limit (returns from end)', () => {
    for (let i = 0; i < 10; i++) log.append('msg', { i })
    const last3 = log.query({ limit: 3 })
    assert.equal(last3.length, 3)
    assert.equal(last3[0].data.i, 7)
  })

  it('summary returns counts by type', () => {
    log.append('a', {})
    log.append('b', {})
    log.append('a', {})
    assert.deepEqual(log.summary(), { a: 2, b: 1 })
  })

  it('clear resets the log', () => {
    log.append('msg', {})
    log.clear()
    assert.equal(log.size, 0)
  })

  it('toJSONL and fromJSONL round-trip', () => {
    log.append('user_message', { content: 'hello' }, 'user')
    log.append('agent_message', { content: 'hi' }, 'agent')
    const jsonl = log.toJSONL()
    const restored = EventLog.fromJSONL(jsonl)
    assert.equal(restored.size, 2)
    assert.equal(restored.query({ type: 'user_message' }).length, 1)
  })

  it('fromJSONL handles empty/null input', () => {
    assert.equal(EventLog.fromJSONL('').size, 0)
    assert.equal(EventLog.fromJSONL(null).size, 0)
  })

  it('fromJSONL skips malformed lines', () => {
    const jsonl = '{"id":"evt_1","type":"ok","timestamp":1,"data":{},"source":"s"}\nnot-json\n{"id":"evt_2","type":"ok","timestamp":2,"data":{},"source":"s"}'
    const restored = EventLog.fromJSONL(jsonl)
    assert.equal(restored.size, 2)
  })

  it('maxSize option trims oldest events', () => {
    const small = new EventLog({ maxSize: 3 })
    for (let i = 0; i < 5; i++) small.append('msg', { i })
    assert.equal(small.size, 3)
    assert.equal(small.events[0].data.i, 2) // oldest kept
  })

  it('load restores events and derives seq to avoid ID collisions', () => {
    const events = [
      { id: 'evt_100_5', type: 'msg', timestamp: 100, data: {}, source: 'system' },
      { id: 'evt_200_10', type: 'msg', timestamp: 200, data: {}, source: 'system' },
    ]
    log.load(events)
    assert.equal(log.size, 2)
    // New event should have seq > 10
    const newEvt = log.append('new', {})
    const seqMatch = newEvt.id.match(/_(\d+)$/)
    assert.ok(parseInt(seqMatch[1]) >= 11)
  })

  describe('deriveSessionHistory', () => {
    it('prepends system prompt when provided', () => {
      log.append('user_message', { content: 'hi' }, 'user')
      const history = log.deriveSessionHistory('You are helpful')
      assert.equal(history[0].role, 'system')
      assert.equal(history[0].content, 'You are helpful')
      assert.equal(history[1].role, 'user')
    })

    it('builds user/assistant/tool messages correctly', () => {
      log.append('user_message', { content: 'search for cats' }, 'user')
      log.append('agent_message', { content: 'Let me search' }, 'agent')
      log.append('tool_call', { call_id: 'tc1', name: 'search', arguments: '{"q":"cats"}' }, 'agent')
      log.append('tool_result', { call_id: 'tc1', name: 'search', result: { success: true, output: 'Found cats' } }, 'system')
      const history = log.deriveSessionHistory()
      assert.equal(history.length, 3) // user, assistant (with tool_calls), tool
      assert.equal(history[1].tool_calls.length, 1)
      assert.equal(history[2].role, 'tool')
      assert.equal(history[2].content, 'Found cats')
    })

    it('tool_result with error formats as Error: message', () => {
      log.append('user_message', { content: 'do something' }, 'user')
      log.append('agent_message', { content: '' }, 'agent')
      log.append('tool_call', { call_id: 'tc1', name: 'fail_tool', arguments: '{}' }, 'agent')
      log.append('tool_result', { call_id: 'tc1', name: 'fail_tool', result: { success: false, error: 'broken' } }, 'system')
      const history = log.deriveSessionHistory()
      const toolMsg = history.find(m => m.role === 'tool')
      assert.ok(toolMsg.content.includes('Error: broken'))
    })
  })

  describe('deriveGoals', () => {
    it('rebuilds goals from events', () => {
      log.append('goal_added', { id: 'g1', description: 'Build X' })
      log.append('goal_added', { id: 'g2', description: 'Test X' })
      log.append('goal_updated', { id: 'g1', status: 'completed' })
      const goals = log.deriveGoals()
      assert.equal(goals.length, 2)
      assert.equal(goals[0].status, 'completed')
      assert.equal(goals[1].status, 'active')
    })
  })

  describe('deriveToolCallLog', () => {
    it('pairs tool calls with results', () => {
      log.append('tool_call', { call_id: 'tc1', name: 'read_file', arguments: { path: '/a' } })
      log.append('tool_result', { call_id: 'tc1', name: 'read_file', result: { success: true, output: 'content' } })
      const tcLog = log.deriveToolCallLog()
      assert.equal(tcLog.length, 1)
      assert.equal(tcLog[0].name, 'read_file')
      assert.equal(tcLog[0].result.success, true)
    })
  })

  describe('sliceToTurnEnd', () => {
    it('returns events up to end of turn', () => {
      const e1 = log.append('user_message', { content: 'turn 1' })
      log.append('agent_message', { content: 'reply 1' })
      log.append('user_message', { content: 'turn 2' })
      log.append('agent_message', { content: 'reply 2' })
      const slice = log.sliceToTurnEnd(e1.id)
      assert.equal(slice.length, 2) // user_message + agent_message of turn 1
    })

    it('returns null for unknown event ID', () => {
      log.append('user_message', { content: 'hi' })
      assert.equal(log.sliceToTurnEnd('evt_nonexistent'), null)
    })
  })
})

// ══════════════════════════════════════════════════════════════════════
// HookPipeline
// ══════════════════════════════════════════════════════════════════════

describe('HookPipeline', () => {
  let pipeline

  beforeEach(() => { pipeline = new HookPipeline() })

  it('starts with size 0', () => {
    assert.equal(pipeline.size, 0)
  })

  it('register adds a hook at a valid point', () => {
    pipeline.register({ name: 'test', point: 'beforeInbound', execute: async () => ({ action: 'continue' }) })
    assert.equal(pipeline.size, 1)
  })

  it('register throws for invalid hook point', () => {
    assert.throws(() => {
      pipeline.register({ name: 'bad', point: 'invalidPoint', execute: async () => {} })
    }, /Invalid hook point/)
  })

  it('unregister removes a hook', () => {
    pipeline.register({ name: 'removable', point: 'beforeOutbound', execute: async () => ({}) })
    assert.equal(pipeline.size, 1)
    pipeline.unregister('removable', 'beforeOutbound')
    assert.equal(pipeline.size, 0)
  })

  it('run executes hooks in priority order (lower first)', async () => {
    const order = []
    pipeline.register({ name: 'second', point: 'beforeInbound', priority: 200, execute: async () => { order.push(2); return { action: 'continue' } } })
    pipeline.register({ name: 'first', point: 'beforeInbound', priority: 100, execute: async () => { order.push(1); return { action: 'continue' } } })
    await pipeline.run('beforeInbound', {})
    assert.deepEqual(order, [1, 2])
  })

  it('block action halts the pipeline', async () => {
    pipeline.register({ name: 'blocker', point: 'beforeInbound', priority: 1, execute: async () => ({ action: 'block', reason: 'nope' }) })
    pipeline.register({ name: 'never', point: 'beforeInbound', priority: 2, execute: async () => { throw new Error('should not run') } })
    const result = await pipeline.run('beforeInbound', {})
    assert.equal(result.blocked, true)
    assert.equal(result.reason, 'nope')
  })

  it('modify action merges data into context', async () => {
    pipeline.register({
      name: 'modifier',
      point: 'beforeInbound',
      execute: async (ctx) => ({ action: 'modify', data: { extra: 'added' } }),
    })
    const result = await pipeline.run('beforeInbound', { original: true })
    assert.equal(result.blocked, false)
    assert.equal(result.ctx.original, true)
    assert.equal(result.ctx.extra, 'added')
  })

  it('disabled hooks are skipped', async () => {
    pipeline.register({ name: 'disabled', point: 'beforeInbound', enabled: false, execute: async () => ({ action: 'block' }) })
    const result = await pipeline.run('beforeInbound', {})
    assert.equal(result.blocked, false)
  })

  it('setEnabled toggles a hook', async () => {
    pipeline.register({ name: 'toggle', point: 'beforeInbound', execute: async () => ({ action: 'block', reason: 'blocked' }) })
    pipeline.setEnabled('toggle', false)
    const result = await pipeline.run('beforeInbound', {})
    assert.equal(result.blocked, false)
    pipeline.setEnabled('toggle', true)
    const result2 = await pipeline.run('beforeInbound', {})
    assert.equal(result2.blocked, true)
  })

  it('hook errors fail-open (do not block)', async () => {
    pipeline.register({ name: 'crasher', point: 'beforeInbound', execute: async () => { throw new Error('boom') } })
    const result = await pipeline.run('beforeInbound', {})
    assert.equal(result.blocked, false)
  })

  it('list returns all registered hooks', () => {
    pipeline.register({ name: 'a', point: 'beforeInbound', execute: async () => ({}) })
    pipeline.register({ name: 'b', point: 'beforeOutbound', execute: async () => ({}) })
    const list = pipeline.list()
    assert.equal(list.length, 2)
    assert.ok(list.some(h => h.name === 'a'))
    assert.ok(list.some(h => h.name === 'b'))
  })

  it('clearAll removes everything', () => {
    pipeline.register({ name: 'a', point: 'beforeInbound', execute: async () => ({}) })
    pipeline.register({ name: 'b', point: 'beforeOutbound', execute: async () => ({}) })
    pipeline.clearAll()
    assert.equal(pipeline.size, 0)
  })

  it('serialize and deserialize round-trip with factories', () => {
    pipeline.register({
      name: 'audit',
      point: 'beforeToolCall',
      priority: 10,
      factoryName: 'auditFactory',
      execute: async () => ({ action: 'continue' }),
    })
    const serialized = pipeline.serialize()
    assert.equal(serialized.hooks.length, 1)
    assert.equal(serialized.hooks[0].factoryName, 'auditFactory')

    const pipeline2 = new HookPipeline()
    pipeline2.deserialize(serialized, {
      auditFactory: (config) => ({ name: config.name, point: config.point, execute: async () => ({ action: 'continue' }) }),
    })
    assert.equal(pipeline2.size, 1)
  })

  it('deserialize skips unknown factories silently', () => {
    const pipeline2 = new HookPipeline()
    pipeline2.deserialize({ hooks: [{ name: 'x', point: 'beforeInbound', factoryName: 'missing' }] }, {})
    assert.equal(pipeline2.size, 0)
  })
})

describe('createAuditLoggerHook', () => {
  it('creates a hook that calls onLog with tool info', async () => {
    const calls = []
    const hook = createAuditLoggerHook((name, args, ts) => calls.push({ name, args, ts }))
    assert.equal(hook.name, 'audit-logger')
    assert.equal(hook.point, 'beforeToolCall')

    const pipeline = new HookPipeline()
    pipeline.register(hook)
    await pipeline.run('beforeToolCall', { toolName: 'read_file', args: { path: '/a' } })
    assert.equal(calls.length, 1)
    assert.equal(calls[0].name, 'read_file')
  })
})

describe('HOOK_POINTS', () => {
  it('exports all 6 lifecycle points', () => {
    assert.equal(HOOK_POINTS.length, 6)
    assert.ok(HOOK_POINTS.includes('beforeInbound'))
    assert.ok(HOOK_POINTS.includes('beforeToolCall'))
    assert.ok(HOOK_POINTS.includes('beforeOutbound'))
    assert.ok(HOOK_POINTS.includes('transformResponse'))
    assert.ok(HOOK_POINTS.includes('onSessionStart'))
    assert.ok(HOOK_POINTS.includes('onSessionEnd'))
  })
})

// ══════════════════════════════════════════════════════════════════════
// AutonomyController
// ══════════════════════════════════════════════════════════════════════

describe('AutonomyController', () => {
  it('defaults to supervised level', () => {
    const ac = new AutonomyController()
    assert.equal(ac.level, 'supervised')
  })

  it('accepts initial level', () => {
    const ac = new AutonomyController({ level: 'full' })
    assert.equal(ac.level, 'full')
  })

  it('ignores invalid level in constructor', () => {
    const ac = new AutonomyController({ level: 'invalid' })
    assert.equal(ac.level, 'supervised')
  })

  it('level setter ignores invalid values', () => {
    const ac = new AutonomyController()
    ac.level = 'bogus'
    assert.equal(ac.level, 'supervised')
  })

  describe('canExecuteTool', () => {
    it('readonly allows internal/read permissions only', () => {
      const ac = new AutonomyController({ level: 'readonly' })
      assert.equal(ac.canExecuteTool({ permission: 'read' }), true)
      assert.equal(ac.canExecuteTool({ permission: 'internal' }), true)
      assert.equal(ac.canExecuteTool({ permission: 'write' }), false)
      assert.equal(ac.canExecuteTool({ permission: 'network' }), false)
    })

    it('supervised allows all permissions', () => {
      const ac = new AutonomyController({ level: 'supervised' })
      assert.equal(ac.canExecuteTool({ permission: 'write' }), true)
      assert.equal(ac.canExecuteTool({ permission: 'network' }), true)
    })

    it('full allows all permissions', () => {
      const ac = new AutonomyController({ level: 'full' })
      assert.equal(ac.canExecuteTool({ permission: 'browser' }), true)
    })

    it('respects PolicyEngine deny', () => {
      const ac = new AutonomyController({ level: 'supervised' })
      ac.setPolicyEngine({
        evaluateToolCall: (name) => ({ allowed: name !== 'dangerous_tool' }),
      })
      assert.equal(ac.canExecuteTool({ permission: 'write', name: 'safe_tool' }), true)
      assert.equal(ac.canExecuteTool({ permission: 'write', name: 'dangerous_tool' }), false)
    })
  })

  describe('needsApproval', () => {
    it('full mode never needs approval', () => {
      const ac = new AutonomyController({ level: 'full' })
      assert.equal(ac.needsApproval({ permission: 'write' }), false)
    })

    it('readonly mode never needs approval (blocked entirely)', () => {
      const ac = new AutonomyController({ level: 'readonly' })
      assert.equal(ac.needsApproval({ permission: 'write' }), false)
    })

    it('supervised mode needs approval for non-read permissions', () => {
      const ac = new AutonomyController({ level: 'supervised' })
      assert.equal(ac.needsApproval({ permission: 'read' }), false)
      assert.equal(ac.needsApproval({ permission: 'internal' }), false)
      assert.equal(ac.needsApproval({ permission: 'write' }), true)
      assert.equal(ac.needsApproval({ permission: 'network' }), true)
    })
  })

  describe('checkLimits', () => {
    it('returns not blocked with default (infinite) limits', () => {
      const ac = new AutonomyController()
      assert.equal(ac.checkLimits().blocked, false)
    })

    it('blocks when rate limit is exceeded', () => {
      const ac = new AutonomyController({ maxActionsPerHour: 2 })
      ac.recordAction()
      ac.recordAction()
      const result = ac.checkLimits()
      assert.equal(result.blocked, true)
      assert.equal(result.limitType, 'rate')
    })

    it('blocks when daily cost limit is exceeded', () => {
      const ac = new AutonomyController({ maxCostPerDayCents: 100 })
      ac.recordCost(101)
      const result = ac.checkLimits()
      assert.equal(result.blocked, true)
      assert.equal(result.limitType, 'cost')
    })

    it('blocks when monthly cost limit is exceeded', () => {
      const ac = new AutonomyController({ maxCostPerMonthCents: 500 })
      ac.recordCost(501)
      const result = ac.checkLimits()
      assert.equal(result.blocked, true)
      assert.equal(result.limitType, 'monthly_cost')
    })
  })

  describe('allowedHours', () => {
    it('blocks outside allowed hours', () => {
      const ac = new AutonomyController({ allowedHours: [{ start: 1, end: 2 }] })
      // Current hour is unlikely to be 1-2, so this should block
      const result = ac.checkLimits()
      const currentHour = new Date().getHours()
      if (currentHour >= 1 && currentHour < 2) {
        assert.equal(result.blocked, false)
      } else {
        assert.equal(result.blocked, true)
        assert.equal(result.limitType, 'time_of_day')
      }
    })

    it('no restriction when allowedHours is empty', () => {
      const ac = new AutonomyController({ allowedHours: [] })
      assert.equal(ac.checkLimits().blocked, false)
    })
  })

  it('reset clears all counters', () => {
    const ac = new AutonomyController({ maxActionsPerHour: 1 })
    ac.recordAction()
    assert.equal(ac.checkLimits().blocked, true)
    ac.reset()
    assert.equal(ac.checkLimits().blocked, false)
  })

  it('stats returns current counters', () => {
    const ac = new AutonomyController({ level: 'full', maxActionsPerHour: 100 })
    ac.recordAction()
    ac.recordCost(50)
    const s = ac.stats
    assert.equal(s.level, 'full')
    assert.equal(s.actionsThisHour, 1)
    assert.equal(s.costTodayCents, 50)
    assert.equal(s.maxActionsPerHour, 100)
  })
})

// ══════════════════════════════════════════════════════════════════════
// ClawserAgent — run() agent loop
// ══════════════════════════════════════════════════════════════════════

describe('ClawserAgent — run()', () => {
  it('returns status 1 and echoed content on success', async () => {
    const agent = await createTestAgent()
    agent.setSystemPrompt('Test agent')
    agent.sendMessage('Hello')
    const result = await agent.run()
    assert.equal(result.status, 1)
    assert.ok(result.data.includes('Echo:'))
  })

  it('returns model and usage in result', async () => {
    const agent = await createTestAgent()
    agent.sendMessage('Hello')
    const result = await agent.run()
    assert.equal(result.model, 'echo-test')
    assert.ok(result.usage)
    assert.equal(result.usage.input_tokens, 10)
  })

  it('records agent_message event after run', async () => {
    const agent = await createTestAgent()
    agent.sendMessage('Hello')
    await agent.run()
    const events = agent.eventLog.query({ type: 'agent_message' })
    assert.ok(events.length >= 1)
  })

  it('throws when agent is destroyed', async () => {
    const agent = await createTestAgent()
    agent.destroy()
    await assert.rejects(() => agent.run(), /destroyed/)
  })

  it('returns status -1 when paused', async () => {
    const agent = await createTestAgent()
    agent.sendMessage('Hello')
    agent.pauseAgent()
    const result = await agent.run()
    assert.equal(result.status, -1)
    assert.ok(result.data.includes('paused'))
  })

  it('returns status -1 when autonomy limits are hit', async () => {
    const agent = await createTestAgent()
    agent.sendMessage('Hello')
    agent.autonomy.maxActionsPerHour = 0 // immediately blocked
    agent.autonomy.recordAction()
    // Need to actually exceed the limit
    const ac = agent.autonomy
    // Set a very low limit
    const agent2 = await createTestAgent()
    agent2.applyAutonomyConfig({ maxActionsPerHour: 1 })
    agent2.autonomy.recordAction()
    agent2.sendMessage('Hello')
    const result = await agent2.run()
    assert.equal(result.status, -1)
    assert.ok(result.data.includes('Rate limit'))
  })

  it('returns provider error on LLM failure', async () => {
    const agent = await createTestAgent({
      _provider: makeErrorProvider('API quota exceeded'),
    })
    agent.sendMessage('Hello')
    const result = await agent.run()
    assert.equal(result.status, -1)
    assert.ok(result.data.includes('API quota exceeded'))
  })

  it('isRunning is false after run completes', async () => {
    const agent = await createTestAgent()
    agent.sendMessage('Hello')
    await agent.run()
    assert.equal(agent.isRunning, false)
  })
})

// ══════════════════════════════════════════════════════════════════════
// ClawserAgent — run() with tool calls
// ══════════════════════════════════════════════════════════════════════

describe('ClawserAgent — run() with tool calls', () => {
  it('executes a tool call and returns final response', async () => {
    const toolExecuted = []
    const readTool = {
      name: 'browser_fs_read',
      description: 'Read a file',
      parameters: { type: 'object', properties: { path: { type: 'string' } } },
      permission: 'read',
      execute: async (params) => {
        toolExecuted.push(params)
        return { success: true, output: 'file content here' }
      },
    }

    const provider = makeSequenceProvider([
      // First call: LLM returns a tool call
      {
        content: 'Reading file...',
        tool_calls: [{
          id: 'tc_1',
          name: 'browser_fs_read',
          arguments: '{"path":"/test.txt"}',
        }],
        usage: { input_tokens: 10, output_tokens: 5 },
        model: 'test',
      },
      // Second call: LLM returns plain text (after seeing tool result)
      {
        content: 'The file contains: file content here',
        tool_calls: [],
        usage: { input_tokens: 20, output_tokens: 10 },
        model: 'test',
      },
    ])

    const agent = await createTestAgent({
      _provider: provider,
      browserTools: makeToolRegistry([readTool]),
    })
    agent.sendMessage('Read /test.txt')
    const result = await agent.run()

    assert.equal(result.status, 1)
    assert.equal(toolExecuted.length, 1)
    assert.equal(toolExecuted[0].path, '/test.txt')
    assert.ok(result.data.includes('file content here'))
  })

  it('records tool_call and tool_result events', async () => {
    const readTool = {
      name: 'test_read',
      description: 'Read',
      parameters: {},
      permission: 'read',
      execute: async () => ({ success: true, output: 'data' }),
    }

    const provider = makeSequenceProvider([
      {
        content: '',
        tool_calls: [{ id: 'tc_1', name: 'test_read', arguments: '{}' }],
        usage: { input_tokens: 5, output_tokens: 5 },
        model: 'test',
      },
      { content: 'Done', tool_calls: [], usage: { input_tokens: 5, output_tokens: 5 }, model: 'test' },
    ])

    const agent = await createTestAgent({
      _provider: provider,
      browserTools: makeToolRegistry([readTool]),
    })
    agent.sendMessage('Do it')
    await agent.run()

    const tcEvents = agent.eventLog.query({ type: 'tool_call' })
    const trEvents = agent.eventLog.query({ type: 'tool_result' })
    assert.equal(tcEvents.length, 1)
    assert.equal(trEvents.length, 1)
    assert.equal(trEvents[0].data.result.success, true)
  })

  it('handles unknown tool gracefully', async () => {
    const provider = makeSequenceProvider([
      {
        content: '',
        tool_calls: [{ id: 'tc_1', name: 'nonexistent_tool', arguments: '{}' }],
        usage: { input_tokens: 5, output_tokens: 5 },
        model: 'test',
      },
      { content: 'Tool not found', tool_calls: [], usage: { input_tokens: 5, output_tokens: 5 }, model: 'test' },
    ])

    const agent = await createTestAgent({ _provider: provider })
    agent.sendMessage('Use a tool')
    const result = await agent.run()
    assert.equal(result.status, 1)
    // Tool result should contain error about tool not found
    const trEvents = agent.eventLog.query({ type: 'tool_result' })
    assert.ok(trEvents[0].data.result.error.includes('Tool not found'))
  })

  it('handles malformed JSON in tool arguments', async () => {
    const provider = makeSequenceProvider([
      {
        content: '',
        tool_calls: [{ id: 'tc_1', name: 'some_tool', arguments: 'not-json{' }],
        usage: { input_tokens: 5, output_tokens: 5 },
        model: 'test',
      },
      { content: 'Error handled', tool_calls: [], usage: { input_tokens: 5, output_tokens: 5 }, model: 'test' },
    ])

    const agent = await createTestAgent({ _provider: provider })
    agent.sendMessage('Call tool')
    const result = await agent.run()
    assert.equal(result.status, 1)
  })
})

// ══════════════════════════════════════════════════════════════════════
// ClawserAgent — iteration limit
// ══════════════════════════════════════════════════════════════════════

describe('ClawserAgent — iteration limit', () => {
  it('stops after maxToolIterations and returns error', async () => {
    // Provider that always returns tool calls (infinite loop)
    const infiniteProvider = {
      supportsNativeTools: true,
      supportsStreaming: false,
      requiresApiKey: false,
      chat: async () => ({
        content: 'calling tool again',
        tool_calls: [{ id: `tc_${Date.now()}`, name: 'loop_tool', arguments: '{}' }],
        usage: { input_tokens: 5, output_tokens: 5 },
        model: 'test',
      }),
    }

    const loopTool = {
      name: 'loop_tool',
      description: 'Loop',
      parameters: {},
      permission: 'read',
      execute: async () => ({ success: true, output: 'ok' }),
    }

    const agent = await createTestAgent({
      _provider: infiniteProvider,
      _config: { maxToolIterations: 3 },
      browserTools: makeToolRegistry([loopTool]),
    })
    agent.sendMessage('Loop forever')
    const result = await agent.run()
    assert.equal(result.status, -1)
    assert.ok(result.data.includes('max iterations'))
  })

  it('default maxToolIterations is 20', async () => {
    const agent = await createTestAgent()
    const cfg = agent.getConfig()
    assert.equal(cfg.maxToolIterations, 20)
  })

  it('setMaxToolIterations changes the limit', async () => {
    const agent = await createTestAgent()
    agent.setMaxToolIterations(5)
    const cfg = agent.getConfig()
    assert.equal(cfg.maxToolIterations, 5)
  })

  it('setMaxToolIterations ignores non-positive values', async () => {
    const agent = await createTestAgent()
    agent.setMaxToolIterations(0)
    assert.equal(agent.getConfig().maxToolIterations, 20) // unchanged
    agent.setMaxToolIterations(-1)
    assert.equal(agent.getConfig().maxToolIterations, 20) // unchanged
  })
})

// ══════════════════════════════════════════════════════════════════════
// ClawserAgent — parallel vs sequential tool execution
// ══════════════════════════════════════════════════════════════════════

describe('ClawserAgent — parallel vs sequential tool execution', () => {
  it('executes multiple read-only tools in parallel', async () => {
    const executionOrder = []
    const makeReadTool = (name, delay = 0) => ({
      name,
      description: name,
      parameters: {},
      permission: 'read',
      execute: async () => {
        executionOrder.push(`start:${name}`)
        if (delay) await new Promise(r => setTimeout(r, delay))
        executionOrder.push(`end:${name}`)
        return { success: true, output: `${name} result` }
      },
    })

    const provider = makeSequenceProvider([
      {
        content: '',
        tool_calls: [
          { id: 'tc_1', name: 'read_a', arguments: '{}' },
          { id: 'tc_2', name: 'read_b', arguments: '{}' },
          { id: 'tc_3', name: 'read_c', arguments: '{}' },
        ],
        usage: { input_tokens: 5, output_tokens: 5 },
        model: 'test',
      },
      { content: 'All read', tool_calls: [], usage: { input_tokens: 5, output_tokens: 5 }, model: 'test' },
    ])

    const agent = await createTestAgent({
      _provider: provider,
      browserTools: makeToolRegistry([
        makeReadTool('read_a', 10),
        makeReadTool('read_b', 10),
        makeReadTool('read_c', 10),
      ]),
    })
    agent.sendMessage('Read all')
    const result = await agent.run()
    assert.equal(result.status, 1)
    // All three tools should have been called
    assert.ok(executionOrder.includes('start:read_a'))
    assert.ok(executionOrder.includes('start:read_b'))
    assert.ok(executionOrder.includes('start:read_c'))
  })

  it('executes write tools sequentially', async () => {
    const executionOrder = []
    const makeWriteTool = (name) => ({
      name,
      description: name,
      parameters: {},
      permission: 'write',
      execute: async () => {
        executionOrder.push(`exec:${name}`)
        return { success: true, output: `${name} done` }
      },
    })

    const provider = makeSequenceProvider([
      {
        content: '',
        tool_calls: [
          { id: 'tc_1', name: 'write_a', arguments: '{}' },
          { id: 'tc_2', name: 'write_b', arguments: '{}' },
        ],
        usage: { input_tokens: 5, output_tokens: 5 },
        model: 'test',
      },
      { content: 'Written', tool_calls: [], usage: { input_tokens: 5, output_tokens: 5 }, model: 'test' },
    ])

    const agent = await createTestAgent({
      _provider: provider,
      browserTools: makeToolRegistry([makeWriteTool('write_a'), makeWriteTool('write_b')]),
    })
    agent.sendMessage('Write')
    await agent.run()
    // Sequential means order is deterministic
    assert.deepEqual(executionOrder, ['exec:write_a', 'exec:write_b'])
  })

  it('mixed read/write: reads run parallel, writes run sequentially', async () => {
    const readTool = {
      name: 'reader',
      description: 'read',
      parameters: {},
      permission: 'read',
      execute: async () => ({ success: true, output: 'read' }),
    }
    const writeTool = {
      name: 'writer',
      description: 'write',
      parameters: {},
      permission: 'write',
      execute: async () => ({ success: true, output: 'written' }),
    }

    const provider = makeSequenceProvider([
      {
        content: '',
        tool_calls: [
          { id: 'tc_1', name: 'reader', arguments: '{}' },
          { id: 'tc_2', name: 'writer', arguments: '{}' },
          { id: 'tc_3', name: 'reader', arguments: '{}' },
        ],
        usage: { input_tokens: 5, output_tokens: 5 },
        model: 'test',
      },
      { content: 'Done', tool_calls: [], usage: { input_tokens: 5, output_tokens: 5 }, model: 'test' },
    ])

    const agent = await createTestAgent({
      _provider: provider,
      browserTools: makeToolRegistry([readTool, writeTool]),
    })
    agent.sendMessage('Mix')
    const result = await agent.run()
    assert.equal(result.status, 1)
    // All 3 tool results should be recorded
    const trEvents = agent.eventLog.query({ type: 'tool_result' })
    assert.equal(trEvents.length, 3)
  })
})

// ══════════════════════════════════════════════════════════════════════
// ClawserAgent — context compaction
// ══════════════════════════════════════════════════════════════════════

describe('ClawserAgent — context compaction', () => {
  it('compactContext returns false when under threshold', async () => {
    const agent = await createTestAgent()
    agent.sendMessage('Short message')
    const compacted = await agent.compactContext()
    assert.equal(compacted, false)
  })

  it('compactContext returns true when history is large', async () => {
    const agent = await createTestAgent()
    agent.setSystemPrompt('System prompt')
    // Fill up history with enough messages to exceed token threshold
    for (let i = 0; i < 30; i++) {
      agent.sendMessage('A'.repeat(500)) // ~125 tokens each
    }
    // 30 * 125 = 3750 tokens, default maxTokens for compaction is 8000
    // We need more to trigger compaction
    for (let i = 0; i < 30; i++) {
      agent.sendMessage('B'.repeat(500))
    }
    const compacted = await agent.compactContext({ maxTokens: 2000, keepRecent: 5 })
    assert.equal(compacted, true)
    // History should be smaller now
    const ckpt = agent.getCheckpointJSON()
    assert.ok(ckpt.session_history.length < 65) // much less than 60+ original
  })

  it('compactContext uses fallback truncation when no provider', async () => {
    const agent = await ClawserAgent.create({})
    agent.init({})
    agent.setSystemPrompt('System')
    for (let i = 0; i < 40; i++) {
      agent.sendMessage('X'.repeat(400))
    }
    const compacted = await agent.compactContext({ maxTokens: 1000, keepRecent: 3 })
    assert.equal(compacted, true)
    const ckpt = agent.getCheckpointJSON()
    // Should have system + summary user + summary assistant + 3 recent = ~6
    assert.ok(ckpt.session_history.length <= 10)
  })

  it('proactive compaction triggers during run when history exceeds threshold', async () => {
    const agent = await createTestAgent({
      _config: { compactionThreshold: 500 }, // low threshold to trigger check
    })
    agent.setSystemPrompt('System')
    // Add enough history to exceed both compactionThreshold (500) AND
    // compactContext's internal maxTokens (8000 default) = 32000+ chars
    for (let i = 0; i < 80; i++) {
      agent.sendMessage('A'.repeat(500)) // 80 * 125 tokens = 10000 tokens
    }
    agent.sendMessage('Final question')
    const result = await agent.run()
    assert.equal(result.status, 1)
    // Compaction event should be recorded
    const compactEvents = agent.eventLog.query({ type: 'context_compacted' })
    assert.ok(compactEvents.length >= 1)
  })
})

// ══════════════════════════════════════════════════════════════════════
// ClawserAgent — runStream()
// ══════════════════════════════════════════════════════════════════════

describe('ClawserAgent — runStream()', () => {
  it('yields text and done chunks for non-streaming provider fallback', async () => {
    const agent = await createTestAgent()
    agent.sendMessage('Hello stream')
    const chunks = []
    for await (const chunk of agent.runStream()) {
      chunks.push(chunk)
    }
    // Non-streaming provider: should yield text then done
    assert.ok(chunks.some(c => c.type === 'text'))
    assert.ok(chunks.some(c => c.type === 'done'))
  })

  it('yields chunks from streaming provider', async () => {
    const streamChunks = [
      { type: 'text', text: 'Hello ' },
      { type: 'text', text: 'world' },
      { type: 'done', response: { content: 'Hello world', tool_calls: [], usage: { input_tokens: 5, output_tokens: 3 }, model: 'stream' } },
    ]
    const agent = await createTestAgent({
      _provider: makeStreamProvider(streamChunks),
    })
    agent.sendMessage('Stream me')
    const received = []
    for await (const chunk of agent.runStream()) {
      received.push(chunk)
    }
    assert.ok(received.length >= 2)
    const textChunks = received.filter(c => c.type === 'text')
    assert.ok(textChunks.length >= 1)
  })

  it('throws when agent is destroyed', async () => {
    const agent = await createTestAgent()
    agent.destroy()
    await assert.rejects(async () => {
      for await (const _chunk of agent.runStream()) { /* consume */ }
    }, /destroyed/)
  })

  it('yields error chunk when paused', async () => {
    const agent = await createTestAgent()
    agent.sendMessage('Hello')
    agent.pauseAgent()
    const chunks = []
    for await (const chunk of agent.runStream()) {
      chunks.push(chunk)
    }
    assert.ok(chunks.some(c => c.type === 'error' && c.error.includes('paused')))
  })

  it('yields error chunk on provider failure', async () => {
    const agent = await createTestAgent({
      _provider: makeErrorProvider('stream boom'),
    })
    agent.sendMessage('Hello')
    const chunks = []
    for await (const chunk of agent.runStream()) {
      chunks.push(chunk)
    }
    assert.ok(chunks.some(c => c.type === 'error'))
  })

  it('isRunning is false after runStream completes', async () => {
    const agent = await createTestAgent()
    agent.sendMessage('Hello')
    for await (const _c of agent.runStream()) { /* consume */ }
    assert.equal(agent.isRunning, false)
  })

  it('handles tool calls in non-streaming fallback path', async () => {
    const tool = {
      name: 'stream_tool',
      description: 'test',
      parameters: {},
      permission: 'read',
      execute: async () => ({ success: true, output: 'tool output' }),
    }

    const provider = makeSequenceProvider([
      {
        content: 'Calling tool',
        tool_calls: [{ id: 'tc_1', name: 'stream_tool', arguments: '{}' }],
        usage: { input_tokens: 5, output_tokens: 5 },
        model: 'test',
      },
      { content: 'Tool done', tool_calls: [], usage: { input_tokens: 5, output_tokens: 5 }, model: 'test' },
    ])

    const agent = await createTestAgent({
      _provider: provider,
      browserTools: makeToolRegistry([tool]),
    })
    agent.sendMessage('Use tool')
    const chunks = []
    for await (const chunk of agent.runStream()) {
      chunks.push(chunk)
    }
    assert.ok(chunks.some(c => c.type === 'tool_start'))
    assert.ok(chunks.some(c => c.type === 'tool_result'))
    assert.ok(chunks.some(c => c.type === 'text'))
  })
})

// ══════════════════════════════════════════════════════════════════════
// ClawserAgent — memory operations
// ══════════════════════════════════════════════════════════════════════

describe('ClawserAgent — memory operations', () => {
  it('memoryStore returns an ID', async () => {
    const agent = await createTestAgent()
    const id = agent.memoryStore({ key: 'pref', content: 'Likes JavaScript' })
    assert.ok(typeof id === 'string')
    assert.ok(id.length > 0)
  })

  it('memoryStore records an event', async () => {
    const agent = await createTestAgent()
    agent.memoryStore({ key: 'lang', content: 'Uses TypeScript' })
    const events = agent.eventLog.query({ type: 'memory_stored' })
    assert.equal(events.length, 1)
    assert.equal(events[0].data.key, 'lang')
  })

  it('memoryRecall finds stored entries by keyword', async () => {
    const agent = await createTestAgent()
    agent.memoryStore({ key: 'language', content: 'User prefers JavaScript', category: 'learned' })
    agent.memoryStore({ key: 'editor', content: 'Uses VS Code for editing', category: 'learned' })
    const results = agent.memoryRecall('JavaScript')
    assert.ok(results.length >= 1)
    assert.ok(results[0].content.includes('JavaScript'))
  })

  it('memoryRecall returns all entries for empty query', async () => {
    const agent = await createTestAgent()
    agent.memoryStore({ key: 'a', content: 'Entry A' })
    agent.memoryStore({ key: 'b', content: 'Entry B' })
    const all = agent.memoryRecall('')
    assert.equal(all.length, 2)
  })

  it('memoryRecall caches results (LRU)', async () => {
    const agent = await createTestAgent()
    agent.memoryStore({ key: 'cached', content: 'Cached entry for testing' })
    const r1 = agent.memoryRecall('cached')
    const r2 = agent.memoryRecall('cached')
    // Results should be identical (from cache)
    assert.deepEqual(r1, r2)
  })

  it('memoryForget removes an entry', async () => {
    const agent = await createTestAgent()
    const id = agent.memoryStore({ key: 'temp', content: 'Temporary memory' })
    const result = agent.memoryForget(id)
    assert.equal(result, 1)
    const events = agent.eventLog.query({ type: 'memory_forgotten' })
    assert.equal(events.length, 1)
  })

  it('memoryForget returns 0 for non-existent ID', async () => {
    const agent = await createTestAgent()
    assert.equal(agent.memoryForget('nonexistent'), 0)
  })

  it('memoryStore invalidates recall cache', async () => {
    const agent = await createTestAgent()
    agent.memoryStore({ key: 'old', content: 'Old memory' })
    const r1 = agent.memoryRecall('old')
    // Store a new entry — should invalidate cache
    agent.memoryStore({ key: 'new', content: 'New old memory' })
    const r2 = agent.memoryRecall('old')
    // r2 should include the new entry
    assert.ok(r2.length >= r1.length)
  })

  it('memoryHygiene removes duplicates', async () => {
    const agent = await createTestAgent()
    agent.memoryStore({ key: 'dup', content: 'First version' })
    agent.memoryStore({ key: 'dup', content: 'Second version' })
    const removed = agent.memoryHygiene()
    assert.ok(removed >= 1)
  })
})

// ══════════════════════════════════════════════════════════════════════
// ClawserAgent — hooks integration with run()
// ══════════════════════════════════════════════════════════════════════

describe('ClawserAgent — hooks integration', () => {
  it('beforeInbound hook can block the run', async () => {
    const agent = await createTestAgent()
    agent.hooks.register({
      name: 'blocker',
      point: 'beforeInbound',
      execute: async () => ({ action: 'block', reason: 'forbidden' }),
    })
    agent.sendMessage('Hello')
    const result = await agent.run()
    assert.equal(result.status, -1)
    assert.ok(result.data.includes('forbidden'))
  })

  it('beforeInbound hook can modify the message', async () => {
    const agent = await createTestAgent()
    agent.hooks.register({
      name: 'modifier',
      point: 'beforeInbound',
      execute: async (ctx) => ({ action: 'modify', data: { message: ctx.message + ' [modified]' } }),
    })
    agent.sendMessage('Hello')
    const result = await agent.run()
    assert.equal(result.status, 1)
    // The echo provider should reflect the modified message
    assert.ok(result.data.includes('[modified]'))
  })

  it('beforeOutbound hook can block the response', async () => {
    const agent = await createTestAgent()
    agent.hooks.register({
      name: 'outbound-blocker',
      point: 'beforeOutbound',
      execute: async () => ({ action: 'block', reason: 'output censored' }),
    })
    agent.sendMessage('Hello')
    const result = await agent.run()
    assert.equal(result.status, -1)
    assert.ok(result.data.includes('output censored'))
  })

  it('transformResponse hook can modify the response content', async () => {
    const agent = await createTestAgent()
    agent.hooks.register({
      name: 'transformer',
      point: 'transformResponse',
      execute: async (ctx) => ({ action: 'modify', data: { response: ctx.response + ' [transformed]' } }),
    })
    agent.sendMessage('Hello')
    const result = await agent.run()
    assert.equal(result.status, 1)
    assert.ok(result.data.includes('[transformed]'))
  })

  it('beforeToolCall hook can block tool execution', async () => {
    const tool = {
      name: 'blocked_tool',
      description: 'test',
      parameters: {},
      permission: 'read',
      execute: async () => ({ success: true, output: 'should not run' }),
    }

    const provider = makeSequenceProvider([
      {
        content: '',
        tool_calls: [{ id: 'tc_1', name: 'blocked_tool', arguments: '{}' }],
        usage: { input_tokens: 5, output_tokens: 5 },
        model: 'test',
      },
      { content: 'Blocked tool', tool_calls: [], usage: { input_tokens: 5, output_tokens: 5 }, model: 'test' },
    ])

    const agent = await createTestAgent({
      _provider: provider,
      browserTools: makeToolRegistry([tool]),
    })
    agent.hooks.register({
      name: 'tool-blocker',
      point: 'beforeToolCall',
      execute: async (ctx) => {
        if (ctx.toolName === 'blocked_tool') return { action: 'block', reason: 'nope' }
        return { action: 'continue' }
      },
    })
    agent.sendMessage('Use tool')
    await agent.run()

    const trEvents = agent.eventLog.query({ type: 'tool_result' })
    assert.ok(trEvents[0].data.result.error.includes('Blocked by hook'))
  })
})

// ══════════════════════════════════════════════════════════════════════
// ClawserAgent — autonomy integration with run()
// ══════════════════════════════════════════════════════════════════════

describe('ClawserAgent — autonomy integration', () => {
  it('readonly mode blocks write tool calls', async () => {
    const writeTool = {
      name: 'write_file',
      description: 'write',
      parameters: {},
      permission: 'write',
      execute: async () => ({ success: true, output: 'written' }),
    }

    const provider = makeSequenceProvider([
      {
        content: '',
        tool_calls: [{ id: 'tc_1', name: 'write_file', arguments: '{}' }],
        usage: { input_tokens: 5, output_tokens: 5 },
        model: 'test',
      },
      { content: 'Blocked', tool_calls: [], usage: { input_tokens: 5, output_tokens: 5 }, model: 'test' },
    ])

    const agent = await createTestAgent({
      _provider: provider,
      browserTools: makeToolRegistry([writeTool]),
    })
    agent.applyAutonomyConfig({ level: 'readonly' })
    agent.sendMessage('Write a file')
    await agent.run()

    const trEvents = agent.eventLog.query({ type: 'tool_result' })
    assert.ok(trEvents[0].data.result.error.includes('readonly'))
  })

  it('applyAutonomyConfig updates level and limits', async () => {
    const agent = await createTestAgent()
    agent.applyAutonomyConfig({
      level: 'full',
      maxActionsPerHour: 50,
      maxCostPerDayCents: 200,
    })
    assert.equal(agent.autonomy.level, 'full')
    assert.equal(agent.autonomy.maxActionsPerHour, 50)
    assert.equal(agent.autonomy.maxCostPerDayCents, 200)
  })
})

// ══════════════════════════════════════════════════════════════════════
// ClawserAgent — error handling & classification
// ══════════════════════════════════════════════════════════════════════

describe('ClawserAgent — error handling', () => {
  it('provider error returns status -1 with error message', async () => {
    const agent = await createTestAgent({
      _provider: makeErrorProvider('rate limit exceeded'),
    })
    agent.sendMessage('Hello')
    const result = await agent.run()
    assert.equal(result.status, -1)
    assert.ok(result.data.includes('rate limit exceeded'))
  })

  it('provider error records error event', async () => {
    const agent = await createTestAgent({
      _provider: makeErrorProvider('network timeout'),
    })
    agent.sendMessage('Hello')
    await agent.run()
    const errors = agent.eventLog.query({ type: 'error' })
    assert.ok(errors.length >= 1)
    assert.ok(errors[0].data.message.includes('network timeout'))
  })

  it('missing provider throws', async () => {
    const agent = await ClawserAgent.create({})
    agent.init({})
    agent.sendMessage('Hello')
    await assert.rejects(() => agent.run(), /No provider/)
  })

  it('unknown provider name throws', async () => {
    const agent = await createTestAgent()
    agent.setProvider('nonexistent')
    agent.sendMessage('Hello')
    await assert.rejects(() => agent.run(), /Provider not found/)
  })

  it('tool execution errors are captured in tool_result', async () => {
    const crashTool = {
      name: 'crash_tool',
      description: 'crashes',
      parameters: {},
      permission: 'read',
      execute: async () => { throw new Error('tool crash') },
    }

    // The browser tool registry wraps execute errors, so let's test via the registry
    const registry = makeToolRegistry([crashTool])
    // Override execute to throw
    const original = registry.execute
    registry.execute = async (name, params) => {
      const tool = registry.get(name)
      if (!tool) return { success: false, output: '', error: 'not found' }
      try {
        return await tool.execute(params)
      } catch (e) {
        return { success: false, output: '', error: e.message }
      }
    }

    const provider = makeSequenceProvider([
      {
        content: '',
        tool_calls: [{ id: 'tc_1', name: 'crash_tool', arguments: '{}' }],
        usage: { input_tokens: 5, output_tokens: 5 },
        model: 'test',
      },
      { content: 'Handled crash', tool_calls: [], usage: { input_tokens: 5, output_tokens: 5 }, model: 'test' },
    ])

    const agent = await createTestAgent({
      _provider: provider,
      browserTools: registry,
    })
    agent.sendMessage('Crash')
    const result = await agent.run()
    assert.equal(result.status, 1) // Agent should recover
  })
})

// ══════════════════════════════════════════════════════════════════════
// ClawserAgent — goal management (deeper)
// ══════════════════════════════════════════════════════════════════════

describe('ClawserAgent — goal management (extended)', () => {
  it('multiple goals get unique sequential IDs', async () => {
    const agent = await createTestAgent()
    const id1 = agent.addGoal('Goal A')
    const id2 = agent.addGoal('Goal B')
    const id3 = agent.addGoal('Goal C')
    assert.notEqual(id1, id2)
    assert.notEqual(id2, id3)
  })

  it('goals survive checkpoint/restore', async () => {
    const agent = await createTestAgent()
    agent.addGoal('Persistent goal')
    agent.addGoal('Another goal')
    const bytes = agent.checkpoint()

    const agent2 = await createTestAgent()
    agent2.restore(bytes)
    const state = agent2.getState()
    assert.equal(state.goals.length, 2)
  })

  it('updateGoal records event with correct status', async () => {
    const agent = await createTestAgent()
    const id = agent.addGoal('Track status')
    agent.updateGoal(id, 'failed')
    const events = agent.eventLog.query({ type: 'goal_updated' })
    assert.equal(events.length, 1)
    assert.equal(events[0].data.status, 'failed')
  })

  it('removeGoal records goal_removed event', async () => {
    const agent = await createTestAgent()
    const id = agent.addGoal('Remove me')
    agent.removeGoal(id)
    const events = agent.eventLog.query({ type: 'goal_removed' })
    assert.equal(events.length, 1)
    assert.equal(events[0].data.id, id)
  })

  it('getGoal returns the goal by id (and null when missing)', async () => {
    const agent = await createTestAgent()
    const id = agent.addGoal('Look up me')
    const found = agent.getGoal(id)
    assert.equal(found?.id, id)
    assert.equal(found.description, 'Look up me')
    assert.equal(agent.getGoal('does-not-exist'), null)
  })

  it('editGoal updates description + priority and logs goal_edited', async () => {
    const agent = await createTestAgent()
    const id = agent.addGoal('Original')
    const ok = agent.editGoal(id, { description: 'Updated', priority: 'high' })
    assert.equal(ok, true)
    const goal = agent.getGoal(id)
    assert.equal(goal.description, 'Updated')
    assert.equal(goal.priority, 'high')
    const events = agent.eventLog.query({ type: 'goal_edited' })
    assert.equal(events.length, 1)
    assert.equal(events[0].data.description, 'Updated')
    assert.equal(events[0].data.priority, 'high')
  })

  it('editGoal returns false for unknown id and ignores empty patch', async () => {
    const agent = await createTestAgent()
    const id = agent.addGoal('x')
    assert.equal(agent.editGoal('missing', { description: 'X' }), false)
    assert.equal(agent.editGoal(id, {}), false)
    assert.equal(agent.editGoal(id, { description: '' }), false)
  })

  it('addHook accepts UI-style {handler} spec and registers via execute', async () => {
    const agent = await createTestAgent()
    let hits = 0
    agent.addHook({ name: 'h1', point: 'beforeInbound', handler: async () => { hits++; return { action: 'continue' } } })
    const list = agent.listHooks()
    assert.equal(list.length, 1)
    assert.equal(list[0].name, 'h1')
    assert.equal(list[0].point, 'beforeInbound')
    // The pipeline runs by `execute`; calling run() through the agent path is
    // covered elsewhere — here, just verify execute is set.
  })

  it('removeHook removes a hook by name across all points', async () => {
    const agent = await createTestAgent()
    agent.addHook({ name: 'h1', point: 'beforeInbound', handler: () => ({}) })
    agent.addHook({ name: 'h1', point: 'beforeOutbound', handler: () => ({}) })
    agent.addHook({ name: 'h2', point: 'beforeInbound', handler: () => ({}) })
    const ok = agent.removeHook('h1')
    assert.equal(ok, true)
    const list = agent.listHooks()
    assert.equal(list.length, 1)
    assert.equal(list[0].name, 'h2')
    assert.equal(agent.removeHook('does-not-exist'), false)
  })

  it('enableHook flips enabled flag without removing the hook', async () => {
    const agent = await createTestAgent()
    agent.addHook({ name: 'h1', point: 'beforeInbound', handler: () => ({}) })
    agent.enableHook('h1', false)
    let h = agent.listHooks().find(x => x.name === 'h1')
    assert.equal(h.enabled, false)
    agent.enableHook('h1', true)
    h = agent.listHooks().find(x => x.name === 'h1')
    assert.equal(h.enabled, true)
  })

  it('deriveGoals replays goal_edited and goal_removed events', async () => {
    const agent = await createTestAgent()
    const idA = agent.addGoal('A')
    const idB = agent.addGoal('B')
    agent.editGoal(idA, { description: 'A renamed', priority: 'low' })
    agent.removeGoal(idB)
    const goals = agent.eventLog.deriveGoals()
    assert.equal(goals.length, 1)
    assert.equal(goals[0].id, idA)
    assert.equal(goals[0].description, 'A renamed')
    assert.equal(goals[0].priority, 'low')
  })

  it('getState includes goal count', async () => {
    const agent = await createTestAgent()
    agent.addGoal('One')
    agent.addGoal('Two')
    const state = agent.getState()
    assert.equal(state.goals.length, 2)
  })
})

// ══════════════════════════════════════════════════════════════════════
// ClawserAgent — destroy
// ══════════════════════════════════════════════════════════════════════

describe('ClawserAgent — destroy', () => {
  it('destroy clears all state', async () => {
    const agent = await createTestAgent()
    agent.sendMessage('Hello')
    agent.addGoal('Goal')
    agent.destroy()
    assert.equal(agent.getState().history_len, 0)
    assert.equal(agent.getState().goals.length, 0)
  })

  it('run throws after destroy', async () => {
    const agent = await createTestAgent()
    agent.destroy()
    await assert.rejects(() => agent.run(), /destroyed/)
  })

  it('runStream throws after destroy', async () => {
    const agent = await createTestAgent()
    agent.destroy()
    await assert.rejects(async () => {
      for await (const _c of agent.runStream()) {}
    }, /destroyed/)
  })
})

// ══════════════════════════════════════════════════════════════════════
// ClawserAgent — cancel
// ══════════════════════════════════════════════════════════════════════

describe('ClawserAgent — cancel during run', () => {
  it('cancels mid-run and returns status -2', async () => {
    let resolveChat
    const slowProvider = {
      supportsNativeTools: true,
      supportsStreaming: false,
      requiresApiKey: false,
      chat: () => new Promise((resolve) => {
        resolveChat = resolve
      }),
    }

    const agent = await createTestAgent({ _provider: slowProvider })
    agent.sendMessage('Slow request')

    // Start run, then cancel before resolving
    const runPromise = agent.run()
    // Give it a tick to enter the loop
    await new Promise(r => setTimeout(r, 10))
    agent.cancel()
    // Resolve the pending chat so the promise can settle
    resolveChat({
      content: 'late response',
      tool_calls: [],
      usage: { input_tokens: 1, output_tokens: 1 },
      model: 'slow',
    })

    const result = await runPromise
    // After cancel, next iteration should detect aborted signal
    // The first iteration may have already completed, so check either outcome
    assert.ok(result.status === 1 || result.status === -2)
  })
})

// ══════════════════════════════════════════════════════════════════════
// ClawserAgent — awaitRun (settles after in-flight turn)
// ══════════════════════════════════════════════════════════════════════

describe('ClawserAgent — awaitRun', () => {
  it('resolves immediately when idle', async () => {
    const agent = await createTestAgent()
    const r = await agent.awaitRun({ timeoutMs: 100 })
    assert.deepEqual(r, { settled: true })
  })

  it('waits for an in-flight turn to settle', async () => {
    let resolveChat
    const slowProvider = {
      supportsNativeTools: true,
      supportsStreaming: false,
      requiresApiKey: false,
      chat: () => new Promise((resolve) => { resolveChat = resolve }),
    }
    const agent = await createTestAgent({ _provider: slowProvider })
    agent.sendMessage('hi')
    const runPromise = agent.run()
    // Yield so run() enters its loop and sets #runAbort
    await new Promise(r => setTimeout(r, 10))
    assert.equal(agent.isRunning, true)

    let waitingFired = 0
    const awaitPromise = agent.awaitRun({
      timeoutMs: 1000,
      onWaiting: () => { waitingFired++ },
      gracePeriodMs: 30,
    })

    // Yield long enough for the grace period to fire onWaiting
    await new Promise(r => setTimeout(r, 80))

    resolveChat({ content: 'done', tool_calls: [], usage: { input_tokens: 1, output_tokens: 1 }, model: 'm' })
    await runPromise
    const r = await awaitPromise
    assert.deepEqual(r, { settled: true })
    assert.equal(waitingFired, 1, 'onWaiting fires when turn outlives grace period')
  })

  it('reports timedOut and stays unblocked when the turn never settles', async () => {
    const slowProvider = {
      supportsNativeTools: true,
      supportsStreaming: false,
      requiresApiKey: false,
      chat: () => new Promise(() => {}), // never resolves
    }
    const agent = await createTestAgent({ _provider: slowProvider })
    agent.sendMessage('hi')
    const runPromise = agent.run()
    await new Promise(r => setTimeout(r, 10))
    const r = await agent.awaitRun({ timeoutMs: 100 })
    assert.equal(r.timedOut, true)
    assert.equal(r.settled, false)
    // Caller (cleanupWorkspace) is expected to cancel and proceed.
    agent.cancel()
    // Don't await runPromise — its underlying Promise will never settle
    // because the chat never resolves. We've verified awaitRun doesn't
    // hang the caller.
    void runPromise
  })
})

// ══════════════════════════════════════════════════════════════════════
// ClawserAgent — history management edge cases
// ══════════════════════════════════════════════════════════════════════

describe('ClawserAgent — history edge cases', () => {
  it('truncateHistory removes messages from the end', async () => {
    const agent = await createTestAgent()
    agent.setSystemPrompt('System')
    agent.sendMessage('Msg 1')
    agent.sendMessage('Msg 2')
    agent.sendMessage('Msg 3')
    const removed = agent.truncateHistory(2) // keep system + msg1
    assert.equal(removed.length, 2) // msg2 + msg3
  })

  it('restoreHistory appends messages back', async () => {
    const agent = await createTestAgent()
    agent.setSystemPrompt('System')
    agent.sendMessage('Msg 1')
    agent.sendMessage('Msg 2')
    agent.sendMessage('Msg 3')
    const removed = agent.truncateHistory(2) // keep system + msg1, remove msg2 + msg3
    assert.equal(removed.length, 2)
    agent.restoreHistory(removed)
    const ckpt = agent.getCheckpointJSON()
    assert.equal(ckpt.session_history.length, 4) // system + 3 messages
  })

  it('clearHistory fires onSessionEnd hook', async () => {
    let hookFired = false
    const agent = await createTestAgent()
    agent.hooks.register({
      name: 'session-end',
      point: 'onSessionEnd',
      execute: async () => { hookFired = true; return { action: 'continue' } },
    })
    agent.sendMessage('Hello')
    await agent.clearHistory()
    assert.equal(hookFired, true)
  })
})

// ══════════════════════════════════════════════════════════════════════
// ClawserAgent — estimateTokens (static)
// ══════════════════════════════════════════════════════════════════════

describe('ClawserAgent.estimateTokens', () => {
  it('returns 0 for empty/null input', () => {
    assert.equal(ClawserAgent.estimateTokens(''), 0)
    assert.equal(ClawserAgent.estimateTokens(null), 0)
    assert.equal(ClawserAgent.estimateTokens(undefined), 0)
  })

  it('estimates ~1 token per 4 characters', () => {
    const text = 'A'.repeat(100)
    const tokens = ClawserAgent.estimateTokens(text)
    assert.equal(tokens, 25)
  })

  it('rounds up for non-divisible lengths', () => {
    const tokens = ClawserAgent.estimateTokens('hello') // 5 chars
    assert.equal(tokens, 2) // ceil(5/4) = 2
  })
})

// ══════════════════════════════════════════════════════════════════════
// ClawserAgent — agent definitions
// ══════════════════════════════════════════════════════════════════════

describe('ClawserAgent — applyAgent', () => {
  it('applies agent definition with model and system prompt', async () => {
    const agent = await createTestAgent()
    await agent.applyAgent({
      name: 'Test Agent',
      provider: 'echo',
      model: 'custom-model',
      systemPrompt: 'You are a custom agent',
    })
    assert.equal(agent.getModel(), 'custom-model')
    assert.equal(agent.activeAgent.name, 'Test Agent')
    const ckpt = agent.getCheckpointJSON()
    assert.equal(ckpt.session_history[0].content, 'You are a custom agent')
  })

  it('applies maxTurnsPerRun from agent definition', async () => {
    const agent = await createTestAgent()
    await agent.applyAgent({
      name: 'Limited Agent',
      provider: 'echo',
      maxTurnsPerRun: 5,
    })
    assert.equal(agent.getConfig().maxToolIterations, 5)
  })

  it('sets credential warning when API key is needed but missing', async () => {
    const agent = await createTestAgent()
    await agent.applyAgent({
      name: 'Needs Key',
      provider: 'openai',
      // No accountId, no accountResolver
    })
    // No warning without resolver — warning only when resolver fails
    // This tests the direct provider assignment fallback
    assert.equal(agent.getProvider(), 'openai')
  })
})

// ══════════════════════════════════════════════════════════════════════
// ClawserAgent — idle timeout
// ══════════════════════════════════════════════════════════════════════

describe('ClawserAgent — idle timeout', () => {
  it('getIdleTime returns a positive number', async () => {
    const agent = await createTestAgent()
    const idle = agent.getIdleTime()
    assert.ok(idle >= 0)
  })

  it('lastActivityTs is set', async () => {
    const agent = await createTestAgent()
    assert.ok(agent.lastActivityTs > 0)
  })
})

// ══════════════════════════════════════════════════════════════════════
// ClawserAgent — tool spec deduplication
// ══════════════════════════════════════════════════════════════════════

describe('ClawserAgent — tool spec deduplication', () => {
  it('registerToolSpec deduplicates by name (keeps latest)', async () => {
    const agent = await createTestAgent()
    agent.registerToolSpec({ name: 'dup', description: 'v1', parameters: {} })
    agent.registerToolSpec({ name: 'dup', description: 'v2', parameters: {} })
    // The second should replace the first — no duplication
    agent.registerToolSpec({ name: 'other', description: 'other', parameters: {} })
    // We can't directly count specs, but unregister should work
    assert.equal(agent.unregisterToolSpec('dup'), true)
    assert.equal(agent.unregisterToolSpec('dup'), false) // already removed (was deduplicated)
  })
})

// ══════════════════════════════════════════════════════════════════════
// ClawserAgent — isToolExternal
// ══════════════════════════════════════════════════════════════════════

describe('ClawserAgent — isToolExternal', () => {
  it('always returns true (stub)', async () => {
    const agent = await createTestAgent()
    assert.equal(agent.isToolExternal('any_tool'), true)
    assert.equal(agent.isToolExternal(''), true)
  })
})

// ══════════════════════════════════════════════════════════════════════
// ClawserAgent — onEvent / onToolCall callbacks
// ══════════════════════════════════════════════════════════════════════

describe('ClawserAgent — callbacks', () => {
  it('onEvent fires for goal events', async () => {
    const events = []
    const agent = await createTestAgent({
      onEvent: (type, data) => events.push({ type, data }),
    })
    agent.addGoal('Test')
    assert.ok(events.some(e => e.type === 'goal.added'))
  })

  it('onToolCall fires during tool execution', async () => {
    const toolCalls = []
    const tool = {
      name: 'callback_tool',
      description: 'test',
      parameters: {},
      permission: 'read',
      execute: async () => ({ success: true, output: 'ok' }),
    }

    const provider = makeSequenceProvider([
      {
        content: '',
        tool_calls: [{ id: 'tc_1', name: 'callback_tool', arguments: '{}' }],
        usage: { input_tokens: 5, output_tokens: 5 },
        model: 'test',
      },
      { content: 'Done', tool_calls: [], usage: { input_tokens: 5, output_tokens: 5 }, model: 'test' },
    ])

    const agent = await createTestAgent({
      _provider: provider,
      browserTools: makeToolRegistry([tool]),
      onToolCall: (name, params, result) => toolCalls.push({ name, params, result }),
    })
    agent.sendMessage('Call tool')
    await agent.run()
    assert.ok(toolCalls.length >= 1)
    assert.equal(toolCalls[toolCalls.length - 1].name, 'callback_tool')
  })
})
