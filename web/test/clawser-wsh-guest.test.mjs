import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { MSG, guestInvite, guestJoin, guestRevoke } from '../packages-wsh.js';

describe('wsh guest sessions', () => {
  it('guestInvite constructs correct message', () => {
    const msg = guestInvite({ sessionId: 'sess-1', ttl: 3600, permissions: ['read', 'write'] });
    assert.equal(msg.type, MSG.GUEST_INVITE);
    assert.equal(msg.session_id, 'sess-1');
    assert.equal(msg.ttl, 3600);
    assert.deepEqual(msg.permissions, ['read', 'write']);
  });

  it('guestJoin constructs correct message', () => {
    const msg = guestJoin({ token: 'abc123', deviceLabel: 'my-laptop' });
    assert.equal(msg.type, MSG.GUEST_JOIN);
    assert.equal(msg.token, 'abc123');
    assert.equal(msg.device_label, 'my-laptop');
  });

  it('guestRevoke constructs correct message', () => {
    const msg = guestRevoke({ token: 'abc123', reason: 'expired' });
    assert.equal(msg.type, MSG.GUEST_REVOKE);
    assert.equal(msg.token, 'abc123');
    assert.equal(msg.reason, 'expired');
  });

  it('WshClient has guest methods', async () => {
    const { WshClient } = await import('../packages-wsh.js');
    const client = new WshClient();
    assert.equal(typeof client.inviteGuest, 'function');
    assert.equal(typeof client.joinAsGuest, 'function');
    assert.equal(typeof client.revokeGuest, 'function');
  });

  it('GUEST_JOIN is relay-forwardable', async () => {
    const { WshClient } = await import('../packages-wsh.js');
    const client = new WshClient();
    assert.ok(client._isRelayForwardable(MSG.GUEST_JOIN));
    assert.ok(client._isRelayForwardable(MSG.GUEST_REVOKE));
  });
});
