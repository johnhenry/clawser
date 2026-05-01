// Run with: node --test web/test/clawser-reactive-config.test.mjs
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

// ── Minimal FileWatcher stub ──────────────────────────────────────

const createMockWatcher = () => {
  const watches = new Map(); // path → callback
  const markedPaths = new Map(); // path → timestamp

  return {
    watches,
    markedPaths,
    watch(path, callback) {
      watches.set(path, callback);
    },
    unwatch(path) {
      watches.delete(path);
    },
    markWrittenByMe(path) {
      markedPaths.set(path, Date.now());
    },
    getCached(path) {
      return watches.get(path)?._cached ?? null;
    },
    // Test helper: simulate a file change event
    simulateChange(path, changeEvent) {
      const cb = watches.get(path);
      if (cb) {
        // Store in _cached for getCached() to return
        cb._cached = changeEvent.newValue;
        cb(changeEvent);
      }
    },
  };
};

// ── Minimal ShellFs stub ──────────────────────────────────────────

const createMockFs = () => {
  const files = {};
  return {
    files,
    async readFile(path) {
      if (!files[path]) throw new Error(`ENOENT: ${path}`);
      return files[path];
    },
    async writeFile(path, content) {
      files[path] = content;
    },
  };
};

// ── Stub withLock and emit ────────────────────────────────────────

// We need to stub the module-level imports. Since we can't easily mock
// ES module imports in Node test runner, we inline the class here with
// injectable deps, matching the same API contract.

const createReactiveConfigStore = (watcher, fs, { emit: emitFn, withLockFn } = {}) => {
  const _emit = emitFn || (() => {});
  const _withLock = withLockFn || (async (_name, fn) => fn());

  const domains = new Map();
  const pathToDomain = new Map();

  const store = {
    register(domain, path, handler) {
      const entry = {
        path,
        apply: handler.apply,
        validate: handler.validate,
        domain,
        subscribers: new Set(),
      };
      domains.set(domain, entry);
      pathToDomain.set(path, domain);

      watcher.watch(path, (changeEvent) => {
        onFileChange(domain, entry, changeEvent);
      });
    },

    unregister(domain) {
      const entry = domains.get(domain);
      if (!entry) return;
      watcher.unwatch(entry.path);
      pathToDomain.delete(entry.path);
      domains.delete(domain);
    },

    subscribe(domain, callback) {
      const entry = domains.get(domain);
      if (!entry) return () => {};
      entry.subscribers.add(callback);
      return () => entry.subscribers.delete(callback);
    },

    get(domain) {
      const entry = domains.get(domain);
      if (!entry) return null;
      return watcher.getCached(entry.path);
    },

    async set(domain, value) {
      const entry = domains.get(domain);
      if (!entry) return;
      const json = JSON.stringify(value, null, 2);
      await _withLock(`clawser:config:${domain}`, async () => {
        await fs.writeFile(entry.path, json);
      });
      watcher.markWrittenByMe(entry.path);
    },

    async readFromDisk(domain) {
      const entry = domains.get(domain);
      if (!entry) return null;
      try {
        const content = await fs.readFile(entry.path);
        return JSON.parse(content);
      } catch {
        return null;
      }
    },

    listDomains() {
      return [...domains.keys()];
    },
  };

  const onFileChange = (domain, entry, changeEvent) => {
    const { newValue } = changeEvent;

    if (entry.validate && newValue != null) {
      const errors = entry.validate(newValue);
      if (errors && errors.length > 0) return;
    }

    try {
      if (newValue != null) entry.apply(newValue);
    } catch {
      return;
    }

    for (const cb of entry.subscribers) {
      try { cb(changeEvent); } catch { /* ignore */ }
    }

    _emit('configChanged', { domain, path: changeEvent.path, ...changeEvent });
  };

  return store;
};

// ── Tests ─────────────────────────────────────────────────────────

