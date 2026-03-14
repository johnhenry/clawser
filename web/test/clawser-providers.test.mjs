// Tests for clawser-providers.js — deeper coverage beyond providers-core
// Focus: EchoProvider behavior, classifyError edge cases, estimateCost details,
// validateChatResponse edge cases, ResponseCache set/get/TTL/eviction,
// ProviderRegistry advanced, LLMProvider base class, SSE readers
import { describe, it, beforeEach, afterEach, mock } from 'node:test'
import assert from 'node:assert/strict'

// Lazy module ref — resolved once
let mod
async function getMod() {
  if (!mod) mod = await import('../clawser-providers.js')
  return mod
}

// ── 1. EchoProvider (8 tests) ────────────────────────────────────

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

  it('chat() echoes last user even with multiple user messages', async () => {
    const echo = new EchoProvider()
    const res = await echo.chat({
      messages: [
        { role: 'user', content: 'first' },
        { role: 'assistant', content: 'response' },
        { role: 'user', content: 'second' },
      ],
    })
    assert.ok(res.content.includes('second'))
    assert.ok(!res.content.includes('first'))
  })

  it('chat() handles empty messages array', async () => {
    const echo = new EchoProvider()
    const res = await echo.chat({ messages: [] })
    assert.ok(res.content.includes('No user message'))
    assert.equal(res.model, 'echo')
  })

  it('chat() handles missing messages property', async () => {
    const echo = new EchoProvider()
    const res = await echo.chat({})
    assert.ok(res.content.includes('No user message'))
  })

  it('chat() returns valid ChatResponse shape', async () => {
    const echo = new EchoProvider()
    const res = await echo.chat({ messages: [{ role: 'user', content: 'hi' }] })
    assert.equal(typeof res.content, 'string')
    assert.ok(Array.isArray(res.tool_calls))
    assert.equal(res.tool_calls.length, 0)
    assert.equal(typeof res.usage.input_tokens, 'number')
    assert.equal(typeof res.usage.output_tokens, 'number')
    assert.equal(res.model, 'echo')
  })

  it('name is "echo"', () => {
    assert.equal(new EchoProvider().name, 'echo')
  })

  it('displayName is descriptive', () => {
    const echo = new EchoProvider()
    assert.ok(echo.displayName.length > 0)
    assert.ok(echo.displayName.toLowerCase().includes('echo'))
  })

  it('isAvailable() returns true', async () => {
    assert.equal(await new EchoProvider().isAvailable(), true)
  })
})

// ── 2. LLMProvider base class (6 tests) ─────────────────────────

describe('LLMProvider base class', () => {
  let LLMProvider

  beforeEach(async () => {
    LLMProvider = (await getMod()).LLMProvider
  })

  it('name getter throws (must be overridden)', () => {
    assert.throws(() => new LLMProvider().name, /implement/)
  })

  it('chat() throws (must be overridden)', async () => {
    await assert.rejects(() => new LLMProvider().chat({}), /implement/)
  })

  it('supportsStreaming defaults to false', () => {
    assert.equal(new LLMProvider().supportsStreaming, false)
  })

  it('supportsNativeTools defaults to false', () => {
    assert.equal(new LLMProvider().supportsNativeTools, false)
  })

  it('supportsVision defaults to false', () => {
    assert.equal(new LLMProvider().supportsVision, false)
  })

  it('requiresApiKey defaults to false', () => {
    assert.equal(new LLMProvider().requiresApiKey, false)
  })
})

// ── 3. classifyError (10 tests) ─────────────────────────────────

