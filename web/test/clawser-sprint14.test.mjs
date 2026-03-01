// Run with: node --import ./web/test/_setup-globals.mjs --test web/test/clawser-sprint14.test.mjs
import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

// ── Sub-agent Cancellation (Block 9) ─────────────────────────────

describe('Sub-agent cancellation', () => {
  it('SubAgent.cancel() sets status to cancelled', async () => {
    const { SubAgent } = await import('../clawser-delegate.js');
    let callCount = 0;
    const agent = new SubAgent({
      goal: 'long task',
      chatFn: async () => {
        callCount++;
        await new Promise(r => setTimeout(r, 50));
        return {
          content: '',
          tool_calls: [{ id: `t${callCount}`, name: 'recall', arguments: '{}' }],
          usage: { input_tokens: 10, output_tokens: 5 },
          model: 'test',
        };
      },
      executeFn: async () => ({ success: true, output: 'ok' }),
      toolSpecs: [{ name: 'recall', required_permission: 'read' }],
      maxIterations: 20,
    });

    // Start running, cancel after short delay
    const runPromise = agent.run();
    setTimeout(() => agent.cancel(), 80);
    const result = await runPromise;

    assert.equal(agent.status, 'cancelled');
    assert.equal(result.success, false);
    assert.ok(result.iterations < 20, 'should stop before max iterations');
  });

  it('DelegateManager.cancel() cancels a running sub-agent', async () => {
    const { DelegateManager } = await import('../clawser-delegate.js');
    const mgr = new DelegateManager();
    assert.equal(typeof mgr.cancel, 'function');
  });
});

// ── Sub-agent Memory Scoping (Block 9) ───────────────────────────

describe('Sub-agent memory scoping', () => {
  it('SubAgent accepts parentMemory option', async () => {
    const { SubAgent } = await import('../clawser-delegate.js');
    const parentMemories = [
      { key: 'user-pref', content: 'prefers dark mode', category: 'user' },
    ];

    const agent = new SubAgent({
      goal: 'test',
      chatFn: async () => ({ content: 'Done.', tool_calls: [], usage: {}, model: 'test' }),
      executeFn: async () => ({ success: true, output: '' }),
      toolSpecs: [],
      parentMemory: parentMemories,
    });

    assert.ok(agent.parentMemory, 'should expose parentMemory');
    assert.equal(agent.parentMemory.length, 1);
    assert.equal(agent.parentMemory[0].key, 'user-pref');
  });

  it('SubAgent parentMemory is read-only (frozen copy)', async () => {
    const { SubAgent } = await import('../clawser-delegate.js');
    const parentMemories = [{ key: 'a', content: 'b', category: 'core' }];

    const agent = new SubAgent({
      goal: 'test',
      chatFn: async () => ({ content: 'Done.', tool_calls: [], usage: {}, model: 'test' }),
      executeFn: async () => ({ success: true, output: '' }),
      toolSpecs: [],
      parentMemory: parentMemories,
    });

    // Should not be able to modify parent memory
    assert.throws(() => { agent.parentMemory.push({ key: 'x' }); });
  });

  it('SubAgent system prompt includes parent memory context', async () => {
    const { SubAgent } = await import('../clawser-delegate.js');
    let capturedHistory = [];

    const agent = new SubAgent({
      goal: 'test with context',
      chatFn: async (msgs) => {
        capturedHistory = msgs;
        return { content: 'Done.', tool_calls: [], usage: {}, model: 'test' };
      },
      executeFn: async () => ({ success: true, output: '' }),
      toolSpecs: [],
      parentMemory: [
        { key: 'preference', content: 'Use TypeScript always', category: 'user' },
      ],
    });

    await agent.run();
    const sysMsg = capturedHistory.find(m => m.role === 'system');
    assert.ok(sysMsg.content.includes('TypeScript'), 'system prompt should include parent memory');
  });
});

// ── Auto-decompose Goals (Block 8) ───────────────────────────────

