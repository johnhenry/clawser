// Run with: node --import ./web/test/_setup-globals.mjs --test web/test/clawser-hooks-persistence.test.mjs
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { HookPipeline } from '../clawser-agent.js';

// ── Hook persistence ─────────────────────────────────────────────

describe('HookPipeline serialize/deserialize', () => {
  it('serialize returns hook definitions', () => {
    const hp = new HookPipeline();
    hp.register({
      name: 'test-hook',
      point: 'beforeInbound',
      priority: 5,
      enabled: true,
      execute: async () => ({ action: 'continue' }),
    });

    const data = hp.serialize();
    assert.equal(data.hooks.length, 1);
    assert.equal(data.hooks[0].name, 'test-hook');
    assert.equal(data.hooks[0].point, 'beforeInbound');
    assert.equal(data.hooks[0].priority, 5);
    assert.equal(data.hooks[0].enabled, true);
  });

  it('deserialize reconstructs hooks from factories', () => {
    const factories = {
      'my-hook': (config) => ({
        name: 'my-hook',
        point: 'beforeOutbound',
        execute: async (ctx) => ({ action: 'continue' }),
      }),
    };

    const data = {
      hooks: [
        { name: 'my-hook', point: 'beforeOutbound', priority: 3, enabled: true, factoryName: 'my-hook' },
      ],
    };

    const hp = new HookPipeline();
    hp.deserialize(data, factories);

    const list = hp.list();
    assert.equal(list.length, 1);
    assert.equal(list[0].name, 'my-hook');
    assert.equal(list[0].point, 'beforeOutbound');
  });

  it('deserialize handles unknown factory gracefully', () => {
    const data = {
      hooks: [
        { name: 'unknown-hook', point: 'beforeInbound', priority: 1, enabled: true, factoryName: 'nonexistent' },
      ],
    };

    const hp = new HookPipeline();
    hp.deserialize(data, {}); // empty factories

    // Unknown factory should be skipped, not crash
    const list = hp.list();
    assert.equal(list.length, 0);
  });

  it('preserves enabled/disabled state', () => {
    const hp = new HookPipeline();
    hp.register({
      name: 'disabled-hook',
      point: 'beforeInbound',
      enabled: false,
      execute: async () => ({ action: 'continue' }),
    });

    const data = hp.serialize();
    assert.equal(data.hooks[0].enabled, false);
  });

  it('preserves priority', () => {
    const hp = new HookPipeline();
    hp.register({
      name: 'high-pri',
      point: 'beforeInbound',
      priority: 1,
      execute: async () => ({ action: 'continue' }),
    });
    hp.register({
      name: 'low-pri',
      point: 'beforeInbound',
      priority: 99,
      execute: async () => ({ action: 'continue' }),
    });

    const data = hp.serialize();
    assert.equal(data.hooks.length, 2);
    // Priorities should be preserved
    const highPri = data.hooks.find(h => h.name === 'high-pri');
    const lowPri = data.hooks.find(h => h.name === 'low-pri');
    assert.equal(highPri.priority, 1);
    assert.equal(lowPri.priority, 99);
  });

  it('serialize/deserialize roundtrip', () => {
    const hp = new HookPipeline();
    hp.register({
      name: 'roundtrip-hook',
      point: 'onSessionStart',
      priority: 7,
      enabled: true,
      factoryName: 'test-factory',
      execute: async () => ({ action: 'continue' }),
    });

    const data = hp.serialize();

    const factories = {
      'test-factory': () => ({
        name: 'roundtrip-hook',
        point: 'onSessionStart',
        execute: async () => ({ action: 'continue' }),
      }),
    };

    const hp2 = new HookPipeline();
    hp2.deserialize(data, factories);

    const list = hp2.list();
    assert.equal(list.length, 1);
    assert.equal(list[0].name, 'roundtrip-hook');
    assert.equal(list[0].point, 'onSessionStart');
  });
});
