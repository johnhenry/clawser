/**
 * @clawser/core — Portable base classes for the Clawser browser agent.
 *
 * Re-exports the foundational primitives that downstream packages and
 * integrations build on. Every class here is a clean, dependency-free
 * ES module export suitable for both browser and Node.js environments.
 *
 * Exports:
 *   ClawserAgent   — Stub agent with message/run lifecycle
 *   HookPipeline   — Ordered async middleware chain
 *   EventLog       — Append-only event store with query/filter
 *   BrowserTool    — Base class for agent tools
 *   LLMProvider    — Base class for LLM provider adapters
 */

// ── EventLog ─────────────────────────────────────────────────────
// Append-only event log for event-sourced persistence.
// All conversation state can be derived from this single stream.

export class EventLog {
  #events = [];
  #seq = 0;
  #maxSize;

  /**
   * @param {object} [opts]
   * @param {number} [opts.maxSize] - Maximum events to retain (0 = unlimited)
   */
  constructor(opts = {}) {
    this.#maxSize = opts.maxSize || 0;
  }

  /**
   * Append a new event.
   * @param {string} type - Event type (user_message, agent_message, tool_call, etc.)
   * @param {object} data - Type-specific payload
   * @param {string} [source='system'] - Origin: 'agent' | 'user' | 'system'
   * @returns {object} The created event
   */
  append(type, data, source = 'system') {
    const event = {
      id: `evt_${Date.now()}_${this.#seq++}`,
      type,
      timestamp: Date.now(),
      data,
      source,
    };
    this.#events.push(event);
    if (this.#maxSize > 0 && this.#events.length > this.#maxSize) {
      this.#events.splice(0, this.#events.length - this.#maxSize);
    }
    return event;
  }

