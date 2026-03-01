// clawser-fallback.js — Provider Fallback Chains & Model Routing
//
// FallbackChain: ordered list of provider+model entries with retry
// FallbackExecutor: executes async functions through the chain
// ProviderHealth: circuit breaker + latency tracking per provider
// ModelRouter: hint-based model selection with fallback integration

import { classifyError, MODEL_PRICING } from './clawser-providers.js';

// ── FallbackEntry ───────────────────────────────────────────────

/**
 * A single entry in a fallback chain.
 * @typedef {object} FallbackEntry
 * @property {string} providerId
 * @property {string} model
 * @property {number} priority - Lower = tried first
 * @property {number} [maxTokens]
 * @property {boolean} enabled
 */

/**
 * Create a fallback entry with defaults.
 * @param {object} opts
 * @returns {FallbackEntry}
 */
export function createFallbackEntry(opts) {
  return {
    providerId: opts.providerId,
    model: opts.model,
    priority: opts.priority ?? 0,
    maxTokens: opts.maxTokens ?? undefined,
    enabled: opts.enabled !== false,
  };
}

// ── FallbackChain ───────────────────────────────────────────────

/**
 * An ordered list of provider+model pairs for fallback execution.
 */
export class FallbackChain {
  /** @type {FallbackEntry[]} */
  #entries;

  /** Maximum retries per entry before moving to next */
  #maxRetries;

  /** HTTP status codes considered retryable */
  #retryableStatuses;

  /**
   * @param {object} [opts]
   * @param {FallbackEntry[]} [opts.entries=[]]
   * @param {number} [opts.maxRetries=1]
   * @param {number[]} [opts.retryableStatuses=[429,500,502,503]]
   */
  constructor(opts = {}) {
    this.#entries = opts.entries || [];
    this.#maxRetries = opts.maxRetries ?? 1;
    this.#retryableStatuses = new Set(opts.retryableStatuses || [429, 500, 502, 503]);
  }

  /** Get max retries per entry */
  get maxRetries() { return this.#maxRetries; }

  /** Get all entries (sorted by priority) */
  get entries() {
    return [...this.#entries].sort((a, b) => a.priority - b.priority);
  }

  /** Get only enabled entries (sorted by priority) */
  enabledEntries() {
    return this.#entries
      .filter(e => e.enabled)
      .sort((a, b) => a.priority - b.priority);
  }

  /** Add an entry (normalizes defaults) */
  add(entry) {
    this.#entries.push(createFallbackEntry(entry));
  }

  /** Alias for add() */
  addEntry(entry) { this.add(entry); }

  /** Remove an entry by providerId + model */
  remove(providerId, model) {
    this.#entries = this.#entries.filter(
      e => !(e.providerId === providerId && e.model === model)
    );
  }

  /** Toggle an entry's enabled state */
  toggle(providerId, model, enabled) {
    const entry = this.#entries.find(
      e => e.providerId === providerId && e.model === model
    );
    if (entry) entry.enabled = enabled;
  }

  /** Check if an error is retryable */
  isRetryable(err) {
    const classified = classifyError(err);
    return classified.retryable;
  }

