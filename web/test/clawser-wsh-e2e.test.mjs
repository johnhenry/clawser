import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { MSG, keyExchange, encryptedFrame } from '../packages/wsh/src/messages.gen.mjs';

describe('wsh E2E encryption', () => {
  it('keyExchange constructs correct message', () => {
    const pubKey = new Uint8Array(32);
    const msg = keyExchange({ algorithm: 'X25519', publicKey: pubKey, sessionId: 'sess-1' });
    assert.equal(msg.type, MSG.KEY_EXCHANGE);
    assert.equal(msg.algorithm, 'X25519');
    assert.equal(msg.public_key, pubKey);
    assert.equal(msg.session_id, 'sess-1');
  });

  it('encryptedFrame constructs correct message', () => {
    const nonce = new Uint8Array(12);
    const ciphertext = new Uint8Array(64);
    const msg = encryptedFrame({ nonce, ciphertext, sessionId: 'sess-1' });
    assert.equal(msg.type, MSG.ENCRYPTED_FRAME);
    assert.equal(msg.nonce, nonce);
    assert.equal(msg.ciphertext, ciphertext);
    assert.equal(msg.session_id, 'sess-1');
  });

  it('WshClient has initiateE2E method', async () => {
    const { WshClient } = await import('../packages/wsh/src/client.mjs');
    const client = new WshClient();
    assert.equal(typeof client.initiateE2E, 'function');
  });

  it('WshClient has onKeyExchange callback', async () => {
    const { WshClient } = await import('../packages/wsh/src/client.mjs');
    const client = new WshClient();
    assert.equal(client.onKeyExchange, null);
  });

  it('initiateE2E throws when not authenticated', async () => {
    const { WshClient } = await import('../packages/wsh/src/client.mjs');
    const client = new WshClient();
    await assert.rejects(() => client.initiateE2E('sess-1'), /not authenticated|disconnected/i);
  });
});
