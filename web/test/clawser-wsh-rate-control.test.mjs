import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { MSG, rateControl, rateWarning } from '../packages-wsh.js';

describe('wsh rate control', () => {
  it('rateControl constructs correct message', () => {
    const msg = rateControl({ sessionId: 'sess-1', maxBytesPerSec: 1024, policy: 'drop' });
    assert.equal(msg.type, MSG.RATE_CONTROL);
    assert.equal(msg.session_id, 'sess-1');
    assert.equal(msg.max_bytes_per_sec, 1024);
    assert.equal(msg.policy, 'drop');
  });

  it('rateControl defaults policy to pause', () => {
    const msg = rateControl({ sessionId: 'x', maxBytesPerSec: 512 });
    assert.equal(msg.policy, 'pause');
  });

  it('rateWarning constructs correct message', () => {
    const msg = rateWarning({ sessionId: 'sess-1', queuedBytes: 4096, action: 'throttled' });
    assert.equal(msg.type, MSG.RATE_WARNING);
    assert.equal(msg.session_id, 'sess-1');
    assert.equal(msg.queued_bytes, 4096);
    assert.equal(msg.action, 'throttled');
  });

  it('WshClient has setRateControl method', async () => {
    const { WshClient } = await import('../packages-wsh.js');
    const client = new WshClient();
    assert.equal(typeof client.setRateControl, 'function');
  });

  it('WshClient has onRateWarning callback', async () => {
    const { WshClient } = await import('../packages-wsh.js');
    const client = new WshClient();
    assert.equal(client.onRateWarning, null);
    client.onRateWarning = () => {};
    assert.equal(typeof client.onRateWarning, 'function');
  });
});
