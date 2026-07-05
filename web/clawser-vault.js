import { silentCatch } from './clawser-silent-catch.mjs'
// clawser-vault.js — Encrypted secret storage using Web Crypto API
//
// v2 (current): wrapped-DEK model. A single 256-bit AES-GCM data key
// (the DEK) encrypts every secret. The DEK is wrapped by one or more
// KEKs (key-encryption keys), each derived from a different unlock
// material — passphrase (PBKDF2) today, WebAuthn PRF output tomorrow.
// All wraps are listed in __vault_meta__. To rotate a passphrase or
// add a passkey, we just rewrap the DEK; secrets are not touched.
//
// v1 (legacy, auto-migrated on first unlock): direct passphrase-key
// encryption. A PBKDF2-derived AES-GCM key encrypted secrets directly,
// so a passphrase change required re-encrypting everything. Detected
// by the presence of __vault_salt__ and absence of __vault_meta__.
//
// Storage backends are pluggable: OPFSVaultStorage for production,
// MemoryVaultStorage for testing.

// ── Crypto primitives ────────────────────────────────────────────

const PBKDF2_ITERATIONS = 600_000; // OWASP recommendation
const AES_KEY_LENGTH = 256;
const IV_BYTES = 12;  // 96-bit IV for AES-GCM
const SALT_BYTES = 16;
const DEK_BYTES = 32; // 256-bit AES-GCM master key

/**
 * Derive an AES-GCM key from a passphrase using PBKDF2 (legacy v1 API).
 *
 * The result has `encrypt`/`decrypt` usages — used directly to encrypt
 * each secret in v1 vaults. For v2 vaults, prefer `deriveKekFromPassphrase`
 * which produces a wrap-only key.
 *
 * @param {string} passphrase
 * @param {Uint8Array} salt - 16-byte salt
 * @returns {Promise<CryptoKey>}
 */
export async function deriveKey(passphrase, salt) {
  const encoder = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    encoder.encode(passphrase),
    'PBKDF2',
    false,
    ['deriveKey'],
  );

  return crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt,
      iterations: PBKDF2_ITERATIONS,
      hash: 'SHA-256',
    },
    keyMaterial,
    { name: 'AES-GCM', length: AES_KEY_LENGTH },
    false,
    ['encrypt', 'decrypt'],
  );
}

/**
 * Derive a KEK (key-encryption key) from a passphrase using PBKDF2.
 * The KEK has `wrapKey`/`unwrapKey` usages and is used to wrap the DEK.
 *
 * @param {string} passphrase
 * @param {Uint8Array} salt
 * @param {number} [iterations=PBKDF2_ITERATIONS]
 * @returns {Promise<CryptoKey>}
 */
export async function deriveKekFromPassphrase(passphrase, salt, iterations = PBKDF2_ITERATIONS) {
  const encoder = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    'raw', encoder.encode(passphrase), 'PBKDF2', false, ['deriveKey'],
  );
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations, hash: 'SHA-256' },
    keyMaterial,
    { name: 'AES-GCM', length: AES_KEY_LENGTH },
    false,
    ['wrapKey', 'unwrapKey'],
  );
}

/**
 * Derive a KEK from WebAuthn PRF extension output. PRF returns a stable
 * 32-byte secret that's deterministic per (credential, salt) pair, so
 * the same passkey always yields the same KEK.
 *
 * @param {Uint8Array} prfOutput - 32-byte PRF result from a WebAuthn assertion
 * @returns {Promise<CryptoKey>}
 */
export async function deriveKekFromPrf(prfOutput) {
  if (!(prfOutput instanceof Uint8Array) || prfOutput.length < 32) {
    throw new Error('PRF output must be a Uint8Array of at least 32 bytes');
  }
  return crypto.subtle.importKey(
    'raw',
    prfOutput.slice(0, 32),
    { name: 'AES-GCM', length: AES_KEY_LENGTH },
    false,
    ['wrapKey', 'unwrapKey'],
  );
}

/**
 * Encrypt plaintext with AES-GCM (legacy v1 helper, kept for compatibility).
 * @param {string} plaintext
 * @param {CryptoKey} derivedKey
 * @returns {Promise<{iv: Uint8Array, ciphertext: Uint8Array}>}
 */
export async function encryptSecret(plaintext, derivedKey) {
  const encoder = new TextEncoder();
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));

  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    derivedKey,
    encoder.encode(plaintext),
  );

  return { iv, ciphertext: new Uint8Array(ciphertext) };
}

/**
 * Decrypt ciphertext with AES-GCM (legacy v1 helper).
 * @param {{iv: Uint8Array, ciphertext: Uint8Array}} encrypted
 * @param {CryptoKey} derivedKey
 * @returns {Promise<string>}
 */
export async function decryptSecret(encrypted, derivedKey) {
  const plaintext = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: encrypted.iv },
    derivedKey,
    encrypted.ciphertext,
  );

  return new TextDecoder().decode(plaintext);
}

/**
 * Generate a fresh DEK (data-encryption key) for a v2 vault.
 * The key is `extractable: true` so it can be wrapped by KEKs; consumers
 * encrypt/decrypt secrets with it directly during a session.
 * @returns {Promise<CryptoKey>}
 */
export async function generateDek() {
  return crypto.subtle.generateKey(
    { name: 'AES-GCM', length: AES_KEY_LENGTH },
    true,
    ['encrypt', 'decrypt'],
  );
}

