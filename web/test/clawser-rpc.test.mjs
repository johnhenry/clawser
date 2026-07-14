// Run with: node --import ./web/test/_setup-globals.mjs --test web/test/clawser-rpc.test.mjs
import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import {
  processLine,
  createHandlers,
  rpcSuccess,
  rpcError,
  RPC_ERRORS,
  JSONRPC,
  startStdioRpc,
} from '../clawser-rpc.mjs';

// ── Mock Agent ─────────────────────────────────────────────────

const createMockAgent = (overrides = {}) => ({
  sendMessage: overrides.sendMessage || (() => {}),
  run: overrides.run || (async () => ({ content: 'mock response', status: 0 })),
  getState: overrides.getState || (() => ({
    agent_state: 'Idle',
    history_len: 3,
    memory_count: 2,
    goals: [],
    scheduler_jobs: 0,
    tool_count: 5,
  })),
  getModel: overrides.getModel || (() => 'test-model'),
  getCheckpointJSON: overrides.getCheckpointJSON || (() => ({})),
  getEventLog: overrides.getEventLog || (() => ({
    events: [
      { type: 'user_message', timestamp: Date.now(), data: { content: 'hello' } },
      { type: 'assistant_message', timestamp: Date.now(), data: { content: 'hi' } },
    ],
  })),
  memoryRecall: overrides.memoryRecall || ((query, opts) => [
    { id: 'mem_1', key: 'test', content: 'test value', category: 'user', score: 1.0 },
  ]),
  memoryStore: overrides.memoryStore || ((entry) => 'mem_new'),
  memoryForget: overrides.memoryForget || (() => 1),
  executeToolDirect: overrides.executeToolDirect || (async (name, params) => ({
    success: true,
    output: `Executed ${name}`,
  })),
});

// ── Helpers ────────────────────────────────────────────────────

const makeRequest = (method, params, id = 1) =>
  JSON.stringify({ jsonrpc: '2.0', method, params, id });

const makeNotification = (method, params) =>
  JSON.stringify({ jsonrpc: '2.0', method, params });

const parseResponse = (line) => JSON.parse(line);

// ── rpcSuccess / rpcError builders ─────────────────────────────

describe('rpcSuccess', () => {
  it('builds a valid JSON-RPC success response', () => {
    const res = rpcSuccess(42, { foo: 'bar' });
    assert.equal(res.jsonrpc, '2.0');
    assert.equal(res.id, 42);
    assert.deepEqual(res.result, { foo: 'bar' });
    assert.equal(res.error, undefined);
  });
});

describe('rpcError', () => {
  it('builds a valid JSON-RPC error response', () => {
    const res = rpcError(7, RPC_ERRORS.METHOD_NOT_FOUND, 'foo.bar');
    assert.equal(res.jsonrpc, '2.0');
    assert.equal(res.id, 7);
    assert.equal(res.error.code, -32601);
    assert.equal(res.error.message, 'Method not found');
    assert.equal(res.error.data, 'foo.bar');
  });

  it('omits data field when not provided', () => {
    const res = rpcError(1, RPC_ERRORS.PARSE_ERROR);
    assert.equal(res.error.data, undefined);
  });
});

// ── processLine: parse errors ──────────────────────────────────

describe('processLine — parse errors', () => {
  const handlers = createHandlers(() => createMockAgent());
  const getAgent = () => createMockAgent();

  it('returns parse error for invalid JSON', async () => {
    const result = await processLine('{not json}', handlers, getAgent);
    const res = parseResponse(result);
    assert.equal(res.error.code, -32700);
    assert.equal(res.id, null);
  });

  it('returns null for empty lines', async () => {
    const result = await processLine('', handlers, getAgent);
    assert.equal(result, null);
  });

  it('returns null for whitespace-only lines', async () => {
    const result = await processLine('   \t  ', handlers, getAgent);
    assert.equal(result, null);
  });
});

