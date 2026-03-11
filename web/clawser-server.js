/**
 * clawser-server.js — Virtual Server Manager (Phase 7)
 *
 * Manages virtual HTTP servers running entirely in the browser.
 * Routes are stored in IndexedDB and intercepted by the Service Worker.
 * Handlers execute either in the SW (fast, limited) or in the main page
 * (full access to agent, tools, DOM) via MessageChannel relay.
 *
 * @module clawser-server
 */

import { opfsWalk, opfsWalkDir } from './clawser-opfs.js';

// ── Constants ────────────────────────────────────────────────────

const DB_NAME = 'clawser-server-routes';
const DB_VERSION = 1;
const STORE_NAME = 'routes';
const MAX_LOG_ENTRIES = 500;

// ── MIME types for static serving ────────────────────────────────

const MIME_TYPES = {
  'html': 'text/html', 'htm': 'text/html',
  'css': 'text/css',
  'js': 'application/javascript', 'mjs': 'application/javascript',
  'json': 'application/json',
  'xml': 'application/xml',
  'txt': 'text/plain', 'md': 'text/plain',
  'csv': 'text/csv',
  'svg': 'image/svg+xml',
  'png': 'image/png',
  'jpg': 'image/jpeg', 'jpeg': 'image/jpeg',
  'gif': 'image/gif',
  'webp': 'image/webp',
  'ico': 'image/x-icon',
  'woff': 'font/woff', 'woff2': 'font/woff2',
  'ttf': 'font/ttf',
  'pdf': 'application/pdf',
  'zip': 'application/zip',
  'wasm': 'application/wasm',
};

function guessMime(filename) {
  const ext = (filename.split('.').pop() || '').toLowerCase();
  return MIME_TYPES[ext] || 'application/octet-stream';
}

let _runtimeServiceResolver = null;

export function setServerRuntimeServiceResolver(resolver) {
  _runtimeServiceResolver = typeof resolver === 'function' ? resolver : null;
}

function appendProxyPath(baseAddress, targetPath) {
  const base = new URL(baseAddress);
  const incoming = new URL(targetPath || '/', 'http://clawser.local');
  const basePath = base.pathname.replace(/\/$/, '');
  const incomingPath = incoming.pathname || '/';
  base.pathname = `${basePath}${incomingPath === '/' ? '' : incomingPath}`;
  base.search = incoming.search || '';
  return base.toString();
}

