/**
 * tools/wsh-server.mjs — a minimal Node.js server for the wsh-v1 protocol,
 * built to interoperate with the real `wsh-upon-star` client library.
 *
 * Two transports, sharing one connection-agnostic protocol handler:
 *   - WebSocket (`ws`), always available.
 *   - WebTransport (QUIC/HTTP3, via `@fails-components/webtransport`),
 *     started alongside WebSocket only when `cert`/`key` are given — the
 *     WebTransport spec requires TLS unconditionally, there's no
 *     plaintext-QUIC option the way there's plain `ws://` for WebSocket.
 *     Closes the gap left by the original Rust `wsh-server` (removed
 *     2026-03-14, see docs/WSH-INTO-CLAWSER.md), which used `wtransport`/
 *     `quinn` for the same purpose.
 *
 * Two operating modes, over either transport:
 *   - Direct host: authenticate a client, then run `kind: 'exec'` sessions
 *     by spawning a real child process and streaming its output back.
 *     `kind: 'pty'` is explicitly rejected (openFail) — there's no PTY
 *     backend here (no node-pty dependency), and the doc this replaces
 *     already noted the browser-reverse-peer path has no real PTY either.
 *   - Relay (--enable-relay): browser tabs register as reverse peers
 *     (ReverseRegister); an operator lists them (ReverseList) and asks to
 *     reverse-connect (ReverseConnect); the relay forwards that to the
 *     target peer, forwards the peer's ReverseAccept/ReverseReject back,
 *     and — once accepted — forwards channel-scoped session messages
 *     (Open/OpenOk/OpenFail/Close/Resize/Signal/SessionData/Exit)
 *     bidirectionally between that one operator/peer pair until either
 *     side disconnects. This is a single-active-session-per-pairing
 *     design, not general multi-channel relay multiplexing — documented
 *     as a scope simplification (see docs/WSH-INTO-CLAWSER.md), since
 *     the reference protocol package (wsh-upon-star) ships no relay
 *     implementation to model this against (verified: it's a pure
 *     client library).
 *
 * There is no `authorized_keys` trust-store concept in wsh-upon-star —
 * that's entirely this file's own addition, in the same spirit as SSH's
 * `~/.ssh/authorized_keys`: one `ssh-ed25519 AAAA... comment` line per
 * trusted public key.
 *
 * Data plane: every session here uses `data_mode: 'virtual'` in OpenOk,
 * so all I/O flows as `SessionData` control-channel messages rather than
 * needing per-transport stream multiplexing — `WshVirtualSessionBackend`
 * in wsh-upon-star already implements the client side of exactly this
 * mode, for both transports.
 *
 * Connection abstraction: every connection (WS or WT) is reduced to a
 * `handle = { send(msg), close() }` as soon as it's accepted, and the
 * entire auth/exec/relay state machine below (`#handleMessage` and
 * everything it calls) is written purely against that abstraction plus a
 * transport-agnostic `conn` state object — it has no idea which
 * transport it's talking to. Only the two `#handle*Connection` entry
 * points below are transport-specific.
 *
 * WebSocket outer framing: `WebSocketTransport` (the real client's
 * WebSocket transport, src/transport-ws.mjs) wraps every CBOR control
 * message in its own 5-byte multiplexing header —
 * `[1-byte frame type][4-byte big-endian stream id][payload]` — with
 * frame type 0x01 ("control") and stream id 0 reserved for control-plane
 * traffic. This lets one WebSocket carry both control messages and
 * multiple raw data streams (used for `data_mode: 'stream'`, which this
 * server never sends). These constants/helpers aren't exported from
 * wsh-upon-star's public API (only the transport *classes* are), so
 * they're reimplemented here to match byte-for-byte — confirmed against
 * the real source, not guessed. Since every session here uses
 * `data_mode: 'virtual'`, this server only ever needs to send/receive
 * frame type 0x01 on stream 0 — no OPEN_STREAM/CLOSE_STREAM/DATA frames.
 *
 * WebTransport framing is simpler: no outer wrapper at all. Per
 * `WebTransportTransport` (src/transport.mjs), the client opens its own
 * first bidirectional stream as the dedicated control stream and sends
 * plain length-prefixed CBOR frames (`frameEncode`/`FrameDecoder`) on it
 * directly — WebTransport already multiplexes streams at the transport
 * layer, so there's no need for the WebSocket transport's extra 5-byte
 * header. This server accepts that first incoming bidirectional stream
 * as the control stream and ignores/cancels any further ones (nothing
 * here uses `data_mode: 'stream'`, so extra streams are unexpected).
 *
 * Run tests:
 *   node --test tools/test/wsh-server.test.mjs
 */

