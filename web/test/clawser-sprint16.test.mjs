// Sprint 16 — Background Jobs + Scoped Metrics + Goal Hooks + SSE Streaming + Activity Log + Tool Wrappers
// RED phase: 30 tests, all expected to fail initially.

import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';

// ── 1. Background jobs (6 tests) ────────────────────────────────

describe('Background jobs', () => {
  let ClawserShell, tokenize;

  before(async () => {
    const mod = await import('../clawser-shell.js');
    ClawserShell = mod.ClawserShell;
    tokenize = mod.tokenize;
  });

  it('tokenizer recognizes trailing & as BACKGROUND token', () => {
    const tokens = tokenize('sleep 5 &');
    const bg = tokens.find(t => t.type === 'BACKGROUND');
    assert.ok(bg, 'Should have a BACKGROUND token');
  });

  it('tokenizer distinguishes & from &&', () => {
    const tokens = tokenize('a && b &');
    const types = tokens.map(t => t.type);
    assert.ok(types.includes('AND'));
    assert.ok(types.includes('BACKGROUND'));
  });

  it('shell has job table', () => {
    const shell = new ClawserShell();
    assert.equal(typeof shell.jobs, 'function');
    const list = shell.jobs();
    assert.ok(Array.isArray(list));
    assert.equal(list.length, 0);
  });

  it('background command returns job ID', async () => {
    const shell = new ClawserShell();
    const result = await shell.exec('echo hello &');
    // Background should return immediately with a job notice
    assert.equal(result.exitCode, 0);
    assert.ok(result.stdout.includes('[') || result.jobId != null);
  });

  it('jobs built-in lists active jobs', async () => {
    const shell = new ClawserShell();
    // Register a slow command for background
    shell.registry.register('slow', async () => {
      await new Promise(r => setTimeout(r, 100));
      return { stdout: 'done', stderr: '', exitCode: 0 };
    }, { description: 'Slow test cmd' });
    await shell.exec('slow &');
    const result = await shell.exec('jobs');
    assert.equal(result.exitCode, 0);
    assert.ok(result.stdout.includes('slow') || result.stdout.includes('['));
  });

  it('fg waits for background job to complete', async () => {
    const shell = new ClawserShell();
    shell.registry.register('delayed', async () => {
      await new Promise(r => setTimeout(r, 50));
      return { stdout: 'finished', stderr: '', exitCode: 0 };
    }, { description: 'Delayed cmd' });
    await shell.exec('delayed &');
    const result = await shell.exec('fg');
    assert.equal(result.exitCode, 0);
    assert.ok(result.stdout.includes('finished'));
  });
});

// ── 2. Scoped metrics (5 tests) ─────────────────────────────────

describe('Scoped metrics', () => {
  let MetricsCollector;

  before(async () => {
    const mod = await import('../clawser-metrics.js');
    MetricsCollector = mod.MetricsCollector;
  });

  it('scopedView returns a scoped collector', () => {
    const mc = new MetricsCollector();
    assert.equal(typeof mc.scopedView, 'function');
    const scoped = mc.scopedView('conv-123');
    assert.ok(scoped);
  });

  it('scoped collector prefixes counter names', () => {
    const mc = new MetricsCollector();
    const scoped = mc.scopedView('conv-1');
    scoped.increment('messages');
    assert.equal(mc.counter('conv-1:messages'), 1);
  });

  it('scoped collector prefixes gauge names', () => {
    const mc = new MetricsCollector();
    const scoped = mc.scopedView('goal-abc');
    scoped.gauge('tokens', 500);
    assert.equal(mc.getGauge('goal-abc:tokens'), 500);
  });

  it('scoped collector prefixes histogram names', () => {
    const mc = new MetricsCollector();
    const scoped = mc.scopedView('conv-2');
    scoped.observe('latency', 42);
    const vals = mc.histogram('conv-2:latency');
    assert.deepEqual(vals, [42]);
  });

  it('scoped snapshot only includes scoped keys', () => {
    const mc = new MetricsCollector();
    mc.increment('global.count', 10);
    const scoped = mc.scopedView('s1');
    scoped.increment('calls', 3);
    const snap = scoped.snapshot();
    assert.ok('calls' in snap.counters);
    assert.ok(!('global.count' in snap.counters));
  });
});

