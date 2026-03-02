# Utility Functions

Common helper functions referenced across BrowserMesh specifications.

**Related specs**: [wire-format.md](../core/wire-format.md) | [identity-keys.md](../crypto/identity-keys.md) | [session-keys.md](../crypto/session-keys.md) | [error-handling.md](../core/error-handling.md)

## 1. Overview

Multiple specs reference helper functions (base64url, timingSafeEqual, CBOR helpers) without defining them in one place. This spec centralizes all shared utility functions.

## 2. Encoding

### 2.1 base64url

URL-safe Base64 encoding/decoding (RFC 4648 §5), used for Pod IDs, public keys, and tokens.

```typescript
function base64urlEncode(bytes: Uint8Array): string {
  const base64 = btoa(String.fromCharCode(...bytes));
  return base64
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=/g, '');
}

function base64urlDecode(str: string): Uint8Array {
  // Restore padding
  const padded = str + '='.repeat((4 - str.length % 4) % 4);
  const base64 = padded.replace(/-/g, '+').replace(/_/g, '/');
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}
```

### 2.2 hex

Hexadecimal encoding/decoding, used for debug output and logging.

```typescript
function hexEncode(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

function hexDecode(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(hex.substring(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}
```

## 3. Comparison

### 3.1 timingSafeEqual

Constant-time comparison to prevent timing side-channel attacks. Used when comparing MACs, signatures, and tokens.

```typescript
function timingSafeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;

  let result = 0;
  for (let i = 0; i < a.length; i++) {
    result |= a[i] ^ b[i];
  }
  return result === 0;
}
```

> **Note**: This function operates on `Uint8Array` only. Do not use for string comparison — convert to bytes first.

## 4. CBOR

### 4.1 encode / decode

CBOR encoding wraps the chosen library (cbor-x recommended, cborg as alternative):

```typescript
import { encode as cborEncode, decode as cborDecode } from 'cbor-x';

function encode(value: unknown): Uint8Array {
  return cborEncode(value);
}

function decode<T = unknown>(data: Uint8Array): T {
  return cborDecode(data) as T;
}
```

### 4.2 encodeDeterministic

Deterministic CBOR encoding for signatures (see [wire-format.md](../core/wire-format.md) §4.2):

```typescript
function encodeDeterministic(
  value: Record<string, unknown>,
  fieldOrder: string[]
): Uint8Array {
  const ordered: Record<string, unknown> = {};
  for (const key of fieldOrder) {
    if (key in value && value[key] !== undefined) {
      ordered[key] = value[key];
    }
  }
  return cborEncode(ordered, { canonical: true });
}
```

## 5. Crypto Helpers

### 5.1 randomBytes

Generate cryptographically secure random bytes:

```typescript
function randomBytes(length: number): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(length));
}
```

### 5.2 hash (SHA-256)

```typescript
async function hash(data: Uint8Array): Promise<Uint8Array> {
  const digest = await crypto.subtle.digest('SHA-256', data);
  return new Uint8Array(digest);
}
```

### 5.3 deriveKey (HKDF-SHA256)

```typescript
async function deriveKey(
  ikm: Uint8Array,
  info: string,
  salt?: Uint8Array
): Promise<CryptoKey> {
  const baseKey = await crypto.subtle.importKey(
    'raw', ikm, 'HKDF', false, ['deriveKey']
  );

  return crypto.subtle.deriveKey(
    {
      name: 'HKDF',
      hash: 'SHA-256',
      salt: salt ?? new Uint8Array(0),
      info: new TextEncoder().encode(info),
    },
    baseKey,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}
```

### 5.4 concat

Concatenate multiple byte arrays:

```typescript
function concat(...arrays: Uint8Array[]): Uint8Array {
  const total = arrays.reduce((sum, arr) => sum + arr.length, 0);
  const result = new Uint8Array(total);
  let offset = 0;
  for (const arr of arrays) {
    result.set(arr, offset);
    offset += arr.length;
  }
  return result;
}
```

## 6. Time

### 6.1 monotonicNow

Monotonic time source for measuring durations (not affected by clock adjustments):

```typescript
function monotonicNow(): number {
  return performance.now();
}
```

### 6.2 isoTimestamp

ISO 8601 timestamp for logging and audit entries:

```typescript
function isoTimestamp(ms?: number): string {
  return new Date(ms ?? Date.now()).toISOString();
}
```

## 7. Validation

### 7.1 isPodId

Validate a Pod ID (32-byte SHA-256 hash, hex or base64url encoded):

```typescript
function isPodId(value: string): boolean {
  // base64url: 43 characters (32 bytes)
  if (/^[A-Za-z0-9_-]{43}$/.test(value)) return true;
  // hex: 64 characters (32 bytes)
  if (/^[0-9a-f]{64}$/i.test(value)) return true;
  return false;
}
```

### 7.2 isScope

Validate a capability scope string (see [capability-scope-grammar.md](../crypto/capability-scope-grammar.md)):

```typescript
function isScope(value: string): boolean {
  return /^[a-z][a-z0-9_-]*:[a-z][a-z0-9_/*-]*$/.test(value);
}
```

### 7.3 isBase64url

Validate a base64url-encoded string:

```typescript
function isBase64url(value: string): boolean {
  return /^[A-Za-z0-9_-]+$/.test(value);
}
```

### 7.4 isValidTopic

Validate a pub/sub topic (see [pubsub-topics.md](../coordination/pubsub-topics.md)):

```typescript
function isValidTopic(topic: string): boolean {
  return /^[a-zA-Z0-9_-]{1,64}(\/[a-zA-Z0-9_-]{1,64}){0,7}$/.test(topic);
}
```

## 8. Error Factory

Standardized error creation (see [error-handling.md](../core/error-handling.md)):

```typescript
function createError(
  code: string,
  message: string,
  details?: Record<string, unknown>
): MeshError {
  return new MeshError(code, message, details);
}

class MeshError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly details?: Record<string, unknown>
  ) {
    super(message);
    this.name = 'MeshError';
  }

  toJSON(): Record<string, unknown> {
    return {
      code: this.code,
      message: this.message,
      details: this.details,
    };
  }
}
```

### Common Error Codes

| Code | Usage |
|------|-------|
| `INVALID_ARGUMENT` | Bad input to any function |
| `NOT_FOUND` | Resource or peer not found |
| `PERMISSION_DENIED` | Capability check failed |
| `TIMEOUT` | Operation timed out |
| `INTERNAL` | Unexpected internal error |
| `UNAVAILABLE` | Peer or service unreachable |
| `ALREADY_EXISTS` | Duplicate resource |

## 9. Message ID Generation

Generate sortable, unique 16-byte message IDs (see [wire-format.md](../core/wire-format.md) §6.1):

```typescript
function generateMessageId(): Uint8Array {
  const id = new Uint8Array(16);
  const view = new DataView(id.buffer);

  const now = Date.now();
  view.setUint32(0, Math.floor(now / 0x100000000), false);
  view.setUint32(4, now >>> 0, false);

  crypto.getRandomValues(id.subarray(8));
  return id;
}
```