import { WebSocketServer } from 'ws';
import { Http3Server } from '@fails-components/webtransport';
import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { randomUUID, randomBytes } from 'node:crypto';
import { homedir } from 'node:os';
import path from 'node:path';

import {
  MSG,
  FrameDecoder, frameEncode,
  challenge, authOk, authFail,
  openOk, openFail, sessionData, exit as exitMsg, close as closeMsg,
  reversePeers, reverseReject,
  generateNonce, verifyChallenge, fingerprint,
  parseSSHPublicKey, extractRawFromSSHWire, importPublicKeyRaw,
} from 'wsh-upon-star';

// ---------------------------------------------------------------------------
// WebSocket outer multiplexing frame (control channel only — see header note)
// ---------------------------------------------------------------------------

const WS_FRAME_CONTROL = 0x01;
const WS_FRAME_HEADER_SIZE = 5;

/** Wrap a CBOR-encoded control message in the transport's 5-byte header. */
export function buildControlFrame(cborPayload) {
  const frame = new Uint8Array(WS_FRAME_HEADER_SIZE + cborPayload.byteLength);
  const view = new DataView(frame.buffer);
  view.setUint8(0, WS_FRAME_CONTROL);
  view.setUint32(1, 0); // stream id 0 = control
  frame.set(cborPayload, WS_FRAME_HEADER_SIZE);
  return frame;
}

/** Strip the 5-byte header. Returns null for any non-control frame (unsupported here). */
export function parseControlFrame(data) {
  if (data.byteLength < WS_FRAME_HEADER_SIZE) return null;
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  if (view.getUint8(0) !== WS_FRAME_CONTROL) return null;
  return data.subarray(WS_FRAME_HEADER_SIZE);
}

/** Encode + frame + send one control message to a raw `ws` socket. */
export function sendFrame(ws, msg) {
  ws.send(buildControlFrame(frameEncode(msg)));
}

// ---------------------------------------------------------------------------
// authorized_keys
// ---------------------------------------------------------------------------

/**
 * Parse an SSH-`authorized_keys`-style file: one `ssh-ed25519 AAAA...
 * [comment]` line per trusted key, blank lines and `#` comments ignored.
 *
 * @param {string} text
 * @returns {Promise<Map<string, {publicKey: CryptoKey, comment: string}>>} fingerprint -> entry
 */
export async function parseAuthorizedKeys(text) {
  const map = new Map();
  for (const rawLine of (text || '').split('\n')) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    try {
      const parsed = parseSSHPublicKey(line);
      const raw = extractRawFromSSHWire(parsed.data);
      const fp = await fingerprint(raw);
      const publicKey = await importPublicKeyRaw(raw);
      map.set(fp, { publicKey, comment: parsed.comment || '' });
    } catch {
      // Skip malformed lines rather than failing the whole file.
    }
  }
  return map;
}

/** @param {string} path @returns {Promise<Map<string, object>>} */
export async function loadAuthorizedKeys(path) {
  const text = await readFile(path, 'utf8').catch(() => '');
  return parseAuthorizedKeys(text);
}

// ---------------------------------------------------------------------------
// Relay-forwardable message types (channel-scoped session traffic)
// ---------------------------------------------------------------------------

const RELAY_FORWARD_TYPES = new Set([
  MSG.OPEN, MSG.OPEN_OK, MSG.OPEN_FAIL,
  MSG.CLOSE, MSG.RESIZE, MSG.SIGNAL,
  MSG.SESSION_DATA, MSG.EXIT,
]);

// ---------------------------------------------------------------------------
// WshServer
// ---------------------------------------------------------------------------

/**
 * A single wsh-v1 server: direct-host exec sessions, and (optionally) a
 * reverse-connect relay.
 */