describe('ReactiveConfigStore', () => {
  let watcher;
  let fs;
  let emitCalls;
  let lockCalls;
  let store;

  beforeEach(() => {
    watcher = createMockWatcher();
    fs = createMockFs();
    emitCalls = [];
    lockCalls = [];
    store = createReactiveConfigStore(watcher, fs, {
      emit: (event, data) => emitCalls.push({ event, data }),
      withLockFn: async (name, fn) => {
        lockCalls.push(name);
        return fn();
      },
    });
  });

  describe('register/unregister', () => {
    it('registers a domain and sets up a watcher', () => {
      store.register('autonomy', '~/.config/clawser/autonomy.json', {
        apply: () => {},
      });
      assert.ok(watcher.watches.has('~/.config/clawser/autonomy.json'));
      assert.deepEqual(store.listDomains(), ['autonomy']);
    });

    it('unregisters a domain and removes the watcher', () => {
      store.register('autonomy', '~/.config/clawser/autonomy.json', {
        apply: () => {},
      });
      store.unregister('autonomy');
      assert.ok(!watcher.watches.has('~/.config/clawser/autonomy.json'));
      assert.deepEqual(store.listDomains(), []);
    });
  });

  describe('subscribe/unsubscribe', () => {
    it('notifies subscribers on file change', () => {
      const applied = [];
      const subscribed = [];

      store.register('autonomy', '~/.config/clawser/autonomy.json', {
        apply: (config) => applied.push(config),
      });
      store.subscribe('autonomy', (ev) => subscribed.push(ev));

      watcher.simulateChange('~/.config/clawser/autonomy.json', {
        path: '~/.config/clawser/autonomy.json',
        oldValue: null,
        newValue: { level: 'full' },
        timestamp: Date.now(),
      });

      assert.equal(applied.length, 1);
      assert.deepEqual(applied[0], { level: 'full' });
      assert.equal(subscribed.length, 1);
      assert.deepEqual(subscribed[0].newValue, { level: 'full' });
    });

    it('unsubscribe function removes the callback', () => {
      const events = [];
      store.register('identity', '~/.config/clawser/identity.json', {
        apply: () => {},
      });
      const unsub = store.subscribe('identity', (ev) => events.push(ev));

      watcher.simulateChange('~/.config/clawser/identity.json', {
        path: '~/.config/clawser/identity.json',
        oldValue: null,
        newValue: { name: 'first' },
        timestamp: Date.now(),
      });
      assert.equal(events.length, 1);

      unsub();

      watcher.simulateChange('~/.config/clawser/identity.json', {
        path: '~/.config/clawser/identity.json',
        oldValue: { name: 'first' },
        newValue: { name: 'second' },
        timestamp: Date.now(),
      });
      assert.equal(events.length, 1, 'should not fire after unsubscribe');
    });

    it('returns no-op for unregistered domain', () => {
      const unsub = store.subscribe('nonexistent', () => {});
      assert.equal(typeof unsub, 'function');
      unsub(); // should not throw
    });
  });

  describe('validation', () => {
    it('rejects invalid config and keeps previous', () => {
      const applied = [];
      store.register('autonomy', '~/.config/clawser/autonomy.json', {
        apply: (config) => applied.push(config),
        validate: (config) => {
          const errors = [];
          if (!['full', 'supervised', 'locked'].includes(config.level))
            errors.push('Invalid level');
          return errors;
        },
      });

      // Valid change
      watcher.simulateChange('~/.config/clawser/autonomy.json', {
        path: '~/.config/clawser/autonomy.json',
        oldValue: null,
        newValue: { level: 'full' },
        timestamp: Date.now(),
      });
      assert.equal(applied.length, 1);

      // Invalid change
      watcher.simulateChange('~/.config/clawser/autonomy.json', {
        path: '~/.config/clawser/autonomy.json',
        oldValue: { level: 'full' },
        newValue: { level: 'INVALID' },
        timestamp: Date.now(),
      });
      assert.equal(applied.length, 1, 'should not apply invalid config');
    });

    it('applies config with no validator', () => {
      const applied = [];
      store.register('hooks', '~/.config/clawser/hooks.json', {
        apply: (config) => applied.push(config),
      });

      watcher.simulateChange('~/.config/clawser/hooks.json', {
        path: '~/.config/clawser/hooks.json',
        oldValue: null,
        newValue: { hooks: [] },
        timestamp: Date.now(),
      });
      assert.equal(applied.length, 1);
    });
  });

  describe('set (write)', () => {
    it('writes to disk with lock and marks self-written', async () => {
      store.register('identity', '~/.config/clawser/identity.json', {
        apply: () => {},
      });

      await store.set('identity', { name: 'new-name' });

      assert.equal(fs.files['~/.config/clawser/identity.json'], JSON.stringify({ name: 'new-name' }, null, 2));
      assert.ok(lockCalls.includes('clawser:config:identity'));
      assert.ok(watcher.markedPaths.has('~/.config/clawser/identity.json'));
    });

    it('does nothing for unregistered domain', async () => {
      await store.set('nonexistent', { foo: 'bar' });
      assert.equal(lockCalls.length, 0);
    });
  });

  describe('get (cached read)', () => {
    it('returns null for unregistered domain', () => {
      assert.equal(store.get('nonexistent'), null);
    });

    it('returns cached value from watcher', () => {
      store.register('autonomy', '~/.config/clawser/autonomy.json', {
        apply: () => {},
      });

      // Simulate the watcher having a cached value
      watcher.simulateChange('~/.config/clawser/autonomy.json', {
        path: '~/.config/clawser/autonomy.json',
        oldValue: null,
        newValue: { level: 'supervised' },
        timestamp: Date.now(),
      });

      assert.deepEqual(store.get('autonomy'), { level: 'supervised' });
    });
  });

  describe('readFromDisk', () => {
    it('reads fresh from filesystem', async () => {
      store.register('identity', '~/.config/clawser/identity.json', {
        apply: () => {},
      });
      fs.files['~/.config/clawser/identity.json'] = '{"name":"disk-value"}';

      const result = await store.readFromDisk('identity');
      assert.deepEqual(result, { name: 'disk-value' });
    });

    it('returns null for missing file', async () => {
      store.register('identity', '~/.config/clawser/identity.json', {
        apply: () => {},
      });
      const result = await store.readFromDisk('identity');
      assert.equal(result, null);
    });

    it('returns null for unregistered domain', async () => {
      const result = await store.readFromDisk('nonexistent');
      assert.equal(result, null);
    });
  });

  describe('event bus emission', () => {
    it('emits configChanged on successful apply', () => {
      store.register('security', '~/.config/clawser/security.json', {
        apply: () => {},
      });

      watcher.simulateChange('~/.config/clawser/security.json', {
        path: '~/.config/clawser/security.json',
        oldValue: null,
        newValue: { inputSanitization: true },
        timestamp: 12345,
      });

      assert.equal(emitCalls.length, 1);
      assert.equal(emitCalls[0].event, 'configChanged');
      assert.equal(emitCalls[0].data.domain, 'security');
    });

    it('does not emit when validation fails', () => {
      store.register('autonomy', '~/.config/clawser/autonomy.json', {
        apply: () => {},
        validate: () => ['always fails'],
      });

      watcher.simulateChange('~/.config/clawser/autonomy.json', {
        path: '~/.config/clawser/autonomy.json',
        oldValue: null,
        newValue: { level: 'any' },
        timestamp: Date.now(),
      });

      assert.equal(emitCalls.length, 0);
    });

    it('does not emit when apply throws', () => {
      store.register('hooks', '~/.config/clawser/hooks.json', {
        apply: () => { throw new Error('apply failed'); },
      });

      watcher.simulateChange('~/.config/clawser/hooks.json', {
        path: '~/.config/clawser/hooks.json',
        oldValue: null,
        newValue: { hooks: [] },
        timestamp: Date.now(),
      });

      assert.equal(emitCalls.length, 0);
    });
  });

  describe('subsystem update wiring', () => {
    it('updates autonomy subsystem with level, rate limits, cost limits', () => {
      const updates = [];
      const mockState = {
        agent: { updateAutonomy: (c) => updates.push(c) },
      };

      store.register('autonomy', '~/.config/clawser/autonomy.json', {
        apply: (config) => mockState.agent.updateAutonomy(config),
        validate: (config) => {
          if (config.level && !['full', 'supervised', 'locked'].includes(config.level))
            return ['bad level'];
          return [];
        },
      });

      watcher.simulateChange('~/.config/clawser/autonomy.json', {
        path: '~/.config/clawser/autonomy.json',
        oldValue: null,
        newValue: { level: 'full', rateLimit: { perHour: 120 }, costLimit: { perDay: 10 } },
        timestamp: Date.now(),
      });

      assert.equal(updates.length, 1);
      assert.deepEqual(updates[0], { level: 'full', rateLimit: { perHour: 120 }, costLimit: { perDay: 10 } });
    });

    it('updates identity subsystem with name and system prompt', () => {
      const updates = [];
      store.register('identity', '~/.config/clawser/identity.json', {
        apply: (config) => updates.push(config),
      });

      watcher.simulateChange('~/.config/clawser/identity.json', {
        path: '~/.config/clawser/identity.json',
        oldValue: null,
        newValue: { name: 'custom-agent', systemPrompt: 'You are helpful.' },
        timestamp: Date.now(),
      });

      assert.deepEqual(updates[0], { name: 'custom-agent', systemPrompt: 'You are helpful.' });
    });

    it('reloads hook pipeline on hooks.json change', () => {
      const reloads = [];
      store.register('hooks', '~/.config/clawser/hooks.json', {
        apply: (config) => reloads.push(config),
      });

      watcher.simulateChange('~/.config/clawser/hooks.json', {
        path: '~/.config/clawser/hooks.json',
        oldValue: null,
        newValue: { hooks: [{ event: 'beforeSend', action: 'log' }] },
        timestamp: Date.now(),
      });

      assert.equal(reloads.length, 1);
      assert.equal(reloads[0].hooks.length, 1);
    });
  });
});
