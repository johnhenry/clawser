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

  it('bind connects to wsh client events', () => {
    const kernel = new Kernel();
    const bridge = new KernelWshBridge(kernel);

    const handlers = {};
    const mockClient = {
      on(event, cb) { handlers[event] = cb; },
    };
    bridge.bind(mockClient);

    // Simulate events
    handlers.GuestJoin({ guestId: 'g1' });
    assert.equal(kernel.listTenants().length, 1);

    handlers.GuestRevoke({ guestId: 'g1' });
    assert.equal(kernel.listTenants().length, 0);

    bridge.close();
    kernel.close();
  });

  it('close destroys all bridge tenants', () => {
    const kernel = new Kernel();
    const bridge = new KernelWshBridge(kernel);

    bridge.handleGuestJoin({ guestId: 'g1' });
    bridge.handleCopilotAttach({ copilotId: 'c1' });
    assert.equal(kernel.listTenants().length, 2);

    bridge.close();
    assert.equal(kernel.listTenants().length, 0);

    kernel.close();
  });
});
