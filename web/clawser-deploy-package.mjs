/**
 * clawser-deploy-package.mjs — Signed deploy-package format.
 *
 * A deploy package is what a source device sends to a target device
 * when pushing skills/configs/etc. The package contains a manifest
 * (declared permissions + item list + version metadata) plus the item
 * payloads, signed by the source's mesh identity (Ed25519 private key
 * matching its `did:key`).
 *
 * On-the-wire shape:
 *   {
 *     v: 'clawser-deploy-v1',
 *     source: 'did:key:z6Mk...',     // sender's did:key
 *     counter: 1234,                 // monotonic per-source replay counter
 *     manifest: {                    // signed payload (canonical JSON)
 *       sourceLabel: 'My Mac',
 *       items: [{kind, itemId, payloadHash}],
 *       capabilities: { fs: [...], net: [...], mesh: [...] },
 *       createdAt: <ms>
 *     },
 *     payloads: {                    // not signed individually — payloadHash binds them to manifest
 *       '<itemId>': <bytes-or-json>
 *     },
 *     signature: '<base64>'          // sign(canonicalJson(manifest) + counter + source)
 *   }
 *
 * Verification on the target:
 *   1. Resolve the source's public key from `source` (did:key parsing).
 *   2. Verify the signature covers `source || counter || canonical(manifest)`.
 *   3. Check `counter > lastSeenCounter[source]`. Reject replay/equal.
 *   4. For each item, verify `sha256(payload) === payloadHash` — this is
 *      what binds payloads to the signature without signing each blob.
 *   5. ACL/approval checks happen in `clawser-deploy-acl.mjs`, not here.
 */

const PACKAGE_VERSION = 'clawser-deploy-v1';

// ── encoders ──────────────────────────────────────────────────────

const enc = new TextEncoder();
const dec = new TextDecoder();

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

// Canonical JSON: keys sorted at every object level; no whitespace.
// Used so source and target agree byte-for-byte on what was signed.
export const canonicalJson = (value) => {
  const seen = new WeakSet();
  const walk = (v) => {
    if (v === null || typeof v !== 'object') return JSON.stringify(v);
    if (Array.isArray(v)) return '[' + v.map(walk).join(',') + ']';
    if (seen.has(v)) throw new Error('canonicalJson: cycle');
    seen.add(v);
    const keys = Object.keys(v).sort();
    return '{' + keys.map(k => JSON.stringify(k) + ':' + walk(v[k])).join(',') + '}';
  };
  return walk(value);
};

/**
 * SHA-256 of a payload (Uint8Array or string), returned as hex.
 * @param {Uint8Array|string} payload
 * @returns {Promise<string>}
 */
export const sha256Hex = async (payload) => {
  const bytes = typeof payload === 'string' ? enc.encode(payload) : payload;
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  const arr = new Uint8Array(digest);
  let hex = '';
  for (let i = 0; i < arr.length; i++) hex += arr[i].toString(16).padStart(2, '0');
  return hex;
};

// ── the bytes a signature actually covers ────────────────────────

const signedRegion = (source, counter, manifestCanonical) =>
  enc.encode(`${PACKAGE_VERSION}|${source}|${counter}|${manifestCanonical}`);

/**
 * Build and sign a deploy package.
 *
 * @param {object} args
 * @param {string} args.source                 — did:key URI of the source
 * @param {CryptoKey} args.privateKey          — Ed25519 private key
 * @param {number} args.counter                — monotonic counter
 * @param {object} args.manifest               — items, capabilities, etc.
 * @param {Object<string, Uint8Array|string>} [args.payloads]  — itemId → bytes
 * @returns {Promise<object>} the on-the-wire package
 */
export const buildSignedPackage = async ({ source, privateKey, counter, manifest, payloads = {} }) => {
  if (typeof source !== 'string' || !source.startsWith('did:key:')) {
    throw new Error('source must be a did:key URI');
  }
  if (!Number.isInteger(counter) || counter < 0) {
    throw new Error('counter must be a non-negative integer');
  }

  // Bind every payload to the manifest via SHA-256 hash.
  const items = await Promise.all(
    (manifest.items || []).map(async (it) => {
      const payload = payloads[it.itemId];
      if (payload === undefined) {
        throw new Error(`buildSignedPackage: missing payload for ${it.itemId}`);
      }
      const payloadHash = await sha256Hex(payload);
      return { ...it, payloadHash };
    }),
  );
  const fullManifest = { ...manifest, items };
  const canon = canonicalJson(fullManifest);
  const region = signedRegion(source, counter, canon);
  const sig = await crypto.subtle.sign({ name: 'Ed25519' }, privateKey, region);

  return {
    v: PACKAGE_VERSION,
    source,
    counter,
    manifest: fullManifest,
    payloads: { ...payloads },
    signature: b64encode(new Uint8Array(sig)),
  };
};

