/**
 * clawser-did-key.mjs — W3C `did:key:` URI parser for Ed25519 keys.
 *
 * Round-trips with `MeshIdentityManager.toDID(podId)`:
 *   toDID  : raw 32-byte pubkey → `did:key:z<base58btc(0xed 0x01 + raw)>`
 *   resolveDidKey : `did:key:z…` → CryptoKey usable for verification
 *
 * Multicodec prefix `0xed 0x01` is Ed25519 per the W3C did:key spec.
 * Other key types (P-256, secp256k1) are out of scope for this resolver
 * — Clawser identities are all Ed25519 today.
 */

const BASE58_ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
const ED25519_MULTICODEC = [0xed, 0x01];
const ED25519_RAW_PUBKEY_BYTES = 32;

/**
 * Decode a base58btc string (Bitcoin alphabet) to bytes. Inverse of
 * `base58btcEncode` in `clawser-mesh-identity.js`.
 *
 * @param {string} s
 * @returns {Uint8Array}
 * @throws {Error} On invalid characters
 */
export function base58btcDecode(s) {
  if (typeof s !== 'string') throw new Error('base58btcDecode: input must be a string');
  if (s.length === 0) return new Uint8Array(0);

  // Count leading '1's → leading zero bytes in the output
  let zeros = 0;
  while (zeros < s.length && s[zeros] === BASE58_ALPHABET[0]) zeros++;

  // Convert from base 58 → base 256 via repeated multiplication
  const bytes = []; // little-endian during accumulation; reversed at the end
  for (let i = zeros; i < s.length; i++) {
    const digit = BASE58_ALPHABET.indexOf(s[i]);
    if (digit < 0) throw new Error(`base58btcDecode: invalid character ${JSON.stringify(s[i])} at position ${i}`);
    let carry = digit;
    for (let j = 0; j < bytes.length; j++) {
      carry += bytes[j] * 58;
      bytes[j] = carry & 0xff;
      carry >>= 8;
    }
    while (carry > 0) {
      bytes.push(carry & 0xff);
      carry >>= 8;
    }
  }

  // Add the leading zero bytes
  const out = new Uint8Array(zeros + bytes.length);
  for (let i = 0; i < bytes.length; i++) out[zeros + bytes.length - 1 - i] = bytes[i];
  return out;
}

/**
 * Parse a W3C `did:key:z<…>` URI for an Ed25519 key. Returns the raw
 * 32-byte public key. Throws on malformed input or unsupported codec.
 *
 * @param {string} did
 * @returns {Uint8Array}
 */
export function parseDidKey(did) {
  if (typeof did !== 'string') throw new Error('parseDidKey: did must be a string');
  if (!did.startsWith('did:key:')) throw new Error(`parseDidKey: not a did:key URI: ${did.slice(0, 32)}`);
  const rest = did.slice('did:key:'.length);
  if (!rest.startsWith('z')) throw new Error('parseDidKey: only multibase "z" (base58btc) is supported');
  let bytes;
  try { bytes = base58btcDecode(rest.slice(1)); }
  catch (e) { throw new Error(`parseDidKey: base58btc decode failed: ${e.message}`); }
  if (bytes.length !== 2 + ED25519_RAW_PUBKEY_BYTES) {
    throw new Error(`parseDidKey: expected ${2 + ED25519_RAW_PUBKEY_BYTES} bytes (multicodec + 32-byte key), got ${bytes.length}`);
  }
  if (bytes[0] !== ED25519_MULTICODEC[0] || bytes[1] !== ED25519_MULTICODEC[1]) {
    throw new Error(`parseDidKey: unsupported multicodec 0x${bytes[0].toString(16).padStart(2, '0')} 0x${bytes[1].toString(16).padStart(2, '0')} (only Ed25519 0xed 0x01 is supported)`);
  }
  return bytes.slice(2);
}

/**
 * Resolve a `did:key:z…` URI to a Web Crypto `CryptoKey` for
 * Ed25519 signature verification. Throws on malformed input or
 * unsupported codec.
 *
 * @param {string} did
 * @returns {Promise<CryptoKey>}
 */
export async function resolveDidKey(did) {
  const rawPubKey = parseDidKey(did);
  return crypto.subtle.importKey(
    'raw',
    rawPubKey,
    { name: 'Ed25519' },
    true,
    ['verify'],
  );
}
