/**
 * clawser-raijin-wsh-adapter.js — WSH transport adapter for raijin PBFT consensus.
 *
 * Maps wsh sessions to raijin's NetworkTransport interface using CBOR encoding
 * from wsh for efficient binary transport. Reuses PBFT wire codes (0xED-0xF5)
 * from the mesh bridge but sends over raw wsh byte streams instead of mesh
 * envelopes.
 *
 * Run tests:
 *   node --import ./web/test/_setup-globals.mjs --test web/test/clawser-raijin-wsh-adapter.test.mjs
 */

import { cborEncode, cborDecode } from './packages/wsh/src/cbor.mjs'
import {
  PBFT_WIRE_CODES,
  pbftTypeToWireCode,
  wireCodeToPbftType,
  _encodeValue,
  _decodeValue,
  _hexFromBytes,
} from './clawser-raijin-bridge.js'

// ---------------------------------------------------------------------------
// SessionKeyMapping — bidirectional sessionId <-> validator public key
// ---------------------------------------------------------------------------

/**
 * Maps wsh session IDs to raijin validator public keys and back.
 */
export class SessionKeyMapping {
  /** @type {Map<string, Uint8Array>} sessionId -> publicKey */
  #sessionToKey = new Map()

  /** @type {Map<string, string>} hex(key) -> sessionId */
  #keyToSession = new Map()

  /**
   * Register a mapping between a session ID and a validator public key.
   * @param {string} sessionId
   * @param {Uint8Array} publicKey
   */
  register(sessionId, publicKey) {
    if (!sessionId || typeof sessionId !== 'string') {
      throw new Error('sessionId must be a non-empty string')
    }
    if (!(publicKey instanceof Uint8Array)) {
      throw new Error('publicKey must be a Uint8Array')
    }
    this.#sessionToKey.set(sessionId, publicKey)
    this.#keyToSession.set(hexFromBytes(publicKey), sessionId)
  }

  /**
   * Get the public key for a session ID.
   * @param {string} sessionId
   * @returns {Uint8Array}
   */
  sessionToKey(sessionId) {
    const key = this.#sessionToKey.get(sessionId)
    if (!key) throw new Error(`No key registered for session: ${sessionId}`)
    return key
  }

  /**
   * Get the session ID for a public key.
   * @param {Uint8Array} key
   * @returns {string}
   */
  keyToSession(key) {
    const sessionId = this.#keyToSession.get(hexFromBytes(key))
    if (!sessionId) throw new Error(`No session registered for key: ${hexFromBytes(key)}`)
    return sessionId
  }

  /** Check if a session ID is registered. */
  has(sessionId) {
    return this.#sessionToKey.has(sessionId)
  }

  /** Check if a key is registered. */
  hasKey(key) {
    return this.#keyToSession.has(hexFromBytes(key))
  }

  /** Number of registered mappings. */
  get size() {
    return this.#sessionToKey.size
  }
}

const hexFromBytes = _hexFromBytes

// ---------------------------------------------------------------------------
// WshPBFTTransport — raijin NetworkTransport over wsh sessions
// ---------------------------------------------------------------------------

/**
 * Adapts wsh sessions to raijin's NetworkTransport interface.
 *
 * Wire format per message: CBOR-encoded object with:
 *   { w: <wireCode>, p: <encodedPayload> }
 *
 * The `w` field carries the PBFT wire code (0xED-0xF5).
 * The `p` field carries the payload with bigint/Uint8Array encoded via
 * _encodeValue from the bridge.
 *
 * @example
 * ```js
 * const mapping = new SessionKeyMapping()
 * mapping.register('sess-0', key0)
 * mapping.register('sess-1', key1)
 *
 * const transport = new WshPBFTTransport('sess-0', mapping, {
 *   sendToAll: (bytes) => { ... },
 *   sendTo: (sessionId, bytes) => { ... },
 * })
 *
 * // Wire into raijin PBFTConsensus
 * const pbft = new PBFTConsensus({ transport, ... })
 *
 * // When raw bytes arrive from a wsh session:
 * transport.handleIncoming('sess-1', cborBytes)
 * ```
 */
export class WshPBFTTransport {
  #localSessionId
  #mapping
  #sendToAll
  #sendTo
  #handler = null

  /**
   * @param {string} localSessionId - This node's wsh session ID
   * @param {SessionKeyMapping} mapping - Session <-> key mapping
   * @param {{ sendToAll: (bytes: Uint8Array) => void, sendTo: (sessionId: string, bytes: Uint8Array) => void }} io
   */
  constructor(localSessionId, mapping, io) {
    this.#localSessionId = localSessionId
    this.#mapping = mapping
    this.#sendToAll = io.sendToAll
    this.#sendTo = io.sendTo
  }

  // ── NetworkTransport interface ──────────────────────────────────────

  /**
   * Broadcast a ConsensusMessage to all peers.
   * @param {object} message - raijin ConsensusMessage
   */
  broadcast(message) {
    const bytes = this.#encode(message)
    this.#sendToAll(bytes)
  }

  /**
   * Send a ConsensusMessage to a specific peer.
   * @param {Uint8Array} to - Target validator's public key
   * @param {object} message - raijin ConsensusMessage
   */
  send(to, message) {
    const targetSession = this.#mapping.keyToSession(to)
    const bytes = this.#encode(message)
    this.#sendTo(targetSession, bytes)
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
   * Called when raw CBOR bytes arrive from a wsh session.
   * Decodes the envelope, restores the ConsensusMessage, and dispatches
   * to the registered handler.
   *
   * @param {string} fromSessionId - Sender's wsh session ID
   * @param {Uint8Array} bytes - CBOR-encoded wire envelope
   */
  handleIncoming(fromSessionId, bytes) {
    if (!this.#handler) return

    const envelope = cborDecode(bytes)
    const wireCode = envelope.w
    if (!PBFT_WIRE_CODES.has(wireCode)) return

    let msgType
    try {
      msgType = wireCodeToPbftType(wireCode)
    } catch {
      return
    }

    const fromKey = this.#mapping.sessionToKey(fromSessionId)
    const decoded = _decodeValue(envelope.p)
    decoded.type = msgType

    this.#handler(fromKey, decoded)
  }

  // ── Encoding ────────────────────────────────────────────────────────

  /**
   * Encode a raijin ConsensusMessage to CBOR bytes.
   * @param {object} message
   * @returns {Uint8Array}
   */
  #encode(message) {
    const wireCode = pbftTypeToWireCode(message.type)

    // Build payload without 'type' (encoded in wire code)
    const payload = {}
    for (const [k, v] of Object.entries(message)) {
      if (k === 'type') continue
      payload[k] = _encodeValue(v)
    }

    return cborEncode({ w: wireCode, p: payload })
  }
}
