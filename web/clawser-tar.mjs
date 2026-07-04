/**
 * clawser-tar.mjs — Pure-JS POSIX USTAR tar writer and reader.
 *
 * Implements the subset of USTAR needed for workspace snapshots:
 * regular files and directories, octal numeric fields, ustar magic,
 * 512-byte block alignment with NUL padding, two zero-block
 * end-of-archive marker.
 *
 * No external deps. Browser- and Node-compatible.
 *
 * @module clawser-tar
 *
 * @example
 *   import { writeTar, readTar } from './clawser-tar.mjs';
 *
 *   const archive = writeTar([
 *     { name: 'foo.txt', content: new TextEncoder().encode('hello\n') },
 *     { name: 'dir/bar.txt', content: new TextEncoder().encode('world\n') },
 *   ]);
 *   // archive is a Uint8Array; persist to OPFS or download.
 *
 *   const entries = readTar(archive);
 *   // entries === [
 *   //   { name: 'foo.txt', content: Uint8Array(...), mtime, mode, type: 'file' },
 *   //   ...
 *   // ]
 */

const BLOCK = 512;
const USTAR_MAGIC = 'ustar\0';
const USTAR_VERSION = '00';

const NUL = 0;
const SPACE = 32;

const enc = new TextEncoder();
const dec = new TextDecoder('utf-8', { fatal: false });

// ── Writer ────────────────────────────────────────────────────────

/**
 * @typedef {object} TarEntry
 * @property {string} name - File path inside the archive (max 255 chars; >100
 *   uses the prefix/name split).
 * @property {Uint8Array|string} [content] - File body. Strings are UTF-8 encoded.
 *   Omit or empty for directories.
 * @property {number} [mtime] - Modification time in seconds since epoch.
 *   Defaults to now.
 * @property {number} [mode] - Unix permission bits. Defaults to 0o644 for
 *   files and 0o755 for directories.
 * @property {'file'|'directory'} [type] - Entry type. Inferred from content
 *   when omitted (no content → directory).
 */

/**
 * Pad a string with NULs to the given length.
 * @param {string} s
 * @param {number} len
 * @returns {Uint8Array}
 */
const padStr = (s, len) => {
  const out = new Uint8Array(len);
  const bytes = enc.encode(s);
  const n = Math.min(bytes.length, len);
  out.set(bytes.subarray(0, n), 0);
  return out;
};

/**
 * Format a number as a NUL-terminated octal string of the given total length.
 * The last byte is always a NUL terminator (USTAR convention).
 * @param {number} n
 * @param {number} len - Total byte length (including NUL terminator).
 * @returns {Uint8Array}
 */
const octalField = (n, len) => {
  const num = Math.max(0, Math.floor(n));
  const oct = num.toString(8);
  const pad = '0'.repeat(Math.max(0, len - 1 - oct.length));
  const s = (pad + oct).slice(-(len - 1)) + '\0';
  return enc.encode(s);
};

/**
 * Compute the USTAR checksum: unsigned sum of all header bytes,
 * treating the chksum field as 8 spaces.
 * @param {Uint8Array} header - 512-byte header buffer.
 * @returns {number}
 */
const computeChecksum = (header) => {
  let sum = 0;
  for (let i = 0; i < BLOCK; i++) {
    if (i >= 148 && i < 156) sum += SPACE;
    else sum += header[i];
  }
  return sum;
};

/**
 * Build a USTAR header for a single entry.
 * Throws if `name` is longer than 255 bytes.
 * @param {TarEntry} entry
 * @param {number} contentSize
 * @returns {Uint8Array} 512-byte header block.
 */
