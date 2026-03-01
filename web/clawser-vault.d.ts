/**
 * Type definitions for clawser-vault.js
 * Encrypted secret storage using Web Crypto API
 */

// ── Crypto Primitives ──────────────────────────────────────────

export declare function deriveKey(passphrase: string, salt: Uint8Array): Promise<CryptoKey>;

export declare function encryptSecret(
  plaintext: string,
  derivedKey: CryptoKey,
): Promise<{ iv: Uint8Array; ciphertext: Uint8Array }>;

export declare function decryptSecret(
  encrypted: { iv: Uint8Array; ciphertext: Uint8Array },
  derivedKey: CryptoKey,
): Promise<string>;

// ── Storage Backends ───────────────────────────────────────────

export interface VaultStorage {
  read(name: string): Promise<Uint8Array | null>;
  write(name: string, packed: Uint8Array): Promise<void>;
  remove(name: string): Promise<void>;
  list(): Promise<string[]>;
}

export declare class MemoryVaultStorage implements VaultStorage {
  read(name: string): Promise<Uint8Array | null>;
  write(name: string, packed: Uint8Array): Promise<void>;
  remove(name: string): Promise<void>;
  list(): Promise<string[]>;
}

export declare class OPFSVaultStorage implements VaultStorage {
  constructor(dirName?: string);
  read(name: string): Promise<Uint8Array | null>;
  write(name: string, packed: Uint8Array): Promise<void>;
  remove(name: string): Promise<void>;
  list(): Promise<string[]>;
}

// ── SecretVault ────────────────────────────────────────────────

export declare class SecretVault {
  constructor(storage: VaultStorage);

  get isLocked(): boolean;

  unlock(passphrase: string): Promise<void>;
  lock(): void;
  store(name: string, secret: string): Promise<void>;
  retrieve(name: string): Promise<string>;
  delete(name: string): Promise<void>;
  list(): Promise<string[]>;
  exists(): Promise<boolean>;
  verify(passphrase: string): Promise<boolean>;
  resetIdleTimer(): void;
  migrateKeysToVault(keys: string[]): Promise<number>;
}

// ── Passphrase Strength ───────────────────────────────────────

export interface PassphraseStrength {
  score: number;
  entropy: number;
  label: string;
}

export declare function measurePassphraseStrength(passphrase: string): PassphraseStrength;

// ── VaultRekeyer ──────────────────────────────────────────────

export interface RekeyPlan {
  secretCount: number;
  secrets: string[];
}

export interface RekeyResult {
  success: boolean;
  rekeyed: number;
  error?: string;
}

export declare class VaultRekeyer {
  constructor(vault: SecretVault);
  plan(): Promise<RekeyPlan>;
  execute(oldPassphrase: string, newPassphrase: string): Promise<RekeyResult>;
}
