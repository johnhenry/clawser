/**
 * Clawser MCP Client
 *
 * Connects to MCP (Model Context Protocol) servers to discover and invoke
 * external tools. Augments the existing tool registries — does NOT replace them.
 *
 * Supports the Streamable HTTP transport (2025 spec):
 *   POST /mcp → JSON-RPC requests
 *   GET /mcp → SSE stream for server-initiated messages
 *
 * Usage:
 *   const mcp = new McpClient('http://localhost:3000/mcp');
 *   await mcp.connect();
 *   const tools = mcp.tools;      // Array of ToolSpec
 *   const result = await mcp.callTool('tool_name', { arg: 'value' });
 */

let jsonRpcId = 0;

function nextId() {
  return ++jsonRpcId;
}

export class McpClient {
  #endpoint;
  #sessionId = null;
  #tools = [];
  #connected = false;
  #onLog;
  #timeoutMs = 30_000;

  /**
   * @param {string} endpoint - MCP server endpoint URL
   * @param {object} [opts]
   * @param {Function} [opts.onLog] - Log callback (level, msg)
   * @param {number} [opts.timeoutMs] - Request timeout in milliseconds (default 30000)
   */
  constructor(endpoint, opts = {}) {
    this.#endpoint = endpoint;
    this.#onLog = opts.onLog || (() => {});
    if (opts.timeoutMs) this.#timeoutMs = opts.timeoutMs;
  }

  get endpoint() { return this.#endpoint; }
  get connected() { return this.#connected; }
  get tools() { return this.#tools; }
  get sessionId() { return this.#sessionId; }

  /** Convert MCP tools to Clawser ToolSpec format */
  get toolSpecs() {
    return this.#tools.map(t => ({
      name: `mcp_${t.name}`,
      description: `[MCP] ${t.description || t.name}`,
      parameters: t.inputSchema || { type: 'object', properties: {} },
      required_permission: 'network',
    }));
  }

  // ── JSON-RPC helpers ──────────────────────────────────────────

  async #rpc(method, params = {}) {
    const id = nextId();
    const body = {
      jsonrpc: '2.0',
      id,
      method,
      params,
    };

    const headers = { 'Content-Type': 'application/json' };
    if (this.#sessionId) {
      headers['Mcp-Session-Id'] = this.#sessionId;
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.#timeoutMs);
    let resp;
    try {
      resp = await fetch(this.#endpoint, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
        signal: controller.signal,
      });
    } catch (e) {
      clearTimeout(timer);
      if (e.name === 'AbortError') {
        throw new Error(`MCP request timed out after ${this.#timeoutMs / 1000}s`);
      }
      throw e;
    }
    clearTimeout(timer);

    // Capture session ID from response
    const sid = resp.headers.get('Mcp-Session-Id');
    if (sid) this.#sessionId = sid;

    if (!resp.ok) {
      const text = await resp.text();
      throw new Error(`MCP ${resp.status}: ${text}`);
    }

    const contentType = resp.headers.get('Content-Type') || '';

    // Handle SSE responses (server may stream)
    if (contentType.includes('text/event-stream')) {
      return this.#parseSseResponse(resp);
    }

    // Handle JSON response
    const result = await resp.json();

    // Could be a single response or an array (batch)
    if (Array.isArray(result)) {
      const match = result.find(r => r.id === id);
      if (match?.error) throw new Error(`MCP error: ${match.error.message}`);
      return match?.result;
    }

    if (result.error) throw new Error(`MCP error: ${result.error.message}`);
    return result.result;
  }