async function resolveRuntimeProxyTarget(proxyTarget, targetPath, resolver = _runtimeServiceResolver) {
  if (typeof proxyTarget !== 'string' || !proxyTarget.trim()) {
    throw new Error('Proxy handler missing proxyTarget');
  }

  if (/^https?:\/\//i.test(proxyTarget)) {
    return appendProxyPath(proxyTarget, targetPath);
  }

  if (proxyTarget.startsWith('svc://')) {
    if (typeof resolver !== 'function') {
      throw new Error('No runtime service resolver is configured');
    }
    const serviceName = proxyTarget.slice('svc://'.length).trim();
    if (!serviceName) {
      throw new Error('Service proxy target must include a service name');
    }
    const resolved = await resolver({
      kind: 'service',
      serviceName,
      proxyTarget,
    });
    if (!resolved?.address || !/^https?:\/\//i.test(resolved.address)) {
      throw new Error(`Service "${serviceName}" is not bound to an HTTP endpoint`);
    }
    return appendProxyPath(resolved.address, targetPath);
  }

  if (proxyTarget.startsWith('runtime://')) {
    if (typeof resolver !== 'function') {
      throw new Error('No runtime service resolver is configured');
    }
    const spec = proxyTarget.slice('runtime://'.length).trim();
    const slashIndex = spec.indexOf('/');
    const selector = slashIndex === -1 ? spec : spec.slice(0, slashIndex);
    const serviceName = slashIndex === -1 ? '' : spec.slice(slashIndex + 1);
    if (!selector || !serviceName) {
      throw new Error('Runtime proxy target must be runtime://<selector>/<service>');
    }
    const resolved = await resolver({
      kind: 'runtime-service',
      selector,
      serviceName,
      proxyTarget,
    });
    if (!resolved?.address || !/^https?:\/\//i.test(resolved.address)) {
      throw new Error(`Runtime service "${selector}/${serviceName}" is not bound to an HTTP endpoint`);
    }
    return appendProxyPath(resolved.address, targetPath);
  }

  if (proxyTarget.startsWith('server://')) {
    if (typeof resolver !== 'function') {
      throw new Error('No runtime service resolver is configured');
    }
    const spec = proxyTarget.slice('server://'.length).trim();
    const slashIndex = spec.indexOf('/');
    const selector = slashIndex === -1 ? spec : spec.slice(0, slashIndex);
    const serviceName = slashIndex === -1 ? '' : spec.slice(slashIndex + 1);
    if (!selector || !serviceName) {
      throw new Error('Server proxy target must be server://<selector>/<server>');
    }
    const resolved = await resolver({
      kind: 'managed-server',
      selector,
      serviceName,
      proxyTarget,
    });
    if (!resolved?.address || !/^https?:\/\//i.test(resolved.address)) {
      throw new Error(`Managed server "${selector}/${serviceName}" is not bound to an HTTP endpoint`);
    }
    return appendProxyPath(resolved.address, targetPath);
  }

  if (proxyTarget.startsWith('endpoint://')) {
    if (typeof resolver !== 'function') {
      throw new Error('No runtime service resolver is configured');
    }
    const endpointName = proxyTarget.slice('endpoint://'.length).trim();
    if (!endpointName) {
      throw new Error('Endpoint proxy target must include an endpoint name');
    }
    const resolved = await resolver({
      kind: 'endpoint',
      endpointName,
      proxyTarget,
    });
    if (!resolved?.endpoint || !/^https?:\/\//i.test(resolved.endpoint)) {
      throw new Error(`Endpoint "${endpointName}" is not bound to an HTTP endpoint`);
    }
    return appendProxyPath(resolved.endpoint, targetPath);
  }

  throw new Error(`Unsupported proxy target: ${proxyTarget}`);
}

/**
 * Escape HTML special characters to prevent XSS.
 * NOTE: Intentionally local — this module is a headless server manager that
 * must remain free of UI imports (clawser-state.js). Other UI modules should
 * import `esc` from clawser-state.js instead of duplicating this function.
 */
function escHtml(str) {
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// ── IndexedDB helpers ────────────────────────────────────────────

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        const store = db.createObjectStore(STORE_NAME, { keyPath: 'id' });
        store.createIndex('host_port', ['hostname', 'port'], { unique: false });
        store.createIndex('scope', 'scope', { unique: false });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function dbGet(db, id) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const req = tx.objectStore(STORE_NAME).get(id);
    req.onsuccess = () => resolve(req.result || null);
    req.onerror = () => reject(req.error);
  });
}

function dbGetAll(db, indexName, key) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const store = tx.objectStore(STORE_NAME);
    const req = indexName
      ? store.index(indexName).getAll(key)
      : store.getAll();
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => reject(req.error);
  });
}

function dbPut(db, record) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const req = tx.objectStore(STORE_NAME).put(record);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

function dbDelete(db, id) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const req = tx.objectStore(STORE_NAME).delete(id);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

// ── ServerManager ────────────────────────────────────────────────

export class ServerManager {
  #db = null;
  #handlerCache = new Map();   // routeId → compiled module
  #logs = new Map();           // routeId → [{ts, method, path, status, ms}]
  #listeners = new Set();      // onChange callbacks

  #initialized = false;

