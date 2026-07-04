// Run with: node --import ./web/test/_setup-globals.mjs --test web/test/clawser-reactive-config-domains.test.mjs
//
// Tests the REAL ReactiveConfigStore module (not an inline copy):
// registerDefaultDomains wiring + content-hash apply dedupe.
import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import { ReactiveConfigStore, registerDefaultDomains } from '../clawser-reactive-config.mjs';

// ── Stubs ─────────────────────────────────────────────────────────

const createMockWatcher = () => {
  const watches = new Map();
  return {
    watches,
    watch(path, callback) { watches.set(path, callback); },
    unwatch(path) { watches.delete(path); },
    markWrittenByMe() {},
    getCached() { return null; },
    simulateChange(path, changeEvent) {
      const cb = watches.get(path);
      if (cb) cb(changeEvent);
    },
  };
};

const createMockFs = () => ({
  async readFile() { throw new Error('ENOENT'); },
  async writeFile() {},
});

const changeEvent = (path, newValue) => ({ path, newValue, oldValue: null, type: 'modified' });

// ── registerDefaultDomains ────────────────────────────────────────

describe('registerDefaultDomains', () => {
  let watcher, store, mockState;

  beforeEach(() => {
    watcher = createMockWatcher();
    store = new ReactiveConfigStore(watcher, createMockFs());
    mockState = {
      agent: {
        autonomyCalls: [],
        prompts: [],
        updateAutonomy(cfg) { this.autonomyCalls.push(cfg); },
        setSystemPrompt(p) { this.prompts.push(p); },
      },
      safetyPipeline: {
        enabled: false,
        confirmEnableCalls: 0,
        confirmEnable() { this.confirmEnableCalls++; this.enabled = true; },
      },
      daemonController: {
        calls: [],
        start() { this.calls.push('start'); },
        stop() { this.calls.push('stop'); },
      },
    };
    registerDefaultDomains(store, mockState);
  });

  it('registers all six standard domains', () => {
    assert.deepEqual(
      store.listDomains().sort(),
      ['autonomy', 'daemon', 'hooks', 'identity', 'security', 'terminal'],
    );
  });

  it('applies autonomy changes to the agent', () => {
    watcher.simulateChange('~/.config/clawser/autonomy.json',
      changeEvent('~/.config/clawser/autonomy.json', { level: 'full' }));
    assert.deepEqual(mockState.agent.autonomyCalls, [{ level: 'full' }]);
  });

  it('rejects invalid autonomy levels', () => {
    watcher.simulateChange('~/.config/clawser/autonomy.json',
      changeEvent('~/.config/clawser/autonomy.json', { level: 'yolo' }));
    assert.equal(mockState.agent.autonomyCalls.length, 0);
  });

  it('applies identity systemPrompt to the agent', () => {
    watcher.simulateChange('~/.config/clawser/identity.json',
      changeEvent('~/.config/clawser/identity.json', { name: 'clawser', systemPrompt: 'be helpful' }));
    assert.deepEqual(mockState.agent.prompts, ['be helpful']);
  });

  it('security config re-enables the safety pipeline but never disables it', () => {
    watcher.simulateChange('~/.config/clawser/security.json',
      changeEvent('~/.config/clawser/security.json', { inputSanitization: true }));
    assert.equal(mockState.safetyPipeline.confirmEnableCalls, 1);
    assert.equal(mockState.safetyPipeline.enabled, true);

    // All flags off must NOT disable the pipeline from a file change
    watcher.simulateChange('~/.config/clawser/security.json',
      changeEvent('~/.config/clawser/security.json', {
        inputSanitization: false, outputScanning: false, xssPrevention: false,
      }));
    assert.equal(mockState.safetyPipeline.enabled, true);
  });

  it('daemon config starts and stops the daemon controller', () => {
    watcher.simulateChange('~/.config/clawser/daemon.json',
      changeEvent('~/.config/clawser/daemon.json', { enabled: true }));
    watcher.simulateChange('~/.config/clawser/daemon.json',
      changeEvent('~/.config/clawser/daemon.json', { enabled: false }));
    assert.deepEqual(mockState.daemonController.calls, ['start', 'stop']);
  });

  it('rejects invalid terminal renderer values', () => {
    let applied = false;
    store.subscribe('terminal', () => { applied = true; });
    watcher.simulateChange('~/.config/clawser/terminal.json',
      changeEvent('~/.config/clawser/terminal.json', { renderer: 'webgl' }));
    assert.equal(applied, false);
  });

  it('accepts wterm and custom-dom renderer values', () => {
    let events = 0;
    store.subscribe('terminal', () => { events++; });
    watcher.simulateChange('~/.config/clawser/terminal.json',
      changeEvent('~/.config/clawser/terminal.json', { renderer: 'wterm' }));
    watcher.simulateChange('~/.config/clawser/terminal.json',
      changeEvent('~/.config/clawser/terminal.json', { renderer: 'custom-dom' }));
    assert.equal(events, 2);
  });

  it('hooks and terminal domains tolerate a minimal state object', () => {
    // No agent/daemon/safety subsystems present at all
    const bareStore = new ReactiveConfigStore(createMockWatcher(), createMockFs());
    assert.doesNotThrow(() => registerDefaultDomains(bareStore, {}));
  });
});

// ── Content-hash apply dedupe ─────────────────────────────────────

describe('ReactiveConfigStore apply dedupe', () => {
  it('skips apply when content is unchanged (multi-tab duplicate)', () => {
    const watcher = createMockWatcher();
    const store = new ReactiveConfigStore(watcher, createMockFs());
    const applies = [];
    store.register('test', '/cfg/test.json', { apply: (cfg) => applies.push(cfg) });

    watcher.simulateChange('/cfg/test.json', changeEvent('/cfg/test.json', { a: 1 }));
    watcher.simulateChange('/cfg/test.json', changeEvent('/cfg/test.json', { a: 1 }));
    assert.equal(applies.length, 1);

    watcher.simulateChange('/cfg/test.json', changeEvent('/cfg/test.json', { a: 2 }));
    assert.equal(applies.length, 2);
  });

  it('re-applies after content changes back to an earlier value', () => {
    const watcher = createMockWatcher();
    const store = new ReactiveConfigStore(watcher, createMockFs());
    const applies = [];
    store.register('test', '/cfg/test.json', { apply: (cfg) => applies.push(cfg) });

    watcher.simulateChange('/cfg/test.json', changeEvent('/cfg/test.json', { a: 1 }));
    watcher.simulateChange('/cfg/test.json', changeEvent('/cfg/test.json', { a: 2 }));
    watcher.simulateChange('/cfg/test.json', changeEvent('/cfg/test.json', { a: 1 }));
    assert.equal(applies.length, 3);
  });

  it('does not record dedupe key when apply throws', () => {
    const watcher = createMockWatcher();
    const store = new ReactiveConfigStore(watcher, createMockFs());
    let shouldThrow = true;
    const applies = [];
    store.register('test', '/cfg/test.json', {
      apply: (cfg) => {
        if (shouldThrow) throw new Error('boom');
        applies.push(cfg);
      },
    });

    watcher.simulateChange('/cfg/test.json', changeEvent('/cfg/test.json', { a: 1 }));
    shouldThrow = false;
    // Same content again — must retry because the first apply failed
    watcher.simulateChange('/cfg/test.json', changeEvent('/cfg/test.json', { a: 1 }));
    assert.equal(applies.length, 1);
  });
});
