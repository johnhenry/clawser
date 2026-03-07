import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  MSG, suspendSession, restartPty, metricsRequest,
} from '../packages/wsh/src/messages.gen.mjs';

describe('wsh suspend/restart messages', () => {
  it('suspendSession constructs correct message', () => {
    const msg = suspendSession({ sessionId: 'sess-1', action: 'suspend' });
    assert.equal(msg.type, MSG.SUSPEND_SESSION);
    assert.equal(msg.session_id, 'sess-1');
    assert.equal(msg.action, 'suspend');
  });

  it('restartPty constructs correct message', () => {
    const msg = restartPty({ sessionId: 'sess-2', command: '/bin/zsh' });
    assert.equal(msg.type, MSG.RESTART_PTY);
    assert.equal(msg.session_id, 'sess-2');
    assert.equal(msg.command, '/bin/zsh');
  });

  it('restartPty without command omits it', () => {
    const msg = restartPty({ sessionId: 'sess-3' });
    assert.equal(msg.type, MSG.RESTART_PTY);
    assert.equal(msg.command, undefined);
  });
});

describe('wsh suspend/restart client methods', () => {
  it('WshClient has suspendSession method', async () => {
    const { WshClient } = await import('../packages/wsh/src/client.mjs');
    const client = new WshClient();
    assert.equal(typeof client.suspendSession, 'function');
  });

  it('WshClient has restartPty method', async () => {
    const { WshClient } = await import('../packages/wsh/src/client.mjs');
    const client = new WshClient();
    assert.equal(typeof client.restartPty, 'function');
  });

  it('suspendSession throws when not authenticated', async () => {
    const { WshClient } = await import('../packages/wsh/src/client.mjs');
    const client = new WshClient();
    await assert.rejects(() => client.suspendSession('x'), /not authenticated|disconnected/i);
  });

  it('restartPty throws when not authenticated', async () => {
    const { WshClient } = await import('../packages/wsh/src/client.mjs');
    const client = new WshClient();
    await assert.rejects(() => client.restartPty('x'), /not authenticated|disconnected/i);
  });
});