  async init() {
    if (this.#db) this.#db.close();
    this.#db = await openDB();
    if (this.#initialized) return; // listeners already attached
    this.#initialized = true;
    // Listen for SW → page relay messages
    if (typeof navigator !== 'undefined' && navigator.serviceWorker) {
      navigator.serviceWorker.addEventListener('message', (event) => {
        if (event.data?.type === 'server-fetch') {
          this.#handlePageRequest(event.data);
        }
      });
    }
  }

  // ── Route CRUD ───────────────────────────────────────────────

  /**
   * Add a new server route.
   * @param {object} route - ServerRoute (without id — will be generated)
   * @returns {Promise<string>} route id
   */
  async addRoute(route) {
    const id = route.id || `srv_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const record = {
      ...route,
      id,
      hostname: (route.hostname || '').toLowerCase(),
      port: route.port ?? 80,
      scope: route.scope || '_global',
      handler: route.handler || { type: 'function', execution: 'page' },
      env: route.env || {},
      enabled: route.enabled !== false,
      created: route.created || new Date().toISOString(),
    };
    await dbPut(this.#db, record);
    this.#notify();
    return id;
  }

  async removeRoute(id) {
    await dbDelete(this.#db, id);
    this.#handlerCache.delete(id);
    this.#logs.delete(id);
    this.#notify();
  }

  async updateRoute(id, updates) {
    const existing = await dbGet(this.#db, id);
    if (!existing) throw new Error(`Route ${id} not found`);
    const merged = { ...existing, ...updates };
    if (updates.handler) merged.handler = { ...existing.handler, ...updates.handler };
    if (updates.env) merged.env = { ...existing.env, ...updates.env };
    await dbPut(this.#db, merged);
    // Invalidate compiled handler on update
    this.#handlerCache.delete(id);
    this.#notify();
  }

  async getRoute(hostname, port = 80) {
    const routes = await dbGetAll(this.#db, 'host_port', [hostname.toLowerCase(), port]);
    const enabled = routes.filter(r => r.enabled);
    if (enabled.length === 0) return null;
    // Per-workspace takes priority over global
    return enabled.find(r => r.scope !== '_global') || enabled[0];
  }

  async getRouteById(id) {
    return dbGet(this.#db, id);
  }

  async listRoutes(scope) {
    if (scope) {
      return dbGetAll(this.#db, 'scope', scope);
    }
    return dbGetAll(this.#db);
  }

  // ── Handler lifecycle ────────────────────────────────────────

  async startServer(id) {
    await this.updateRoute(id, { enabled: true });
  }

  async stopServer(id) {
    await this.updateRoute(id, { enabled: false });
    this.#handlerCache.delete(id);
  }

  // ── Handler compilation ──────────────────────────────────────

  /**
   * Compile a function handler from code string.
   * Uses Blob URL + dynamic import (same pattern as actually-serverless).
   * @param {string} code - JS module source
   * @returns {Promise<object>} module with default/onRequestGet/etc exports
   */
  async compileHandler(code) {
    const blob = new Blob([code], { type: 'application/javascript' });
    const url = URL.createObjectURL(blob);
    try {
      return await import(url);
    } finally {
      URL.revokeObjectURL(url);
    }
  }

  /**
   * Get (or compile) the handler module for a route.
   * Caches compiled modules by route id.
   */
  async getHandler(route) {
    if (this.#handlerCache.has(route.id)) {
      return this.#handlerCache.get(route.id);
    }

    const handler = route.handler;
    if (handler.type !== 'function') return null;

    let code = handler.code;
    if (handler.source === 'opfs' && handler.path) {
      code = await this.#readOPFS(handler.path);
    }
    if (!code) return null;

    const mod = await this.compileHandler(code);
    this.#handlerCache.set(route.id, mod);
    return mod;
  }

  // ── Page-mode request handler ────────────────────────────────

  /**
   * Handle a SW→page relay message. Executes the handler in the main page context.
   * @param {object} data - { port, pseudoRequest }
   */
  async #handlePageRequest(data) {
    const { port, pseudoRequest } = data;
    const { routeId, url, method, headers, body, hostname, port: rPort } = pseudoRequest;
    const start = performance.now();

    try {
      const route = await this.getRouteById(routeId);
      if (!route) {
        port.postMessage({ error: 'Route not found' });
        return;
      }

      let response;
      const handler = route.handler;

      if (handler.type === 'function') {
        response = await this.#executeFunctionHandler(route, url, method, headers, body);
      } else if (handler.type === 'static') {
        response = await this.#executeStaticHandler(route, url);
      } else if (handler.type === 'proxy') {
        response = await this.#executeProxyHandler(route, url, method, headers, body);
      } else {
        response = new Response('Unsupported handler type', { status: 501 });
      }

      const elapsed = performance.now() - start;
      this.#logRequest(routeId, method, url, response.status, elapsed);

      // Convert Response to pseudo-response for MessageChannel transfer
      let resBody = null;
      try { resBody = await response.arrayBuffer(); } catch { resBody = null; }

      port.postMessage({
        pseudoResponse: {
          body: resBody,
          status: response.status,
          statusText: response.statusText,
          headers: [...response.headers.entries()],
        },
      }, resBody ? [resBody] : []);

    } catch (e) {
      const elapsed = performance.now() - start;
      this.#logRequest(routeId, method, url, 500, elapsed);
      port.postMessage({ error: e.message || 'Handler error' });
    }
  }

  async #executeFunctionHandler(route, url, method, headers, body) {
    const mod = await this.getHandler(route);
    if (!mod) {
      return new Response('No handler code found', { status: 500 });
    }

    // Construct URL reflecting the virtual hostname, not the page origin
    const virtualUrl = `http://${route.hostname}:${route.port}${url}`;
    const request = new Request(virtualUrl, {
      method,
      headers: new Headers(headers),
      body: body && !['GET', 'HEAD'].includes(method) ? body : undefined,
    });

    // Method-specific handler takes priority
    const methodKey = `onRequest${method.charAt(0).toUpperCase() + method.slice(1).toLowerCase()}`;
    const fn = mod[methodKey] || mod.default;
    if (typeof fn !== 'function') {
      return new Response('Handler has no callable export', { status: 500 });
    }

    const ctx = {
      request,
      env: route.env || {},
      log: this.#createLogger(route.id),
    };

    return await fn(ctx);
  }

  async #executeStaticHandler(route, url) {
    const handler = route.handler;
    const staticRoot = handler.staticRoot || '';
    const indexFile = handler.indexFile || 'index.html';

    let filePath = url.split('?')[0]; // strip query
    if (filePath === '/' || filePath === '') filePath = '/' + indexFile;

    const fullPath = staticRoot + filePath;

    try {
      const content = await this.#readOPFSBinary(fullPath);
      if (content === null) {
        // Try directory listing
        if (!filePath.endsWith('/')) filePath += '/';
        const indexPath = staticRoot + filePath + indexFile;
        const indexContent = await this.#readOPFSBinary(indexPath);
        if (indexContent !== null) {
          return new Response(indexContent, {
            status: 200,
            headers: { 'Content-Type': guessMime(indexFile) },
          });
        }
        // Generate directory listing
        const listing = await this.#listOPFSDirectory(staticRoot + filePath);
        if (listing) {
          const html = this.#renderDirectoryListing(filePath, listing);
          return new Response(html, {
            status: 200,
            headers: { 'Content-Type': 'text/html' },
          });
        }
        return new Response('Not Found', { status: 404 });
      }

      return new Response(content, {
        status: 200,
        headers: { 'Content-Type': guessMime(filePath) },
      });
    } catch (e) {
      return new Response(`Static serve error: ${e.message}`, { status: 500 });
    }
  }

  async #executeProxyHandler(route, url, method, headers, body) {
    const handler = route.handler;
    if (!handler.proxyTarget) {
      return new Response('Proxy handler missing proxyTarget', { status: 500 });
    }

    let targetPath = url;
    if (handler.proxyRewrite) {
      try {
        const arrowIdx = handler.proxyRewrite.indexOf('->');
        if (arrowIdx !== -1) {
          const pattern = handler.proxyRewrite.slice(0, arrowIdx).trim();
          const replacement = handler.proxyRewrite.slice(arrowIdx + 2).trim();
          if (pattern) targetPath = url.replace(new RegExp(pattern), replacement);
        }
      } catch { /* ignore bad rewrite rules */ }
    }

    const targetUrl = await resolveRuntimeProxyTarget(handler.proxyTarget, targetPath);
    const reqHeaders = new Headers(headers);

    if (handler.proxyHeaders) {
      for (const [k, v] of Object.entries(handler.proxyHeaders)) {
        reqHeaders.set(k, v);
      }
    }

    const resp = await fetch(targetUrl, {
      method,
      headers: reqHeaders,
      body: body && !['GET', 'HEAD'].includes(method) ? body : undefined,
      redirect: 'follow',
    });
    return resp;
  }

