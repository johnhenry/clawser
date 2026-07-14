/**
 * clawser-pairing.mjs — Personal multi-device pairing flow.
 *
 * Source device exports its mesh identity (the W3C did:key) as an
 * encrypted bundle keyed by a 6-digit code. The bundle is rendered as
 * a QR-friendly text payload. Target device pastes/scans the payload,
 * enters the same code, and imports the identity — both devices now
 * share one did:key and can route sync traffic to themselves.
 *
 * Crypto:
 *   - PBKDF2-SHA256(code, salt, 100k) → AES-GCM-256 key
 *   - AES-GCM(key, IV, JSON.stringify(jwk)) → ciphertext
 *   - Encryption is brute-force resistant only for the 5-minute window;
 *     that's the design (a 6-digit code has ~20 bits of entropy).
 *
 * Replay / reuse protection:
 *   - Bundle has `expiresAt` baked in; expiry checked on consume.
 *   - Each pairing has a random `pairingId`; consumed IDs are recorded
 *     on the target so the same payload can't be applied twice.
 *
 * Public API:
 *   - generatePairingCode()             → '123456'
 *   - createPairingPayload({...})       → text payload (QR / paste)
 *   - parsePairingPayload(text)         → parsed envelope
 *   - consumePairingPayload(env, code, {storage}) → imported identity JWK
 *
 * The actual identity import is done by the caller (it has the
 * MeshIdentityManager). This module is purely about the pairing
 * envelope and code lifecycle.
 */

const PAIRING_VERSION = 'clawser-pair-v1';
const DEFAULT_TTL_MS = 5 * 60 * 1000; // 5 minutes
const PBKDF2_ITERATIONS = 100_000;
const SALT_BYTES = 16;
const IV_BYTES = 12;
const CONSUMED_KEY = '__paired_consumed_ids__';

// ── tiny base64 helpers ──────────────────────────────────────────

const b64encode = (bytes) => {
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
};
const b64decode = (s) => {
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
};

/**
 * Generate a fresh 6-digit pairing code. Cryptographically random — the
 * Math.random space (2^53) is fine here because the rejection-sampling
 * loop guarantees uniform distribution across 000000–999999.
 *
 * @returns {string} '000000'..'999999'
 */
export const generatePairingCode = () => {
  const buf = new Uint32Array(1);
  // Rejection-sample so the modulo doesn't bias the low digits.
  const limit = Math.floor(0x100000000 / 1_000_000) * 1_000_000;
  let n;
  do {
    crypto.getRandomValues(buf);
    n = buf[0];
  } while (n >= limit);
  return String(n % 1_000_000).padStart(6, '0');
};

/**
 * Generate a pairingId — random 16 bytes, base64-encoded, used for
 * replay protection. Not security-sensitive; just a stable handle.
 */
const generatePairingId = () => b64encode(crypto.getRandomValues(new Uint8Array(16)));

const validateCode = (code) => {
  if (typeof code !== 'string' || !/^\d{6}$/.test(code)) {
    throw new Error('Pairing code must be a 6-digit string');
  }
};

const deriveKey = async (code, salt, usages) => {
  const km = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(code), 'PBKDF2', false, ['deriveKey'],
  );
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations: PBKDF2_ITERATIONS, hash: 'SHA-256' },
    km,
    { name: 'AES-GCM', length: 256 },
    false,
    usages,
  );
};

/**
 * Build a pairing envelope. The caller has already obtained the JWK of
 * the identity to share (it's their job to call
 * `identityManager.export(podId)` first).
 *
 * @param {object} args
 * @param {object} args.identityJwk  - JWK (private key) to share
 * @param {string} args.code          - 6-digit code
 * @param {string} args.sourceLabel   - Human-readable source device label
 * @param {string} args.identityLabel - Label to attach to the imported identity
 * @param {number} [args.ttlMs]       - Lifetime in ms (default 5 min)
 * @param {() => number} [args.now]   - Injectable clock (tests)
 * @returns {Promise<string>} Text payload (QR-safe — base64 over JSON)
 */
export const createPairingPayload = async ({
  identityJwk, code, sourceLabel = 'Unnamed device', identityLabel = 'Paired identity',
  ttlMs = DEFAULT_TTL_MS, now = Date.now,
}) => {
  validateCode(code);
  if (!identityJwk || typeof identityJwk !== 'object') {
    throw new Error('identityJwk must be a JWK object');
  }
  const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES));
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const key = await deriveKey(code, salt, ['encrypt']);
  const ct = new Uint8Array(
    await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv }, key, new TextEncoder().encode(JSON.stringify(identityJwk)),
    ),
  );
  const env = {
    v: PAIRING_VERSION,
    pairingId: generatePairingId(),
    createdAt: now(),
    expiresAt: now() + ttlMs,
    sourceLabel,
    identityLabel,
    salt: b64encode(salt),
    iv: b64encode(iv),
    ciphertext: b64encode(ct),
  };
  // Wrap as base64-url-friendly text for QR rendering.
  return 'CLAWSER-PAIR:' + b64encode(new TextEncoder().encode(JSON.stringify(env)));
};

