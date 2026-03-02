/**
 * clawser-gateway-server.js — Gateway Server (Phase 7a)
 *
 * Virtual server routes via ServerManager for remote access gateway.
 * Routes: POST /pair (pairing code exchange), POST /message (bearer-authenticated
 * agent dispatch), GET /stream (SSE streaming), GET /status (health check).
 * Page-mode handlers for full agent/tool/DOM access.
 *
 * @module clawser-gateway-server
 */

// ── GatewayRoute ─────────────────────────────────────────────────

/**
 * A single gateway route entry.
 */
export class GatewayRoute {
  /** @type {string} HTTP method or '*' for all */
  #method;
  /** @type {string} URL path */
  #path;
  /** @type {Function} Handler function */
  #handler;

  /**
   * @param {string} method - HTTP method ('GET','POST','*')
   * @param {string} path - URL path
   * @param {Function} handler - async (request) => response
   */
  constructor(method, path, handler) {
    this.#method = method.toUpperCase();
    this.#path = path;
    this.#handler = handler;
  }

  get method() { return this.#method; }
  get path() { return this.#path; }
  get handler() { return this.#handler; }

  /**
   * Check if this route matches a method + path.
   * @param {string} method
   * @param {string} path
   * @returns {boolean}
   */
  matches(method, path) {
    if (this.#method !== '*' && this.#method !== method.toUpperCase()) return false;
    return this.#path === path;
  }
}

// ── GatewayServer ────────────────────────────────────────────────

/**
 * GatewayServer — virtual HTTP server for remote access gateway.
 *
 * Manages a set of routes and dispatches incoming requests. Integrates with
 * PairingManager for authentication and agent for message handling.
 */
export class GatewayServer {
  /** @type {GatewayRoute[]} */
  #routes = [];
  /** @type {object} PairingManager instance */
  #pairing;
  /** @type {object} Agent instance */
  #agent;
  /** @type {object|null} ServerManager instance */
  #serverManager;
  /** @type {Map<string, object[]>} token → pending SSE events */
  #sseQueues = new Map();

  /**
   * @param {object} opts
   * @param {object} opts.pairing - PairingManager instance
   * @param {object} opts.agent - ClawserAgent instance
   * @param {object} [opts.serverManager] - ServerManager for route registration
   */
  constructor(opts = {}) {
    this.#pairing = opts.pairing;
    this.#agent = opts.agent;
    this.#serverManager = opts.serverManager || null;

    // Register default routes
    this.#registerDefaults();
  }

  // ── Route management ──────────────────────────────────────────

  /**
   * Add a route to the gateway.
   * @param {string} method
   * @param {string} path
   * @param {Function} handler - async (req) => { status, headers?, body? }
   */
  addRoute(method, path, handler) {
    this.#routes.push(new GatewayRoute(method, path, handler));
  }

  /**
   * Remove a route by method and path.
   * @param {string} method
   * @param {string} path
   */
  removeRoute(method, path) {
    this.#routes = this.#routes.filter(r => !(r.method === method.toUpperCase() && r.path === path));
  }

  /**
   * List all registered routes.
   * @returns {GatewayRoute[]}
   */
  listRoutes() {
    return [...this.#routes];
  }

  /**
   * Register a page-mode handler (full agent/tool/DOM access).
   * @param {string} method
   * @param {string} path
   * @param {Function} handler - async (req) => { status, headers?, body? }
   */
  registerPageHandler(method, path, handler) {
    this.addRoute(method, path, handler);
  }

  // ── Request dispatch ──────────────────────────────────────────

  /**
   * Dispatch an incoming request to the matching route.
   * @param {string} method - HTTP method
   * @param {string} path - URL path
   * @param {object} req - { headers, body?, query? }
   * @returns {Promise<{ status: number, headers?: object, body?: string }>}
   */
  async dispatch(method, path, req = {}) {
    const route = this.#routes.find(r => r.matches(method, path));
    if (!route) {
      return { status: 404, body: JSON.stringify({ error: 'Not found' }) };
    }

    try {
      return await route.handler({
        method,
        path,
        headers: req.headers || {},
        body: req.body || null,
        query: req.query || {},
      });
    } catch (err) {
      return {
        status: 500,
        body: JSON.stringify({ error: err.message || 'Internal server error' }),
      };
    }
  }

  // ── Token extraction ──────────────────────────────────────────

  /**
   * Extract bearer token from headers.
   * @param {object} headers
   * @returns {string|null}
   */
  extractToken(headers) {
    const auth = headers.authorization || headers.Authorization || '';
    if (!auth.startsWith('Bearer ')) return null;
    return auth.slice(7).trim();
  }

  // ── Default routes ────────────────────────────────────────────

  #registerDefaults() {
    // POST /pair — exchange pairing code for bearer token
    this.addRoute('POST', '/pair', async (req) => {
      const data = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
      if (!data || !data.code) {
        return { status: 400, body: JSON.stringify({ error: 'Missing code' }) };
      }

      const result = this.#pairing.exchangeCode(data.code, {
        device: data.device || null,
        ip: data.ip || null,
      });

      if (!result) {
        return { status: 401, body: JSON.stringify({ error: 'Invalid or expired code' }) };
      }

      return {
        status: 200,
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ token: result.token, expires: result.expires }),
      };
    });

    // POST /message — send message to agent (bearer-authenticated)
    this.addRoute('POST', '/message', async (req) => {
      const token = this.extractToken(req.headers);
      if (!token || !this.#pairing.validateToken(token)) {
        return { status: 401, body: JSON.stringify({ error: 'Unauthorized' }) };
      }

      const data = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
      if (!data || !data.text) {
        return { status: 400, body: JSON.stringify({ error: 'Missing text' }) };
      }

      const result = await this.#agent.run(data.text);

      // Queue response for SSE stream if listener exists
      if (this.#sseQueues.has(token)) {
        this.#sseQueues.get(token).push({
          type: 'message',
          data: JSON.stringify(result),
        });
      }

      return {
        status: 200,
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(result),
      };
    });

    // GET /stream — SSE event stream (bearer-authenticated)
    this.addRoute('GET', '/stream', async (req) => {
      const token = this.extractToken(req.headers);
      if (!token || !this.#pairing.validateToken(token)) {
        return { status: 401, body: JSON.stringify({ error: 'Unauthorized' }) };
      }

      // If a text query param is provided, stream the agent response
      const text = req.query?.text;
      const events = [];

      if (text && this.#agent.runStream) {
        for await (const chunk of this.#agent.runStream(text)) {
          events.push(`data: ${JSON.stringify(chunk)}`);
        }
      }

      // Also drain any pending SSE queue
      if (this.#sseQueues.has(token)) {
        const pending = this.#sseQueues.get(token).splice(0);
        for (const evt of pending) {
          events.push(`data: ${JSON.stringify(evt)}`);
        }
      }

      if (events.length === 0) {
        events.push(`data: ${JSON.stringify({ type: 'ping' })}`);
      }

      return {
        status: 200,
        headers: {
          'content-type': 'text/event-stream',
          'cache-control': 'no-cache',
          'connection': 'keep-alive',
        },
        body: events.join('\n') + '\n',
      };
    });

    // GET /status — health check (unauthenticated)
    this.addRoute('GET', '/status', async () => {
      return {
        status: 200,
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          ok: true,
          sessions: this.#pairing.sessionCount,
          timestamp: Date.now(),
        }),
      };
    });
  }

  // ── SSE queue management ──────────────────────────────────────

  /**
   * Create an SSE queue for a token (called when a client subscribes).
   * @param {string} token
   */
  createSSEQueue(token) {
    if (!this.#sseQueues.has(token)) {
      this.#sseQueues.set(token, []);
    }
  }

  /**
   * Remove an SSE queue for a token (called when a client disconnects).
   * @param {string} token
   */
  removeSSEQueue(token) {
    this.#sseQueues.delete(token);
  }

  /**
   * Push an event to all active SSE queues.
   * @param {object} event - { type, data }
   */
  broadcastSSE(event) {
    for (const queue of this.#sseQueues.values()) {
      queue.push(event);
    }
  }
}
