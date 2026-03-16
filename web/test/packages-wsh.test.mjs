/**
 * packages-wsh — Module loading, export verification, and basic API tests.
 *
 * Run: node --import ./web/test/_setup-globals.mjs --test web/test/packages-wsh.test.mjs
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

import {
  // CBOR codec
  cborEncode, cborDecode, frameEncode, FrameDecoder,
  // Protocol messages
  MSG, MSG_NAMES, CHANNEL_KIND, AUTH_METHOD, PROTOCOL_VERSION,
  hello, serverHello, challenge, auth, authOk, authFail,
  open, openOk, openFail, resize, signal, exit, close, sessionData, error, ping, pong,
  msgName, isValidMessage,
  // Auth
  generateKeyPair, exportPublicKeyRaw, exportPublicKeySSH,
  sign, verify, fingerprint, generateNonce,
  // Transport
  WshTransport,
  WebSocketTransport,
  // Session + Client
  WshSession, WshClient,
  WshVirtualSessionBackend, normalizeSessionData,
  // Key storage
  WshKeyStore,
  // File transfer
  WshFileTransfer,
  // Recording
  SessionRecorder, SessionPlayer,
  // MCP bridge
  WshMcpBridge,
} from '../packages-wsh.js'

// ── 1. Exports exist ───────────────────────────────────────────────────

describe('wsh — exports', () => {
  it('exports CBOR codec functions and FrameDecoder', () => {
    assert.equal(typeof cborEncode, 'function')
    assert.equal(typeof cborDecode, 'function')
    assert.equal(typeof frameEncode, 'function')
    assert.equal(typeof FrameDecoder, 'function')
  })

  it('exports MSG constants', () => {
    assert.ok(MSG)
    assert.equal(MSG.HELLO, 0x01)
    assert.equal(MSG.PING, 0x21)
    assert.equal(MSG.PONG, 0x22)
  })

  it('exports message constructor functions', () => {
    for (const fn of [hello, serverHello, challenge, auth, authOk, authFail,
                       open, openOk, openFail, resize, signal, exit, close,
                       sessionData, error, ping, pong]) {
      assert.equal(typeof fn, 'function')
    }
    assert.equal(typeof msgName, 'function')
    assert.equal(typeof isValidMessage, 'function')
  })

  it('exports auth functions', () => {
    assert.equal(typeof generateKeyPair, 'function')
    assert.equal(typeof exportPublicKeyRaw, 'function')
    assert.equal(typeof sign, 'function')
    assert.equal(typeof verify, 'function')
    assert.equal(typeof fingerprint, 'function')
    assert.equal(typeof generateNonce, 'function')
  })

  it('exports transport, session, client, and utility classes', () => {
    assert.equal(typeof WshTransport, 'function')
    assert.equal(typeof WebSocketTransport, 'function')
    assert.equal(typeof WshSession, 'function')
    assert.equal(typeof WshClient, 'function')
    assert.equal(typeof WshKeyStore, 'function')
    assert.equal(typeof WshFileTransfer, 'function')
    assert.equal(typeof SessionRecorder, 'function')
    assert.equal(typeof WshMcpBridge, 'function')
  })
})

// ── 2. CBOR encode/decode round-trip ───────────────────────────────────

describe('wsh — CBOR', () => {
  it('round-trips primitives', () => {
    const cases = [42, -7, 0, 'hello', true, false, null, 3.14]
    for (const val of cases) {
      const bytes = cborEncode(val)
      assert.ok(bytes instanceof Uint8Array)
      const decoded = cborDecode(bytes)
      assert.equal(decoded, val)
    }
  })

  it('round-trips objects and arrays', () => {
    const obj = { cmd: 'run', args: [1, 2, 3], ok: true }
    const bytes = cborEncode(obj)
    const decoded = cborDecode(bytes)
    assert.deepEqual(decoded, obj)
  })

  it('round-trips Uint8Array as bytes', () => {
    const data = new Uint8Array([0, 128, 255])
    const bytes = cborEncode(data)
    const decoded = cborDecode(bytes)
    assert.ok(decoded instanceof Uint8Array)
    assert.deepEqual(decoded, data)
  })
})

// ── 3. Frame encode/decode ─────────────────────────────────────────────

describe('wsh — framing', () => {
  it('frameEncode produces 4-byte length prefix + CBOR', () => {
    const frame = frameEncode({ type: 'ping' })
    assert.ok(frame instanceof Uint8Array)
    assert.ok(frame.length > 4)

    const view = new DataView(frame.buffer)
    const payloadLen = view.getUint32(0)
    assert.equal(frame.length, 4 + payloadLen)
  })

  it('FrameDecoder reassembles chunked data', () => {
    const decoder = new FrameDecoder()
    const frame = frameEncode({ value: 99 })

    // Feed in two halves
    const half = Math.floor(frame.length / 2)
    const msgs1 = decoder.feed(frame.slice(0, half))
    assert.equal(msgs1.length, 0) // incomplete

    const msgs2 = decoder.feed(frame.slice(half))
    assert.equal(msgs2.length, 1)
    assert.deepEqual(msgs2[0], { value: 99 })
    assert.equal(decoder.pending, 0)
  })

  it('FrameDecoder.reset clears state', () => {
    const decoder = new FrameDecoder()
    decoder.feed(new Uint8Array([0, 0, 0, 10])) // partial frame header
    assert.ok(decoder.pending > 0)
    decoder.reset()
    assert.equal(decoder.pending, 0)
  })
})

// ── 4. Message constructors ────────────────────────────────────────────

describe('wsh — message constructors', () => {
  it('ping/pong create valid messages', () => {
    const p = ping()
    assert.equal(p.type, MSG.PING)
    assert.ok(isValidMessage(p))

    const po = pong()
    assert.equal(po.type, MSG.PONG)
    assert.ok(isValidMessage(po))
  })

  it('msgName returns human-readable name', () => {
    assert.equal(typeof msgName(MSG.HELLO), 'string')
  })
})

// ── 5. normalizeSessionData ────────────────────────────────────────────

describe('wsh — normalizeSessionData', () => {
  it('passes through Uint8Array', () => {
    const data = new Uint8Array([65, 66])
    assert.equal(normalizeSessionData(data), data)
  })

  it('encodes string to Uint8Array', () => {
    const result = normalizeSessionData('hello')
    assert.ok(result instanceof Uint8Array)
    assert.equal(new TextDecoder().decode(result), 'hello')
  })
})

// ── 6. SessionRecorder construction ────────────────────────────────────

describe('wsh — SessionRecorder', () => {
  it('constructs with sessionId and defaults', () => {
    const rec = new SessionRecorder('sess-1')
    assert.equal(rec.sessionId, 'sess-1')
    assert.ok(Array.isArray(rec.entries))
    assert.equal(rec.entries.length, 0)
    assert.equal(typeof rec.startTime, 'number')
  })

  it('throws when sessionId is missing', () => {
    assert.throws(() => new SessionRecorder(), /sessionId/)
  })
})

// ── 7. WshKeyStore construction ────────────────────────────────────────

describe('wsh — WshKeyStore', () => {
  it('constructs without error', () => {
    const store = new WshKeyStore()
    assert.ok(store)
    assert.equal(store._db, null)
  })

  it('close on unopened store is a no-op', () => {
    const store = new WshKeyStore()
    store.close() // should not throw
    assert.equal(store._db, null)
  })
})
