// Run with: node --import ./web/test/_setup-globals.mjs --test web/test/clawser-snapshots.test.mjs
import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import {
  collectState,
  applyState,
  SNAPSHOT_VERSION,
  SnapshotManager,
} from '../clawser-snapshots.js';

// ── Helpers ────────────────────────────────────────────────────

/** Minimal EventLog mock */
const makeEventLog = (events = []) => {
  let _events = [...events];
  return {
    events: _events,
    toJSONL() {
      return _events.map(e => JSON.stringify(e)).join('\n');
    },
    clear() { _events.length = 0; },
    load(newEvents) { _events.push(...newEvents); },
    constructor: {
      fromJSONL(text) {
        if (!text) return null;
        const parsed = text.split('\n').filter(Boolean).map(l => JSON.parse(l));
        const log = makeEventLog(parsed);
        return log;
      },
    },
  };
};

/** Minimal agent mock */
const makeAgent = (overrides = {}) => {
  const eventLog = overrides.eventLog || makeEventLog([
    { id: 1, type: 'user_message', data: { content: 'hello' }, timestamp: 1000 },
    { id: 2, type: 'agent_message', data: { content: 'hi' }, timestamp: 2000 },
  ]);

  const memories = overrides.memories || [
    { id: 'm1', key: 'test', content: 'memory content', category: 'general', timestamp: 1000 },
  ];

  const checkpoint = overrides.checkpoint || {
    id: 'cp1',
    timestamp: Date.now(),
    agent_state: 'idle',
    session_history: [{ role: 'user', content: 'hello' }],
    active_goals: [{ id: 'g1', description: 'test goal', status: 'active' }],
    scheduler_snapshot: [],
    version: 1,
  };

  const config = overrides.config || { model: 'test-model', systemPrompt: 'You are helpful.' };
  let _model = config.model;
  let _prompt = config.systemPrompt;
  let _restored = false;

  return {
    getEventLog: () => eventLog,
    eventLog,
    getCheckpointJSON: () => checkpoint,
    memory: {
      exportToFlatArray: () => [...memories],
      importFromFlatArray: (entries) => { memories.length = 0; memories.push(...entries); return entries.length; },
      clear: () => { memories.length = 0; },
    },
    getConfig: () => ({ model: _model, systemPrompt: _prompt }),
    setModel: (m) => { _model = m; },
    setSystemPrompt: (p) => { _prompt = p; },
    getWorkspace: () => overrides.wsId || 'test-ws',
    restore: (bytes) => {
      _restored = true;
      return 0;
    },
    hooks: overrides.hooks || {
      serialize: () => ({ hooks: [{ name: 'testHook', point: 'pre_send', priority: 0, enabled: true }] }),
    },
    get _wasRestored() { return _restored; },
  };
};

/** Minimal shell mock */
const makeShell = (overrides = {}) => {
  const env = new Map(Object.entries(overrides.env || { HOME: '/home', TERM: 'xterm' }));
  const aliases = new Map(Object.entries(overrides.aliases || { ll: 'ls -la' }));
  return {
    state: {
      cwd: overrides.cwd || '/workspace/project',
      env,
      history: overrides.history || ['ls', 'cd /tmp', 'echo hi'],
      aliases,
      lastExitCode: overrides.lastExitCode ?? 0,
    },
  };
};

/** Minimal routine engine mock */
const makeRoutineEngine = (overrides = {}) => {
  let _data = overrides.data || {
    routines: [{ id: 'r1', name: 'Cleanup', trigger: { type: 'interval' } }],
    lastTickTime: 123456,
    healthMetrics: {},
  };
  return {
    toJSON: () => ({ ..._data }),
    fromJSON: (data) => { _data = data; },
    get data() { return _data; },
  };
};

/** Minimal skill registry mock */
const makeSkillRegistry = (activeSkills = ['code-review', 'refactor']) => {
  const map = new Map(activeSkills.map(s => [s, true]));
  return {
    activeSkills: map,
    activate: (name) => map.set(name, true),
  };
};

// ── collectState ───────────────────────────────────────────────

