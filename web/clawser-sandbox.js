// clawser-sandbox.js — WASM Tool Sandbox
//
// SANDBOX_TIERS: tier 0 (trusted), 1 (worker), 2 (wasm)
// CAPABILITIES: capability registry with tier requirements
// SANDBOX_LIMITS: per-tier resource limits
// CapabilityGate: capability-based permission checking
// WorkerSandbox: Web Worker isolation with timeout + respawn
// WasmSandbox: WASM-based isolation with fuel metering + memory caps
// SandboxManager: unified sandbox lifecycle management
// Agent tools: sandbox_run, sandbox_status

import { BrowserTool } from './clawser-tools.js';

// ── Constants ───────────────────────────────────────────────────

export const SANDBOX_TIERS = Object.freeze({
  TRUSTED: 0,     // Built-in tools — main thread, full access
  WORKER: 1,      // Skills, MCP — Web Worker, restricted API
  WASM: 2,        // User-authored — WASM sandbox, metered
});

export const CAPABILITIES = Object.freeze({
  'net:fetch':     { description: 'Make HTTP requests', tier: 1 },
  'fs:read':       { description: 'Read files from OPFS', tier: 1 },
  'fs:write':      { description: 'Write files to OPFS', tier: 1 },
  'time:now':      { description: 'Get current time', tier: 2 },
  'crypto:random': { description: 'Generate random bytes', tier: 2 },
  'dom:read':      { description: 'Read page DOM', tier: 0 },
  'dom:write':     { description: 'Modify page DOM', tier: 0 },
  'console:log':   { description: 'Log to console', tier: 2 },
});

export const SANDBOX_LIMITS = Object.freeze({
  [SANDBOX_TIERS.WORKER]: {
    timeout: 10_000,
    maxMemory: 64 * 1024 * 1024,   // 64MB
    maxOutputSize: 1024 * 1024,     // 1MB
  },
  [SANDBOX_TIERS.WASM]: {
    timeout: 5_000,
    fuelLimit: 1_000_000,
    maxMemory: 16 * 1024 * 1024,    // 16MB
    maxOutputSize: 256 * 1024,      // 256KB
  },
});

// ── CapabilityGate ──────────────────────────────────────────────

/**
 * Capability-based permission gate.
 */
export class CapabilityGate {
  /** @type {Set<string>} */
  #allowed;

  /**
   * @param {string[]} [capabilities] - Allowed capabilities
   */
  constructor(capabilities = []) {
    this.#allowed = new Set(capabilities);
  }