// ── processLine: invalid requests ──────────────────────────────

describe('processLine — invalid requests', () => {
  const handlers = createHandlers(() => createMockAgent());
  const getAgent = () => createMockAgent();

  it('rejects missing jsonrpc field', async () => {
    const result = await processLine(
      JSON.stringify({ method: 'send', id: 1 }),
      handlers,
      getAgent,
    );
    const res = parseResponse(result);
    assert.equal(res.error.code, -32600);
  });

  it('rejects wrong jsonrpc version', async () => {
    const result = await processLine(
      JSON.stringify({ jsonrpc: '1.0', method: 'send', id: 1 }),
      handlers,
      getAgent,
    );
    const res = parseResponse(result);
    assert.equal(res.error.code, -32600);
  });

  it('rejects missing method', async () => {
    const result = await processLine(
      JSON.stringify({ jsonrpc: '2.0', id: 1 }),
      handlers,
      getAgent,
    );
    const res = parseResponse(result);
    assert.equal(res.error.code, -32600);
  });

  it('rejects non-string method', async () => {
    const result = await processLine(
      JSON.stringify({ jsonrpc: '2.0', method: 42, id: 1 }),
      handlers,
      getAgent,
    );
    const res = parseResponse(result);
    assert.equal(res.error.code, -32600);
  });
});

// ── processLine: method not found ──────────────────────────────

describe('processLine — method not found', () => {
  const handlers = createHandlers(() => createMockAgent());
  const getAgent = () => createMockAgent();

  it('returns method not found for unknown method', async () => {
    const result = await processLine(makeRequest('nonexistent', {}), handlers, getAgent);
    const res = parseResponse(result);
    assert.equal(res.error.code, -32601);
    assert.equal(res.id, 1);
  });
});

// ── processLine: send method ───────────────────────────────────

describe('processLine — send', () => {
  it('sends a message and returns agent response', async () => {
    let sentMsg = null;
    const agent = createMockAgent({
      sendMessage: (msg) => { sentMsg = msg; },
      run: async () => ({ content: 'hello back', status: 0 }),
    });
    const handlers = createHandlers(() => agent);
    const getAgent = () => agent;

    const result = await processLine(
      makeRequest('send', { message: 'hello' }),
      handlers,
      getAgent,
    );
    const res = parseResponse(result);
    assert.equal(res.result.content, 'hello back');
    assert.equal(res.result.status, 0);
    assert.equal(sentMsg, 'hello');
  });

  it('returns invalid params when message is missing', async () => {
    const agent = createMockAgent();
    const handlers = createHandlers(() => agent);
    const getAgent = () => agent;

    const result = await processLine(
      makeRequest('send', {}),
      handlers,
      getAgent,
    );
    const res = parseResponse(result);
    assert.equal(res.error.code, -32602);
  });

  it('returns invalid params when message is not a string', async () => {
    const agent = createMockAgent();
    const handlers = createHandlers(() => agent);
    const getAgent = () => agent;

    const result = await processLine(
      makeRequest('send', { message: 123 }),
      handlers,
      getAgent,
    );
    const res = parseResponse(result);
    assert.equal(res.error.code, -32602);
  });
});

// ── processLine: tools.list ────────────────────────────────────

describe('processLine — tools.list', () => {
  it('returns tool count', async () => {
    const agent = createMockAgent();
    const handlers = createHandlers(() => agent);
    const getAgent = () => agent;

    const result = await processLine(
      makeRequest('tools.list', {}),
      handlers,
      getAgent,
    );
    const res = parseResponse(result);
    assert.equal(res.result.tool_count, 5);
    assert.ok(Array.isArray(res.result.tools));
  });
});

// ── processLine: tools.execute ─────────────────────────────────