describe('collectState', () => {
  it('collects all subsystem state into a single object', () => {
    const agent = makeAgent();
    const shell = makeShell();
    const routineEngine = makeRoutineEngine();
    const skillRegistry = makeSkillRegistry();

    const snapshot = collectState({ agent, shell, routineEngine, skillRegistry, wsId: 'ws1' });

    assert.equal(snapshot.version, SNAPSHOT_VERSION);
    assert.equal(snapshot.wsId, 'ws1');
    assert.ok(snapshot.eventLog.length > 0, 'eventLog should be non-empty JSONL');
    assert.ok(snapshot.checkpoint, 'checkpoint should be present');
    assert.equal(snapshot.memories.length, 1);
    assert.equal(snapshot.config.model, 'test-model');
    assert.ok(snapshot.routines, 'routines should be present');
    assert.equal(snapshot.shell.cwd, '/workspace/project');
    assert.deepEqual(snapshot.shell.env, { HOME: '/home', TERM: 'xterm' });
    assert.deepEqual(snapshot.shell.aliases, { ll: 'ls -la' });
    assert.deepEqual(snapshot.shell.history, ['ls', 'cd /tmp', 'echo hi']);
    assert.deepEqual(snapshot.skillActivations, ['code-review', 'refactor']);
    assert.ok(snapshot.hooks, 'hooks should be serialized');
  });

  it('handles null/missing subsystems gracefully', () => {
    const snapshot = collectState({ agent: null, shell: null, routineEngine: null });

    assert.equal(snapshot.version, SNAPSHOT_VERSION);
    assert.equal(snapshot.eventLog, '');
    assert.equal(snapshot.checkpoint, null);
    assert.deepEqual(snapshot.memories, []);
    assert.deepEqual(snapshot.config, {});
    assert.equal(snapshot.routines, null);
    assert.equal(snapshot.shell, null);
    assert.deepEqual(snapshot.skillActivations, []);
  });

  it('uses agent workspace when wsId not provided', () => {
    const agent = makeAgent({ wsId: 'agent-ws' });
    const snapshot = collectState({ agent });
    assert.equal(snapshot.wsId, 'agent-ws');
  });

  it('defaults wsId to "default" when no agent', () => {
    const snapshot = collectState({});
    assert.equal(snapshot.wsId, 'default');
  });
});

// ── applyState ─────────────────────────────────────────────────

describe('applyState', () => {
  it('restores checkpoint to agent', () => {
    const agent = makeAgent();
    const data = {
      checkpoint: {
        id: 'cp-restored',
        session_history: [{ role: 'user', content: 'restored' }],
        active_goals: [],
        scheduler_snapshot: [],
      },
    };

    const result = applyState(data, { agent });
    assert.ok(result.restored.includes('checkpoint'));
    assert.ok(agent._wasRestored);
  });

  it('restores memories', () => {
    const agent = makeAgent();
    const newMems = [
      { id: 'm2', key: 'new', content: 'new memory', category: 'restored', timestamp: 9999 },
      { id: 'm3', key: 'another', content: 'another', category: 'restored', timestamp: 9998 },
    ];

    const result = applyState({ memories: newMems }, { agent });
    assert.ok(result.restored.includes('memories'));
    const exported = agent.memory.exportToFlatArray();
    assert.equal(exported.length, 2);
    assert.equal(exported[0].id, 'm2');
  });

  it('restores config (model and systemPrompt)', () => {
    const agent = makeAgent();
    const result = applyState({
      config: { model: 'gpt-4', systemPrompt: 'You are a pirate.' },
    }, { agent });

    assert.ok(result.restored.includes('config'));
    assert.equal(agent.getConfig().model, 'gpt-4');
    assert.equal(agent.getConfig().systemPrompt, 'You are a pirate.');
  });

  it('restores routines', () => {
    const routineEngine = makeRoutineEngine();
    const newRoutines = {
      routines: [{ id: 'r-new', name: 'New routine' }],
      lastTickTime: 999,
      healthMetrics: {},
    };

    const result = applyState({ routines: newRoutines }, { agent: makeAgent(), routineEngine });
    assert.ok(result.restored.includes('routines'));
    assert.deepEqual(routineEngine.data, newRoutines);
  });

  it('restores shell state', () => {
    const shell = makeShell();
    const data = {
      shell: {
        cwd: '/restored/path',
        env: { RESTORED: 'true' },
        history: ['echo restored'],
        aliases: { g: 'git' },
        lastExitCode: 42,
      },
    };

    const result = applyState(data, { agent: makeAgent(), shell });
    assert.ok(result.restored.includes('shell'));
    assert.equal(shell.state.cwd, '/restored/path');
    assert.equal(shell.state.env.get('RESTORED'), 'true');
    assert.ok(!shell.state.env.has('HOME'), 'old env entries should be cleared');
    assert.deepEqual(shell.state.history, ['echo restored']);
    assert.equal(shell.state.aliases.get('g'), 'git');
    assert.equal(shell.state.lastExitCode, 42);
  });

  it('restores skill activations', () => {
    const skillRegistry = makeSkillRegistry([]);
    const data = { skillActivations: ['debug', 'test'] };

    const result = applyState(data, { agent: makeAgent(), skillRegistry });
    assert.ok(result.restored.includes('skillActivations'));
    assert.ok(skillRegistry.activeSkills.has('debug'));
    assert.ok(skillRegistry.activeSkills.has('test'));
  });

  it('skips hooks (requires factories)', () => {
    const agent = makeAgent();
    const data = {
      hooks: { hooks: [{ name: 'h1', point: 'pre_send' }] },
    };

    const result = applyState(data, { agent });
    assert.ok(result.skipped.some(s => s.includes('hooks')));
  });

  it('restores localStorage settings', () => {
    const data = {
      wsId: 'ws-test',
      localStorage: {
        autonomy: '{"level":3}',
        identity: '{"name":"test"}',
      },
    };

    const result = applyState(data, { agent: makeAgent() });
    assert.ok(result.restored.includes('localStorage'));
    assert.equal(localStorage.getItem('clawser_v1_autonomy_ws-test'), '{"level":3}');
    assert.equal(localStorage.getItem('clawser_v1_identity_ws-test'), '{"name":"test"}');

    // Cleanup
    localStorage.removeItem('clawser_v1_autonomy_ws-test');
    localStorage.removeItem('clawser_v1_identity_ws-test');
  });

  it('reports errors when subsystems throw', () => {
    const brokenAgent = {
      ...makeAgent(),
      restore: () => { throw new Error('restore boom'); },
    };

    const result = applyState({
      checkpoint: { session_history: [] },
    }, { agent: brokenAgent });

    assert.ok(result.errors.some(e => e.includes('checkpoint') && e.includes('restore boom')));
  });

  it('handles empty data gracefully', () => {
    const result = applyState({}, { agent: makeAgent() });
    assert.ok(result.skipped.length > 0);
    assert.equal(result.errors.length, 0);
  });
});