  // ── OPFS helpers ─────────────────────────────────────────────

  async #readOPFS(path) {
    try {
      const cleaned = path.replace(/^\//, '');
      const parts = cleaned.split('/').filter(Boolean);
      if (parts.length === 0) return null;
      const { dir, name } = await opfsWalk(cleaned);
      const fileHandle = await dir.getFileHandle(name);
      const file = await fileHandle.getFile();
      return await file.text();
    } catch {
      return null;
    }
  }

  async #readOPFSBinary(path) {
    try {
      const cleaned = path.replace(/^\//, '');
      const { dir, name } = await opfsWalk(cleaned);
      const fileHandle = await dir.getFileHandle(name);
      const file = await fileHandle.getFile();
      return await file.arrayBuffer();
    } catch {
      return null;
    }
  }

  async #listOPFSDirectory(path) {
    try {
      const cleaned = path.replace(/^\//, '');
      const dir = await opfsWalkDir(cleaned);
      const entries = [];
      for await (const [name, handle] of dir) {
        entries.push({ name, kind: handle.kind });
      }
      return entries.sort((a, b) => {
        if (a.kind !== b.kind) return a.kind === 'directory' ? -1 : 1;
        return a.name.localeCompare(b.name);
      });
    } catch {
      return null;
    }
  }