export class WshServer {
  #wss = null;
  #httpServer = null;
  #wtServer = null;
  #authorizedKeys;
  #enableRelay;
  #execTimeoutMs;
  #onLog;

  /** @type {Map<string, {handle: {send: Function, close: Function}, meta: object}>} fingerprint -> registered reverse peer */
  #peers = new Map();

  /** @type {Map<string, {operatorHandle: {send: Function, close: Function}, targetFingerprint: string}>} operator connection id -> pending reverse-connect */
  #pendingReverse = new Map();

  /** @type {Map<object, object>} paired connection handles, both directions present as keys */
  #pairings = new Map();

  /** @type {Map<object, {conn: object, ctx: object}>} handle -> its protocol state, transport-agnostic */
  #contexts = new Map();

  /**
   * @param {object} [opts]
   * @param {Map<string, object>} [opts.authorizedKeys] - fingerprint -> {publicKey, comment}; empty/omitted = reject all pubkey auth
   * @param {boolean} [opts.enableRelay=false]
   * @param {number} [opts.execTimeoutMs=0] - kill a spawned exec session after this long (0 = no timeout)
   * @param {(msg: string) => void} [opts.onLog]
   */
  constructor(opts = {}) {
    this.#authorizedKeys = opts.authorizedKeys || new Map();
    this.#enableRelay = !!opts.enableRelay;
    this.#execTimeoutMs = opts.execTimeoutMs || 0;
    this.#onLog = opts.onLog || (() => {});
  }