// ── collectState → applyState round-trip ───────────────────────

describe('collectState → applyState round-trip', () => {
  it('serializes and deserializes all subsystem state', () => {
    const agent = makeAgent();
    const shell = makeShell();
    const routineEngine = makeRoutineEngine();
    const skillRegistry = makeSkillRegistry(['skill-a', 'skill-b']);

    // Collect
    const snapshot = collectState({ agent, shell, routineEngine, skillRegistry, wsId: 'round-trip' });

    // Simulate JSON serialization (what IDB does)
    const serialized = JSON.parse(JSON.stringify(snapshot));

    // Create fresh targets
    const agent2 = makeAgent({ memories: [], wsId: 'round-trip' });
    const shell2 = makeShell({ cwd: '/', env: {}, aliases: {}, history: [] });
    const routineEngine2 = makeRoutineEngine({ data: null });
    const skillRegistry2 = makeSkillRegistry([]);

    // Apply
    const result = applyState(serialized, {
      agent: agent2,
      shell: shell2,
      routineEngine: routineEngine2,
      skillRegistry: skillRegistry2,
    });

    assert.ok(result.restored.includes('checkpoint'));
    assert.ok(result.restored.includes('memories'));
    assert.ok(result.restored.includes('config'));
    assert.ok(result.restored.includes('routines'));
    assert.ok(result.restored.includes('shell'));
    assert.ok(result.restored.includes('skillActivations'));
    assert.equal(result.errors.length, 0);

    // Verify state was applied
    assert.equal(agent2.getConfig().model, 'test-model');
    assert.equal(shell2.state.cwd, '/workspace/project');
    assert.deepEqual(shell2.state.history, ['ls', 'cd /tmp', 'echo hi']);
    assert.ok(skillRegistry2.activeSkills.has('skill-a'));
    assert.ok(skillRegistry2.activeSkills.has('skill-b'));
  });

  it('round-trips through fflate compression', async () => {
    // This test validates the full compress/decompress pipeline
    // without needing IndexedDB
    const agent = makeAgent();
    const snapshot = collectState({ agent, wsId: 'compress-test' });
    const jsonStr = JSON.stringify(snapshot);

    const fflate = await import('fflate');
    const rawBytes = fflate.strToU8(jsonStr);
    const compressed = fflate.compressSync(rawBytes, { level: 6 });
    assert.ok(compressed.byteLength < rawBytes.byteLength, 'compressed should be smaller');

    const decompressed = fflate.decompressSync(compressed);
    const restored = JSON.parse(fflate.strFromU8(decompressed));

    assert.equal(restored.version, SNAPSHOT_VERSION);
    assert.equal(restored.wsId, 'compress-test');
    assert.ok(restored.eventLog.length > 0);
    assert.ok(restored.checkpoint);
    assert.equal(restored.memories.length, 1);
  });
});

// ── SnapshotManager (unit tests with mocked IDB) ──────────────

describe('SnapshotManager', () => {
  // We can't use real IndexedDB in Node, so test the class interface
  // by verifying constructor and method existence

  it('exports SnapshotManager class', () => {
    assert.equal(typeof SnapshotManager, 'function');
    const mgr = new SnapshotManager();
    assert.equal(typeof mgr.createAtomicSnapshot, 'function');
    assert.equal(typeof mgr.restoreAtomicSnapshot, 'function');
    assert.equal(typeof mgr.listSnapshots, 'function');
    assert.equal(typeof mgr.deleteSnapshot, 'function');
    assert.equal(typeof mgr.getSnapshotMeta, 'function');
    assert.equal(typeof mgr.clearAll, 'function');
  });
});

// ── SNAPSHOT_VERSION ───────────────────────────────────────────

describe('SNAPSHOT_VERSION', () => {
  it('is a positive integer', () => {
    assert.equal(typeof SNAPSHOT_VERSION, 'number');
    assert.ok(SNAPSHOT_VERSION >= 1);
    assert.equal(SNAPSHOT_VERSION, Math.floor(SNAPSHOT_VERSION));
  });
});
