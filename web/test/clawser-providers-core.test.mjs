// Tests for clawser-providers.js — provider system core
// Covers: Echo provider, provider interface, cost estimation, MODEL_PRICING,
// provider construction, readSSE/readAnthropicSSE parsing
import { describe, it, beforeEach } from 'node:test'
import assert from 'node:assert/strict'

// Lazy module ref — resolved once
let mod
async function getMod() {
  if (!mod) mod = await import('../clawser-providers.js')
  return mod
}

// Helper: create a fake ReadableStream from SSE text
function fakeSSEResponse(text) {
  const encoder = new TextEncoder()
  let sent = false
  return {
    body: {
      getReader() {
        return {
          async read() {
            if (!sent) {
              sent = true
              return { done: false, value: encoder.encode(text) }
            }
            return { done: true, value: undefined }
          },
          releaseLock() {},
        }
      },
    },
  }
}

// ── 1. Echo provider (5 tests) ──────────────────────────────────

describe('EchoProvider', () => {
  let EchoProvider

  beforeEach(async () => {
    EchoProvider = (await getMod()).EchoProvider
  })

  it('chat() echoes the last user message', async () => {
    const echo = new EchoProvider()
    const res = await echo.chat({
      messages: [
        { role: 'system', content: 'sys' },
        { role: 'user', content: 'ping' },
      ],
    })
    assert.ok(res.content.includes('ping'))
    assert.equal(res.model, 'echo')
  })

  it('chat() picks the last user message when there are multiple', async () => {
    const echo = new EchoProvider()
    const res = await echo.chat({
      messages: [
        { role: 'user', content: 'first' },
        { role: 'assistant', content: 'ack' },
        { role: 'user', content: 'second' },
      ],
    })
    assert.ok(res.content.includes('second'))
    assert.ok(!res.content.includes('first'))
  })

  it('chat() returns fallback when no user message exists', async () => {
    const echo = new EchoProvider()
    const res = await echo.chat({ messages: [] })
    assert.ok(res.content.includes('No user message'))
    assert.equal(res.model, 'echo')
  })

  it('chat() returns a valid ChatResponse shape', async () => {
    const echo = new EchoProvider()
    const res = await echo.chat({ messages: [{ role: 'user', content: 'hi' }] })
    assert.equal(typeof res.content, 'string')
    assert.ok(Array.isArray(res.tool_calls))
    assert.equal(typeof res.usage.input_tokens, 'number')
    assert.equal(typeof res.usage.output_tokens, 'number')
    assert.equal(typeof res.model, 'string')
  })

  it('chatStream() yields text then done via base class fallback', async () => {
    const echo = new EchoProvider()
    const chunks = []
    for await (const chunk of echo.chatStream({ messages: [{ role: 'user', content: 'stream me' }] })) {
      chunks.push(chunk)
    }
    assert.ok(chunks.length >= 2)
    assert.equal(chunks[0].type, 'text')
    assert.ok(chunks[0].text.includes('stream me'))
    assert.equal(chunks[chunks.length - 1].type, 'done')
    assert.ok(chunks[chunks.length - 1].response)
  })
})

// ── 2. Provider interface / LLMProvider base class (3 tests) ────

describe('LLMProvider base class', () => {
  let LLMProvider

  beforeEach(async () => {
    LLMProvider = (await getMod()).LLMProvider
  })

  it('supportsStreaming defaults to false', () => {
    // Subclass that just provides a name
    class Stub extends LLMProvider { get name() { return 'stub' } }
    const p = new Stub()
    assert.equal(p.supportsStreaming, false)
    assert.equal(p.supportsNativeTools, false)
    assert.equal(p.supportsVision, false)
  })

  it('requiresApiKey defaults to false', () => {
    class Stub extends LLMProvider { get name() { return 'stub' } }
    assert.equal(new Stub().requiresApiKey, false)
  })

  it('chat() throws if not overridden', async () => {
    class Stub extends LLMProvider { get name() { return 'stub' } }
    await assert.rejects(() => new Stub().chat({}), /implement chat/)
  })
})

// ── 3. Cost estimation (4 tests) ────────────────────────────────

