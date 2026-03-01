// clawser-tool-builder.js — Tool Builder (Self-Expanding Agent)
//
// Allows the agent to dynamically create, test, and register new tools
// at runtime using JavaScript code executed in a sandbox (vimble).
//
// Architecture:
//   Agent writes JS code → ToolBuilder validates → dry-run test →
//   DynamicTool registered in BrowserToolRegistry → persisted to OPFS

import { BrowserTool } from './clawser-tools.js';

// ── Code Validation ─────────────────────────────────────────────

const FORBIDDEN_PATTERNS = [
  { re: /\b(fetch|XMLHttpRequest|WebSocket|EventSource)\b/, msg: 'Network access not allowed' },
  { re: /\b(document|window|globalThis|self)\b/, msg: 'DOM/global access not allowed' },
  { re: /\b(eval|Function)\s*\(/, msg: 'Dynamic execution not allowed' },
  { re: /\b(setTimeout|setInterval|requestAnimationFrame)\b/, msg: 'Timer access not allowed' },
  { re: /\bimport\s*\(/, msg: 'Dynamic imports not allowed' },
  { re: /\brequire\s*\(/, msg: 'require() not allowed' },
  { re: /\b(localStorage|sessionStorage|indexedDB)\b/, msg: 'Storage access not allowed' },
  { re: /\b(navigator|location|history)\b/, msg: 'Browser API access not allowed' },
];

/**
 * Validate tool code for forbidden patterns.
 * @param {string} code
 * @returns {{ safe: boolean, issues: string[] }}
 */
export function validateToolCode(code) {
  const issues = [];
  for (const { re, msg } of FORBIDDEN_PATTERNS) {
    if (re.test(code)) {
      issues.push(msg);
    }
  }
  return { safe: issues.length === 0, issues };
}

// ── DynamicTool ─────────────────────────────────────────────────

/**
 * A dynamically created tool that executes sandboxed JS code.
 * Extends BrowserTool so it integrates with the existing registry.
 */
export class DynamicTool extends BrowserTool {
  #spec;
  #sandbox;

  /**
   * @param {object} spec
   * @param {string} spec.name
   * @param {string} spec.description
   * @param {object} spec.parameters - JSON Schema for parameters
   * @param {string} spec.code - JS code with an `execute(params)` function
   * @param {string} [spec.author='agent']
   * @param {number} [spec.created]
   * @param {number} [spec.version=1]
   * @param {boolean} [spec.trusted=false]
   * @param {Function} [sandbox] - Sandbox executor: async (code) => result
   */
  constructor(spec, sandbox) {
    super();
    this.#spec = {
      name: spec.name,
      description: spec.description || '',
      parameters: spec.parameters || { type: 'object', properties: {} },
      code: spec.code || '',
      author: spec.author || 'agent',
      created: spec.created || Date.now(),
      version: spec.version || 1,
      trusted: spec.trusted || false,
    };
    this.#sandbox = sandbox || null;
  }

  get name() { return this.#spec.name; }
  get description() { return this.#spec.description; }
  get parameters() { return this.#spec.parameters; }
  get permission() { return this.#spec.trusted ? 'auto' : 'approve'; }

  /** Get the raw spec for serialization */
  get rawSpec() { return { ...this.#spec }; }

  /** Get the code string */
  get code() { return this.#spec.code; }

  /** Get the version number */
  get version() { return this.#spec.version; }

  /** Get the author */
  get author() { return this.#spec.author; }

  /** Get trusted status */
  get trusted() { return this.#spec.trusted; }

  /** Set trusted status */
  set trusted(v) { this.#spec.trusted = !!v; }

  /** Set a new sandbox executor */
  set sandbox(fn) { this.#sandbox = fn; }

  async execute(params) {
    if (!this.#sandbox) {
      return { success: false, output: '', error: 'No sandbox available' };
    }

    try {
      const result = await this.#sandbox(this.#spec.code, params);
      const output = result == null ? '' : (typeof result === 'string' ? result : JSON.stringify(result));
      return { success: true, output };
    } catch (e) {
      return { success: false, output: '', error: e.message };
    }
  }
}

// ── ToolBuilder ─────────────────────────────────────────────────

/**
 * Builds, validates, tests, and registers dynamic tools.
 */
export class ToolBuilder {
  /** @type {import('./clawser-tools.js').BrowserToolRegistry} */
  #registry;
  /** @type {Function} sandbox executor: async (code) => result */
  #sandbox;
  /** @type {Map<string, object[]>} Tool version history: name → [spec_v1, spec_v2, ...] */
  #history = new Map();

  /**
   * @param {import('./clawser-tools.js').BrowserToolRegistry} registry
   * @param {Function} sandbox - (code) => result or (code) => Function
   */
  constructor(registry, sandbox) {
    this.#registry = registry || null;
    this.#sandbox = sandbox || null;
  }

  /** Get tool version history */
  get history() { return this.#history; }

  /**
   * Build and register a new dynamic tool.
   * @param {object} spec - {name, description, parameters, code, testInput?}
   * @returns {Promise<{success: boolean, tool?: string, error?: string}>}
   */
  async buildTool(spec) {
    if (!spec.name || typeof spec.name !== 'string') {
      return { success: false, output: '', error: 'Tool name is required' };
    }
    if (!spec.code || typeof spec.code !== 'string') {
      return { success: false, output: '', error: 'Tool code is required' };
    }

    // 1. Validate code safety
    const validation = validateToolCode(spec.code);
    if (!validation.safe) {
      return { success: false, output: '', error: `Unsafe code: ${validation.issues.join('; ')}` };
    }

    // 2. Dry-run test
    if (this.#sandbox) {
      try {
        await this.#sandbox(spec.code, spec.testInput || {});
      } catch (e) {
        return { success: false, output: '', error: `Test failed: ${e.message}` };
      }
    }

    // 3. Check for existing version
    let version = 1;
    const existing = this.#registry?.get(spec.name);
    if (existing instanceof DynamicTool) {
      version = existing.version + 1;
      // Save old version to history
      const hist = this.#history.get(spec.name) || [];
      hist.push(existing.rawSpec);
      this.#history.set(spec.name, hist);
    }

    // 4. Create DynamicTool
    const tool = new DynamicTool({
      ...spec,
      version,
      author: spec.author || 'agent',
      created: Date.now(),
      trusted: false,
    }, this.#sandbox);

    // 5. Register
    if (this.#registry) {
      this.#registry.register(tool);
    }

    return { success: true, tool: spec.name, version };
  }

  /**
   * Test a dynamic tool with sample input without registering it.
   * @param {object} spec - {code, testInput}
   * @returns {Promise<{success: boolean, output?: string, error?: string}>}
   */
  async testTool(spec) {
    if (!spec.code) return { success: false, output: '', error: 'No code provided' };

    const validation = validateToolCode(spec.code);
    if (!validation.safe) {
      return { success: false, output: '', error: `Unsafe code: ${validation.issues.join('; ')}` };
    }

    if (!this.#sandbox) {
      return { success: false, output: '', error: 'No sandbox available' };
    }

    const testParams = spec.testInput || {};
    try {
      const result = await this.#sandbox(spec.code, testParams);
      const output = result == null ? '' : (typeof result === 'string' ? result : JSON.stringify(result));
      return { success: true, output };
    } catch (e) {
      return { success: false, output: '', error: e.message };
    }
  }

  /**
   * Edit an existing dynamic tool's code and re-register.
   * @param {string} name
   * @param {object} updates - {code?, description?, parameters?, testInput?}
   * @returns {Promise<{success: boolean, version?: number, error?: string}>}
   */
  async editTool(name, updates) {
    const existing = this.#registry?.get(name);
    if (!(existing instanceof DynamicTool)) {
      return { success: false, output: '', error: `Dynamic tool "${name}" not found` };
    }

    const newSpec = {
      ...existing.rawSpec,
      ...updates,
      name, // name cannot change
    };

    return this.buildTool(newSpec);
  }

  /**
   * Remove a dynamic tool.
   * @param {string} name
   * @returns {{ success: boolean, error?: string }}
   */
  removeTool(name) {
    const existing = this.#registry?.get(name);
    if (!(existing instanceof DynamicTool)) {
      return { success: false, output: '', error: `Dynamic tool "${name}" not found` };
    }

    this.#registry.unregister(name);
    this.#history.delete(name);
    return { success: true };
  }

  /**
   * List all registered dynamic tools.
   * @returns {Array<{name: string, description: string, version: number, author: string, trusted: boolean}>}
   */
  listTools() {
    if (!this.#registry) return [];
    const tools = [];
    for (const spec of this.#registry.allSpecs()) {
      const tool = this.#registry.get(spec.name);
      if (tool instanceof DynamicTool) {
        tools.push({
          name: tool.name,
          description: tool.description,
          version: tool.version,
          author: tool.author,
          trusted: tool.trusted,
        });
      }
    }
    return tools;
  }

  /**
   * Get version history for a tool.
   * @param {string} name
   * @returns {object[]}
   */
  getHistory(name) {
    return this.#history.get(name) || [];
  }

  /**
   * Rollback a tool to a previous version.
   * @param {string} name
   * @param {number} targetVersion
   * @returns {{ success: boolean, error?: string }}
   */
  rollback(name, targetVersion) {
    const hist = this.#history.get(name) || [];
    const target = hist.find(s => s.version === targetVersion);
    if (!target) {
      return { success: false, output: '', error: `Version ${targetVersion} not found for "${name}"` };
    }

    // Determine next version number from current tool
    const existing = this.#registry?.get(name);
    let newVersion = targetVersion;
    if (existing instanceof DynamicTool) {
      newVersion = existing.version + 1;
      // Save current version to history
      const h = this.#history.get(name) || [];
      h.push(existing.rawSpec);
      this.#history.set(name, h);
    }

    const tool = new DynamicTool({ ...target, version: newVersion }, this.#sandbox);
    if (this.#registry) this.#registry.register(tool);
    return { success: true, version: newVersion };
  }

  /**
   * Persist all dynamic tools via a storage adapter.
   * @param {{ write: (key: string, data: string) => Promise<void> }} storage
   * @returns {Promise<void>}
   */
  async persist(storage) {
    const data = this.exportAll();
    await storage.write('clawser_dynamic_tools', JSON.stringify(data));
  }

  /**
   * Restore dynamic tools from a storage adapter.
   * @param {{ read: (key: string) => Promise<string|null> }} storage
   * @returns {Promise<number>} Number of tools restored
   */
  async restore(storage) {
    const raw = await storage.read('clawser_dynamic_tools');
    if (!raw) return 0;
    try {
      const data = JSON.parse(raw);
      return this.importAll(data);
    } catch {
      return 0;
    }
  }

  /**
   * Promote a dynamic tool to trusted status.
   * @param {string} name
   * @returns {{ success: boolean, error?: string }}
   */
  promoteTool(name) {
    if (!this.#registry) return { success: false, output: '', error: 'No registry' };
    const tool = this.#registry.get(name);
    if (!(tool instanceof DynamicTool)) {
      return { success: false, output: '', error: `Dynamic tool "${name}" not found` };
    }
    tool.trusted = true;
    return { success: true };
  }

  /**
   * Demote a trusted dynamic tool back to untrusted.
   * @param {string} name
   * @returns {{ success: boolean, error?: string }}
   */
  demoteTool(name) {
    if (!this.#registry) return { success: false, output: '', error: 'No registry' };
    const tool = this.#registry.get(name);
    if (!(tool instanceof DynamicTool)) {
      return { success: false, output: '', error: `Dynamic tool "${name}" not found` };
    }
    tool.trusted = false;
    return { success: true };
  }

  /**
   * Serialize all dynamic tools for persistence.
   * @returns {object[]}
   */
  exportAll() {
    const tools = [];
    if (!this.#registry) return tools;
    for (const spec of this.#registry.allSpecs()) {
      const tool = this.#registry.get(spec.name);
      if (tool instanceof DynamicTool) {
        tools.push(tool.rawSpec);
      }
    }
    return tools;
  }

  /**
   * Restore dynamic tools from serialized data.
   * @param {object[]} data
   */
  importAll(data) {
    if (!Array.isArray(data)) return 0;
    let count = 0;
    for (const spec of data) {
      const tool = new DynamicTool(spec, this.#sandbox);
      if (this.#registry) this.#registry.register(tool);
      count++;
    }
    return count;
  }
}

// ── Agent Tools ─────────────────────────────────────────────────

/**
 * Agent tool for building new tools at runtime.
 */
export class ToolBuildTool extends BrowserTool {
  #builder;

  constructor(builder) {
    super();
    this.#builder = builder;
  }

  get name() { return 'tool_build'; }
  get description() {
    return 'Build a new custom tool from JavaScript code. The code must define an execute(params) function.';
  }
  get parameters() {
    return {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Tool name (lowercase, alphanumeric with underscores)' },
        description: { type: 'string', description: 'What the tool does' },
        code: { type: 'string', description: 'JavaScript code defining an execute(params) function' },
        parameters_schema: { type: 'string', description: 'JSON string of parameter schema (optional)' },
        test_input: { type: 'string', description: 'JSON string of test input (optional)' },
      },
      required: ['name', 'description', 'code'],
    };
  }
  get permission() { return 'approve'; }

  async execute({ name, description, code, parameters_schema, test_input }) {
    try {
      const spec = { name, description, code };
      if (parameters_schema) {
        try { spec.parameters = JSON.parse(parameters_schema); } catch { /* use default */ }
      }
      if (test_input) {
        try { spec.testInput = JSON.parse(test_input); } catch { /* skip test */ }
      }
      const result = await this.#builder.buildTool(spec);
      if (result.success) {
        return { success: true, output: `Tool "${name}" built successfully (v${result.version}).` };
      }
      return { success: false, output: '', error: result.error };
    } catch (e) {
      return { success: false, output: '', error: e.message };
    }
  }
}

/**
 * Agent tool for testing tool code without registering.
 */
export class ToolTestTool extends BrowserTool {
  #builder;

  constructor(builder) {
    super();
    this.#builder = builder;
  }

  get name() { return 'tool_test'; }
  get description() { return 'Test tool code with sample input without registering it.'; }
  get parameters() {
    return {
      type: 'object',
      properties: {
        code: { type: 'string', description: 'JavaScript code with execute(params) function' },
        test_input: { type: 'string', description: 'JSON string of test input' },
      },
      required: ['code'],
    };
  }
  get permission() { return 'approve'; }

  async execute({ code, test_input }) {
    try {
      const testInput = test_input ? JSON.parse(test_input) : {};
      const result = await this.#builder.testTool({ code, testInput });
      if (result.success) {
        return { success: true, output: `Test passed. Output: ${result.output}` };
      }
      return { success: false, output: '', error: result.error };
    } catch (e) {
      return { success: false, output: '', error: e.message };
    }
  }
}

/**
 * Agent tool for listing custom tools.
 */
export class ToolListCustomTool extends BrowserTool {
  #builder;

  constructor(builder) {
    super();
    this.#builder = builder;
  }

  get name() { return 'tool_list_custom'; }
  get description() { return 'List all dynamically created custom tools.'; }
  get parameters() { return { type: 'object', properties: {} }; }
  get permission() { return 'read'; }

  async execute() {
    const tools = this.#builder.listTools();
    if (tools.length === 0) {
      return { success: true, output: 'No custom tools built yet.' };
    }
    const lines = tools.map(t =>
      `${t.name} v${t.version} — ${t.description} (by ${t.author}, ${t.trusted ? 'trusted' : 'untrusted'})`
    );
    return { success: true, output: lines.join('\n') };
  }
}

/**
 * Agent tool for editing an existing dynamic tool.
 */
export class ToolEditTool extends BrowserTool {
  #builder;

  constructor(builder) {
    super();
    this.#builder = builder;
  }

  get name() { return 'tool_edit'; }
  get description() { return 'Edit the code of an existing custom tool. Creates a new version.'; }
  get parameters() {
    return {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Tool name to edit' },
        code: { type: 'string', description: 'New JavaScript code' },
        description: { type: 'string', description: 'Updated description (optional)' },
      },
      required: ['name', 'code'],
    };
  }
  get permission() { return 'approve'; }

  async execute({ name, code, description }) {
    const updates = { code };
    if (description) updates.description = description;
    const result = await this.#builder.editTool(name, updates);
    if (result.success) {
      return { success: true, output: `Tool "${name}" updated to v${result.version}.` };
    }
    return { success: false, output: '', error: result.error };
  }
}

/**
 * Agent tool for removing a custom tool.
 */
export class ToolRemoveTool extends BrowserTool {
  #builder;

  constructor(builder) {
    super();
    this.#builder = builder;
  }

  get name() { return 'tool_remove'; }
  get description() { return 'Remove a dynamically created custom tool.'; }
  get parameters() {
    return {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Tool name to remove' },
      },
      required: ['name'],
    };
  }
  get permission() { return 'write'; }

  async execute({ name }) {
    const result = this.#builder.removeTool(name);
    if (result.success) {
      return { success: true, output: `Tool "${name}" removed.` };
    }
    return { success: false, output: '', error: result.error };
  }
}

/**
 * Agent tool for promoting a dynamic tool to trusted.
 */
export class ToolPromoteTool extends BrowserTool {
  #builder;

  constructor(builder) {
    super();
    this.#builder = builder;
  }

  get name() { return 'tool_promote'; }
  get description() { return 'Mark a dynamic tool as trusted after user review.'; }
  get parameters() {
    return {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Tool name to promote to trusted' },
      },
      required: ['name'],
    };
  }
  get permission() { return 'approve'; }

  async execute({ name }) {
    const result = this.#builder.promoteTool(name);
    if (result.success) {
      return { success: true, output: `Tool "${name}" promoted to trusted.` };
    }
    return { success: false, output: '', error: result.error };
  }
}
