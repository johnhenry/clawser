// clawser-bridge.js — External Tool Integration
//
// ExternalBridge: abstract interface for external tool bridges
// LocalServerBridge: connects to clawser-bridge local server
// ExtensionBridge: connects via browser extension message channel
// BridgeManager: auto-detection, lifecycle, tool surface
// Agent tools: bridge_status, bridge_list_tools, bridge_fetch

import { BrowserTool } from './clawser-tools.js';

// ── Constants ───────────────────────────────────────────────────

export const BRIDGE_TYPES = Object.freeze({
  LOCAL_SERVER: 'local_server',
  EXTENSION: 'extension',
  NONE: 'none',
});

export const DEFAULT_BRIDGE_URL = 'http://localhost:9377';
export const BRIDGE_HEALTH_PATH = '/health';
export const BRIDGE_TOOLS_PATH = '/mcp/tools';
export const BRIDGE_CALL_PATH = '/mcp/call';
export const BRIDGE_PROXY_PATH = '/proxy';
export const EXTENSION_MARKER = '__clawser_ext__';

// ── ExternalBridge (Abstract) ───────────────────────────────────

/**
 * Abstract interface for external tool bridges.
 * Both LocalServerBridge and ExtensionBridge implement this.
 */
export class ExternalBridge {
  /**
   * Check if this bridge is available.
   * @returns {Promise<boolean>}
   */
  async isAvailable() { return false; }

  /**
   * Get bridge type identifier.
   * @returns {string}
   */
  get type() { return BRIDGE_TYPES.NONE; }

  /**
   * List available tools from this bridge.
   * @returns {Promise<Array<{name: string, description: string, parameters: object}>>}
   */
  async listTools() { return []; }

  /**
   * Call a tool by name.
   * @param {string} name
   * @param {object} args
   * @returns {Promise<{success: boolean, output: string, error?: string}>}
   */
  async callTool(name, args) {
    return { success: false, output: '', error: 'Bridge not implemented' };
  }

  /**
   * Proxy a fetch request through the bridge (bypasses CORS).
   * @param {string} url
   * @param {object} [opts] - Fetch options
   * @returns {Promise<{status: number, headers: object, body: string}>}
   */
  async proxyFetch(url, opts = {}) {
    return { status: 0, headers: {}, body: '', error: 'Bridge not implemented' };
  }

  /**
   * Disconnect / cleanup.
   */
  async disconnect() {}
}

// ── LocalServerBridge ───────────────────────────────────────────

/**
 * Bridge that connects to a local clawser-bridge server.
 */
export class LocalServerBridge extends ExternalBridge {
  #baseUrl;
  #apiKey;
  #available = false;
  #fetchFn;

  /**
   * @param {object} [opts]
   * @param {string} [opts.baseUrl] - Bridge server URL
   * @param {string} [opts.apiKey] - Authentication token
   * @param {Function} [opts.fetchFn] - Custom fetch function (for testing)
   */
  constructor(opts = {}) {
    super();
    this.#baseUrl = (opts.baseUrl || DEFAULT_BRIDGE_URL).replace(/\/+$/, '');
    this.#apiKey = opts.apiKey || null;
    this.#fetchFn = opts.fetchFn || globalThis.fetch?.bind(globalThis);
  }

  get type() { return BRIDGE_TYPES.LOCAL_SERVER; }
  get baseUrl() { return this.#baseUrl; }

  async isAvailable() {
    try {
      const resp = await this.#fetch(BRIDGE_HEALTH_PATH);
      this.#available = resp.status >= 200 && resp.status < 300;
      return this.#available;
    } catch {
      this.#available = false;
      return false;
    }
  }

  async listTools() {
    if (!this.#available) return [];
    try {
      const resp = await this.#fetch(BRIDGE_TOOLS_PATH);
      if (!resp.ok) return [];
      const data = await resp.json();
      return Array.isArray(data.tools) ? data.tools : [];
    } catch {
      return [];
    }
  }

  async callTool(name, args) {
    if (!this.#available) {
      return { success: false, output: '', error: 'Bridge not available' };
    }
    try {
      const resp = await this.#fetch(BRIDGE_CALL_PATH, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, arguments: args }),
      });
      const data = await resp.json();
      return {
        success: data.success !== false,
        output: data.output || data.result || '',
        error: data.error || undefined,
      };
    } catch (e) {
      return { success: false, output: '', error: e.message };
    }
  }

  async proxyFetch(url, opts = {}) {
    if (!this.#available) {
      return { status: 0, headers: {}, body: '', error: 'Bridge not available' };
    }
    try {
      const resp = await this.#fetch(BRIDGE_PROXY_PATH, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url, method: opts.method || 'GET', headers: opts.headers, body: opts.body }),
      });
      const data = await resp.json();
      return {
        status: data.status || 0,
        headers: data.headers || {},
        body: data.body || '',
      };
    } catch (e) {
      return { status: 0, headers: {}, body: '', error: e.message };
    }
  }

  #fetch(path, opts = {}) {
    const headers = { ...(opts.headers || {}) };
    if (this.#apiKey) {
      headers['Authorization'] = `Bearer ${this.#apiKey}`;
    }
    return this.#fetchFn(this.#baseUrl + path, { ...opts, headers });
  }
}

