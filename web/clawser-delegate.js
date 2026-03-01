// clawser-delegate.js — Sub-agent Delegation
//
// SubAgent: isolated conversation context within the same agent
// DelegateTool: agent tool to spawn sub-tasks
// DelegateManager: manages concurrent sub-agents with limits

import { BrowserTool } from './clawser-tools.js';

// ── Constants ───────────────────────────────────────────────────

export const MAX_DELEGATION_DEPTH = 2;
export const DEFAULT_MAX_ITERATIONS = 10;
export const DEFAULT_MAX_CONCURRENCY = 3;

// ── SubAgent ────────────────────────────────────────────────────

/**
 * An isolated conversation context that runs a focused sub-task.
 * Uses the parent agent's provider and tools but maintains separate history.
 */
export class SubAgent {
  #id;
  #goal;
  #history = [];
  #maxIterations;
  #allowedTools;
  #depth;
  #status = 'pending';
  #result = null;
  #iterations = 0;
  #toolCallCount = 0;
  #usage = { input_tokens: 0, output_tokens: 0 };
  #model = '';
  #parentMemory = Object.freeze([]);

  /** @type {Function} Provider chat function: (messages, tools, opts) => response */
  #chatFn;

  /** @type {Function} Tool executor: (name, params) => result */
  #executeFn;

  /** @type {object[]} Tool specs available to this sub-agent */
  #toolSpecs;

  /** @type {Function|null} */
  #onEvent;

  /**
   * @param {object} opts
   * @param {string} opts.goal - Task description
   * @param {Function} opts.chatFn - (messages, tools, chatOpts) => ChatResponse
   * @param {Function} opts.executeFn - (toolName, params) => ToolResult
   * @param {object[]} opts.toolSpecs - Available tool specs
   * @param {number} [opts.maxIterations=10]
   * @param {string[]} [opts.allowedTools] - Restrict to these tool names
   * @param {number} [opts.depth=0] - Current delegation depth
   * @param {string} [opts.systemPrompt=''] - Base system prompt from parent
   * @param {Function} [opts.onEvent] - Event callback
   * @param {object[]} [opts.parentMemory] - Read-only parent memory entries
   */
  constructor(opts) {
    this.#id = crypto.randomUUID();
    this.#goal = opts.goal;
    this.#chatFn = opts.chatFn;
    this.#executeFn = opts.executeFn;
    this.#maxIterations = opts.maxIterations || DEFAULT_MAX_ITERATIONS;
    this.#depth = opts.depth || 0;
    this.#onEvent = opts.onEvent || null;

    // Parent memory: frozen read-only copy
    this.#parentMemory = opts.parentMemory
      ? Object.freeze([...opts.parentMemory])
      : Object.freeze([]);

    // Filter tools by allowlist if provided
    if (opts.allowedTools && opts.allowedTools.length > 0) {
      const allowed = new Set(opts.allowedTools);
      this.#toolSpecs = (opts.toolSpecs || []).filter(s => allowed.has(s.name));
      this.#allowedTools = opts.allowedTools;
    } else {
      // Default: read-only tools only (safe default)
      this.#toolSpecs = (opts.toolSpecs || []).filter(
        s => s.required_permission === 'read' || s.required_permission === 'internal'
      );
      this.#allowedTools = this.#toolSpecs.map(s => s.name);
    }

    // Build initial history
    const memorySection = this.#parentMemory.length > 0
      ? '\n\nParent context:\n' + this.#parentMemory.map(m => `- ${m.key}: ${m.content}`).join('\n')
      : '';

    const sysPrompt = [
      opts.systemPrompt || '',
      '\nYou are working on a delegated sub-task.',
      `Task: ${this.#goal}`,
      'Complete this task and provide a clear summary of your findings.',
      `You have up to ${this.#maxIterations} tool iterations.`,
      memorySection,
    ].join('\n').trim();

