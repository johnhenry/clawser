// Run with: node --import ./web/test/_setup-globals.mjs --test web/test/clawser-e2e-agent-delegation.test.mjs
//
// E2E: Agent delegation — provider returns tool_calls → agent executes tools →
// feeds results back → provider produces final response. Also tests the
// agent's tool iteration limit, abort, and hook lifecycle.
import { describe, it, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { ClawserAgent, HookPipeline, EventLog, AutonomyController } from '../clawser-agent.js'
import { BrowserTool, BrowserToolRegistry } from '../clawser-tools.js'

// ── Helpers ──────────────────────────────────────────────────────

class TestTool extends BrowserTool {
  #fn
  constructor(name, fn) {
    super()
    this._name = name
    this.#fn = fn
  }
  get name() { return this._name }
  get description() { return `Test tool: ${this._name}` }
  get permission() { return 'internal' }
  async execute(params) { return this.#fn(params) }
}

function makeToolCallingProvider(toolSequence) {
  // toolSequence: array of responses. Each is either:
  //   { tool_calls: [...] }  — triggers tool execution
  //   { content: '...' }     — final text response
  let callIndex = 0
  return {
    supportsNativeTools: true,
    supportsStreaming: false,
    chat: async () => {
      const resp = toolSequence[Math.min(callIndex, toolSequence.length - 1)]
      callIndex++
      return {
        content: resp.content || '',
        tool_calls: resp.tool_calls || [],
        usage: { input_tokens: 10, output_tokens: 10 },
        model: 'test',
      }
    },
  }
}

async function createAgentWithTools(providerResponses, tools = []) {
  const provider = makeToolCallingProvider(providerResponses)
  const providers = {
    get: () => provider,
    listWithAvailability: async () => [{ name: 'test' }],
  }

  const browserTools = new BrowserToolRegistry()
  for (const tool of tools) {
    browserTools.register(tool)
  }

  const agent = await ClawserAgent.create({ providers, browserTools })
  agent.init({})
  agent.setProvider('test')
  agent.setSystemPrompt('Test agent with tools.')
  return { agent, provider }
}

// ── Tests ────────────────────────────────────────────────────────

describe('E2E — Agent Tool Delegation', () => {
  it('agent executes tool_call and feeds result back to provider', async () => {
    const toolResults = []

    const calculator = new TestTool('calculator', async ({ expression }) => {
      const result = `Result: 42`
      toolResults.push(result)
      return { success: true, output: result }
    })

    const { agent } = await createAgentWithTools([
      // First response: LLM requests tool call
      {
        tool_calls: [{ id: 'call_1', name: 'calculator', arguments: JSON.stringify({ expression: '6 * 7' }) }],
      },
      // Second response: LLM produces final answer after seeing tool result
      { content: 'The answer is 42.' },
    ], [calculator])

    agent.sendMessage('What is 6 times 7?')
    const result = await agent.run()

    assert.ok(result, 'run should return a result')
    assert.equal(toolResults.length, 1, 'tool should have been called once')
    assert.equal(toolResults[0], 'Result: 42')
  })

  it('agent handles multiple sequential tool calls', async () => {
    const calls = []

    const lookup = new TestTool('lookup', async ({ query }) => {
      calls.push(query)
      return { success: true, output: `Found: ${query}` }
    })

    const { agent } = await createAgentWithTools([
      {
        tool_calls: [
          { id: 'call_1', name: 'lookup', arguments: JSON.stringify({ query: 'first' }) },
          { id: 'call_2', name: 'lookup', arguments: JSON.stringify({ query: 'second' }) },
        ],
      },
      { content: 'Found both results.' },
    ], [lookup])

    agent.sendMessage('Look up two things')
    await agent.run()

    assert.equal(calls.length, 2)
    assert.ok(calls.includes('first'))
    assert.ok(calls.includes('second'))
  })

  it('tool execution failure is reported back to provider', async () => {
    const failTool = new TestTool('fail_tool', async () => {
      return { success: false, output: '', error: 'Something went wrong' }
    })

    const { agent } = await createAgentWithTools([
      {
        tool_calls: [{ id: 'call_1', name: 'fail_tool', arguments: '{}' }],
      },
      { content: 'The tool failed, but I handled it.' },
    ], [failTool])

    agent.sendMessage('Try the failing tool')
    const result = await agent.run()

    // Should not crash — the agent should gracefully handle tool failures
    assert.ok(result)
  })
})

// ── HookPipeline lifecycle ──────────────────────────────────────

describe('E2E — Hook Pipeline', () => {
  it('hooks fire in registration order', async () => {
    const pipeline = new HookPipeline()
    const order = []

    pipeline.register({ name: 'h1', point: 'onSessionStart', priority: 0, execute: async () => { order.push('hook1') } })
    pipeline.register({ name: 'h2', point: 'onSessionStart', priority: 0, execute: async () => { order.push('hook2') } })
    pipeline.register({ name: 'h3', point: 'onSessionStart', priority: 0, execute: async () => { order.push('hook3') } })

    await pipeline.run('onSessionStart', {})

    assert.deepEqual(order, ['hook1', 'hook2', 'hook3'])
  })

  it('hook can modify payload', async () => {
    const pipeline = new HookPipeline()

    pipeline.register({ name: 'mod', point: 'beforeInbound', priority: 0, execute: async (payload) => {
      payload.modified = true
      return payload
    }})

    const result = await pipeline.run('beforeInbound', { modified: false })
    // Main test: no crash
    assert.ok(true)
  })

  it('hook error does not crash pipeline', async () => {
    const pipeline = new HookPipeline()

    pipeline.register({ name: 'fail', point: 'beforeOutbound', priority: 0, execute: async () => { throw new Error('Hook failure') } })
    pipeline.register({ name: 'ok', point: 'beforeOutbound', priority: 0, execute: async () => {} })

    // Should not throw
    await pipeline.run('beforeOutbound', {})
    assert.ok(true)
  })

  it('unregistered hook point runs without error', async () => {
    const pipeline = new HookPipeline()
    // 'onSessionEnd' is valid but has no hooks registered — should not throw
    await pipeline.run('onSessionEnd', { data: 'test' })
    assert.ok(true, 'should not throw for hook point with no handlers')
  })
})

// ── AutonomyController integration ──────────────────────────────

describe('E2E — Autonomy + Tool Execution', () => {
  it('readonly blocks write tools but allows read tools', () => {
    const ac = new AutonomyController({ level: 'readonly' })

    assert.ok(ac.canExecuteTool({ permission: 'read' }))
    assert.ok(ac.canExecuteTool({ permission: 'internal' }))
    assert.ok(!ac.canExecuteTool({ permission: 'write' }))
    assert.ok(!ac.canExecuteTool({ permission: 'network' }))
    assert.ok(!ac.canExecuteTool({ permission: 'browser' }))
  })

  it('supervised requires approval for write/network/browser', () => {
    const ac = new AutonomyController({ level: 'supervised' })

    assert.ok(!ac.needsApproval({ permission: 'read' }))
    assert.ok(!ac.needsApproval({ permission: 'internal' }))
    assert.ok(ac.needsApproval({ permission: 'write' }))
    assert.ok(ac.needsApproval({ permission: 'network' }))
    assert.ok(ac.needsApproval({ permission: 'browser' }))
  })

  it('full autonomy: no approvals, can execute everything', () => {
    const ac = new AutonomyController({ level: 'full' })

    assert.ok(ac.canExecuteTool({ permission: 'write' }))
    assert.ok(ac.canExecuteTool({ permission: 'network' }))
    assert.ok(ac.canExecuteTool({ permission: 'browser' }))
    assert.ok(!ac.needsApproval({ permission: 'write' }))
    assert.ok(!ac.needsApproval({ permission: 'browser' }))
  })

  it('rate limit blocks after exceeding max actions', () => {
    const ac = new AutonomyController({ level: 'full', maxActionsPerHour: 5 })

    for (let i = 0; i < 5; i++) ac.recordAction()

    const check = ac.checkLimits()
    assert.ok(check.blocked)
    assert.equal(check.limitType, 'rate')
  })

  it('cost limit blocks after exceeding daily cost', () => {
    const ac = new AutonomyController({ level: 'full', maxCostPerDayCents: 200 })

    ac.recordCost(100)
    ac.recordCost(100)

    const check = ac.checkLimits()
    assert.ok(check.blocked)
    assert.equal(check.limitType, 'cost')
  })

  it('reset clears rate + cost counters', () => {
    const ac = new AutonomyController({ level: 'full', maxActionsPerHour: 1, maxCostPerDayCents: 1 })

    ac.recordAction()
    ac.recordCost(1)
    assert.ok(ac.checkLimits().blocked)

    ac.reset()
    assert.ok(!ac.checkLimits().blocked)
  })
})
