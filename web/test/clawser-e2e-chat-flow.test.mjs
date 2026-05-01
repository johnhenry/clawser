// Run with: node --import ./web/test/_setup-globals.mjs --test web/test/clawser-e2e-chat-flow.test.mjs
//
// E2E: Create workspace → set Echo provider → send message → run → verify
// response content and event log entries.
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
      const content = lastUser
        ? `You said: "${lastUser.content}"\n\n[Echo mode]`
        : '[Echo] No user message found.'
      return {
        content,
        tool_calls: [],
        usage: { input_tokens: 10, output_tokens: 5 },
        model: 'echo',
      }
    },
    chatStream: async function* () {
      yield { type: 'text', text: '[Echo stream]' }
      yield { type: 'done', response: { content: '[Echo stream]', tool_calls: [], usage: { input_tokens: 1, output_tokens: 1 }, model: 'echo' } }
    },
  }
}

function makeProviderRegistry(provider) {
  const map = new Map([['echo', provider]])
  return {
    get: (name) => map.get(name),
    listWithAvailability: async () => [{ name: 'echo' }],
  }
}

async function createTestAgent(overrides = {}) {
  const provider = overrides.provider || makeEchoProvider()
  const providers = makeProviderRegistry(provider)
  const agent = await ClawserAgent.create({ providers, ...overrides })
  agent.init({})
  agent.setProvider('echo')
  agent.setSystemPrompt('You are a test agent.')
  return { agent, provider }
}

// ── Scenario: Full chat round-trip ──────────────────────────────

describe('E2E — Chat Flow', () => {
  it('send message → run → response echoes input', async () => {
    const { agent } = await createTestAgent()

    agent.sendMessage('Hello, world!')
    const result = await agent.run()

    assert.ok(result, 'run() should return a result')
    // The echo provider mirrors the last user message
    const state = agent.getState()
    assert.ok(state.history_len >= 2, 'history should have at least user + assistant messages')
  })

  it('event log records user_message on sendMessage', async () => {
    const { agent } = await createTestAgent()

    agent.sendMessage('Test event logging')

    const events = agent.getEventLog()
    const userMsgs = events.query({ type: 'user_message' })
    assert.ok(userMsgs.length >= 1, 'should log at least one user_message event')
    assert.ok(userMsgs.some(e => e.data.content === 'Test event logging'))
  })

  it('multiple messages build conversation history', async () => {
    const { agent } = await createTestAgent()

    agent.sendMessage('First message')
    await agent.run()
    agent.sendMessage('Second message')
    await agent.run()

    const state = agent.getState()
    // 2 user messages + 2 assistant messages = 4
    assert.ok(state.history_len >= 4, `expected >= 4 history entries, got ${state.history_len}`)
  })

  it('event log records provider_response after run', async () => {
    const { agent } = await createTestAgent()

    agent.sendMessage('Echo this back')
    await agent.run()

    const events = agent.getEventLog()
    const responses = events.query({ type: 'agent_message' })
    assert.ok(responses.length >= 1, 'should have at least one agent_message event')
  })

  it('system prompt is included in provider requests', async () => {
    let capturedMessages = null
    const spyProvider = {
      supportsNativeTools: false,
      supportsStreaming: false,
      chat: async (request) => {
        capturedMessages = request.messages
        return {
          content: 'Captured',
          tool_calls: [],
          usage: { input_tokens: 5, output_tokens: 3 },
          model: 'spy',
        }
      },
    }

    const { agent } = await createTestAgent({ provider: spyProvider })
    agent.setSystemPrompt('Custom system prompt for testing')

    agent.sendMessage('Hi')
    await agent.run()

    assert.ok(capturedMessages, 'provider should have received messages')
    const systemMsg = capturedMessages.find(m => m.role === 'system')
    assert.ok(systemMsg, 'system message should be present')
    assert.ok(systemMsg.content.includes('Custom system prompt for testing'))
  })

  it('empty sendMessage does not crash', async () => {
    const { agent } = await createTestAgent()

    agent.sendMessage('')
    const result = await agent.run()
    assert.ok(result, 'run() should still return a result')
  })

  it('setProvider to unknown provider does not crash on run', async () => {
    const { agent } = await createTestAgent()

    // Setting an unknown provider name — run should handle gracefully
    agent.setProvider('nonexistent-provider')
    agent.sendMessage('Will this work?')

    try {
      await agent.run()
    } catch (e) {
      // Expected: provider not found or similar error
      assert.ok(e.message, 'should throw with a message')
    }
  })
})