  async #parseSseResponse(resp) {
    const reader = resp.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let result = null;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        if (line.startsWith('data: ')) {
          try {
            const data = JSON.parse(line.slice(6));
            if (data.result !== undefined) result = data.result;
            if (data.error) throw new Error(`MCP SSE error: ${data.error.message}`);
          } catch (e) {
            if (e.message.startsWith('MCP SSE')) throw e;
          }
        }
      }
    }

    return result;
  }

  // ── Lifecycle ─────────────────────────────────────────────────

  async connect() {
    this.#onLog(2, `MCP: connecting to ${this.#endpoint}...`);

    // Initialize
    const initResult = await this.#rpc('initialize', {
      protocolVersion: '2025-03-26',
      capabilities: {},
      clientInfo: {
        name: 'clawser-browser',
        version: '0.1.0',
      },
    });

    this.#onLog(2, `MCP: initialized — server: ${initResult?.serverInfo?.name || 'unknown'}`);

    // Send initialized notification (no id = notification)
    const headers = { 'Content-Type': 'application/json' };
    if (this.#sessionId) headers['Mcp-Session-Id'] = this.#sessionId;
    await fetch(this.#endpoint, {
      method: 'POST',
      headers,
      body: JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }),
    }).catch(e => this.#onLog(3, `MCP: initialized notification failed (non-blocking): ${e.message}`));

    // Discover tools
    await this.discoverTools();
    this.#connected = true;

    this.#onLog(2, `MCP: connected — ${this.#tools.length} tools available`);
    return initResult;
  }

  async disconnect() {
    this.#connected = false;
    this.#tools = [];
    this.#sessionId = null;
    this.#onLog(2, 'MCP: disconnected');
  }

  // ── Tool discovery ────────────────────────────────────────────

  async discoverTools() {
    const result = await this.#rpc('tools/list');
    this.#tools = result?.tools || [];
    return this.#tools;
  }

  // ── Tool invocation ───────────────────────────────────────────

  /**
   * Call an MCP tool.
   * @param {string} name - Tool name (without mcp_ prefix)
   * @param {object} args - Tool arguments
   * @returns {Promise<{success: boolean, output: string, error?: string}>}
   */
  async callTool(name, args = {}) {
    try {
      const result = await this.#rpc('tools/call', { name, arguments: args });

      // MCP returns content as array of {type, text} blocks
      const content = result?.content || [];
      const textParts = content
        .filter(c => c.type === 'text')
        .map(c => c.text);

      const output = textParts.join('\n') || JSON.stringify(result);
      const isError = result?.isError === true;

      return {
        success: !isError,
        output,
        error: isError ? output : undefined,
      };
    } catch (e) {
      return {
        success: false,
        output: '',
        error: e.message,
      };
    }
  }

  /**
   * Check if this client handles a tool name (with mcp_ prefix).
   * @param {string} fullName - Tool name as registered (e.g., "mcp_search")
   */
  handlesTool(fullName) {
    if (!fullName.startsWith('mcp_')) return false;
    const baseName = fullName.slice(4);
    return this.#tools.some(t => t.name === baseName);
  }

  /**
   * Get the MCP tool name from the registered name.
   * @param {string} fullName - e.g., "mcp_search" → "search"
   */
  mcpName(fullName) {
    return fullName.startsWith('mcp_') ? fullName.slice(4) : fullName;
  }
}

/**
 * MCP Connection Manager — manages multiple MCP server connections.
 */
export class McpManager {
  /** @type {Map<string, McpClient>} */
  #clients = new Map();
  #onLog;

  constructor(opts = {}) {
    this.#onLog = opts.onLog || (() => {});
  }

  /**
   * Add and connect to an MCP server.
   * @param {string} name - Display name for this server
   * @param {string} endpoint - Server endpoint URL
   */
  /** @type {import('./clawser-kernel-integration.js').KernelIntegration|null} */
  _kernelIntegration = null;

  async addServer(name, endpoint) {
    const client = new McpClient(endpoint, { onLog: this.#onLog });
    await client.connect();
    this.#clients.set(name, client);
    // Step 25: Register MCP server as svc:// service in kernel
    if (this._kernelIntegration) {
      this._kernelIntegration.registerMcpService(name, client);
    }
    return client;
  }

  removeServer(name) {
    const client = this.#clients.get(name);
    if (client) {
      // Step 25: Unregister from kernel service registry
      if (this._kernelIntegration) {
        this._kernelIntegration.unregisterMcpService(name);
      }
      client.disconnect();
      this.#clients.delete(name);
    }
  }

  /** Get all tool specs from all connected servers */
  allToolSpecs() {
    const specs = [];
    for (const client of this.#clients.values()) {
      specs.push(...client.toolSpecs);
    }
    return specs;
  }

  /** Find the client that handles a given tool name */
  findClient(toolName) {
    for (const client of this.#clients.values()) {
      if (client.handlesTool(toolName)) return client;
    }
    return null;
  }

  /** Execute a tool call on the appropriate MCP server */
  async executeTool(toolName, args) {
    const client = this.findClient(toolName);
    if (!client) {
      return { success: false, output: '', error: `No MCP server handles tool: ${toolName}` };
    }
    return client.callTool(client.mcpName(toolName), args);
  }

  get serverNames() { return [...this.#clients.keys()]; }
  get serverCount() { return this.#clients.size; }

  getClient(name) { return this.#clients.get(name); }
}
