// Run with: node --import ./web/test/_setup-globals.mjs --test web/test/clawser-deploy-flow.test.mjs
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

globalThis.BrowserTool = globalThis.BrowserTool || class { constructor() {} };

import {
  resolveDeployItems,
  getDeploySigningKey,
  getDeploySourceDid,
  runMeshDeployFlow,
} from '../clawser-deploy-flow.mjs';

const mockState = () => ({
  agent: {
    getWorkspace: () => 'ws1',
    memory: {
      exportToFlatArray: () => [
        { key: 'fact-1', content: 'the sky is blue', category: 'learned' },
        { key: 'bad-entry', content: 42 }, // non-string content — skipped
      ],
    },
  },
  skillRegistry: {
    skills: new Map([
      ['greeter', { name: 'greeter', dirName: 'greeter', scope: 'workspace' }],
      ['broken', { name: 'broken', dirName: 'broken', scope: 'global' }],
    ]),
  },
  reactiveConfigStore: {
    listDomains: () => ['autonomy', 'terminal'],
    get: (d) => (d === 'autonomy' ? { level: 'supervised' } : null),
    readFromDisk: async (d) => (d === 'terminal' ? { renderer: 'auto' } : null),
  },
  identityManager: {
    getDefault: () => ({ podId: 'pod-1' }),
    getIdentity: (id) => (id === 'pod-1' ? { keyPair: { privateKey: 'PRIV_KEY' } } : null),
    toDID: (id) => `did:key:z6Mk_${id}`,
  },
});

describe('resolveDeployItems', () => {
  it('collects skills, configs, and memory with deploy-apply payload shapes', async () => {
    const readSkillFn = async (scope, wsId, name) => {
      if (name === 'broken') throw new Error('unreadable');
      return new Map([['SKILL.md', '# greeter'], ['scripts/run.js', 'x']]);
    };
    const items = await resolveDeployItems(mockState(), { readSkillFn });

    assert.equal(items.skills.length, 1); // broken skill skipped
    assert.equal(items.skills[0].kind, 'skill');
    assert.deepEqual(items.skills[0].payload, {
      files: { 'SKILL.md': '# greeter', 'scripts/run.js': 'x' },
      scope: 'workspace',
    });

    assert.deepEqual(items.configs.map(c => c.itemId), ['autonomy', 'terminal']);
    assert.deepEqual(items.configs[1].payload, { renderer: 'auto' });

    assert.equal(items.memory.length, 1);
    assert.deepEqual(items.memory[0].payload, {
      key: 'fact-1', content: 'the sky is blue', category: 'learned',
    });
  });

  it('returns empty sections when subsystems are missing', async () => {
    const items = await resolveDeployItems({});
    assert.deepEqual(items, { skills: [], configs: [], memory: [] });
  });
});

describe('deploy identity helpers', () => {
  it('returns signing key and did from the default identity', async () => {
    const state = mockState();
    assert.equal(await getDeploySigningKey(state), 'PRIV_KEY');
    assert.equal(getDeploySourceDid(state), 'did:key:z6Mk_pod-1');
  });

  it('returns null without an identity manager', async () => {
    assert.equal(await getDeploySigningKey({}), null);
    assert.equal(getDeploySourceDid({}), null);
  });
});

describe('runMeshDeployFlow', () => {
  const device = { id: 'dev-1', label: 'Laptop', peerPublicKey: 'PK' };

  it('fails cleanly with no paired devices', async () => {
    const result = await runMeshDeployFlow({ pairedDevices: { list: async () => [] } });
    assert.equal(result.ok, false);
    assert.match(result.error, /no paired devices/);
  });

  it('auto-selects a single device and delegates to onDeployNow', async () => {
    const calls = [];
    const result = await runMeshDeployFlow(
      { pairedDevices: { list: async () => [device] } },
      {
        buildController: (ctx) => {
          assert.ok(ctx.resolveItems && ctx.getSigningKey && ctx.getSourceDid);
          return { onDeployNow: async (id) => { calls.push(id); return { ok: true }; } };
        },
      },
    );
    assert.deepEqual(calls, ['dev-1']);
    assert.deepEqual(result, { ok: true, deviceId: 'dev-1' });
  });

  it('uses pickDevice when multiple devices exist and honors cancel', async () => {
    const devices = [device, { id: 'dev-2', peerPublicKey: 'PK2' }];
    const picked = await runMeshDeployFlow(
      { pairedDevices: { list: async () => devices } },
      {
        pickDevice: async (list) => list[1],
        buildController: () => ({ onDeployNow: async (id) => ({ ok: true, id }) }),
      },
    );
    assert.equal(picked.deviceId, 'dev-2');

    const cancelled = await runMeshDeployFlow(
      { pairedDevices: { list: async () => devices } },
      { pickDevice: async () => null, buildController: () => ({ onDeployNow: async () => ({ ok: true }) }) },
    );
    assert.equal(cancelled.ok, false);
    assert.equal(cancelled.error, 'cancelled');
  });
});
