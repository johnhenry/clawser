import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { MSG, fileOp, fileResult, fileChunk } from '../packages/wsh/src/messages.gen.mjs';

describe('wsh structured file channel', () => {
  it('fileOp constructs correct message', () => {
    const msg = fileOp({ channelId: 1, op: 'stat', path: '/tmp/test.txt' });
    assert.equal(msg.type, MSG.FILE_OP);
    assert.equal(msg.channel_id, 1);
    assert.equal(msg.op, 'stat');
    assert.equal(msg.path, '/tmp/test.txt');
  });

  it('fileOp with offset and length', () => {
    const msg = fileOp({ channelId: 2, op: 'read', path: '/data', offset: 100, length: 50 });
    assert.equal(msg.offset, 100);
    assert.equal(msg.length, 50);
  });

  it('fileResult constructs correct message', () => {
    const msg = fileResult({ channelId: 1, success: true, metadata: { size: 1024 } });
    assert.equal(msg.type, MSG.FILE_RESULT);
    assert.equal(msg.success, true);
    assert.deepEqual(msg.metadata, { size: 1024 });
  });

  it('fileResult with error', () => {
    const msg = fileResult({ channelId: 1, success: false, errorMessage: 'not found' });
    assert.equal(msg.success, false);
    assert.equal(msg.error_message, 'not found');
  });

  it('fileChunk constructs correct message', () => {
    const data = new Uint8Array([1, 2, 3]);
    const msg = fileChunk({ channelId: 1, offset: 0, data, isFinal: true });
    assert.equal(msg.type, MSG.FILE_CHUNK);
    assert.equal(msg.offset, 0);
    assert.equal(msg.is_final, true);
  });

  it('WshClient has file operation methods', async () => {
    const { WshClient } = await import('../packages/wsh/src/client.mjs');
    const client = new WshClient();
    assert.equal(typeof client.fileOperation, 'function');
    assert.equal(typeof client.fileStat, 'function');
    assert.equal(typeof client.fileList, 'function');
    assert.equal(typeof client.fileRead, 'function');
    assert.equal(typeof client.fileWrite, 'function');
    assert.equal(typeof client.fileMkdir, 'function');
    assert.equal(typeof client.fileRemove, 'function');
    assert.equal(typeof client.fileRename, 'function');
  });

  it('FILE_OP is relay-forwardable', async () => {
    const { WshClient } = await import('../packages/wsh/src/client.mjs');
    const client = new WshClient();
    assert.ok(client._isRelayForwardable(MSG.FILE_OP));
  });
});