/**
 * Wrap a DEK with a KEK. Returns the IV + wrapped bytes; the caller
 * stores them in the vault meta entry.
 * @param {CryptoKey} dek
 * @param {CryptoKey} kek
 * @returns {Promise<{iv: Uint8Array, wrappedDek: Uint8Array}>}
 */
export async function wrapDek(dek, kek) {
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const wrapped = await crypto.subtle.wrapKey('raw', dek, kek, { name: 'AES-GCM', iv });
  return { iv, wrappedDek: new Uint8Array(wrapped) };
}

/**
 * Unwrap a DEK with a KEK. Throws if the KEK is wrong (AES-GCM auth tag
 * mismatch) — callers use this to detect invalid passphrases / passkeys.
 * @param {{iv: Uint8Array, wrappedDek: Uint8Array}} wrap
 * @param {CryptoKey} kek
 * @returns {Promise<CryptoKey>}
 */
export async function unwrapDek(wrap, kek) {
  return crypto.subtle.unwrapKey(
    'raw',
    wrap.wrappedDek,
    kek,
    { name: 'AES-GCM', iv: wrap.iv },
    { name: 'AES-GCM', length: AES_KEY_LENGTH },
    true,
    ['encrypt', 'decrypt'],
  );
}

// ── Passphrase Strength ──────────────────────────────────────────

const COMMON_PASSWORDS = new Set([
  'password', 'password1', 'password123', '123456', '123456789', 'qwerty',
  'abc123', 'letmein', 'admin', 'welcome', 'monkey', 'dragon', 'master',
  'login', 'princess', 'starwars', 'passw0rd', 'shadow', 'sunshine',
  'trustno1', 'iloveyou', 'batman', 'football', 'charlie', 'donald',
]);

/**
 * Measure passphrase strength.
 * @param {string} passphrase
 * @returns {{ score: number, entropy: number, label: string }}
 */
export function measurePassphraseStrength(passphrase) {
  if (!passphrase || passphrase.length === 0) {
    return { score: 0, entropy: 0, label: 'none' };
  }

  // Calculate character set size
  let charsetSize = 0;
  if (/[a-z]/.test(passphrase)) charsetSize += 26;
  if (/[A-Z]/.test(passphrase)) charsetSize += 26;
  if (/[0-9]/.test(passphrase)) charsetSize += 10;
  if (/[^a-zA-Z0-9]/.test(passphrase)) charsetSize += 32;
  if (charsetSize === 0) charsetSize = 26; // fallback

  // Entropy = length × log2(charsetSize)
  let entropy = passphrase.length * Math.log2(charsetSize);

  // Penalize common passwords
  if (COMMON_PASSWORDS.has(passphrase.toLowerCase())) {
    entropy = Math.min(entropy, 10);
  }

  // Penalize repetitive patterns
  if (/^(.)\1+$/.test(passphrase)) {
    entropy *= 0.3;
  }

  // Score: 0-4 based on entropy
  let score;
  if (entropy < 15) score = 0;
  else if (entropy < 25) score = 1;
  else if (entropy < 40) score = 2;
  else if (entropy < 60) score = 3;
  else score = 4;

  const labels = ['none', 'weak', 'fair', 'strong', 'very strong'];
  return { score, entropy: Math.round(entropy * 100) / 100, label: labels[score] };
}

// ── Storage backends ─────────────────────────────────────────────

/**
 * In-memory vault storage for testing.
 */
export class MemoryVaultStorage {
  #data = new Map();

  async read(name) {
    const packed = this.#data.get(name);
    return packed ? new Uint8Array(packed) : null;
  }

  async write(name, packed) {
    this.#data.set(name, new Uint8Array(packed));
  }

  async remove(name) {
    this.#data.delete(name);
  }

  async list() {
    return [...this.#data.keys()];
  }
}

/**
 * OPFS-based vault storage for production.
 * Stores encrypted secrets in /clawser_vault/{name}.enc
 */
export class OPFSVaultStorage {
  #dirName;
  #quotaGuard;

  /**
   * @param {string} [dirName]
   * @param {{ guard: (sizeBytes: number, op: string) => Promise<{ok: boolean, reason?: string}> }} [opts]
   *   Optional pre-write quota guard (see clawser-quota-guard.mjs). Injected
   *   rather than imported directly so this module stays dependency-free;
   *   production wiring supplies `guardBeforeWrite`. Defaults to always-allow.
   */
  constructor(dirName = 'clawser_vault', opts = {}) {
    this.#dirName = dirName;
    this.#quotaGuard = opts.guard || (async () => ({ ok: true }));
  }

  async #getDir() {
    const root = await navigator.storage.getDirectory();
    return root.getDirectoryHandle(this.#dirName, { create: true });
  }

  async read(name) {
    try {
      const dir = await this.#getDir();
      const fh = await dir.getFileHandle(`${name}.enc`);
      const file = await fh.getFile();
      return new Uint8Array(await file.arrayBuffer());
    } catch {
      return null;
    }
  }

  async write(name, packed) {
    const guard = await this.#quotaGuard(packed.byteLength, `vault write (${name})`);
    if (!guard.ok) throw new Error(guard.reason || 'Storage quota guard denied vault write');
    const dir = await this.#getDir();
    const fh = await dir.getFileHandle(`${name}.enc`, { create: true });
    const writable = await fh.createWritable();
    await writable.write(packed);
    await writable.close();
  }

  async remove(name) {
    try {
      const dir = await this.#getDir();
      await dir.removeEntry(`${name}.enc`);
    } catch { /* entry may not exist */ }
  }

