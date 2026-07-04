// Run with: node --import ./web/test/_setup-globals.mjs --test web/test/clawser-tar.test.mjs
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  writeTar,
  readTar,
  writeTarFromObject,
  readTarToObject,
} from '../clawser-tar.mjs';

const enc = (s) => new TextEncoder().encode(s);

describe('writeTar / readTar — round trip', () => {
  it('round-trips a single small file', () => {
    const archive = writeTar([
      { name: 'foo.txt', content: enc('hello\n') },
    ]);
    const entries = readTar(archive);
    assert.equal(entries.length, 1);
    assert.equal(entries[0].name, 'foo.txt');
    assert.equal(new TextDecoder().decode(entries[0].content), 'hello\n');
    assert.equal(entries[0].type, 'file');
  });

  it('round-trips multiple files in different directories', () => {
    const files = {
      'config/autonomy.json': '{"level":"full"}',
      'config/identity.json': '{"name":"clawser"}',
      'data/memories/m1.json': '{"id":"m1"}',
      'README': 'top level',
    };
    const archive = writeTar(
      Object.entries(files).map(([name, content]) => ({ name, content: enc(content) }))
    );
    const entries = readTar(archive);
    assert.equal(entries.length, 4);
    const map = Object.fromEntries(entries.map(e => [e.name, new TextDecoder().decode(e.content)]));
    for (const [name, content] of Object.entries(files)) {
      assert.equal(map[name], content);
    }
  });

  it('handles empty files', () => {
    const archive = writeTar([
      { name: 'empty.txt', content: new Uint8Array(0) },
      { name: 'after.txt', content: enc('after') },
    ]);
    const entries = readTar(archive);
    assert.equal(entries.length, 2);
    assert.equal(entries[0].name, 'empty.txt');
    assert.equal(entries[0].content.length, 0);
    assert.equal(new TextDecoder().decode(entries[1].content), 'after');
  });

  it('handles files larger than one 512-byte block', () => {
    // 2000 bytes — should require 4 blocks (3 full + 1 partial = 2048 bytes padded)
    const big = enc('x'.repeat(2000));
    const archive = writeTar([{ name: 'big.bin', content: big }]);
    const entries = readTar(archive);
    assert.equal(entries.length, 1);
    assert.equal(entries[0].content.length, 2000);
    assert.equal(entries[0].content[0], 'x'.charCodeAt(0));
    assert.equal(entries[0].content[1999], 'x'.charCodeAt(0));
  });

  it('preserves UTF-8 content with multi-byte chars', () => {
    const text = 'héllo 世界 🎉';
    const archive = writeTar([{ name: 'utf8.txt', content: enc(text) }]);
    const entries = readTar(archive);
    assert.equal(new TextDecoder().decode(entries[0].content), text);
  });

  it('encodes directory entries with the typeflag', () => {
    const archive = writeTar([
      { name: 'dir', type: 'directory' },
      { name: 'dir/inner.txt', content: enc('inner') },
    ]);
    const entries = readTar(archive);
    assert.equal(entries.length, 2);
    assert.equal(entries[0].type, 'directory');
    assert.equal(entries[1].type, 'file');
  });

  it('preserves mtime and mode', () => {
    const mtime = 1700000000;
    const mode = 0o600;
    const archive = writeTar([{ name: 'private.key', content: enc('secret'), mtime, mode }]);
    const entries = readTar(archive);
    assert.equal(entries[0].mtime, mtime);
    assert.equal(entries[0].mode, mode);
  });

  it('uses default mode 644 for files and 755 for directories', () => {
    const archive = writeTar([
      { name: 'a.txt', content: enc('a') },
      { name: 'd', type: 'directory' },
    ]);
    const entries = readTar(archive);
    assert.equal(entries[0].mode, 0o644);
    assert.equal(entries[1].mode, 0o755);
  });

  it('terminates with two zero blocks (USTAR end-of-archive)', () => {
    const archive = writeTar([{ name: 'x', content: enc('x') }]);
    // Last 1024 bytes should be all zero
    const tail = archive.subarray(archive.length - 1024);
    for (let i = 0; i < tail.length; i++) {
      assert.equal(tail[i], 0, `expected zero at trailer offset ${i}`);
    }
  });

  it('writes ustar magic in the header', () => {
    const archive = writeTar([{ name: 'a', content: enc('a') }]);
    const magic = new TextDecoder().decode(archive.subarray(257, 263));
    assert.equal(magic, 'ustar\0');
  });

  it('handles names up to 255 bytes via prefix split', () => {
    // 200-byte path that won't fit in 100 but fits in 155+100
    const longDir = 'a/'.repeat(80); // 160 chars including slashes
    const name = longDir + 'leaf.txt';
    const archive = writeTar([{ name, content: enc('long') }]);
    const entries = readTar(archive);
    assert.equal(entries.length, 1);
    assert.equal(entries[0].name, name);
    assert.equal(new TextDecoder().decode(entries[0].content), 'long');
  });

  it('throws on names longer than 255 bytes', () => {
    const name = 'x/'.repeat(150);
    assert.throws(
      () => writeTar([{ name, content: enc('x') }]),
      /name too long/,
    );
  });
});

describe('readTar — error handling', () => {
  it('throws when given a non-Uint8Array', () => {
    assert.throws(() => readTar('not bytes'), /Uint8Array/);
  });

  it('returns empty array on an empty/zero-only archive', () => {
    const empty = new Uint8Array(1024); // two zero blocks only
    const entries = readTar(empty);
    assert.deepEqual(entries, []);
  });

  it('detects checksum corruption', () => {
    const archive = writeTar([{ name: 'x', content: enc('hello') }]);
    // Corrupt a header byte (e.g. flip a bit in the name)
    const corrupted = new Uint8Array(archive);
    corrupted[5] = 0xff;
    assert.throws(() => readTar(corrupted), /checksum mismatch/);
  });

  it('stops at the first end-of-archive marker, ignoring any trailing data', () => {
    const archive = writeTar([{ name: 'a', content: enc('a') }]);
    // Append 512 bytes of garbage past the trailer — readTar should not see it
    const padded = new Uint8Array(archive.length + 512);
    padded.set(archive, 0);
    padded.fill(0xee, archive.length);
    const entries = readTar(padded);
    assert.equal(entries.length, 1);
    assert.equal(entries[0].name, 'a');
  });
});

describe('writeTarFromObject / readTarToObject', () => {
  it('round-trips a flat object of files', () => {
    const files = { 'a.txt': 'AAA', 'b.json': '{"b":2}' };
    const archive = writeTarFromObject(files);
    const out = readTarToObject(archive);
    assert.deepEqual(out, files);
  });
});
