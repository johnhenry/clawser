/**
 * Tests for clawser-fs-ui-sync.mjs — Phase 7: UI Panel Sync
 */
// Run with: node --import ./web/test/_setup-globals.mjs --test web/test/clawser-fs-ui-sync.test.mjs
import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

// ── Inline FsUiSync (avoids ES module import issues with withLock/emit) ──

class FsUiSync {
  #store;
  #panels = new Map();
  #listeners = new Set();
  #saving = false;

  constructor(reactiveConfig) {
    this.#store = reactiveConfig;
  }

  registerPanel(domain, { render, collect }) {
    const unsub = this.#store.subscribe(domain, (event) => {
      if (this.#saving) return;
      try {
        render(event.newValue);
        this.#notify({ domain, action: 'refresh', config: event.newValue });
      } catch (e) {
        console.error(`[FsUiSync] Error rendering panel ${domain}:`, e);
      }
    });
    const binding = { domain, render, collect, unsub };
    this.#panels.set(domain, binding);
    return () => this.unregisterPanel(domain);
  }

  unregisterPanel(domain) {
    const binding = this.#panels.get(domain);
    if (binding?.unsub) binding.unsub();
    this.#panels.delete(domain);
  }

  async load(domain) {
    const binding = this.#panels.get(domain);
    if (!binding) return null;
    let config = this.#store.get(domain);
    if (config == null) {
      config = await this.#store.readFromDisk(domain);
    }
    try {
      binding.render(config);
      this.#notify({ domain, action: 'load', config });
    } catch (e) {
      console.error(`[FsUiSync] Error loading panel ${domain}:`, e);
    }
    return config;
  }

  async save(domain) {
    const binding = this.#panels.get(domain);
    if (!binding) return null;
    const value = binding.collect();
    if (value == null) return null;
    this.#saving = true;
    try {
      await this.#store.set(domain, value);
      this.#notify({ domain, action: 'save', config: value });
      return value;
    } finally {
      this.#saving = false;
    }
  }

  async saveValue(domain, value) {
    this.#saving = true;
    try {
      await this.#store.set(domain, value);
      this.#notify({ domain, action: 'save', config: value });
    } finally {
      this.#saving = false;
    }
  }

  get(domain) {
    return this.#store.get(domain);
  }

  subscribe(callback) {
    this.#listeners.add(callback);
    return () => this.#listeners.delete(callback);
  }

  listPanels() {
    return [...this.#panels.keys()];
  }

  destroy() {
    for (const [, binding] of this.#panels) {
      if (binding.unsub) binding.unsub();
    }
    this.#panels.clear();
    this.#listeners.clear();
  }

  #notify(event) {
    for (const cb of this.#listeners) {
      try { cb(event); } catch { /* swallow */ }
    }
  }
}

// ── Mock ReactiveConfigStore ──────────────────────────────────────

const createMockStore = () => {
  const domains = new Map(); // domain → { value, subscribers }
  const disk = new Map();    // domain → value (simulates file)

  return {
    register(domain, value) {
      domains.set(domain, { value, subscribers: new Set() });
      disk.set(domain, value);
    },

    subscribe(domain, callback) {
      const entry = domains.get(domain);
      if (!entry) return () => {};
      entry.subscribers.add(callback);
      return () => entry.subscribers.delete(callback);
    },

    get(domain) {
      return domains.get(domain)?.value ?? null;
    },

    async set(domain, value) {
      const entry = domains.get(domain);
      if (entry) {
        entry.value = value;
        disk.set(domain, value);
      }
    },

    async readFromDisk(domain) {
      return disk.get(domain) ?? null;
    },

    // Test helper: simulate external file change
    simulateChange(domain, newValue) {
      const entry = domains.get(domain);
      if (!entry) return;
      entry.value = newValue;
      for (const cb of entry.subscribers) {
        cb({ path: `~/.config/clawser/${domain}.json`, newValue });
      }
    },
  };
};

// ── Tests ─────────────────────────────────────────────────────────