  async list() {
    const dir = await this.#getDir();
    const names = [];
    for await (const [entry] of dir) {
      if (entry.endsWith('.enc')) names.push(entry.slice(0, -4));
    }
    return names;
  }
}

// ── Pack/Unpack ──────────────────────────────────────────────────

/** Pack IV + ciphertext into a single Uint8Array: [iv (12)] [ciphertext (rest)] */
function pack(iv, ciphertext) {
  const packed = new Uint8Array(IV_BYTES + ciphertext.length);
  packed.set(iv, 0);
  packed.set(ciphertext, IV_BYTES);
  return packed;
}

/** Unpack a packed Uint8Array into IV + ciphertext */
function unpack(packed) {
  return {
    iv: packed.slice(0, IV_BYTES),
    ciphertext: packed.slice(IV_BYTES),
  };
}

// ── Base64 helpers (meta payload uses base64 for binary fields) ──

function b64encode(bytes) {
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}
function b64decode(s) {
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

// ── Storage names (internal/reserved) ────────────────────────────

const SALT_KEY = '__vault_salt__';   // legacy v1 — kept until migration cleanup
const META_KEY = '__vault_meta__';   // v2 metadata
const CANARY_KEY = '__vault_canary__'; // legacy v1 — dropped during migration
const NEXT_SUFFIX = '.next';          // staged secrets during migration

const RESERVED_NAMES = new Set([SALT_KEY, META_KEY, CANARY_KEY]);

/**
 * Internal-only entries that should not appear in `list()` and should
 * not be migrated as user secrets.
 */
function isReserved(name) {
  return RESERVED_NAMES.has(name) || name.endsWith(NEXT_SUFFIX);
}

// ── Meta serialization ───────────────────────────────────────────

const META_VERSION = 2;
const META_MIME = new TextEncoder();
const META_DECODER = new TextDecoder();

/**
 * Encode a meta object to bytes for storage.
 * Wrap binary fields are base64-encoded for JSON friendliness.
 * @param {object} meta
 * @returns {Uint8Array}
 */
function encodeMeta(meta) {
  const json = {
    version: meta.version,
    createdAt: meta.createdAt,
    // Vault-level PRF salt — shared by every passkey wrap. The PRF output
    // is per-(credential, salt) deterministic, so one salt is sufficient
    // and lets every passkey unlock without per-wrap salt coordination.
    ...(meta.prfSalt ? { prfSalt: b64encode(meta.prfSalt) } : {}),
    wraps: meta.wraps.map(w => ({
      id: w.id,
      kind: w.kind,
      label: w.label ?? null,
      createdAt: w.createdAt,
      lastUsedAt: w.lastUsedAt ?? null,
      iv: b64encode(w.iv),
      wrappedDek: b64encode(w.wrappedDek),
      // passphrase/recovery (both PBKDF2-derived):
      ...(w.kind === 'passphrase' || w.kind === 'recovery' ? {
        salt: b64encode(w.salt),
        iterations: w.iterations,
      } : {}),
      // passkey-only:
      ...(w.kind === 'passkey' ? {
        credentialId: b64encode(w.credentialId),
      } : {}),
    })),
  };
  return META_MIME.encode(JSON.stringify(json));
}

function decodeMeta(bytes) {
  const json = JSON.parse(META_DECODER.decode(bytes));
  if (!json || typeof json !== 'object' || json.version !== META_VERSION) {
    throw new Error(`Unsupported vault meta version: ${json?.version}`);
  }
  if (!Array.isArray(json.wraps)) throw new Error('Vault meta missing wraps array');
  return {
    version: json.version,
    createdAt: json.createdAt,
    prfSalt: json.prfSalt ? b64decode(json.prfSalt) : null,
    wraps: json.wraps.map(w => ({
      id: w.id,
      kind: w.kind,
      label: w.label ?? null,
      createdAt: w.createdAt,
      lastUsedAt: w.lastUsedAt ?? null,
      iv: b64decode(w.iv),
      wrappedDek: b64decode(w.wrappedDek),
      ...(w.kind === 'passphrase' || w.kind === 'recovery' ? {
        salt: b64decode(w.salt),
        iterations: w.iterations,
      } : {}),
      ...(w.kind === 'passkey' ? {
        credentialId: b64decode(w.credentialId),
      } : {}),
    })),
  };
}

function newWrapId(prefix) {
  // Time-prefixed random id; not security-sensitive, just a stable handle.
  const r = crypto.getRandomValues(new Uint8Array(8));
  return `${prefix}-${Date.now().toString(36)}-${b64encode(r).replace(/[+/=]/g, '').slice(0, 8)}`;
}

// ── Recovery codes ───────────────────────────────────────────────

// No 0/O/1/I/L to keep hand-typed codes unambiguous
const RECOVERY_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const RECOVERY_GROUPS = 5;
const RECOVERY_GROUP_LEN = 4;

/**
 * Generate a random recovery code like "K3PF-9XQW-M2VH-T7RD-J4NB".
 * ~99 bits of entropy across 20 characters.
 * @returns {string}
 */
export function generateRecoveryCode() {
  const bytes = crypto.getRandomValues(new Uint8Array(RECOVERY_GROUPS * RECOVERY_GROUP_LEN));
  const groups = [];
  for (let g = 0; g < RECOVERY_GROUPS; g++) {
    let group = '';
    for (let i = 0; i < RECOVERY_GROUP_LEN; i++) {
      group += RECOVERY_ALPHABET[bytes[g * RECOVERY_GROUP_LEN + i] % RECOVERY_ALPHABET.length];
    }
    groups.push(group);
  }
  return groups.join('-');
}

/** Normalize user input: uppercase, strip separators. */
const normalizeRecoveryCode = (code) => String(code).toUpperCase().replace(/[^A-Z0-9]/g, '');

// ── SecretVault ──────────────────────────────────────────────────

/**
 * Encrypted secret storage. v2 (current): wrapped-DEK with multiple
 * unlock paths. v1 legacy vaults are auto-migrated on first unlock.
 *
 * Usage:
 *   const vault = new SecretVault(new OPFSVaultStorage());
 *   await vault.unlock('my passphrase');
 *   await vault.store('openai-key', 'sk-...');
 *   const key = await vault.retrieve('openai-key');
 *   vault.lock();
 *
 * Recovery paths: a passkey wrap (`addPasskeyWrap`) and/or a recovery
 * code (`setupRecovery`/`recoverWithCode`) — each is just another KEK
 * wrap of the DEK, so enrolling them never re-encrypts secrets.
 */
export class SecretVault {
  #dek = null;          // CryptoKey (AES-GCM, extractable)
  #meta = null;         // Decoded meta object when unlocked / loaded
  /** @type {Promise<void>|null} In-flight unlock single-flight guard. */
  #unlockPromise = null;
  #storage;
  #idleTimer = null;
  #idleTimeoutMs = 30 * 60 * 1000; // 30 min default

  /**
   * @param {MemoryVaultStorage|OPFSVaultStorage} storage - Storage backend
   */
  constructor(storage) {
    this.#storage = storage;
  }

  /** @returns {boolean} Whether the vault is locked */
  get isLocked() { return this.#dek === null; }

  /**
   * Unlock the vault with a passphrase. Handles all three cases:
   *   - Brand-new vault: creates v2 meta with a passphrase wrap.
   *   - Legacy v1 vault: derives the v1 key, decrypts everything,
   *     migrates to v2 atomically, and leaves the vault unlocked.
   *   - Existing v2 vault: tries each passphrase wrap and unwraps the DEK.
   *
   * Throws on invalid passphrase for an existing vault.
   *
   * @param {string} passphrase
   */
  async unlock(passphrase) {
    // Single-flight: concurrent unlock calls share the same in-flight
    // Promise. Critical for the brand-new-vault path where two parallel
    // `unlock(...)` calls could both fall through to `#createV2`,
    // overwriting each other's salt and DEK setup. The modal-driven UI
    // flow shouldn't fire concurrent unlocks today, but programmatic
    // callers (tools, MCP) are not similarly serialized.
    if (this.#unlockPromise) return this.#unlockPromise;
    this.#unlockPromise = this.#unlockImpl(passphrase).finally(() => {
      this.#unlockPromise = null;
    });
    return this.#unlockPromise;
  }

  async #unlockImpl(passphrase) {
    const metaBytes = await this.#storage.read(META_KEY);

    if (metaBytes) {
      // v2 path
      this.#meta = decodeMeta(metaBytes);
      const dek = await this.#unwrapWithPassphrase(passphrase);
      if (!dek) throw new Error('Invalid passphrase');
      this.#dek = dek;
      return;
    }

    // No v2 meta yet — check for v1 vault.
    const saltPacked = await this.#storage.read(SALT_KEY);
    if (saltPacked) {
      if (saltPacked.length !== SALT_BYTES) {
        throw new Error('Vault salt is corrupted (unexpected length). Cannot derive key safely.');
      }
      // Legacy v1 vault present. Migrate in place; on success the vault is unlocked.
      await this.#migrateFromV1(passphrase, saltPacked);
      return;
    }

    // Brand new vault. Create v2.
    await this.#createV2(passphrase);
  }

  /** Lock the vault, discarding the derived key from memory. */
  lock() {
    this.#dek = null;
    this.#meta = null;
    clearTimeout(this.#idleTimer);
    this.#idleTimer = null;
  }

  /** Reset the idle auto-lock timer. Call on user activity to keep vault open. */
  resetIdleTimer() {
    clearTimeout(this.#idleTimer);
    this.#idleTimer = setTimeout(() => this.lock(), this.#idleTimeoutMs);
  }

  /**
   * Migrate plaintext localStorage keys into the encrypted vault.
   * @param {string[]} keys - localStorage keys to migrate
   * @returns {Promise<number>} Number of keys migrated
   */
  async migrateKeysToVault(keys) {
    if (this.isLocked) return 0;
    let migrated = 0;
    for (const key of keys) {
      const value = localStorage.getItem(key);
      if (value) {
        await this.store(key, value);
        localStorage.removeItem(key);
        migrated++;
      }
    }
    return migrated;
  }

  /**
   * Store a secret in the vault.
   * @param {string} name - Secret identifier (e.g. 'apikey-openai')
   * @param {string} secret - Plaintext secret
   */
  async store(name, secret) {
    if (this.isLocked) throw new Error('Vault is locked');
    if (isReserved(name)) throw new Error(`Reserved secret name: ${name}`);
    const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
    const ct = await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv },
      this.#dek,
      new TextEncoder().encode(secret),
    );
    await this.#storage.write(name, pack(iv, new Uint8Array(ct)));
  }

  /**
   * Retrieve a decrypted secret from the vault.
   *
   * During an interrupted migration, the canonical bytes may live in
   * `{name}.next` instead of `{name}` — we check the staging path first.
   *
   * @param {string} name - Secret identifier
   * @returns {Promise<string>} Decrypted plaintext
   */
  async retrieve(name) {
    if (this.isLocked) throw new Error('Vault is locked');
    if (isReserved(name)) throw new Error(`Reserved secret name: ${name}`);
    const packed = (await this.#storage.read(name + NEXT_SUFFIX))
      ?? (await this.#storage.read(name));
    if (!packed) throw new Error(`Secret not found: ${name}`);
    const { iv, ciphertext } = unpack(packed);
    const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, this.#dek, ciphertext);
    return new TextDecoder().decode(pt);
  }

  /**
   * Delete a secret from the vault.
   * @param {string} name - Secret identifier
   */
  async delete(name) {
    if (isReserved(name)) throw new Error(`Reserved secret name: ${name}`);
    await this.#storage.remove(name);
    await this.#storage.remove(name + NEXT_SUFFIX);
  }

  /**
   * List all stored secret names (excluding internal entries).
   * @returns {Promise<string[]>}
   */
  async list() {
    const all = await this.#storage.list();
    return all.filter(n => !isReserved(n));
  }

  /**
   * Check if the vault has been initialized (meta or legacy salt exists).
   * @returns {Promise<boolean>}
   */
  async exists() {
    return (await this.#storage.read(META_KEY)) !== null
        || (await this.#storage.read(SALT_KEY)) !== null;
  }

  /**
   * Verify a passphrase by attempting to unwrap the DEK. On success the
   * vault is left unlocked with the correct DEK loaded; on failure the
   * vault is left in its previous state.
   *
   * Legacy v1 vaults are migrated to v2 if the passphrase is correct.
   *
   * @param {string} passphrase
   * @returns {Promise<boolean>}
   */
  async verify(passphrase) {
    const prevDek = this.#dek;
    const prevMeta = this.#meta;
    try {
      await this.unlock(passphrase);
      return true;
    } catch {
      this.#dek = prevDek;
      this.#meta = prevMeta;
      return false;
    }
  }

  /**
   * List wrap entries for UI display. Sensitive bytes (wrappedDek, salts,
   * IVs) are NOT returned — only metadata: id, kind, label, createdAt,
   * lastUsedAt, and the credentialId for passkey wraps so the UI can
   * match against navigator.credentials.get() allow-lists.
   *
   * @returns {Array<{id:string,kind:string,label:string|null,createdAt:number,lastUsedAt:number|null,credentialId?:string}>}
   */
  listWraps() {
    if (!this.#meta) return [];
    return this.#meta.wraps.map(w => ({
      id: w.id,
      kind: w.kind,
      label: w.label,
      createdAt: w.createdAt,
      lastUsedAt: w.lastUsedAt,
      ...(w.kind === 'passkey' ? { credentialId: b64encode(w.credentialId) } : {}),
    }));
  }

  /**
   * Return the vault-level PRF salt, creating one on first call. Callers
   * pass this as `eval.first` when calling `navigator.credentials.create`
   * and `navigator.credentials.get` for any of this vault's passkeys, so
   * the PRF output is deterministic across unlock sessions.
   *
   * @returns {Promise<Uint8Array>} 32-byte salt
   */
  async getOrCreatePrfSalt() {
    if (!this.#meta) throw new Error('Vault is not unlocked');
    if (!this.#meta.prfSalt) {
      this.#meta.prfSalt = crypto.getRandomValues(new Uint8Array(32));
      await this.#commitMeta();
    }
    return new Uint8Array(this.#meta.prfSalt);
  }

  /**
   * Read the vault-level PRF salt without unlocking the vault. Used by
   * the unlock UI to drive `navigator.credentials.get` before we have a
   * DEK. Returns `null` if no passkey has been enrolled yet.
   *
   * @returns {Promise<Uint8Array|null>}
   */
  async peekPrfSalt() {
    const metaBytes = await this.#storage.read(META_KEY);
    if (!metaBytes) return null;
    const meta = decodeMeta(metaBytes);
    return meta.prfSalt ? new Uint8Array(meta.prfSalt) : null;
  }

  /**
   * Read the credentialIds of all passkey wraps without unlocking. The
   * UI passes these into `navigator.credentials.get`'s `allowCredentials`
   * so the browser only prompts for keys this vault recognises.
   *
   * @returns {Promise<Uint8Array[]>}
   */
  async peekPasskeyCredentialIds() {
    const metaBytes = await this.#storage.read(META_KEY);
    if (!metaBytes) return [];
    const meta = decodeMeta(metaBytes);
    return meta.wraps
      .filter(w => w.kind === 'passkey')
      .map(w => new Uint8Array(w.credentialId));
  }

  /**
   * Add a passkey-PRF wrap to an unlocked vault. Caller must have already
   * registered the WebAuthn credential and obtained PRF output for it
   * using the salt from `getOrCreatePrfSalt`.
   *
   * @param {object} args
   * @param {Uint8Array} args.credentialId - WebAuthn credential id (raw bytes)
   * @param {Uint8Array} args.prfOutput    - 32-byte PRF result (`prf.results.first`)
   * @param {string}     [args.label]      - User-visible label (e.g. "MacBook Touch ID")
   * @returns {Promise<{id:string}>}
   */
  async addPasskeyWrap({ credentialId, prfOutput, label = null }) {
    if (this.isLocked || !this.#meta) throw new Error('Vault is locked');
    const kek = await deriveKekFromPrf(prfOutput);
    const { iv, wrappedDek } = await wrapDek(this.#dek, kek);
    const id = newWrapId('pk');
    const wrap = {
      id, kind: 'passkey', label,
      createdAt: Date.now(), lastUsedAt: null,
      iv, wrappedDek,
      credentialId: new Uint8Array(credentialId),
    };
    this.#meta.wraps.push(wrap);
    await this.#commitMeta();
    return { id };
  }

  /**
   * Remove a wrap entry by id. Refuses to remove the last unlock path
   * (the vault would become permanently inaccessible).
   *
   * @param {string} wrapId
   * @returns {Promise<void>}
   */
  async removeWrap(wrapId) {
    if (this.isLocked || !this.#meta) throw new Error('Vault is locked');
    const idx = this.#meta.wraps.findIndex(w => w.id === wrapId);
    if (idx < 0) throw new Error(`No such wrap: ${wrapId}`);
    if (this.#meta.wraps.length <= 1) {
      throw new Error('Cannot remove the last unlock path');
    }
    this.#meta.wraps.splice(idx, 1);
    await this.#commitMeta();
  }

  /**
   * Change the passphrase. Replaces every passphrase wrap (typically one)
   * with a new wrap derived from the new passphrase. Passkey wraps are
   * unaffected. The DEK is not rotated — secrets do not need to be
   * re-encrypted.
   *
   * @param {string} oldPassphrase - Verified before any change
   * @param {string} newPassphrase
   * @returns {Promise<void>}
   */
  async changePassphrase(oldPassphrase, newPassphrase) {
    if (this.isLocked || !this.#meta) throw new Error('Vault is locked');
    // Verify the old passphrase against an existing passphrase wrap.
    const verified = await this.#unwrapWithPassphrase(oldPassphrase);
    if (!verified) throw new Error('Old passphrase is incorrect');

    // Build a fresh passphrase wrap. Keep IDs of removed wraps so we
    // know what was replaced.
    const newSalt = crypto.getRandomValues(new Uint8Array(SALT_BYTES));
    const newKek = await deriveKekFromPassphrase(newPassphrase, newSalt);
    const { iv, wrappedDek } = await wrapDek(this.#dek, newKek);
    const newWrap = {
      id: newWrapId('p'),
      kind: 'passphrase',
      label: null,
      createdAt: Date.now(),
      lastUsedAt: Date.now(),
      iv,
      wrappedDek,
      salt: newSalt,
      iterations: PBKDF2_ITERATIONS,
    };
    this.#meta.wraps = this.#meta.wraps.filter(w => w.kind !== 'passphrase');
    this.#meta.wraps.push(newWrap);
    await this.#commitMeta();
  }

  /**
   * Destroy the vault entirely: remove every storage entry (secrets AND
   * internal meta/salt/recovery blobs) and lock. Unrecoverable — the DEK
   * dies with the meta. Used by the "reset vault" flow when the wrapped
   * DEK can no longer be decrypted (corruption / all unlock paths lost).
   *
   * @returns {Promise<void>}
   */
  async destroy() {
    const names = await this.#storage.list();
    for (const name of names) {
      await this.#storage.remove(name);
    }
    this.lock();
  }

  /**
   * Set up (or replace) recovery-code unlock. Wraps the DEK under a KEK
   * derived from a freshly generated recovery code. Show the returned
   * code to the user ONCE — it is not stored in plaintext anywhere.
   *
   * @returns {Promise<string>} The recovery code
   */
  async setupRecovery() {
    if (this.isLocked || !this.#meta) throw new Error('Vault is locked');
    const code = generateRecoveryCode();
    const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES));
    const kek = await deriveKekFromPassphrase(normalizeRecoveryCode(code), salt);
    const { iv, wrappedDek } = await wrapDek(this.#dek, kek);
    this.#meta.wraps = this.#meta.wraps.filter(w => w.kind !== 'recovery');
    this.#meta.wraps.push({
      id: newWrapId('r'),
      kind: 'recovery',
      label: null,
      createdAt: Date.now(),
      lastUsedAt: null,
      iv,
      wrappedDek,
      salt,
      iterations: PBKDF2_ITERATIONS,
    });
    await this.#commitMeta();
    return code;
  }

  /**
   * Whether a recovery code has been configured. Works while locked.
   * @returns {Promise<boolean>}
   */
  async hasRecovery() {
    const metaBytes = await this.#storage.read(META_KEY);
    if (!metaBytes) return false;
    try {
      return decodeMeta(metaBytes).wraps.some(w => w.kind === 'recovery');
    } catch {
      return false;
    }
  }

  /**
   * Recover access with a recovery code: unwraps the DEK via the recovery
   * wrap, replaces the passphrase wrap(s) with `newPassphrase`, and issues
   * a fresh recovery code (the used one is rotated out). Secrets are not
   * re-encrypted — only wraps change.
   *
   * @param {string} code - Recovery code (case/dash-insensitive)
   * @param {string} newPassphrase - New vault passphrase
   * @returns {Promise<{success: boolean, recoveryCode?: string, error?: string}>}
   */
  async recoverWithCode(code, newPassphrase) {
    const metaBytes = await this.#storage.read(META_KEY);
    if (!metaBytes) return { success: false, error: 'No recovery code configured for this vault' };
    const meta = decodeMeta(metaBytes);
    const recoveryWraps = meta.wraps.filter(w => w.kind === 'recovery');
    if (recoveryWraps.length === 0) {
      return { success: false, error: 'No recovery code configured for this vault' };
    }

    let dek = null;
    for (const wrap of recoveryWraps) {
      try {
        const kek = await deriveKekFromPassphrase(
          normalizeRecoveryCode(code), wrap.salt, wrap.iterations ?? PBKDF2_ITERATIONS,
        );
        dek = await unwrapDek(wrap, kek);
        wrap.lastUsedAt = Date.now();
        break;
      } catch { /* wrong code for this wrap — try the next */ }
    }
    if (!dek) return { success: false, error: 'Invalid recovery code' };

    this.#dek = dek;
    this.#meta = meta;

    // Replace passphrase wraps with the new passphrase (DEK unchanged)
    const newSalt = crypto.getRandomValues(new Uint8Array(SALT_BYTES));
    const newKek = await deriveKekFromPassphrase(newPassphrase, newSalt);
    const { iv, wrappedDek } = await wrapDek(this.#dek, newKek);
    this.#meta.wraps = this.#meta.wraps.filter(w => w.kind !== 'passphrase');
    this.#meta.wraps.push({
      id: newWrapId('p'),
      kind: 'passphrase',
      label: null,
      createdAt: Date.now(),
      lastUsedAt: Date.now(),
      iv,
      wrappedDek,
      salt: newSalt,
      iterations: PBKDF2_ITERATIONS,
    });

    // Rotate the recovery code — the used one dies with the old passphrase
    const recoveryCode = await this.setupRecovery();
    return { success: true, recoveryCode };
  }

  // ── internals ───────────────────────────────────────────────────

  async #createV2(passphrase) {
    const dek = await generateDek();
    const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES));
    const kek = await deriveKekFromPassphrase(passphrase, salt);
    const { iv, wrappedDek } = await wrapDek(dek, kek);
    this.#meta = {
      version: META_VERSION,
      createdAt: Date.now(),
      wraps: [{
        id: newWrapId('p'),
        kind: 'passphrase',
        label: null,
        createdAt: Date.now(),
        lastUsedAt: Date.now(),
        iv,
        wrappedDek,
        salt,
        iterations: PBKDF2_ITERATIONS,
      }],
    };
    this.#dek = dek;
    await this.#commitMeta();
  }

  /**
   * Try every passphrase wrap and return the unwrapped DEK on first hit.
   * Updates `lastUsedAt` of the matched wrap (lazy — only persisted on
   * the next meta commit so unlock itself doesn't write).
   * @returns {Promise<CryptoKey|null>}
   */
  async #unwrapWithPassphrase(passphrase) {
    if (!this.#meta) return null;
    for (const w of this.#meta.wraps) {
      if (w.kind !== 'passphrase') continue;
      try {
        const kek = await deriveKekFromPassphrase(passphrase, w.salt, w.iterations);
        const dek = await unwrapDek({ iv: w.iv, wrappedDek: w.wrappedDek }, kek);
        w.lastUsedAt = Date.now();
        return dek;
      } catch (e) {
        silentCatch('clawser-vault', 'unwrap-passphrase-attempt', e, { wrapId: w.id });
      }
    }
    return null;
  }

  /**
   * Try every passkey wrap matching the given credentialId and return the
   * unwrapped DEK on first hit. Used when the consumer has already done a
   * WebAuthn PRF assertion and has both the credentialId and the PRF output.
   *
   * @param {Uint8Array} credentialId
   * @param {Uint8Array} prfOutput
   * @returns {Promise<CryptoKey|null>}
   */
  async unlockWithPasskey(credentialId, prfOutput) {
    const metaBytes = await this.#storage.read(META_KEY);
    if (!metaBytes) throw new Error('Vault has no meta — cannot unlock with passkey');
    this.#meta = decodeMeta(metaBytes);
    const credIdHex = b64encode(credentialId);
    for (const w of this.#meta.wraps) {
      if (w.kind !== 'passkey') continue;
      if (b64encode(w.credentialId) !== credIdHex) continue;
      try {
        const kek = await deriveKekFromPrf(prfOutput);
        const dek = await unwrapDek({ iv: w.iv, wrappedDek: w.wrappedDek }, kek);
        w.lastUsedAt = Date.now();
        this.#dek = dek;
        return dek;
      } catch (e) {
        silentCatch('clawser-vault', 'unwrap-passkey-attempt', e, { wrapId: w.id });
      }
    }
    this.#meta = null;
    throw new Error('No matching passkey wrap, or PRF output is invalid');
  }

  /**
   * In-place migration from v1 (direct passphrase encryption) to v2
   * (wrapped-DEK). Atomic: the v2 meta write is the commit point. If we
   * crash before that, the v1 vault is intact and the next unlock retries.
   * If we crash after, the v2 reader handles `{name}.next` → `{name}`
   * fallback so partial post-commit cleanup is harmless.
   */
  async #migrateFromV1(passphrase, saltPacked) {
    // 1. Derive old key, decrypt every secret into memory.
    const oldKey = await deriveKey(passphrase, saltPacked);
    const allNames = (await this.#storage.list())
      .filter(n => !isReserved(n)); // skip salt / canary / any prior `.next`
    const plaintexts = new Map();
    for (const name of allNames) {
      const packed = await this.#storage.read(name);
      if (!packed) continue;
      try {
        const { iv, ciphertext } = unpack(packed);
        const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, oldKey, ciphertext);
        plaintexts.set(name, new TextDecoder().decode(pt));
      } catch {
        // Wrong passphrase — abort migration without touching anything.
        throw new Error('Invalid passphrase');
      }
    }

    // 2. Generate the new DEK and the passphrase wrap.
    const dek = await generateDek();
    const newSalt = crypto.getRandomValues(new Uint8Array(SALT_BYTES));
    const kek = await deriveKekFromPassphrase(passphrase, newSalt);
    const { iv, wrappedDek } = await wrapDek(dek, kek);
    const meta = {
      version: META_VERSION,
      createdAt: Date.now(),
      wraps: [{
        id: newWrapId('p'),
        kind: 'passphrase',
        label: null,
        createdAt: Date.now(),
        lastUsedAt: Date.now(),
        iv,
        wrappedDek,
        salt: newSalt,
        iterations: PBKDF2_ITERATIONS,
      }],
    };

    // 3. Stage every secret under its `.next` slot (still encrypted with old
    //    key at the canonical name; reader will prefer `.next`). Fail-fast:
    //    if any single write fails before the commit, no meta is written and
    //    nothing the v1 reader cares about has changed.
    for (const [name, plaintext] of plaintexts) {
      const ivS = crypto.getRandomValues(new Uint8Array(IV_BYTES));
      const ct = await crypto.subtle.encrypt(
        { name: 'AES-GCM', iv: ivS },
        dek,
        new TextEncoder().encode(plaintext),
      );
      await this.#storage.write(name + NEXT_SUFFIX, pack(ivS, new Uint8Array(ct)));
    }

    // 4. THE COMMIT: write meta. This single createWritable+close is
    //    atomic in OPFS, and the in-memory MemoryVaultStorage write is
    //    likewise atomic.
    await this.#storage.write(META_KEY, encodeMeta(meta));
    this.#meta = meta;
    this.#dek = dek;

    // 5. Cleanup (best-effort, post-commit). Reader tolerates partial state
    //    via the `.next` fallback in retrieve().
    for (const name of plaintexts.keys()) {
      try {
        const next = await this.#storage.read(name + NEXT_SUFFIX);
        if (next) await this.#storage.write(name, next);
        await this.#storage.remove(name + NEXT_SUFFIX);
      } catch (e) { silentCatch('clawser-vault', 'migration-finalize-secret', e, { name }); }
    }
    try { await this.#storage.remove(SALT_KEY); }
    catch (e) { silentCatch('clawser-vault', 'migration-finalize-salt', e); }
    try { await this.#storage.remove(CANARY_KEY); }
    catch (e) { silentCatch('clawser-vault', 'migration-finalize-canary', e); }
  }

  /** Persist the current meta to storage. */
  async #commitMeta() {
    if (!this.#meta) throw new Error('No meta to commit');
    await this.#storage.write(META_KEY, encodeMeta(this.#meta));
  }
}

// ── VaultRekeyer ────────────────────────────────────────────────

/**
 * Convenience wrapper around `SecretVault.changePassphrase`. Kept for
 * backwards compatibility with consumers that pre-date the v2 API.
 *
 * In v1 this re-encrypted every secret. In v2 it just rewraps the DEK,
 * so it returns `rekeyed: <number of passphrase wraps replaced>` rather
 * than the count of secrets touched. The shape is unchanged so callers
 * compile.
 */
export class VaultRekeyer {
  #vault;

  /** @param {SecretVault} vault */
  constructor(vault) { this.#vault = vault; }

  /**
   * Plan the operation. Reports the number of secrets in the vault for
   * UI confirmation purposes; the actual rekey no longer touches them.
   * @returns {Promise<{ secretCount: number, secrets: string[] }>}
   */
  async plan() {
    if (this.#vault.isLocked) throw new Error('Vault is locked');
    const secrets = await this.#vault.list();
    return { secretCount: secrets.length, secrets };
  }

  /**
   * Execute the rekey: rewrap the DEK with a new passphrase-derived KEK.
   * Returns `{ success, rekeyed }` where `rekeyed` is 1 on success
   * (one passphrase wrap replaced) and 0 on failure.
   *
   * @param {string} oldPassphrase
   * @param {string} newPassphrase
   * @returns {Promise<{ success: boolean, rekeyed: number, error?: string }>}
   */
  async execute(oldPassphrase, newPassphrase) {
    if (this.#vault.isLocked) throw new Error('Vault is locked');
    try {
      // Legacy mock vault path: tests pre-v2 used a mock with `unlock/lock/store`
      // but no `changePassphrase`. Fall back to the old behavior in that case
      // so existing test mocks keep passing without changes.
      if (typeof this.#vault.changePassphrase === 'function') {
        await this.#vault.changePassphrase(oldPassphrase, newPassphrase);
        return { success: true, rekeyed: 1 };
      }
      // ── legacy fallback ────────────────────────────────────────
      const secrets = await this.#vault.list();
      const backup = {};
      for (const name of secrets) {
        try { backup[name] = await this.#vault.retrieve(name); }
        catch (e) { silentCatch('clawser-vault', 'rekey-skip-unreadable', e, { name }); }
      }
      this.#vault.lock();
      await this.#vault.unlock(newPassphrase);
      let rekeyed = 0;
      for (const [name, value] of Object.entries(backup)) {
        await this.#vault.store(name, value);
        rekeyed++;
      }
      return { success: true, rekeyed };
    } catch (e) {
      try {
        if (typeof this.#vault.changePassphrase !== 'function') {
          this.#vault.lock();
          await this.#vault.unlock(oldPassphrase);
        }
      } catch (rollbackErr) {
        silentCatch('clawser-vault', 'rekey-rollback', rollbackErr);
      }
      return { success: false, rekeyed: 0, error: e.message };
    }
  }
}