describe('processLine — tools.execute', () => {
  it('executes a tool and returns result', async () => {
    const agent = createMockAgent();
    const handlers = createHandlers(() => agent);
    const getAgent = () => agent;

    const result = await processLine(
      makeRequest('tools.execute', { name: 'browser_fs_read', params: { path: '/test' } }),
      handlers,
      getAgent,
    );
    const res = parseResponse(result);
    assert.equal(res.result.success, true);
    assert.ok(res.result.output.includes('browser_fs_read'));
  });

  it('returns invalid params when name is missing', async () => {
    const agent = createMockAgent();
    const handlers = createHandlers(() => agent);
    const getAgent = () => agent;

    const result = await processLine(
      makeRequest('tools.execute', {}),
      handlers,
      getAgent,
    );
    const res = parseResponse(result);
    assert.equal(res.error.code, -32602);
  });
});

// ── processLine: session.status ────────────────────────────────

describe('processLine — session.status', () => {
  it('returns session status', async () => {
    const agent = createMockAgent();
    const handlers = createHandlers(() => agent);
    const getAgent = () => agent;

    const result = await processLine(
      makeRequest('session.status', {}),
      handlers,
      getAgent,
    );
    const res = parseResponse(result);
    assert.equal(res.result.model, 'test-model');
    assert.equal(res.result.state, 'Idle');
    assert.equal(res.result.history_len, 3);
    assert.equal(res.result.memory_count, 2);
  });
});

// ── processLine: session.history ───────────────────────────────

describe('processLine — session.history', () => {
  it('returns event history', async () => {
    const agent = createMockAgent();
    const handlers = createHandlers(() => agent);
    const getAgent = () => agent;

    const result = await processLine(
      makeRequest('session.history', {}),
      handlers,
      getAgent,
    );
    const res = parseResponse(result);
    assert.equal(res.result.total, 2);
    assert.equal(res.result.events.length, 2);
  });

  it('respects limit param', async () => {
    const agent = createMockAgent();
    const handlers = createHandlers(() => agent);
    const getAgent = () => agent;

    const result = await processLine(
      makeRequest('session.history', { limit: 1 }),
      handlers,
      getAgent,
    );
    const res = parseResponse(result);
    assert.equal(res.result.events.length, 1);
    assert.equal(res.result.total, 2);
  });
});

// ── processLine: memory.recall ─────────────────────────────────

describe('processLine — memory.recall', () => {
  it('returns memory entries', async () => {
    const agent = createMockAgent();
    const handlers = createHandlers(() => agent);
    const getAgent = () => agent;

    const result = await processLine(
      makeRequest('memory.recall', { query: 'test' }),
      handlers,
      getAgent,
    );
    const res = parseResponse(result);
    assert.ok(Array.isArray(res.result.entries));
    assert.equal(res.result.entries[0].key, 'test');
  });

  it('works with empty query', async () => {
    const agent = createMockAgent();
    const handlers = createHandlers(() => agent);
    const getAgent = () => agent;

    const result = await processLine(
      makeRequest('memory.recall', {}),
      handlers,
      getAgent,
    );
    const res = parseResponse(result);
    assert.ok(res.result.entries);
  });
});

// ── processLine: memory.store ──────────────────────────────────

describe('processLine — memory.store', () => {
  it('stores a memory entry and returns id', async () => {
    let storedEntry = null;
    const agent = createMockAgent({
      memoryStore: (entry) => { storedEntry = entry; return 'mem_42'; },
    });
    const handlers = createHandlers(() => agent);
    const getAgent = () => agent;

    const result = await processLine(
      makeRequest('memory.store', { key: 'foo', content: 'bar value' }),
      handlers,
      getAgent,
    );
    const res = parseResponse(result);
    assert.equal(res.result.id, 'mem_42');
    assert.equal(res.result.key, 'foo');
    assert.equal(storedEntry.key, 'foo');
    assert.equal(storedEntry.content, 'bar value');
    assert.equal(storedEntry.category, 'user');
  });

  it('returns invalid params when key is missing', async () => {
    const agent = createMockAgent();
    const handlers = createHandlers(() => agent);
    const getAgent = () => agent;

    const result = await processLine(
      makeRequest('memory.store', { content: 'bar' }),
      handlers,
      getAgent,
    );
    const res = parseResponse(result);
    assert.equal(res.error.code, -32602);
  });

  it('returns invalid params when content is missing', async () => {
    const agent = createMockAgent();
    const handlers = createHandlers(() => agent);
    const getAgent = () => agent;

    const result = await processLine(
      makeRequest('memory.store', { key: 'foo' }),
      handlers,
      getAgent,
    );
    const res = parseResponse(result);
    assert.equal(res.error.code, -32602);
  });
});

