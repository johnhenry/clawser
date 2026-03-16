import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { MSG, shareSession, shareRevoke } from '../packages-wsh.js';

describe('wsh session sharing', () => {
  it('shareSession constructs correct message', () => {
    const msg = shareSession({ sessionId: 'sess-1', mode: 'control', ttl: 1800 });
    assert.equal(msg.type, MSG.SHARE_SESSION);
    assert.equal(msg.session_id, 'sess-1');
    assert.equal(msg.mode, 'control');
    assert.equal(msg.ttl, 1800);
  });

  it('shareSession defaults to read mode', () => {
    const msg = shareSession({ sessionId: 'sess-1' });
    assert.equal(msg.mode, 'read');
  });

  it('shareRevoke constructs correct message', () => {
    const msg = shareRevoke({ shareId: 'share-1', reason: 'done' });
    assert.equal(msg.type, MSG.SHARE_REVOKE);
    assert.equal(msg.share_id, 'share-1');
    assert.equal(msg.reason, 'done');
  });

  it('WshClient has share methods', async () => {
    const { WshClient } = await import('../packages-wsh.js');
    const client = new WshClient();
    assert.equal(typeof client.shareSession, 'function');
    assert.equal(typeof client.revokeShare, 'function');
  });
});
