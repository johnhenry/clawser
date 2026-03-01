// Run with: node --import ./web/test/_setup-globals.mjs --test web/test/clawser-plugins.test.mjs
import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import { PluginLoader } from '../clawser-plugins.js';

describe('PluginLoader', () => {
  let loader;

  beforeEach(() => {
    loader = new PluginLoader();
  });

  it('starts empty', () => {
    assert.equal(loader.size, 0);
    assert.deepEqual(loader.list(), []);
  });

  it('register adds a plugin', () => {
    loader.register({ name: 'alpha', version: '1.0.0', tools: [] });
    assert.equal(loader.size, 1);
  });

  it('register throws without a name', () => {
    assert.throws(() => loader.register({}), /must have a name/);
    assert.throws(() => loader.register(null), /must have a name/);
  });

  it('register throws on duplicate name', () => {
    loader.register({ name: 'dup' });
    assert.throws(() => loader.register({ name: 'dup' }), /already registered/);
  });

  it('unregister removes and returns true', () => {
    loader.register({ name: 'rem' });
    assert.equal(loader.unregister('rem'), true);
    assert.equal(loader.size, 0);
  });

  it('unregister returns false for missing plugin', () => {
    assert.equal(loader.unregister('nope'), false);
  });

  it('list returns all plugins', () => {
    loader.register({ name: 'a', version: '1.0', tools: [{ name: 't1' }] });
    loader.register({ name: 'b', version: '2.0', tools: [] });
    const list = loader.list();
    assert.equal(list.length, 2);
    assert.equal(list[0].name, 'a');
    assert.equal(list[0].toolCount, 1);
    assert.equal(list[1].name, 'b');
    assert.equal(list[1].toolCount, 0);
  });

  it('get returns plugin or null', () => {
    loader.register({ name: 'found', version: '1.0' });
    assert.ok(loader.get('found'));
    assert.equal(loader.get('found').name, 'found');
    assert.equal(loader.get('missing'), null);
  });

  it('getTools collects tools from all plugins', () => {
    loader.register({ name: 'p1', tools: [{ name: 'tool_a' }, { name: 'tool_b' }] });
    loader.register({ name: 'p2', tools: [{ name: 'tool_c' }] });
    const tools = loader.getTools();
    assert.equal(tools.length, 3);
    assert.equal(tools[0]._plugin, 'p1');
    assert.equal(tools[2]._plugin, 'p2');
  });

  it('getHooks collects hooks from all plugins', () => {
    const fn1 = () => {};
    const fn2 = () => {};
    loader.register({ name: 'p1', hooks: { beforeOutbound: fn1 } });
    loader.register({ name: 'p2', hooks: { beforeOutbound: fn2, onSessionStart: fn1 } });
    const hooks = loader.getHooks();
    assert.equal(hooks.beforeOutbound.length, 2);
    assert.equal(hooks.onSessionStart.length, 1);
  });

  it('size reflects registered count', () => {
    assert.equal(loader.size, 0);
    loader.register({ name: 'x' });
    assert.equal(loader.size, 1);
    loader.register({ name: 'y' });
    assert.equal(loader.size, 2);
    loader.unregister('x');
    assert.equal(loader.size, 1);
  });
});