// ── ExtensionBridge ─────────────────────────────────────────────

/**
 * Bridge that communicates via browser extension message channel.
 */
export class ExtensionBridge extends ExternalBridge {
  #available = false;
  #pending = new Map();
  #nextId = 1;
  #timeout;
  #listener = null;

  /**
   * @param {object} [opts]
   * @param {number} [opts.timeout=10000] - RPC timeout in ms
   */
  constructor(opts = {}) {
    super();
    this.#timeout = opts.timeout || 10000;
  }

  get type() { return BRIDGE_TYPES.EXTENSION; }

  async isAvailable() {
    // Check for extension content script marker
    if (typeof globalThis !== 'undefined' && globalThis[EXTENSION_MARKER]) {
      this.#available = true;
      this.#setupListener();
      return true;
    }
    this.#available = false;
    return false;
  }

  async listTools() {
    if (!this.#available) return [];
    try {
      const result = await this.#rpc('listTools', {});
      return Array.isArray(result) ? result : [];
    } catch {
      return [];
    }
  }

  async callTool(name, args) {
    if (!this.#available) {
      return { success: false, output: '', error: 'Extension not available' };
    }
    try {
      const result = await this.#rpc('callTool', { name, arguments: args });
      return {
        success: result.success !== false,
        output: result.output || '',
        error: result.error || undefined,
      };
    } catch (e) {
      return { success: false, output: '', error: e.message };
    }
  }

  async proxyFetch(url, opts = {}) {
    if (!this.#available) {
      return { status: 0, headers: {}, body: '', error: 'Extension not available' };
    }
    try {
      const result = await this.#rpc('proxyFetch', { url, ...opts });
      return {
        status: result.status || 0,
        headers: result.headers || {},
        body: result.body || '',
      };
    } catch (e) {
      return { status: 0, headers: {}, body: '', error: e.message };
    }
  }

  async disconnect() {
    if (this.#listener && typeof globalThis.removeEventListener === 'function') {
      globalThis.removeEventListener('message', this.#listener);
      this.#listener = null;
    }
    this.#pending.clear();
  }

  #setupListener() {
    if (this.#listener) return;
    this.#listener = (event) => {
      if (event.data?.type === 'clawser-rpc-response' && event.data.id) {
        const resolve = this.#pending.get(event.data.id);
        if (resolve) {
          this.#pending.delete(event.data.id);
          resolve(event.data.result);
        }
      }
    };
    if (typeof globalThis.addEventListener === 'function') {
      globalThis.addEventListener('message', this.#listener);
    }
  }

  #rpc(method, params) {
    return new Promise((resolve, reject) => {
      const id = this.#nextId++;
      const timer = setTimeout(() => {
        this.#pending.delete(id);
        reject(new Error(`RPC timeout: ${method}`));
      }, this.#timeout);

      this.#pending.set(id, (result) => {
        clearTimeout(timer);
        if (result?.error) reject(new Error(result.error));
        else resolve(result);
      });

      if (typeof globalThis.postMessage === 'function') {
        globalThis.postMessage({ type: 'clawser-rpc', id, method, params }, '*');
      } else {
        clearTimeout(timer);
        this.#pending.delete(id);
        reject(new Error('postMessage not available'));
      }
    });
  }
}

// ── BridgeManager ───────────────────────────────────────────────

/**
 * Manages bridge auto-detection and lifecycle.
 */
export class BridgeManager {
  /** @type {ExternalBridge|null} */
  #active = null;

  /** @type {LocalServerBridge} */
  #localBridge;

  /** @type {ExtensionBridge} */
  #extensionBridge;

  /** @type {Function|null} */
  #onStatusChange;

  /**
   * @param {object} [opts]
   * @param {LocalServerBridge} [opts.localBridge]
   * @param {ExtensionBridge} [opts.extensionBridge]
   * @param {Function} [opts.onStatusChange] - (bridgeType, available) callback
   */
  constructor(opts = {}) {
    this.#localBridge = opts.localBridge || new LocalServerBridge();
    this.#extensionBridge = opts.extensionBridge || new ExtensionBridge();
    this.#onStatusChange = opts.onStatusChange || null;
  }

  /**
   * Auto-detect available bridges. Prefers extension, falls back to local server.
   * @returns {Promise<string>} Bridge type that was activated
   */
  async detect() {
    // 1. Check extension first
    if (await this.#extensionBridge.isAvailable()) {
      this.#active = this.#extensionBridge;
      this.#notify(BRIDGE_TYPES.EXTENSION, true);
      return BRIDGE_TYPES.EXTENSION;
    }

    // 2. Check local server
    if (await this.#localBridge.isAvailable()) {
      this.#active = this.#localBridge;
      this.#notify(BRIDGE_TYPES.LOCAL_SERVER, true);
      return BRIDGE_TYPES.LOCAL_SERVER;
    }

    // 3. Neither available
    this.#active = null;
    this.#notify(BRIDGE_TYPES.NONE, false);
    return BRIDGE_TYPES.NONE;
  }