/**
 * Parse a pairing payload back into the envelope. Throws on malformed
 * input or version mismatch. Does NOT verify expiry or decrypt.
 *
 * @param {string} text
 * @returns {object} envelope
 */
export const parsePairingPayload = (text) => {
  if (typeof text !== 'string' || !text.startsWith('CLAWSER-PAIR:')) {
    throw new Error('Not a Clawser pairing payload');
  }
  let env;
  try {
    env = JSON.parse(new TextDecoder().decode(b64decode(text.slice('CLAWSER-PAIR:'.length))));
  } catch {
    throw new Error('Pairing payload is malformed');
  }
  if (env?.v !== PAIRING_VERSION) {
    throw new Error(`Unsupported pairing version: ${env?.v}`);
  }
  const required = ['pairingId', 'createdAt', 'expiresAt', 'salt', 'iv', 'ciphertext'];
  for (const k of required) {
    if (!(k in env)) throw new Error(`Pairing envelope missing field: ${k}`);
  }
  return env;
};

/**
 * Trivial OPFS-shaped storage interface for consumed-id tracking. In
 * production this delegates to the workspace OPFS layer; tests pass a
 * plain in-memory Map.
 *
 * @typedef {object} PairingStorage
 * @property {(key: string) => Promise<string|null>} read
 * @property {(key: string, value: string) => Promise<void>} write
 */

/**
 * Build an in-memory storage suitable for tests.
 * @returns {PairingStorage}
 */
export const createMemoryPairingStorage = () => {
  const map = new Map();
  return {
    async read(k) { return map.has(k) ? map.get(k) : null; },
    async write(k, v) { map.set(k, v); },
  };
};

/**
 * Decrypt a pairing envelope and import its identity JWK. The caller
 * also supplies a storage shim to track consumed pairingIds (to prevent
 * applying the same QR twice on the same target).
 *
 * @param {object} env       - parsed pairing envelope
 * @param {string} code      - 6-digit code typed by the user
 * @param {object} args
 * @param {PairingStorage}   [args.storage]  - consumed-id tracker
 * @param {() => number}     [args.now]      - injectable clock (tests)
 * @returns {Promise<{identityJwk: object, identityLabel: string, sourceLabel: string, pairingId: string}>}
 */
export const consumePairingPayload = async (env, code, { storage, now = Date.now } = {}) => {
  validateCode(code);
  if (!env || typeof env !== 'object') throw new Error('Pairing envelope is required');

  if (env.expiresAt < now()) {
    throw new Error('Pairing code has expired. Generate a new one on the source device.');
  }

  if (storage) {
    const consumed = await storage.read(CONSUMED_KEY);
    const ids = consumed ? JSON.parse(consumed) : [];
    if (Array.isArray(ids) && ids.includes(env.pairingId)) {
      throw new Error('This pairing payload was already consumed on this device.');
    }
  }

  let key, decrypted;
  try {
    const salt = b64decode(env.salt);
    const iv = b64decode(env.iv);
    key = await deriveKey(code, salt, ['decrypt']);
    decrypted = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv }, key, b64decode(env.ciphertext),
    );
  } catch {
    throw new Error('Wrong pairing code');
  }

  let jwk;
  try { jwk = JSON.parse(new TextDecoder().decode(decrypted)); }
  catch { throw new Error('Pairing payload is corrupted'); }

  // Mark consumed.
  if (storage) {
    const prev = await storage.read(CONSUMED_KEY);
    const ids = prev ? JSON.parse(prev) : [];
    if (!ids.includes(env.pairingId)) ids.push(env.pairingId);
    // Cap consumed list at last 200 to prevent unbounded growth.
    const trimmed = ids.slice(-200);
    await storage.write(CONSUMED_KEY, JSON.stringify(trimmed));
  }

  return {
    identityJwk: jwk,
    identityLabel: env.identityLabel || 'Paired identity',
    sourceLabel: env.sourceLabel || 'Unknown device',
    pairingId: env.pairingId,
  };
};

// ── helpers re-exported for testing ──────────────────────────────
export const _internals = { PAIRING_VERSION, DEFAULT_TTL_MS, PBKDF2_ITERATIONS };