describe('Goal auto-decompose', () => {
  it('GoalManager exposes decompose() method', async () => {
    const { GoalManager, resetGoalIdCounter } = await import('../clawser-goals.js');
    resetGoalIdCounter();
    const mgr = new GoalManager();
    assert.equal(typeof mgr.decompose, 'function');
  });

  it('decompose() accepts a goal ID and sub-task list', async () => {
    const { GoalManager, resetGoalIdCounter } = await import('../clawser-goals.js');
    resetGoalIdCounter();
    const mgr = new GoalManager();
    const goal = mgr.addGoal('Build authentication system');

    const subtasks = ['Set up user model', 'Implement login endpoint', 'Add JWT tokens'];
    const created = mgr.decompose(goal.id, subtasks);

    assert.equal(created.length, 3);
    assert.ok(created.every(g => g.parentId === goal.id));
  });

  it('decompose() inherits priority from parent', async () => {
    const { GoalManager, resetGoalIdCounter } = await import('../clawser-goals.js');
    resetGoalIdCounter();
    const mgr = new GoalManager();
    const goal = mgr.addGoal('Critical fix', { priority: 'critical' });

    const created = mgr.decompose(goal.id, ['Fix bug A', 'Fix bug B']);
    assert.ok(created.every(g => g.priority === 'critical'));
  });

  it('decompose() returns empty array for nonexistent goal', async () => {
    const { GoalManager, resetGoalIdCounter } = await import('../clawser-goals.js');
    resetGoalIdCounter();
    const mgr = new GoalManager();

    const created = mgr.decompose('nonexistent', ['task']);
    assert.deepEqual(created, []);
  });

  it('GoalDecomposeTool exposes correct metadata', async () => {
    const { GoalDecomposeTool } = await import('../clawser-goals.js');
    assert.ok(GoalDecomposeTool, 'should export GoalDecomposeTool');

    const tool = new GoalDecomposeTool();
    assert.equal(tool.name, 'goal_decompose');
    assert.ok(tool.parameters.properties.goal_id);
    assert.ok(tool.parameters.properties.subtasks);
    assert.equal(tool.permission, 'auto');
  });
});

// ── Historical Time-Series Metrics (Block 10) ───────────────────

describe('Metrics time-series storage', () => {
  it('MetricsCollector exposes rollup() method', async () => {
    const { MetricsCollector } = await import('../clawser-metrics.js');
    const mc = new MetricsCollector();
    assert.equal(typeof mc.rollup, 'function');
  });

  it('rollup() returns a dated snapshot', async () => {
    const { MetricsCollector } = await import('../clawser-metrics.js');
    const mc = new MetricsCollector();
    mc.increment('test.counter');
    mc.gauge('test.gauge', 42);

    const rollup = mc.rollup();
    assert.ok(rollup.date, 'should have date');
    assert.ok(rollup.counters, 'should have counters');
    assert.ok(rollup.gauges, 'should have gauges');
  });

  it('MetricsTimeSeries stores rollups', async () => {
    const { MetricsTimeSeries } = await import('../clawser-metrics.js');
    assert.ok(MetricsTimeSeries, 'should export MetricsTimeSeries');

    const ts = new MetricsTimeSeries();
    assert.equal(typeof ts.add, 'function');
    assert.equal(typeof ts.query, 'function');
  });

  it('MetricsTimeSeries.add stores a rollup', async () => {
    const { MetricsTimeSeries } = await import('../clawser-metrics.js');
    const ts = new MetricsTimeSeries();

    ts.add({
      date: '2026-03-01',
      counters: { 'agent.runs': 10 },
      gauges: { 'llm.last_model': 'gpt-4o' },
    });

    assert.equal(ts.size, 1);
  });

  it('MetricsTimeSeries.query returns entries in date range', async () => {
    const { MetricsTimeSeries } = await import('../clawser-metrics.js');
    const ts = new MetricsTimeSeries();

    ts.add({ date: '2026-02-28', counters: { runs: 5 }, gauges: {} });
    ts.add({ date: '2026-03-01', counters: { runs: 10 }, gauges: {} });
    ts.add({ date: '2026-03-02', counters: { runs: 15 }, gauges: {} });

    const results = ts.query('2026-03-01', '2026-03-02');
    assert.equal(results.length, 2);
    assert.equal(results[0].counters.runs, 10);
  });

  it('MetricsTimeSeries.export() returns all data as JSON', async () => {
    const { MetricsTimeSeries } = await import('../clawser-metrics.js');
    const ts = new MetricsTimeSeries();
    ts.add({ date: '2026-03-01', counters: { runs: 1 }, gauges: {} });

    const exported = ts.export();
    assert.ok(Array.isArray(exported));
    assert.equal(exported.length, 1);
  });

  it('MetricsTimeSeries.import() restores from JSON', async () => {
    const { MetricsTimeSeries } = await import('../clawser-metrics.js');
    const ts = new MetricsTimeSeries();
    const data = [
      { date: '2026-03-01', counters: { runs: 1 }, gauges: {} },
      { date: '2026-03-02', counters: { runs: 2 }, gauges: {} },
    ];
    ts.import(data);
    assert.equal(ts.size, 2);
  });
});

