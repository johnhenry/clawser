/**
 * clawser-server-tools.js — Agent tools for the virtual server subsystem (Phase 7)
 *
 * Provides 8 tools for managing virtual HTTP servers:
 *   server_list, server_add, server_remove, server_update,
 *   server_start, server_stop, server_logs, server_test
 */

import { BrowserTool } from './clawser-tools.js';
import { getServerManager } from './clawser-server.js';

// ── server_list ──────────────────────────────────────────────────

export class ServerListTool extends BrowserTool {
  get name() { return 'server_list'; }
  get description() { return 'List all registered virtual servers (global + workspace). Returns hostname, port, type, enabled status.'; }
  get parameters() {
    return {
      type: 'object',
      properties: {
        scope: { type: 'string', description: 'Filter by scope: "_global" or a workspace ID. Omit for all.' },
      },
    };
  }
  get permission() { return 'read'; }

  async execute({ scope }) {
    const mgr = getServerManager();
    const routes = await mgr.listRoutes(scope || undefined);
    const summary = routes.map(r => ({
      id: r.id,
      hostname: r.hostname,
      port: r.port,
      type: r.handler?.type || 'unknown',
      execution: r.handler?.execution || 'page',
      scope: r.scope,
      enabled: r.enabled,
    }));
    return { success: true, output: JSON.stringify(summary, null, 2) };
  }
}

// ── server_add ───────────────────────────────────────────────────

export class ServerAddTool extends BrowserTool {
  #getWsId;
  constructor(getWsId) { super(); this.#getWsId = getWsId; }

  get name() { return 'server_add'; }
  get description() {
    return 'Register a new virtual server route. Specify hostname, handler type (function/static/proxy), and execution mode (page/sw).';
  }
  get parameters() {
    return {
      type: 'object',
      properties: {
        hostname: { type: 'string', description: 'Virtual hostname (e.g., "myapp.internal", "api.local")' },
        port: { type: 'number', description: 'Port number (default: 80)' },
        type: { type: 'string', enum: ['function', 'static', 'proxy', 'skill'], description: 'Handler type' },
        execution: { type: 'string', enum: ['page', 'sw'], description: 'Execution mode (default: page)' },
        code: { type: 'string', description: 'Inline handler code (for function type)' },
        staticRoot: { type: 'string', description: 'OPFS path to serve (for static type)' },
        proxyTarget: { type: 'string', description: 'Target URL (for proxy type)' },
        proxyRewrite: { type: 'string', description: 'Path rewrite rule "pattern -> replacement" (for proxy type)' },
        env: { type: 'object', description: 'Environment variables as key-value pairs' },
        scope: { type: 'string', description: '"_global" or workspace ID. Defaults to current workspace.' },
      },
      required: ['hostname', 'type'],
    };
  }
  get permission() { return 'approve'; }

  async execute(params) {
    const mgr = getServerManager();
    const scope = params.scope || this.#getWsId();
    const handler = {
      type: params.type,
      execution: params.execution || 'page',
    };

    if (params.type === 'function') {
      if (params.code) {
        handler.source = 'inline';
        handler.code = params.code;
      }
    } else if (params.type === 'static') {
      handler.staticSource = 'opfs';
      handler.staticRoot = params.staticRoot || '';
      handler.indexFile = 'index.html';
    } else if (params.type === 'proxy') {
      handler.proxyTarget = params.proxyTarget || '';
      handler.proxyRewrite = params.proxyRewrite || '';
      handler.proxyHeaders = {};
    }

    const id = await mgr.addRoute({
      hostname: params.hostname.toLowerCase(),
      port: params.port || 80,
      scope,
      handler,
      env: params.env || {},
      enabled: true,
    });

    const portStr = (params.port && params.port !== 80) ? `:${params.port}` : '';
    return {
      success: true,
      output: `Server registered: ${params.hostname}${portStr} (${params.type}, ${handler.execution})\nID: ${id}\nURL: ${location.origin}/http/${params.hostname}${portStr}/`,
    };
  }
}

// ── server_remove ────────────────────────────────────────────────

export class ServerRemoveTool extends BrowserTool {
  get name() { return 'server_remove'; }
  get description() { return 'Remove a registered virtual server by its route ID.'; }
  get parameters() {
    return {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'Route ID to remove' },
      },
      required: ['id'],
    };
  }
  get permission() { return 'approve'; }

  async execute({ id }) {
    const mgr = getServerManager();
    const existing = await mgr.getRouteById(id);
    if (!existing) return { success: false, output: '', error: `Route ${id} not found` };
    await mgr.removeRoute(id);
    return { success: true, output: `Removed server ${existing.hostname}:${existing.port} (${id})` };
  }
}

// ── server_update ────────────────────────────────────────────────