// ── 3. Auto-commit on goal completion (5 tests) ─────────────────

describe('Goal completion hooks', () => {
  let GoalManager;

  before(async () => {
    const mod = await import('../clawser-goals.js');
    GoalManager = mod.GoalManager;
  });

  it('onCompletion registers a callback', () => {
    const gm = new GoalManager();
    assert.equal(typeof gm.onCompletion, 'function');
    gm.onCompletion(() => {});
  });

  it('callback fires when goal status changes to completed', () => {
    const gm = new GoalManager();
    let completedGoal = null;
    gm.onCompletion((goal) => { completedGoal = goal; });
    const g = gm.addGoal('Test goal');
    gm.updateStatus(g.id, 'completed');
    assert.ok(completedGoal);
    assert.equal(completedGoal.id, g.id);
  });

  it('callback does NOT fire for non-completion status changes', () => {
    const gm = new GoalManager();
    let fired = false;
    gm.onCompletion(() => { fired = true; });
    const g = gm.addGoal('Test goal');
    gm.updateStatus(g.id, 'paused');
    assert.equal(fired, false);
  });

  it('callback fires for cascading parent completion', () => {
    const gm = new GoalManager();
    const completed = [];
    gm.onCompletion((goal) => { completed.push(goal.id); });
    const parent = gm.addGoal('Parent');
    const child = gm.addSubGoal(parent.id, 'Child');
    gm.updateStatus(child.id, 'completed');
    // Child should complete, and parent should auto-complete (single child)
    assert.ok(completed.includes(child.id));
    assert.ok(completed.includes(parent.id));
  });

  it('removeOnCompletion unregisters callback', () => {
    const gm = new GoalManager();
    let count = 0;
    const unsub = gm.onCompletion(() => { count++; });
    const g1 = gm.addGoal('Goal 1');
    gm.updateStatus(g1.id, 'completed');
    assert.equal(count, 1);
    unsub();
    const g2 = gm.addGoal('Goal 2');
    gm.updateStatus(g2.id, 'completed');
    assert.equal(count, 1); // Should not have fired again
  });
});

// ── 4. SSE Streaming (4 tests) ───────────────────────────────────

describe('SSE streaming', () => {
  let ServerManager;

  before(async () => {
    const mod = await import('../clawser-server.js');
    ServerManager = mod.ServerManager;
  });

  it('createSSEResponse builds a text/event-stream response', () => {
    assert.equal(typeof ServerManager.createSSEResponse, 'function');
    const response = ServerManager.createSSEResponse([
      { data: 'hello' },
      { data: 'world' },
    ]);
    assert.ok(response instanceof Response);
    assert.equal(response.headers.get('Content-Type'), 'text/event-stream');
  });

  it('SSE response body contains properly formatted events', async () => {
    const response = ServerManager.createSSEResponse([
      { data: 'line1' },
      { event: 'update', data: 'line2' },
    ]);
    const text = await response.text();
    assert.ok(text.includes('data: line1'));
    assert.ok(text.includes('event: update'));
    assert.ok(text.includes('data: line2'));
  });

  it('createSSEResponse from async generator', async () => {
    async function* gen() {
      yield { data: 'a' };
      yield { data: 'b' };
    }
    const response = await ServerManager.createSSEResponseFromGenerator(gen());
    assert.ok(response instanceof Response);
    const text = await response.text();
    assert.ok(text.includes('data: a'));
    assert.ok(text.includes('data: b'));
  });

  it('SSE events include id field when provided', async () => {
    const response = ServerManager.createSSEResponse([
      { id: '1', data: 'first' },
      { id: '2', data: 'second' },
    ]);
    const text = await response.text();
    assert.ok(text.includes('id: 1'));
    assert.ok(text.includes('id: 2'));
  });
});

// ── 5. Background activity log (5 tests) ─────────────────────────