    this.#history.push({ role: 'system', content: sysPrompt });
    this.#history.push({ role: 'user', content: this.#goal });
  }

  get id() { return this.#id; }
  get goal() { return this.#goal; }
  get status() { return this.#status; }
  get depth() { return this.#depth; }
  get iterations() { return this.#iterations; }
  get toolCallCount() { return this.#toolCallCount; }
  get result() { return this.#result; }
  get allowedTools() { return [...this.#allowedTools]; }
  get usage() { return { ...this.#usage }; }
  get model() { return this.#model; }
  get parentMemory() { return this.#parentMemory; }

  /**
   * Run the sub-agent loop to completion.
   * @returns {Promise<{success: boolean, summary: string, iterations: number, toolCalls: number}>}
   */
  async run() {
    if (this.#depth >= MAX_DELEGATION_DEPTH) {
      this.#status = 'failed';
      this.#result = {
        success: false,
        summary: 'Maximum delegation depth reached.',
        iterations: 0,
        toolCalls: 0,
      };
      return this.#result;
    }

    this.#status = 'running';
    this.#emit('delegate_start', { goal: this.#goal, depth: this.#depth });

    for (let i = 0; i < this.#maxIterations; i++) {
      if (this.#status === 'cancelled') {
        this.#result = { success: false, summary: 'Cancelled.', iterations: i, toolCalls: this.#toolCallCount };
        return this.#result;
      }
      this.#iterations = i + 1;

      try {
        const response = await this.#chatFn(
          this.#history,
          this.#toolSpecs,
          {}
        );

        // Track token usage
        if (response.usage) {
          this.#usage.input_tokens += response.usage.input_tokens || 0;
          this.#usage.output_tokens += response.usage.output_tokens || 0;
        }
        if (response.model) this.#model = response.model;

        this.#history.push({
          role: 'assistant',
          content: response.content || '',
          tool_calls: response.tool_calls,
        });

        // If no tool calls, task is done
        if (!response.tool_calls || response.tool_calls.length === 0) {
          this.#status = 'completed';
          this.#result = {
            success: true,
            summary: response.content || '',
            iterations: i + 1,
            toolCalls: this.#toolCallCount,
            cost: this.#estimateCost(),
          };
          this.#emit('delegate_complete', this.#result);
          return this.#result;
        }

        // Execute tool calls
        for (const call of response.tool_calls) {
          const name = call.name || '';
          const args = typeof call.arguments === 'string'
            ? JSON.parse(call.arguments)
            : (call.arguments || {});

          // Check tool is allowed
          if (!this.#allowedTools.includes(name)) {
            this.#history.push({
              role: 'tool',
              tool_call_id: call.id || '',
              content: `Error: Tool "${name}" not available in this sub-agent context.`,
            });
            continue;
          }

          this.#toolCallCount++;
          const toolResult = await this.#executeFn(name, args);
          this.#history.push({
            role: 'tool',
            tool_call_id: call.id || '',
            content: toolResult.success
              ? toolResult.output
              : `Error: ${toolResult.error || 'Unknown error'}`,
          });
        }
      } catch (e) {
        this.#status = 'failed';
        this.#result = {
          success: false,
          summary: `Sub-agent error: ${e.message}`,
          iterations: i + 1,
          toolCalls: this.#toolCallCount,
          cost: this.#estimateCost(),
        };
        this.#emit('delegate_error', { error: e.message });
        return this.#result;
      }
    }

    // Hit iteration limit
    this.#status = 'failed';
    const lastContent = this.#history.filter(m => m.role === 'assistant').pop()?.content || '';
    this.#result = {
      success: false,
      summary: lastContent || 'Sub-task reached iteration limit without completing.',
      iterations: this.#maxIterations,
      toolCalls: this.#toolCallCount,
      cost: this.#estimateCost(),
    };
    this.#emit('delegate_timeout', this.#result);
    return this.#result;
  }

  /**
   * Run the sub-agent loop as an async generator, yielding progress events.
   * @yields {{ type: 'text'|'tool_start'|'tool_result'|'done', ... }}
   */
  async *runStream() {
    if (this.#depth >= MAX_DELEGATION_DEPTH) {
      this.#status = 'failed';
      this.#result = {
        success: false,
        summary: 'Maximum delegation depth reached.',
        iterations: 0,
        toolCalls: 0,
      };
      yield { type: 'done', success: false, summary: this.#result.summary };
      return;
    }

    this.#status = 'running';
    this.#emit('delegate_start', { goal: this.#goal, depth: this.#depth });

    for (let i = 0; i < this.#maxIterations; i++) {
      if (this.#status === 'cancelled') {
        yield { type: 'done', success: false, summary: 'Cancelled.' };
        return;
      }
      this.#iterations = i + 1;

      try {
        const response = await this.#chatFn(
          this.#history,
          this.#toolSpecs,
          {}
        );

        if (response.usage) {
          this.#usage.input_tokens += response.usage.input_tokens || 0;
          this.#usage.output_tokens += response.usage.output_tokens || 0;
        }
        if (response.model) this.#model = response.model;

        this.#history.push({
          role: 'assistant',
          content: response.content || '',
          tool_calls: response.tool_calls,
        });

        // Yield text content
        if (response.content) {
          yield { type: 'text', content: response.content, iteration: i + 1 };
        }

        // If no tool calls, task is done
        if (!response.tool_calls || response.tool_calls.length === 0) {
          this.#status = 'completed';
          this.#result = {
            success: true,
            summary: response.content || '',
            iterations: i + 1,
            toolCalls: this.#toolCallCount,
            cost: this.#estimateCost(),
          };
          this.#emit('delegate_complete', this.#result);
          yield { type: 'done', success: true, summary: this.#result.summary, iterations: i + 1 };
          return;
        }

        // Execute tool calls with streaming events
        for (const call of response.tool_calls) {
          const name = call.name || '';
          const args = typeof call.arguments === 'string'
            ? JSON.parse(call.arguments)
            : (call.arguments || {});

          if (!this.#allowedTools.includes(name)) {
            this.#history.push({
              role: 'tool',
              tool_call_id: call.id || '',
              content: `Error: Tool "${name}" not available in this sub-agent context.`,
            });
            continue;
          }

          yield { type: 'tool_start', name, args, iteration: i + 1 };

          this.#toolCallCount++;
          const toolResult = await this.#executeFn(name, args);
          this.#history.push({
            role: 'tool',
            tool_call_id: call.id || '',
            content: toolResult.success
              ? toolResult.output
              : `Error: ${toolResult.error || 'Unknown error'}`,
          });

          yield { type: 'tool_result', name, success: toolResult.success, iteration: i + 1 };
        }
      } catch (e) {
        this.#status = 'failed';
        this.#result = {
          success: false,
          summary: `Sub-agent error: ${e.message}`,
          iterations: i + 1,
          toolCalls: this.#toolCallCount,
          cost: this.#estimateCost(),
        };
        this.#emit('delegate_error', { error: e.message });
        yield { type: 'done', success: false, summary: this.#result.summary };
        return;
      }
    }

    // Hit iteration limit
    this.#status = 'failed';
    const lastContent = this.#history.filter(m => m.role === 'assistant').pop()?.content || '';
    this.#result = {
      success: false,
      summary: lastContent || 'Sub-task reached iteration limit without completing.',
      iterations: this.#maxIterations,
      toolCalls: this.#toolCallCount,
      cost: this.#estimateCost(),
    };
    this.#emit('delegate_timeout', this.#result);
    yield { type: 'done', success: false, summary: this.#result.summary };
  }

  /**
   * Cancel the sub-agent.
   */
  cancel() {
    this.#status = 'cancelled';
    this.#emit('delegate_cancel', { goal: this.#goal });
  }

  /**
   * Estimate cost based on accumulated token usage.
   * Uses a simple per-1K-token pricing model.
   */
  #estimateCost() {
    try {
      // Try to use the estimateCost from providers module if available
      const { input_tokens, output_tokens } = this.#usage;
      if (!input_tokens && !output_tokens) return 0;
      // Approximate fallback: $0.002/1K input, $0.008/1K output (GPT-4o-like)
      return ((input_tokens / 1000) * 0.002) + ((output_tokens / 1000) * 0.008);
    } catch {
      return 0;
    }
  }

  #emit(type, data) {
    if (this.#onEvent) this.#onEvent(type, { subAgentId: this.#id, ...data });
  }
}

