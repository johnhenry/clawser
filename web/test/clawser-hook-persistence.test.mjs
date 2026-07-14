// Run with: node --import ./web/test/_setup-globals.mjs --test web/test/clawser-hook-persistence.test.mjs
import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

globalThis.BrowserTool = globalThis.BrowserTool || class { constructor() {} };

import { HookPipeline, defaultHookFactories } from '../clawser-agent.js';

describe('user hook persistence round-trip', () => {
  let pipeline;

  beforeEach(() => {
    pipeline = new HookPipeline();
  });

  it('serialize includes factoryName and body for user hooks', () => {
    const body = 'async (ctx) => ({ action: "continue" })';
    pipeline.register({
      name: 'my-hook',
      point: 'beforeToolCall',
      priority: 5,
      execute: new Function('return ' + body)(),
      factoryName: 'user-hook',
      body,
    });

    const data = pipeline.serialize();
    assert.equal(data.hooks.length, 1);
    assert.equal(data.hooks[0].factoryName, 'user-hook');
    assert.equal(data.hooks[0].body, body);
  });

  it('deserialize rebuilds an executable hook from persisted body', async () => {
    const body = 'async (ctx) => ({ action: "continue", touched: ctx.toolName })';
    pipeline.register({
      name: 'roundtrip',
      point: 'beforeToolCall',
      priority: 7,
      execute: new Function('return ' + body)(),
      factoryName: 'user-hook',
      body,
    });
    const data = pipeline.serialize();

    const restored = new HookPipeline();
    restored.deserialize(data, defaultHookFactories());

    const hooks = restored.list();
    assert.equal(hooks.length, 1);
    assert.equal(hooks[0].name, 'roundtrip');
    assert.equal(hooks[0].priority, 7);

    // The rebuilt execute function actually runs
    const result = await restored.run('beforeToolCall', { toolName: 'x' });
    assert.ok(result);
  });

  it('skips entries with unknown factories and corrupt bodies without throwing', () => {
    const restored = new HookPipeline();
    restored.deserialize({
      hooks: [
        { name: 'a', point: 'beforeToolCall', priority: 1, enabled: true, factoryName: 'nope', body: null },
        { name: 'b', point: 'beforeToolCall', priority: 1, enabled: true, factoryName: 'user-hook', body: 'not((valid js' },
        { name: 'c', point: 'beforeToolCall', priority: 1, enabled: true, factoryName: 'user-hook', body: null },
      ],
    }, defaultHookFactories());

    assert.equal(restored.list().length, 0);
  });

  it('preserves enabled=false through the round-trip', () => {
    const body = '() => ({ action: "continue" })';
    pipeline.register({
      name: 'off-hook', point: 'beforeToolCall', priority: 1,
      enabled: false, execute: () => {}, factoryName: 'user-hook', body,
    });
    const restored = new HookPipeline();
    restored.deserialize(pipeline.serialize(), defaultHookFactories());
    assert.equal(restored.list()[0].enabled, false);
  });
});