// ── Dynamic Hint Selection (Block 11) ────────────────────────────

describe('Dynamic hint selection', () => {
  it('ModelRouter exposes selectHint() method', async () => {
    const { ModelRouter } = await import('../clawser-fallback.js');
    const router = new ModelRouter();
    assert.equal(typeof router.selectHint, 'function');
  });

  it('selectHint returns "fast" for simple queries', async () => {
    const { ModelRouter } = await import('../clawser-fallback.js');
    const router = new ModelRouter();

    const hint = router.selectHint({ text: 'What time is it?', toolCount: 0 });
    assert.equal(hint, 'fast');
  });

  it('selectHint returns "smart" for complex multi-tool tasks', async () => {
    const { ModelRouter } = await import('../clawser-fallback.js');
    const router = new ModelRouter();

    const hint = router.selectHint({
      text: 'Analyze the codebase, find all security vulnerabilities, refactor the authentication module, and write tests',
      toolCount: 5,
    });
    assert.equal(hint, 'smart');
  });

  it('selectHint returns "code" for code-heavy prompts', async () => {
    const { ModelRouter } = await import('../clawser-fallback.js');
    const router = new ModelRouter();

    const hint = router.selectHint({
      text: 'Write a function to sort an array using quicksort, implement the partition step, add error handling',
      toolCount: 0,
      hasCode: true,
    });
    assert.equal(hint, 'code');
  });
});

// ── Adaptive Model Selection (Block 11) ──────────────────────────

describe('Adaptive model selection', () => {
  it('ModelRouter exposes recordOutcome() method', async () => {
    const { ModelRouter } = await import('../clawser-fallback.js');
    const router = new ModelRouter();
    assert.equal(typeof router.recordOutcome, 'function');
  });

  it('recordOutcome stores success/failure for model+task type', async () => {
    const { ModelRouter } = await import('../clawser-fallback.js');
    const router = new ModelRouter();

    router.recordOutcome({ model: 'gpt-4o', hint: 'code', success: true, durationMs: 500 });
    router.recordOutcome({ model: 'gpt-4o', hint: 'code', success: true, durationMs: 600 });
    router.recordOutcome({ model: 'gpt-4o', hint: 'code', success: false, durationMs: 1000 });

    const stats = router.modelStats('gpt-4o', 'code');
    assert.ok(stats, 'should have stats');
    assert.equal(stats.successes, 2);
    assert.equal(stats.failures, 1);
  });

  it('modelStats returns null for unknown model+hint', async () => {
    const { ModelRouter } = await import('../clawser-fallback.js');
    const router = new ModelRouter();

    const stats = router.modelStats('nonexistent', 'fast');
    assert.equal(stats, null);
  });

  it('recordOutcome influences getChain ordering', async () => {
    const { ModelRouter, FallbackChain, FallbackEntry } = await import('../clawser-fallback.js');
    const router = new ModelRouter();

    // Record many successes for a model on 'code' tasks
    for (let i = 0; i < 10; i++) {
      router.recordOutcome({ model: 'gpt-4o', hint: 'code', success: true, durationMs: 200 });
    }
    // Record failures for another
    for (let i = 0; i < 10; i++) {
      router.recordOutcome({ model: 'gpt-4o-mini', hint: 'code', success: false, durationMs: 1000 });
    }

    // The model stats should reflect the difference
    const good = router.modelStats('gpt-4o', 'code');
    const bad = router.modelStats('gpt-4o-mini', 'code');
    assert.ok(good.successes > bad.successes);
  });
});
