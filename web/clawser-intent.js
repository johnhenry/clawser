// clawser-intent.js — Intent Router
//
// MessageIntent: classification enum for user messages
// IntentRouter: pattern-based + heuristic message classification
// PIPELINE_CONFIG: per-intent execution pipeline configuration
// IntentClassifyTool: agent tool for intent inspection

import { BrowserTool } from './clawser-tools.js';

// ── MessageIntent ───────────────────────────────────────────────

export const MessageIntent = Object.freeze({
  COMMAND: 'command',
  QUERY:   'query',
  TASK:    'task',
  CHAT:    'chat',
  SYSTEM:  'system',
});

// ── Pipeline Config ─────────────────────────────────────────────

export const PIPELINE_CONFIG = Object.freeze({
  [MessageIntent.COMMAND]: {
    useMemory: false,
    useTools: false,
    useLLM: false,
    modelHint: null,
    maxTokens: 0,
    useGoals: false,
    skipUI: false,
  },
  [MessageIntent.QUERY]: {
    useMemory: true,
    useTools: false,
    useLLM: true,
    modelHint: 'fast',
    maxTokens: 1024,
    useGoals: false,
    skipUI: false,
  },
  [MessageIntent.TASK]: {
    useMemory: true,
    useTools: true,
    useLLM: true,
    modelHint: 'smart',
    maxTokens: 4096,
    useGoals: true,
    skipUI: false,
  },
  [MessageIntent.CHAT]: {
    useMemory: false,
    useTools: false,
    useLLM: true,
    modelHint: 'fast',
    maxTokens: 256,
    useGoals: false,
    skipUI: false,
  },
  [MessageIntent.SYSTEM]: {
    useMemory: true,
    useTools: true,
    useLLM: true,
    modelHint: 'fast',
    maxTokens: 2048,
    useGoals: false,
    skipUI: true,
  },
});

// ── IntentRouter ────────────────────────────────────────────────

/**
 * Pattern-based + heuristic intent classifier for user messages.
 */
export class IntentRouter {
  /** @type {Array<{intent: string, test: Function}>} */
  #patterns;

  /** @type {Array<{prefix: string, intent: string}>} User-defined overrides */
  #overrides;

  constructor() {
    this.#patterns = [
      // Commands — slash commands
      { intent: MessageIntent.COMMAND, test: (msg) => msg.startsWith('/') },
      // Commands — known keywords
      { intent: MessageIntent.COMMAND, test: (msg) => /^(undo|redo|clear|reset|set\s)/i.test(msg) },

      // System — internal triggers
      { intent: MessageIntent.SYSTEM, test: (_msg, meta) => meta?.source === 'scheduler' },
      { intent: MessageIntent.SYSTEM, test: (_msg, meta) => meta?.source === 'webhook' },
      { intent: MessageIntent.SYSTEM, test: (_msg, meta) => meta?.source === 'routine' },

      // Chat — greetings and short casual messages
      { intent: MessageIntent.CHAT, test: (msg) => /^(hi|hello|hey|thanks|thank you|ok|bye|good\s|goodbye|cheers|sure|yep|nope|cool|great|awesome|nice|lol|haha)/i.test(msg) && msg.length < 30 },
    ];

