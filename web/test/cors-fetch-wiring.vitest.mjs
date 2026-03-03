// CORS Fetch wiring tests — validates the extension proxy fallback pipeline.
// Covers: ExtCorsFetchTool, corsFetchFallback, setCorsFetchClient
import { describe, it, expect, beforeEach } from 'vitest';

const mod = await import('../clawser-cors-fetch.js');
const { ExtCorsFetchTool, corsFetchFallback, setCorsFetchClient } = mod;

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
    expect(tool.name).toBe('ext_cors_fetch');
  });

  it('has network permission', () => {
    const tool = new ExtCorsFetchTool(makeMockRpc());
    expect(tool.permission).toBe('network');
  });

  it('has a non-empty description', () => {
    const tool = new ExtCorsFetchTool(makeMockRpc());
    expect(tool.description.length).toBeGreaterThan(0);
  });

  it('execute succeeds with connected rpc', async () => {
    const tool = new ExtCorsFetchTool(makeMockRpc());
    const result = await tool.execute({ url: 'https://example.com' });
    expect(result.success).toBe(true);
    expect(result.output).toContain('200');
  });

  it('execute fails when rpc not connected', async () => {
    const tool = new ExtCorsFetchTool(makeMockRpc({ connected: false }));
    const result = await tool.execute({ url: 'https://example.com' });
    expect(result.success).toBe(false);
    expect(result.error).toContain('not connected');
  });

  it('execute fails when url missing', async () => {
    const tool = new ExtCorsFetchTool(makeMockRpc());
    const result = await tool.execute({});
    expect(result.success).toBe(false);
    expect(result.error).toContain('url');
  });

  it('passes method and headers to rpc', async () => {
    let captured;
    const rpc = makeMockRpc({
      call: async (action, params) => {
        captured = { action, params };
        return { status: 200, body: '' };
      },
    });
    const tool = new ExtCorsFetchTool(rpc);
    await tool.execute({ url: 'https://example.com', method: 'POST', headers: { 'X-Custom': '1' } });
    expect(captured.action).toBe('cors_fetch');
    expect(captured.params.method).toBe('POST');
    expect(captured.params.headers).toEqual({ 'X-Custom': '1' });
  });
});

// ── 2. corsFetchFallback ─────────────────────────────────────────

describe('corsFetchFallback', () => {
  beforeEach(() => {
    setCorsFetchClient(null);
  });

  it('returns null when no client set', async () => {
    const result = await corsFetchFallback('https://example.com', {});
    expect(result).toBeNull();
  });

  it('returns null when client not connected', async () => {
    setCorsFetchClient({ connected: false, call: async () => {} });
    const result = await corsFetchFallback('https://example.com', {});
    expect(result).toBeNull();
  });

  it('calls client.call with correct args when connected', async () => {
    let captured;
    setCorsFetchClient({
      connected: true,
      call: async (action, params) => {
        captured = { action, params };
        return { status: 200, headers: {}, body: 'ok' };
      },
    });
    const result = await corsFetchFallback('https://example.com/path', {
      method: 'POST',
      headers: { 'X-Foo': 'bar' },
      body: 'data',
    });
    expect(captured.action).toBe('cors_fetch');
    expect(captured.params.url).toBe('https://example.com/path');
    expect(captured.params.method).toBe('POST');
    expect(captured.params.headers).toEqual({ 'X-Foo': 'bar' });
    expect(captured.params.body).toBe('data');
    expect(result.status).toBe(200);
    expect(result.body).toBe('ok');
  });

  it('returns null when client.call throws', async () => {
    setCorsFetchClient({
      connected: true,
      call: async () => { throw new Error('network failure'); },
    });
    const result = await corsFetchFallback('https://example.com');
    expect(result).toBeNull();
  });
});

// ── 3. setCorsFetchClient ────────────────────────────────────────

describe('setCorsFetchClient', () => {
  it('sets the singleton so corsFetchFallback uses it', async () => {
    let called = false;
    setCorsFetchClient({
      connected: true,
      call: async () => { called = true; return { status: 200, headers: {}, body: '' }; },
    });
    await corsFetchFallback('https://example.com');
    expect(called).toBe(true);
    setCorsFetchClient(null);
  });

  it('can be reset to null', async () => {
    setCorsFetchClient({
      connected: true,
      call: async () => ({ status: 200, headers: {}, body: '' }),
    });
    setCorsFetchClient(null);
    const result = await corsFetchFallback('https://example.com');
    expect(result).toBeNull();
  });
});
