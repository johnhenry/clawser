import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { MSG, compressBegin, compressAck } from '../packages/wsh/src/messages.gen.mjs';

describe('wsh compression negotiation', () => {
  it('compressBegin constructs correct message', () => {
    const msg = compressBegin({ algorithm: 'zstd', level: 5 });
    assert.equal(msg.type, MSG.COMPRESS_BEGIN);
    assert.equal(msg.algorithm, 'zstd');
    assert.equal(msg.level, 5);
  });

  it('compressBegin defaults level to 3', () => {
    const msg = compressBegin({ algorithm: 'lz4' });
    assert.equal(msg.level, 3);
  });

  it('compressAck constructs correct message', () => {
    const msg = compressAck({ algorithm: 'zstd', accepted: true });
    assert.equal(msg.type, MSG.COMPRESS_ACK);
    assert.equal(msg.algorithm, 'zstd');
    assert.equal(msg.accepted, true);
  });

  it('compressAck can decline', () => {
    const msg = compressAck({ algorithm: 'lz4', accepted: false });
    assert.equal(msg.accepted, false);
  });

  it('WshClient has negotiateCompression method', async () => {
    const { WshClient } = await import('../packages/wsh/src/client.mjs');
    const client = new WshClient();
    assert.equal(typeof client.negotiateCompression, 'function');
  });
});