/**
 * Verify a signed package against a known public key. Returns
 * `{ok, reason?, manifestHash}`. Does NOT enforce the replay counter
 * or ACL/approval — those are policy checks done by the caller.
 *
 * @param {object} pkg                  — output of buildSignedPackage (after JSON round-trip)
 * @param {CryptoKey} sourcePublicKey   — Ed25519 public key for `pkg.source`
 * @returns {Promise<{ok:boolean, reason?:string, manifestHash?:string}>}
 */
export const verifySignedPackage = async (pkg, sourcePublicKey) => {
  if (!pkg || pkg.v !== PACKAGE_VERSION) {
    return { ok: false, reason: `unsupported package version: ${pkg?.v}` };
  }
  if (typeof pkg.source !== 'string' || !pkg.source.startsWith('did:key:')) {
    return { ok: false, reason: 'malformed source' };
  }
  if (!Number.isInteger(pkg.counter) || pkg.counter < 0) {
    return { ok: false, reason: 'malformed counter' };
  }
  if (!pkg.manifest || typeof pkg.manifest !== 'object') {
    return { ok: false, reason: 'missing manifest' };
  }
  if (typeof pkg.signature !== 'string') {
    return { ok: false, reason: 'missing signature' };
  }

  const canon = canonicalJson(pkg.manifest);
  const region = signedRegion(pkg.source, pkg.counter, canon);
  let sigBytes;
  try { sigBytes = b64decode(pkg.signature); }
  catch { return { ok: false, reason: 'malformed signature encoding' }; }

  let verified;
  try { verified = await crypto.subtle.verify({ name: 'Ed25519' }, sourcePublicKey, sigBytes, region); }
  catch (e) { return { ok: false, reason: `signature verify error: ${e?.message || e}` }; }
  if (!verified) return { ok: false, reason: 'signature mismatch' };

  // Verify each declared item's payload hash matches what arrived.
  // Wrap sha256Hex so a malformed payload (e.g. JSON-roundtripped to an
  // object instead of Uint8Array) yields a clean reason string rather
  // than throwing — otherwise the caller's audit-log path is bypassed.
  const items = pkg.manifest.items || [];
  for (const it of items) {
    const payload = pkg.payloads?.[it.itemId];
    if (payload === undefined) return { ok: false, reason: `missing payload for ${it.itemId}` };
    if (typeof payload !== 'string' && !(payload instanceof Uint8Array)) {
      return { ok: false, reason: `malformed payload encoding for ${it.itemId}` };
    }
    let actual;
    try { actual = await sha256Hex(payload); }
    catch (e) { return { ok: false, reason: `payload hash error for ${it.itemId}: ${e?.message || e}` }; }
    if (actual !== it.payloadHash) {
      return { ok: false, reason: `payload hash mismatch for ${it.itemId}` };
    }
  }

  return { ok: true, manifestHash: await sha256Hex(canon) };
};

// ── replay-counter store ─────────────────────────────────────────

/**
 * Persistent monotonic-counter tracker. Each source has its own
 * highest-seen counter; an incoming package's counter MUST exceed it.
 * Equal counter is treated as replay (rejected).
 *
 * Storage shape: a JSON file at `__deploy_counters__` mapping source →
 * counter (numbers).
 */
const COUNTERS_FILE = '__deploy_counters__';

export class ReplayCounterTracker {
  #storage;
  #cache = null;

  constructor(storage) { this.#storage = storage; }

  async #load() {
    if (this.#cache) return this.#cache;
    const raw = await this.#storage.read(COUNTERS_FILE);
    if (!raw) { this.#cache = new Map(); return this.#cache; }
    try {
      const obj = JSON.parse(dec.decode(raw));
      this.#cache = new Map(Object.entries(obj));
    } catch {
      this.#cache = new Map();
    }
    return this.#cache;
  }

  async #persist() {
    const obj = Object.fromEntries(this.#cache || new Map());
    await this.#storage.write(COUNTERS_FILE, enc.encode(JSON.stringify(obj)));
  }

  /**
   * Check whether `(source, counter)` is fresh. If so, persist the new
   * counter and return true. If it's a replay or equal, return false
   * without modifying state.
   *
   * @param {string} source
   * @param {number} counter
   * @returns {Promise<boolean>}
   */
  async accept(source, counter) {
    const cache = await this.#load();
    const last = cache.get(source) ?? -1;
    if (counter <= last) return false;
    cache.set(source, counter);
    await this.#persist();
    return true;
  }

  /**
   * Inspect the last-seen counter for a source (testing / debug).
   * @param {string} source
   * @returns {Promise<number>} -1 if never seen
   */
  async lastSeen(source) {
    const cache = await this.#load();
    return cache.get(source) ?? -1;
  }
}

export const _deployPackageInternals = { PACKAGE_VERSION, signedRegion };
