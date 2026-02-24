/**
 * Clawser Agent Storage — Persist and manage agent definitions
 *
 * Agents are saved configurations bundling provider, model, system prompt,
 * tool permissions, and behavioral parameters. They can be global (all
 * workspaces) or workspace-scoped (override globals with same name).
 *
 * Storage layout:
 *   OPFS:
 *     clawser_agents/{id}.json               — Global agents
 *     clawser_workspaces/{wsId}/.agents/{id}.json — Workspace agents
 *   localStorage:
 *     clawser_agents_index                   — Global agent ID list
 *     clawser_agents_index_{wsId}            — Workspace agent ID list
 *     clawser_active_agent_{wsId}            — Active agent per workspace
 */

// ── Helpers ─────────────────────────────────────────────────────

function generateAgentId() {
  return 'agt_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 6);
}

// ── Built-in Starter Agents ──────────────────────────────────────

const BUILTIN_AGENTS = [
  {
    id: 'agt_builtin_echo',
    name: 'Echo (Test)',
    description: 'Echoes input back. For testing.',
    color: '#8b949e',
    icon: 'echo',
    provider: 'echo',
    model: '',
    accountId: null,
    systemPrompt: 'You are an echo bot. Repeat back what the user says.',
    temperature: 0,
    maxTokens: 4096,
    contextWindow: null,
    autonomy: 'full',
    tools: { mode: 'all', list: [], permissionOverrides: {} },
    domainAllowlist: [],
    maxCostPerTurn: null,
    maxTurnsPerRun: 20,
    scope: 'builtin',
    workspaceId: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  },
  {
    id: 'agt_builtin_chrome_ai',
    name: 'Chrome AI',
    description: 'On-device, private, no API key needed.',
    color: '#4285f4',
    icon: 'chip',
    provider: 'chrome-ai',
    model: 'gemini-nano',
    accountId: null,
    systemPrompt: 'You are a helpful assistant running locally in the browser via Chrome AI.',
    temperature: 0.7,
    maxTokens: 4096,
    contextWindow: null,
    autonomy: 'balanced',
    tools: { mode: 'all', list: [], permissionOverrides: {} },
    domainAllowlist: [],
    maxCostPerTurn: null,
    maxTurnsPerRun: 20,
    scope: 'builtin',
    workspaceId: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  },
  {
    id: 'agt_builtin_sonnet',
    name: 'Claude Sonnet',
    description: 'General-purpose, balanced cost. Anthropic.',
    color: '#d97706',
    icon: 'brain',
    provider: 'anthropic',
    model: 'claude-sonnet-4-6',
    accountId: null,
    systemPrompt: 'You are a helpful assistant with access to web browsing and file management tools. Be concise and accurate.',
    temperature: 0.7,
    maxTokens: 4096,
    contextWindow: null,
    autonomy: 'balanced',
    tools: { mode: 'all', list: [], permissionOverrides: {} },
    domainAllowlist: [],
    maxCostPerTurn: null,
    maxTurnsPerRun: 20,
    scope: 'builtin',
    workspaceId: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  },
  {
    id: 'agt_builtin_haiku',
    name: 'Claude Haiku',
    description: 'Fast, cheap, good for simple tasks. Anthropic.',
    color: '#16a34a',
    icon: 'zap',
    provider: 'anthropic',
    model: 'claude-haiku-4-5-20251001',
    accountId: null,
    systemPrompt: 'You are a fast, concise assistant. Keep answers short and to the point.',
    temperature: 0.5,
    maxTokens: 4096,
    contextWindow: null,
    autonomy: 'full',
    tools: { mode: 'all', list: [], permissionOverrides: {} },
    domainAllowlist: [],
    maxCostPerTurn: null,
    maxTurnsPerRun: 20,
    scope: 'builtin',
    workspaceId: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  },
  {
    id: 'agt_builtin_gpt4o',
    name: 'GPT-4o',
    description: 'OpenAI flagship, multimodal.',
    color: '#10a37f',
    icon: 'sparkles',
    provider: 'openai',
    model: 'gpt-4o',
    accountId: null,
    systemPrompt: 'You are a helpful assistant with access to web browsing and file management tools.',
    temperature: 0.7,
    maxTokens: 4096,
    contextWindow: null,
    autonomy: 'balanced',
    tools: { mode: 'all', list: [], permissionOverrides: {} },
    domainAllowlist: [],
    maxCostPerTurn: null,
    maxTurnsPerRun: 20,
    scope: 'builtin',
    workspaceId: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  },
];

