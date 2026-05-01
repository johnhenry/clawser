/**
 * Clawser RPC — JSON-RPC 2.0 server for programmatic agent access.
 *
 * Runs the agent as a background process that other tools can talk to via
 * newline-delimited JSON-RPC over stdin/stdout or a Unix domain socket.
 *
 * Supported methods:
 *   - send              Send a message and get the agent response
 *   - tools.list        List available tools
 *   - tools.execute     Execute a tool directly (bypasses LLM)
 *   - session.status    Get agent state summary
 *   - session.history   Get conversation event log
 *   - memory.recall     Search agent memory
 *   - memory.store      Store a memory entry
 *
 * Notifications (no response):
 *   - cancel            Abort any in-progress run
 *
 * @module clawser-rpc
 */

// ── JSON-RPC 2.0 Constants ─────────────────────────────────────

const JSONRPC = '2.0';

const RPC_ERRORS = {
  PARSE_ERROR:      { code: -32700, message: 'Parse error' },
  INVALID_REQUEST:  { code: -32600, message: 'Invalid Request' },
  METHOD_NOT_FOUND: { code: -32601, message: 'Method not found' },
  INVALID_PARAMS:   { code: -32602, message: 'Invalid params' },
  INTERNAL_ERROR:   { code: -32603, message: 'Internal error' },
  NO_AGENT:         { code: -32000, message: 'No agent available' },
  AGENT_ERROR:      { code: -32001, message: 'Agent error' },
};

// ── Response Builders ──────────────────────────────────────────

/**
 * Build a JSON-RPC 2.0 success response.
 *
 * @param {*} id - Request ID
 * @param {*} result - Result payload
 * @returns {object}
 *
 * @example
 *   rpcSuccess(1, { model: 'claude-sonnet' })
 *   // => { jsonrpc: '2.0', id: 1, result: { model: 'claude-sonnet' } }
 */
const rpcSuccess = (id, result) => ({ jsonrpc: JSONRPC, id, result });

/**
 * Build a JSON-RPC 2.0 error response.
 *
 * @param {*} id - Request ID (null for parse errors)
 * @param {{ code: number, message: string }} error - Error template from RPC_ERRORS
 * @param {*} [data] - Optional additional error data
 * @returns {object}
 */
const rpcError = (id, error, data) => {
  const err = { code: error.code, message: error.message };
  if (data !== undefined) err.data = data;
  return { jsonrpc: JSONRPC, id, error: err };
};

// ── Method Handlers ────────────────────────────────────────────

/**
 * Create the method dispatch table.
 *
 * @param {() => import('./clawser-agent.js').ClawserAgent | null} getAgent
 * @returns {Record<string, (params: object, id: *) => Promise<object>>}
 */
