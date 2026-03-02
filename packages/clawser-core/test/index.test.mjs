// Run with: node --import ./web/test/_setup-globals.mjs --test packages/clawser-core/test/index.test.mjs
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

const mod = await import('../index.js');

// ── 1. Exports exist ────────────────────────────────────────────

describe('clawser-core exports', () => {
  it('exports ClawserAgent class', () => {
    assert.equal(typeof mod.ClawserAgent, 'function');
  });

  it('exports HookPipeline class', () => {
    assert.equal(typeof mod.HookPipeline, 'function');
  });

  it('exports EventLog class', () => {
    assert.equal(typeof mod.EventLog, 'function');
  });

  it('exports BrowserTool class', () => {
    assert.equal(typeof mod.BrowserTool, 'function');
  });

  it('exports LLMProvider class', () => {
    assert.equal(typeof mod.LLMProvider, 'function');
  });
});

// ── 2. BrowserTool base class ───────────────────────────────────

describe('BrowserTool base class', () => {
  it('spec returns object with name placeholder', () => {
    class TestTool extends mod.BrowserTool {
      get name() { return 'test_tool'; }
      get description() { return 'A test tool'; }
    }
    const tool = new TestTool();
    assert.equal(tool.spec.name, 'test_tool');
    assert.equal(tool.spec.description, 'A test tool');
  });

  it('execute throws by default', async () => {
    const tool = new mod.BrowserTool();
    await assert.rejects(() => tool.execute({}), /implement/);
  });
});

// ── 3. LLMProvider base class ───────────────────────────────────

describe('LLMProvider base class', () => {
  it('has chat method that throws', async () => {
    const p = new mod.LLMProvider();
    await assert.rejects(() => p.chat([]), /implement/);
  });

  it('supportsStreaming defaults to false', () => {
    const p = new mod.LLMProvider();
    assert.equal(p.supportsStreaming, false);
  });

  it('supportsNativeTools defaults to false', () => {
    const p = new mod.LLMProvider();
    assert.equal(p.supportsNativeTools, false);
  });
});

// ── 4. EventLog ─────────────────────────────────────────────────

describe('EventLog', () => {
  it('append returns event with id and type', () => {
    const log = new mod.EventLog();
    const evt = log.append('test_event', { msg: 'hello' });
    assert.ok(evt.id.startsWith('evt_'));
    assert.equal(evt.type, 'test_event');
    assert.equal(evt.data.msg, 'hello');
  });

  it('query returns all events by default', () => {
    const log = new mod.EventLog();
    log.append('a', {});
    log.append('b', {});
    const all = log.query();
    assert.equal(all.length, 2);
  });
});

// ── 5. HookPipeline ─────────────────────────────────────────────

describe('HookPipeline', () => {
  it('register and run hooks in order', async () => {
    const pipeline = new mod.HookPipeline();
    const order = [];
    pipeline.register('before_send', async (ctx) => { order.push('a'); return ctx; });
    pipeline.register('before_send', async (ctx) => { order.push('b'); return ctx; });
    await pipeline.run('before_send', {});
    assert.deepStrictEqual(order, ['a', 'b']);
  });

  it('run returns context', async () => {
    const pipeline = new mod.HookPipeline();
    pipeline.register('test', async (ctx) => ({ ...ctx, added: true }));
    const result = await pipeline.run('test', { original: true });
    assert.equal(result.added, true);
  });

  it('run with no hooks returns original context', async () => {
    const pipeline = new mod.HookPipeline();
    const result = await pipeline.run('empty', { val: 42 });
    assert.equal(result.val, 42);
  });
});

// ── 6. ClawserAgent ─────────────────────────────────────────────

describe('ClawserAgent stub', () => {
  it('can be constructed', () => {
    const agent = new mod.ClawserAgent();
    assert.ok(agent);
  });

  it('has sendMessage method', () => {
    const agent = new mod.ClawserAgent();
    assert.equal(typeof agent.sendMessage, 'function');
  });

  it('has run method', () => {
    const agent = new mod.ClawserAgent();
    assert.equal(typeof agent.run, 'function');
  });
});