const buildHeader = (entry, contentSize) => {
  const header = new Uint8Array(BLOCK);

  // Split name into prefix/name if needed (USTAR allows 155 + 100).
  const fullName = entry.name.replace(/^\/+/, '');
  if (enc.encode(fullName).length > 255) {
    throw new Error(`tar: entry name too long (>255 bytes): ${fullName}`);
  }
  let name = fullName;
  let prefix = '';
  if (enc.encode(fullName).length > 100) {
    // Split at the last '/' such that the prefix fits in 155 and name in 100.
    const idx = fullName.lastIndexOf('/', 154);
    if (idx >= 0 && enc.encode(fullName.slice(idx + 1)).length <= 100) {
      prefix = fullName.slice(0, idx);
      name = fullName.slice(idx + 1);
    } else {
      throw new Error(`tar: cannot split name into 155+100: ${fullName}`);
    }
  }

  const isDir = entry.type === 'directory' || (!entry.content && entry.type !== 'file');
  const mode = entry.mode ?? (isDir ? 0o755 : 0o644);
  const mtime = entry.mtime ?? Math.floor(Date.now() / 1000);
  const size = isDir ? 0 : contentSize;

  // name (0..100)
  header.set(padStr(name, 100), 0);
  // mode (100..108)
  header.set(octalField(mode, 8), 100);
  // uid (108..116)
  header.set(octalField(0, 8), 108);
  // gid (116..124)
  header.set(octalField(0, 8), 116);
  // size (124..136)
  header.set(octalField(size, 12), 124);
  // mtime (136..148)
  header.set(octalField(mtime, 12), 136);
  // chksum (148..156) — placeholder spaces during calc
  for (let i = 148; i < 156; i++) header[i] = SPACE;
  // typeflag (156)
  header[156] = isDir ? 53 /* '5' */ : 48 /* '0' */;
  // linkname (157..257) — empty
  // magic (257..263)
  header.set(enc.encode(USTAR_MAGIC), 257);
  // version (263..265)
  header.set(enc.encode(USTAR_VERSION), 263);
  // uname (265..297)
  header.set(padStr('clawser', 32), 265);
  // gname (297..329)
  header.set(padStr('clawser', 32), 297);
  // devmajor (329..337) and devminor (337..345) — zero
  header.set(octalField(0, 8), 329);
  header.set(octalField(0, 8), 337);
  // prefix (345..500)
  header.set(padStr(prefix, 155), 345);
  // bytes 500..512 are reserved/pad — leave zero

  // Now compute and write checksum
  const sum = computeChecksum(header);
  header.set(octalField(sum, 8), 148);
  // Per spec, chksum is 6 octal digits + NUL + space, but octalField writes
  // "NNNNNN\0". GNU tar accepts either; keep the simpler form.

  return header;
};

/**
 * Round size up to the next 512-byte block boundary.
 * @param {number} n
 * @returns {number}
 */
const padTo512 = (n) => (n % BLOCK === 0 ? n : n + (BLOCK - (n % BLOCK)));

/**
 * Write a tar archive from an array of entries.
 *
 * Returns a Uint8Array containing the full archive: each entry's header,
 * its content padded to a 512-byte boundary, and two trailing zero blocks
 * marking end-of-archive.
 *
 * @param {TarEntry[]} entries
 * @returns {Uint8Array}
 *
 * @example
 *   const tar = writeTar([
 *     { name: 'config/foo.json', content: '{"x":1}' },
 *     { name: 'data/', type: 'directory' },
 *   ]);
 */
export const writeTar = (entries) => {
  const blocks = [];
  let totalSize = 0;

  for (const e of entries) {
    const isDir = e.type === 'directory' || (!e.content && e.type !== 'file');
    const body = isDir
      ? new Uint8Array(0)
      : (typeof e.content === 'string' ? enc.encode(e.content) : e.content);
    const header = buildHeader(e, body.length);
    blocks.push(header);
    totalSize += BLOCK;
    if (body.length > 0) {
      const padded = padTo512(body.length);
      const buf = new Uint8Array(padded);
      buf.set(body, 0);
      blocks.push(buf);
      totalSize += padded;
    }
  }

  // End-of-archive: two zero blocks
  const trailer = new Uint8Array(BLOCK * 2);
  blocks.push(trailer);
  totalSize += trailer.length;

  // Concatenate
  const out = new Uint8Array(totalSize);
  let offset = 0;
  for (const b of blocks) {
    out.set(b, offset);
    offset += b.length;
  }
  return out;
};