  /**
   * Start listening. Plain `ws://` by default (fine for localhost/trusted-
   * network use, matching the original doc's `--generate-cert` local-dev
   * story); pass `cert`/`key` for `wss://` — a real remote hostname a
   * browser tab will reverse-connect to needs a certificate the browser
   * trusts, same requirement the original doc called out for the Rust
   * `wsh-server`.
   *
   * When `cert`/`key` are given, a WebTransport (QUIC/HTTP3) listener is
   * *also* started on the same `port`/`host` (UDP alongside WebSocket's
   * TCP — same port number, different protocol, no conflict), same as
   * the original Rust `wsh-server` did with `wtransport`. WebTransport
   * has no plaintext mode, so without a cert it's simply not started —
   * the server still works over plain `ws://` in that case, same as
   * before.
   *
   * @param {object} [opts]
   * @param {number} [opts.port=0] - 0 = OS-assigned free port
   * @param {string} [opts.host='0.0.0.0']
   * @param {string} [opts.cert] - PEM certificate (enables wss:// and WebTransport)
   * @param {string} [opts.key] - PEM private key (required with cert)
   * @returns {Promise<number>} the actual bound port
   */
  async listen({ port = 0, host = '0.0.0.0', cert, key } = {}) {
    if (cert && key) {
      const { createServer } = await import('node:https');
      this.#httpServer = createServer({ cert, key });
      this.#wss = new WebSocketServer({ server: this.#httpServer });
      await new Promise((resolve, reject) => {
        this.#httpServer.listen(port, host, resolve);
        this.#httpServer.once('error', reject);
      });
      const boundPort = this.#httpServer.address().port;

      this.#wtServer = new Http3Server({
        port: boundPort,
        host,
        secret: randomBytes(16).toString('hex'),
        cert,
        privKey: key,
      });
      const sessions = this.#wtServer.sessionStream('/');
      this.#wtServer.startServer();
      await this.#wtServer.ready;
      this.#acceptWtSessions(sessions);
    } else {
      this.#wss = new WebSocketServer({ port, host });
      await new Promise((resolve, reject) => {
        this.#wss.once('listening', resolve);
        this.#wss.once('error', reject);
      });
    }
    this.#wss.on('connection', (ws) => this.#handleWsConnection(ws));
    return (this.#httpServer || this.#wss).address().port;
  }

  /** Stop listening and close all connections. */
  async close() {
    if (!this.#wss) return;
    for (const client of this.#wss.clients) {
      try { client.terminate(); } catch { /* best-effort */ }
    }
    await new Promise((resolve) => this.#wss.close(() => resolve()));
    if (this.#httpServer) {
      await new Promise((resolve) => this.#httpServer.close(() => resolve()));
      this.#httpServer = null;
    }
    if (this.#wtServer) {
      try { this.#wtServer.stopServer(); } catch { /* best-effort */ }
      this.#wtServer = null;
    }
    this.#wss = null;
    this.#peers.clear();
    this.#pendingReverse.clear();
    this.#pairings.clear();
  }

  /** Registered reverse peers, for diagnostics/tests. */
  listPeerFingerprints() {
    return [...this.#peers.keys()];
  }

  // -- Connection handling (transport-specific entry points) -----------

  #handleWsConnection(ws) {
    const decoder = new FrameDecoder();
    const handle = {
      send: (msg) => sendFrame(ws, msg),
      close: () => { try { ws.close(); } catch { /* best-effort */ } },
    };

    ws.on('message', (data) => {
      const payload = parseControlFrame(new Uint8Array(data));
      if (!payload) return; // non-control frame (data/open-stream/close-stream) — unsupported, ignore
      let messages;
      try {
        messages = decoder.feed(payload);
      } catch (e) {
        this.#onLog(`[wsh-server] frame decode error: ${e.message}`);
        return;
      }
      for (const msg of messages) this.#dispatch(handle, msg);
    });

    const { conn, sessions } = this.#registerConnection(handle);
    ws.on('close', () => this.#cleanupConnection(handle, conn, sessions));
  }

  /**
   * Accept incoming WebTransport sessions from `sessionStream('/')`. The
   * first bidirectional stream a session opens becomes its control
   * stream (matches `WebTransportTransport._doConnect` on the client
   * side); any further incoming stream on the same session is
   * unexpected here (nothing uses `data_mode: 'stream'`) and is closed
   * immediately rather than silently ignored.
   *
   * @param {ReadableStream} sessionReadable
   */
  async #acceptWtSessions(sessionReadable) {
    const reader = sessionReadable.getReader();
    for (;;) {
      const { done, value: session } = await reader.read();
      if (done) return;
      this.#handleWtSession(session).catch((e) => this.#onLog(`[wsh-server] WebTransport session error: ${e.message}`));
    }
  }

  async #handleWtSession(session) {
    await session.ready;
    const bidiReader = session.incomingBidirectionalStreams.getReader();
    const { done, value: controlStream } = await bidiReader.read();
    if (done) return;

    const writer = controlStream.writable.getWriter();
    const handle = {
      send: (msg) => { writer.write(frameEncode(msg)).catch(() => { /* session likely closing */ }); },
      close: () => { try { session.close(); } catch { /* best-effort */ } },
    };

    // Extra incoming streams are unexpected (data_mode is always
    // 'virtual' here) — drain and reject them rather than leaking them.
    (async () => {
      for (;;) {
        const { done: extraDone, value: extra } = await bidiReader.read();
        if (extraDone) return;
        try { await extra.writable.close(); } catch { /* best-effort */ }
        try { await extra.readable.cancel(); } catch { /* best-effort */ }
      }
    })().catch(() => { /* session closing */ });

    const { conn, sessions } = this.#registerConnection(handle);
    const decoder = new FrameDecoder();
    const controlReader = controlStream.readable.getReader();
    try {
      for (;;) {
        const { done: streamDone, value } = await controlReader.read();
        if (streamDone) break;
        let messages;
        try {
          messages = decoder.feed(value);
        } catch (e) {
          this.#onLog(`[wsh-server] frame decode error: ${e.message}`);
          continue;
        }
        for (const msg of messages) this.#dispatch(handle, msg);
      }
    } finally {
      this.#cleanupConnection(handle, conn, sessions);
    }
  }

  // -- Shared connection lifecycle (transport-agnostic) -----------------

  /** @returns {{conn: object, sessions: Map}} */
  #registerConnection(handle) {
    /** @type {{sessionId: string, nonce: Uint8Array, authenticated: boolean, fingerprint: string|null, isPeer: boolean}} */
    const conn = { sessionId: randomUUID(), nonce: null, authenticated: false, fingerprint: null, isPeer: false };
    let channelCounter = 0;
    /** @type {Map<number, {proc: import('node:child_process').ChildProcess}>} */
    const sessions = new Map();
    const ctx = { send: handle.send, sessions, channelCounter: () => ++channelCounter };
    this.#contexts.set(handle, { conn, ctx });
    return { conn, sessions };
  }

  #dispatch(handle, msg) {
    const entry = this.#contexts.get(handle);
    if (!entry) return;
    this.#handleMessage(handle, entry.conn, msg, entry.ctx)
      .catch((e) => this.#onLog(`[wsh-server] handler error: ${e.message}`));
  }

  #cleanupConnection(handle, conn, sessions) {
    this.#contexts.delete(handle);
    for (const { proc } of sessions.values()) {
      try { proc.kill(); } catch { /* best-effort */ }
    }
    if (conn.fingerprint) this.#peers.delete(conn.fingerprint);
    this.#pendingReverse.delete(conn.sessionId);
    const partner = this.#pairings.get(handle);
    if (partner) {
      this.#pairings.delete(handle);
      this.#pairings.delete(partner);
      try { partner.close(); } catch { /* best-effort */ }
    }
  }

  async #handleMessage(handle, conn, msg, ctx) {
    if (!conn.authenticated) return this.#handleAuthPhase(handle, conn, msg, ctx);
    return this.#handlePostAuth(handle, conn, msg, ctx);
  }

  // -- Auth handshake ----------------------------------------------------

  async #handleAuthPhase(handle, conn, msg, ctx) {
    if (msg.type === MSG.HELLO) {
      conn.pendingUsername = msg.username;
      // Deliberately skip ServerHello and go straight to Challenge — the
      // client explicitly supports this ("some servers skip SERVER_HELLO
      // and go straight to CHALLENGE", client.mjs), falling back to the
      // literal session-id string "pending" for the transcript. Sending
      // ServerHello *then* Challenge back-to-back is real, but was found
      // to race: if both WebSocket frames land in the same underlying
      // read, the client can dispatch the second message before the
      // first message's `.then` continuation has registered the next
      // waiter, silently dropping Challenge and hanging until timeout.
      // One message, one wait — no race.
      conn.nonce = generateNonce();
      ctx.send(challenge({ nonce: conn.nonce }));
      return;
    }

    if (msg.type === MSG.AUTH) {
      if (msg.method !== 'pubkey') {
        ctx.send(authFail({ reason: 'only pubkey auth is supported' }));
        handle.close();
        return;
      }
      const publicKeyRaw = msg.public_key;
      const fp = await fingerprint(publicKeyRaw);
      const entry = this.#authorizedKeys.get(fp);
      if (!entry) {
        ctx.send(authFail({ reason: 'key not authorized' }));
        handle.close();
        return;
      }
      const ok = await verifyChallenge(entry.publicKey, msg.signature, 'pending', conn.nonce);
      if (!ok) {
        ctx.send(authFail({ reason: 'signature verification failed' }));
        handle.close();
        return;
      }
      conn.authenticated = true;
      conn.fingerprint = fp;
      conn.username = conn.pendingUsername;
      ctx.send(authOk({ sessionId: conn.sessionId, token: randomBytes(16), ttl: 3600 }));
      this.#onLog(`[wsh-server] authenticated ${conn.username} (${fp.slice(0, 12)}…)`);
      return;
    }

    // Anything else before auth completes is protocol misuse — ignore.
  }

  // -- Post-auth: direct-host sessions + relay ---------------------------

  async #handlePostAuth(handle, conn, msg, ctx) {
    if (this.#enableRelay) {
      const relayHandled = await this.#handleRelayMessage(handle, conn, msg, ctx);
      if (relayHandled) return;
    }

    switch (msg.type) {
      case MSG.OPEN:
        return this.#handleOpen(conn, msg, ctx);
      case MSG.SESSION_DATA:
        return this.#handleSessionData(msg, ctx);
      case MSG.CLOSE: {
        const session = ctx.sessions.get(msg.channel_id);
        if (session) { try { session.proc.kill(); } catch { /* best-effort */ } }
        return;
      }
      default:
        return; // unhandled message types are silently ignored (protocol is intentionally forgiving)
    }
  }

  #handleOpen(conn, msg, ctx) {
    if (msg.kind !== 'exec') {
      ctx.send(openFail({ reason: `kind "${msg.kind}" is not supported by this server — only "exec" is implemented (no PTY backend)` }));
      return;
    }
    if (!msg.command) {
      ctx.send(openFail({ reason: 'command is required for kind "exec"' }));
      return;
    }

    const channelId = ctx.channelCounter();
    const proc = spawn(msg.command, { shell: true, env: { ...process.env, ...(msg.env || {}) } });
    ctx.sessions.set(channelId, { proc });

    let killTimer = null;
    if (this.#execTimeoutMs > 0) {
      killTimer = setTimeout(() => { try { proc.kill(); } catch { /* best-effort */ } }, this.#execTimeoutMs);
    }

    proc.stdout.on('data', (chunk) => ctx.send(sessionData({ channelId, data: new Uint8Array(chunk) })));
    proc.stderr.on('data', (chunk) => ctx.send(sessionData({ channelId, data: new Uint8Array(chunk) })));
    proc.on('close', (code) => {
      if (killTimer) clearTimeout(killTimer);
      ctx.sessions.delete(channelId);
      try {
        ctx.send(exitMsg({ channelId, code: code ?? 0 }));
        ctx.send(closeMsg({ channelId }));
      } catch { /* connection likely already closed */ }
    });

    ctx.send(openOk({ channelId, streamIds: [], dataMode: 'virtual', capabilities: [] }));
  }

  #handleSessionData(msg, ctx) {
    const session = ctx.sessions.get(msg.channel_id);
    if (!session) return;
    session.proc.stdin.write(Buffer.from(msg.data));
  }

  // -- Relay -------------------------------------------------------------

  /** @returns {Promise<boolean>} true if the message was relay-specific and fully handled */
  async #handleRelayMessage(handle, conn, msg, ctx) {
    switch (msg.type) {
      case MSG.REVERSE_REGISTER: {
        conn.isPeer = true;
        this.#peers.set(conn.fingerprint, {
          handle, meta: {
            fingerprint: conn.fingerprint,
            fingerprintShort: conn.fingerprint.slice(0, 12),
            username: msg.username,
            capabilities: msg.capabilities || [],
            peerType: msg.peer_type || 'host',
            shellBackend: msg.shell_backend || 'pty',
            supportsAttach: !!msg.supports_attach,
            supportsReplay: !!msg.supports_replay,
            supportsEcho: !!msg.supports_echo,
            supportsTermSync: !!msg.supports_term_sync,
            lastSeen: Date.now(),
          },
        });
        this.#onLog(`[wsh-server relay] peer registered: ${conn.fingerprint.slice(0, 12)}… (${msg.username})`);
        return true;
      }

      case MSG.REVERSE_LIST: {
        const peers = [...this.#peers.values()].map((p) => ({
          fingerprint: p.meta.fingerprint,
          fingerprint_short: p.meta.fingerprintShort,
          username: p.meta.username,
          capabilities: p.meta.capabilities,
          peer_type: p.meta.peerType,
          shell_backend: p.meta.shellBackend,
          source: 'wsh-server',
          supports_attach: p.meta.supportsAttach,
          supports_replay: p.meta.supportsReplay,
          supports_echo: p.meta.supportsEcho,
          supports_term_sync: p.meta.supportsTermSync,
          last_seen: p.meta.lastSeen,
        }));
        ctx.send(reversePeers({ peers }));
        return true;
      }

      case MSG.REVERSE_CONNECT: {
        const target = this.#peers.get(msg.target_fingerprint);
        if (!target) {
          ctx.send(reverseReject({ targetFingerprint: msg.target_fingerprint, username: msg.username, reason: 'no such peer' }));
          return true;
        }
        this.#pendingReverse.set(conn.sessionId, { operatorHandle: handle, targetFingerprint: msg.target_fingerprint });
        target.handle.send(msg);
        return true;
      }

      case MSG.REVERSE_ACCEPT:
      case MSG.REVERSE_REJECT: {
        // From a peer, correlating back to whichever operator is waiting
        // on this peer's fingerprint.
        const pendingEntry = [...this.#pendingReverse.entries()]
          .find(([, p]) => p.targetFingerprint === conn.fingerprint);
        if (!pendingEntry) return true;
        const [operatorSessionId, pending] = pendingEntry;
        this.#pendingReverse.delete(operatorSessionId);
        pending.operatorHandle.send(msg);
        if (msg.type === MSG.REVERSE_ACCEPT) {
          this.#pairings.set(pending.operatorHandle, handle);
          this.#pairings.set(handle, pending.operatorHandle);
        }
        return true;
      }

      default: {
        if (!RELAY_FORWARD_TYPES.has(msg.type)) return false;
        const partner = this.#pairings.get(handle);
        if (!partner) return false;
        partner.send(msg);
        return true;
      }
    }
  }
}

