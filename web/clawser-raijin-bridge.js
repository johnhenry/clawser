/**
 * clawser-raijin-bridge.js — Bridge between raijin PBFT consensus and
 * Clawser's mesh wire format.
 *
 * Implements raijin's NetworkTransport interface, encoding ConsensusMessage
 * objects into CBOR wire envelopes with PBFT type codes (0xED–0xF5) and
 * decoding incoming PBFT wire messages back to ConsensusMessage objects.
 *
 * This is the ONLY file that imports both raijin types and Clawser mesh
 * primitives. All other code interacts through the bridge.
 *
 * No browser-only imports at module level.
 *
 * Run tests:
 *   node --import ./web/test/_setup-globals.mjs --test web/test/clawser-raijin-bridge.test.mjs
 */

import { MESH_TYPE } from './packages/mesh-primitives/src/constants.mjs'

// ---------------------------------------------------------------------------
// PBFT message type → wire code mapping
// ---------------------------------------------------------------------------

const PBFT_TYPE_TO_CODE = Object.freeze({
  'pre-prepare': MESH_TYPE.PBFT_PRE_PREPARE,
  'prepare':     MESH_TYPE.PBFT_PREPARE,
  'commit':      MESH_TYPE.PBFT_COMMIT,
  'view-change': MESH_TYPE.PBFT_VIEW_CHANGE,
  'new-view':    MESH_TYPE.PBFT_NEW_VIEW,
})

const PBFT_CODE_TO_TYPE = Object.freeze(
  Object.fromEntries(Object.entries(PBFT_TYPE_TO_CODE).map(([k, v]) => [v, k]))
)

/** Set of all PBFT wire codes for fast lookup */
export const PBFT_WIRE_CODES = new Set(Object.values(PBFT_TYPE_TO_CODE))

// ---------------------------------------------------------------------------
// Serialization helpers — bigint and Uint8Array over JSON
// ---------------------------------------------------------------------------

/**
 * Encode a value for JSON transport.
 * - bigint → { __bigint: string }
 * - Uint8Array → { __bytes: base64url }
 * - Block objects have their fields recursively encoded
 */
function encodeValue(value) {
  if (value === null || value === undefined) return value
  if (typeof value === 'bigint') return { __bigint: value.toString() }
  if (value instanceof Uint8Array) return { __bytes: uint8ToBase64url(value) }
  if (Array.isArray(value)) return value.map(encodeValue)
  if (typeof value === 'object') {
    const result = {}
    for (const [k, v] of Object.entries(value)) {
      result[k] = encodeValue(v)
    }
    return result
  }
  return value
}

/**
 * Decode a value from JSON transport.
 * Reverses encodeValue transformations.
 */
function decodeValue(value) {
  if (value === null || value === undefined) return value
  if (Array.isArray(value)) return value.map(decodeValue)
  if (typeof value === 'object') {
    if ('__bigint' in value) return BigInt(value.__bigint)
    if ('__bytes' in value) return base64urlToUint8(value.__bytes)
    const result = {}
    for (const [k, v] of Object.entries(value)) {
      result[k] = decodeValue(v)
    }
    return result
  }
  return value
}

// ---------------------------------------------------------------------------
// Base64url helpers (no padding)
// ---------------------------------------------------------------------------

