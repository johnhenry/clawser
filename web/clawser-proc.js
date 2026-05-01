/**
 * clawser-proc.js — Virtual /proc and /run filesystem layer
 *
 * Generates read-only file content on demand for special paths.
 * When the shell reads from /proc/ or /run/, this layer intercepts
 * before hitting OPFS and generates content dynamically.
 *
 * Architecture:
 *   ProcFileHandler — registry of virtual file generators
 *   Each generator is a function: () => string (sync or async)
 *   Supports both file reads and directory listings.
 */

// ── ProcFileHandler ────────────────────���───────────────────────────

/**
 * @typedef {() => string | Promise<string>} ProcGenerator
 */

/**
 * Virtual filesystem handler for /proc and /run paths.
 * Registers generator functions that produce content on read.
 */
export class ProcFileHandler {
  /** @type {Map<string, ProcGenerator>} path → generator */
  #generators = new Map();

  /**
   * Register a virtual file generator.
   * @param {string} path - Virtual path (e.g. '/proc/clawser/tools')
   * @param {ProcGenerator} generator - Function returning file content
   */
  register(path, generator) {
    const norm = this.#normalize(path);
    this.#generators.set(norm, generator);
  }

  /**
   * Unregister a virtual file generator.
   * @param {string} path
   */
  unregister(path) {
    this.#generators.delete(this.#normalize(path));
  }