describe('Background activity log', () => {
  let EventLog;

  before(async () => {
    // Provide minimal browser globals for Node environment
    if (typeof globalThis.localStorage === 'undefined') {
      const store = {};
      globalThis.localStorage = {
        getItem(k) { return store[k] ?? null; },
        setItem(k, v) { store[k] = String(v); },
        removeItem(k) { delete store[k]; },
        clear() { for (const k in store) delete store[k]; },
        get length() { return Object.keys(store).length; },
      };
    }
    if (typeof globalThis.location === 'undefined') {
      globalThis.location = { href: 'http://localhost/', origin: 'http://localhost', pathname: '/' };
    }
    const mod = await import('../clawser-agent.js');
    EventLog = mod.EventLog;
  });

  it('EventLog supports maxSize option', () => {
    const log = new EventLog({ maxSize: 5 });
    for (let i = 0; i < 10; i++) {
      log.append('test', { i }, 'system');
    }
    assert.equal(log.events.length, 5);
  });

  it('EventLog.query filters by type', () => {
    const log = new EventLog();
    log.append('user_message', { text: 'hi' }, 'user');
    log.append('tool_call', { name: 'fetch' }, 'agent');
    log.append('user_message', { text: 'bye' }, 'user');
    // New method: query({type?, source?, limit?})
    const results = log.query({ type: 'user_message' });
    assert.equal(results.length, 2);
  });

  it('EventLog.query filters by source', () => {
    const log = new EventLog();
    log.append('msg', { t: 1 }, 'user');
    log.append('msg', { t: 2 }, 'agent');
    log.append('msg', { t: 3 }, 'user');
    const results = log.query({ source: 'agent' });
    assert.equal(results.length, 1);
  });

  it('EventLog.query respects limit', () => {
    const log = new EventLog();
    for (let i = 0; i < 20; i++) {
      log.append('test', { i }, 'system');
    }
    const results = log.query({ limit: 5 });
    assert.equal(results.length, 5);
  });

  it('EventLog.summary returns count by type', () => {
    const log = new EventLog();
    log.append('user_message', {}, 'user');
    log.append('user_message', {}, 'user');
    log.append('tool_call', {}, 'agent');
    // New method: summary() → {[type]: count}
    const sum = log.summary();
    assert.equal(sum.user_message, 2);
    assert.equal(sum.tool_call, 1);
  });
});

// ── 6. Tool CLI wrappers (5 tests) ──────────────────────────────

describe('Tool CLI wrappers', () => {
  let generateToolWrappers;

  before(async () => {
    const mod = await import('../clawser-tools.js');
    generateToolWrappers = mod.generateToolWrappers;
  });

  it('generateToolWrappers is a function', () => {
    assert.equal(typeof generateToolWrappers, 'function');
  });

  it('generates wrapper for a simple tool', () => {
    const mockTool = {
      name: 'browser_fetch',
      description: 'Fetch a URL',
      parameters: {
        type: 'object',
        properties: {
          url: { type: 'string', description: 'The URL' },
          method: { type: 'string', description: 'HTTP method' },
        },
        required: ['url'],
      },
    };
    const wrappers = generateToolWrappers([mockTool]);
    assert.ok(wrappers.has('curl'));
  });

  it('wrapper handler parses arguments into tool params', async () => {
    let executedParams = null;
    const mockTool = {
      name: 'browser_fetch',
      description: 'Fetch a URL',
      parameters: {
        type: 'object',
        properties: {
          url: { type: 'string', description: 'The URL' },
        },
        required: ['url'],
      },
      execute: async (params) => {
        executedParams = params;
        return { success: true, output: 'OK' };
      },
    };
    const wrappers = generateToolWrappers([mockTool]);
    const handler = wrappers.get('curl');
    await handler(['https://example.com'], {});
    assert.equal(executedParams.url, 'https://example.com');
  });

  it('generates search wrapper', () => {
    const mockTool = {
      name: 'browser_web_search',
      description: 'Search the web',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Search query' },
        },
        required: ['query'],
      },
    };
    const wrappers = generateToolWrappers([mockTool]);
    assert.ok(wrappers.has('search'));
  });

  it('wrapper returns tool output as stdout', async () => {
    const mockTool = {
      name: 'browser_fetch',
      description: 'Fetch a URL',
      parameters: {
        type: 'object',
        properties: {
          url: { type: 'string', description: 'The URL' },
        },
        required: ['url'],
      },
      execute: async () => ({ success: true, output: 'Response data' }),
    };
    const wrappers = generateToolWrappers([mockTool]);
    const handler = wrappers.get('curl');
    const result = await handler(['https://example.com'], {});
    assert.equal(result.stdout, 'Response data');
    assert.equal(result.exitCode, 0);
  });
});