// ── DelegateManager ─────────────────────────────────────────────

/**
 * Manages sub-agent lifecycle and concurrency.
 */
export class DelegateManager {
  /** @type {Map<string, SubAgent>} */
  #agents = new Map();

  /** Maximum concurrent sub-agents */
  #maxConcurrency;

  /** Currently running count */
  #running = 0;

  /**
   * @param {object} [opts]
   * @param {number} [opts.maxConcurrency=3]
   */
  constructor(opts = {}) {
    this.#maxConcurrency = opts.maxConcurrency ?? DEFAULT_MAX_CONCURRENCY;
  }

  /**
   * Create and register a sub-agent.
   * @param {object} opts - SubAgent constructor options
   * @returns {SubAgent}
   */
  create(opts) {
    const agent = new SubAgent(opts);
    this.#agents.set(agent.id, agent);
    return agent;
  }

  /**
   * Run a sub-agent.
   * @param {string} id
   * @returns {Promise<object>}
   */
  async run(id) {
    const agent = this.#agents.get(id);
    if (!agent) throw new Error(`Sub-agent ${id} not found`);
    if (this.#running >= this.#maxConcurrency) {
      throw new Error(`Max concurrency (${this.#maxConcurrency}) reached`);
    }

    this.#running++;
    try {
      return await agent.run();
    } finally {
      this.#running--;
    }
  }