// ── processLine: no agent ──────────────────────────────────────

describe('processLine — no agent', () => {
  it('returns NO_AGENT error when getAgent returns null', async () => {
    const handlers = createHandlers(() => null);
    const getAgent = () => null;

    const result = await processLine(
      makeRequest('session.status', {}),
      handlers,
      getAgent,
    );
    const res = parseResponse(result);
    assert.equal(res.error.code, -32000);
    assert.ok(res.error.message.toLowerCase().includes('agent'));
  });
});

// ── processLine: notifications ─────────────────────────────────

describe('processLine — notifications', () => {
  it('returns null for cancel notification', async () => {
    const handlers = createHandlers(() => createMockAgent());
    const getAgent = () => createMockAgent();

    const result = await processLine(
      makeNotification('cancel'),
      handlers,
      getAgent,
    );
    assert.equal(result, null);
  });

  it('returns null for unknown notification methods', async () => {
    const handlers = createHandlers(() => createMockAgent());
    const getAgent = () => createMockAgent();

    const result = await processLine(
      makeNotification('some.unknown.method'),
      handlers,
      getAgent,
    );
    assert.equal(result, null);
  });

  it('returns null for valid method called as notification', async () => {
    const handlers = createHandlers(() => createMockAgent());
    const getAgent = () => createMockAgent();

    const result = await processLine(
      makeNotification('session.status'),
      handlers,
      getAgent,
    );
    assert.equal(result, null);
  });
});

// ── processLine: batch requests ────────────────────────────────

describe('processLine — batch requests', () => {
  const agent = createMockAgent();
  const handlers = createHandlers(() => agent);
  const getAgent = () => agent;

  it('processes a batch of requests', async () => {
    const batch = [
      { jsonrpc: '2.0', method: 'session.status', id: 1 },
      { jsonrpc: '2.0', method: 'tools.list', id: 2 },
    ];
    const result = await processLine(JSON.stringify(batch), handlers, getAgent);
    const responses = JSON.parse(result);
    assert.ok(Array.isArray(responses));
    assert.equal(responses.length, 2);
    assert.equal(responses[0].id, 1);
    assert.equal(responses[1].id, 2);
  });

  it('returns error for empty batch', async () => {
    const result = await processLine('[]', handlers, getAgent);
    const res = parseResponse(result);
    assert.equal(res.error.code, -32600);
  });

  it('filters out notification responses from batch', async () => {
    const batch = [
      { jsonrpc: '2.0', method: 'cancel' }, // notification, no id
      { jsonrpc: '2.0', method: 'session.status', id: 1 },
    ];
    const result = await processLine(JSON.stringify(batch), handlers, getAgent);
    const responses = JSON.parse(result);
    assert.ok(Array.isArray(responses));
    assert.equal(responses.length, 1);
    assert.equal(responses[0].id, 1);
  });

  it('returns null when batch is all notifications', async () => {
    const batch = [
      { jsonrpc: '2.0', method: 'cancel' },
      { jsonrpc: '2.0', method: 'cancel' },
    ];
    const result = await processLine(JSON.stringify(batch), handlers, getAgent);
    assert.equal(result, null);
  });
});

// ── processLine: internal errors ───────────────────────────────