describe('classifyError — extended', () => {
  let classifyError

  beforeEach(async () => {
    classifyError = (await getMod()).classifyError
  })

  it('429 status → rate_limit, retryable', () => {
    const r = classifyError(new Error('HTTP 429 Too Many Requests'))
    assert.equal(r.category, 'rate_limit')
    assert.equal(r.retryable, true)
  })

  it('"rate limit" text → rate_limit', () => {
    const r = classifyError('Rate limit exceeded, please retry')
    assert.equal(r.category, 'rate_limit')
    assert.equal(r.retryable, true)
  })

  it('500 status → server, retryable', () => {
    const r = classifyError(new Error('500 Internal Server Error'))
    assert.equal(r.category, 'server')
    assert.equal(r.retryable, true)
  })

  it('502 bad gateway → server, retryable', () => {
    const r = classifyError('502 Bad Gateway')
    assert.equal(r.category, 'server')
    assert.equal(r.retryable, true)
  })

  it('503 service unavailable → server, retryable', () => {
    const r = classifyError('503 Service Unavailable')
    assert.equal(r.category, 'server')
    assert.equal(r.retryable, true)
  })

  it('401 → auth, not retryable', () => {
    const r = classifyError(new Error('401 Unauthorized'))
    assert.equal(r.category, 'auth')
    assert.equal(r.retryable, false)
  })

  it('403 → auth, not retryable', () => {
    const r = classifyError('403 Forbidden access denied')
    assert.equal(r.category, 'auth')
    assert.equal(r.retryable, false)
  })

  it('CORS → cors, not retryable', () => {
    const r = classifyError('blocked by CORS policy')
    assert.equal(r.category, 'cors')
    assert.equal(r.retryable, false)
  })

  it('network/fetch error → network, retryable', () => {
    const r = classifyError(new Error('fetch failed: ECONNREFUSED'))
    assert.equal(r.category, 'network')
    assert.equal(r.retryable, true)
  })

  it('400 bad request → client, not retryable', () => {
    const r = classifyError('400 Bad Request: invalid parameter')
    assert.equal(r.category, 'client')
    assert.equal(r.retryable, false)
  })

  it('unknown error → unknown, not retryable', () => {
    const r = classifyError('Something completely unexpected')
    assert.equal(r.category, 'unknown')
    assert.equal(r.retryable, false)
  })

  it('message is always a string', () => {
    const r = classifyError(42)
    assert.equal(typeof r.message, 'string')
  })

  it('handles null input gracefully', () => {
    const r = classifyError(null)
    assert.equal(typeof r.category, 'string')
    assert.equal(typeof r.message, 'string')
  })
})

// ── 4. estimateCost — extended (8 tests) ────────────────────────

describe('estimateCost — extended', () => {
  let estimateCost, MODEL_PRICING

  beforeEach(async () => {
    const m = await getMod()
    estimateCost = m.estimateCost
    MODEL_PRICING = m.MODEL_PRICING
  })

  it('returns 0 for null usage', () => {
    assert.equal(estimateCost('gpt-4o', null), 0)
  })

  it('returns 0 for undefined usage', () => {
    assert.equal(estimateCost('gpt-4o', undefined), 0)
  })

  it('returns 0 for unknown model', () => {
    assert.equal(estimateCost('nonexistent-model-xyz', { input_tokens: 100, output_tokens: 50 }), 0)
  })

  it('calculates gpt-4o cost correctly', () => {
    const cost = estimateCost('gpt-4o', { input_tokens: 1000, output_tokens: 500 })
    // input: 1000/1000 * 0.0025 = 0.0025, output: 500/1000 * 0.010 = 0.005
    assert.ok(Math.abs(cost - 0.0075) < 0.0001)
  })

  it('cached_input tokens get discounted rate', () => {
    const fullCost = estimateCost('gpt-4o', { input_tokens: 1000, output_tokens: 0 })
    const cachedCost = estimateCost('gpt-4o', {
      input_tokens: 1000,
      output_tokens: 0,
      cache_read_input_tokens: 1000,
    })
    // All tokens cached should be cheaper than all tokens regular
    assert.ok(cachedCost < fullCost)
  })

  it('free models return 0', () => {
    assert.equal(estimateCost('echo', { input_tokens: 99999, output_tokens: 99999 }), 0)
    assert.equal(estimateCost('chrome-ai', { input_tokens: 99999, output_tokens: 99999 }), 0)
  })

  it('handles zero tokens', () => {
    assert.equal(estimateCost('gpt-4o', { input_tokens: 0, output_tokens: 0 }), 0)
  })

  it('claude-opus-4-6 is more expensive than claude-sonnet-4-6', () => {
    const usage = { input_tokens: 1000, output_tokens: 500 }
    const opusCost = estimateCost('claude-opus-4-6', usage)
    const sonnetCost = estimateCost('claude-sonnet-4-6', usage)
    assert.ok(opusCost > sonnetCost)
  })

  it('cache_creation_input_tokens are priced at write rate', () => {
    const withWrite = estimateCost('claude-sonnet-4-6', {
      input_tokens: 1000,
      output_tokens: 0,
      cache_creation_input_tokens: 500,
    })
    const withoutWrite = estimateCost('claude-sonnet-4-6', {
      input_tokens: 1000,
      output_tokens: 0,
    })
    // cache write is 1.25x input, so mixed should be more expensive
    assert.ok(withWrite > withoutWrite)
  })
})