describe('estimateCost', () => {
  let estimateCost

  beforeEach(async () => {
    estimateCost = (await getMod()).estimateCost
  })

  it('returns 0 for null usage', () => {
    assert.equal(estimateCost('gpt-4o', null), 0)
  })

  it('returns 0 for unknown model', () => {
    assert.equal(estimateCost('imaginary-model', { input_tokens: 1000, output_tokens: 500 }), 0)
  })

  it('calculates cost for gpt-4o correctly', () => {
    const cost = estimateCost('gpt-4o', { input_tokens: 1000, output_tokens: 500 })
    // input: 1000/1000 * 0.0025 = 0.0025, output: 500/1000 * 0.010 = 0.005
    assert.ok(Math.abs(cost - 0.0075) < 0.0001)
  })

  it('cached input tokens reduce cost vs regular', () => {
    const regularCost = estimateCost('gpt-4o', { input_tokens: 1000, output_tokens: 0 })
    const cachedCost = estimateCost('gpt-4o', {
      input_tokens: 1000,
      output_tokens: 0,
      cache_read_input_tokens: 800,
    })
    assert.ok(cachedCost > 0)
    assert.ok(cachedCost < regularCost, 'cached cost should be less than regular cost')
  })
})

// ── 4. MODEL_PRICING (3 tests) ──────────────────────────────────

describe('MODEL_PRICING', () => {
  let MODEL_PRICING

  beforeEach(async () => {
    MODEL_PRICING = (await getMod()).MODEL_PRICING
  })

  it('contains entries for major OpenAI models', () => {
    assert.ok(MODEL_PRICING['gpt-4o'])
    assert.ok(MODEL_PRICING['gpt-4o-mini'])
    assert.ok(MODEL_PRICING['gpt-4.1'])
  })

  it('contains entries for Anthropic models', () => {
    assert.ok(MODEL_PRICING['claude-sonnet-4-6'])
    assert.ok(MODEL_PRICING['claude-opus-4-6'])
  })

  it('free models have zero pricing', () => {
    assert.equal(MODEL_PRICING['echo'].input, 0)
    assert.equal(MODEL_PRICING['echo'].output, 0)
    assert.equal(MODEL_PRICING['chrome-ai'].input, 0)
    assert.equal(MODEL_PRICING['chrome-ai'].output, 0)
  })
})

// ── 5. Provider construction (3 tests) ──────────────────────────

describe('Provider construction', () => {
  it('OpenAIProvider can be constructed with default model', async () => {
    const { OpenAIProvider } = await getMod()
    const p = new OpenAIProvider()
    assert.equal(p.name, 'openai')
    assert.equal(p.requiresApiKey, true)
    assert.equal(p.supportsStreaming, true)
    assert.equal(p.supportsNativeTools, true)
    assert.ok(p.displayName.includes('gpt-4o-mini'))
  })

  it('AnthropicProvider can be constructed with default model', async () => {
    const { AnthropicProvider } = await getMod()
    const p = new AnthropicProvider()
    assert.equal(p.name, 'anthropic')
    assert.equal(p.requiresApiKey, true)
    assert.equal(p.supportsStreaming, true)
    assert.equal(p.supportsNativeTools, true)
    assert.ok(p.displayName.includes('claude'))
  })

  it('OpenAIProvider accepts custom model name', async () => {
    const { OpenAIProvider } = await getMod()
    const p = new OpenAIProvider('gpt-4.1')
    assert.ok(p.displayName.includes('gpt-4.1'))
  })
})

// ── 6. readSSE parsing (4 tests) ────────────────────────────────

