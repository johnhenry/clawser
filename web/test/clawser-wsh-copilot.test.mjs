import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { MSG, copilotAttach, copilotSuggest, copilotDetach } from '../packages-wsh.js';

describe('wsh copilot mode', () => {
  it('copilotAttach constructs correct message', () => {
    const msg = copilotAttach({ sessionId: 'sess-1', model: 'gpt-4', contextWindow: 8192 });
    assert.equal(msg.type, MSG.COPILOT_ATTACH);
    assert.equal(msg.session_id, 'sess-1');
    assert.equal(msg.model, 'gpt-4');
    assert.equal(msg.context_window, 8192);
  });

  it('copilotSuggest constructs correct message', () => {
    const msg = copilotSuggest({ sessionId: 'sess-1', suggestion: 'ls -la', confidence: 0.95 });
    assert.equal(msg.type, MSG.COPILOT_SUGGEST);
    assert.equal(msg.session_id, 'sess-1');
    assert.equal(msg.suggestion, 'ls -la');
    assert.equal(msg.confidence, 0.95);
  });

  it('copilotDetach constructs correct message', () => {
    const msg = copilotDetach({ sessionId: 'sess-1', reason: 'user request' });
    assert.equal(msg.type, MSG.COPILOT_DETACH);
    assert.equal(msg.session_id, 'sess-1');
    assert.equal(msg.reason, 'user request');
  });

  it('WshClient has copilot methods', async () => {
    const { WshClient } = await import('../packages-wsh.js');
    const client = new WshClient();
    assert.equal(typeof client.copilotAttach, 'function');
    assert.equal(typeof client.copilotSuggest, 'function');
    assert.equal(typeof client.copilotDetach, 'function');
  });

  it('COPILOT_ATTACH and COPILOT_DETACH are relay-forwardable', async () => {
    const { WshClient } = await import('../packages-wsh.js');
    const client = new WshClient();
    assert.ok(client._isRelayForwardable(MSG.COPILOT_ATTACH));
    assert.ok(client._isRelayForwardable(MSG.COPILOT_DETACH));
  });

  it('WshClient has onCopilotSuggest callback', async () => {
    const { WshClient } = await import('../packages-wsh.js');
    const client = new WshClient();
    assert.equal(client.onCopilotSuggest, null);
  });
});