function uint8ToBase64url(bytes) {
  const binStr = Array.from(bytes, (b) => String.fromCharCode(b)).join('')
  return btoa(binStr).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function base64urlToUint8(str) {
  const padded = str.replace(/-/g, '+').replace(/_/g, '/') +
    '='.repeat((4 - (str.length % 4)) % 4)
  const binStr = atob(padded)
  return Uint8Array.from(binStr, (c) => c.charCodeAt(0))
}

// ---------------------------------------------------------------------------
// PodKeyMapping — bidirectional podId ↔ publicKey mapping
// ---------------------------------------------------------------------------

/**
 * Maps Clawser string podIds to raijin Uint8Array public keys and back.
 */
export class PodKeyMapping {
  /** @type {Map<string, Uint8Array>} */
  #podToKey = new Map()

  /** @type {Map<string, string>} hex(key) → podId */
  #keyToPod = new Map()

  /**
   * Register a mapping between a podId and a public key.
   *
   * @param {string} podId
   * @param {Uint8Array} publicKey
   */
  register(podId, publicKey) {
    if (!podId || typeof podId !== 'string') {
      throw new Error('podId must be a non-empty string')
    }
    if (!(publicKey instanceof Uint8Array)) {
      throw new Error('publicKey must be a Uint8Array')
    }
    this.#podToKey.set(podId, publicKey)
    this.#keyToPod.set(hexFromBytes(publicKey), podId)
  }

  /**
   * Get the public key for a podId.
   * @param {string} podId
   * @returns {Uint8Array}
   */
  podIdToKey(podId) {
    const key = this.#podToKey.get(podId)
    if (!key) throw new Error(`No key registered for podId: ${podId}`)
    return key
  }

  /**
   * Get the podId for a public key.
   * @param {Uint8Array} key
   * @returns {string}
   */
  keyToPodId(key) {
    const podId = this.#keyToPod.get(hexFromBytes(key))
    if (!podId) throw new Error(`No podId registered for key: ${hexFromBytes(key)}`)
    return podId
  }

  /** Check if a podId is registered. */
  has(podId) {
    return this.#podToKey.has(podId)
  }

  /** Check if a key is registered. */
  hasKey(key) {
    return this.#keyToPod.has(hexFromBytes(key))
  }

  /** Number of registered mappings. */
  get size() {
    return this.#podToKey.size
  }
}

function hexFromBytes(bytes) {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
}

// ---------------------------------------------------------------------------
// ClawserTransportAdapter — raijin NetworkTransport over mesh wire format
// ---------------------------------------------------------------------------

/**
 * Adapts Clawser mesh channels to raijin's NetworkTransport interface.
 *
 * - broadcast(msg): encodes ConsensusMessage → wire envelope, sends to all peers
 * - send(to, msg): encodes and sends to a specific peer
 * - onMessage(handler): registers handler for incoming PBFT wire messages
 *
 * The adapter does NOT own the channels — it receives a send function and
 * dispatches incoming messages via handleIncoming().
 *
 * @example
 * ```js
 * const mapping = new PodKeyMapping()
 * mapping.register('pod-0', key0)
 * mapping.register('pod-1', key1)
 *
 * const adapter = new ClawserTransportAdapter('pod-0', mapping, {
 *   sendToAll: (wireMsg) => { ... },
 *   sendTo: (podId, wireMsg) => { ... },
 * })
 *
 * // Wire into raijin PBFTConsensus via config.transport
 * const pbft = new PBFTConsensus({ transport: adapter, ... })
 *
 * // When a PBFT wire message arrives from the mesh:
 * adapter.handleIncoming(fromPodId, wireType, payload)
 * ```
 */
export class ClawserTransportAdapter {
  #localPodId
  #mapping
  #sendToAll
  #sendTo
  #handler = null

  /**
   * @param {string} localPodId - This node's pod ID
   * @param {PodKeyMapping} mapping - Pod ↔ key mapping
   * @param {{ sendToAll: Function, sendTo: Function }} transport
   */
  constructor(localPodId, mapping, transport) {
    this.#localPodId = localPodId
    this.#mapping = mapping
    this.#sendToAll = transport.sendToAll
    this.#sendTo = transport.sendTo
  }

  // ── NetworkTransport interface ──────────────────────────────────────

  /**
   * Broadcast a ConsensusMessage to all peers.
   * @param {object} message - raijin ConsensusMessage
   */
  broadcast(message) {
    const wireMsg = this.#encode(message)
    this.#sendToAll(wireMsg)
  }

  /**
   * Send a ConsensusMessage to a specific peer.
   * @param {Uint8Array} to - Target validator's public key
   * @param {object} message - raijin ConsensusMessage
   */
  send(to, message) {
    const targetPodId = this.#mapping.keyToPodId(to)
    const wireMsg = this.#encode(message)
    this.#sendTo(targetPodId, wireMsg)
  }

  /**
   * Register a handler for incoming PBFT messages.
   * @param {(from: Uint8Array, msg: object) => void} handler
   */
  onMessage(handler) {
    this.#handler = handler
  }

  // ── Incoming message dispatch ───────────────────────────────────────

  /**
   * Called when a PBFT wire message arrives from the mesh.
   * Decodes the payload and dispatches to the registered handler.
   *
   * @param {string} fromPodId - Sender's pod ID
   * @param {number} wireType - MESH_TYPE code (0xED–0xF5)
   * @param {object} payload - JSON payload from wire message
   */
  handleIncoming(fromPodId, wireType, payload) {
    if (!this.#handler) return
    if (!PBFT_WIRE_CODES.has(wireType)) return

    const msgType = PBFT_CODE_TO_TYPE[wireType]
    if (!msgType) return

    const fromKey = this.#mapping.podIdToKey(fromPodId)
    const decoded = decodeValue(payload)
    decoded.type = msgType

    this.#handler(fromKey, decoded)
  }

  // ── Encoding ────────────────────────────────────────────────────────

  /**
   * Encode a raijin ConsensusMessage to a wire message object.
   * Returns { type: wireCode, from: podId, payload: encodedPayload }.
   */
  #encode(message) {
    const wireType = PBFT_TYPE_TO_CODE[message.type]
    if (wireType === undefined) {
      throw new Error(`Unknown PBFT message type: ${message.type}`)
    }

    // Clone without 'type' field (it's encoded in the wire code)
    const payload = {}
    for (const [k, v] of Object.entries(message)) {
      if (k === 'type') continue
      payload[k] = encodeValue(v)
    }

    return {
      type: wireType,
      from: this.#localPodId,
      payload,
    }
  }
}

// ---------------------------------------------------------------------------
// Static encode/decode for testing
// ---------------------------------------------------------------------------

/**
 * Encode a ConsensusMessage payload for wire transport.
 * Handles bigint → string and Uint8Array → base64url.
 */
export function encodePBFTPayload(message) {
  const payload = {}
  for (const [k, v] of Object.entries(message)) {
    if (k === 'type') continue
    payload[k] = encodeValue(v)
  }
  return payload
}

/**
 * Decode a wire payload back to a ConsensusMessage.
 * Restores bigint and Uint8Array values.
 *
 * @param {number} wireType
 * @param {object} payload
 * @returns {object} ConsensusMessage
 */
export function decodePBFTPayload(wireType, payload) {
  const msgType = PBFT_CODE_TO_TYPE[wireType]
  if (!msgType) throw new Error(`Unknown PBFT wire code: 0x${wireType.toString(16)}`)
  const decoded = decodeValue(payload)
  decoded.type = msgType
  return decoded
}

/**
 * Get the wire code for a PBFT message type string.
 * @param {string} type - e.g. 'pre-prepare', 'prepare', 'commit'
 * @returns {number} Wire code
 */
export function pbftTypeToWireCode(type) {
  const code = PBFT_TYPE_TO_CODE[type]
  if (code === undefined) throw new Error(`Unknown PBFT type: ${type}`)
  return code
}

/**
 * Get the PBFT message type string for a wire code.
 * @param {number} code - Wire code
 * @returns {string} Message type
 */
export function wireCodeToPbftType(code) {
  const type = PBFT_CODE_TO_TYPE[code]
  if (!type) throw new Error(`Unknown PBFT wire code: 0x${code.toString(16)}`)
  return type
}

// Re-export for convenience
export { PBFT_TYPE_TO_CODE, PBFT_CODE_TO_TYPE }
export { encodeValue as _encodeValue, decodeValue as _decodeValue }
export { uint8ToBase64url as _uint8ToBase64url, base64urlToUint8 as _base64urlToUint8 }