const createHandlers = (getAgent) => {

  const requireAgent = () => {
    const agent = getAgent();
    if (!agent) throw RPC_ERRORS.NO_AGENT;
    return agent;
  };

  return {
    /**
     * Send a message to the agent and return the response.
     * @param {{ message: string }} params
     */
    async send(params) {
      if (!params?.message || typeof params.message !== 'string') {
        throw { ...RPC_ERRORS.INVALID_PARAMS, data: 'params.message (string) is required' };
      }
      const agent = requireAgent();
      agent.sendMessage(params.message);
      const resp = await agent.run();
      return {
        content: resp?.content || resp?.data || resp?.text || '(no response)',
        status: resp?.status ?? 0,
      };
    },

    /**
     * List available tools.
     */
    async ['tools.list']() {
      const agent = requireAgent();
      const state = agent.getState();
      const checkpoint = agent.getCheckpointJSON();
      return {
        tool_count: state.tool_count ?? 0,
        tools: [], // tool specs are private; expose count + names when available
      };
    },

    /**
     * Execute a tool directly (bypasses LLM).
     * @param {{ name: string, params?: object }} params
     */
    async ['tools.execute'](params) {
      if (!params?.name || typeof params.name !== 'string') {
        throw { ...RPC_ERRORS.INVALID_PARAMS, data: 'params.name (string) is required' };
      }
      const agent = requireAgent();
      const result = await agent.executeToolDirect(params.name, params.params || {});
      return result;
    },

    /**
     * Get agent session status.
     */
    async ['session.status']() {
      const agent = requireAgent();
      const state = agent.getState();
      const model = agent.getModel() || '(provider default)';
      return {
        model,
        state: state.agent_state || 'Idle',
        history_len: state.history_len ?? 0,
        memory_count: state.memory_count ?? 0,
        goals: state.goals?.length ?? 0,
        scheduler_jobs: state.scheduler_jobs ?? 0,
      };
    },

    /**
     * Get conversation history.
     * @param {{ limit?: number }} params
     */
    async ['session.history'](params) {
      const agent = requireAgent();
      const eventLog = agent.getEventLog();
      const events = eventLog?.events || [];
      const limit = params?.limit ?? 50;
      return {
        total: events.length,
        events: events.slice(-limit),
      };
    },

    /**
     * Search agent memory.
     * @param {{ query: string, limit?: number, category?: string }} params
     */
    async ['memory.recall'](params) {
      if (params && params.query !== undefined && typeof params.query !== 'string') {
        throw { ...RPC_ERRORS.INVALID_PARAMS, data: 'params.query must be a string' };
      }
      const agent = requireAgent();
      const query = params?.query ?? '';
      const entries = agent.memoryRecall(query, {
        limit: params?.limit,
        category: params?.category,
      });
      return { entries };
    },

    /**
     * Store a memory entry.
     * @param {{ key: string, content: string, category?: string }} params
     */
    async ['memory.store'](params) {
      if (!params?.key || typeof params.key !== 'string') {
        throw { ...RPC_ERRORS.INVALID_PARAMS, data: 'params.key (string) is required' };
      }
      if (!params?.content || typeof params.content !== 'string') {
        throw { ...RPC_ERRORS.INVALID_PARAMS, data: 'params.content (string) is required' };
      }
      const agent = requireAgent();
      const id = agent.memoryStore({
        key: params.key,
        content: params.content,
        category: params.category || 'user',
      });
      return { id, key: params.key };
    },
  };
};

// ── Notification Handlers ──────────────────────────────────────

/** @type {Set<string>} Methods treated as notifications (no response) */
const NOTIFICATION_METHODS = new Set(['cancel']);

// ── Request Dispatcher ─────────────────────────────────────────

/**
 * Process a single parsed JSON-RPC request object.
 *
 * @param {object} req - Parsed request
 * @param {Record<string, Function>} handlers - Method dispatch table
 * @param {() => import('./clawser-agent.js').ClawserAgent | null} getAgent
 * @returns {Promise<object|null>} Response object, or null for notifications
 */
const dispatchRequest = async (req, handlers, getAgent) => {
  // Validate JSON-RPC structure
  if (!req || typeof req !== 'object' || req.jsonrpc !== JSONRPC) {
    return rpcError(req?.id ?? null, RPC_ERRORS.INVALID_REQUEST);
  }

  if (typeof req.method !== 'string') {
    return rpcError(req.id ?? null, RPC_ERRORS.INVALID_REQUEST);
  }

  const isNotification = req.id === undefined;

  // Handle cancel notification
  if (req.method === 'cancel') {
    // Best-effort cancel — no response for notifications
    return null;
  }

  // Notifications for unknown methods: silently ignore per spec
  if (isNotification && !handlers[req.method]) {
    return null;
  }

  // Regular requests: method must exist
  if (!handlers[req.method]) {
    return rpcError(req.id, RPC_ERRORS.METHOD_NOT_FOUND, req.method);
  }

  try {
    const result = await handlers[req.method](req.params || {});
    if (isNotification) return null;
    return rpcSuccess(req.id, result);
  } catch (err) {
    if (isNotification) return null;
    // Known RPC error thrown by handler
    if (err && typeof err.code === 'number') {
      return rpcError(req.id, err, err.data);
    }
    // Unexpected error
    return rpcError(req.id, RPC_ERRORS.INTERNAL_ERROR, err?.message || String(err));
  }
};

// ── Line Protocol ──────────────────────────────────────────────

/**
 * Process a single line of input (one JSON-RPC request or batch).
 * Returns the JSON string(s) to write back, or null for notifications.
 *
 * @param {string} line - Raw input line
 * @param {Record<string, Function>} handlers - Method dispatch table
 * @param {() => import('./clawser-agent.js').ClawserAgent | null} getAgent
 * @returns {Promise<string|null>} JSON response line, or null
 */
