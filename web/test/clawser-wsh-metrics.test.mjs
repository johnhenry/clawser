import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { MSG, metricsRequest, metrics } from '../packages/wsh/src/messages.gen.mjs';

describe('wsh metrics', () => {
  it('metricsRequest constructs correct message', () => {
    const msg = metricsRequest();
    assert.equal(msg.type, MSG.METRICS_REQUEST);
  });

  it('metrics response constructs correct message', () => {
    const msg = metrics({ cpu: 42, memory: 70, sessions: 5, rtt: 12 });
    assert.equal(msg.type, MSG.METRICS);
    assert.equal(msg.cpu, 42);
    assert.equal(msg.memory, 70);
    assert.equal(msg.sessions, 5);
    assert.equal(msg.rtt, 12);
  });

  it('WshClient has requestMetrics method', async () => {
    const { WshClient } = await import('../packages/wsh/src/client.mjs');
    const client = new WshClient();
    assert.equal(typeof client.requestMetrics, 'function');
  });

  it('requestMetrics throws when not authenticated', async () => {
    const { WshClient } = await import('../packages/wsh/src/client.mjs');
    const client = new WshClient();
    await assert.rejects(() => client.requestMetrics(), /not authenticated|disconnected/i);
  });
});