  /**
   * Query events with optional filters.
   * @param {object} [filters]
   * @param {string} [filters.type] - Filter by event type
   * @param {string} [filters.source] - Filter by source
   * @param {number} [filters.since] - Only events after this timestamp
   * @param {number} [filters.limit] - Max number of events to return
   * @returns {object[]}
   */
  query(filters = {}) {
    let result = [...this.#events];
    if (filters.type) result = result.filter(e => e.type === filters.type);
    if (filters.source) result = result.filter(e => e.source === filters.source);
    if (filters.since) result = result.filter(e => e.timestamp > filters.since);
    if (filters.limit) result = result.slice(-filters.limit);
    return result;
  }

  /** @returns {number} Total event count */
  get length() { return this.#events.length; }

  /** Clear all events. */
  clear() {
    this.#events = [];
    this.#seq = 0;
  }

  /**
   * Serialize to JSONL string.
   * @returns {string}
   */
  toJSONL() {
    return this.#events.map(e => JSON.stringify(e)).join('\n');
  }

  /**
   * Load from JSONL string, appending to current events.
   * @param {string} jsonl
   */
  fromJSONL(jsonl) {
    const lines = jsonl.split('\n').filter(l => l.trim());
    for (const line of lines) {
      try {
        const event = JSON.parse(line);
        this.#events.push(event);
        this.#seq++;
      } catch {
        // skip malformed lines
      }
    }
  }
}

// ── HookPipeline ─────────────────────────────────────────────────
// Ordered async middleware chain. Each hook receives a context object
// and returns the (possibly modified) context for the next hook.

export class HookPipeline {
  /** @type {Map<string, Array<Function>>} */
  #hooks = new Map();

  /**
   * Register a hook function for a named stage.
   * @param {string} stage - Pipeline stage name (e.g. 'before_send', 'after_response')
   * @param {Function} fn - async (context) => context
   */
  register(stage, fn) {
    if (!this.#hooks.has(stage)) this.#hooks.set(stage, []);
    this.#hooks.get(stage).push(fn);
  }

  /**
   * Remove a previously registered hook.
   * @param {string} stage
   * @param {Function} fn
   */
  unregister(stage, fn) {
    const hooks = this.#hooks.get(stage);
    if (!hooks) return;
    const idx = hooks.indexOf(fn);
    if (idx >= 0) hooks.splice(idx, 1);
  }

  /**
   * Run all hooks for a stage in registration order.
   * @param {string} stage
   * @param {object} context
   * @returns {Promise<object>} Final context after all hooks
   */
  async run(stage, context) {
    const hooks = this.#hooks.get(stage);
    if (!hooks || hooks.length === 0) return context;
    let ctx = context;
    for (const fn of hooks) {
      ctx = await fn(ctx);
    }
    return ctx;
  }

  /**
   * List registered stages.
   * @returns {string[]}
   */
  stages() {
    return [...this.#hooks.keys()];
  }

  /** Clear all hooks. */
  clear() {
    this.#hooks.clear();
  }
}

// ── BrowserTool ──────────────────────────────────────────────────
// Base class for agent-callable tools. Subclasses override name,
// description, parameters, and execute().

export class BrowserTool {
  /** @returns {object} ToolSpec-compatible descriptor */
  get spec() {
    return {
      name: this.name,
      description: this.description,
      parameters: this.parameters,
      required_permission: this.permission,
    };
  }

  /** @returns {string} Tool name (must be unique) */
  get name() { throw new Error('implement name'); }

  /** @returns {string} Human-readable description */
  get description() { throw new Error('implement description'); }

  /** @returns {object} JSON Schema for parameters */
  get parameters() { return { type: 'object', properties: {} }; }

  /**
   * Permission level: 'auto' | 'approve' | 'denied' | 'internal' |
   * 'read' | 'write' | 'browser' | 'network'
   */
  get permission() { return 'internal'; }

  /** Whether this tool is idempotent (safe to retry). */
  get idempotent() { return false; }

  /**
   * Execute the tool.
   * @param {object} params - Parsed JSON parameters
   * @returns {Promise<{success: boolean, output: string, error?: string}>}
   */
  async execute(params) {
    throw new Error('implement execute');
  }
}

// ── LLMProvider ──────────────────────────────────────────────────
// Base class for LLM provider adapters. Each provider must implement
// at minimum chat(). Streaming and native tool support are optional.

export class LLMProvider {
  /** @returns {string} Provider identifier */
  get id() { return 'base'; }

  /** @returns {string} Human-readable name */
  get displayName() { return 'Base Provider'; }

  /** @returns {boolean} Whether this provider supports streaming responses */
  get supportsStreaming() { return false; }

  /** @returns {boolean} Whether this provider supports native tool calling */
  get supportsNativeTools() { return false; }

  /**
   * Send a chat completion request.
   * @param {Array<{role: string, content: string}>} messages
   * @param {object} [opts] - { model, max_tokens, temperature, tools }
   * @returns {Promise<{content: string, tool_calls: Array, usage: object, model: string}>}
   */
  async chat(messages, opts = {}) {
    throw new Error('implement chat');
  }

  /**
   * Stream a chat completion. Override if supportsStreaming is true.
   * @param {Array<{role: string, content: string}>} messages
   * @param {object} [opts]
   * @yields {{type: string, text?: string, response?: object}}
   */
  async *chatStream(messages, opts = {}) {
    // Default: fall back to blocking chat
    const response = await this.chat(messages, opts);
    yield { type: 'text', text: response.content };
    yield { type: 'done', response };
  }

  /**
   * List available models for this provider.
   * @returns {Promise<string[]>}
   */
  async listModels() { return []; }
}

// ── ClawserAgent ─────────────────────────────────────────────────
// Stub agent class for the npm package. Provides the public API surface
// that integrations can build against without pulling the full runtime.

export class ClawserAgent {
  #history = [];
  #systemPrompt = '';
  #hooks = new HookPipeline();
  #eventLog = new EventLog();

  /**
   * Set the system prompt.
   * @param {string} prompt
   */
  setSystemPrompt(prompt) {
    this.#systemPrompt = prompt;
  }

  /** @returns {string} Current system prompt */
  get systemPrompt() { return this.#systemPrompt; }

  /** @returns {EventLog} The event log */
  get eventLog() { return this.#eventLog; }

  /** @returns {HookPipeline} The hook pipeline */
  get hooks() { return this.#hooks; }

  /**
   * Add a user message to the conversation history.
   * @param {string} content
   */
  sendMessage(content) {
    this.#history.push({ role: 'user', content });
    this.#eventLog.append('user_message', { content }, 'user');
  }

  /**
   * Run the agent loop. In this stub, returns the last user message
   * echoed back. Real implementations override with LLM calls.
   * @returns {Promise<{content: string, tool_calls: Array}>}
   */
  async run() {
    const lastMsg = this.#history[this.#history.length - 1];
    const content = lastMsg ? `Echo: ${lastMsg.content}` : '';
    this.#history.push({ role: 'assistant', content });
    this.#eventLog.append('agent_message', { content }, 'agent');
    return { content, tool_calls: [] };
  }

  /**
   * Get conversation history.
   * @returns {Array<{role: string, content: string}>}
   */
  get history() { return [...this.#history]; }

  /** Clear conversation history. */
  clearHistory() {
    this.#history = [];
  }
}
