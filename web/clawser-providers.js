/**
 * Clawser Provider Implementations (v2)
 *
 * Three provider tiers:
 *   Tier 1: Built-in (Echo, Chrome AI, OpenAI, Anthropic) — zero deps
 *   Tier 2: OpenAI-compatible (Groq, Ollama, etc.) — zero deps, configurable
 *   Tier 3: ai.matey (24+ backends) — CDN dependency, opt-in
 *
 * All providers support:
 *   - chat()       — blocking request-response → ChatResponse
 *   - chatStream() — async generator → StreamChunk[]
 *   - Configurable max_tokens, temperature
 *   - supportsStreaming / supportsNativeTools flags
 */

// ── ChatResponse shape ────────────────────────────────────────────
// All providers MUST return this exact shape:
// {
//   content: string,
//   tool_calls: Array<{id: string, name: string, arguments: string}>,
//   usage: { input_tokens: number, output_tokens: number },
//   model: string,
// }

// ── Stream chunk types ────────────────────────────────────────────
// { type: 'text', text: string }
// { type: 'tool_start', index: number, id: string, name: string }
// { type: 'tool_delta', index: number, arguments: string }
// { type: 'done', response: ChatResponse }
// { type: 'error', error: string }

// ── SSE reader ────────────────────────────────────────────────────