  #renderDirectoryListing(path, entries) {
    const rows = entries.map(e => {
      const icon = e.kind === 'directory' ? '📁' : '📄';
      const safeName = escHtml(e.name);
      const href = e.kind === 'directory' ? `${safeName}/` : safeName;
      return `<li>${icon} <a href="${href}">${safeName}${e.kind === 'directory' ? '/' : ''}</a></li>`;
    }).join('\n');
    const safePath = escHtml(path);
    return `<!DOCTYPE html>
<html><head><title>Index of ${safePath}</title>
<style>body{font-family:monospace;padding:1em}ul{list-style:none;padding:0}li{padding:2px 0}a{text-decoration:none;color:#58a6ff}a:hover{text-decoration:underline}</style>
</head><body>
<h1>Index of ${safePath}</h1>
<ul><li>📁 <a href="../">..</a></li>
${rows}</ul></body></html>`;
  }

  // ── Logging ──────────────────────────────────────────────────

  #logRequest(routeId, method, path, status, ms) {
    if (!this.#logs.has(routeId)) this.#logs.set(routeId, []);
    const log = this.#logs.get(routeId);
    log.push({ ts: Date.now(), method, path, status, ms: Math.round(ms) });
    if (log.length > MAX_LOG_ENTRIES) log.splice(0, log.length - MAX_LOG_ENTRIES);
  }

  getLogs(routeId, limit = 50) {
    const log = this.#logs.get(routeId) || [];
    return log.slice(-limit);
  }

  /**
   * Clear logs for a specific route, or all logs if no routeId given.
   * @param {string} [routeId]
   */
  clearLogs(routeId) {
    if (routeId != null) {
      this.#logs.delete(routeId);
    } else {
      this.#logs.clear();
    }
  }

  #createLogger(routeId) {
    return {
      log: (...args) => console.log(`[server:${routeId}]`, ...args),
      warn: (...args) => console.warn(`[server:${routeId}]`, ...args),
      error: (...args) => console.error(`[server:${routeId}]`, ...args),
      info: (...args) => console.info(`[server:${routeId}]`, ...args),
    };
  }

  // ── Change notification ──────────────────────────────────────

  onChange(fn) { this.#listeners.add(fn); return () => this.#listeners.delete(fn); }
  #notify() { for (const fn of this.#listeners) fn(); }

  // ── Test helper ──────────────────────────────────────────────

  /**
   * Send a test request to a registered server.
   * Routes through the SW fetch intercept.
   */
  async testRequest(hostname, port = 80, path = '/', opts = {}) {
    const portStr = port !== 80 ? `:${port}` : '';
    const url = `${location.origin}/http/${hostname}${portStr}${path}`;
    const resp = await fetch(url, {
      method: opts.method || 'GET',
      headers: opts.headers || {},
      body: opts.body,
    });
    const text = await resp.text();
    return { status: resp.status, statusText: resp.statusText, headers: Object.fromEntries(resp.headers), body: text };
  }

  // ── Skills-as-Handlers (Block 7.5) ──────────────────────────

  /**
   * Create a handler config for a skill-based server route.
   * @param {string} skillName
   * @param {object} [opts]
   * @param {string} [opts.execution='page']
   * @returns {object} Handler config with type 'skill'
   */
  static createSkillHandler(skillName, opts = {}) {
    return {
      type: 'skill',
      skillName,
      execution: opts.execution || 'page',
    };
  }

  /**
   * Execute a skill as an HTTP handler.
   * @param {string} skillName
   * @param {object} request - { method, url, headers, body? }
   * @param {object} registry - Skill registry with get(name)
   * @returns {Promise<Response>}
   */
  // ── SSE Streaming (Block 7.6) ────────────────────────────────

  /**
   * Create an SSE (Server-Sent Events) Response from an array of events.
   * @param {Array<{data: string, event?: string, id?: string}>} events
   * @returns {Response}
   */
  static createSSEResponse(events) {
    const lines = [];
    for (const evt of events) {
      if (evt.id != null) lines.push(`id: ${evt.id}`);
      if (evt.event) lines.push(`event: ${evt.event}`);
      lines.push(`data: ${evt.data}`);
      lines.push('');
    }
    return new Response(lines.join('\n'), {
      status: 200,
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
      },
    });
  }

  /**
   * Create an SSE Response from an async generator of events.
   * Collects all events and returns a complete Response.
   * @param {AsyncIterable<{data: string, event?: string, id?: string}>} generator
   * @returns {Promise<Response>}
   */
  static async createSSEResponseFromGenerator(generator) {
    const events = [];
    for await (const evt of generator) {
      events.push(evt);
    }
    return ServerManager.createSSEResponse(events);
  }

  static async executeSkillHandler(skillName, request, registry) {
    const skill = registry.get(skillName);
    if (!skill) {
      return new Response(`Skill '${skillName}' not found`, { status: 404 });
    }

    const body = skill.body || '';
    const meta = skill.metadata || {};

    return new Response(body, {
      status: 200,
      headers: {
        'Content-Type': 'text/plain',
        'X-Skill-Name': meta.name || skillName,
        'X-Skill-Version': meta.version || '0.0.0',
      },
    });
  }
}