    this.#overrides = [];
  }

  /**
   * Classify a message into an intent.
   * @param {string} message - User message text
   * @param {object} [meta={}] - Message metadata (source, etc.)
   * @returns {string} MessageIntent value
   */
  classify(message, meta = {}) {
    if (!message || typeof message !== 'string') return MessageIntent.CHAT;

    const trimmed = message.trim();
    if (trimmed.length === 0) return MessageIntent.CHAT;

    // Check user-defined overrides first (e.g. "!task: ...")
    for (const { prefix, intent } of this.#overrides) {
      if (trimmed.startsWith(prefix)) return intent;
    }

    // Check pattern rules
    for (const { intent, test } of this.#patterns) {
      if (test(trimmed, meta)) return intent;
    }

    // Heuristic: short messages starting with question words → query
    if (trimmed.length < 100 && /^(what|who|when|where|how|why|is|are|does|do|can|will|could|would|should|has|have|did)\b/i.test(trimmed)) {
      return MessageIntent.QUERY;
    }

    // Heuristic: messages ending with '?' and < 150 chars → query
    if (trimmed.length < 150 && trimmed.endsWith('?')) {
      return MessageIntent.QUERY;
    }

    // Default: task (safest — gets full pipeline)
    return MessageIntent.TASK;
  }

  /**
   * Get pipeline config for an intent.
   * @param {string} intent - MessageIntent value
   * @returns {object} Pipeline configuration
   */
  getPipelineConfig(intent) {
    return PIPELINE_CONFIG[intent] || PIPELINE_CONFIG[MessageIntent.TASK];
  }

  /**
   * Classify and return both intent and pipeline config.
   * @param {string} message
   * @param {object} [meta={}]
   * @returns {{ intent: string, config: object }}
   */
  route(message, meta = {}) {
    const intent = this.classify(message, meta);
    return { intent, config: this.getPipelineConfig(intent) };
  }

  /**
   * Add a custom pattern rule.
   * @param {string} intent - MessageIntent value
   * @param {Function} testFn - (message, meta) => boolean
   */
  addPattern(intent, testFn) {
    if (!Object.values(MessageIntent).includes(intent)) {
      throw new Error(`Invalid intent: ${intent}`);
    }
    this.#patterns.push({ intent, test: testFn });
  }

  /**
   * Add a user-defined prefix override (e.g. "!task:" → TASK).
   * @param {string} prefix
   * @param {string} intent
   */
  addOverride(prefix, intent) {
    if (!Object.values(MessageIntent).includes(intent)) {
      throw new Error(`Invalid intent: ${intent}`);
    }
    this.#overrides.push({ prefix, intent });
  }

  /**
   * Remove a user-defined prefix override.
   * @param {string} prefix
   * @returns {boolean} true if found and removed
   */
  removeOverride(prefix) {
    const idx = this.#overrides.findIndex(o => o.prefix === prefix);
    if (idx < 0) return false;
    this.#overrides.splice(idx, 1);
    return true;
  }

  /**
   * Remove all custom patterns (keeps built-in ones from constructor).
   */
  resetPatterns() {
    // Reconstruct default patterns
    this.#patterns = [
      { intent: MessageIntent.COMMAND, test: (msg) => msg.startsWith('/') },
      { intent: MessageIntent.COMMAND, test: (msg) => /^(undo|redo|clear|reset|set\s)/i.test(msg) },
      { intent: MessageIntent.SYSTEM, test: (_msg, meta) => meta?.source === 'scheduler' },
      { intent: MessageIntent.SYSTEM, test: (_msg, meta) => meta?.source === 'webhook' },
      { intent: MessageIntent.SYSTEM, test: (_msg, meta) => meta?.source === 'routine' },
      { intent: MessageIntent.CHAT, test: (msg) => /^(hi|hello|hey|thanks|thank you|ok|bye|good\s|goodbye|cheers|sure|yep|nope|cool|great|awesome|nice|lol|haha)/i.test(msg) && msg.length < 30 },
    ];
    this.#overrides = [];
  }

  /**
   * Strip override prefix from message if present.
   * @param {string} message
   * @returns {string} Message without prefix
   */
  stripOverride(message) {
    const trimmed = (message || '').trim();
    for (const { prefix } of this.#overrides) {
      if (trimmed.startsWith(prefix)) {
        return trimmed.slice(prefix.length).trim();
      }
    }
    return trimmed;
  }

  /** Number of registered patterns (excluding overrides) */
  get patternCount() { return this.#patterns.length; }

  /** Number of registered overrides */
  get overrideCount() { return this.#overrides.length; }
}

// ── LLM-Assisted Classification ─────────────────────────────────

/**
 * Classify a message using LLM for ambiguous cases.
 * Falls back to heuristic for confident classifications.
 *
 * @param {IntentRouter} router - Router for heuristic classification
 * @param {Function} chatFn - (messages, opts) => { content }
 * @param {string} message - User message
 * @param {object} [meta={}]
 * @returns {Promise<string>} MessageIntent value
 */
export async function classifyWithLLM(router, chatFn, message, meta = {}) {
  const heuristic = router.classify(message, meta);

  // Only use LLM for uncertain cases (defaulted to TASK)
  if (heuristic !== MessageIntent.TASK) return heuristic;

  try {
    const prompt = `Classify this user message as exactly one of: command, query, task, chat.\nMessage: "${message}"\nClassification:`;
    const response = await chatFn(
      [{ role: 'user', content: prompt }],
      { modelHint: 'fast', maxTokens: 10 }
    );

    const label = (response.content || '').trim().toLowerCase();
    const mapped = Object.values(MessageIntent).find(v => v === label);
    return mapped || MessageIntent.TASK;
  } catch {
    // LLM failed, fall back to heuristic
    return heuristic;
  }
}

// ── Agent Tools ─────────────────────────────────────────────────

/**
 * Agent tool: classify a message's intent.
 */
export class IntentClassifyTool extends BrowserTool {
  #router;

  constructor(router) {
    super();
    this.#router = router;
  }

  get name() { return 'intent_classify'; }
  get description() { return 'Classify a message into an intent (command, query, task, chat, system) and return pipeline config.'; }
  get parameters() {
    return {
      type: 'object',
      properties: {
        message: { type: 'string', description: 'Message text to classify' },
        source: { type: 'string', description: 'Message source metadata (optional)' },
      },
      required: ['message'],
    };
  }
  get permission() { return 'read'; }

  async execute({ message, source }) {
    const meta = source ? { source } : {};
    const { intent, config } = this.#router.route(message, meta);
    const lines = [
      `Intent: ${intent}`,
      `Pipeline: useLLM=${config.useLLM}, useTools=${config.useTools}, useMemory=${config.useMemory}, useGoals=${config.useGoals || false}`,
      `Model hint: ${config.modelHint || 'default'}`,
      `Max tokens: ${config.maxTokens}`,
    ];
    return { success: true, output: lines.join('\n') };
  }
}

/**
 * Agent tool: add a prefix override for intent routing.
 */
export class IntentOverrideTool extends BrowserTool {
  #router;

  constructor(router) {
    super();
    this.#router = router;
  }

  get name() { return 'intent_add_override'; }
  get description() { return 'Add a prefix override for intent routing (e.g. "!task:" forces TASK intent).'; }
  get parameters() {
    return {
      type: 'object',
      properties: {
        prefix: { type: 'string', description: 'Prefix string (e.g. "!task:")' },
        intent: { type: 'string', enum: ['command', 'query', 'task', 'chat', 'system'], description: 'Intent to route to' },
      },
      required: ['prefix', 'intent'],
    };
  }
  get permission() { return 'approve'; }

  async execute({ prefix, intent }) {
    try {
      this.#router.addOverride(prefix, intent);
      return { success: true, output: `Override added: "${prefix}" → ${intent}` };
    } catch (e) {
      return { success: false, output: '', error: e.message };
    }
  }
}