async function* readSSE(response) {
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        if (line.startsWith('data: ')) {
          const payload = line.slice(6).trim();
          if (payload === '[DONE]') {
            yield { event: null, data: null, done: true };
            return;
          }
          try {
            yield { event: null, data: JSON.parse(payload) };
          } catch (e) {
            // Expected for partial JSON chunks; log for diagnosis
            if (typeof console !== 'undefined') console.debug('[SSE] JSON parse skip:', line);
          }
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
}

/**
 * Read Anthropic SSE format (event: type + data: json pairs).
 */
async function* readAnthropicSSE(response) {
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const parts = buffer.split('\n\n');
      buffer = parts.pop() || '';

      for (const part of parts) {
        const lines = part.split('\n');
        let eventType = null;
        let data = null;

        for (const line of lines) {
          if (line.startsWith('event: ')) eventType = line.slice(7).trim();
          else if (line.startsWith('data: ')) {
            try { data = JSON.parse(line.slice(6)); } catch (e) {
              // Expected for partial JSON chunks; log for diagnosis
              if (typeof console !== 'undefined') console.debug('[SSE] JSON parse skip:', line);
            }
          }
        }

        if (eventType && data) {
          yield { event: eventType, data };
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
}

// ── Retry helper ──────────────────────────────────────────────────

async function withRetry(fn, retries = 2, baseDelay = 1000) {
  let lastError;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await fn();
    } catch (e) {
      lastError = e;
      if (attempt < retries) {
        const isRetryable = e.message?.includes('429') ||
          e.message?.includes('500') || e.message?.includes('502') ||
          e.message?.includes('503') || e.message?.includes('529');
        if (!isRetryable) throw e;
        const delay = baseDelay * Math.pow(2, attempt) * (0.5 + Math.random() * 0.5);
        await new Promise(r => setTimeout(r, delay));
      }
    }
  }
  throw lastError;
}

// ── Cost estimation ───────────────────────────────────────────────

/** Per-1K-token pricing (USD). Input and output rates. */
export const MODEL_PRICING = {
  // OpenAI
  'gpt-4o':          { input: 0.0025, output: 0.010, cached_input: 0.00125 },
  'gpt-4o-mini':     { input: 0.00015, output: 0.0006 },
  'gpt-4.1':         { input: 0.002, output: 0.008, cached_input: 0.001 },
  'gpt-4.1-mini':    { input: 0.0004, output: 0.0016 },
  'gpt-4.1-nano':    { input: 0.0001, output: 0.0004 },
  'o3-mini':         { input: 0.0011, output: 0.0044 },
  // Anthropic
  'claude-sonnet-4-6':          { input: 0.003, output: 0.015, cached_input: 0.0015 },
  'claude-haiku-4-5-20251001':  { input: 0.0008, output: 0.004, cached_input: 0.0004 },
  'claude-opus-4-6':            { input: 0.015, output: 0.075, cached_input: 0.0075 },
  // Groq
  'llama-3.3-70b-versatile':   { input: 0.00059, output: 0.00079 },
  'llama-3.1-8b-instant':      { input: 0.00005, output: 0.00008 },
  // Mistral
  'mistral-small-latest':      { input: 0.0001, output: 0.0003 },
  'mistral-large-latest':      { input: 0.002, output: 0.006 },
  // DeepSeek
  'deepseek-chat':             { input: 0.00014, output: 0.00028, cached_input: 0.00007 },
  'deepseek-reasoner':         { input: 0.00055, output: 0.00219 },
  // Chrome AI / Echo
  'chrome-ai':                 { input: 0, output: 0 },
  'echo':                      { input: 0, output: 0 },
};

export function estimateCost(model, usage) {
  if (!usage) return 0;
  const pricing = MODEL_PRICING[model];
  if (!pricing) return 0;
  const cachedTokens = usage.cache_read_input_tokens || 0;
  const regularInputTokens = Math.max(0, (usage.input_tokens || 0) - cachedTokens);
  return ((regularInputTokens / 1000) * pricing.input) +
         ((cachedTokens / 1000) * (pricing.cached_input || pricing.input)) +
         (((usage.output_tokens || 0) / 1000) * pricing.output);
}

// ── Error classification ───────────────────────────────────────────

/**
 * Classification rules, evaluated in priority order (first match wins).
 * Auth is checked before client so "invalid authentication token" → auth, not client.
 * @type {Array<[RegExp, string, boolean]>}
 */
const ERROR_RULES = [
  [/\b429\b|rate.limit/i,                                    'rate_limit', true],
  [/\b5\d{2}\b|server.error/i,                               'server',     true],
  [/\b401\b|\b403\b|unauthorized|forbidden|auth.*invalid|invalid.*auth|invalid.*key|invalid.*token/i, 'auth', false],
  [/network|fetch|ECONNREFUSED|timeout|abort/i,               'network',    true],
  [/\b400\b|\binvalid\b|malformed/i,                          'client',     false],
];

/**
 * Classify an error for retry/display decisions.
 * Uses a priority table — first matching rule wins. Auth rules are checked
 * before client rules so "invalid token" classifies as auth, not client.
 * @param {Error|string} err
 * @returns {{ category: 'rate_limit'|'server'|'auth'|'network'|'client'|'unknown', retryable: boolean, message: string }}
 */
export function classifyError(err) {
  const msg = typeof err === 'string' ? err : err?.message || String(err);
  for (const [pattern, category, retryable] of ERROR_RULES) {
    if (pattern.test(msg)) return { category, retryable, message: msg };
  }
  return { category: 'unknown', retryable: false, message: msg };
}

// ── Response validation ────────────────────────────────────────────

/**
 * Normalize a single tool_call entry, filling safe defaults for missing fields.
 * @param {object} tc - Raw tool call object
 * @returns {{ id: string, name: string, arguments: string }}
 */
function normalizeToolCall(tc) {
  if (!tc || typeof tc !== 'object') return { id: '', name: '', arguments: '{}' };
  return {
    id: typeof tc.id === 'string' ? tc.id : '',
    name: typeof tc.name === 'string' ? tc.name : '',
    arguments: typeof tc.arguments === 'string' ? tc.arguments : '{}',
  };
}

/**
 * Validate and normalize a ChatResponse, filling in safe defaults for missing fields.
 * Each tool_call entry is individually normalized to guarantee {id, name, arguments}.
 * @param {object} raw - Raw response from provider
 * @param {string} fallbackModel - Model name to use if missing
 * @returns {{ content: string, tool_calls: Array<{id: string, name: string, arguments: string}>, usage: {input_tokens: number, output_tokens: number}, model: string }}
 */
export function validateChatResponse(raw, fallbackModel = 'unknown') {
  const rawCalls = Array.isArray(raw?.tool_calls) ? raw.tool_calls : [];
  return {
    content: typeof raw?.content === 'string' ? raw.content : '',
    tool_calls: rawCalls.map(normalizeToolCall),
    usage: {
      input_tokens: Number(raw?.usage?.input_tokens) || 0,
      output_tokens: Number(raw?.usage?.output_tokens) || 0,
    },
    model: raw?.model || fallbackModel,
  };
}

// ── Response Cache ────────────────────────────────────────────────

/**
 * LRU response cache with TTL expiration for LLM API responses.
 * Skips caching for responses that contain tool calls (side effects).
 */
export class ResponseCache {
  /** @type {Map<string, {response: object, model: string, timestamp: number, hitCount: number, tokensSaved: {input: number, output: number}}>} */
  #cache = new Map();
  #maxEntries;
  #ttlMs;
  #totalHits = 0;
  #totalMisses = 0;
  #totalTokensSaved = { input: 0, output: 0 };
  #totalCostSaved = 0;
  #enabled = true;

  /**
   * @param {object} [opts]
   * @param {number} [opts.maxEntries=500] - Maximum cache entries before LRU eviction
   * @param {number} [opts.ttlMs=1800000] - Time-to-live in ms (default 30 min)
   */
  constructor(opts = {}) {
    this.#maxEntries = opts.maxEntries ?? 500;
    this.#ttlMs = opts.ttlMs ?? 30 * 60_000;
  }

  /** Enable or disable the cache. */
  set enabled(v) { this.#enabled = !!v; }
  get enabled() { return this.#enabled; }

  /** Set the TTL in milliseconds. */
  set ttl(ms) { this.#ttlMs = ms; }
  get ttl() { return this.#ttlMs; }

  /** Set the maximum number of cache entries. */
  set maxEntries(n) { this.#maxEntries = n; }
  get maxEntries() { return this.#maxEntries; }

  /** FNV-1a hash — fast, non-cryptographic */
  static hash(str) {
    let h = 0x811c9dc5;
    for (let i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 0x01000193);
    }
    return (h >>> 0).toString(36);
  }

  /**
   * Generate a cache key from messages + model.
   * Strips the system prompt (varies per session) and uses only
   * user/assistant/tool message content for the key.
   */
  static cacheKey(messages, model) {
    const significant = messages
      .filter(m => m.role !== 'system')
      .map(m => {
        let part = `${m.role}:${m.content || ''}`;
        if (m.tool_call_id) part += `:tid=${m.tool_call_id}`;
        if (m.tool_calls) part += `:tc=${JSON.stringify(m.tool_calls)}`;
        return part;
      })
      .join('|');
    return `${model}::${ResponseCache.hash(significant)}`;
  }

  /**
   * Look up a cached response.
   * @param {string} key
   * @returns {object|null} Cached ChatResponse or null
   */
  get(key) {
    if (!this.#enabled) return null;
    const entry = this.#cache.get(key);
    if (!entry) { this.#totalMisses++; return null; }

    // TTL check
    if (Date.now() - entry.timestamp > this.#ttlMs) {
      this.#cache.delete(key);
      this.#totalMisses++;
      return null;
    }

    // LRU: move to end
    this.#cache.delete(key);
    this.#cache.set(key, entry);

    entry.hitCount++;
    this.#totalHits++;
    this.#totalTokensSaved.input += entry.tokensSaved.input;
    this.#totalTokensSaved.output += entry.tokensSaved.output;
    this.#totalCostSaved += estimateCost(entry.model, entry.tokensSaved);
    return entry.response;
  }

  /**
   * Store a response in the cache.
   * @param {string} key
   * @param {object} response - ChatResponse
   * @param {string} model
   */
  set(key, response, model) {
    if (!this.#enabled) return;

    // Never cache responses with tool calls (side effects)
    if (response.tool_calls?.length > 0) return;

    // LRU eviction
    if (this.#cache.size >= this.#maxEntries) {
      const oldest = this.#cache.keys().next().value;
      this.#cache.delete(oldest);
    }

    this.#cache.set(key, {
      response,
      model,
      timestamp: Date.now(),
      hitCount: 0,
      tokensSaved: {
        input: response.usage?.input_tokens || 0,
        output: response.usage?.output_tokens || 0,
      },
    });
  }

  /** Remove a specific entry. */
  delete(key) { this.#cache.delete(key); }

  /** Clear all entries and reset stats. */
  clear() {
    this.#cache.clear();
    this.#totalHits = 0;
    this.#totalMisses = 0;
    this.#totalTokensSaved = { input: 0, output: 0 };
    this.#totalCostSaved = 0;
  }

  /** @returns {number} Current entry count */
  get size() { return this.#cache.size; }

  /** Cache statistics */
  get stats() {
    return {
      entries: this.#cache.size,
      maxEntries: this.#maxEntries,
      ttlMs: this.#ttlMs,
      totalHits: this.#totalHits,
      totalMisses: this.#totalMisses,
      hitRate: this.#totalHits / (this.#totalHits + this.#totalMisses) || 0,
      tokensSaved: { ...this.#totalTokensSaved },
      costSaved: Math.round(this.#totalCostSaved * 10000) / 10000,
    };
  }
}

// ── Base class ────────────────────────────────────────────────────

export class LLMProvider {
  get name() { throw new Error('implement name'); }
  get displayName() { return this.name; }
  get requiresApiKey() { return false; }
  get supportsStreaming() { return false; }
  get supportsNativeTools() { return false; }

  async isAvailable() { return true; }

  /**
   * Generate a chat completion.
   * @param {object} request - {messages, tools}
   * @param {string} [apiKey]
   * @param {string} [modelOverride]
   * @param {object} [options] - {max_tokens, temperature, signal}
   * @returns {Promise<object>} ChatResponse
   */
  async chat(request, apiKey, modelOverride, options = {}) {
    throw new Error('implement chat');
  }

  /**
   * Stream a chat completion. Override in providers that support streaming.
   * Yields StreamChunk objects. Final chunk has type 'done' with full ChatResponse.
   * @param {object} request - {messages, tools}
   * @param {string} [apiKey]
   * @param {string} [modelOverride]
   * @param {object} [options] - {max_tokens, temperature, signal}
   * @yields {object} StreamChunk
   */
  async *chatStream(request, apiKey, modelOverride, options = {}) {
    // Default: fall back to non-streaming chat()
    const response = await this.chat(request, apiKey, modelOverride, options);
    yield { type: 'text', text: response.content };
    yield { type: 'done', response };
  }
}

// ── Echo Provider ─────────────────────────────────────────────────

export class EchoProvider extends LLMProvider {
  get name() { return 'echo'; }
  get displayName() { return 'Echo (no LLM)'; }

  async chat(request) {
    const messages = request.messages || [];
    const lastUser = [...messages].reverse().find(m => m.role === 'user');
    const content = lastUser
      ? `You said: "${lastUser.content}"\n\n[Echo mode — connect a real provider for intelligent responses]`
      : '[Echo] No user message found.';

    return validateChatResponse({
      content,
      tool_calls: [],
      usage: { input_tokens: 0, output_tokens: 0 },
      model: 'echo',
    }, 'echo');
  }
}

// ── Chrome AI Provider ────────────────────────────────────────────

export class ChromeAIProvider extends LLMProvider {
  #sessions = new Map();
  #maxSessions = 3;
  #sessionTimeout = 300_000; // 5 minutes
  #apiNamespace = null;
  #lastSystemPrompt = null;

  get name() { return 'chrome-ai'; }
  get displayName() { return 'Chrome AI (local)'; }
  get supportsStreaming() { return true; }

  #getApi() {
    if (this.#apiNamespace) return this.#apiNamespace;
    if (typeof LanguageModel !== 'undefined') {
      this.#apiNamespace = LanguageModel;
      return this.#apiNamespace;
    }
    if (typeof self !== 'undefined' && self.ai?.languageModel) {
      this.#apiNamespace = self.ai.languageModel;
      return this.#apiNamespace;
    }
    return null;
  }

  async isAvailable() {
    const api = this.#getApi();
    if (!api) return false;
    try {
      const avail = await api.availability();
      return avail === 'available' || avail === 'downloadable';
    } catch { return false; }
  }

  #sessionHash(systemPrompt) {
    const s = systemPrompt || '';
    return s.slice(0, 100) + ':' + s.length;
  }

  async #getSession(systemPrompt) {
    const hash = this.#sessionHash(systemPrompt);
    const now = Date.now();

    // Check if a valid cached session exists
    const entry = this.#sessions.get(hash);
    if (entry && (now - entry.timestamp) < this.#sessionTimeout) {
      entry.timestamp = now; // refresh LRU timestamp
      return entry.session;
    }

    // Evict expired entry if it exists
    if (entry) {
      if (entry.session?.destroy) entry.session.destroy();
      this.#sessions.delete(hash);
    }

    // Evict oldest if pool is at max capacity
    if (this.#sessions.size >= this.#maxSessions) {
      let oldestKey = null;
      let oldestTime = Infinity;
      for (const [key, val] of this.#sessions) {
        if (val.timestamp < oldestTime) {
          oldestTime = val.timestamp;
          oldestKey = key;
        }
      }
      if (oldestKey !== null) {
        const evicted = this.#sessions.get(oldestKey);
        if (evicted?.session?.destroy) evicted.session.destroy();
        this.#sessions.delete(oldestKey);
      }
    }

    // Create new session
    const api = this.#getApi();
    if (!api) throw new Error('Chrome Prompt API not available');
    const initialPrompts = [];
    if (systemPrompt) initialPrompts.push({ role: 'system', content: systemPrompt });
    const session = await api.create({
      initialPrompts: initialPrompts.length > 0 ? initialPrompts : undefined,
    });
    this.#sessions.set(hash, { session, timestamp: now });
    return session;
  }

  #preparePrompt(request) {
    const messages = request.messages || [];
    const systemMsg = messages.find(m => m.role === 'system');
    const systemContent = systemMsg?.content || 'You are a helpful assistant.';
    const baseSystem = systemContent.split('\n\nYou have browser tools')[0];
    if (this.#sessions.size > 0 && this.#lastSystemPrompt !== baseSystem) this.resetSession();
    this.#lastSystemPrompt = baseSystem;
    const conversationMsgs = messages.filter(m => m.role !== 'system');
    const lastUser = [...conversationMsgs].reverse().find(m => m.role === 'user');
    return { systemContent, conversationMsgs, lastUser };
  }

  async chat(request) {
    const { systemContent, conversationMsgs, lastUser } = this.#preparePrompt(request);
    let prompt, session;

    if (conversationMsgs.length <= 2) {
      session = await this.#getSession(systemContent);
      prompt = lastUser?.content || '';
    } else {
      const api = this.#getApi();
      if (!api) throw new Error('Chrome Prompt API not available');
      const fullPrompt = conversationMsgs
        .filter(m => m.role !== 'tool')
        .map(m => `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.content}`)
        .join('\n\n') + '\n\nAssistant:';
      session = await api.create({ initialPrompts: [{ role: 'system', content: systemContent }] });
      prompt = fullPrompt;
    }

    const isOneShot = conversationMsgs.length > 2;
    try {
      const content = await session.prompt(prompt);
      // Read usage BEFORE destroying the session
      const inputTokens = session.inputUsage ?? Math.round(prompt.length / 4);
      const outputTokens = Math.round(content.length / 4);
      return {
        content,
        tool_calls: [],
        usage: { input_tokens: inputTokens, output_tokens: outputTokens },
        model: 'chrome-ai',
      };
    } finally {
      if (isOneShot && session?.destroy) session.destroy();
    }
  }

  async *chatStream(request, _apiKey, _modelOverride, options = {}) {
    const { systemContent, conversationMsgs, lastUser } = this.#preparePrompt(request);
    let prompt, session, isOneShot = false;

    if (conversationMsgs.length <= 2) {
      session = await this.#getSession(systemContent);
      prompt = lastUser?.content || '';
    } else {
      const api = this.#getApi();
      if (!api) throw new Error('Chrome Prompt API not available');
      const fullPrompt = conversationMsgs
        .filter(m => m.role !== 'tool')
        .map(m => `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.content}`)
        .join('\n\n') + '\n\nAssistant:';
      session = await api.create({ initialPrompts: [{ role: 'system', content: systemContent }] });
      prompt = fullPrompt;
      isOneShot = true;
    }

    // Chrome AI streaming via promptStreaming()
    if (typeof session.promptStreaming === 'function') {
      let fullContent = '';
      try {
        const stream = session.promptStreaming(prompt);
        let lastLen = 0;
        for await (const chunk of stream) {
          if (options.signal?.aborted) break;
          const text = typeof chunk === 'string' ? chunk : chunk.toString();
          // Chrome 131-137: yields accumulated text; Chrome 138+: yields deltas.
          let delta;
          if (text.length >= lastLen && text.startsWith(fullContent)) {
            delta = text.slice(lastLen);
            lastLen = text.length;
            fullContent = text;
          } else {
            delta = text;
            fullContent += text;
            lastLen = fullContent.length;
          }
          if (delta) yield { type: 'text', text: delta };
        }
      } finally {
        const inputTokens = session.inputUsage ?? Math.round(prompt.length / 4);
        if (isOneShot && session?.destroy) session.destroy();
        yield {
          type: 'done',
          response: {
            content: fullContent,
            tool_calls: [],
            usage: { input_tokens: inputTokens, output_tokens: Math.round(fullContent.length / 4) },
            model: 'chrome-ai',
          },
        };
      }
    } else {
      // Fallback to non-streaming
      const response = await this.chat(request);
      yield { type: 'text', text: response.content };
      yield { type: 'done', response };
    }
  }

  resetSession() {
    for (const [, entry] of this.#sessions) {
      if (entry.session?.destroy) entry.session.destroy();
    }
    this.#sessions.clear();
    this.#apiNamespace = null;
  }

  destroyPool() {
    this.resetSession();
  }
}

// ── OpenAI-format helpers (shared by OpenAI + OpenAI-compatible) ──

/**
 * Build an OpenAI Chat Completions API request body from internal message format.
 *
 * Transforms internal message objects to the OpenAI wire format:
 * - Maps `role` directly (system, user, assistant, tool).
 * - Forwards `tool_call_id` and `name` on tool-result messages.
 * - Re-packs `tool_calls` on assistant messages into OpenAI's
 *   `{id, type:'function', function:{name, arguments}}` shape, which is required
 *   by the API when subsequent tool-result messages follow.
 * - Wraps tool specs into `{type:'function', function:{name, description, parameters}}`.
 *
 * @param {object} request - Internal request: `{messages: Array<object>, tools?: Array<object>}`.
 *   Each message has `{role, content}` and optionally `tool_call_id`, `name`, or `tool_calls`.
 * @param {string} model - Model identifier (e.g. `'gpt-4o-mini'`).
 * @param {object} [options] - Optional overrides: `{max_tokens?, temperature?}`.
 * @returns {object} A JSON-serializable body for `POST /v1/chat/completions`.
 */
function buildOpenAIBody(request, model, options = {}) {
  const messages = (request.messages || []).map(m => {
    const msg = { role: m.role, content: m.content ?? null };
    if (m.tool_call_id) msg.tool_call_id = m.tool_call_id;
    if (m.name) msg.name = m.name;
    // Forward tool_calls on assistant messages (required by OpenAI when tool results follow)
    if (m.role === 'assistant' && m.tool_calls?.length > 0) {
      msg.tool_calls = m.tool_calls.map(tc => ({
        id: tc.id,
        type: 'function',
        function: {
          name: tc.function?.name || tc.name,
          arguments: tc.function?.arguments || tc.arguments || '{}',
        },
      }));
    }
    return msg;
  });

  const body = {
    model,
    messages,
    max_tokens: options.max_tokens || 4096,
  };
  if (options.temperature != null) body.temperature = options.temperature;

  if (request.tools?.length > 0) {
    body.tools = request.tools.map(t => ({
      type: 'function',
      function: {
        name: t.name,
        description: t.description || '',
        parameters: t.parameters || {},
      },
    }));
  }

  return body;
}

/**
 * Transform an OpenAI Chat Completions API response into the internal ChatResponse shape.
 *
 * Performs the following conversions:
 * - Extracts `content` from `choices[0].message.content`.
 * - Flattens each `tool_calls` entry from `{id, function:{name, arguments}}` to `{id, name, arguments}`.
 * - Remaps token usage from OpenAI's `prompt_tokens`/`completion_tokens` to the internal
 *   `input_tokens`/`output_tokens` naming convention.
 * - Falls back to the caller-supplied `model` if the response omits `data.model`.
 * - Returns a zero-usage empty response when no choices are present (e.g. content-filter refusals).
 *
 * @param {object} data - Raw JSON response from the OpenAI `/v1/chat/completions` endpoint.
 * @param {string} model - Fallback model identifier if `data.model` is absent.
 * @returns {{ content: string, tool_calls: Array<{id: string, name: string, arguments: string}>, usage: {input_tokens: number, output_tokens: number}, model: string }}
 *   Internal ChatResponse object.
 */
function parseOpenAIResponse(data, model) {
  const choice = data.choices?.[0];
  if (!choice) return validateChatResponse(null, model);

  return validateChatResponse({
    content: choice.message?.content || '',
    tool_calls: (choice.message?.tool_calls || []).map(tc => ({
      id: tc.id || '',
      name: tc.function?.name || '',
      arguments: tc.function?.arguments || '{}',
    })),
    usage: {
      input_tokens: data.usage?.prompt_tokens || 0,
      output_tokens: data.usage?.completion_tokens || 0,
    },
    model: data.model || model,
  }, model);
}

/**
 * Consume an OpenAI SSE stream and yield incremental StreamChunk objects.
 *
 * Reads the SSE response via `readSSE()` and accumulates state across chunks:
 * - **Text content**: appended to a running `content` buffer; each delta is yielded
 *   immediately as `{type:'text', text}`.
 * - **Tool calls**: assembled incrementally across multiple SSE events. Each tool call
 *   is keyed by its `index`. When a new tool call begins (function name present), a
 *   `{type:'tool_start', index, id, name}` chunk is yielded. Subsequent argument
 *   fragments are yielded as `{type:'tool_delta', index, arguments}` and concatenated
 *   into the entry's `arguments` buffer.
 * - **Usage and model**: extracted from any SSE event that carries them. The final SSE
 *   event often has `usage` but an empty `choices` array, so usage is extracted
 *   *before* the choice guard to avoid missing it.
 * - **Final chunk**: once the SSE stream closes, a `{type:'done', response}` chunk is
 *   yielded containing the fully assembled ChatResponse with accumulated content,
 *   tool_calls, usage, and resolved model.
 *
 * @param {Response} response - A fetch `Response` whose body is an SSE stream in
 *   OpenAI format (`data: {JSON}\n\n` lines, terminated by `data: [DONE]`).
 * @param {string} model - Fallback model identifier.
 * @yields {{ type: 'text', text: string } | { type: 'tool_start', index: number, id: string, name: string } | { type: 'tool_delta', index: number, arguments: string } | { type: 'done', response: object }}
 *   StreamChunk objects representing incremental content, tool call assembly, or the final response.
 * @returns {AsyncGenerator} Async generator of StreamChunk objects.
 */
async function* streamOpenAI(response, model) {
  let content = '';
  const toolCalls = new Map(); // index → {id, name, arguments}
  let usage = { input_tokens: 0, output_tokens: 0 };
  let resolvedModel = model;

  for await (const { data, done: isDone } of readSSE(response)) {
    if (isDone || !data) break;

    // Extract usage and model BEFORE choice guard — the final chunk has usage but choices: []
    if (data.model) resolvedModel = data.model;
    if (data.usage) {
      usage = {
        input_tokens: data.usage.prompt_tokens || 0,
        output_tokens: data.usage.completion_tokens || 0,
      };
    }

    const choice = data.choices?.[0];
    if (!choice) continue;

    const delta = choice.delta || {};

    // Text content
    if (delta.content) {
      content += delta.content;
      yield { type: 'text', text: delta.content };
    }

    // Tool calls (streamed incrementally)
    if (delta.tool_calls) {
      for (const tc of delta.tool_calls) {
        const idx = tc.index ?? 0;
        if (!toolCalls.has(idx)) {
          toolCalls.set(idx, { id: tc.id || '', name: '', arguments: '' });
        }
        const entry = toolCalls.get(idx);
        if (tc.id) entry.id = tc.id;
        if (tc.function?.name) {
          entry.name = tc.function.name;
          yield { type: 'tool_start', index: idx, id: entry.id, name: entry.name };
        }
        if (tc.function?.arguments) {
          entry.arguments += tc.function.arguments;
          yield { type: 'tool_delta', index: idx, arguments: tc.function.arguments };
        }
      }
    }
  }

  // Emit final response
  const tool_calls = [...toolCalls.values()].filter(tc => tc.name);
  yield {
    type: 'done',
    response: validateChatResponse({ content, tool_calls, usage, model: resolvedModel }, resolvedModel),
  };
}

// ── OpenAI Provider ───────────────────────────────────────────────

export class OpenAIProvider extends LLMProvider {
  #model;

  constructor(model = 'gpt-4o-mini') {
    super();
    this.#model = model;
  }

  get name() { return 'openai'; }
  get displayName() { return `OpenAI (${this.#model})`; }
  get requiresApiKey() { return true; }
  get supportsStreaming() { return true; }
  get supportsNativeTools() { return true; }

  async chat(request, apiKey, modelOverride, options = {}) {
    if (!apiKey) throw new Error('OpenAI API key required');
    const model = modelOverride || this.#model;
    const body = buildOpenAIBody(request, model, options);

    return withRetry(async () => {
      const resp = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
        body: JSON.stringify(body),
        signal: options.signal,
      });
      if (!resp.ok) throw new Error(`OpenAI ${resp.status}: ${await resp.text()}`);
      return parseOpenAIResponse(await resp.json(), model);
    });
  }

  async *chatStream(request, apiKey, modelOverride, options = {}) {
    if (!apiKey) throw new Error('OpenAI API key required');
    const model = modelOverride || this.#model;
    const body = { ...buildOpenAIBody(request, model, options), stream: true, stream_options: { include_usage: true } };

    const resp = await withRetry(async () => {
      const r = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
        body: JSON.stringify(body),
        signal: options.signal,
      });
      if (!r.ok) throw new Error(`OpenAI ${r.status}: ${await r.text()}`);
      return r;
    });

    yield* streamOpenAI(resp, model);
  }
}

// ── Anthropic Provider ────────────────────────────────────────────

export class AnthropicProvider extends LLMProvider {
  #model;

  constructor(model = 'claude-sonnet-4-6') {
    super();
    this.#model = model;
  }

  get name() { return 'anthropic'; }
  get displayName() { return `Anthropic (${this.#model})`; }
  get requiresApiKey() { return true; }
  get supportsStreaming() { return true; }
  get supportsNativeTools() { return true; }

  /**
   * Transform internal message history into Anthropic Messages API format.
   *
   * Handles several Anthropic-specific constraints and conventions:
   *
   * **Consecutive-merge logic**: Anthropic requires strict alternation between
   * `user` and `assistant` roles. When two consecutive messages share the same
   * role, this method merges them into a single message. String content is
   * concatenated with `\n\n`; array content blocks are appended.
   *
   * **tool_use / tool_result block packing**: Assistant messages that include
   * `tool_calls` are packed into Anthropic's content-block format —
   * `[{type:'text', text}, {type:'tool_use', id, name, input}]`. Tool-result
   * messages (role `'tool'`) are converted to `{type:'tool_result', tool_use_id, content}`
   * blocks inside a `user` message, since Anthropic expects tool results to
   * come from the user role. When tools are not active, tool results fall back
   * to plain text `[toolName result] output`.
   *
   * **"First message must be user" invariant**: If the first non-system message
   * is an assistant message, a synthetic `{role:'user', content:'(conversation start)'}`
   * is prepended to satisfy the API requirement.
   *
   * **Empty assistant filtering**: Assistant messages with empty content
   * (string or array) are removed, as the Anthropic API rejects them.
   *
   * System messages are skipped entirely (handled separately as the `system` parameter).
   *
   * @param {object} request - Internal request with `{messages, tools?}`.
   * @returns {Array<{role: string, content: string | Array<object>}>}
   *   Anthropic-compatible message array ready for the Messages API body.
   */
  #buildMessages(request) {
    const messages = [];
    // Track if we're building tool_use/tool_result blocks for native Anthropic format
    const hasTools = request.tools?.length > 0;

    for (const m of (request.messages || [])) {
      if (m.role === 'system') continue;

      if (m.role === 'assistant') {
        // Build Anthropic content blocks: text + tool_use blocks
        const content = [];
        if (m.content) content.push({ type: 'text', text: m.content });
        if (hasTools && m.tool_calls) {
          for (const tc of m.tool_calls) {
            const name = tc.function?.name || tc.name;
            const args = tc.function?.arguments || tc.arguments || '{}';
            let input;
            try { input = typeof args === 'string' ? JSON.parse(args) : args; }
            catch { input = {}; }
            content.push({ type: 'tool_use', id: tc.id, name, input });
          }
        }
        // Anthropic requires alternating user/assistant. Merge if consecutive.
        const msgObj = { role: 'assistant', content: content.length === 1 && content[0].type === 'text' ? content[0].text : content };
        if (messages.length > 0 && messages[messages.length - 1].role === 'assistant') {
          // Merge into previous assistant message
          const prev = messages[messages.length - 1];
          if (typeof prev.content === 'string') {
            prev.content = [{ type: 'text', text: prev.content }, ...(Array.isArray(msgObj.content) ? msgObj.content : [{ type: 'text', text: msgObj.content }])];
          } else if (Array.isArray(prev.content)) {
            prev.content.push(...(Array.isArray(msgObj.content) ? msgObj.content : [{ type: 'text', text: msgObj.content }]));
          }
        } else {
          messages.push(msgObj);
        }
        continue;
      }

      if (m.role === 'tool') {
        // Anthropic native tool_result format
        if (hasTools && m.tool_call_id) {
          const toolResultBlock = { type: 'tool_result', tool_use_id: m.tool_call_id, content: m.content || '' };
          // Tool results must be in a user message
          if (messages.length > 0 && messages[messages.length - 1].role === 'user') {
            const prev = messages[messages.length - 1];
            if (typeof prev.content === 'string') {
              prev.content = [{ type: 'text', text: prev.content }, toolResultBlock];
            } else if (Array.isArray(prev.content)) {
              prev.content.push(toolResultBlock);
            }
          } else {
            messages.push({ role: 'user', content: [toolResultBlock] });
          }
        } else {
          // Fallback: no tool calling active, embed as text
          const label = m.name ? `[${m.name} result]` : '[Tool result]';
          const textContent = `${label} ${m.content}`;
          if (messages.length > 0 && messages[messages.length - 1].role === 'user') {
            const prev = messages[messages.length - 1];
            if (typeof prev.content === 'string') {
              prev.content += '\n\n' + textContent;
            } else if (Array.isArray(prev.content)) {
              prev.content.push({ type: 'text', text: textContent });
            }
          } else {
            messages.push({ role: 'user', content: textContent });
          }
        }
        continue;
      }

      // User messages and anything else → map to 'user'
      if (messages.length > 0 && messages[messages.length - 1].role === 'user') {
        const prev = messages[messages.length - 1];
        if (typeof prev.content === 'string') {
          prev.content += '\n\n' + m.content;
        } else if (Array.isArray(prev.content)) {
          prev.content.push({ type: 'text', text: m.content });
        }
      } else {
        messages.push({ role: 'user', content: m.content });
      }
    }

    // Anthropic requires first message to be role 'user'
    if (messages.length > 0 && messages[0].role !== 'user') {
      messages.unshift({ role: 'user', content: '(conversation start)' });
    }

    // Filter out any assistant messages with empty content (Anthropic rejects them)
    return messages.filter(m => {
      if (m.role !== 'assistant') return true;
      if (typeof m.content === 'string') return m.content.length > 0;
      if (Array.isArray(m.content)) return m.content.length > 0;
      return true;
    });
  }

  #buildBody(request, model, options = {}) {
    const messages = this.#buildMessages(request);
    const systemMsg = (request.messages || []).find(m => m.role === 'system');
    const body = { model, max_tokens: options.max_tokens || 4096, messages };
    if (systemMsg) body.system = systemMsg.content;
    if (options.temperature != null) body.temperature = options.temperature;
    if (request.tools?.length > 0) {
      body.tools = request.tools.map(t => ({
        name: t.name,
        description: t.description || '',
        input_schema: t.parameters || {},
      }));
    }
    return body;
  }

  #headers(apiKey) {
    return {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true',
    };
  }

  async chat(request, apiKey, modelOverride, options = {}) {
    if (!apiKey) throw new Error('Anthropic API key required');
    const model = modelOverride || this.#model;
    const body = this.#buildBody(request, model, options);

    return withRetry(async () => {
      const resp = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: this.#headers(apiKey),
        body: JSON.stringify(body),
        signal: options.signal,
      });
      if (!resp.ok) throw new Error(`Anthropic ${resp.status}: ${await resp.text()}`);

      const data = await resp.json();
      const blocks = Array.isArray(data.content) ? data.content : [];
      const textBlocks = blocks.filter(b => b.type === 'text');
      const toolBlocks = blocks.filter(b => b.type === 'tool_use');

      return validateChatResponse({
        content: textBlocks.map(b => b.text).join('\n'),
        tool_calls: toolBlocks.map(tb => ({
          id: tb.id,
          name: tb.name,
          arguments: JSON.stringify(tb.input),
        })),
        usage: {
          input_tokens: data.usage?.input_tokens || 0,
          output_tokens: data.usage?.output_tokens || 0,
        },
        model: data.model || model,
      }, model);
    });
  }

  /**
   * Stream a chat completion from the Anthropic Messages API.
   *
   * Opens an SSE connection and routes each Anthropic event type to the
   * appropriate StreamChunk:
   *
   * - **`message_start`**: Extracts the resolved model name and input token
   *   usage from the initial message envelope.
   * - **`content_block_start`**: Detects new content blocks. For `tool_use`
   *   blocks, initializes a tool call entry and yields `{type:'tool_start'}`.
   *   Text blocks need no special start handling.
   * - **`content_block_delta`**: Routes incremental data. `text_delta` events
   *   yield `{type:'text', text}` and accumulate into the content buffer.
   *   `input_json_delta` events yield `{type:'tool_delta', arguments}` and
   *   append to the corresponding tool call's argument buffer.
   * - **`message_delta`**: Captures output token usage from the final delta.
   * - **`message_stop`**: Signals the end of the stream (no action needed;
   *   the loop exits naturally).
   *
   * After the SSE stream closes, a final `{type:'done', response}` chunk is
   * yielded with the fully assembled ChatResponse.
   *
   * @param {object} request - `{messages, tools?}` in internal format.
   * @param {string} apiKey - Anthropic API key.
   * @param {string} [modelOverride] - Model override (falls back to constructor default).
   * @param {object} [options] - `{max_tokens?, temperature?, signal?}`.
   * @yields {{ type: 'text', text: string } | { type: 'tool_start', index: number, id: string, name: string } | { type: 'tool_delta', index: number, arguments: string } | { type: 'done', response: object }}
   *   StreamChunk objects for progressive rendering and final response assembly.
   * @returns {AsyncGenerator} Async generator of StreamChunk objects.
   */
  async *chatStream(request, apiKey, modelOverride, options = {}) {
    if (!apiKey) throw new Error('Anthropic API key required');
    const model = modelOverride || this.#model;
    const body = { ...this.#buildBody(request, model, options), stream: true };

    const resp = await withRetry(async () => {
      const r = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: this.#headers(apiKey),
        body: JSON.stringify(body),
        signal: options.signal,
      });
      if (!r.ok) throw new Error(`Anthropic ${r.status}: ${await r.text()}`);
      return r;
    });

    let content = '';
    const toolCalls = new Map(); // index → {id, name, arguments}
    let usage = { input_tokens: 0, output_tokens: 0 };
    let resolvedModel = model;

    for await (const { event, data } of readAnthropicSSE(resp)) {
      switch (event) {
        case 'message_start':
          if (data.message?.model) resolvedModel = data.message.model;
          if (data.message?.usage) {
            usage.input_tokens = data.message.usage.input_tokens || 0;
          }
          break;

        case 'content_block_start': {
          const idx = data.index ?? 0;
          const block = data.content_block;
          if (block?.type === 'tool_use') {
            toolCalls.set(idx, { id: block.id, name: block.name, arguments: '' });
            yield { type: 'tool_start', index: idx, id: block.id, name: block.name };
          }
          break;
        }

        case 'content_block_delta': {
          const idx = data.index ?? 0;
          const delta = data.delta;
          if (delta?.type === 'text_delta' && delta.text) {
            content += delta.text;
            yield { type: 'text', text: delta.text };
          } else if (delta?.type === 'input_json_delta' && delta.partial_json) {
            const tc = toolCalls.get(idx);
            if (tc) {
              tc.arguments += delta.partial_json;
              yield { type: 'tool_delta', index: idx, arguments: delta.partial_json };
            }
          }
          break;
        }

        case 'message_delta':
          if (data.usage) {
            usage.output_tokens = data.usage.output_tokens || 0;
          }
          break;

        case 'message_stop':
          break;
      }
    }

    const tool_calls = [...toolCalls.values()].filter(tc => tc.name);

    yield {
      type: 'done',
      response: validateChatResponse({ content, tool_calls, usage, model: resolvedModel }, resolvedModel),
    };
  }
}

