import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  MSG,
  WshClient,
  openOk,
  reverseRegister,
  reverseAccept,
  reverseReject,
  sessionData,
} from '../packages/wsh/src/index.mjs';

describe('wsh reverse handshake protocol', () => {
  it('openOk includes data mode and capabilities', () => {
    const msg = openOk({
      channelId: 7,
      dataMode: 'virtual',
      capabilities: ['resize', 'signal'],
    });

    assert.equal(msg.type, MSG.OPEN_OK);
    assert.equal(msg.channel_id, 7);
    assert.equal(msg.data_mode, 'virtual');
    assert.deepEqual(msg.capabilities, ['resize', 'signal']);
  });

  it('sessionData constructs a virtual session frame', () => {
    const data = new Uint8Array([1, 2, 3]);
    const msg = sessionData({ channelId: 9, data });

    assert.equal(msg.type, MSG.SESSION_DATA);
    assert.equal(msg.channel_id, 9);
    assert.equal(msg.data, data);
  });

  it('reverse accept and reject constructors are exported', () => {
    const register = reverseRegister({
      username: 'browser',
      capabilities: ['shell'],
      peerType: 'browser-shell',
      shellBackend: 'virtual-shell',
      supportsAttach: true,
      supportsReplay: true,
      supportsEcho: true,
      supportsTermSync: true,
      publicKey: new Uint8Array([1, 2, 3]),
    });
    const accept = reverseAccept({
      targetFingerprint: 'SHA256:target',
      username: 'cli-user',
      capabilities: ['shell'],
      peerType: 'browser-shell',
      shellBackend: 'virtual-shell',
      supportsAttach: true,
      supportsReplay: true,
      supportsEcho: true,
      supportsTermSync: true,
    });
    const reject = reverseReject({
      targetFingerprint: 'SHA256:target',
      username: 'cli-user',
      reason: 'busy',
    });

    assert.equal(register.type, MSG.REVERSE_REGISTER);
    assert.equal(register.peer_type, 'browser-shell');
    assert.equal(register.shell_backend, 'virtual-shell');
    assert.equal(accept.type, MSG.REVERSE_ACCEPT);
    assert.equal(accept.peer_type, 'browser-shell');
    assert.equal(accept.shell_backend, 'virtual-shell');
    assert.equal(reject.type, MSG.REVERSE_REJECT);
  });

  it('supports non-virtual-shell reverse peers with reduced session hints', () => {
    const register = reverseRegister({
      username: 'vm',
      capabilities: ['shell', 'exec', 'fs'],
      peerType: 'vm-guest',
      shellBackend: 'vm-console',
      supportsAttach: true,
      supportsReplay: true,
      supportsEcho: false,
      supportsTermSync: false,
      publicKey: new Uint8Array([9, 8, 7]),
    });

    assert.equal(register.peer_type, 'vm-guest');
    assert.equal(register.shell_backend, 'vm-console');
    assert.equal(register.supports_attach, true);
    assert.equal(register.supports_replay, true);
    assert.equal(register.supports_echo, false);
    assert.equal(register.supports_term_sync, false);
  });

  it('WshClient treats virtual-session relay messages as relay-forwardable', () => {
    const client = new WshClient();

    assert.equal(client._isRelayForwardable(MSG.SESSION_DATA), true);
    assert.equal(client._isRelayForwardable(MSG.REVERSE_ACCEPT), true);
    assert.equal(client._isRelayForwardable(MSG.REVERSE_REJECT), true);
    assert.equal(client._isRelayForwardable(MSG.ECHO_ACK), true);
    assert.equal(client._isRelayForwardable(MSG.TERM_SYNC), true);
  });
});
