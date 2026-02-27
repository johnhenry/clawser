import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { KernelWshBridge } from '../clawser-kernel-wsh-bridge.js';
import { Kernel, KERNEL_CAP } from '../packages/kernel/src/index.mjs';

describe('KernelWshBridge', () => {
  it('handleGuestJoin creates tenant with limited caps', () => {
    const kernel = new Kernel();
    const bridge = new KernelWshBridge(kernel);

    const { tenantId } = bridge.handleGuestJoin({ guestId: 'guest_1' });
    assert.match(tenantId, /^tenant_/);

    const tenant = kernel.getTenant(tenantId);
    assert.ok(tenant);
    assert.equal(tenant.env.get('GUEST'), 'true');
    assert.equal(tenant.env.get('PARTICIPANT_ID'), 'guest_1');

    bridge.close();
    kernel.close();
  });

  it('handleGuestJoin caps TTL at 24h', () => {
    const kernel = new Kernel();
    const bridge = new KernelWshBridge(kernel);

    const { tenantId } = bridge.handleGuestJoin({ guestId: 'g1', ttl: 999999 });
    const tenant = kernel.getTenant(tenantId);
    assert.equal(tenant.env.get('TTL'), '86400');

    bridge.close();
    kernel.close();
  });

  it('handleCopilotAttach creates read-only tenant', () => {
    const kernel = new Kernel();
    const bridge = new KernelWshBridge(kernel);

    const { tenantId } = bridge.handleCopilotAttach({ copilotId: 'copilot_1' });
    const tenant = kernel.getTenant(tenantId);
    assert.equal(tenant.env.get('COPILOT'), 'true');
    assert.equal(tenant.env.get('MODE'), 'read-only');

    bridge.close();
    kernel.close();
  });

  it('handleSessionGrant creates tenant with custom caps', () => {
    const kernel = new Kernel();
    const bridge = new KernelWshBridge(kernel);

    const { tenantId } = bridge.handleSessionGrant({
      participantId: 'user_1',
      capabilities: [KERNEL_CAP.NET, KERNEL_CAP.FS, KERNEL_CAP.IPC],
      env: { ROLE: 'admin' },
    });
    const tenant = kernel.getTenant(tenantId);
    assert.equal(tenant.env.get('ROLE'), 'admin');
    assert.ok(tenant.caps._granted.includes(KERNEL_CAP.NET));

    bridge.close();
    kernel.close();
  });

  it('handleParticipantLeave destroys tenant', () => {
    const kernel = new Kernel();
    const bridge = new KernelWshBridge(kernel);

    bridge.handleGuestJoin({ guestId: 'g1' });
    assert.equal(kernel.listTenants().length, 1);

    bridge.handleParticipantLeave('g1');
    assert.equal(kernel.listTenants().length, 0);

    bridge.close();
    kernel.close();
  });

  it('getTenantId returns mapping', () => {
    const kernel = new Kernel();
    const bridge = new KernelWshBridge(kernel);

    const { tenantId } = bridge.handleGuestJoin({ guestId: 'g1' });
    assert.equal(bridge.getTenantId('g1'), tenantId);
    assert.equal(bridge.getTenantId('unknown'), undefined);

    bridge.close();
    kernel.close();
  });

  // ── Reverse connect ───────────────────────────────────────────────

  it('handleReverseConnect creates tenant with restricted caps', () => {
    const kernel = new Kernel();
    const bridge = new KernelWshBridge(kernel);

    const { tenantId } = bridge.handleReverseConnect({
      username: 'cli_user',
      fingerprint: 'SHA256:abc123',
    });
    assert.match(tenantId, /^tenant_/);

    const tenant = kernel.getTenant(tenantId);
    assert.equal(tenant.env.get('REVERSE'), 'true');
    assert.equal(tenant.env.get('USERNAME'), 'cli_user');
    assert.equal(tenant.env.get('FINGERPRINT'), 'SHA256:abc123');
    assert.equal(tenant.env.get('PARTICIPANT_ID'), 'cli_user');
    // Should have STDIO and CLOCK but NOT NET or FS
    assert.ok(tenant.caps._granted.includes(KERNEL_CAP.STDIO));
    assert.ok(tenant.caps._granted.includes(KERNEL_CAP.CLOCK));
    assert.ok(!tenant.caps._granted.includes(KERNEL_CAP.NET));
    assert.ok(!tenant.caps._granted.includes(KERNEL_CAP.FS));

    bridge.close();
    kernel.close();
  });

  it('handleReverseConnect with custom capabilities', () => {
    const kernel = new Kernel();
    const bridge = new KernelWshBridge(kernel);

    const { tenantId } = bridge.handleReverseConnect({
      username: 'trusted_cli',
      fingerprint: 'SHA256:xyz',
      capabilities: [KERNEL_CAP.STDIO, KERNEL_CAP.CLOCK, KERNEL_CAP.NET],
    });

    const tenant = kernel.getTenant(tenantId);
    assert.ok(tenant.caps._granted.includes(KERNEL_CAP.NET));

    bridge.close();
    kernel.close();
  });

  it('handleParticipantLeave destroys reverse-connect tenant', () => {
    const kernel = new Kernel();
    const bridge = new KernelWshBridge(kernel);

    bridge.handleReverseConnect({ username: 'cli_user', fingerprint: 'fp' });
    assert.equal(kernel.listTenants().length, 1);

    bridge.handleParticipantLeave('cli_user');
    assert.equal(kernel.listTenants().length, 0);

    bridge.close();
    kernel.close();
  });

  // ── bind() with callback properties ──────────────────────────────

  it('bind wires onReverseConnect callback', () => {
    const kernel = new Kernel();
    const bridge = new KernelWshBridge(kernel);

    const mockClient = {
      onReverseConnect: null,
      onClose: null,
    };
    bridge.bind(mockClient);

    // Simulate a reverse connect event
    mockClient.onReverseConnect({
      username: 'remote_cli',
      target_fingerprint: 'SHA256:fp',
    });
    assert.equal(kernel.listTenants().length, 1);
    assert.ok(bridge.getTenantId('remote_cli'));

    bridge.close();
    kernel.close();
  });

  it('bind chains with previous onReverseConnect handler', () => {
    const kernel = new Kernel();
    const bridge = new KernelWshBridge(kernel);

    let prevCalled = false;
    const mockClient = {
      onReverseConnect: () => { prevCalled = true; },
      onClose: null,
    };
    bridge.bind(mockClient);

    mockClient.onReverseConnect({ username: 'u1', target_fingerprint: 'fp' });
    assert.ok(prevCalled, 'previous handler should be chained');
    assert.equal(kernel.listTenants().length, 1);

    bridge.close();
    kernel.close();
  });

  it('bind wires onClose to clean up all tenants', () => {
    const kernel = new Kernel();
    const bridge = new KernelWshBridge(kernel);

    const mockClient = { onReverseConnect: null, onClose: null };
    bridge.bind(mockClient);

    // Create some tenants
    bridge.handleGuestJoin({ guestId: 'g1' });
    bridge.handleReverseConnect({ username: 'rc1', fingerprint: 'fp' });
    assert.equal(kernel.listTenants().length, 2);

    // Simulate client disconnect
    mockClient.onClose('connection lost');
    assert.equal(kernel.listTenants().length, 0);

    kernel.close();
  });

  it('bind tolerates null client', () => {
    const kernel = new Kernel();
    const bridge = new KernelWshBridge(kernel);
    bridge.bind(null); // should not throw
    bridge.close();
    kernel.close();
  });

  // ── close ────────────────────────────────────────────────────────

  it('close destroys all bridge tenants', () => {
    const kernel = new Kernel();
    const bridge = new KernelWshBridge(kernel);

    bridge.handleGuestJoin({ guestId: 'g1' });
    bridge.handleCopilotAttach({ copilotId: 'c1' });
    bridge.handleReverseConnect({ username: 'rc1', fingerprint: 'fp' });
    assert.equal(kernel.listTenants().length, 3);

    bridge.close();
    assert.equal(kernel.listTenants().length, 0);

    kernel.close();
  });
});