// ── 5. validateChatResponse — extended (7 tests) ────────────────

describe('validateChatResponse — extended', () => {
  let validateChatResponse

  beforeEach(async () => {
    validateChatResponse = (await getMod()).validateChatResponse
  })

  it('returns valid shape for complete input', () => {
    const res = validateChatResponse({
      content: 'Hello',
      tool_calls: [{ id: 't1', name: 'search', arguments: '{"q":"x"}' }],
      usage: { input_tokens: 10, output_tokens: 5 },
      model: 'gpt-4o',
    })
    assert.equal(res.content, 'Hello')
    assert.equal(res.tool_calls.length, 1)
    assert.equal(res.tool_calls[0].name, 'search')
    assert.equal(res.usage.input_tokens, 10)
    assert.equal(res.model, 'gpt-4o')
  })

  it('fills defaults for empty object', () => {
    const res = validateChatResponse({})
    assert.equal(res.content, '')
    assert.deepEqual(res.tool_calls, [])
    assert.equal(res.usage.input_tokens, 0)
    assert.equal(res.usage.output_tokens, 0)
    assert.equal(res.model, 'unknown')
  })

  it('uses fallback model when model is missing', () => {
    const res = validateChatResponse({}, 'my-model')
    assert.equal(res.model, 'my-model')
  })

  it('handles null input', () => {
    const res = validateChatResponse(null)
    assert.equal(res.content, '')
    assert.deepEqual(res.tool_calls, [])
    assert.equal(res.model, 'unknown')
  })

  it('handles undefined input', () => {
    const res = validateChatResponse(undefined)
    assert.equal(res.content, '')
    assert.deepEqual(res.tool_calls, [])
  })

  it('normalizes null tool_call entries', () => {
    const res = validateChatResponse({
      content: 'x',
      tool_calls: [null, undefined],
      model: 'test',
    })
    assert.equal(res.tool_calls.length, 2)
    assert.equal(res.tool_calls[0].name, '')
    assert.equal(res.tool_calls[0].arguments, '{}')
    assert.equal(res.tool_calls[1].name, '')
  })

  it('non-string content becomes empty string', () => {
    const res = validateChatResponse({ content: 42, model: 'm' })
    assert.equal(res.content, '')
  })
})

// ── 6. ResponseCache — set/get/TTL/eviction (12 tests) ──────────

