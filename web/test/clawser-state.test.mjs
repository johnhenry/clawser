// Run with: node --import ./web/test/_setup-globals.mjs --test web/test/clawser-state.test.mjs
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import {
  DEFAULTS,
  esc,
  lsKey,
  on,
  off,
  emit,
  listEvents,
  ConfigCache,
  state,
  setSending,
  setConversation,
  resetConversationState,
  migrateLocalStorageKeys,
} from '../clawser-state.js';

// ── DEFAULTS ────────────────────────────────────────────────────

describe('DEFAULTS', () => {
  it('contains expected keys with numeric values', () => {
    assert.equal(typeof DEFAULTS.maxResultLength, 'number');
    assert.equal(typeof DEFAULTS.maxHistoryTokens, 'number');
    assert.equal(typeof DEFAULTS.maxTokens, 'number');
    assert.equal(typeof DEFAULTS.costTrackingPrecision, 'number');
    assert.equal(typeof DEFAULTS.maxToolIterations, 'number');
  });

  it('is frozen', () => {
    assert.ok(Object.isFrozen(DEFAULTS));
  });

  it('has reasonable default values', () => {
    assert.equal(DEFAULTS.maxTokens, 4096);
    assert.equal(DEFAULTS.maxToolIterations, 20);
    assert.equal(DEFAULTS.debugMode, false);
  });
});

// ── esc() ───────────────────────────────────────────────────────

describe('esc', () => {
  it('escapes < > & "', () => {
    assert.equal(esc('<b>"test"</b> & more'), '&lt;b&gt;&quot;test&quot;&lt;/b&gt; &amp; more');
  });

  it('returns unchanged string with no special chars', () => {
    assert.equal(esc('hello world'), 'hello world');
  });

  it('handles empty string', () => {
    assert.equal(esc(''), '');
  });
});

// ── lsKey ───────────────────────────────────────────────────────

describe('lsKey', () => {
  it('memories returns versioned key', () => {
    assert.ok(lsKey.memories('default').includes('v1'));
    assert.ok(lsKey.memories('default').includes('memories'));
    assert.ok(lsKey.memories('default').includes('default'));
  });

  it('config returns versioned key', () => {
    assert.ok(lsKey.config('ws1').includes('config'));
    assert.ok(lsKey.config('ws1').includes('ws1'));
  });

  it('all key builders return strings', () => {
    const fns = [lsKey.memories, lsKey.config, lsKey.toolPerms, lsKey.security,
                 lsKey.skillsEnabled, lsKey.autonomy, lsKey.identity, lsKey.selfRepair,
                 lsKey.sandbox, lsKey.heartbeat, lsKey.routines, lsKey.termSessions,
                 lsKey.hooks, lsKey.peripherals];
    for (const fn of fns) {
      assert.equal(typeof fn('test'), 'string');
    }
  });

  it('hooks returns versioned workspace-scoped key', () => {
    const key = lsKey.hooks('ws42');
    assert.ok(key.includes('v1'), 'should include version prefix');
    assert.ok(key.includes('hooks'), 'should include hooks');
    assert.ok(key.includes('ws42'), 'should include workspace id');
  });

  it('peripherals returns versioned workspace-scoped key', () => {
    const key = lsKey.peripherals('ws99');
    assert.ok(key.includes('v1'), 'should include version prefix');
    assert.ok(key.includes('peripherals'), 'should include peripherals');
    assert.ok(key.includes('ws99'), 'should include workspace id');
  });
});

// ── Event bus ───────────────────────────────────────────────────

describe('Event bus', () => {
  const topic = '__test_topic_' + Date.now();

  afterEach(() => {
    // Clean up listeners
    const events = listEvents();
    for (const e of events) {
      if (e.startsWith('__test_')) {
        // Can't easily remove all, but tests create fresh listeners
      }
    }
  });

  it('on/emit fires listeners', () => {
    let received = null;
    const fn = (data) => { received = data; };
    on(topic, fn);
    emit(topic, 'payload');
    assert.equal(received, 'payload');
    off(topic, fn);
  });

  it('off removes a listener', () => {
    let count = 0;
    const fn = () => { count++; };
    const topic2 = topic + '_off';
    on(topic2, fn);
    emit(topic2);
    assert.equal(count, 1);
    off(topic2, fn);
    emit(topic2);
    assert.equal(count, 1);
  });

  it('emit catches listener errors without throwing', () => {
    const topic3 = topic + '_err';
    const fn = () => { throw new Error('boom'); };
    on(topic3, fn);
    assert.doesNotThrow(() => emit(topic3));
    off(topic3, fn);
  });

  it('listEvents returns active event names', () => {
    const topic4 = topic + '_list';
    const fn = () => {};
    on(topic4, fn);
    const events = listEvents();
    assert.ok(events.includes(topic4));
    off(topic4, fn);
  });

  it('emit forwards multiple arguments', () => {
    let args;
    const topic5 = topic + '_args';
    const fn = (...a) => { args = a; };
    on(topic5, fn);
    emit(topic5, 1, 2, 3);
    assert.deepEqual(args, [1, 2, 3]);
    off(topic5, fn);
  });
});

