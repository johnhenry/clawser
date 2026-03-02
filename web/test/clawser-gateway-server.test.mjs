// Run with: node --import ./web/test/_setup-globals.mjs --test web/test/clawser-gateway-server.test.mjs
import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

// Polyfill crypto for Node
if (!globalThis.crypto) {
  const { webcrypto } = await import('node:crypto');
  globalThis.crypto = webcrypto;
}

// Stub BrowserTool before import
globalThis.BrowserTool = class { constructor() {} };

import {
  GatewayServer,
  GatewayRoute,
} from '../clawser-gateway-server.js';

// ── Helpers ──────────────────────────────────────────────────────

function makePairingManager() {
  const tokens = new Map();
  return {
    createCode() { return '123456'; },
    exchangeCode(code, meta) {
      if (code === '123456') {
        const token = 'bearer_test_token';
        tokens.set(token, { token, expires: Date.now() + 86400000 });
        return { token, expires: Date.now() + 86400000 };
      }
      return null;
    },
    validateToken(token) { return tokens.has(token); },
    revokeToken(token) { return tokens.delete(token); },
    listSessions() { return [...tokens.values()]; },
    get sessionCount() { return tokens.size; },
  };
}

function makeAgent() {
  const messages = [];
  return {
    messages,
    async run(text) {
      messages.push(text);
      return { response: `Echo: ${text}` };
    },
    async *runStream(text) {
      messages.push(text);
      yield { type: 'text', content: `Echo: ${text}` };
      yield { type: 'done' };
    },
  };
}

function makeServerManager() {
  const routes = new Map();
  return {
    routes,
    async addRoute(route) {
      const id = route.id || `srv_${Date.now()}`;
      routes.set(id, { ...route, id });
      return id;
    },
    async removeRoute(id) { routes.delete(id); },
    async getRouteById(id) { return routes.get(id) || null; },
    async listRoutes() { return [...routes.values()]; },
  };
}

// ── GatewayRoute ─────────────────────────────────────────────────

describe('GatewayRoute', () => {
  it('creates with method, path, and handler', () => {
    const route = new GatewayRoute('POST', '/message', () => ({}));
    assert.equal(route.method, 'POST');
    assert.equal(route.path, '/message');
    assert.equal(typeof route.handler, 'function');
  });

  it('matches method and path', () => {
    const route = new GatewayRoute('GET', '/stream', () => ({}));
    assert.equal(route.matches('GET', '/stream'), true);
    assert.equal(route.matches('POST', '/stream'), false);
    assert.equal(route.matches('GET', '/other'), false);
  });

  it('supports wildcard method', () => {
    const route = new GatewayRoute('*', '/any', () => ({}));
    assert.equal(route.matches('GET', '/any'), true);
    assert.equal(route.matches('POST', '/any'), true);
  });
});

// ── GatewayServer ────────────────────────────────────────────────

describe('GatewayServer', () => {
  let gw, pairing, agent, serverMgr;

  beforeEach(() => {
    pairing = makePairingManager();
    agent = makeAgent();
    serverMgr = makeServerManager();
    gw = new GatewayServer({ pairing, agent, serverManager: serverMgr });
  });

  it('constructs with required dependencies', () => {
    assert.ok(gw);
  });

  it('has default routes registered (POST /pair, POST /message, GET /stream, GET /status)', () => {
    const routes = gw.listRoutes();
    const paths = routes.map(r => `${r.method} ${r.path}`);
    assert.ok(paths.includes('POST /pair'));
    assert.ok(paths.includes('POST /message'));
    assert.ok(paths.includes('GET /stream'));
    assert.ok(paths.includes('GET /status'));
  });

  it('addRoute registers a custom route', () => {
    gw.addRoute('GET', '/custom', () => ({ status: 200, body: 'ok' }));
    const routes = gw.listRoutes();
    assert.ok(routes.some(r => r.path === '/custom'));
  });

  it('removeRoute removes by path', () => {
    gw.addRoute('GET', '/temp', () => ({}));
    gw.removeRoute('GET', '/temp');
    const routes = gw.listRoutes();
    assert.ok(!routes.some(r => r.path === '/temp'));
  });
});

// ── Request dispatch ─────────────────────────────────────────────