describe('readSSE', () => {
  let readSSE

  beforeEach(async () => {
    readSSE = (await getMod()).readSSE
  })

  it('parses a single SSE data line', async () => {
    const resp = fakeSSEResponse('data: {"choices":[{"delta":{"content":"hi"}}]}\n\n')
    const chunks = []
    for await (const chunk of readSSE(resp)) {
      chunks.push(chunk)
    }
    assert.ok(chunks.length >= 1)
    assert.deepEqual(chunks[0].data.choices[0].delta.content, 'hi')
  })

  it('handles [DONE] sentinel', async () => {
    const resp = fakeSSEResponse('data: {"choices":[]}\ndata: [DONE]\n')
    const chunks = []
    for await (const chunk of readSSE(resp)) {
      chunks.push(chunk)
    }
    const doneChunk = chunks.find(c => c.done)
    assert.ok(doneChunk, 'should yield a done chunk')
  })

  it('skips lines that are not data: prefixed', async () => {
    const resp = fakeSSEResponse('event: message\ndata: {"ok":true}\ncomment line\n\n')
    const chunks = []
    for await (const chunk of readSSE(resp)) {
      chunks.push(chunk)
    }
    // Only the data: line should produce output
    const dataChunks = chunks.filter(c => c.data)
    assert.equal(dataChunks.length, 1)
    assert.equal(dataChunks[0].data.ok, true)
  })

  it('handles multiple data lines in one read', async () => {
    const resp = fakeSSEResponse('data: {"n":1}\ndata: {"n":2}\ndata: [DONE]\n')
    const chunks = []
    for await (const chunk of readSSE(resp)) {
      chunks.push(chunk)
    }
    const dataChunks = chunks.filter(c => c.data)
    assert.equal(dataChunks.length, 2)
    assert.equal(dataChunks[0].data.n, 1)
    assert.equal(dataChunks[1].data.n, 2)
  })
})

// ── 7. readAnthropicSSE parsing (2 tests) ───────────────────────

describe('readAnthropicSSE', () => {
  let readAnthropicSSE

  beforeEach(async () => {
    readAnthropicSSE = (await getMod()).readAnthropicSSE
  })

  it('parses event+data pairs', async () => {
    const sse = 'event: content_block_delta\ndata: {"type":"content_block_delta","delta":{"text":"hello"}}\n\n'
    const resp = fakeSSEResponse(sse)
    const chunks = []
    for await (const chunk of readAnthropicSSE(resp)) {
      chunks.push(chunk)
    }
    assert.equal(chunks.length, 1)
    assert.equal(chunks[0].event, 'content_block_delta')
    assert.equal(chunks[0].data.delta.text, 'hello')
  })

  it('skips blocks without both event and data', async () => {
    const sse = 'event: ping\n\nevent: content_block_delta\ndata: {"ok":true}\n\n'
    const resp = fakeSSEResponse(sse)
    const chunks = []
    for await (const chunk of readAnthropicSSE(resp)) {
      chunks.push(chunk)
    }
    // "ping" has no data, so only the second block should appear
    assert.equal(chunks.length, 1)
    assert.equal(chunks[0].event, 'content_block_delta')
  })
})

// ── 8. validateChatResponse (2 tests) ───────────────────────────

describe('validateChatResponse', () => {
  let validateChatResponse

  beforeEach(async () => {
    validateChatResponse = (await getMod()).validateChatResponse
  })

  it('fills defaults for empty input', () => {
    const result = validateChatResponse({})
    assert.equal(result.content, '')
    assert.deepEqual(result.tool_calls, [])
    assert.equal(result.usage.input_tokens, 0)
    assert.equal(result.model, 'unknown')
  })

  it('normalizes malformed tool_calls entries', () => {
    const result = validateChatResponse({
      content: 'Hi',
      tool_calls: [null, { name: 123 }, { id: 'ok', name: 'test', arguments: '{}' }],
      model: 'm',
    })
    assert.equal(result.tool_calls.length, 3)
    assert.equal(result.tool_calls[0].name, '')
    assert.equal(result.tool_calls[0].arguments, '{}')
    assert.equal(result.tool_calls[2].name, 'test')
  })
})

// ── 9. classifyError (2 tests) ──────────────────────────────────

describe('classifyError', () => {
  let classifyError

  beforeEach(async () => {
    classifyError = (await getMod()).classifyError
  })

  it('classifies rate limit as retryable, auth as not', () => {
    assert.equal(classifyError('429 too many requests').category, 'rate_limit')
    assert.equal(classifyError('429 too many requests').retryable, true)
    assert.equal(classifyError('401 Unauthorized').category, 'auth')
    assert.equal(classifyError('401 Unauthorized').retryable, false)
  })

  it('classifies server errors as retryable', () => {
    assert.equal(classifyError('500 Internal Server Error').category, 'server')
    assert.equal(classifyError('500 Internal Server Error').retryable, true)
  })
})
