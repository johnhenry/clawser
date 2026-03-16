import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { MSG, policyEval, policyResult, policyUpdate } from '../packages-wsh.js';

describe('wsh policy engine', () => {
  it('policyEval constructs correct message', () => {
    const msg = policyEval({ requestId: 'req-1', action: 'exec', principal: 'alice', context: { tool: 'shell' } });
    assert.equal(msg.type, MSG.POLICY_EVAL);
    assert.equal(msg.request_id, 'req-1');
    assert.equal(msg.action, 'exec');
    assert.equal(msg.principal, 'alice');
    assert.deepEqual(msg.context, { tool: 'shell' });
  });

  it('policyResult constructs correct message', () => {
    const msg = policyResult({ requestId: 'req-1', allowed: true, reason: 'admin' });
    assert.equal(msg.type, MSG.POLICY_RESULT);
    assert.equal(msg.request_id, 'req-1');
    assert.equal(msg.allowed, true);
    assert.equal(msg.reason, 'admin');
  });

  it('policyUpdate constructs correct message', () => {
    const rules = { allow: ['exec'], deny: ['rm'] };
    const msg = policyUpdate({ policyId: 'pol-1', rules, version: 2 });
    assert.equal(msg.type, MSG.POLICY_UPDATE);
    assert.equal(msg.policy_id, 'pol-1');
    assert.deepEqual(msg.rules, rules);
    assert.equal(msg.version, 2);
  });

  it('WshClient has policy methods', async () => {
    const { WshClient } = await import('../packages-wsh.js');
    const client = new WshClient();
    assert.equal(typeof client.evaluatePolicy, 'function');
    assert.equal(typeof client.updatePolicy, 'function');
  });

  it('POLICY_EVAL is relay-forwardable', async () => {
    const { WshClient } = await import('../packages-wsh.js');
    const client = new WshClient();
    assert.ok(client._isRelayForwardable(MSG.POLICY_EVAL));
  });
});