// ── OpenAI-Compatible Provider ────────────────────────────────────
// Works with any endpoint that implements the OpenAI Chat Completions API.

export class OpenAICompatibleProvider extends LLMProvider {
  #name;
  #baseUrl;
  #defaultModel;
  #displayName;
  #needsApiKey;
  #nativeTools;
  #extraHeaders;

  constructor(name, config = {}) {
    super();
    this.#name = name;
    this.#baseUrl = (config.baseUrl || '').replace(/\/+$/, '');
    this.#defaultModel = config.defaultModel || 'default';
    this.#displayName = config.displayName || name;
    this.#needsApiKey = config.requiresApiKey !== false;
    this.#nativeTools = config.nativeTools !== false;
    this.#extraHeaders = config.extraHeaders || {};
  }

  get name() { return this.#name; }
  get displayName() { return this.#displayName; }
  get requiresApiKey() { return this.#needsApiKey; }
  get supportsStreaming() { return true; }
  get supportsNativeTools() { return this.#nativeTools; }

  async isAvailable() {
    if (!this.#baseUrl) return false;
    // Local services: check if reachable
    if (this.#baseUrl.includes('localhost') || this.#baseUrl.includes('127.0.0.1')) {
      try {
        const resp = await fetch(`${this.#baseUrl}/models`, { signal: AbortSignal.timeout(2000) });
        return resp.ok;
      } catch { return false; }
    }
    return true;
  }

  #headers(apiKey) {
    const h = { 'Content-Type': 'application/json', ...this.#extraHeaders };
    if (apiKey) h['Authorization'] = `Bearer ${apiKey}`;
    return h;
  }

  async chat(request, apiKey, modelOverride, options = {}) {
    const model = modelOverride || this.#defaultModel;
    const body = buildOpenAIBody(request, model, options);
    if (!this.#nativeTools) delete body.tools;

    return withRetry(async () => {
      const resp = await fetch(`${this.#baseUrl}/chat/completions`, {
        method: 'POST',
        headers: this.#headers(apiKey),
        body: JSON.stringify(body),
        signal: options.signal,
      });
      if (!resp.ok) throw new Error(`${this.#displayName} ${resp.status}: ${await resp.text()}`);
      return parseOpenAIResponse(await resp.json(), model);
    });
  }

  async *chatStream(request, apiKey, modelOverride, options = {}) {
    const model = modelOverride || this.#defaultModel;
    const body = { ...buildOpenAIBody(request, model, options), stream: true, stream_options: { include_usage: true } };
    if (!this.#nativeTools) delete body.tools;

    const displayName = this.#displayName;
    const resp = await withRetry(async () => {
      const r = await fetch(`${this.#baseUrl}/chat/completions`, {
        method: 'POST',
        headers: this.#headers(apiKey),
        body: JSON.stringify(body),
        signal: options.signal,
      });
      if (!r.ok) throw new Error(`${displayName} ${r.status}: ${await r.text()}`);
      return r;
    });

    yield* streamOpenAI(resp, model);
  }
}

// ── OpenAI-Compatible Service Configs ─────────────────────────────

export const OPENAI_COMPATIBLE_SERVICES = {
  groq: {
    baseUrl: 'https://api.groq.com/openai/v1',
    defaultModel: 'llama-3.3-70b-versatile',
    displayName: 'Groq',
  },
  openrouter: {
    baseUrl: 'https://openrouter.ai/api/v1',
    defaultModel: 'meta-llama/llama-3.3-70b-instruct',
    displayName: 'OpenRouter',
  },
  together: {
    baseUrl: 'https://api.together.xyz/v1',
    defaultModel: 'meta-llama/Meta-Llama-3.1-70B-Instruct-Turbo',
    displayName: 'Together AI',
  },
  fireworks: {
    baseUrl: 'https://api.fireworks.ai/inference/v1',
    defaultModel: 'accounts/fireworks/models/llama-v3p1-70b-instruct',
    displayName: 'Fireworks AI',
  },
  mistral: {
    baseUrl: 'https://api.mistral.ai/v1',
    defaultModel: 'mistral-small-latest',
    displayName: 'Mistral AI',
  },
  deepseek: {
    baseUrl: 'https://api.deepseek.com',
    defaultModel: 'deepseek-chat',
    displayName: 'DeepSeek',
  },
  xai: {
    baseUrl: 'https://api.x.ai/v1',
    defaultModel: 'grok-2-latest',
    displayName: 'xAI (Grok)',
  },
  perplexity: {
    baseUrl: 'https://api.perplexity.ai',
    defaultModel: 'sonar',
    displayName: 'Perplexity',
    nativeTools: false,
  },
  ollama: {
    baseUrl: 'http://localhost:11434/v1',
    defaultModel: 'llama3.2',
    displayName: 'Ollama (local)',
    requiresApiKey: false,
  },
  lmstudio: {
    baseUrl: 'http://localhost:1234/v1',
    defaultModel: 'default',
    displayName: 'LM Studio (local)',
    requiresApiKey: false,
  },
};

// ── ai.matey Provider (lazy CDN import) ───────────────────────────
// Wraps ai.matey Bridge for backends not covered by built-in providers.
// Lazily imports from esm.sh CDN on first use.

let _mateyModules = null;

async function getMateyModules() {
  if (_mateyModules) return _mateyModules;
  try {
    const [coreModule, frontendModule, backendModule, browserModule] = await Promise.all([
      import('ai.matey.core'),
      import('ai.matey.frontend'),
      import('ai.matey.backend'),
      import('ai.matey.backend.browser'),
    ]);
    _mateyModules = { core: coreModule, frontend: frontendModule, backend: backendModule, browser: browserModule };
    return _mateyModules;
  } catch (e) {
    throw new Error(`Failed to load ai.matey from CDN: ${e.message}`);
  }
}

export class MateyProvider extends LLMProvider {
  #backendType;
  #config;
  #bridge = null;

  constructor(backendType, config = {}) {
    super();
    this.#backendType = backendType;
    this.#config = config;
  }

  get name() { return `matey-${this.#backendType}`; }
  get displayName() { return `ai.matey (${this.#backendType})`; }
  get requiresApiKey() { return true; }
  get supportsStreaming() { return true; }
  get supportsNativeTools() { return true; }

  async #getBridge(apiKey) {
    if (this.#bridge) return this.#bridge;
    const modules = await getMateyModules();
    const { Bridge } = modules.core;

    // Use OpenAI frontend adapter for consistent request format
    const frontendAdapters = modules.frontend;
    const FrontendAdapter = frontendAdapters.OpenAIFrontendAdapter ||
      Object.values(frontendAdapters).find(v => typeof v === 'function' && v.name?.includes('Frontend'));

    // Load backend adapter
    let BackendAdapter;
    if (this.#backendType === 'chrome-ai') {
      BackendAdapter = modules.browser.ChromeAIBackendAdapter ||
        Object.values(modules.browser).find(v => typeof v === 'function' && v.name?.includes('ChromeAI'));
    } else {
      BackendAdapter = modules.backend[`${this.#backendType}BackendAdapter`] ||
        Object.values(modules.backend).find(v =>
          typeof v === 'function' && v.name?.toLowerCase().includes(this.#backendType));
    }

    if (!BackendAdapter) throw new Error(`ai.matey backend not found: ${this.#backendType}`);

    const backendConfig = { apiKey, browserMode: true, ...this.#config };
    this.#bridge = new Bridge(new FrontendAdapter(), new BackendAdapter(backendConfig));
    return this.#bridge;
  }

  async chat(request, apiKey, modelOverride, options = {}) {
    const bridge = await this.#getBridge(apiKey);
    const model = modelOverride || this.#config.model || 'default';

    const messages = (request.messages || []).map(m => ({
      role: m.role,
      content: m.content,
    }));

    const chatRequest = { model, messages, max_tokens: options.max_tokens || 4096 };
    if (request.tools?.length > 0) {
      chatRequest.tools = request.tools.map(t => ({
        type: 'function',
        function: { name: t.name, description: t.description || '', parameters: t.parameters || {} },
      }));
    }

    const resp = await bridge.chat(chatRequest);
    const choice = resp.choices?.[0];

    return {
      content: choice?.message?.content || '',
      tool_calls: (choice?.message?.tool_calls || []).map(tc => ({
        id: tc.id,
        name: tc.function?.name || tc.name,
        arguments: typeof tc.function?.arguments === 'string' ? tc.function.arguments : JSON.stringify(tc.function?.arguments || tc.input || {}),
      })),
      usage: {
        input_tokens: resp.usage?.prompt_tokens || resp.usage?.promptTokens || 0,
        output_tokens: resp.usage?.completion_tokens || resp.usage?.completionTokens || 0,
      },
      model: resp.model || model,
    };
  }

  async *chatStream(request, apiKey, modelOverride, options = {}) {
    const bridge = await this.#getBridge(apiKey);
    const model = modelOverride || this.#config.model || 'default';

    const messages = (request.messages || []).map(m => ({ role: m.role, content: m.content }));
    const chatRequest = { model, messages, stream: true, max_tokens: options.max_tokens || 4096 };

    let content = '';
    try {
      for await (const chunk of bridge.chatStream(chatRequest)) {
        if (options.signal?.aborted) break;
        const delta = chunk.choices?.[0]?.delta;
        if (delta?.content) {
          content += delta.content;
          yield { type: 'text', text: delta.content };
        }
      }
    } catch (e) {
      yield { type: 'error', error: e.message };
    }

    const inputChars = (request.messages || []).reduce((sum, m) => sum + (typeof m.content === 'string' ? m.content.length : JSON.stringify(m.content).length), 0);
    yield {
      type: 'done',
      response: {
        content,
        tool_calls: [],
        usage: { input_tokens: Math.round(inputChars / 4), output_tokens: Math.round(content.length / 4) },
        model,
      },
    };
  }

  /** Reset cached bridge (e.g., when API key changes) */
  reset() { this.#bridge = null; }
}

// ── Provider Registry ─────────────────────────────────────────────

export class ProviderRegistry {
  /** @type {Map<string, LLMProvider>} */
  #providers = new Map();

  register(provider) {
    this.#providers.set(provider.name, provider);
  }

  get(name) {
    return this.#providers.get(name) || null;
  }

  has(name) {
    return this.#providers.has(name);
  }

  names() {
    return [...this.#providers.keys()];
  }

  async listWithAvailability() {
    const results = [];
    for (const [name, provider] of this.#providers) {
      let available;
      try { available = await provider.isAvailable(); }
      catch (e) { console.debug('[clawser] provider availability check failed:', name, e); available = false; }
      results.push({
        name,
        displayName: provider.displayName,
        available,
        requiresApiKey: provider.requiresApiKey,
        supportsStreaming: provider.supportsStreaming,
        supportsNativeTools: provider.supportsNativeTools,
      });
    }
    return results;
  }

  async getBestAvailable() {
    const chromeAi = this.#providers.get('chrome-ai');
    if (chromeAi && await chromeAi.isAvailable()) return chromeAi;
    return this.#providers.get('echo') || null;
  }
}

// ── Factory ───────────────────────────────────────────────────────

export function createDefaultProviders() {
  const registry = new ProviderRegistry();

  // Tier 1: Built-in
  registry.register(new EchoProvider());
  registry.register(new ChromeAIProvider());
  registry.register(new OpenAIProvider());
  registry.register(new AnthropicProvider());

  // Tier 2: OpenAI-compatible services
  for (const [name, config] of Object.entries(OPENAI_COMPATIBLE_SERVICES)) {
    registry.register(new OpenAICompatibleProvider(name, config));
  }

  return registry;
}

export { readSSE, readAnthropicSSE };