// ── AgentStorage ────────────────────────────────────────────────

export class AgentStorage {
  /** @type {FileSystemDirectoryHandle|null} */
  #globalDir;
  /** @type {FileSystemDirectoryHandle|null} */
  #wsDir;
  /** @type {string} */
  #wsId;

  /**
   * @param {Object} opts
   * @param {FileSystemDirectoryHandle} [opts.globalDir] — OPFS handle for clawser_agents/
   * @param {FileSystemDirectoryHandle} [opts.wsDir] — OPFS handle for workspace .agents/
   * @param {string} opts.wsId — workspace ID
   */
  constructor({ globalDir, wsDir, wsId }) {
    this.#globalDir = globalDir || null;
    this.#wsDir = wsDir || null;
    this.#wsId = wsId;
  }

  // ── List ──────────────────────────────────────────────────

  /** List all global agent definitions. */
  async listGlobal() {
    const index = this.#loadIndex('clawser_agents_index');
    const agents = [];
    for (const entry of index) {
      const agent = await this.load(entry.id);
      if (agent) agents.push(agent);
    }
    return agents;
  }

  /** List workspace-scoped agent definitions. */
  async listWorkspace() {
    const index = this.#loadIndex(`clawser_agents_index_${this.#wsId}`);
    const agents = [];
    for (const entry of index) {
      const agent = await this.load(entry.id);
      if (agent) agents.push(agent);
    }
    return agents;
  }

  /**
   * List all agents (global + workspace + built-ins), with workspace overriding global by name.
   * @returns {Promise<Array<Object>>}
   */
  async listAll() {
    const merged = new Map();

    // Built-ins first (lowest priority)
    for (const b of BUILTIN_AGENTS) {
      merged.set(b.name.toLowerCase(), { ...b });
    }

    // Global agents override built-ins
    const global = await this.listGlobal();
    for (const a of global) merged.set(a.name.toLowerCase(), a);

    // Workspace agents override global
    const ws = await this.listWorkspace();
    for (const a of ws) merged.set(a.name.toLowerCase(), a);

    return [...merged.values()];
  }

  // ── CRUD ─────────────────────────────────────────────────

  /**
   * Save an agent definition to OPFS + update localStorage index.
   * @param {Object} agent
   */
  async save(agent) {
    agent.updatedAt = new Date().toISOString();
    if (!agent.createdAt) agent.createdAt = agent.updatedAt;

    const dir = agent.scope === 'workspace' ? this.#wsDir : this.#globalDir;
    if (!dir) {
      console.warn('[AgentStorage] No OPFS directory for scope:', agent.scope);
      // Fall back to localStorage-only storage
      this.#updateIndex(agent);
      this.#saveToLocalStorage(agent);
      return;
    }

    try {
      const file = await dir.getFileHandle(`${agent.id}.json`, { create: true });
      const writable = await file.createWritable();
      await writable.write(JSON.stringify(agent, null, 2));
      await writable.close();
    } catch (e) {
      console.warn('[AgentStorage] OPFS write failed, using localStorage:', e);
      this.#saveToLocalStorage(agent);
    }

    this.#updateIndex(agent);
  }