// ---------------------------------------------------------------------------
// CLI entry point
// ---------------------------------------------------------------------------

const HELP_TEXT = `wsh-server — direct-host exec sessions, optionally a reverse-connect relay

Usage:
  wsh-server.mjs [--port 4422] [--host 0.0.0.0] [--authorized-keys ~/.wsh/authorized_keys]
                 [--enable-relay] [--cert path/to/fullchain.pem --key path/to/privkey.pem]

Options:
  --port <n>              Listen port (default: 4422)
  --host <addr>           Bind address (default: 0.0.0.0)
  --authorized-keys <path> SSH-format authorized_keys file (default: ~/.wsh/authorized_keys)
  --enable-relay          Also accept reverse-connect peer registrations
  --cert / --key <path>   PEM cert/key for wss:// + WebTransport (omit for plain ws://, fine for localhost)
  --exec-timeout-ms <n>   Kill a spawned exec session after this long (default: no timeout)

Passing --cert/--key also starts a WebTransport (QUIC/HTTP3) listener on
the same port (UDP alongside WebSocket's TCP) — WebTransport has no
plaintext mode, so it's simply not started without a cert.

No --generate-cert convenience flag (unlike the Rust wsh-server this
replaces) — bring your own cert/key, or use plain ws:// for local
development.
`;