  /** Allowed capabilities. */
  get allowed() { return [...this.#allowed]; }

  /** Number of allowed capabilities. */
  get size() { return this.#allowed.size; }

  /**
   * Check if a capability is allowed.
   * @param {string} capability
   * @returns {boolean}
   */
  has(capability) {
    return this.#allowed.has(capability);
  }

  /**
   * Assert a capability is allowed, throw if not.
   * @param {string} capability
   */
  check(capability) {
    if (!this.#allowed.has(capability)) {
      throw new Error(`Capability denied: ${capability}`);
    }
  }

  /**
   * Add a capability.
   * @param {string} capability
   */
  grant(capability) {
    this.#allowed.add(capability);
  }

  /**
   * Remove a capability.
   * @param {string} capability
   */
  revoke(capability) {
    this.#allowed.delete(capability);
  }

  /**
   * Validate that all capabilities are available at a given tier.
   * @param {number} tier
   * @returns {{ valid: boolean, denied: string[] }}
   */
  validateForTier(tier) {
    const denied = [];
    for (const cap of this.#allowed) {
      const spec = CAPABILITIES[cap];
      if (spec && spec.tier < tier) {
        denied.push(cap);
      }
    }
    return { valid: denied.length === 0, denied };
  }

  /**
   * Create a proxy API that checks capabilities before each call.
   * @param {object} apis - { 'cap:name': function }
   * @returns {object}
   */
  createProxy(apis) {
    const proxy = {};
    for (const [cap, fn] of Object.entries(apis)) {
      const safeName = cap.replace(':', '_');
      proxy[safeName] = (...args) => {
        this.check(cap);
        return fn(...args);
      };
    }
    return proxy;
  }
}

// ── WorkerSandbox (Tier 1) ──────────────────────────────────────

/**
 * Worker code template for sandbox execution.
 */
export const WORKER_CODE = `
  self.onmessage = async ({ data: { id, code, args } }) => {
    try {
      const fn = new Function("args", code);
      const result = await fn(args);
      self.postMessage({ id, result });
    } catch (e) {
      self.postMessage({ id, error: e.message });
    }
  };
`;

/**
 * Web Worker-based sandbox with timeout and respawn.
 */
export class WorkerSandbox {
  /** @type {Map<number, { resolve, reject, timer }>} */
  #pending = new Map();
  #nextId = 0;
  #timeout;
  #active = true;

  /** @type {object|null} Worker or mock */
  #worker = null;

  /** @type {Function|null} Injectable worker creator */
  #createWorkerFn;

  /** @type {Array<{ id, code, args, result, error, elapsed }>} Execution log */
  #execLog = [];

  /**
   * @param {object} [opts]
   * @param {number} [opts.timeout=10000]
   * @param {Function} [opts.createWorkerFn] - () => worker-like object
   */
  constructor(opts = {}) {
    this.#timeout = opts.timeout || SANDBOX_LIMITS[SANDBOX_TIERS.WORKER].timeout;
    this.#createWorkerFn = opts.createWorkerFn || null;
    this.#spawnWorker();
  }

  get active() { return this.#active; }
  get pendingCount() { return this.#pending.size; }
  get execCount() { return this.#execLog.length; }

  /**
   * Execute code in the worker sandbox.
   * @param {string} code - Function body (receives `args`)
   * @param {object} [args] - Arguments passed to the function
   * @param {object} [opts] - { timeout }
   * @returns {Promise<any>}
   */
  async execute(code, args = {}, opts = {}) {
    if (!this.#active) throw new Error('Sandbox is terminated');

    const id = this.#nextId++;
    const timeout = opts.timeout || this.#timeout;
    const start = Date.now();

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.#pending.delete(id);
        this.#execLog.push({ id, code, args, error: 'timeout', elapsed: timeout });
        // Respawn worker
        this.#terminateWorker();
        this.#spawnWorker();
        reject(new Error('Sandbox timeout'));
      }, timeout);

      this.#pending.set(id, { resolve, reject, timer });

      if (this.#worker) {
        this.#worker.postMessage({ id, code, args });
      } else {
        clearTimeout(timer);
        this.#pending.delete(id);
        reject(new Error('No worker available'));
      }
    });
  }

  /**
   * Get execution log.
   * @returns {Array}
   */
  getLog() {
    return [...this.#execLog];
  }

  /**
   * Terminate the sandbox.
   */
  terminate() {
    this.#active = false;
    this.#terminateWorker();

    // Reject all pending
    for (const [, pending] of this.#pending) {
      clearTimeout(pending.timer);
      pending.reject(new Error('Sandbox terminated'));
    }
    this.#pending.clear();
  }

  #spawnWorker() {
    if (this.#createWorkerFn) {
      this.#worker = this.#createWorkerFn();
    } else {
      this.#worker = null; // No real Worker in Node.js tests
      return;
    }

    if (this.#worker && this.#worker.onmessage !== undefined) {
      this.#worker.onmessage = (e) => {
        const data = e?.data || e;
        this.#handleMessage(data);
      };
    }
  }

  #terminateWorker() {
    if (this.#worker?.terminate) {
      try { this.#worker.terminate(); } catch {}
    }
    this.#worker = null;
  }

  #handleMessage({ id, result, error }) {
    const pending = this.#pending.get(id);
    if (!pending) return;

    clearTimeout(pending.timer);
    this.#pending.delete(id);

    const logEntry = { id, result, error, elapsed: Date.now() };
    this.#execLog.push(logEntry);

    if (error) {
      pending.reject(new Error(error));
    } else {
      pending.resolve(result);
    }
  }
}

// ── WasmSandbox (Tier 2) ────────────────────────────────────────

/**
 * WASM-based sandbox with fuel metering and memory caps.
 * In production, wraps a QuickJS/Duktape WASM module.
 * For testability, supports an injectable evaluator.
 */
export class WasmSandbox {
  #fuelLimit;
  #fuelConsumed = 0;
  #maxMemory;
  #timeout;
  #active = true;

  /** @type {Function|null} Injectable evaluator (code, args) => result */
  #evalFn;

  /** @type {Array} Execution log */
  #execLog = [];