export const processLine = async (line, handlers, getAgent) => {
  const trimmed = line.trim();
  if (!trimmed) return null;

  let parsed;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return JSON.stringify(rpcError(null, RPC_ERRORS.PARSE_ERROR));
  }

  // Batch request
  if (Array.isArray(parsed)) {
    if (parsed.length === 0) {
      return JSON.stringify(rpcError(null, RPC_ERRORS.INVALID_REQUEST));
    }
    const results = await Promise.all(
      parsed.map(req => dispatchRequest(req, handlers, getAgent))
    );
    const responses = results.filter(r => r !== null);
    if (responses.length === 0) return null; // all notifications
    return JSON.stringify(responses);
  }

  // Single request
  const response = await dispatchRequest(parsed, handlers, getAgent);
  if (response === null) return null;
  return JSON.stringify(response);
};

// ── Stdio Transport ────────────────────────────────────────────

/**
 * Start the RPC server on stdin/stdout.
 * Reads newline-delimited JSON-RPC from stdin, writes responses to stdout.
 *
 * @param {() => import('./clawser-agent.js').ClawserAgent | null} getAgent
 * @param {object} [opts]
 * @param {NodeJS.ReadableStream} [opts.stdin] - Override stdin (for testing)
 * @param {NodeJS.WritableStream} [opts.stdout] - Override stdout (for testing)
 * @param {(msg: string) => void} [opts.onLog] - Optional logger
 * @returns {{ close: () => void }} Handle to stop the server
 */
export const startStdioRpc = (getAgent, opts = {}) => {
  const input = opts.stdin || process.stdin;
  const output = opts.stdout || process.stdout;
  const log = opts.onLog || (() => {});
  const handlers = createHandlers(getAgent);

  let buffer = '';
  let closed = false;
  let processing = Promise.resolve();

  const onData = (chunk) => {
    buffer += chunk.toString();
    const lines = buffer.split('\n');
    buffer = lines.pop(); // keep incomplete last line in buffer

    // Chain processing to prevent interleaving from concurrent data events
    processing = processing.then(async () => {
      for (const line of lines) {
        if (closed) break;
        const response = await processLine(line, handlers, getAgent);
        if (response !== null && !closed) {
          output.write(response + '\n');
        }
      }
    });
  };

  input.on('data', onData);

  const onEnd = () => {
    closed = true;
    log('RPC stdin closed');
  };
  input.on('end', onEnd);

  log('RPC server started on stdio');

  return {
    close() {
      closed = true;
      input.removeListener('data', onData);
      input.removeListener('end', onEnd);
    },
  };
};

// ── Unix Socket Transport ──────────────────────────────────────

/**
 * Start the RPC server on a Unix domain socket.
 * Each connected client uses the same newline-delimited JSON-RPC protocol.
 *
 * @param {string} socketPath - Path for the Unix domain socket
 * @param {() => import('./clawser-agent.js').ClawserAgent | null} getAgent
 * @param {object} [opts]
 * @param {(msg: string) => void} [opts.onLog] - Optional logger
 * @returns {Promise<{ close: () => Promise<void>, socketPath: string }>}
 */
export const startSocketRpc = async (socketPath, getAgent, opts = {}) => {
  const { createServer } = await import('node:net');
  const { unlink } = await import('node:fs/promises');
  const log = opts.onLog || (() => {});
  const handlers = createHandlers(getAgent);

  // Clean up stale socket file
  try { await unlink(socketPath); } catch { /* ignore */ }

  const server = createServer((conn) => {
    log(`RPC client connected: ${conn.remoteAddress || 'local'}`);
    let buffer = '';

    conn.on('data', async (chunk) => {
      buffer += chunk.toString();
      const lines = buffer.split('\n');
      buffer = lines.pop();

      for (const line of lines) {
        const response = await processLine(line, handlers, getAgent);
        if (response !== null && !conn.destroyed) {
          conn.write(response + '\n');
        }
      }
    });

    conn.on('error', (err) => {
      log(`RPC client error: ${err.message}`);
    });
  });

  await new Promise((resolve, reject) => {
    server.on('error', reject);
    server.listen(socketPath, () => {
      log(`RPC server listening on ${socketPath}`);
      resolve();
    });
  });

  return {
    socketPath,
    async close() {
      await new Promise((resolve) => server.close(resolve));
      try { await unlink(socketPath); } catch { /* ignore */ }
    },
  };
};

// ── Exports for CLI integration ────────────────────────────────

export { createHandlers, dispatchRequest, rpcSuccess, rpcError, RPC_ERRORS, JSONRPC };