async function runCli(argv) {
  const opts = { port: 4422, host: '0.0.0.0', authorizedKeysPath: path.join(homedir(), '.wsh', 'authorized_keys'), enableRelay: false };
  let certPath, keyPath;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--help' || arg === '-h') { process.stdout.write(HELP_TEXT); return 0; }
    if (arg === '--port') { opts.port = parseInt(argv[++i], 10); continue; }
    if (arg === '--host') { opts.host = argv[++i]; continue; }
    if (arg === '--authorized-keys') { opts.authorizedKeysPath = argv[++i]; continue; }
    if (arg === '--enable-relay') { opts.enableRelay = true; continue; }
    if (arg === '--cert') { certPath = argv[++i]; continue; }
    if (arg === '--key') { keyPath = argv[++i]; continue; }
    if (arg === '--exec-timeout-ms') { opts.execTimeoutMs = parseInt(argv[++i], 10); continue; }
  }

  const authorizedKeys = await loadAuthorizedKeys(opts.authorizedKeysPath);
  if (authorizedKeys.size === 0) {
    process.stderr.write(`Warning: no keys loaded from ${opts.authorizedKeysPath} — every connection will be rejected.\n`);
  }

  const server = new WshServer({
    authorizedKeys,
    enableRelay: opts.enableRelay,
    execTimeoutMs: opts.execTimeoutMs,
    onLog: (m) => console.log(m),
  });

  const listenOpts = { port: opts.port, host: opts.host };
  if (certPath && keyPath) {
    listenOpts.cert = await readFile(certPath, 'utf8');
    listenOpts.key = await readFile(keyPath, 'utf8');
  }
  const boundPort = await server.listen(listenOpts);
  const scheme = certPath ? 'wss' : 'ws';
  const wtNote = certPath ? ' + WebTransport (QUIC/HTTP3)' : '';
  console.log(`wsh-server ready on ${scheme}://${opts.host}:${boundPort}${wtNote}${opts.enableRelay ? ' (relay enabled)' : ''}`);

  process.on('SIGINT', async () => { await server.close(); process.exit(0); });
  process.on('SIGTERM', async () => { await server.close(); process.exit(0); });
  return null; // keep running
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runCli(process.argv.slice(2)).then((code) => { if (code !== null) process.exit(code); });
}