describe('processLine — internal errors', () => {
  it('wraps unexpected handler errors as internal error', async () => {
    const agent = createMockAgent({
      run: async () => { throw new Error('boom'); },
    });
    const handlers = createHandlers(() => agent);
    const getAgent = () => agent;

    const result = await processLine(
      makeRequest('send', { message: 'hello' }),
      handlers,
      getAgent,
    );
    const res = parseResponse(result);
    assert.equal(res.error.code, -32603);
    assert.ok(res.error.data.includes('boom'));
  });
});

// ── processLine: id preservation ───────────────────────────────

describe('processLine — id handling', () => {
  const agent = createMockAgent();
  const handlers = createHandlers(() => agent);
  const getAgent = () => agent;

  it('preserves string ids', async () => {
    const result = await processLine(
      JSON.stringify({ jsonrpc: '2.0', method: 'session.status', id: 'abc-123' }),
      handlers,
      getAgent,
    );
    const res = parseResponse(result);
    assert.equal(res.id, 'abc-123');
  });

  it('preserves numeric ids', async () => {
    const result = await processLine(
      JSON.stringify({ jsonrpc: '2.0', method: 'session.status', id: 999 }),
      handlers,
      getAgent,
    );
    const res = parseResponse(result);
    assert.equal(res.id, 999);
  });

  it('preserves null ids', async () => {
    const result = await processLine(
      JSON.stringify({ jsonrpc: '2.0', method: 'session.status', id: null }),
      handlers,
      getAgent,
    );
    const res = parseResponse(result);
    assert.equal(res.id, null);
  });
});

// ── startStdioRpc ──────────────────────────────────────────────

describe('startStdioRpc', () => {
  it('processes lines from a mock stdin and writes to mock stdout', async () => {
    const { PassThrough } = await import('node:stream');
    const mockStdin = new PassThrough();
    const mockStdout = new PassThrough();

    const agent = createMockAgent();
    const handle = startStdioRpc(() => agent, {
      stdin: mockStdin,
      stdout: mockStdout,
    });

    const collected = [];
    mockStdout.on('data', (chunk) => collected.push(chunk.toString()));

    // Send a request
    mockStdin.write(makeRequest('session.status', {}) + '\n');

    // Give it a tick to process
    await new Promise((r) => setTimeout(r, 50));

    assert.ok(collected.length > 0);
    const res = JSON.parse(collected[0].trim());
    assert.equal(res.jsonrpc, '2.0');
    assert.equal(res.id, 1);
    assert.equal(res.result.model, 'test-model');

    handle.close();
    mockStdin.end();
  });

  it('handles multiple requests in sequence', async () => {
    const { PassThrough } = await import('node:stream');
    const mockStdin = new PassThrough();
    const mockStdout = new PassThrough();

    const agent = createMockAgent();
    const handle = startStdioRpc(() => agent, {
      stdin: mockStdin,
      stdout: mockStdout,
    });

    const collected = [];
    mockStdout.on('data', (chunk) => collected.push(chunk.toString()));

    mockStdin.write(makeRequest('session.status', {}, 1) + '\n');
    mockStdin.write(makeRequest('tools.list', {}, 2) + '\n');

    await new Promise((r) => setTimeout(r, 100));

    assert.ok(collected.length >= 2);
    const res1 = JSON.parse(collected[0].trim());
    const res2 = JSON.parse(collected[1].trim());
    assert.equal(res1.id, 1);
    assert.equal(res2.id, 2);

    handle.close();
    mockStdin.end();
  });

  it('close() stops processing', async () => {
    const { PassThrough } = await import('node:stream');
    const mockStdin = new PassThrough();
    const mockStdout = new PassThrough();

    const agent = createMockAgent();
    const handle = startStdioRpc(() => agent, {
      stdin: mockStdin,
      stdout: mockStdout,
    });

    handle.close();

    const collected = [];
    mockStdout.on('data', (chunk) => collected.push(chunk.toString()));

    mockStdin.write(makeRequest('session.status', {}) + '\n');
    await new Promise((r) => setTimeout(r, 50));

    // After close, no output should be produced
    assert.equal(collected.length, 0);
    mockStdin.end();
  });
});

