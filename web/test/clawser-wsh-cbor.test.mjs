import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { cborDecode } from '../packages-wsh.js';

describe('wsh cbor decoder', () => {
  it('decodes indefinite-length maps from Rust encoders', () => {
    const data = new Uint8Array([
      0xbf,
      0x64, 0x74, 0x79, 0x70, 0x65, 0x02,
      0x68, 0x66, 0x65, 0x61, 0x74, 0x75, 0x72, 0x65, 0x73, 0x9f,
      0x67, 0x72, 0x65, 0x76, 0x65, 0x72, 0x73, 0x65,
      0xff,
      0xff,
    ]);

    assert.deepEqual(cborDecode(data), {
      type: 2,
      features: ['reverse'],
    });
  });

  it('decodes indefinite-length byte and text strings', () => {
    const bytes = cborDecode(new Uint8Array([0x5f, 0x42, 0x01, 0x02, 0x41, 0x03, 0xff]));
    const text = cborDecode(new Uint8Array([0x7f, 0x62, 0x68, 0x65, 0x63, 0x6c, 0x6c, 0x6f, 0xff]));

    assert.deepEqual(Array.from(bytes), [1, 2, 3]);
    assert.equal(text, 'hello');
  });
});
