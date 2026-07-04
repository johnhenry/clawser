/**
 * clawser-passkey.mjs — WebAuthn passkey enrollment + assertion with the
 * PRF extension, used to derive an alternative unlock path for the vault.
 *
 * Public API:
 *   - isPasskeyPRFSupported() — quick capability probe
 *   - enrollPasskey({label, prfSalt, ...}) — register a credential and
 *       obtain its PRF output for the vault's salt
 *   - assertPasskeyForUnlock({allowCredentialIds, prfSalt}) — prompt the
 *       user for one of the allowed passkeys and return its PRF output
 *   - decodeBase64Url / encodeBase64Url helpers exported for testing
 *
 * The vault's `addPasskeyWrap` and `unlockWithPasskey` consume the
 * outputs of these helpers — see docs/VAULT.md for the integration.
 *
 * On any environment that lacks `navigator.credentials` or PRF support,
 * `isPasskeyPRFSupported()` returns false and the enrollment helper
 * throws with a clear, actionable message.
 */

const RP_ID = (typeof location !== 'undefined' && location.hostname) || 'localhost';
const RP_NAME = 'Clawser';

/**
 * Quick capability probe. Returns true when the runtime exposes the
 * WebAuthn PublicKeyCredential interface and the browser advertises the
 * PRF extension. The actual authenticator may still reject PRF — that's
 * caught at enrollment time by checking `prf.enabled` in the result.
 *
 * @returns {boolean}
 */
export function isPasskeyPRFSupported() {
  if (typeof navigator === 'undefined') return false;
  if (!navigator.credentials || typeof navigator.credentials.create !== 'function') return false;
  if (typeof PublicKeyCredential === 'undefined') return false;
  // Most Chromium browsers expose getClientExtensionResults; PRF support
  // shows up when invoked. We can only feature-detect the API existence
  // here; deeper detection requires actually trying.
  return true;
}

/**
 * Encode bytes to base64url (no padding) — used for credentialId in URLs
 * or display contexts. The vault internally uses base64 (with padding)
 * for storage; conversion is handled at the storage layer.
 *
 * @param {Uint8Array} bytes
 * @returns {string}
 */
export function encodeBase64Url(bytes) {
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function decodeBase64Url(s) {
  const padded = s.replace(/-/g, '+').replace(/_/g, '/').padEnd(s.length + (4 - s.length % 4) % 4, '=');
  const bin = atob(padded);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/**
 * Register a passkey for the current vault and obtain the PRF output for
 * the vault's salt. The credential is created with `prf` extension; if
 * the chosen authenticator does not support PRF the function throws so
 * the caller can surface a clear error to the user (rather than enrolling
 * a passkey that will fail to unlock later).
 *
 * @param {object} args
 * @param {Uint8Array} args.prfSalt        - 32-byte vault PRF salt
 * @param {string}     [args.label]        - Human-visible label saved on the wrap entry
 * @param {string}     [args.userName]     - Optional user.name for the credential
 * @param {string}     [args.userId]       - Optional user.id; defaults to a stable per-vault id
 * @param {object}     [args._navCredsCreate] - Optional override for testing (function)
 * @returns {Promise<{credentialId: Uint8Array, prfOutput: Uint8Array, label: string}>}
 */
export async function enrollPasskey({ prfSalt, label = 'Passkey', userName = 'clawser-vault', userId = 'clawser-vault', _navCredsCreate = null } = {}) {
  if (!(prfSalt instanceof Uint8Array) || prfSalt.length < 32) {
    throw new Error('prfSalt must be a 32-byte Uint8Array');
  }
  const create = _navCredsCreate
    || (typeof navigator !== 'undefined' && navigator.credentials?.create?.bind(navigator.credentials));
  if (!create) {
    throw new Error('WebAuthn is not available in this browser');
  }

  const challenge = crypto.getRandomValues(new Uint8Array(32));
  const userIdBytes = new TextEncoder().encode(userId);

  const publicKey = {
    challenge,
    rp: { name: RP_NAME, id: RP_ID },
    user: { id: userIdBytes, name: userName, displayName: label },
    pubKeyCredParams: [
      { type: 'public-key', alg: -7 },   // ES256
      { type: 'public-key', alg: -257 }, // RS256
    ],
    authenticatorSelection: {
      residentKey: 'preferred',
      userVerification: 'preferred',
    },
    timeout: 60_000,
    extensions: {
      prf: { eval: { first: prfSalt } },
    },
  };

  const credential = await create({ publicKey });
  if (!credential || !credential.rawId) {
    throw new Error('Passkey creation returned no credential');
  }

  const ext = typeof credential.getClientExtensionResults === 'function'
    ? credential.getClientExtensionResults()
    : credential.clientExtensionResults || {};
  const prf = ext?.prf;
  if (!prf || prf.enabled === false || !prf.results || !prf.results.first) {
    throw new Error('This authenticator does not support the WebAuthn PRF extension. Pick a different passkey or upgrade your authenticator.');
  }

  return {
    credentialId: new Uint8Array(credential.rawId),
    prfOutput: new Uint8Array(prf.results.first),
    label,
  };
}

/**
 * Drive a WebAuthn assertion to obtain the PRF output for an existing
 * passkey. Returns the credentialId the user actually selected and its
 * PRF output. Throws on cancellation, no allowed credential, or PRF
 * absence on the authenticator.
 *
 * @param {object} args
 * @param {Uint8Array[]} args.allowCredentialIds - Eligible credential ids
 * @param {Uint8Array}   args.prfSalt
 * @param {Function}     [args._navCredsGet]    - Override for testing
 * @returns {Promise<{credentialId: Uint8Array, prfOutput: Uint8Array}>}
 */
export async function assertPasskeyForUnlock({ allowCredentialIds, prfSalt, _navCredsGet = null } = {}) {
  if (!Array.isArray(allowCredentialIds) || allowCredentialIds.length === 0) {
    throw new Error('No passkeys are registered for this vault');
  }
  if (!(prfSalt instanceof Uint8Array) || prfSalt.length < 32) {
    throw new Error('prfSalt must be a 32-byte Uint8Array');
  }
  const get = _navCredsGet
    || (typeof navigator !== 'undefined' && navigator.credentials?.get?.bind(navigator.credentials));
  if (!get) {
    throw new Error('WebAuthn is not available in this browser');
  }

  const challenge = crypto.getRandomValues(new Uint8Array(32));
  const publicKey = {
    challenge,
    rpId: RP_ID,
    allowCredentials: allowCredentialIds.map(id => ({
      type: 'public-key',
      id,
      transports: ['internal', 'usb', 'nfc', 'ble', 'hybrid'],
    })),
    userVerification: 'preferred',
    timeout: 60_000,
    extensions: { prf: { eval: { first: prfSalt } } },
  };

  const assertion = await get({ publicKey });
  if (!assertion || !assertion.rawId) {
    throw new Error('Passkey assertion returned no credential');
  }
  const ext = typeof assertion.getClientExtensionResults === 'function'
    ? assertion.getClientExtensionResults()
    : assertion.clientExtensionResults || {};
  const prf = ext?.prf;
  if (!prf || !prf.results || !prf.results.first) {
    throw new Error('Authenticator did not return PRF output. The selected passkey may not support PRF.');
  }
  return {
    credentialId: new Uint8Array(assertion.rawId),
    prfOutput: new Uint8Array(prf.results.first),
  };
}
