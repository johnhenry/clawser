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

  it('loads ~/.config/clawser/.env into shell env', async () => {
    const fs = new MemoryFs();
    await fs.writeFile('~/.config/clawser/.env', '# comment\nFOO=bar\nQUOTED="hello world"\n');
    const shell = await createConfiguredShell({ fs, sourceRc: false });

    assert.equal(shell.state.env.get('FOO'), 'bar');
    assert.equal(shell.state.env.get('QUOTED'), 'hello world');
  });

  it('applies .env after system profile and before user profile', async () => {
    const fs = new MemoryFs();
    await fs.writeFile('/etc/clawser/profile', 'export ORDER=system');
    await fs.writeFile('~/.config/clawser/.env', 'ORDER=env\nENV_ONLY=1');
    await fs.writeFile('~/.config/clawser/profile', 'export ORDER=user');
    const shell = await createConfiguredShell({ fs, sourceRc: false });

    assert.equal(shell.state.env.get('ORDER'), 'user');
    assert.equal(shell.state.env.get('ENV_ONLY'), '1');
  });

  it('tolerates a missing .env file', async () => {
    const shell = await createConfiguredShell({ fs: new MemoryFs(), sourceRc: false });
    assert.equal(shell.state.env.get('SHELL'), 'clsh');
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
