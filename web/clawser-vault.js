// clawser-vault.js — Encrypted secret storage using Web Crypto API
//
// SecretVault encrypts API keys (and other secrets) with AES-GCM,
// using a PBKDF2-derived key from the user's passphrase.
// Storage backends are pluggable: OPFSVaultStorage for production,
// MemoryVaultStorage for testing.

// ── Crypto primitives ────────────────────────────────────────────

const PBKDF2_ITERATIONS = 600_000; // OWASP recommendation
const AES_KEY_LENGTH = 256;
const IV_BYTES = 12;  // 96-bit IV for AES-GCM
const SALT_BYTES = 16;

/**
 * Derive an AES-GCM key from a passphrase using PBKDF2.
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
 * Encrypt plaintext with AES-GCM.
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
 * Decrypt ciphertext with AES-GCM.
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

  constructor(dirName = 'clawser_vault') {
    this.#dirName = dirName;
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

// ── SecretVault ──────────────────────────────────────────────────

const SALT_KEY = '__vault_salt__';

/**
 * Encrypted secret storage using Web Crypto (PBKDF2 + AES-GCM).
 *
 * Usage:
 *   const vault = new SecretVault(new OPFSVaultStorage());
 *   await vault.unlock('my passphrase');
 *   await vault.store('openai-key', 'sk-...');
 *   const key = await vault.retrieve('openai-key');
 *   vault.lock();
 */
export class SecretVault {
  #derivedKey = null;
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
  get isLocked() { return this.#derivedKey === null; }

  /**
   * Unlock the vault with a passphrase. Loads or creates the salt,
   * then derives the encryption key.
   * @param {string} passphrase
   */
  async unlock(passphrase) {
    // Load or create salt
    let saltPacked = await this.#storage.read(SALT_KEY);
    if (saltPacked && saltPacked.length !== SALT_BYTES) {
      throw new Error('Vault salt is corrupted (unexpected length). Cannot derive key safely.');
    }
    if (!saltPacked) {
      saltPacked = crypto.getRandomValues(new Uint8Array(SALT_BYTES));
      await this.#storage.write(SALT_KEY, saltPacked);
    }

    this.#derivedKey = await deriveKey(passphrase, saltPacked);
  }

  /** Lock the vault, discarding the derived key from memory. */
  lock() {
    this.#derivedKey = null;
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
    const encrypted = await encryptSecret(secret, this.#derivedKey);
    await this.#storage.write(name, pack(encrypted.iv, encrypted.ciphertext));
  }

  /**
   * Retrieve a decrypted secret from the vault.
   * @param {string} name - Secret identifier
   * @returns {Promise<string>} Decrypted plaintext
   */
  async retrieve(name) {
    if (this.isLocked) throw new Error('Vault is locked');
    const packed = await this.#storage.read(name);
    if (!packed) throw new Error(`Secret not found: ${name}`);
    const { iv, ciphertext } = unpack(packed);
    return decryptSecret({ iv, ciphertext }, this.#derivedKey);
  }

  /**
   * Delete a secret from the vault.
   * @param {string} name - Secret identifier
   */
  async delete(name) {
    await this.#storage.remove(name);
  }

  /**
   * List all stored secret names (excluding internal entries like salt).
   * @returns {Promise<string[]>}
   */
  async list() {
    const all = await this.#storage.list();
    return all.filter(n => n !== SALT_KEY);
  }

  /**
   * Check if the vault has been initialized (salt exists).
   * @returns {Promise<boolean>}
   */
  async exists() {
    const salt = await this.#storage.read(SALT_KEY);
    return salt !== null;
  }

  /**
   * Verify a passphrase by attempting to derive and use the key.
   * Stores a known canary value on first unlock, then checks it on subsequent unlocks.
   * @param {string} passphrase
   * @returns {Promise<boolean>}
   */
  async verify(passphrase) {
    const CANARY_KEY = '__vault_canary__';
    const CANARY_VALUE = 'clawser-vault-ok';

    // Save current state
    const prevKey = this.#derivedKey;

    try {
      await this.unlock(passphrase);

      // Check if canary exists
      const packed = await this.#storage.read(CANARY_KEY);
      if (!packed) {
        // First unlock — store the canary
        await this.store(CANARY_KEY, CANARY_VALUE);
        return true;
      }

      // Verify canary decrypts correctly
      const decrypted = await this.retrieve(CANARY_KEY);
      if (decrypted === CANARY_VALUE) return true;
      // Wrong passphrase — restore previous key state
      this.#derivedKey = prevKey;
      return false;
    } catch {
      // Decryption failed — wrong passphrase
      this.#derivedKey = prevKey;
      return false;
    }
  }
}