  /**
   * Create and run a sub-agent in one call.
   * @param {object} opts
   * @returns {Promise<object>}
   */
  async delegate(opts) {
    const agent = this.create(opts);
    return this.run(agent.id);
  }

  /**
   * Run multiple sub-agents concurrently.
   * @param {object[]} optsList
   * @returns {Promise<object[]>}
   */
  async delegateAll(optsList) {
    const agents = optsList.map(opts => this.create(opts));
    const results = [];
    const queue = [...agents];

    const runNext = async () => {
      if (queue.length === 0) return;
      const agent = queue.shift();
      const result = await this.run(agent.id);
      results.push(result);
      await runNext();
    };

    // Start up to maxConcurrency parallel runners
    const runners = [];
    for (let i = 0; i < this.#maxConcurrency && queue.length > 0; i++) {
      runners.push(runNext());
    }
    await Promise.all(runners);
    return results;
  }

  /**
   * Get a sub-agent by ID.
   */
  get(id) { return this.#agents.get(id) || null; }

  /**
   * List all sub-agents.
   */
  list() {
    return [...this.#agents.values()].map(a => ({
      id: a.id,
      goal: a.goal,
      status: a.status,
      depth: a.depth,
      iterations: a.iterations,
      toolCalls: a.toolCallCount,
    }));
  }

  /**
   * Cancel a running sub-agent.
   * @param {string} id
   * @returns {boolean} True if agent was found and cancelled
   */
  cancel(id) {
    const agent = this.#agents.get(id);
    if (!agent) return false;
    agent.cancel();
    return true;
  }

  /** Currently running sub-agents */
  get running() { return this.#running; }

  /** Total sub-agents tracked */
  get size() { return this.#agents.size; }

  /** Clear completed/failed/cancelled agents */
  cleanup() {
    for (const [id, agent] of this.#agents) {
      if (agent.status !== 'running' && agent.status !== 'pending') {
        this.#agents.delete(id);
      }
    }
  }
}

// ── Agent Tool ──────────────────────────────────────────────────

/**
 * Agent tool for delegating sub-tasks.
 */
export class DelegateTool extends BrowserTool {
  #manager;
  #chatFn;
  #executeFn;
  #toolSpecs;
  #systemPrompt;
  #currentDepth;

  /**
   * @param {object} opts
   * @param {DelegateManager} opts.manager
   * @param {Function} opts.chatFn
   * @param {Function} opts.executeFn
   * @param {object[]} opts.toolSpecs
   * @param {string} [opts.systemPrompt='']
   * @param {number} [opts.currentDepth=0]
   */
  constructor(opts) {
    super();
    this.#manager = opts.manager;
    this.#chatFn = opts.chatFn;
    this.#executeFn = opts.executeFn;
    this.#toolSpecs = opts.toolSpecs; // may be a function for lazy evaluation
    this.#systemPrompt = opts.systemPrompt || '';
    this.#currentDepth = opts.currentDepth || 0;
  }

  get name() { return 'agent_delegate'; }
  get description() {
    return 'Delegate a sub-task to a focused sub-agent with isolated context. Returns a summary.';
  }
  get parameters() {
    return {
      type: 'object',
      properties: {
        task: { type: 'string', description: 'Clear description of the sub-task' },
        max_iterations: { type: 'number', description: 'Max tool iterations (default 10)' },
        tools: {
          type: 'array',
          items: { type: 'string' },
          description: 'Restrict to specific tool names (optional)',
        },
      },
      required: ['task'],
    };
  }
  get permission() { return 'approve'; }

  async execute({ task, max_iterations, tools }) {
    try {
      const specs = typeof this.#toolSpecs === 'function' ? this.#toolSpecs() : this.#toolSpecs;
      const result = await this.#manager.delegate({
        goal: task,
        chatFn: this.#chatFn,
        executeFn: this.#executeFn,
        toolSpecs: specs,
        maxIterations: max_iterations || DEFAULT_MAX_ITERATIONS,
        allowedTools: tools,
        depth: this.#currentDepth + 1,
        systemPrompt: this.#systemPrompt,
      });

      return {
        success: result.success,
        output: [
          `Sub-task: ${task}`,
          `Status: ${result.success ? 'completed' : 'incomplete'}`,
          `Iterations: ${result.iterations}`,
          `Tool calls: ${result.toolCalls}`,
          `Cost: $${(result.cost || 0).toFixed(6)}`,
          '---',
          result.summary,
        ].join('\n'),
      };
    } catch (e) {
      return { success: false, output: '', error: e.message };
    }
  }
}

// NOTE: ConsultAgentTool was removed — the active version lives in clawser-tools.js