  /** Number of entries */
  get length() { return this.#entries.length; }

  /** Serialize to plain object */
  toJSON() {
    return {
      entries: this.#entries,
      maxRetries: this.#maxRetries,
      retryableStatuses: [...this.#retryableStatuses],
    };
  }

  /** Deserialize from plain object */
  static fromJSON(data) {
    return new FallbackChain({
      entries: data.entries || [],
      maxRetries: data.maxRetries,
      retryableStatuses: data.retryableStatuses,
    });
  }
}

// ── Backoff ─────────────────────────────────────────────────────

/**
 * Exponential backoff with jitter.
 * @param {number} attempt - 0-based attempt number
 * @param {number} [base=500] - Base delay in ms
 * @param {number} [max=10000] - Max delay in ms
 * @returns {number} Delay in ms
 */
export function backoff(attempt, base = 500, max = 10000) {
  const delay = Math.min(base * Math.pow(2, attempt), max);
  return delay + Math.random() * delay * 0.1; // 10% jitter
}

/**
 * Sleep for a duration.
 * @param {number} ms
 * @returns {Promise<void>}
 */
export function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

// ── FallbackExecutor ────────────────────────────────────────────

/**
 * Executes an async function through a fallback chain.
 * Tries each entry in order, retrying retryable errors.
 */
export class FallbackExecutor {
  /** @type {FallbackChain} */
  #chain;

  /** @type {ProviderHealth|null} */
  #health;

  /** @type {Function|null} */
  #onLog;

  /** @type {import('./clawser-metrics.js').MetricsCollector|null} */
  #metrics;

  /**
   * @param {FallbackChain} chain
   * @param {object} [opts]
   * @param {ProviderHealth} [opts.health]
   * @param {Function} [opts.onLog] - (level, message) callback
   * @param {import('./clawser-metrics.js').MetricsCollector} [opts.metricsCollector]
   */
  constructor(chain, opts = {}) {
    this.#chain = chain;
    this.#health = opts.health || null;
    this.#onLog = opts.onLog || null;
    this.#metrics = opts.metricsCollector || null;
  }

  /**
   * Execute a function through the fallback chain.
   * @param {(providerId: string, model: string, maxTokens?: number) => Promise<any>} fn
   * @returns {Promise<{result: any, providerId: string, model: string}>}
   */
  async execute(fn) {
    let entries = this.#chain.enabledEntries();

    // Reorder based on health (move circuit-open entries to the end)
    if (this.#health) {
      entries = this.#health.reorder(entries);
    }

    let lastError = null;

    for (const entry of entries) {
      // Skip if circuit is open
      if (this.#health?.isCircuitOpen(entry.providerId, entry.model)) {
        this.#log(1, `Skipping ${entry.providerId}/${entry.model} (circuit open)`);
        continue;
      }

      for (let attempt = 0; attempt <= this.#chain.maxRetries; attempt++) {
        this.#metrics?.increment('fallback.attempts');
        this.#metrics?.increment(`fallback.attempts.${entry.providerId}`);
        const start = performance.now();
        try {
          const result = await fn(entry.providerId, entry.model, entry.maxTokens);
          const duration = performance.now() - start;
          this.#health?.recordSuccess(entry.providerId, entry.model, duration);
          this.#metrics?.increment('fallback.successes');
          this.#metrics?.increment(`fallback.successes.${entry.providerId}`);
          return { result, providerId: entry.providerId, model: entry.model };
        } catch (err) {
          const duration = performance.now() - start;
          lastError = err;
          this.#health?.recordFailure(entry.providerId, entry.model, duration);
          this.#metrics?.increment('fallback.failures');
          this.#metrics?.increment(`fallback.failures.${entry.providerId}`);

          if (!this.#chain.isRetryable(err)) {
            this.#log(2, `Non-retryable error from ${entry.providerId}/${entry.model}: ${err.message}`);
            throw err;
          }

          this.#log(1, `${entry.providerId}/${entry.model} failed (attempt ${attempt + 1}/${this.#chain.maxRetries + 1}): ${err.message}`);

          if (attempt < this.#chain.maxRetries) {
            await sleep(backoff(attempt));
          }
        }
      }
      // Entry exhausted, move to next
    }

    throw lastError || new Error('All providers in fallback chain exhausted');
  }

  /**
   * Execute a streaming function through the fallback chain.
   * @param {(providerId: string, model: string, maxTokens?: number) => AsyncGenerator} fn
   * @returns {AsyncGenerator<{chunk: any, providerId: string, model: string}>}
   */
  async *executeStream(fn) {
    let entries = this.#chain.enabledEntries();
    if (this.#health) entries = this.#health.reorder(entries);

    let lastError = null;

    for (const entry of entries) {
      if (this.#health?.isCircuitOpen(entry.providerId, entry.model)) {
        continue;
      }

      const start = performance.now();
      try {
        const gen = fn(entry.providerId, entry.model, entry.maxTokens);
        for await (const chunk of gen) {
          yield { chunk, providerId: entry.providerId, model: entry.model };
        }
        const duration = performance.now() - start;
        this.#health?.recordSuccess(entry.providerId, entry.model, duration);
        return; // Success — stop trying other entries
      } catch (err) {
        const duration = performance.now() - start;
        lastError = err;
        this.#health?.recordFailure(entry.providerId, entry.model, duration);

        if (!this.#chain.isRetryable(err)) throw err;
        this.#log(1, `Stream fallback: ${entry.providerId}/${entry.model} failed`);
      }
    }

    throw lastError || new Error('All providers in fallback chain exhausted');
  }

  #log(level, message) {
    if (this.#onLog) this.#onLog(level, message);
  }
}

// ── ProviderHealth ──────────────────────────────────────────────

/**
 * Tracks provider health and implements circuit breaker pattern.
 */
export class ProviderHealth {
  /** @type {Map<string, HealthRecord>} key = providerId/model */
  #records = new Map();

  /** Failures before circuit opens */
  #failureThreshold;

  /** Time window for counting failures (ms) */
  #failureWindow;

  /** How long circuit stays open (ms) */
  #cooldown;

  /**
   * @param {object} [opts]
   * @param {number} [opts.failureThreshold=3]
   * @param {number} [opts.failureWindow=60000]
   * @param {number} [opts.cooldown=30000]
   */
  constructor(opts = {}) {
    this.#failureThreshold = opts.failureThreshold ?? 3;
    this.#failureWindow = opts.failureWindow ?? 60000;
    this.#cooldown = opts.cooldown ?? 30000;
  }

  #key(providerId, model) { return `${providerId}/${model}`; }

  #getOrCreate(providerId, model) {
    const key = this.#key(providerId, model);
    if (!this.#records.has(key)) {
      this.#records.set(key, {
        providerId,
        model,
        successCount: 0,
        failureCount: 0,
        recentFailures: [],
        lastFailure: 0,
        avgLatencyMs: 0,
        latencySamples: 0,
        circuitOpen: false,
        circuitResetAt: 0,
      });
    }
    return this.#records.get(key);
  }

  /**
   * Record a successful call.
   */
  recordSuccess(providerId, model, durationMs) {
    const r = this.#getOrCreate(providerId, model);
    r.successCount++;
    // Rolling average latency
    r.latencySamples++;
    r.avgLatencyMs += (durationMs - r.avgLatencyMs) / r.latencySamples;
    // Success resets circuit
    if (r.circuitOpen) {
      r.circuitOpen = false;
      r.circuitResetAt = 0;
    }
  }

  /**
   * Record a failed call.
   */
  recordFailure(providerId, model, durationMs) {
    const r = this.#getOrCreate(providerId, model);
    r.failureCount++;
    r.lastFailure = Date.now();
    if (durationMs != null) {
      r.latencySamples++;
      r.avgLatencyMs += (durationMs - r.avgLatencyMs) / r.latencySamples;
    }

    // Track recent failures within window
    const now = Date.now();
    r.recentFailures.push(now);
    r.recentFailures = r.recentFailures.filter(t => now - t < this.#failureWindow);

    // Check circuit breaker threshold
    if (r.recentFailures.length >= this.#failureThreshold && !r.circuitOpen) {
      r.circuitOpen = true;
      r.circuitResetAt = now + this.#cooldown;
    }
  }

  /**
   * Check if a provider's circuit breaker is open.
   */
  isCircuitOpen(providerId, model) {
    const r = this.#records.get(this.#key(providerId, model));
    if (!r || !r.circuitOpen) return false;

    // Check if cooldown has elapsed
    if (Date.now() >= r.circuitResetAt) {
      r.circuitOpen = false;
      r.circuitResetAt = 0;
      return false;
    }

    return true;
  }

  /**
   * Get health record for a provider.
   * @returns {object|null}
   */
  getHealth(providerId, model) {
    const r = this.#records.get(this.#key(providerId, model));
    if (!r) return null;
    return {
      providerId: r.providerId,
      model: r.model,
      successCount: r.successCount,
      failureCount: r.failureCount,
      lastFailure: r.lastFailure,
      avgLatencyMs: Math.round(r.avgLatencyMs),
      circuitOpen: this.isCircuitOpen(providerId, model),
    };
  }

  /**
   * Reorder fallback entries: healthy first, circuit-open last.
   * @param {FallbackEntry[]} entries
   * @returns {FallbackEntry[]}
   */
  reorder(entries) {
    return [...entries].sort((a, b) => {
      const aOpen = this.isCircuitOpen(a.providerId, a.model) ? 1 : 0;
      const bOpen = this.isCircuitOpen(b.providerId, b.model) ? 1 : 0;
      if (aOpen !== bOpen) return aOpen - bOpen;
      return a.priority - b.priority;
    });
  }

  /** Reset all health data */
  reset() {
    this.#records.clear();
  }
}

// ── Model Router ────────────────────────────────────────────────

/** Well-known model hints */
export const HINT_MODELS = {
  smart: {
    anthropic: 'claude-sonnet-4-6',
    openai: 'gpt-4o',
    deepseek: 'deepseek-reasoner',
    mistral: 'mistral-large-latest',
  },
  fast: {
    groq: 'llama-3.3-70b-versatile',
    openai: 'gpt-4o-mini',
    anthropic: 'claude-haiku-4-5-20251001',
    mistral: 'mistral-small-latest',
  },
  code: {
    openai: 'gpt-4o',
    deepseek: 'deepseek-chat',
    anthropic: 'claude-sonnet-4-6',
  },
  cheap: {
    groq: 'llama-3.1-8b-instant',
    deepseek: 'deepseek-chat',
    mistral: 'mistral-small-latest',
    openai: 'gpt-4.1-nano',
  },
  local: {
    'chrome-ai': 'chrome-ai',
    ollama: 'llama3.2',
    'lm-studio': 'default',
  },
};

/**
 * Resolves semantic hints to concrete fallback chains.
 */
export class ModelRouter {
  /** @type {Map<string, FallbackChain>} hint → chain */
  #chains = new Map();

  /** @type {FallbackChain|null} Default chain */
  #defaultChain = null;

  /** @type {Map<string, {successes: number, failures: number, totalDuration: number}>} model:hint → stats */
  #outcomes = new Map();

  /**
   * Register a fallback chain for a hint.
   * @param {string} hint - e.g. 'smart', 'fast', 'code', 'cheap', 'local'
   * @param {FallbackChain} chain
   */
  setChain(hint, chain) {
    this.#chains.set(hint, chain);
  }

  /**
   * Get the chain for a hint, falling back to default.
   * @param {string} [hint]
   * @returns {FallbackChain|null}
   */
  getChain(hint) {
    if (hint && this.#chains.has(hint)) return this.#chains.get(hint);
    return this.#defaultChain;
  }

  /** Set the default chain (used when no hint matches) */
  set defaultChain(chain) { this.#defaultChain = chain; }
  get defaultChain() { return this.#defaultChain; }

  /** List registered hints */
  get hints() { return [...this.#chains.keys()]; }

  /**
   * Build default chains from a list of configured provider IDs.
   * @param {string[]} providerIds - e.g. ['openai', 'anthropic', 'groq']
   */
  buildDefaults(providerIds) {
    const idSet = new Set(providerIds);

    for (const [hint, providerModels] of Object.entries(HINT_MODELS)) {
      const entries = [];
      let priority = 0;
      for (const [pid, model] of Object.entries(providerModels)) {
        if (idSet.has(pid)) {
          entries.push(createFallbackEntry({ providerId: pid, model, priority: priority++ }));
        }
      }
      if (entries.length > 0) {
        this.#chains.set(hint, new FallbackChain({ entries }));
      }
    }

    // Set 'smart' as default if available, else first available
    this.#defaultChain = this.#chains.get('smart') || this.#chains.values().next().value || null;
  }

  // ── Dynamic Hint Selection ─────────────────────────────────────

  /**
   * Select a hint based on task complexity analysis.
   * @param {object} context
   * @param {string} context.text - User message text
   * @param {number} [context.toolCount=0] - Number of tools requested/likely
   * @param {boolean} [context.hasCode=false] - Whether task involves code
   * @returns {string} Hint: 'fast', 'smart', 'code', 'cheap'
   */
  selectHint({ text = '', toolCount = 0, hasCode = false } = {}) {
    const wordCount = text.split(/\s+/).length;
    const hasMultipleTasks = /\band\b.*\band\b|,.*,/i.test(text);
    const codeKeywords = /\b(function|implement|refactor|debug|code|class|algorithm|test|API)\b/i;

    // Code-heavy tasks
    if (hasCode || codeKeywords.test(text)) {
      if (wordCount > 50 || toolCount > 3) return 'smart';
      return 'code';
    }

    // Complex multi-step tasks
    if (toolCount > 3 || (wordCount > 50 && hasMultipleTasks)) return 'smart';

    // Medium complexity
    if (wordCount > 20 || toolCount > 1) return 'smart';

    // Simple queries
    return 'fast';
  }

  // ── Adaptive Model Selection ──────────────────────────────────

  /**
   * Record the outcome of a model invocation for learning.
   * @param {object} outcome
   * @param {string} outcome.model - Model ID
   * @param {string} outcome.hint - Hint used
   * @param {boolean} outcome.success - Whether invocation succeeded
   * @param {number} [outcome.durationMs=0] - Response time
   */
  recordOutcome({ model, hint, success, durationMs = 0 }) {
    const key = `${model}:${hint}`;
    let stats = this.#outcomes.get(key);
    if (!stats) {
      stats = { successes: 0, failures: 0, totalDuration: 0 };
      this.#outcomes.set(key, stats);
    }
    if (success) stats.successes++;
    else stats.failures++;
    stats.totalDuration += durationMs;
  }

  /**
   * Get performance stats for a model+hint combination.
   * @param {string} model
   * @param {string} hint
   * @returns {{successes: number, failures: number, avgDuration: number}|null}
   */
  modelStats(model, hint) {
    const key = `${model}:${hint}`;
    const stats = this.#outcomes.get(key);
    if (!stats) return null;
    const total = stats.successes + stats.failures;
    return {
      successes: stats.successes,
      failures: stats.failures,
      avgDuration: total > 0 ? Math.round(stats.totalDuration / total) : 0,
    };
  }

  /**
   * Serialize all chains.
   * @returns {object}
   */
  toJSON() {
    const obj = {};
    for (const [hint, chain] of this.#chains) {
      obj[hint] = chain.toJSON();
    }
    return obj;
  }

  /**
   * Deserialize chains.
   * @param {object} data
   */
  static fromJSON(data) {
    const router = new ModelRouter();
    for (const [hint, chainData] of Object.entries(data)) {
      router.setChain(hint, FallbackChain.fromJSON(chainData));
    }
    return router;
  }
}

// ── Cost-Aware Sorting ──────────────────────────────────────────

/**
 * Sort fallback entries by cost within the same quality tier.
 * @param {FallbackEntry[]} entries
 * @returns {FallbackEntry[]}
 */
export function costAwareSort(entries) {
  return [...entries].sort((a, b) => {
    const costA = MODEL_PRICING[a.model]?.input || Infinity;
    const costB = MODEL_PRICING[b.model]?.input || Infinity;
    return costA - costB;
  });
}