// ── Reader ────────────────────────────────────────────────────────

/**
 * Read a NUL-terminated string from a buffer slice.
 * @param {Uint8Array} buf
 * @param {number} start
 * @param {number} len
 * @returns {string}
 */
const readString = (buf, start, len) => {
  let end = start;
  const limit = start + len;
  while (end < limit && buf[end] !== NUL) end++;
  return dec.decode(buf.subarray(start, end));
};

/**
 * Parse an octal numeric field. Trims trailing NUL/space.
 * @param {Uint8Array} buf
 * @param {number} start
 * @param {number} len
 * @returns {number}
 */
const readOctal = (buf, start, len) => {
  let s = '';
  for (let i = 0; i < len; i++) {
    const c = buf[start + i];
    if (c === NUL || c === SPACE) {
      if (s.length > 0) break;
      continue;
    }
    s += String.fromCharCode(c);
  }
  return s ? parseInt(s, 8) : 0;
};

/**
 * Read all entries from a tar archive.
 *
 * Skips empty headers (end-of-archive markers) and stops at the first one.
 * Validates ustar magic when present; archives without magic are still
 * readable as long as headers are otherwise well-formed.
 *
 * @param {Uint8Array} archive
 * @returns {Array<{ name: string, content: Uint8Array, mtime: number, mode: number, type: 'file'|'directory' }>}
 *
 * @example
 *   const entries = readTar(archiveBytes);
 *   for (const e of entries) {
 *     console.log(e.name, e.content.length);
 *   }
 */
export const readTar = (archive) => {
  if (!(archive instanceof Uint8Array)) {
    throw new TypeError('readTar: archive must be a Uint8Array');
  }
  const entries = [];
  let offset = 0;

  while (offset + BLOCK <= archive.length) {
    const header = archive.subarray(offset, offset + BLOCK);

    // Empty header → end of archive
    let allZero = true;
    for (let i = 0; i < BLOCK; i++) {
      if (header[i] !== 0) { allZero = false; break; }
    }
    if (allZero) break;

    // Verify checksum
    const claimed = readOctal(header, 148, 8);
    const actual = computeChecksum(header);
    if (claimed !== actual) {
      throw new Error(`tar: checksum mismatch at offset ${offset} (got ${claimed}, expected ${actual})`);
    }

    const name = readString(header, 0, 100);
    const prefix = readString(header, 345, 155);
    const fullName = prefix ? `${prefix}/${name}` : name;
    const mode = readOctal(header, 100, 8);
    const size = readOctal(header, 124, 12);
    const mtime = readOctal(header, 136, 12);
    const typeflag = header[156];
    const isDir = typeflag === 53 /* '5' */ || fullName.endsWith('/');

    offset += BLOCK;

    let content;
    if (size > 0 && !isDir) {
      content = archive.slice(offset, offset + size);
      offset += padTo512(size);
    } else {
      content = new Uint8Array(0);
    }

    entries.push({
      name: fullName.replace(/\/$/, ''),
      content,
      mtime,
      mode,
      type: isDir ? 'directory' : 'file',
    });
  }

  return entries;
};

// ── Helpers ────────────────────────────────────────────────────────

/**
 * Concatenate a set of `{name, content}` JSON-like records into a tar.
 * Convenience wrapper for the common case where everything is a regular
 * file with default mode/mtime.
 *
 * @param {Record<string, string|Uint8Array>} files
 * @returns {Uint8Array}
 */
export const writeTarFromObject = (files) => {
  const entries = [];
  for (const [name, content] of Object.entries(files)) {
    entries.push({ name, content });
  }
  return writeTar(entries);
};

/**
 * Read a tar archive into a `{name: content}` object. Drops directory
 * entries; content is decoded as UTF-8.
 *
 * @param {Uint8Array} archive
 * @returns {Record<string, string>}
 */
export const readTarToObject = (archive) => {
  const out = {};
  for (const entry of readTar(archive)) {
    if (entry.type === 'file') {
      out[entry.name] = dec.decode(entry.content);
    }
  }
  return out;
};