export class ServerUpdateTool extends BrowserTool {
  get name() { return 'server_update'; }
  get description() { return 'Update a virtual server\'s configuration (handler code, env vars, enabled state).'; }
  get parameters() {
    return {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'Route ID to update' },
        code: { type: 'string', description: 'New handler code (function type only)' },
        env: { type: 'object', description: 'Environment variables to merge' },
        enabled: { type: 'boolean', description: 'Enable/disable the server' },
        proxyTarget: { type: 'string', description: 'New proxy target URL' },
        staticRoot: { type: 'string', description: 'New OPFS path for static serving' },
      },
      required: ['id'],
    };
  }
  get permission() { return 'approve'; }

  async execute(params) {
    const mgr = getServerManager();
    const existing = await mgr.getRouteById(params.id);
    if (!existing) return { success: false, output: '', error: `Route ${params.id} not found` };

    const updates = {};
    const handlerUpdates = {};
    if (params.code !== undefined) { handlerUpdates.code = params.code; handlerUpdates.source = 'inline'; }
    if (params.proxyTarget !== undefined) handlerUpdates.proxyTarget = params.proxyTarget;
    if (params.staticRoot !== undefined) handlerUpdates.staticRoot = params.staticRoot;
    if (Object.keys(handlerUpdates).length > 0) updates.handler = handlerUpdates;
    if (params.env !== undefined) updates.env = params.env;
    if (params.enabled !== undefined) updates.enabled = params.enabled;

    await mgr.updateRoute(params.id, updates);
    return { success: true, output: `Updated server ${params.id}` };
  }
}

// ── server_start ─────────────────────────────────────────────────

export class ServerStartTool extends BrowserTool {
  get name() { return 'server_start'; }
  get description() { return 'Enable and start a virtual server.'; }
  get parameters() {
    return {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'Route ID to start' },
      },
      required: ['id'],
    };
  }
  get permission() { return 'approve'; }

  async execute({ id }) {
    const mgr = getServerManager();
    const existing = await mgr.getRouteById(id);
    if (!existing) return { success: false, output: '', error: `Route ${id} not found` };
    await mgr.startServer(id);
    return { success: true, output: `Started server ${existing.hostname}:${existing.port}` };
  }
}

// ── server_stop ──────────────────────────────────────────────────

export class ServerStopTool extends BrowserTool {
  get name() { return 'server_stop'; }
  get description() { return 'Disable and stop a virtual server.'; }
  get parameters() {
    return {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'Route ID to stop' },
      },
      required: ['id'],
    };
  }
  get permission() { return 'approve'; }

  async execute({ id }) {
    const mgr = getServerManager();
    const existing = await mgr.getRouteById(id);
    if (!existing) return { success: false, output: '', error: `Route ${id} not found` };
    await mgr.stopServer(id);
    return { success: true, output: `Stopped server ${existing.hostname}:${existing.port}` };
  }
}

// ── server_logs ──────────────────────────────────────────────────

export class ServerLogsTool extends BrowserTool {
  get name() { return 'server_logs'; }
  get description() { return 'Read request/response logs for a virtual server. Returns recent requests with method, path, status, and latency.'; }
  get parameters() {
    return {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'Route ID to read logs for' },
        limit: { type: 'number', description: 'Max entries to return (default: 20)' },
      },
      required: ['id'],
    };
  }
  get permission() { return 'read'; }

  async execute({ id, limit = 20 }) {
    const mgr = getServerManager();
    const logs = mgr.getLogs(id, limit);
    if (logs.length === 0) return { success: true, output: 'No request logs yet.' };

    const lines = logs.map(l => {
      const ts = new Date(l.ts).toISOString().slice(11, 23);
      return `${ts}  ${l.method.padEnd(6)} ${l.status} ${l.path}  (${l.ms}ms)`;
    });
    return { success: true, output: lines.join('\n') };
  }
}

// ── server_test ──────────────────────────────────────────────────

export class ServerTestTool extends BrowserTool {
  get name() { return 'server_test'; }
  get description() { return 'Send a test HTTP request to a virtual server and return the response. Routes through the SW intercept.'; }
  get parameters() {
    return {
      type: 'object',
      properties: {
        hostname: { type: 'string', description: 'Target hostname' },
        port: { type: 'number', description: 'Target port (default: 80)' },
        path: { type: 'string', description: 'Request path (default: /)' },
        method: { type: 'string', description: 'HTTP method (default: GET)' },
        headers: { type: 'object', description: 'Request headers' },
        body: { type: 'string', description: 'Request body' },
      },
      required: ['hostname'],
    };
  }
  get permission() { return 'approve'; }

  async execute({ hostname, port = 80, path = '/', method = 'GET', headers, body }) {
    const mgr = getServerManager();
    try {
      const result = await mgr.testRequest(hostname, port, path, { method, headers, body });
      const output = [
        `HTTP/${result.status} ${result.statusText}`,
        ...Object.entries(result.headers).map(([k, v]) => `${k}: ${v}`),
        '',
        result.body.slice(0, 4096),
      ].join('\n');
      return { success: true, output };
    } catch (e) {
      return { success: false, output: '', error: `Test request failed: ${e.message}` };
    }
  }
}

// ── Registration helper ──────────────────────────────────────────

/**
 * Register all server tools with the browser tool registry.
 * @param {import('./clawser-tools.js').BrowserToolRegistry} registry
 * @param {() => string} getWsId - Returns active workspace ID
 */
export function registerServerTools(registry, getWsId) {
  registry.register(new ServerListTool());
  registry.register(new ServerAddTool(getWsId));
  registry.register(new ServerRemoveTool());
  registry.register(new ServerUpdateTool());
  registry.register(new ServerStartTool());
  registry.register(new ServerStopTool());
  registry.register(new ServerLogsTool());
  registry.register(new ServerTestTool());
}