describe('ResponseCache — behavior', () => {
  let ResponseCache

  beforeEach(async () => {
    ResponseCache = (await getMod()).ResponseCache
  })

  it('set() then get() returns the cached response', () => {
    const cache = new ResponseCache()
    const response = { content: 'hello', tool_calls: [], usage: { input_tokens: 10, output_tokens: 5 }, model: 'test' }
    cache.set('key1', response, 'test')
    const hit = cache.get('key1')
    assert.deepEqual(hit, response)
    assert.equal(cache.size, 1)
  })

  it('get() returns null for missing key', () => {
    const cache = new ResponseCache()
    assert.equal(cache.get('nonexistent'), null)
  })

  it('get() returns null when disabled', () => {
    const cache = new ResponseCache()
    const response = { content: 'x', tool_calls: [], usage: { input_tokens: 0, output_tokens: 0 }, model: 'test' }
    cache.set('k', response, 'test')
    cache.enabled = false
    assert.equal(cache.get('k'), null)
  })

  it('set() does nothing when disabled', () => {
    const cache = new ResponseCache()
    cache.enabled = false
    cache.set('k', { content: 'x', tool_calls: [], usage: {}, model: 'm' }, 'm')
    cache.enabled = true
    assert.equal(cache.get('k'), null)
    assert.equal(cache.size, 0)
  })

  it('does NOT cache responses with tool_calls', () => {
    const cache = new ResponseCache()
    const response = {
      content: 'x',
      tool_calls: [{ id: 't1', name: 'search', arguments: '{}' }],
      usage: { input_tokens: 5, output_tokens: 5 },
      model: 'test',
    }
    cache.set('k', response, 'test')
    assert.equal(cache.size, 0)
    assert.equal(cache.get('k'), null)
  })

  it('evicts oldest when maxEntries exceeded', () => {
    const cache = new ResponseCache({ maxEntries: 2 })
    const mkResp = (c) => ({ content: c, tool_calls: [], usage: { input_tokens: 1, output_tokens: 1 }, model: 'test' })
    cache.set('a', mkResp('a'), 'test')
    cache.set('b', mkResp('b'), 'test')
    cache.set('c', mkResp('c'), 'test')
    assert.equal(cache.size, 2)
    // 'a' should have been evicted (oldest)
    assert.equal(cache.get('a'), null)
    assert.ok(cache.get('b'))
    assert.ok(cache.get('c'))
  })

  it('TTL expiry: returns null after TTL elapses', () => {
    const cache = new ResponseCache({ ttlMs: 1 }) // 1ms TTL
    const response = { content: 'x', tool_calls: [], usage: { input_tokens: 0, output_tokens: 0 }, model: 'test' }
    cache.set('k', response, 'test')
    // Manually wait a tiny bit — set timestamp is already in the past by the time get runs
    // Use a sync busy-wait to exceed 1ms
    const start = Date.now()
    while (Date.now() - start < 5) { /* spin */ }
    assert.equal(cache.get('k'), null)
  })

  it('clear() resets entries and stats', () => {
    const cache = new ResponseCache()
    const response = { content: 'x', tool_calls: [], usage: { input_tokens: 10, output_tokens: 5 }, model: 'test' }
    cache.set('a', response, 'test')
    cache.set('b', response, 'test')
    cache.get('a') // register a hit
    cache.clear()
    assert.equal(cache.size, 0)
    assert.equal(cache.stats.totalHits, 0)
    assert.equal(cache.stats.totalMisses, 0)
  })

  it('delete() removes a specific entry', () => {
    const cache = new ResponseCache()
    const response = { content: 'x', tool_calls: [], usage: { input_tokens: 0, output_tokens: 0 }, model: 'test' }
    cache.set('k', response, 'test')
    assert.equal(cache.size, 1)
    cache.delete('k')
    assert.equal(cache.size, 0)
    assert.equal(cache.get('k'), null)
  })

  it('stats tracks hits and misses', () => {
    const cache = new ResponseCache()
    const response = { content: 'x', tool_calls: [], usage: { input_tokens: 10, output_tokens: 5 }, model: 'test' }
    cache.set('k', response, 'test')
    cache.get('k')        // hit
    cache.get('k')        // hit
    cache.get('missing')  // miss
    const s = cache.stats
    assert.equal(s.totalHits, 2)
    assert.equal(s.totalMisses, 1)
    assert.ok(s.hitRate > 0.6)
  })

  it('cacheKey() produces consistent keys', () => {
    const msgs = [
      { role: 'system', content: 'sys' },
      { role: 'user', content: 'hello' },
    ]
    const k1 = ResponseCache.cacheKey(msgs, 'gpt-4o')
    const k2 = ResponseCache.cacheKey(msgs, 'gpt-4o')
    assert.equal(k1, k2)
  })

  it('cacheKey() differs by model', () => {
    const msgs = [{ role: 'user', content: 'hello' }]
    const k1 = ResponseCache.cacheKey(msgs, 'gpt-4o')
    const k2 = ResponseCache.cacheKey(msgs, 'claude-sonnet-4-6')
    assert.notEqual(k1, k2)
  })
})

// ── 7. ProviderRegistry — advanced (8 tests) ────────────────────

