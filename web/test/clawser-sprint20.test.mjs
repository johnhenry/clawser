// Sprint 20 — Streaming Delegation + Per-Profile Cost + Recipe Export + Plugin API + Conflict Resolution + WebSocket Emulation
// RED phase: 30 tests, all expected to fail initially.

import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';

// ── Global polyfills for Node.js environment ────────────────────
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
if (typeof globalThis.BroadcastChannel === 'undefined') {
  globalThis.BroadcastChannel = class {
    onmessage = null;
    postMessage() {}
    close() {}
  };
}
if (!globalThis.crypto?.randomUUID) {
  globalThis.crypto = globalThis.crypto || {};
  globalThis.crypto.randomUUID = () => `test-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

// ── 1. Streaming delegation (5 tests) ───────────────────────────

describe('Streaming delegation', () => {
  let SubAgent;

  before(async () => {
    const mod = await import('../clawser-delegate.js');
    SubAgent = mod.SubAgent;
  });

  it('SubAgent has runStream method', () => {
    const agent = new SubAgent({
      goal: 'test',
      chatFn: async () => ({ content: 'done', tool_calls: [] }),
      executeFn: async () => ({ success: true, output: '' }),
      toolSpecs: [],
    });
    assert.equal(typeof agent.runStream, 'function');
  });

  it('runStream yields text chunks', async () => {
    const agent = new SubAgent({
      goal: 'analyze data',
      chatFn: async () => ({ content: 'Analysis complete', tool_calls: [], usage: { input_tokens: 10, output_tokens: 5 } }),
      executeFn: async () => ({ success: true, output: '' }),
      toolSpecs: [],
    });
    const chunks = [];
    for await (const chunk of agent.runStream()) {
      chunks.push(chunk);
    }
    assert.ok(chunks.length > 0);
    const textChunk = chunks.find(c => c.type === 'text');
    assert.ok(textChunk);
    assert.ok(textChunk.content.includes('Analysis complete'));
  });

  it('runStream yields tool_start events', async () => {
    let callCount = 0;
    const agent = new SubAgent({
      goal: 'use tools',
      chatFn: async () => {
        callCount++;
        if (callCount === 1) {
          return {
            content: '',
            tool_calls: [{ id: 't1', name: 'test_tool', arguments: '{}' }],
            usage: { input_tokens: 10, output_tokens: 5 },
          };
        }
        return { content: 'Done with tools', tool_calls: [], usage: { input_tokens: 10, output_tokens: 5 } };
      },
      executeFn: async () => ({ success: true, output: 'tool result' }),
      toolSpecs: [{ name: 'test_tool', required_permission: 'read' }],
    });
    const chunks = [];
    for await (const chunk of agent.runStream()) {
      chunks.push(chunk);
    }
    const toolStart = chunks.find(c => c.type === 'tool_start');
    assert.ok(toolStart);
    assert.equal(toolStart.name, 'test_tool');
  });

  it('runStream yields done event', async () => {
    const agent = new SubAgent({
      goal: 'quick task',
      chatFn: async () => ({ content: 'finished', tool_calls: [], usage: { input_tokens: 5, output_tokens: 3 } }),
      executeFn: async () => ({ success: true, output: '' }),
      toolSpecs: [],
    });
    const chunks = [];
    for await (const chunk of agent.runStream()) {
      chunks.push(chunk);
    }
    const done = chunks.find(c => c.type === 'done');
    assert.ok(done);
    assert.equal(done.success, true);
  });

  it('runStream handles depth limit', async () => {
    const agent = new SubAgent({
      goal: 'deep task',
      chatFn: async () => ({ content: 'done', tool_calls: [] }),
      executeFn: async () => ({ success: true, output: '' }),
      toolSpecs: [],
      depth: 5,
    });
    const chunks = [];
    for await (const chunk of agent.runStream()) {
      chunks.push(chunk);
    }
    const done = chunks.find(c => c.type === 'done');
    assert.ok(done);
    assert.equal(done.success, false);
  });
});

// ── 2. Per-profile cost tracking (5 tests) ──────────────────────

describe('Per-profile cost tracking', () => {
  let ProfileCostLedger;

  before(async () => {
    const mod = await import('../clawser-providers.js');
    ProfileCostLedger = mod.ProfileCostLedger;
  });

  it('ProfileCostLedger class exists', () => {
    assert.ok(ProfileCostLedger);
  });

  it('records cost per profile', () => {
    const ledger = new ProfileCostLedger();
    ledger.record('prof_1', { model: 'gpt-4o', provider: 'openai', inputTokens: 100, outputTokens: 50, costUsd: 0.01 });
    ledger.record('prof_2', { model: 'claude-3', provider: 'anthropic', inputTokens: 200, outputTokens: 100, costUsd: 0.02 });
    ledger.record('prof_1', { model: 'gpt-4o', provider: 'openai', inputTokens: 50, outputTokens: 25, costUsd: 0.005 });
    const summary1 = ledger.profileSummary('prof_1');
    assert.equal(summary1.totalCalls, 2);
    assert.ok(Math.abs(summary1.totalCostUsd - 0.015) < 0.001);
  });

  it('returns empty summary for unknown profile', () => {
    const ledger = new ProfileCostLedger();
    const summary = ledger.profileSummary('unknown');
    assert.equal(summary.totalCalls, 0);
    assert.equal(summary.totalCostUsd, 0);
  });

  it('supports per-profile threshold', () => {
    const ledger = new ProfileCostLedger();
    ledger.setProfileThreshold('prof_1', 0.05);
    ledger.record('prof_1', { model: 'gpt-4o', provider: 'openai', inputTokens: 100, outputTokens: 50, costUsd: 0.03 });
    assert.equal(ledger.isProfileOverThreshold('prof_1'), false);
    ledger.record('prof_1', { model: 'gpt-4o', provider: 'openai', inputTokens: 100, outputTokens: 50, costUsd: 0.03 });
    assert.equal(ledger.isProfileOverThreshold('prof_1'), true);
  });

  it('allProfileSummaries returns all profiles', () => {
    const ledger = new ProfileCostLedger();
    ledger.record('prof_a', { model: 'gpt-4o', provider: 'openai', inputTokens: 100, outputTokens: 50, costUsd: 0.01 });
    ledger.record('prof_b', { model: 'claude-3', provider: 'anthropic', inputTokens: 100, outputTokens: 50, costUsd: 0.02 });
    const all = ledger.allProfileSummaries();
    assert.ok(typeof all === 'object');
    assert.ok(all.prof_a);
    assert.ok(all.prof_b);
    assert.equal(all.prof_a.totalCalls, 1);
    assert.equal(all.prof_b.totalCalls, 1);
  });
});

// ── 3. Automation recipes as skills (5 tests) ───────────────────

describe('Automation recipes as skills', () => {
  let WorkflowRecorder;

  before(async () => {
    const mod = await import('../clawser-browser-auto.js');
    WorkflowRecorder = mod.WorkflowRecorder;
  });

  it('exportAsSkill method exists', () => {
    const recorder = new WorkflowRecorder();
    assert.equal(typeof recorder.exportAsSkill, 'function');
  });

  it('exports SKILL.md with YAML frontmatter', () => {
    const recorder = new WorkflowRecorder();
    recorder.addStep({ action: 'navigate', url: 'https://example.com' });
    recorder.addStep({ action: 'click', selector: '#login' });
    const skill = recorder.exportAsSkill('Login Flow', 'Automates login process');
    assert.ok(skill.includes('---'));
    assert.ok(skill.includes('name: Login Flow'));
    assert.ok(skill.includes('description: Automates login process'));
  });

  it('includes steps as JSON in skill body', () => {
    const recorder = new WorkflowRecorder();
    recorder.addStep({ action: 'navigate', url: 'https://example.com' });
    recorder.addStep({ action: 'fill', selector: '#email', value: 'test@test.com' });
    const skill = recorder.exportAsSkill('Fill Form', 'Auto-fill form');
    assert.ok(skill.includes('navigate'));
    assert.ok(skill.includes('fill'));
  });

  it('includes version in frontmatter', () => {
    const recorder = new WorkflowRecorder();
    recorder.addStep({ action: 'click', selector: '.btn' });
    const skill = recorder.exportAsSkill('Clicker', 'Clicks a button', { version: '1.2.0' });
    assert.ok(skill.includes('version: 1.2.0'));
  });

  it('includes requires.tools for browser automation', () => {
    const recorder = new WorkflowRecorder();
    recorder.addStep({ action: 'navigate', url: 'https://example.com' });
    const skill = recorder.exportAsSkill('Nav Skill', 'Navigation skill');
    assert.ok(skill.includes('browser_'));
  });
});

// ── 4. Plugin API (5 tests) ─────────────────────────────────────

describe('Plugin API', () => {
  let PluginLoader;

  before(async () => {
    const mod = await import('../clawser-plugins.js');
    PluginLoader = mod.PluginLoader;
  });

  it('PluginLoader class exists', () => {
    assert.ok(PluginLoader);
  });

  it('register adds a plugin', () => {
    const loader = new PluginLoader();
    loader.register({
      name: 'test-plugin',
      version: '1.0.0',
      tools: [{ name: 'custom_tool', execute: async () => ({ success: true, output: 'hi' }) }],
    });
    assert.equal(loader.list().length, 1);
    assert.equal(loader.list()[0].name, 'test-plugin');
  });

  it('unregister removes a plugin', () => {
    const loader = new PluginLoader();
    loader.register({ name: 'removable', version: '1.0.0', tools: [] });
    assert.equal(loader.list().length, 1);
    loader.unregister('removable');
    assert.equal(loader.list().length, 0);
  });

  it('getTools returns all plugin tools', () => {
    const loader = new PluginLoader();
    loader.register({
      name: 'plug-a',
      version: '1.0.0',
      tools: [
        { name: 'tool_a', execute: async () => ({ success: true, output: '' }) },
        { name: 'tool_b', execute: async () => ({ success: true, output: '' }) },
      ],
    });
    loader.register({
      name: 'plug-b',
      version: '2.0.0',
      tools: [
        { name: 'tool_c', execute: async () => ({ success: true, output: '' }) },
      ],
    });
    const tools = loader.getTools();
    assert.equal(tools.length, 3);
    const names = tools.map(t => t.name);
    assert.ok(names.includes('tool_a'));
    assert.ok(names.includes('tool_c'));
  });

  it('rejects duplicate plugin names', () => {
    const loader = new PluginLoader();
    loader.register({ name: 'dup', version: '1.0.0', tools: [] });
    assert.throws(() => {
      loader.register({ name: 'dup', version: '2.0.0', tools: [] });
    });
  });
});

// ── 5. Branch merge conflict resolution (5 tests) ───────────────

describe('Conflict resolution', () => {
  let ConflictResolver;

  before(async () => {
    const mod = await import('../clawser-git.js');
    ConflictResolver = mod.ConflictResolver;
  });

  it('ConflictResolver class exists', () => {
    assert.ok(ConflictResolver);
  });

  it('resolves with ours strategy', () => {
    const resolver = new ConflictResolver({ strategy: 'ours' });
    const result = resolver.resolve({
      path: 'file.txt',
      ours: 'our content',
      theirs: 'their content',
      base: 'base content',
    });
    assert.equal(result.content, 'our content');
    assert.equal(result.strategy, 'ours');
  });

  it('resolves with theirs strategy', () => {
    const resolver = new ConflictResolver({ strategy: 'theirs' });
    const result = resolver.resolve({
      path: 'file.txt',
      ours: 'our content',
      theirs: 'their content',
      base: 'base content',
    });
    assert.equal(result.content, 'their content');
    assert.equal(result.strategy, 'theirs');
  });

  it('resolves with union strategy for line-based merging', () => {
    const resolver = new ConflictResolver({ strategy: 'union' });
    const result = resolver.resolve({
      path: 'file.txt',
      ours: 'line1\nline2\nline3',
      theirs: 'line1\nline4\nline3',
      base: 'line1\nline3',
    });
    assert.ok(result.content.includes('line2'));
    assert.ok(result.content.includes('line4'));
    assert.equal(result.strategy, 'union');
  });

  it('resolveAll handles multiple conflicts', () => {
    const resolver = new ConflictResolver({ strategy: 'ours' });
    const conflicts = [
      { path: 'a.txt', ours: 'a', theirs: 'b', base: '' },
      { path: 'b.txt', ours: 'x', theirs: 'y', base: '' },
    ];
    const results = resolver.resolveAll(conflicts);
    assert.equal(results.length, 2);
    assert.equal(results[0].content, 'a');
    assert.equal(results[1].content, 'x');
  });
});

// ── 6. WebSocket emulation (5 tests) ────────────────────────────

describe('WebSocket emulation', () => {
  let SSEChannel;

  before(async () => {
    const mod = await import('../clawser-server.js');
    SSEChannel = mod.SSEChannel;
  });

  it('SSEChannel class exists', () => {
    assert.ok(SSEChannel);
  });

  it('send queues messages', () => {
    const channel = new SSEChannel('ch1');
    channel.send({ type: 'message', data: 'hello' });
    channel.send({ type: 'message', data: 'world' });
    const pending = channel.drain();
    assert.equal(pending.length, 2);
    assert.equal(pending[0].data, 'hello');
    assert.equal(pending[1].data, 'world');
  });

  it('drain clears the queue', () => {
    const channel = new SSEChannel('ch2');
    channel.send({ type: 'message', data: 'test' });
    channel.drain();
    const second = channel.drain();
    assert.equal(second.length, 0);
  });

  it('supports onMessage callback', () => {
    const received = [];
    const channel = new SSEChannel('ch3');
    channel.onMessage((msg) => received.push(msg));
    channel.receive({ type: 'message', data: 'incoming' });
    assert.equal(received.length, 1);
    assert.equal(received[0].data, 'incoming');
  });

  it('close prevents further sends', () => {
    const channel = new SSEChannel('ch4');
    channel.send({ type: 'message', data: 'before' });
    channel.close();
    channel.send({ type: 'message', data: 'after' });
    const msgs = channel.drain();
    assert.equal(msgs.length, 1);
    assert.equal(channel.closed, true);
  });
});
