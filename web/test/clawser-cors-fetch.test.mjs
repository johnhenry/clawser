// Run with: node --import ./web/test/_setup-globals.mjs --test web/test/clawser-cors-fetch.test.mjs
import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

// ── Polyfills ────────────────────────────────────────────────────
if (typeof globalThis.window === 'undefined') {
  globalThis.window = {
    addEventListener: () => {},
    removeEventListener: () => {},
    postMessage: () => {},
  };
}

const mod = await import('../clawser-cors-fetch.js');
const { ExtCorsFetchTool, corsFetchFallback } = mod;

// ── Mock RPC client ──────────────────────────────────────────────
function makeMockRpc(overrides = {}) {
  return {
    connected: true,
    call: async (action, params) => ({
      status: 200,
      statusText: 'OK',
      headers: { 'content-type': 'text/html' },
      body: '<h1>Hello</h1>',
    }),
    ...overrides,
  };
}

// ── 1. ExtCorsFetchTool ─────────────────────────────────────────

describe('ExtCorsFetchTool', () => {
  it('has name ext_cors_fetch', () => {
    const tool = new ExtCorsFetchTool(makeMockRpc());
    assert.equal(tool.name, 'ext_cors_fetch');
  });

  it('has network permission', () => {
    const tool = new ExtCorsFetchTool(makeMockRpc());
    assert.equal(tool.permission, 'network');
  });

  it('has a description', () => {
    const tool = new ExtCorsFetchTool(makeMockRpc());
    assert.ok(tool.description.length > 0);
  });

  it('execute succeeds with connected rpc', async () => {
    const tool = new ExtCorsFetchTool(makeMockRpc());
    const result = await tool.execute({ url: 'https://example.com' });
    assert.equal(result.success, true);
    assert.ok(result.output.includes('200'));
  });

  it('execute fails when rpc not connected', async () => {
    const tool = new ExtCorsFetchTool(makeMockRpc({ connected: false }));
    const result = await tool.execute({ url: 'https://example.com' });
    assert.equal(result.success, false);
    assert.ok(result.error.includes('not connected'));
  });

  it('execute fails when url missing', async () => {
    const tool = new ExtCorsFetchTool(makeMockRpc());
    const result = await tool.execute({});
    assert.equal(result.success, false);
    assert.ok(result.error.includes('url'));
  });

  it('passes method and headers to rpc', async () => {
    let captured;
    const rpc = makeMockRpc({
      call: async (action, params) => { captured = { action, params }; return { status: 200, body: '' }; },
    });
    const tool = new ExtCorsFetchTool(rpc);
    await tool.execute({ url: 'https://example.com', method: 'POST', headers: { 'X-Custom': '1' } });
    assert.equal(captured.action, 'cors_fetch');
    assert.equal(captured.params.method, 'POST');
    assert.deepStrictEqual(captured.params.headers, { 'X-Custom': '1' });
  });
});

// ── 2. corsFetchFallback ─────────────────────────────────────────

describe('corsFetchFallback', () => {
  it('is a function', () => {
    assert.equal(typeof corsFetchFallback, 'function');
  });

  it('returns null when no extension client available', async () => {
    const result = await corsFetchFallback('https://example.com', {});
    // Without a real extension, should return null (indicating fallback not available)
    assert.equal(result, null);
  });
});