// ── HTTP transport ─────────────────────────────────────────────

describe('startHttpRpc', () => {
  it('serves a JSON-RPC request over HTTP and requires bearer auth', async () => {
    const { startHttpRpc } = await import('../clawser-rpc.mjs');
    const getAgent = () => createMockAgent();

    const port = 30000 + Math.floor(Math.random() * 5000);
    const handle = await startHttpRpc({
      getAgent, port, host: '127.0.0.1',
      bearerToken: 'test-secret',
    });

    try {
      // Without auth: 401
      const reqNoAuth = await fetch(`http://127.0.0.1:${port}`, {
        method: 'POST',
        body: makeRequest('session.status', {}),
      });
      assert.equal(reqNoAuth.status, 401);

      // Wrong auth: 401
      const reqBadAuth = await fetch(`http://127.0.0.1:${port}`, {
        method: 'POST',
        headers: { Authorization: 'Bearer wrong' },
        body: makeRequest('session.status', {}),
      });
      assert.equal(reqBadAuth.status, 401);

      // Correct auth: 200 + JSON-RPC response
      const reqOk = await fetch(`http://127.0.0.1:${port}`, {
        method: 'POST',
        headers: { Authorization: 'Bearer test-secret' },
        body: makeRequest('session.status', {}, 42),
      });
      assert.equal(reqOk.status, 200);
      const body = await reqOk.json();
      assert.equal(body.jsonrpc, '2.0');
      assert.equal(body.id, 42);
      assert.ok(body.result, 'expected result on success');

      // GET: 405
      const getRes = await fetch(`http://127.0.0.1:${port}`, {
        method: 'GET',
        headers: { Authorization: 'Bearer test-secret' },
      });
      assert.equal(getRes.status, 405);
    } finally {
      await handle.close();
    }
  });

  it('generates a random bearer token when none is provided', async () => {
    const { startHttpRpc } = await import('../clawser-rpc.mjs');
    const port = 35000 + Math.floor(Math.random() * 5000);
    const handle = await startHttpRpc({
      getAgent: () => createMockAgent(), port, host: '127.0.0.1',
    });
    try {
      assert.ok(handle.bearerToken);
      assert.equal(handle.bearerToken.length, 64);
      assert.match(handle.bearerToken, /^[0-9a-f]{64}$/);
    } finally {
      await handle.close();
    }
  });

  it('rejects when port or getAgent is missing', async () => {
    const { startHttpRpc } = await import('../clawser-rpc.mjs');
    await assert.rejects(() => startHttpRpc({ port: 8000 }), /getAgent is required/);
    await assert.rejects(() => startHttpRpc({ getAgent: () => null }), /port is required/);
  });
});

// ── RPC_ERRORS constants ───────────────────────────────────────

describe('RPC_ERRORS', () => {
  it('has standard JSON-RPC error codes', () => {
    assert.equal(RPC_ERRORS.PARSE_ERROR.code, -32700);
    assert.equal(RPC_ERRORS.INVALID_REQUEST.code, -32600);
    assert.equal(RPC_ERRORS.METHOD_NOT_FOUND.code, -32601);
    assert.equal(RPC_ERRORS.INVALID_PARAMS.code, -32602);
    assert.equal(RPC_ERRORS.INTERNAL_ERROR.code, -32603);
  });

  it('has custom server error codes in valid range', () => {
    assert.ok(RPC_ERRORS.NO_AGENT.code >= -32099 && RPC_ERRORS.NO_AGENT.code <= -32000);
    assert.ok(RPC_ERRORS.AGENT_ERROR.code >= -32099 && RPC_ERRORS.AGENT_ERROR.code <= -32000);
  });
});