// ── SSEChannel — WebSocket Emulation ────────────────────────────

/**
 * Bidirectional channel using SSE (server→client) + POST (client→server).
 * Emulates WebSocket behavior without requiring actual WebSocket support.
 */
export class SSEChannel {
  #id;
  #outbox = [];
  #closed = false;
  #onMessageCallbacks = [];

  /**
   * @param {string} id - Channel identifier
   */
  constructor(id) {
    this.#id = id;
  }

  get id() { return this.#id; }
  get closed() { return this.#closed; }

  /**
   * Send a message (queues for SSE delivery).
   * @param {{ type: string, data: string, [key: string]: any }} message
   */
  send(message) {
    if (this.#closed) return;
    this.#outbox.push({ ...message, timestamp: Date.now() });
  }

  /**
   * Drain all pending outbound messages.
   * @returns {Array<object>}
   */
  drain() {
    const msgs = [...this.#outbox];
    this.#outbox = [];
    return msgs;
  }

  /**
   * Register a callback for incoming messages.
   * @param {Function} fn - (message) => void
   */
  onMessage(fn) {
    this.#onMessageCallbacks.push(fn);
  }

  /**
   * Unregister a callback for incoming messages.
   * @param {Function} fn
   */
  offMessage(fn) {
    const idx = this.#onMessageCallbacks.indexOf(fn);
    if (idx >= 0) this.#onMessageCallbacks.splice(idx, 1);
  }

  /**
   * Receive an inbound message (from POST endpoint).
   * @param {{ type: string, data: string, [key: string]: any }} message
   */
  receive(message) {
    if (this.#closed) return;
    for (const cb of this.#onMessageCallbacks) {
      cb(message);
    }
  }

  /**
   * Close the channel.
   */
  close() {
    this.#closed = true;
    this.#onMessageCallbacks.length = 0;
  }
}

// ── Module-scoped singleton ──────────────────────────────────────

let _instance = null;

/**
 * Get or create the global ServerManager singleton.
 * @returns {ServerManager}
 */
export function getServerManager() {
  if (!_instance) {
    _instance = new ServerManager();
  }
  return _instance;
}

/**
 * Initialize the server manager (call once during workspace init).
 * @returns {Promise<ServerManager>}
 */
export async function initServerManager() {
  const mgr = getServerManager();
  await mgr.init();
  return mgr;
}

export { resolveRuntimeProxyTarget };