  /** Whether any bridge is active. */
  get isConnected() { return this.#active !== null; }

  /** Active bridge type. */
  get activeType() { return this.#active?.type || BRIDGE_TYPES.NONE; }

  /** Active bridge instance (or null). */
  get bridge() { return this.#active; }

  /**
   * List tools from the active bridge.
   * @returns {Promise<Array>}
   */
  async listTools() {
    return this.#active ? this.#active.listTools() : [];
  }

  /**
   * Call a tool on the active bridge.
   * @param {string} name
   * @param {object} args
   * @returns {Promise<object>}
   */
  async callTool(name, args) {
    if (!this.#active) {
      return { success: false, output: '', error: 'No bridge connected' };
    }
    return this.#active.callTool(name, args);
  }

  /**
   * Proxy a fetch through the active bridge.
   * @param {string} url
   * @param {object} [opts]
   * @returns {Promise<object>}
   */
  async proxyFetch(url, opts) {
    if (!this.#active) {
      return { status: 0, headers: {}, body: '', error: 'No bridge connected' };
    }
    return this.#active.proxyFetch(url, opts);
  }

  /**
   * Disconnect the active bridge.
   */
  async disconnect() {
    if (this.#active) {
      await this.#active.disconnect();
      this.#active = null;
      this.#notify(BRIDGE_TYPES.NONE, false);
    }
  }

  /**
   * Force-set a specific bridge as active.
   * @param {'local_server'|'extension'} type
   * @returns {Promise<boolean>}
   */
  async setActive(type) {
    if (type === BRIDGE_TYPES.LOCAL_SERVER) {
      if (await this.#localBridge.isAvailable()) {
        this.#active = this.#localBridge;
        this.#notify(BRIDGE_TYPES.LOCAL_SERVER, true);
        return true;
      }
    } else if (type === BRIDGE_TYPES.EXTENSION) {
      if (await this.#extensionBridge.isAvailable()) {
        this.#active = this.#extensionBridge;
        this.#notify(BRIDGE_TYPES.EXTENSION, true);
        return true;
      }
    }
    return false;
  }

  /**
   * Build system prompt section describing bridge status.
   * @returns {string}
   */
  buildPrompt() {
    if (!this.#active) return '';
    return `External bridge: ${this.#active.type} (connected)`;
  }

  #notify(type, available) {
    if (this.#onStatusChange) {
      this.#onStatusChange(type, available);
    }
  }
}

// ── Agent Tools ─────────────────────────────────────────────────

export class BridgeStatusTool extends BrowserTool {
  #manager;

  constructor(manager) {
    super();
    this.#manager = manager;
  }

  get name() { return 'bridge_status'; }
  get description() { return 'Show external bridge connection status.'; }
  get parameters() { return { type: 'object', properties: {} }; }
  get permission() { return 'read'; }

  async execute() {
    const lines = [
      `Connected: ${this.#manager.isConnected}`,
      `Type: ${this.#manager.activeType}`,
    ];
    return { success: true, output: lines.join('\n') };
  }
}

export class BridgeListToolsTool extends BrowserTool {
  #manager;

  constructor(manager) {
    super();
    this.#manager = manager;
  }

  get name() { return 'bridge_list_tools'; }
  get description() { return 'List tools available through the external bridge.'; }
  get parameters() { return { type: 'object', properties: {} }; }
  get permission() { return 'read'; }

  async execute() {
    if (!this.#manager.isConnected) {
      return { success: true, output: 'No bridge connected. Tools are only available when a bridge (local server or extension) is active.' };
    }
    const tools = await this.#manager.listTools();
    if (tools.length === 0) {
      return { success: true, output: 'Bridge connected but no tools available.' };
    }
    const lines = tools.map(t => `${t.name}: ${t.description || '(no description)'}`);
    return { success: true, output: `Bridge tools (${tools.length}):\n${lines.join('\n')}` };
  }
}

export class BridgeFetchTool extends BrowserTool {
  #manager;

  constructor(manager) {
    super();
    this.#manager = manager;
  }

  get name() { return 'bridge_fetch'; }
  get description() { return 'Fetch a URL through the external bridge (bypasses CORS).'; }
  get parameters() {
    return {
      type: 'object',
      properties: {
        url: { type: 'string', description: 'URL to fetch' },
        method: { type: 'string', description: 'HTTP method (default GET)' },
        headers: { type: 'object', description: 'Request headers' },
        body: { type: 'string', description: 'Request body' },
      },
      required: ['url'],
    };
  }
  get permission() { return 'approve'; }

  async execute({ url, method, headers, body }) {
    if (!this.#manager.isConnected) {
      return { success: false, output: '', error: 'No bridge connected' };
    }
    const result = await this.#manager.proxyFetch(url, { method, headers, body });
    if (result.error) {
      return { success: false, output: '', error: result.error };
    }
    const lines = [
      `Status: ${result.status}`,
      `Body (${result.body.length} chars):`,
      result.body.length > 2000 ? result.body.slice(0, 2000) + '...' : result.body,
    ];
    return { success: true, output: lines.join('\n') };
  }
}