  /**
   * Check if a path is handled by the virtual filesystem.
   * @param {string} path
   * @returns {boolean}
   */
  handles(path) {
    const norm = this.#normalize(path);
    // Direct file match
    if (this.#generators.has(norm)) return true;
    // Directory listing — check if any generators are children of this path
    const prefix = norm.endsWith('/') ? norm : norm + '/';
    for (const key of this.#generators.keys()) {
      if (key.startsWith(prefix)) return true;
    }
    return false;
  }

  /**
   * Read a virtual file. Returns generated content.
   * @param {string} path
   * @returns {Promise<string>}
   * @throws {Error} If path is not registered
   */
  async readFile(path) {
    const norm = this.#normalize(path);
    const gen = this.#generators.get(norm);
    if (!gen) throw new Error(`ENOENT: ${path}`);
    return gen();
  }

  /**
   * List entries in a virtual directory.
   * @param {string} path
   * @returns {Array<{name: string, kind: 'file'|'directory'}>}
   */
  listDir(path) {
    const norm = this.#normalize(path);
    const prefix = norm.endsWith('/') ? norm : norm + '/';
    const seen = new Set();
    const entries = [];

    for (const key of this.#generators.keys()) {
      if (key.startsWith(prefix)) {
        const rest = key.slice(prefix.length);
        const name = rest.split('/')[0];
        if (!seen.has(name)) {
          seen.add(name);
          // If there's more after the name, it's a directory
          const isDir = rest.includes('/');
          entries.push({ name, kind: isDir ? 'directory' : 'file' });
        }
      }
    }

    return entries.sort((a, b) => a.name.localeCompare(b.name));
  }

  /**
   * Get all registered paths.
   * @returns {string[]}
   */
  get paths() {
    return [...this.#generators.keys()];
  }

  #normalize(path) {
    return path.replace(/\/+$/, '').replace(/\/+/g, '/');
  }
}

// ── Proc Generator Factories ───────────��───────────────────────────

/**
 * Register all /proc/clawser/* virtual files.
 * @param {ProcFileHandler} handler
 * @param {object} ctx - Application context
 * @param {import('./clawser-tools.js').BrowserToolRegistry} ctx.toolRegistry
 * @param {import('./clawser-cost-tracker.js').CostTracker} [ctx.costTracker]
 * @param {import('./clawser-memory.js').SemanticMemory} [ctx.memory]
 * @param {import('./clawser-daemon.js').DaemonState} [ctx.daemonState]
 * @param {import('./clawser-daemon.js').TabCoordinator} [ctx.tabCoordinator]
 * @param {object} [ctx.agentConfig] - Agent configuration data
 * @param {object} [ctx.providerStatus] - Provider health check results
 * @param {number} [ctx.initTime] - performance.now() at workspace init
 * @param {string} [ctx.wsId] - Workspace ID
 */
export const registerProcGenerators = (handler, ctx) => {
  const {
    toolRegistry,
    costTracker,
    memory,
    daemonState,
    tabCoordinator,
    agentConfig,
    providerStatus,
    initTime = performance.now(),
    wsId = 'default',
  } = ctx;

  // /proc/clawser/version
  handler.register('/proc/clawser/version', () => '0.1.0-beta\n');

  // /proc/clawser/uptime
  handler.register('/proc/clawser/uptime', () => {
    const seconds = Math.floor((performance.now() - initTime) / 1000);
    return `${seconds}\n`;
  });

  // /proc/clawser/tools
  handler.register('/proc/clawser/tools', () => {
    if (!toolRegistry) return '(no tool registry)\n';
    const specs = toolRegistry.allSpecs();
    const lines = specs.map(s => {
      const perm = toolRegistry.getPermission(s.name);
      const desc = s.description || '';
      return `${s.name}\t${perm}\t${desc}`;
    });
    return lines.join('\n') + '\n';
  });

  // /proc/clawser/metrics
  handler.register('/proc/clawser/metrics', () => {
    if (!costTracker) return JSON.stringify({ totalCost: 0, totalTokens: 0, calls: 0 }, null, 2) + '\n';
    const records = costTracker.getRecords();
    const totalCost = records.reduce((sum, r) => sum + r.costCents, 0);
    const totalTokens = records.reduce((sum, r) => sum + r.tokens.input_tokens + r.tokens.output_tokens, 0);
    const calls = records.length;
    const perModel = costTracker.getPerModelBreakdown(30);
    return JSON.stringify({ totalCost, totalTokens, calls, perModel }, null, 2) + '\n';
  });

  // /proc/clawser/health
  handler.register('/proc/clawser/health', () => {
    const checks = [];
    let status = 'healthy';

    if (toolRegistry) {
      const toolCount = toolRegistry.names().length;
      checks.push({ component: 'tools', status: toolCount > 0 ? 'ok' : 'warn', count: toolCount });
      if (toolCount === 0) status = 'degraded';
    }

    if (daemonState) {
      const phase = daemonState.phase;
      const daemonOk = phase !== 'error';
      checks.push({ component: 'daemon', status: daemonOk ? 'ok' : 'error', phase });
      if (!daemonOk) status = 'unhealthy';
    }

    if (memory) {
      checks.push({ component: 'memory', status: 'ok', entries: memory.size });
    }

    return JSON.stringify({ status, checks, timestamp: Date.now() }, null, 2) + '\n';
  });

  // /proc/clawser/agents
  handler.register('/proc/clawser/agents', () => {
    if (!agentConfig || !Array.isArray(agentConfig)) {
      // Try reading from localStorage as fallback
      const agents = [];
      if (typeof localStorage !== 'undefined') {
        for (let i = 0; i < localStorage.length; i++) {
          const key = localStorage.key(i);
          if (key && key.startsWith('clawser_agent_')) {
            try {
              const data = JSON.parse(localStorage.getItem(key));
              agents.push({ name: data.name || key.replace('clawser_agent_', ''), provider: data.provider || 'unknown' });
            } catch { /* skip */ }
          }
        }
      }
      if (agents.length === 0) return '(no agents configured)\n';
      return agents.map(a => `${a.name}\t${a.provider}`).join('\n') + '\n';
    }
    return agentConfig.map(a => {
      const provider = a.provider || a.model || 'unknown';
      return `${a.name}\t${provider}`;
    }).join('\n') + '\n';
  });

  // /proc/clawser/memory
  handler.register('/proc/clawser/memory', () => {
    if (!memory) return JSON.stringify({ count: 0, categories: {}, storageEstimate: '0 B' }, null, 2) + '\n';
    const entries = memory.size;
    // Estimate categories by reading all entries if possible
    const stats = { count: entries, storageEstimate: `~${Math.ceil(entries * 200)} B` };
    return JSON.stringify(stats, null, 2) + '\n';
  });

  // /proc/clawser/sessions
  handler.register('/proc/clawser/sessions', () => {
    if (typeof localStorage === 'undefined') return '(no sessions)\n';
    const key = `clawser_v1_terminal_sessions_${wsId}`;
    try {
      const raw = localStorage.getItem(key);
      if (!raw) return '(no active sessions)\n';
      const sessions = JSON.parse(raw);
      if (!Array.isArray(sessions) || sessions.length === 0) return '(no active sessions)\n';
      return sessions.map(s => `${s.id || 'unknown'}\t${s.name || 'shell'}\t${s.status || 'active'}`).join('\n') + '\n';
    } catch {
      return '(no active sessions)\n';
    }
  });

  // /proc/clawser/providers
  handler.register('/proc/clawser/providers', () => {
    if (providerStatus && typeof providerStatus === 'object') {
      const lines = Object.entries(providerStatus).map(([name, info]) => {
        const status = info.healthy ? 'healthy' : 'error';
        const detail = info.error || '';
        return `${name}\t${status}\t${detail}`;
      });
      return lines.join('\n') + '\n';
    }
    // Fallback: read from localStorage config
    if (typeof localStorage === 'undefined') return '(no providers)\n';
    const configKey = `clawser_v1_config_${wsId}`;
    try {
      const raw = localStorage.getItem(configKey);
      if (!raw) return '(no providers configured)\n';
      const config = JSON.parse(raw);
      const providers = config.providers || {};
      const lines = Object.entries(providers).map(([name, cfg]) => {
        const enabled = cfg.enabled !== false ? 'healthy' : 'disabled';
        return `${name}\t${enabled}`;
      });
      return lines.length > 0 ? lines.join('\n') + '\n' : '(no providers configured)\n';
    } catch {
      return '(no providers configured)\n';
    }
  });
};

// ── Run Generator Factories ────────────────────────��───────────────

/**
 * Register all /run/clawser/* virtual files.
 * @param {ProcFileHandler} handler
 * @param {object} ctx - Application context (same as registerProcGenerators)
 */
export const registerRunGenerators = (handler, ctx) => {
  const {
    daemonState,
    tabCoordinator,
    costTracker,
  } = ctx;

  // /run/clawser/pid
  handler.register('/run/clawser/pid', () => {
    if (tabCoordinator) return `${tabCoordinator.tabId}\n`;
    // Fallback: generate a stable-ish ID from the session
    return `tab_${Date.now().toString(36)}\n`;
  });

  // /run/clawser/agent.status
  handler.register('/run/clawser/agent.status', () => {
    if (!daemonState) return 'idle\n';
    return `${daemonState.phase}\n`;
  });

  // /run/clawser/cost.json
  handler.register('/run/clawser/cost.json', () => {
    if (!costTracker) return JSON.stringify({ totalCostCents: 0, sessionCalls: 0, breakdown: {} }, null, 2) + '\n';
    const records = costTracker.getRecords();
    const totalCostCents = records.reduce((sum, r) => sum + r.costCents, 0);
    const breakdown = {};
    for (const r of records) {
      if (!breakdown[r.model]) breakdown[r.model] = { costCents: 0, calls: 0, tokens: 0 };
      breakdown[r.model].costCents += r.costCents;
      breakdown[r.model].calls += 1;
      breakdown[r.model].tokens += r.tokens.input_tokens + r.tokens.output_tokens;
    }
    return JSON.stringify({ totalCostCents, sessionCalls: records.length, breakdown }, null, 2) + '\n';
  });

  // /run/clawser/tabs/ — directory listing of connected tabs
  // Individual tab files are generated dynamically
  if (tabCoordinator) {
    // Register a generator for each known tab dynamically isn't practical,
    // so we register the directory and individual lookups
    handler.register('/run/clawser/tabs', () => {
      const tabs = tabCoordinator.activeTabs;
      return tabs.map(t => `${t.tabId}\t${new Date(t.lastSeen).toISOString()}`).join('\n') + '\n';
    });
  } else {
    handler.register('/run/clawser/tabs', () => '(no tab coordinator)\n');
  }
};

// ── VirtualFs Wrapper ─────────────��────────────────────────────────

/**
 * Wraps a real filesystem (ShellFs/MemoryFs) and intercepts reads/listings
 * for virtual paths handled by ProcFileHandler and DeviceFileHandler.
 */
export class VirtualFs {
  /** @type {object} The underlying real filesystem */
  #realFs;
  /** @type {ProcFileHandler} */
  #proc;
  /** @type {import('./clawser-fs-devices.mjs').DeviceFileHandler|null} */
  #devices;

