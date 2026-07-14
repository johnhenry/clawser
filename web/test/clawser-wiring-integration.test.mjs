/**
 * Integration test: verify that the live app wiring works —
 * procHandler, deviceHandler, permissions, env vars, and profile sourcing
 * all flow through createConfiguredShell just like the real createShellSession.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createConfiguredShell } from '../clawser-shell-factory.js';
import { initRuntimeFs, initDeviceFs } from '../clawser-runtime.js';
import { PermissionManager } from '../clawser-permissions.js';
import { MemoryFs } from '../clawser-shell.js';

describe('Live app wiring integration', async () => {

  it('createConfiguredShell wires procHandler so /proc/clawser/uptime works', async () => {
    const permissions = new PermissionManager();
    const procHandler = initRuntimeFs({ permissions, initTime: performance.now() });
    const deviceHandler = initDeviceFs();
    const fs = new MemoryFs();

    const shell = await createConfiguredShell({
      fs,
      procHandler,
      deviceHandler,
      permissions,
      sourceRc: false,
    });

    // /proc/clawser/uptime should be readable
    const result = await shell.exec('cat /proc/clawser/uptime');
    assert.equal(result.exitCode, 0, `cat /proc/clawser/uptime failed: ${result.stderr}`);
    assert.ok(result.stdout.length > 0, 'uptime should produce output');
  });

  it('sets $SHELL and $CLSH_VERSION env vars', async () => {
    const fs = new MemoryFs();
    const shell = await createConfiguredShell({ fs, sourceRc: false });

    const r1 = await shell.exec('echo $SHELL');
    assert.equal(r1.stdout.trim(), 'clsh');

    const r2 = await shell.exec('echo $CLSH_VERSION');
    assert.equal(r2.stdout.trim(), '1.0');
  });

  it('ls /proc/clawser/ lists virtual files', async () => {
    const procHandler = initRuntimeFs({ initTime: performance.now() });
    const fs = new MemoryFs();
    const shell = await createConfiguredShell({
      fs,
      procHandler,
      sourceRc: false,
    });

    const result = await shell.exec('ls /proc/clawser/');
    assert.equal(result.exitCode, 0, `ls /proc/clawser/ failed: ${result.stderr}`);
    assert.ok(result.stdout.includes('uptime'), 'should list uptime');
  });

  it('deviceHandler wires /dev/clawser/null (needs procHandler for VirtualFs)', async () => {
    const procHandler = initRuntimeFs({ initTime: performance.now() });
    const deviceHandler = initDeviceFs();
    const fs = new MemoryFs();
    const shell = await createConfiguredShell({
      fs,
      procHandler,
      deviceHandler,
      sourceRc: false,
    });

    const result = await shell.exec('cat /dev/clawser/null');
    assert.equal(result.exitCode, 0);
    assert.equal(result.stdout, '');
  });

  it('permissions manager is wired — chmod works', async () => {
    const permissions = new PermissionManager();
    const fs = new MemoryFs();
    const shell = await createConfiguredShell({
      fs,
      permissions,
      sourceRc: false,
    });

    // chmod should be registered
    const result = await shell.exec('chmod 644 /tmp/clawser/test.txt');
    assert.equal(result.exitCode, 0);
  });

  it('sources /etc/clawser/profile if present', async () => {
    const fs = new MemoryFs();
    // Write a profile that sets a variable
    await fs.writeFile('/etc/clawser/profile', 'export PROFILE_LOADED=yes');

    const shell = await createConfiguredShell({ fs, sourceRc: false });

    const result = await shell.exec('echo $PROFILE_LOADED');
    assert.equal(result.stdout.trim(), 'yes', 'profile should have been sourced');
  });

  it('sources ~/.config/clawser/profile after /etc/clawser/profile', async () => {
    const fs = new MemoryFs();
    await fs.writeFile('/etc/clawser/profile', 'export ORDER=etc');
    await fs.writeFile('~/.config/clawser/profile', 'export ORDER=user');

    const shell = await createConfiguredShell({ fs, sourceRc: false });

    const result = await shell.exec('echo $ORDER');
    assert.equal(result.stdout.trim(), 'user', 'user profile should override etc profile');
  });

  it('full round-trip: proc + device + permissions + env + profiles', async () => {
    const permissions = new PermissionManager();
    const procHandler = initRuntimeFs({ permissions, initTime: performance.now() });
    const deviceHandler = initDeviceFs();
    const fs = new MemoryFs();
    await fs.writeFile('/etc/clawser/profile', 'export CLAWSER_ENV=production');

    const shell = await createConfiguredShell({
      fs,
      procHandler,
      deviceHandler,
      permissions,
      sourceRc: false,
    });

    // Check env vars
    let r = await shell.exec('echo $SHELL');
    assert.equal(r.stdout.trim(), 'clsh');

    r = await shell.exec('echo $CLSH_VERSION');
    assert.equal(r.stdout.trim(), '1.0');

    r = await shell.exec('echo $CLAWSER_ENV');
    assert.equal(r.stdout.trim(), 'production');

    // Check /proc works
    r = await shell.exec('cat /proc/clawser/uptime');
    assert.equal(r.exitCode, 0);
    assert.ok(r.stdout.length > 0);

    // Check /dev works
    r = await shell.exec('cat /dev/clawser/null');
    assert.equal(r.exitCode, 0);

    // Check chmod works
    r = await shell.exec('chmod 444 /tmp/clawser/test');
    assert.equal(r.exitCode, 0);
  });
});