describe('ProviderRegistry — advanced', () => {
  let ProviderRegistry, EchoProvider, LLMProvider

  beforeEach(async () => {
    const m = await getMod()
    ProviderRegistry = m.ProviderRegistry
    EchoProvider = m.EchoProvider
    LLMProvider = m.LLMProvider
  })

  it('register and get', () => {
    const reg = new ProviderRegistry()
    const echo = new EchoProvider()
    reg.register(echo)
    assert.equal(reg.get('echo'), echo)
  })

  it('get() returns null for unknown', () => {
    const reg = new ProviderRegistry()
    assert.equal(reg.get('nope'), null)
  })

  it('has() returns true for registered', () => {
    const reg = new ProviderRegistry()
    reg.register(new EchoProvider())
    assert.equal(reg.has('echo'), true)
    assert.equal(reg.has('nope'), false)
  })

  it('names() lists all registered', () => {
    const reg = new ProviderRegistry()
    reg.register(new EchoProvider())
    const names = reg.names()
    assert.ok(names.includes('echo'))
    assert.equal(names.length, 1)
  })

  it('remove() deletes and returns true', () => {
    const reg = new ProviderRegistry()
    reg.register(new EchoProvider())
    assert.equal(reg.remove('echo'), true)
    assert.equal(reg.get('echo'), null)
    assert.equal(reg.names().length, 0)
  })

  it('remove() returns false for unknown', () => {
    const reg = new ProviderRegistry()
    assert.equal(reg.remove('nope'), false)
  })

  it('register overwrites existing provider with same name', () => {
    const reg = new ProviderRegistry()
    const echo1 = new EchoProvider()
    const echo2 = new EchoProvider()
    reg.register(echo1)
    reg.register(echo2)
    assert.equal(reg.get('echo'), echo2)
    assert.equal(reg.names().length, 1)
  })

  it('getBestAvailable() returns echo when no chrome-ai', async () => {
    const reg = new ProviderRegistry()
    reg.register(new EchoProvider())
    const best = await reg.getBestAvailable()
    assert.equal(best.name, 'echo')
  })
})

// ── 8. readSSE (5 tests) ────────────────────────────────────────

describe('readSSE', () => {
  let readSSE

  beforeEach(async () => {
    readSSE = (await getMod()).readSSE
  })

  function makeSSEResponse(lines) {
    const text = lines.join('\n') + '\n'
    const encoded = new TextEncoder().encode(text)
    let consumed = false
    return {
      body: {
        getReader() {
          return {
            async read() {
              if (consumed) return { done: true, value: undefined }
              consumed = true
              return { done: false, value: encoded }
            },
            releaseLock() {},
          }
        },
      },
    }
  }

  it('parses a single data line', async () => {
    const resp = makeSSEResponse(['data: {"id":"1","choices":[]}'])
    const chunks = []
    for await (const c of readSSE(resp)) chunks.push(c)
    assert.equal(chunks.length, 1)
    assert.deepEqual(chunks[0].data, { id: '1', choices: [] })
  })

  it('handles [DONE] sentinel', async () => {
    const resp = makeSSEResponse([
      'data: {"id":"1"}',
      'data: [DONE]',
    ])
    const chunks = []
    for await (const c of readSSE(resp)) chunks.push(c)
    assert.equal(chunks.length, 2)
    assert.equal(chunks[1].done, true)
  })

  it('skips non-data lines', async () => {
    const resp = makeSSEResponse([
      ': comment',
      'data: {"id":"1"}',
      '',
    ])
    const chunks = []
    for await (const c of readSSE(resp)) chunks.push(c)
    assert.equal(chunks.length, 1)
  })

  it('skips malformed JSON gracefully', async () => {
    const resp = makeSSEResponse([
      'data: not-json',
      'data: {"valid":true}',
    ])
    const chunks = []
    for await (const c of readSSE(resp)) chunks.push(c)
    // Only the valid JSON should produce a chunk
    assert.equal(chunks.length, 1)
    assert.equal(chunks[0].data.valid, true)
  })

  it('handles empty stream', async () => {
    const resp = {
      body: {
        getReader() {
          return {
            async read() { return { done: true, value: undefined } },
            releaseLock() {},
          }
        },
      },
    }
    const chunks = []
    for await (const c of readSSE(resp)) chunks.push(c)
    assert.equal(chunks.length, 0)
  })
})