  /**
   * Load an agent definition by ID. Tries OPFS first, falls back to localStorage.
   * @param {string} id
   * @returns {Promise<Object|null>}
   */
  async load(id) {
    // Check built-ins
    const builtin = BUILTIN_AGENTS.find(b => b.id === id);
    if (builtin) return { ...builtin };

    // Try OPFS (workspace dir first, then global)
    for (const dir of [this.#wsDir, this.#globalDir]) {
      if (!dir) continue;
      try {
        const file = await dir.getFileHandle(`${id}.json`);
        const text = await (await file.getFile()).text();
        return JSON.parse(text);
      } catch (_) { /* not found in this dir */ }
    }

    // Fall back to localStorage
    try {
      const raw = localStorage.getItem(`clawser_agent_${id}`);
      if (raw) return JSON.parse(raw);
    } catch (_) { /* parse error */ }

    return null;
  }

  /**
   * Delete an agent definition.
   * @param {string} id
   */
  async delete(id) {
    // Remove from OPFS
    for (const dir of [this.#wsDir, this.#globalDir]) {
      if (!dir) continue;
      try {
        await dir.removeEntry(`${id}.json`);
      } catch (_) { /* not found */ }
    }

    // Remove from localStorage
    localStorage.removeItem(`clawser_agent_${id}`);

    // Remove from indexes
    for (const key of ['clawser_agents_index', `clawser_agents_index_${this.#wsId}`]) {
      try {
        const idx = JSON.parse(localStorage.getItem(key) || '[]');
        const filtered = idx.filter(e => e.id !== id);
        localStorage.setItem(key, JSON.stringify(filtered));
      } catch (_) { /* index parse error */ }
    }
  }

  // ── Active agent ──────────────────────────────────────────

  /**
   * Get the active agent definition for the current workspace.
   * @returns {Promise<Object|null>}
   */
  async getActive() {
    const id = localStorage.getItem(`clawser_active_agent_${this.#wsId}`);
    return id ? this.load(id) : null;
  }

  /**
   * Set the active agent for the current workspace.
   * @param {string} agentId
   */
  setActive(agentId) {
    localStorage.setItem(`clawser_active_agent_${this.#wsId}`, agentId);
  }

  // ── Seeding ───────────────────────────────────────────────

  /**
   * Seed built-in agents if the global index is empty.
   * Called once during workspace initialization.
   */
  async seedBuiltins() {
    const index = this.#loadIndex('clawser_agents_index');
    if (index.length > 0) return; // Already seeded

    // Built-ins are loaded from BUILTIN_AGENTS const, not persisted to OPFS.
    // They appear via listAll() automatically.
  }

  // ── Import / Export ───────────────────────────────────────

  /**
   * Export an agent as JSON (strips accountId for safety).
   * @param {Object} agent
   * @returns {string}
   */
  exportAgent(agent) {
    const exportable = { ...agent };
    delete exportable.accountId;
    return JSON.stringify(exportable, null, 2);
  }

  /**
   * Import an agent from JSON. Assigns a new ID and clears accountId.
   * @param {string} json
   * @returns {Promise<Object>}
   */
  async importAgent(json) {
    const agent = JSON.parse(json);
    if (!agent || typeof agent !== 'object' || Array.isArray(agent)) throw new Error('Invalid agent: expected an object');
    if (!agent.name || typeof agent.name !== 'string') throw new Error('Invalid agent: missing name');
    if (!agent.provider || typeof agent.provider !== 'string') throw new Error('Invalid agent: missing provider');
    agent.id = generateAgentId();
    agent.accountId = null;
    agent.createdAt = new Date().toISOString();
    agent.updatedAt = agent.createdAt;
    await this.save(agent);
    return agent;
  }

  // ── Private ───────────────────────────────────────────────

  #loadIndex(key) {
    try {
      const raw = localStorage.getItem(key);
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch (_) {
      return [];
    }
  }

  #updateIndex(agent) {
    const key = agent.scope === 'workspace'
      ? `clawser_agents_index_${this.#wsId}`
      : 'clawser_agents_index';
    const idx = this.#loadIndex(key);
    const entry = { id: agent.id, name: agent.name, updatedAt: agent.updatedAt };
    const existing = idx.findIndex(e => e.id === agent.id);
    if (existing >= 0) idx[existing] = entry;
    else idx.push(entry);
    localStorage.setItem(key, JSON.stringify(idx));
  }

  #saveToLocalStorage(agent) {
    try {
      localStorage.setItem(`clawser_agent_${agent.id}`, JSON.stringify(agent));
    } catch (e) {
      console.warn('[AgentStorage] localStorage save failed:', e);
    }
  }
}

export { BUILTIN_AGENTS, generateAgentId };
