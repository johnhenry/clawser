import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { MSG, sessionLink, sessionUnlink } from '../packages-wsh.js';

describe('wsh cross-session linking', () => {
  it('sessionLink constructs correct message', () => {
    const msg = sessionLink({ sourceSession: 'sess-1', targetHost: 'remote.host', targetPort: 4422, targetUser: 'bob' });
    assert.equal(msg.type, MSG.SESSION_LINK);
    assert.equal(msg.source_session, 'sess-1');
    assert.equal(msg.target_host, 'remote.host');
    assert.equal(msg.target_port, 4422);
    assert.equal(msg.target_user, 'bob');
  });

  it('sessionLink omits optional targetUser', () => {
    const msg = sessionLink({ sourceSession: 'a', targetHost: 'b', targetPort: 22 });
    assert.equal(msg.target_user, undefined);
  });

  it('sessionUnlink constructs correct message', () => {
    const msg = sessionUnlink({ linkId: 'link-1', reason: 'no longer needed' });
    assert.equal(msg.type, MSG.SESSION_UNLINK);
    assert.equal(msg.link_id, 'link-1');
    assert.equal(msg.reason, 'no longer needed');
  });

  it('WshClient has link/unlink methods', async () => {
    const { WshClient } = await import('../packages-wsh.js');
    const client = new WshClient();
    assert.equal(typeof client.linkSession, 'function');
    assert.equal(typeof client.unlinkSession, 'function');
  });
});