// ── 9. readAnthropicSSE (5 tests) ───────────────────────────────

describe('readAnthropicSSE', () => {
  let readAnthropicSSE

  beforeEach(async () => {
    readAnthropicSSE = (await getMod()).readAnthropicSSE
  })

  function makeSSEResponse(text) {
    const encoded = new TextEncoder().encode(text)
    let consumed = false
    return {
      body: {
        getReader() {
          return {
            async read() {
              if (consumed) return { done: true, value: undefined }
              consumed = true
              return { done: false, value: encoded }
            },
            releaseLock() {},
          }
        },
      },
    }
  }

  it('parses event + data pairs', async () => {
    const resp = makeSSEResponse(
      'event: message_start\ndata: {"type":"message_start"}\n\n'
    )
    const chunks = []
    for await (const c of readAnthropicSSE(resp)) chunks.push(c)
    assert.equal(chunks.length, 1)
    assert.equal(chunks[0].event, 'message_start')
    assert.equal(chunks[0].data.type, 'message_start')
  })

  it('parses multiple event blocks', async () => {
    const resp = makeSSEResponse(
      'event: content_block_start\ndata: {"type":"content_block_start"}\n\n' +
      'event: content_block_delta\ndata: {"type":"content_block_delta","delta":{"text":"Hi"}}\n\n'
    )
    const chunks = []
    for await (const c of readAnthropicSSE(resp)) chunks.push(c)
    assert.equal(chunks.length, 2)
    assert.equal(chunks[0].event, 'content_block_start')
    assert.equal(chunks[1].event, 'content_block_delta')
    assert.equal(chunks[1].data.delta.text, 'Hi')
  })

  it('skips blocks without both event and data', async () => {
    const resp = makeSSEResponse(
      'event: ping\n\n' + // no data
      'event: message_start\ndata: {"type":"message_start"}\n\n'
    )
    const chunks = []
    for await (const c of readAnthropicSSE(resp)) chunks.push(c)
    assert.equal(chunks.length, 1)
    assert.equal(chunks[0].event, 'message_start')
  })

  it('handles empty stream', async () => {
    const resp = {
      body: {
        getReader() {
          return {
            async read() { return { done: true, value: undefined } },
            releaseLock() {},
          }
        },
      },
    }
    const chunks = []
    for await (const c of readAnthropicSSE(resp)) chunks.push(c)
    assert.equal(chunks.length, 0)
  })

  it('skips malformed JSON in data', async () => {
    const resp = makeSSEResponse(
      'event: bad\ndata: {broken\n\n' +
      'event: good\ndata: {"ok":true}\n\n'
    )
    const chunks = []
    for await (const c of readAnthropicSSE(resp)) chunks.push(c)
    // bad block has event but data parse failed → skipped
    assert.equal(chunks.length, 1)
    assert.equal(chunks[0].event, 'good')
  })
})

// ── 10. MODEL_PRICING sanity (3 tests) ──────────────────────────

describe('MODEL_PRICING', () => {
  let MODEL_PRICING

  beforeEach(async () => {
    MODEL_PRICING = (await getMod()).MODEL_PRICING
  })

  it('has entries for major models', () => {
    assert.ok(MODEL_PRICING['gpt-4o'])
    assert.ok(MODEL_PRICING['claude-sonnet-4-6'])
    assert.ok(MODEL_PRICING['claude-opus-4-6'])
  })

  it('all entries have input and output rates', () => {
    for (const [name, pricing] of Object.entries(MODEL_PRICING)) {
      assert.equal(typeof pricing.input, 'number', `${name} missing input`)
      assert.equal(typeof pricing.output, 'number', `${name} missing output`)
    }
  })

  it('cached_input rate is less than or equal to input rate', () => {
    for (const [name, pricing] of Object.entries(MODEL_PRICING)) {
      if (pricing.cached_input != null) {
        assert.ok(pricing.cached_input <= pricing.input,
          `${name}: cached_input (${pricing.cached_input}) > input (${pricing.input})`)
      }
    }
  })
})
