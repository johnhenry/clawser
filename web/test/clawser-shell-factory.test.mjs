import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { MemoryFs } from '../clawser-shell.js';
import { createConfiguredShell } from '../clawser-shell-factory.js';

describe('createConfiguredShell', () => {
  it('registers the workspace shell commands', async () => {
    const shell = await createConfiguredShell({
      fs: new MemoryFs(),
      sourceRc: false,
    });

    assert.equal(typeof shell.registry.get('clawser'), 'function');
    assert.equal(typeof shell.registry.get('andbox'), 'function');
    assert.equal(typeof shell.registry.get('wsh'), 'function');
    assert.equal(typeof shell.registry.get('cron'), 'function');
    assert.equal(typeof shell.registry.get('model'), 'function');
  });

  it('creates isolated shell instances', async () => {
    const shellA = await createConfiguredShell({
      fs: new MemoryFs(),
      sourceRc: false,
    });
    const shellB = await createConfiguredShell({
      fs: new MemoryFs(),
      sourceRc: false,
    });

    await shellA.exec('export REMOTE_ONLY=1');

    assert.equal(shellA.state.env.get('REMOTE_ONLY'), '1');
    assert.equal(shellB.state.env.get('REMOTE_ONLY'), undefined);
  });
});