  /**
   * @param {object} [opts]
   * @param {number} [opts.fuelLimit=1000000]
   * @param {number} [opts.maxMemory=16MB]
   * @param {number} [opts.timeout=5000]
   * @param {Function} [opts.evalFn] - (code, args) => result
   */
  constructor(opts = {}) {
    this.#fuelLimit = opts.fuelLimit || SANDBOX_LIMITS[SANDBOX_TIERS.WASM].fuelLimit;
    this.#maxMemory = opts.maxMemory || SANDBOX_LIMITS[SANDBOX_TIERS.WASM].maxMemory;
    this.#timeout = opts.timeout || SANDBOX_LIMITS[SANDBOX_TIERS.WASM].timeout;
    this.#evalFn = opts.evalFn || null;
  }

  get active() { return this.#active; }
  get fuelConsumed() { return this.#fuelConsumed; }
  get fuelLimit() { return this.#fuelLimit; }
  get fuelRemaining() { return Math.max(0, this.#fuelLimit - this.#fuelConsumed); }
  get maxMemory() { return this.#maxMemory; }
  get execCount() { return this.#execLog.length; }

  /**
   * Execute code in the WASM sandbox.
   * @param {string} code - Code to evaluate
   * @param {object} [args] - Arguments
   * @returns {Promise<any>}
   */
  async execute(code, args = {}) {
    if (!this.#active) throw new Error('Sandbox is terminated');

    // Simulate fuel check
    const estimatedFuel = code.length * 10; // rough estimate
    if (this.#fuelConsumed + estimatedFuel > this.#fuelLimit) {
      const err = new Error('Fuel exhausted');
      this.#execLog.push({ code, args, error: err.message });
      throw err;
    }

    const start = Date.now();

    try {
      let result;
      if (this.#evalFn) {
        result = await Promise.race([
          this.#evalFn(code, args),
          new Promise((_, reject) =>
            setTimeout(() => reject(new Error('WASM timeout')), this.#timeout)
          ),
        ]);
      } else {
        throw new Error('No WASM evaluator configured');
      }

      // Check output size
      const output = JSON.stringify(result);
      if (output.length > SANDBOX_LIMITS[SANDBOX_TIERS.WASM].maxOutputSize) {
        throw new Error('Output size exceeds limit');
      }

      this.#fuelConsumed += estimatedFuel;
      this.#execLog.push({ code, args, result, elapsed: Date.now() - start });
      return result;
    } catch (e) {
      this.#execLog.push({ code, args, error: e.message, elapsed: Date.now() - start });
      throw e;
    }
  }

  /**
   * Reset fuel counter.
   */
  resetFuel() {
    this.#fuelConsumed = 0;
  }

  /**
   * Get execution log.
   * @returns {Array}
   */
  getLog() {
    return [...this.#execLog];
  }

  /**
   * Terminate the sandbox.
   */
  terminate() {
    this.#active = false;
  }
}

// ── SandboxManager ──────────────────────────────────────────────

/**
 * Unified manager for sandbox lifecycle.
 */
export class SandboxManager {
  /** @type {Map<string, { sandbox: WorkerSandbox|WasmSandbox, tier: number, gate: CapabilityGate }>} */
  #sandboxes = new Map();

  /** @type {Function|null} */
  #onLog;

  /** @type {Function|null} Worker creator */
  #createWorkerFn;

  /** @type {Function|null} WASM evaluator */
  #wasmEvalFn;

  /**
   * @param {object} [opts]
   * @param {Function} [opts.onLog]
   * @param {Function} [opts.createWorkerFn]
   * @param {Function} [opts.wasmEvalFn]
   */
  constructor(opts = {}) {
    this.#onLog = opts.onLog || null;
    this.#createWorkerFn = opts.createWorkerFn || null;
    this.#wasmEvalFn = opts.wasmEvalFn || null;
  }

  /** Number of active sandboxes. */
  get count() { return this.#sandboxes.size; }

  /**
   * Create a sandbox for a tool.
   * @param {string} name - Tool name (used as key)
   * @param {object} [opts]
   * @param {number} [opts.tier=1]
   * @param {string[]} [opts.capabilities]
   * @param {number} [opts.timeout]
   * @param {number} [opts.fuelLimit]
   * @returns {{ sandbox: WorkerSandbox|WasmSandbox, gate: CapabilityGate }}
   */
  create(name, opts = {}) {
    const tier = opts.tier ?? SANDBOX_TIERS.WORKER;
    const gate = new CapabilityGate(opts.capabilities || []);

    // Validate capabilities for tier
    const validation = gate.validateForTier(tier);
    if (!validation.valid) {
      throw new Error(`Capabilities ${validation.denied.join(', ')} not available at tier ${tier}`);
    }

    let sandbox;
    if (tier === SANDBOX_TIERS.WASM) {
      sandbox = new WasmSandbox({
        fuelLimit: opts.fuelLimit,
        timeout: opts.timeout,
        evalFn: this.#wasmEvalFn,
      });
    } else {
      sandbox = new WorkerSandbox({
        timeout: opts.timeout,
        createWorkerFn: this.#createWorkerFn,
      });
    }

    this.#sandboxes.set(name, { sandbox, tier, gate });
    this.#log(`Created ${tier === SANDBOX_TIERS.WASM ? 'WASM' : 'Worker'} sandbox: ${name}`);
    return { sandbox, gate };
  }

  /**
   * Get a sandbox by name.
   * @param {string} name
   * @returns {{ sandbox: WorkerSandbox|WasmSandbox, tier: number, gate: CapabilityGate }|undefined}
   */
  get(name) {
    return this.#sandboxes.get(name);
  }

  /**
   * Execute code in a named sandbox.
   * @param {string} name
   * @param {string} code
   * @param {object} [args]
   * @returns {Promise<any>}
   */
  async execute(name, code, args = {}) {
    const entry = this.#sandboxes.get(name);
    if (!entry) throw new Error(`Sandbox not found: ${name}`);
    return entry.sandbox.execute(code, args);
  }

  /**
   * Terminate and remove a sandbox.
   * @param {string} name
   * @returns {boolean}
   */
  terminate(name) {
    const entry = this.#sandboxes.get(name);
    if (!entry) return false;
    entry.sandbox.terminate();
    this.#sandboxes.delete(name);
    this.#log(`Terminated sandbox: ${name}`);
    return true;
  }

  /**
   * Terminate all sandboxes.
   */
  terminateAll() {
    for (const [, entry] of this.#sandboxes) {
      entry.sandbox.terminate();
    }
    this.#sandboxes.clear();
    this.#log('All sandboxes terminated');
  }

  /**
   * List active sandboxes.
   * @returns {Array<{ name: string, tier: number, active: boolean, execCount: number }>}
   */
  list() {
    return [...this.#sandboxes.entries()].map(([name, entry]) => ({
      name,
      tier: entry.tier,
      active: entry.sandbox.active,
      execCount: entry.sandbox.execCount,
      capabilities: entry.gate.allowed,
    }));
  }

  #log(msg) {
    if (this.#onLog) this.#onLog(msg);
  }
}

// ── Agent Tools ─────────────────────────────────────────────────

export class SandboxRunTool extends BrowserTool {
  #manager;

  constructor(manager) {
    super();
    this.#manager = manager;
  }

  get name() { return 'sandbox_run'; }
  get description() { return 'Run code in a sandboxed environment.'; }
  get parameters() {
    return {
      type: 'object',
      properties: {
        sandbox: { type: 'string', description: 'Sandbox name' },
        code: { type: 'string', description: 'Code to execute' },
        args: { type: 'object', description: 'Arguments object' },
      },
      required: ['sandbox', 'code'],
    };
  }
  get permission() { return 'approve'; }

  async execute({ sandbox, code, args }) {
    try {
      const result = await this.#manager.execute(sandbox, code, args || {});
      return {
        success: true,
        output: typeof result === 'string' ? result : JSON.stringify(result, null, 2),
      };
    } catch (e) {
      return { success: false, output: '', error: e.message };
    }
  }
}

export class SandboxStatusTool extends BrowserTool {
  #manager;

  constructor(manager) {
    super();
    this.#manager = manager;
  }

  get name() { return 'sandbox_status'; }
  get description() { return 'Show active sandboxes and their status.'; }
  get parameters() { return { type: 'object', properties: {} }; }
  get permission() { return 'read'; }

  async execute() {
    const sandboxes = this.#manager.list();
    if (sandboxes.length === 0) {
      return { success: true, output: 'No active sandboxes.' };
    }

    const tierName = t => t === 0 ? 'trusted' : t === 1 ? 'worker' : 'wasm';
    const lines = sandboxes.map(s =>
      `${s.name} | tier:${tierName(s.tier)} | ${s.active ? 'active' : 'stopped'} | ${s.execCount} exec | caps: ${s.capabilities.join(', ') || 'none'}`
    );
    return {
      success: true,
      output: `Sandboxes (${sandboxes.length}):\n${lines.join('\n')}`,
    };
  }
}