  /**
   * @param {object} realFs - ShellFs or MemoryFs instance
   * @param {ProcFileHandler} proc - Virtual file handler
   * @param {import('./clawser-fs-devices.mjs').DeviceFileHandler} [devices] - Device file handler
   */
  constructor(realFs, proc, devices) {
    this.#realFs = realFs;
    this.#proc = proc;
    this.#devices = devices || null;
  }

  /** Paths that are always virtual (read-only) regardless of handler registration. */
  #isVirtualRoot(path) {
    return path.startsWith('/proc/') || path.startsWith('/run/') ||
           path === '/proc' || path === '/run';
  }

  /** Check if a path is in the /dev/clawser/ namespace. */
  #isDevicePath(path) {
    return path.startsWith('/dev/clawser/') || path === '/dev/clawser' || path === '/dev';
  }

  /** Access the underlying proc handler (for registration). */
  get proc() { return this.#proc; }

  /** Access the device file handler (for registration). */
  get devices() { return this.#devices; }

  /** Access the underlying real filesystem. */
  get realFs() { return this.#realFs; }

  async readFile(path) {
    // Device files — handled by DeviceFileHandler
    if (this.#devices && this.#devices.isDevice(path)) {
      return this.#devices.handleRead(path);
    }
    if (this.#proc.handles(path)) {
      // Check if it's a direct file (not just a directory prefix)
      try {
        return await this.#proc.readFile(path);
      } catch {
        // Not a direct file, fall through to real FS
      }
    }
    return this.#realFs.readFile(path);
  }

  async writeFile(path, content) {
    // Device files — dispatch to device handler
    if (this.#devices && this.#devices.isDevice(path)) {
      return this.#devices.handleWrite(path, content);
    }
    // Virtual paths are read-only
    if (this.#proc.handles(path) || this.#isVirtualRoot(path)) {
      throw new Error(`Read-only: ${path} is a virtual file`);
    }
    return this.#realFs.writeFile(path, content);
  }

  async listDir(path, opts) {
    // Device directory listings
    if (this.#devices && this.#isDevicePath(path)) {
      const deviceEntries = this.#devices.listDir(path);
      if (deviceEntries.length > 0) return deviceEntries;
    }
    if (this.#proc.handles(path)) {
      const virtualEntries = this.#proc.listDir(path);
      if (virtualEntries.length > 0) return virtualEntries;
    }
    // Fall through to real FS for non-virtual paths
    return this.#realFs.listDir(path, opts);
  }

  async mkdir(path) {
    if (this.#devices && this.#isDevicePath(path)) {
      throw new Error(`Cannot mkdir in device filesystem: ${path}`);
    }
    if (this.#proc.handles(path) || this.#isVirtualRoot(path)) {
      throw new Error(`Read-only: ${path} is a virtual directory`);
    }
    return this.#realFs.mkdir(path);
  }

  async delete(path, recursive) {
    if (this.#devices && this.#isDevicePath(path)) {
      throw new Error(`Cannot delete device file: ${path}`);
    }
    if (this.#proc.handles(path) || this.#isVirtualRoot(path)) {
      throw new Error(`Read-only: ${path} is a virtual file`);
    }
    return this.#realFs.delete(path, recursive);
  }

  async copy(src, dst) {
    // Allow reading from virtual/device, writing to device or real
    if (this.#proc.handles(dst) || this.#isVirtualRoot(dst)) {
      throw new Error(`Read-only: ${dst} is a virtual file`);
    }
    const content = await this.readFile(src);
    await this.writeFile(dst, content);
  }

  async move(src, dst) {
    if (this.#proc.handles(src)) {
      throw new Error(`Read-only: ${src} is a virtual file`);
    }
    if (this.#devices && this.#isDevicePath(src)) {
      throw new Error(`Cannot move device file: ${src}`);
    }
    if (this.#proc.handles(dst)) {
      throw new Error(`Read-only: ${dst} is a virtual file`);
    }
    return this.#realFs.move(src, dst);
  }

  async stat(path) {
    // Device files
    if (this.#devices && this.#devices.isDevice(path)) {
      // Check if it's a specific device (file) or a directory
      try {
        // Try to determine if it's a registered device path directly
        const state = this.#devices.getState(path);
        if (state !== undefined) {
          return { kind: 'file', size: 0, lastModified: Date.now() };
        }
      } catch { /* fall through */ }
      // Check if it's a device directory
      const entries = this.#devices.listDir(path);
      if (entries.length > 0) return { kind: 'directory' };
    }
    if (this.#proc.handles(path)) {
      // Check if it's a file or directory
      try {
        await this.#proc.readFile(path);
        return { kind: 'file', size: 0, lastModified: Date.now() };
      } catch {
        // It's a directory
        const entries = this.#proc.listDir(path);
        if (entries.length > 0) return { kind: 'directory' };
      }
    }
    if (this.#realFs.stat) return this.#realFs.stat(path);
    return null;
  }
}