// ── ConfigCache ─────────────────────────────────────────────────

describe('ConfigCache', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('get returns null for missing key', () => {
    const cache = new ConfigCache(0);
    assert.equal(cache.get('nonexistent'), null);
  });

  it('set + flush + get round-trips', () => {
    const cache = new ConfigCache(0);
    cache.set('test_key', 'test_value');
    cache.flush();
    assert.equal(localStorage.getItem('test_key'), 'test_value');
    // Fresh cache reads from localStorage
    const cache2 = new ConfigCache(0);
    assert.equal(cache2.get('test_key'), 'test_value');
  });

  it('remove sets value to null and removes from localStorage', () => {
    const cache = new ConfigCache(0);
    localStorage.setItem('rm_key', 'val');
    cache.remove('rm_key');
    cache.flush();
    assert.equal(localStorage.getItem('rm_key'), null);
  });

  it('invalidate forces re-read from localStorage', () => {
    const cache = new ConfigCache(0);
    cache.set('inv_key', 'old');
    cache.flush();
    localStorage.setItem('inv_key', 'external');
    cache.invalidate('inv_key');
    assert.equal(cache.get('inv_key'), 'external');
  });

  it('clear empties cache and dirty set', () => {
    const cache = new ConfigCache(0);
    cache.set('a', '1');
    cache.set('b', '2');
    cache.clear();
    // After clear, get lazy-loads from localStorage (which doesn't have unflushed values)
    assert.equal(cache.get('a'), null);
  });

  it('lazy-loads from localStorage on first get', () => {
    localStorage.setItem('lazy_key', 'lazy_val');
    const cache = new ConfigCache(0);
    assert.equal(cache.get('lazy_key'), 'lazy_val');
  });
});

// ── state object ────────────────────────────────────────────────

describe('state', () => {
  it('has expected namespace structure', () => {
    assert.ok(state.ui);
    assert.ok(state.services);
    assert.ok(state.features);
    assert.ok(state.session);
  });

  it('state.ui.isSending is a boolean', () => {
    assert.equal(typeof state.ui.isSending, 'boolean');
  });
});

// ── setSending ──────────────────────────────────────────────────

describe('setSending', () => {
  it('updates state.ui.isSending', () => {
    setSending(true);
    assert.equal(state.ui.isSending, true);
    setSending(false);
    assert.equal(state.ui.isSending, false);
  });

  it('coerces to boolean', () => {
    setSending(1);
    assert.equal(state.ui.isSending, true);
    setSending(0);
    assert.equal(state.ui.isSending, false);
    setSending(null);
    assert.equal(state.ui.isSending, false);
  });
});

// ── setConversation ─────────────────────────────────────────────

describe('setConversation', () => {
  it('sets active conversation id and name', () => {
    setConversation('conv1', 'My Chat');
    assert.equal(state.session.activeConversationId, 'conv1');
    assert.equal(state.session.activeConversationName, 'My Chat');
  });

  it('emits conversationChanged event', () => {
    let emitted = null;
    const fn = (data) => { emitted = data; };
    on('conversationChanged', fn);
    setConversation('conv2', 'Chat 2');
    assert.deepEqual(emitted, { id: 'conv2', name: 'Chat 2' });
    off('conversationChanged', fn);
  });
});

// ── migrateLocalStorageKeys ─────────────────────────────────────

describe('migrateLocalStorageKeys', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('is idempotent', () => {
    migrateLocalStorageKeys();
    migrateLocalStorageKeys();
    assert.equal(localStorage.getItem('clawser_ls_migrated'), 'v1');
  });

  it('sets migration flag', () => {
    migrateLocalStorageKeys();
    assert.equal(localStorage.getItem('clawser_ls_migrated'), 'v1');
  });
});