describe('GatewayServer.dispatch', () => {
  let gw, pairing, agent, serverMgr;

  beforeEach(() => {
    pairing = makePairingManager();
    agent = makeAgent();
    serverMgr = makeServerManager();
    gw = new GatewayServer({ pairing, agent, serverManager: serverMgr });
  });

  it('POST /pair with valid code returns token', async () => {
    const res = await gw.dispatch('POST', '/pair', {
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ code: '123456', device: 'phone' }),
    });
    assert.equal(res.status, 200);
    const data = JSON.parse(res.body);
    assert.ok(data.token);
    assert.ok(data.expires);
  });

  it('POST /pair with invalid code returns 401', async () => {
    const res = await gw.dispatch('POST', '/pair', {
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ code: '000000' }),
    });
    assert.equal(res.status, 401);
  });

  it('POST /message without auth returns 401', async () => {
    const res = await gw.dispatch('POST', '/message', {
      headers: {},
      body: JSON.stringify({ text: 'hello' }),
    });
    assert.equal(res.status, 401);
  });

  it('POST /message with valid token dispatches to agent', async () => {
    // First pair to get a valid token
    const pairRes = await gw.dispatch('POST', '/pair', {
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ code: '123456' }),
    });
    const { token } = JSON.parse(pairRes.body);

    const res = await gw.dispatch('POST', '/message', {
      headers: { authorization: `Bearer ${token}` },
      body: JSON.stringify({ text: 'hello agent' }),
    });
    assert.equal(res.status, 200);
    const data = JSON.parse(res.body);
    assert.ok(data.response);
    assert.equal(agent.messages.length, 1);
    assert.equal(agent.messages[0], 'hello agent');
  });

  it('GET /stream without auth returns 401', async () => {
    const res = await gw.dispatch('GET', '/stream', {
      headers: {},
    });
    assert.equal(res.status, 401);
  });

  it('GET /stream with valid token returns SSE content type', async () => {
    const pairRes = await gw.dispatch('POST', '/pair', {
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ code: '123456' }),
    });
    const { token } = JSON.parse(pairRes.body);

    const res = await gw.dispatch('GET', '/stream', {
      headers: { authorization: `Bearer ${token}` },
      query: { text: 'hello' },
    });
    assert.equal(res.status, 200);
    assert.equal(res.headers['content-type'], 'text/event-stream');
    assert.ok(res.body.includes('data:'));
  });

  it('GET /status returns server status', async () => {
    const res = await gw.dispatch('GET', '/status', { headers: {} });
    assert.equal(res.status, 200);
    const data = JSON.parse(res.body);
    assert.equal(data.ok, true);
    assert.equal(typeof data.sessions, 'number');
  });

  it('unknown route returns 404', async () => {
    const res = await gw.dispatch('GET', '/nonexistent', { headers: {} });
    assert.equal(res.status, 404);
  });
});

// ── Token validation helper ──────────────────────────────────────

describe('GatewayServer.extractToken', () => {
  let gw, pairing, agent, serverMgr;

  beforeEach(() => {
    pairing = makePairingManager();
    agent = makeAgent();
    serverMgr = makeServerManager();
    gw = new GatewayServer({ pairing, agent, serverManager: serverMgr });
  });

  it('extracts bearer token from Authorization header', () => {
    const token = gw.extractToken({ authorization: 'Bearer my_token' });
    assert.equal(token, 'my_token');
  });

  it('returns null for missing header', () => {
    assert.equal(gw.extractToken({}), null);
  });

  it('returns null for non-Bearer scheme', () => {
    assert.equal(gw.extractToken({ authorization: 'Basic abc' }), null);
  });
});

// ── Page-mode handler registration ───────────────────────────────

describe('GatewayServer page-mode handlers', () => {
  it('registerPageHandler adds a route with page execution context', () => {
    const pairing = makePairingManager();
    const agent = makeAgent();
    const gw = new GatewayServer({ pairing, agent });

    gw.registerPageHandler('POST', '/webhook', async (req) => {
      return { status: 200, body: JSON.stringify({ received: true }) };
    });

    const routes = gw.listRoutes();
    assert.ok(routes.some(r => r.method === 'POST' && r.path === '/webhook'));
  });
});
