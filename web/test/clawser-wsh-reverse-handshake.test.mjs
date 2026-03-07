import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  MSG,
  WshClient,
  openOk,
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
    const accept = reverseAccept({
      targetFingerprint: 'SHA256:target',
      username: 'cli-user',
      capabilities: ['shell'],
    });
    const reject = reverseReject({
      targetFingerprint: 'SHA256:target',
      username: 'cli-user',
      reason: 'busy',
    });

    assert.equal(accept.type, MSG.REVERSE_ACCEPT);
    assert.equal(reject.type, MSG.REVERSE_REJECT);
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