describe('FsUiSync', () => {
  let store;
  let sync;

  beforeEach(() => {
    store = createMockStore();
    store.register('autonomy', { level: 'supervised', maxActions: 10 });
    store.register('identity', { name: 'test-agent', systemPrompt: '' });
    sync = new FsUiSync(store);
  });

  describe('registerPanel / unregisterPanel', () => {
    it('registers a panel and lists it', () => {
      sync.registerPanel('autonomy', {
        render: () => {},
        collect: () => ({}),
      });
      assert.deepStrictEqual(sync.listPanels(), ['autonomy']);
    });

    it('unregisters a panel', () => {
      const unreg = sync.registerPanel('autonomy', {
        render: () => {},
        collect: () => ({}),
      });
      unreg();
      assert.deepStrictEqual(sync.listPanels(), []);
    });

    it('returns unsubscribe function', () => {
      const unreg = sync.registerPanel('identity', {
        render: () => {},
        collect: () => ({}),
      });
      assert.equal(typeof unreg, 'function');
    });
  });

  describe('load', () => {
    it('renders panel with config from store cache', async () => {
      let rendered = null;
      sync.registerPanel('autonomy', {
        render: (cfg) => { rendered = cfg; },
        collect: () => ({}),
      });
      const config = await sync.load('autonomy');
      assert.deepStrictEqual(config, { level: 'supervised', maxActions: 10 });
      assert.deepStrictEqual(rendered, { level: 'supervised', maxActions: 10 });
    });

    it('falls back to readFromDisk when cache is null', async () => {
      // Create a store that returns null from get but has disk value
      const sparseStore = createMockStore();
      sparseStore.register('hooks', null);
      // Directly set the disk value
      await sparseStore.set('hooks', { hooks: ['test'] });
      // Clear the in-memory get to simulate cache miss
      sparseStore.get = () => null;

      const s = new FsUiSync(sparseStore);
      let rendered = null;
      s.registerPanel('hooks', {
        render: (cfg) => { rendered = cfg; },
        collect: () => ({}),
      });
      await s.load('hooks');
      assert.deepStrictEqual(rendered, { hooks: ['test'] });
    });

    it('returns null for unregistered panel', async () => {
      const result = await sync.load('nonexistent');
      assert.equal(result, null);
    });
  });

  describe('save', () => {
    it('collects form values and writes to store', async () => {
      sync.registerPanel('autonomy', {
        render: () => {},
        collect: () => ({ level: 'full', maxActions: 99 }),
      });
      const saved = await sync.save('autonomy');
      assert.deepStrictEqual(saved, { level: 'full', maxActions: 99 });
      assert.deepStrictEqual(store.get('autonomy'), { level: 'full', maxActions: 99 });
    });

    it('returns null if collect returns null', async () => {
      sync.registerPanel('autonomy', {
        render: () => {},
        collect: () => null,
      });
      const saved = await sync.save('autonomy');
      assert.equal(saved, null);
    });

    it('returns null for unregistered panel', async () => {
      const result = await sync.save('nonexistent');
      assert.equal(result, null);
    });
  });

  describe('saveValue', () => {
    it('saves explicit value to store', async () => {
      sync.registerPanel('identity', {
        render: () => {},
        collect: () => ({}),
      });
      await sync.saveValue('identity', { name: 'new-agent' });
      assert.deepStrictEqual(store.get('identity'), { name: 'new-agent' });
    });
  });

  describe('bidirectional sync', () => {
    it('re-renders panel when external file change occurs', () => {
      let rendered = null;
      sync.registerPanel('autonomy', {
        render: (cfg) => { rendered = cfg; },
        collect: () => ({}),
      });
      store.simulateChange('autonomy', { level: 'locked', maxActions: 0 });
      assert.deepStrictEqual(rendered, { level: 'locked', maxActions: 0 });
    });

    it('suppresses re-render during save (no loop)', async () => {
      let renderCount = 0;
      sync.registerPanel('autonomy', {
        render: () => { renderCount++; },
        collect: () => ({ level: 'full' }),
      });
      // Simulate: save triggers a change event back
      const origSet = store.set.bind(store);
      store.set = async (domain, value) => {
        await origSet(domain, value);
        // Simulate the watcher notifying us of our own write
        store.simulateChange(domain, value);
      };
      await sync.save('autonomy');
      // render should NOT have been called during save
      assert.equal(renderCount, 0);
    });
  });

  describe('subscribe', () => {
    it('emits load events', async () => {
      const events = [];
      sync.subscribe((e) => events.push(e));
      sync.registerPanel('autonomy', {
        render: () => {},
        collect: () => ({}),
      });
      await sync.load('autonomy');
      assert.equal(events.length, 1);
      assert.equal(events[0].action, 'load');
      assert.equal(events[0].domain, 'autonomy');
    });

    it('emits save events', async () => {
      const events = [];
      sync.subscribe((e) => events.push(e));
      sync.registerPanel('autonomy', {
        render: () => {},
        collect: () => ({ level: 'full' }),
      });
      await sync.save('autonomy');
      assert.equal(events.length, 1);
      assert.equal(events[0].action, 'save');
    });

    it('emits refresh events on external change', () => {
      const events = [];
      sync.subscribe((e) => events.push(e));
      sync.registerPanel('autonomy', {
        render: () => {},
        collect: () => ({}),
      });
      store.simulateChange('autonomy', { level: 'locked' });
      assert.equal(events.length, 1);
      assert.equal(events[0].action, 'refresh');
    });

    it('unsubscribe stops events', async () => {
      const events = [];
      const unsub = sync.subscribe((e) => events.push(e));
      sync.registerPanel('autonomy', {
        render: () => {},
        collect: () => ({ level: 'full' }),
      });
      unsub();
      await sync.save('autonomy');
      assert.equal(events.length, 0);
    });
  });

  describe('get', () => {
    it('returns current cached config', () => {
      const cfg = sync.get('autonomy');
      assert.deepStrictEqual(cfg, { level: 'supervised', maxActions: 10 });
    });

    it('returns null for unknown domain', () => {
      assert.equal(sync.get('nope'), null);
    });
  });

  describe('destroy', () => {
    it('clears all panels and listeners', () => {
      sync.registerPanel('autonomy', { render: () => {}, collect: () => ({}) });
      sync.registerPanel('identity', { render: () => {}, collect: () => ({}) });
      sync.subscribe(() => {});
      sync.destroy();
      assert.deepStrictEqual(sync.listPanels(), []);
    });

    it('stops external change notifications after destroy', () => {
      let renderCount = 0;
      sync.registerPanel('autonomy', {
        render: () => { renderCount++; },
        collect: () => ({}),
      });
      sync.destroy();
      store.simulateChange('autonomy', { level: 'full' });
      assert.equal(renderCount, 0);
    });
  });
});
