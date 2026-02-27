/**
 * WshClient — manages a wsh connection, authentication, and multiple sessions.
 *
 * Handles the full lifecycle: transport selection, handshake, challenge-response
 * or password auth, channel multiplexing, ping/pong keepalive, and teardown.
 *
 * Supports forward connections (client opens sessions on a remote server) and
 * reverse mode (client registers as a peer for incoming connections).
 */

import { WebTransportTransport } from './transport.mjs';
import {
  MSG, AUTH_METHOD,
  hello, auth as authMsg, open as openMsg, close as closeMsg,
  attach as attachMsg, resume as resumeMsg, ping as pingMsg, pong as pongMsg,
  reverseRegister as reverseRegisterMsg, reverseList as reverseListMsg,
  reverseConnect as reverseConnectMsg,
  mcpDiscover as mcpDiscoverMsg, mcpCall as mcpCallMsg,
} from './messages.mjs';
import { signChallenge, exportPublicKeyRaw } from './auth.mjs';
import { WshSession } from './session.mjs';

// ── Client states ─────────────────────────────────────────────────────

const STATE_DISCONNECTED  = 'disconnected';
const STATE_CONNECTING    = 'connecting';
const STATE_CONNECTED     = 'connected';
const STATE_AUTHENTICATED = 'authenticated';
const STATE_CLOSED        = 'closed';

// ── Defaults ──────────────────────────────────────────────────────────

const DEFAULT_AUTH_TIMEOUT   = 10_000;  // ms
const DEFAULT_OPEN_TIMEOUT   = 10_000;  // ms
const DEFAULT_PING_INTERVAL  = 30_000;  // ms
const DEFAULT_EXEC_TIMEOUT   = 60_000;  // ms

// ── Client class ──────────────────────────────────────────────────────

export class WshClient {

  /** @type {'disconnected'|'connecting'|'connected'|'authenticated'|'closed'} */
  #state = STATE_DISCONNECTED;

  /** @type {string|null} Session ID assigned by the server after authentication. */
  #sessionId = null;

  /** @type {string|null} Resume token from AUTH_OK. */
  #resumeToken = null;

  /** @type {import('./transport.mjs').WshTransport|null} Active transport. */
  #transport = null;

  /** @type {Map<number, WshSession>} Active sessions keyed by channel ID. */
  #sessions = new Map();

  /** @type {number} Monotonically increasing channel ID counter. */
  #channelCounter = 0;

  /**
   * Pending message waiters: Map<messageType, Array<{resolve, reject, timer}>>
   * Multiple waiters can exist for the same message type.
   */
  #waiters = new Map();

  /** @type {string[]} Server-advertised features from SERVER_HELLO. */
  #serverFeatures = [];

  /** @type {number|null} Ping interval handle. */
  #pingTimer = null;

  /** @type {number} Current ping ID for matching pongs. */
  #pingId = 0;

  /** @type {number|null} Timestamp of last pong received. */
  #lastPong = null;

  // ── Callbacks ───────────────────────────────────────────────────────

  /** Called when the connection is closed (intentionally or otherwise). */
  onClose = null;

  /** Called on connection-level errors. */
  onError = null;

  /**
   * Called when a reverse-connect request arrives (reverse mode only).
   * @type {function(object): void|null}
   */
  onReverseConnect = null;

  /**
   * Called when a clipboard sync message arrives (OSC 52).
   * The default handler writes to navigator.clipboard automatically.
   * @type {function(object): void|null}
   */
  onClipboard = null;

  /**
   * Called when a relay-forwarded message arrives from a remote peer.
   *
   * In reverse mode, the relay bridge forwards messages from the CLI peer
   * to this browser client.  Messages that the client would not normally
   * receive as a peer (Open, McpCall, McpDiscover, Close, Resize, Signal)
   * are routed here instead of being silently dropped.
   *
   * @type {function(object): void|null}
   */
  onRelayMessage = null;

  /**
   * Called when a gateway-subsystem control message arrives (opcodes 0x70-0x7f).
   *
   * The gateway subsystem proxies TCP/UDP connections and DNS lookups through
   * the server.  This callback receives every gateway message that is not
   * consumed by an active waiter (e.g. a pending GatewayOk/GatewayFail for
   * an in-flight request).
   *
   * Typical use: wire this to the netway GatewayBackend so it can route
   * GatewayOk, GatewayFail, GatewayClose, DnsResult, InboundOpen, ListenOk,
   * and ListenFail messages to the correct virtual sockets and listeners.
   *
   * @type {function(object): void|null}
   * @param {object} msg - Decoded control message with at least:
   *   - `type` {number}  — message opcode (0x70-0x7f)
   *   - `gateway_id` or `listener_id` {number} — correlator
   *   - Plus message-specific fields (see wsh-v1.yaml gateway section)
   */
  onGatewayMessage = null;

  // ── Public properties ───────────────────────────────────────────────

  /** Current client state. */
  get state() {
    return this.#state;
  }

  /** Server-assigned session ID. */
  get sessionId() {
    return this.#sessionId;
  }

  /** Read-only view of active sessions. */
  get sessions() {
    return new Map(this.#sessions);
  }

  /** Server-advertised features from SERVER_HELLO. */
  get features() {
    return [...this.#serverFeatures];
  }

  /**
   * Low-level transport reference.
   * Exposed for relay message replies (IncomingSession._sendReply).
   * Prefer higher-level methods (openSession, callTool, etc.) for normal use.
   * @returns {import('./transport.mjs').WshTransport|null}
   */
  get _transport() {
    return this.#transport;
  }

  /**
   * Check if the server advertised a specific feature.
   * @param {string} name - Feature name (e.g. 'gateway', 'reverse', 'mcp')
   * @returns {boolean}
   */
  hasFeature(name) {
    return this.#serverFeatures.includes(name);
  }

  // ── Connection ──────────────────────────────────────────────────────

  /**
   * Connect to a wsh server, authenticate, and return the session ID.
   *
   * @param {string} url - Server URL (https:// for WebTransport, wss:// or ws:// for WebSocket)
   * @param {object} opts
   * @param {string} opts.username - Username for authentication
   * @param {CryptoKeyPair} [opts.keyPair] - Ed25519 key pair for pubkey auth
   * @param {string} [opts.password] - Password for password auth
   * @param {'wt'|'ws'} [opts.transport] - Force a specific transport
   * @param {number} [opts.timeout] - Auth handshake timeout in ms
   * @returns {Promise<string>} The server-assigned session ID
   */
  async connect(url, { username, keyPair, password, transport: transportHint, timeout = DEFAULT_AUTH_TIMEOUT } = {}) {
    if (this.#state !== STATE_DISCONNECTED && this.#state !== STATE_CLOSED) {
      throw new Error(`Client already ${this.#state}`);
    }
    if (!username) {
      throw new Error('username is required');
    }
    if (!keyPair && !password) {
      throw new Error('Either keyPair or password is required for authentication');
    }

    this.#state = STATE_CONNECTING;
    this.#sessions.clear();
    this.#channelCounter = 0;
    this.#waiters.clear();
    this.#sessionId = null;
    this.#resumeToken = null;

    try {
      // ── Select and connect transport ──────────────────────────────
      const transport = this.#createTransport(url, transportHint);
      this.#transport = transport;

      // Wire transport callbacks before connecting.
      transport.onControl = (msg) => this.#handleControl(msg);
      transport.onClose = () => this.#handleTransportClose();
      transport.onError = (err) => this.#handleTransportError(err);

      await transport.connect(url);
      this.#state = STATE_CONNECTED;

      // ── Auth handshake ────────────────────────────────────────────
      const authMethod = keyPair ? AUTH_METHOD.PUBKEY : AUTH_METHOD.PASSWORD;
      await transport.sendControl(
        hello({ username, authMethod })
      );

      // Wait for SERVER_HELLO (which may include a session ID directly) or CHALLENGE.
      const firstResponse = await this.#waitForMessage(
        [MSG.SERVER_HELLO, MSG.CHALLENGE, MSG.AUTH_FAIL],
        timeout,
        'Auth handshake timed out waiting for server response'
      );

      if (firstResponse.type === MSG.AUTH_FAIL) {
        throw new Error(`Authentication failed: ${firstResponse.reason || 'unknown'}`);
      }

      let tempSessionId = null;

      if (firstResponse.type === MSG.SERVER_HELLO) {
        // Server may proceed directly to auth if it accepted the hello.
        tempSessionId = firstResponse.session_id;
        this.#serverFeatures = firstResponse.features || [];

        // If pubkey auth, we still need a challenge.
        if (authMethod === AUTH_METHOD.PUBKEY) {
          const challengeMsg = await this.#waitForMessage(
            [MSG.CHALLENGE, MSG.AUTH_OK],
            timeout,
            'Auth handshake timed out waiting for challenge'
          );

          if (challengeMsg.type === MSG.AUTH_OK) {
            // Server accepted without challenge (e.g. trusted key).
            this.#sessionId = challengeMsg.session_id || tempSessionId;
            this.#resumeToken = challengeMsg.token || null;
            this.#state = STATE_AUTHENTICATED;
            this.#startPing();
            return this.#sessionId;
          }

          // Sign the challenge.
          const { signature, publicKeyRaw } = await signChallenge(
            keyPair.privateKey,
            keyPair.publicKey,
            tempSessionId,
            challengeMsg.nonce
          );

          await transport.sendControl(
            authMsg({
              method: AUTH_METHOD.PUBKEY,
              signature,
              publicKey: publicKeyRaw,
            })
          );
        } else {
          // Password auth — send immediately after SERVER_HELLO.
          await transport.sendControl(
            authMsg({
              method: AUTH_METHOD.PASSWORD,
              password,
            })
          );
        }
      } else if (firstResponse.type === MSG.CHALLENGE) {
        // Some servers skip SERVER_HELLO and go straight to CHALLENGE.
        if (authMethod !== AUTH_METHOD.PUBKEY || !keyPair) {
          throw new Error('Server sent CHALLENGE but no key pair was provided');
        }

        // We need a session ID for the transcript. Use the nonce-derived ID
        // or a placeholder if the server hasn't provided one.
        tempSessionId = tempSessionId || 'pending';

        const { signature, publicKeyRaw } = await signChallenge(
          keyPair.privateKey,
          keyPair.publicKey,
          tempSessionId,
          firstResponse.nonce
        );

        await transport.sendControl(
          authMsg({
            method: AUTH_METHOD.PUBKEY,
            signature,
            publicKey: publicKeyRaw,
          })
        );
      }

      // Wait for AUTH_OK or AUTH_FAIL.
      const authResult = await this.#waitForMessage(
        [MSG.AUTH_OK, MSG.AUTH_FAIL],
        timeout,
        'Auth handshake timed out waiting for auth result'
      );

      if (authResult.type === MSG.AUTH_FAIL) {
        throw new Error(`Authentication failed: ${authResult.reason || 'rejected'}`);
      }

      this.#sessionId = authResult.session_id || tempSessionId;
      this.#resumeToken = authResult.token || null;
      this.#state = STATE_AUTHENTICATED;
      this.#startPing();

      return this.#sessionId;

    } catch (err) {
      // Clean up on failure.
      this.#state = STATE_CLOSED;
      await this.#transport?.close().catch(() => {});
      this.#transport = null;
      this.#rejectAllWaiters(err);
      throw err;
    }
  }

  // ── Session management ──────────────────────────────────────────────

  /**
   * Open a new PTY or exec session on the remote server.
   *
   * @param {object} opts
   * @param {'pty'|'exec'} opts.type - Channel kind
   * @param {string} [opts.command] - Command to execute (required for exec, optional for pty)
   * @param {number} [opts.cols=80] - Initial terminal columns
   * @param {number} [opts.rows=24] - Initial terminal rows
   * @param {object} [opts.env] - Environment variables
   * @param {number} [opts.timeout] - Timeout in ms
   * @returns {Promise<WshSession>}
   */
  async openSession({ type = 'pty', command, cols = 80, rows = 24, env, timeout = DEFAULT_OPEN_TIMEOUT } = {}) {
    this.#assertAuthenticated('openSession');

    const channelId = this._nextChannelId();

    await this.#transport.sendControl(
      openMsg({ kind: type, command, cols, rows, env })
    );

    // Wait for OPEN_OK or OPEN_FAIL.
    const response = await this.#waitForMessage(
      [MSG.OPEN_OK, MSG.OPEN_FAIL],
      timeout,
      'Timed out waiting for session open response'
    );

    if (response.type === MSG.OPEN_FAIL) {
      throw new Error(`Failed to open session: ${response.reason || 'rejected'}`);
    }

    // The server returns the actual channel ID and stream IDs.
    const serverChannelId = response.channel_id ?? channelId;
    const streamIds = response.stream_ids;

    // Create the session object.
    const session = new WshSession(this.#transport, serverChannelId, streamIds, type);
    this.#sessions.set(serverChannelId, session);

    // Open the data stream and bind it to the session.
    const stream = await this.#transport.openStream();
    session._bind(stream.readable, stream.writable);

    return session;
  }

  /**
   * List locally tracked sessions with their current state.
   * @returns {Array<{channelId: number, kind: string, state: string}>}
   */
  listSessions() {
    const result = [];
    for (const [channelId, session] of this.#sessions) {
      result.push({
        channelId,
        kind: session.kind,
        state: session.state,
      });
    }
    return result;
  }

  /**
   * Attach to an existing remote session (collaborative or read-only).
   *
   * @param {string} targetSessionId - Remote session ID to attach to
   * @param {object} [opts]
   * @param {boolean} [opts.readOnly=false] - Attach in read-only mode
   * @param {number} [opts.timeout] - Timeout in ms
   * @returns {Promise<object>} Server's response
   */
  async attachSession(targetSessionId, { readOnly = false, timeout = DEFAULT_OPEN_TIMEOUT } = {}) {
    this.#assertAuthenticated('attachSession');

    const mode = readOnly ? 'readonly' : 'control';
    await this.#transport.sendControl(
      attachMsg({ sessionId: targetSessionId, token: this.#resumeToken, mode })
    );

    const response = await this.#waitForMessage(
      [MSG.OPEN_OK, MSG.OPEN_FAIL],
      timeout,
      'Timed out waiting for attach response'
    );

    if (response.type === MSG.OPEN_FAIL) {
      throw new Error(`Failed to attach: ${response.reason || 'rejected'}`);
    }

    return response;
  }

  /**
   * Resume a previously disconnected session.
   *
   * @param {string} targetSessionId - Session ID to resume
   * @param {string} token - Resume token from original AUTH_OK
   * @param {number} [opts.timeout] - Timeout in ms
   * @returns {Promise<object>} Server's response
   */
  async resumeSession(targetSessionId, token, { timeout = DEFAULT_OPEN_TIMEOUT } = {}) {
    this.#assertAuthenticated('resumeSession');

    await this.#transport.sendControl(
      resumeMsg({ sessionId: targetSessionId, token })
    );

    const response = await this.#waitForMessage(
      [MSG.AUTH_OK, MSG.AUTH_FAIL],
      timeout,
      'Timed out waiting for resume response'
    );

    if (response.type === MSG.AUTH_FAIL) {
      throw new Error(`Failed to resume: ${response.reason || 'rejected'}`);
    }

    return response;
  }

  // ── Disconnect ──────────────────────────────────────────────────────

  /**
   * Gracefully disconnect: close all sessions and the transport.
   */
  async disconnect() {
    if (this.#state === STATE_DISCONNECTED || this.#state === STATE_CLOSED) return;

    this.#stopPing();
    this.#state = STATE_CLOSED;

    // Close all sessions concurrently.
    const closePromises = [];
    for (const session of this.#sessions.values()) {
      closePromises.push(session.close().catch(() => {}));
    }
    await Promise.allSettled(closePromises);
    this.#sessions.clear();

    // Close the transport.
    if (this.#transport) {
      await this.#transport.close().catch(() => {});
      this.#transport = null;
    }

    this.#rejectAllWaiters(new Error('Client disconnected'));
  }

  // ── Static one-shot exec ────────────────────────────────────────────

  /**
   * One-shot command execution: connect, authenticate, run a command,
   * collect all output, disconnect, and return the result.
   *
   * @param {string} url - Server URL
   * @param {string} command - Command to execute
   * @param {object} opts
   * @param {string} opts.username
   * @param {CryptoKeyPair} [opts.keyPair]
   * @param {string} [opts.password]
   * @param {number} [opts.timeout=60000] - Overall timeout in ms
   * @returns {Promise<{stdout: Uint8Array, exitCode: number}>}
   */
  static async exec(url, command, { username, keyPair, password, timeout = DEFAULT_EXEC_TIMEOUT } = {}) {
    const client = new WshClient();
    const chunks = [];
    let exitCode = -1;

    try {
      await client.connect(url, { username, keyPair, password });

      const session = await client.openSession({ type: 'exec', command });

      await new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          reject(new Error(`exec timed out after ${timeout}ms`));
        }, timeout);

        session.onData = (data) => {
          chunks.push(data);
        };

        session.onExit = (code) => {
          exitCode = code;
        };

        session.onClose = () => {
          clearTimeout(timer);
          resolve();
        };
      });

    } finally {
      await client.disconnect().catch(() => {});
    }

    // Concatenate output chunks.
    const totalLength = chunks.reduce((sum, c) => sum + c.byteLength, 0);
    const stdout = new Uint8Array(totalLength);
    let offset = 0;
    for (const chunk of chunks) {
      stdout.set(chunk, offset);
      offset += chunk.byteLength;
    }

    return { stdout, exitCode };
  }

  // ── Reverse mode ────────────────────────────────────────────────────

  /**
   * Connect in reverse mode: register as a peer that can accept incoming
   * connections from other clients.
   *
   * @param {string} url - Server URL
   * @param {object} opts
   * @param {string} opts.username
   * @param {CryptoKeyPair} [opts.keyPair]
   * @param {string} [opts.password]
   * @param {object} [opts.expose] - Capabilities to expose { shell, fs, tools }
   * @returns {Promise<string>} Session ID
   */
  async connectReverse(url, { username, keyPair, password, expose = {} } = {}) {
    // Authenticate normally first.
    const sessionId = await this.connect(url, { username, keyPair, password });

    // Build capabilities list from expose options.
    const capabilities = [];
    if (expose.shell) capabilities.push('shell');
    if (expose.fs) capabilities.push('fs');
    if (expose.tools) capabilities.push('tools');

    // Export public key for peer identification.
    let publicKey = null;
    if (keyPair) {
      publicKey = await exportPublicKeyRaw(keyPair.publicKey);
    }

    // Register as a reverse peer.
    await this.#transport.sendControl(
      reverseRegisterMsg({ username, capabilities, publicKey })
    );

    return sessionId;
  }

  /**
   * List peers registered on the relay server.
   *
   * @param {number} [timeout=10000] - Timeout in ms
   * @returns {Promise<Array<{fingerprint_short: string, username: string, capabilities: string[], last_seen: number|null}>>}
   */
  async listPeers(timeout = DEFAULT_OPEN_TIMEOUT) {
    this.#assertAuthenticated('listPeers');

    await this.#transport.sendControl(reverseListMsg());

    const response = await this.#waitForMessage(
      [MSG.REVERSE_PEERS],
      timeout,
      'Timed out waiting for peer list'
    );

    return response.peers || [];
  }

  /**
   * Initiate a reverse connection to a registered peer.
   *
   * @param {string} targetFingerprint - Fingerprint (or prefix) of the target peer
   * @param {number} [timeout=10000] - Timeout in ms
   * @returns {Promise<void>}
   */
  async reverseConnectTo(targetFingerprint, timeout = DEFAULT_OPEN_TIMEOUT) {
    this.#assertAuthenticated('reverseConnectTo');

    await this.#transport.sendControl(
      reverseConnectMsg({ targetFingerprint, username: '' })
    );
  }

  // ── File transfer ───────────────────────────────────────────────────

  /**
   * Upload a blob to a remote path.
   *
   * Opens a file channel, writes the data, and waits for acknowledgment.
   *
   * @param {Blob|Uint8Array} blob - Data to upload
   * @param {string} remotePath - Destination path on the server
   * @param {object} [opts]
   * @param {function(number): void} [opts.onProgress] - Progress callback (bytes sent)
   */
  async upload(blob, remotePath, { onProgress } = {}) {
    this.#assertAuthenticated('upload');

    // Open a file channel.
    await this.#transport.sendControl(
      openMsg({ kind: 'file', command: `upload:${remotePath}` })
    );

    const response = await this.#waitForMessage(
      [MSG.OPEN_OK, MSG.OPEN_FAIL],
      DEFAULT_OPEN_TIMEOUT,
      'Timed out waiting for upload channel'
    );

    if (response.type === MSG.OPEN_FAIL) {
      throw new Error(`Upload failed: ${response.reason || 'rejected'}`);
    }

    const channelId = response.channel_id;
    const stream = await this.#transport.openStream();
    const writer = stream.writable.getWriter();

    try {
      // Convert to Uint8Array if it's a Blob.
      const data = blob instanceof Blob
        ? new Uint8Array(await blob.arrayBuffer())
        : blob;

      // Write in 64 KiB chunks for progress tracking.
      const chunkSize = 65536;
      let sent = 0;
      for (let i = 0; i < data.byteLength; i += chunkSize) {
        const end = Math.min(i + chunkSize, data.byteLength);
        await writer.write(data.subarray(i, end));
        sent = end;
        onProgress?.(sent);
      }
    } finally {
      await writer.close().catch(() => {});
    }

    // Wait for the server to confirm the upload.
    await this.#waitForMessage(
      [MSG.CLOSE, MSG.EXIT],
      DEFAULT_OPEN_TIMEOUT,
      'Timed out waiting for upload confirmation'
    );
  }

  /**
   * Download a file from a remote path.
   *
   * @param {string} remotePath - Source path on the server
   * @returns {Promise<Uint8Array>} File contents
   */
  async download(remotePath) {
    this.#assertAuthenticated('download');

    await this.#transport.sendControl(
      openMsg({ kind: 'file', command: `download:${remotePath}` })
    );

    const response = await this.#waitForMessage(
      [MSG.OPEN_OK, MSG.OPEN_FAIL],
      DEFAULT_OPEN_TIMEOUT,
      'Timed out waiting for download channel'
    );

    if (response.type === MSG.OPEN_FAIL) {
      throw new Error(`Download failed: ${response.reason || 'rejected'}`);
    }

    const stream = await this.#transport.openStream();
    const reader = stream.readable.getReader();
    const chunks = [];

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
      }
    } finally {
      reader.releaseLock();
    }

    // Concatenate chunks.
    const totalLength = chunks.reduce((sum, c) => sum + c.byteLength, 0);
    const result = new Uint8Array(totalLength);
    let offset = 0;
    for (const chunk of chunks) {
      result.set(chunk, offset);
      offset += chunk.byteLength;
    }

    return result;
  }

  // ── MCP integration ─────────────────────────────────────────────────

  /**
   * Discover MCP tools available on the remote server.
   *
   * @param {number} [timeout=10000]
   * @returns {Promise<Array>} Tool definitions
   */
  async discoverTools(timeout = DEFAULT_OPEN_TIMEOUT) {
    this.#assertAuthenticated('discoverTools');

    await this.#transport.sendControl(mcpDiscoverMsg());

    const response = await this.#waitForMessage(
      [MSG.MCP_TOOLS],
      timeout,
      'Timed out waiting for MCP tool discovery response'
    );

    return response.tools || [];
  }

  /**
   * Call an MCP tool on the remote server.
   *
   * @param {string} name - Tool name
   * @param {object} args - Tool arguments
   * @param {number} [timeout=30000]
   * @returns {Promise<*>} Tool result
   */
  async callTool(name, args, timeout = 30_000) {
    this.#assertAuthenticated('callTool');

    await this.#transport.sendControl(
      mcpCallMsg({ tool: name, arguments: args })
    );

    const response = await this.#waitForMessage(
      [MSG.MCP_RESULT],
      timeout,
      `Timed out waiting for MCP tool result (${name})`
    );

    return response.result;
  }

  // ── Internal: transport creation ────────────────────────────────────

  /**
   * Create the appropriate transport based on URL scheme and hint.
   *
   * @param {string} url
   * @param {'wt'|'ws'} [hint]
   * @returns {import('./transport.mjs').WshTransport}
   * @private
   */
  #createTransport(url, hint) {
    const isWebSocket = /^wss?:\/\//i.test(url);
    const useWebSocket = hint === 'ws' || (isWebSocket && hint !== 'wt');

    if (useWebSocket) {
      // Lazy import guard: WebSocketTransport may not be bundled.
      // Use dynamic import to avoid hard dependency.
      // However, for synchronous construction we check if it's available.
      // The user is expected to have imported it if they need WS.
      throw new Error(
        'WebSocket transport requires importing WebSocketTransport from ./transport-ws.mjs. ' +
        'Use WshClient.withTransport() or pass a transport instance directly.'
      );
    }

    return new WebTransportTransport();
  }

  /**
   * Create a client with a pre-configured transport instance.
   * Useful for WebSocket transport or custom transports.
   *
   * @param {import('./transport.mjs').WshTransport} transport
   * @returns {WshClient}
   */
  static withTransport(transport) {
    const client = new WshClient();
    client.#transport = transport;
    return client;
  }

  /**
   * Connect using an externally created transport.
   * Use this when you need WebSocket or a custom transport.
   *
   * @param {import('./transport.mjs').WshTransport} transport - An already-constructed transport
   * @param {string} url - Server URL to connect to
   * @param {object} opts - Same options as connect()
   * @returns {Promise<string>} Session ID
   */
  async connectWithTransport(transport, url, opts) {
    this.#transport = transport;
    // Wire transport callbacks.
    transport.onControl = (msg) => this.#handleControl(msg);
    transport.onClose = () => this.#handleTransportClose();
    transport.onError = (err) => this.#handleTransportError(err);

    // Connect the transport.
    this.#state = STATE_CONNECTING;
    await transport.connect(url);
    this.#state = STATE_CONNECTED;

    // Proceed with auth using the same logic.
    // We can't call this.connect() directly because it would create a new
    // transport, so we duplicate the auth portion.
    return this.#performAuth(opts);
  }

  // ── Internal: auth handshake ────────────────────────────────────────

  /**
   * Perform the authentication handshake after transport is connected.
   * Extracted so connectWithTransport can reuse it.
   *
   * @param {object} opts
   * @param {string} opts.username
   * @param {CryptoKeyPair} [opts.keyPair]
   * @param {string} [opts.password]
   * @param {number} [opts.timeout]
   * @returns {Promise<string>} Session ID
   * @private
   */
  async #performAuth({ username, keyPair, password, timeout = DEFAULT_AUTH_TIMEOUT } = {}) {
    if (!username) throw new Error('username is required');
    if (!keyPair && !password) throw new Error('Either keyPair or password is required');

    try {
      const authMethod = keyPair ? AUTH_METHOD.PUBKEY : AUTH_METHOD.PASSWORD;
      await this.#transport.sendControl(hello({ username, authMethod }));

      const firstResponse = await this.#waitForMessage(
        [MSG.SERVER_HELLO, MSG.CHALLENGE, MSG.AUTH_FAIL],
        timeout,
        'Auth handshake timed out'
      );

      if (firstResponse.type === MSG.AUTH_FAIL) {
        throw new Error(`Authentication failed: ${firstResponse.reason || 'unknown'}`);
      }

      let tempSessionId = null;

      if (firstResponse.type === MSG.SERVER_HELLO) {
        tempSessionId = firstResponse.session_id;
        this.#serverFeatures = firstResponse.features || [];

        if (authMethod === AUTH_METHOD.PUBKEY) {
          const challengeMsg = await this.#waitForMessage(
            [MSG.CHALLENGE, MSG.AUTH_OK],
            timeout,
            'Timed out waiting for challenge'
          );

          if (challengeMsg.type === MSG.AUTH_OK) {
            this.#sessionId = challengeMsg.session_id || tempSessionId;
            this.#resumeToken = challengeMsg.token || null;
            this.#state = STATE_AUTHENTICATED;
            this.#startPing();
            return this.#sessionId;
          }

          const { signature, publicKeyRaw } = await signChallenge(
            keyPair.privateKey, keyPair.publicKey, tempSessionId, challengeMsg.nonce
          );

          await this.#transport.sendControl(authMsg({
            method: AUTH_METHOD.PUBKEY, signature, publicKey: publicKeyRaw,
          }));
        } else {
          await this.#transport.sendControl(authMsg({
            method: AUTH_METHOD.PASSWORD, password,
          }));
        }
      } else if (firstResponse.type === MSG.CHALLENGE) {
        if (!keyPair) throw new Error('Server sent CHALLENGE but no key pair provided');

        tempSessionId = tempSessionId || 'pending';
        const { signature, publicKeyRaw } = await signChallenge(
          keyPair.privateKey, keyPair.publicKey, tempSessionId, firstResponse.nonce
        );

        await this.#transport.sendControl(authMsg({
          method: AUTH_METHOD.PUBKEY, signature, publicKey: publicKeyRaw,
        }));
      }

      const authResult = await this.#waitForMessage(
        [MSG.AUTH_OK, MSG.AUTH_FAIL],
        timeout,
        'Timed out waiting for auth result'
      );

      if (authResult.type === MSG.AUTH_FAIL) {
        throw new Error(`Authentication failed: ${authResult.reason || 'rejected'}`);
      }

      this.#sessionId = authResult.session_id || tempSessionId;
      this.#resumeToken = authResult.token || null;
      this.#state = STATE_AUTHENTICATED;
      this.#startPing();

      return this.#sessionId;
    } catch (err) {
      this.#state = STATE_CLOSED;
      await this.#transport?.close().catch(() => {});
      this.#transport = null;
      this.#rejectAllWaiters(err);
      throw err;
    }
  }

  // ── Internal: control message dispatch ──────────────────────────────

  /**
   * Route incoming control messages to the appropriate handler.
   * @param {object} msg
   * @private
   */
  #handleControl(msg) {
    const type = msg.type;

    // First, check if any waiters are listening for this message type.
    if (this.#waiters.has(type)) {
      const queue = this.#waiters.get(type);
      if (queue.length > 0) {
        const waiter = queue.shift();
        if (queue.length === 0) this.#waiters.delete(type);
        clearTimeout(waiter.timer);
        waiter.resolve(msg);
        return;
      }
    }

    // Also check multi-type waiters (stored under a synthetic key).
    for (const [key, queue] of this.#waiters) {
      if (typeof key === 'string' && key.startsWith('multi:')) {
        for (let i = 0; i < queue.length; i++) {
          if (queue[i].types?.includes(type)) {
            const waiter = queue.splice(i, 1)[0];
            if (queue.length === 0) this.#waiters.delete(key);
            clearTimeout(waiter.timer);
            waiter.resolve(msg);
            return;
          }
        }
      }
    }

    // Route gateway messages (0x70–0x7f) to the gateway handler.
    if (type >= 0x70 && type <= 0x7f) {
      try {
        this.onGatewayMessage?.(msg);
      } catch (err) {
        console.error('[wsh:client] onGatewayMessage handler error:', err);
      }
      return;
    }

    // Route relay-forwarded messages from remote CLI peers.
    // In reverse mode, the server's relay bridge forwards Open, McpCall,
    // McpDiscover, etc. from the CLI to this browser client.  These are
    // message types that a normal client would never receive from the
    // server, so we intercept them here before the channel dispatch.
    if (this.onRelayMessage && this._isRelayForwardable(type)) {
      try {
        this.onRelayMessage(msg);
      } catch (err) {
        console.error('[wsh:client] onRelayMessage handler error:', err);
      }
      return;
    }

    // Dispatch channel-specific messages to sessions.
    const channelId = msg.channel_id;
    if (channelId !== undefined && this.#sessions.has(channelId)) {
      const session = this.#sessions.get(channelId);
      session._handleControlMessage(msg);

      // Remove session from tracking if it's closed.
      if (type === MSG.CLOSE) {
        this.#sessions.delete(channelId);
      }
      return;
    }

    // Handle transport-level messages.
    switch (type) {
      case MSG.PING:
        // Respond to server pings immediately.
        this.#transport?.sendControl(pongMsg({ id: msg.id })).catch(() => {});
        break;

      case MSG.PONG:
        this.#lastPong = Date.now();
        break;

      case MSG.ERROR:
        console.error('[wsh:client] Server error:', msg.code, msg.message);
        this.#emitError(new Error(`Server error ${msg.code}: ${msg.message}`));
        break;

      case MSG.SHUTDOWN:
        console.warn('[wsh:client] Server shutdown:', msg.reason);
        this.disconnect().catch(() => {});
        break;

      case MSG.IDLE_WARNING:
        // Respond with a ping to indicate we're still active.
        this.#transport?.sendControl(pingMsg({ id: ++this.#pingId })).catch(() => {});
        break;

      case MSG.REVERSE_CONNECT:
        try {
          this.onReverseConnect?.(msg);
        } catch (err) {
          console.error('[wsh:client] onReverseConnect handler error:', err);
        }
        break;

      case MSG.CLIPBOARD:
        // OSC 52 clipboard sync — write to navigator.clipboard if available.
        if (msg.direction === 'server_to_client' && msg.data) {
          try {
            const text = atob(msg.data);
            navigator.clipboard?.writeText(text).catch(() => {});
          } catch { /* ignore decode errors */ }
        }
        try {
          this.onClipboard?.(msg);
        } catch (err) {
          console.error('[wsh:client] onClipboard handler error:', err);
        }
        break;

      case MSG.PRESENCE:
      case MSG.CONTROL_CHANGED:
      case MSG.METRICS:
        // Informational messages — no default handling needed.
        break;

      default:
        // Unrecognized message — ignore gracefully.
        break;
    }
  }

  // ── Internal: transport events ──────────────────────────────────────

  /**
   * @private
   */
  #handleTransportClose() {
    if (this.#state === STATE_CLOSED) return;

    this.#state = STATE_CLOSED;
    this.#stopPing();
    this.#rejectAllWaiters(new Error('Transport closed'));

    // Close all sessions.
    for (const session of this.#sessions.values()) {
      session._handleControlMessage({ type: MSG.CLOSE });
    }
    this.#sessions.clear();

    try {
      this.onClose?.();
    } catch (err) {
      console.error('[wsh:client] onClose handler error:', err);
    }
  }

  /**
   * @private
   */
  #handleTransportError(err) {
    this.#emitError(err);
  }

  // ── Internal: message waiter system ─────────────────────────────────

  /**
   * Wait for the next control message matching one of the given types.
   *
   * @param {number|number[]} types - Message type(s) to wait for
   * @param {number} timeout - Timeout in ms
   * @param {string} timeoutMessage - Error message on timeout
   * @returns {Promise<object>}
   * @private
   */
  #waitForMessage(types, timeout, timeoutMessage) {
    const typeArr = Array.isArray(types) ? types : [types];

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        // Remove this waiter.
        this.#removeWaiter(key, waiter);
        reject(new Error(timeoutMessage));
      }, timeout);

      const waiter = { resolve, reject, timer, types: typeArr };

      // For multi-type waiting, use a synthetic key.
      const key = typeArr.length === 1
        ? typeArr[0]
        : `multi:${typeArr.join(',')}`;

      if (!this.#waiters.has(key)) {
        this.#waiters.set(key, []);
      }
      this.#waiters.get(key).push(waiter);
    });
  }

  /**
   * Remove a specific waiter from the queue.
   * @param {*} key
   * @param {object} waiter
   * @private
   */
  #removeWaiter(key, waiter) {
    const queue = this.#waiters.get(key);
    if (!queue) return;
    const idx = queue.indexOf(waiter);
    if (idx !== -1) queue.splice(idx, 1);
    if (queue.length === 0) this.#waiters.delete(key);
  }

  /**
   * Reject all pending waiters with the given error.
   * @param {Error} err
   * @private
   */
  #rejectAllWaiters(err) {
    for (const [, queue] of this.#waiters) {
      for (const waiter of queue) {
        clearTimeout(waiter.timer);
        waiter.reject(err);
      }
    }
    this.#waiters.clear();
  }

  // ── Internal: ping/pong keepalive ───────────────────────────────────

  /**
   * Start periodic ping messages.
   * @private
   */
  #startPing() {
    this.#stopPing();
    this.#lastPong = Date.now();

    this.#pingTimer = setInterval(() => {
      if (this.#state !== STATE_AUTHENTICATED) {
        this.#stopPing();
        return;
      }

      this.#transport?.sendControl(
        pingMsg({ id: ++this.#pingId })
      ).catch((err) => {
        console.warn('[wsh:client] Failed to send ping:', err.message);
      });
    }, DEFAULT_PING_INTERVAL);

    // Don't let the ping timer prevent Node.js/Deno from exiting.
    if (typeof this.#pingTimer === 'object' && this.#pingTimer.unref) {
      this.#pingTimer.unref();
    }
  }

  /**
   * Stop the ping interval.
   * @private
   */
  #stopPing() {
    if (this.#pingTimer !== null) {
      clearInterval(this.#pingTimer);
      this.#pingTimer = null;
    }
  }

  // ── Internal: helpers ───────────────────────────────────────────────

  /**
   * Check whether a message type is relay-forwardable — i.e. a message
   * that a client would not normally receive from the server, but that
   * arrives via the relay bridge from a remote CLI peer.
   *
   * @param {number} type - Message opcode
   * @returns {boolean}
   */
  _isRelayForwardable(type) {
    return [
      MSG.OPEN, MSG.MCP_DISCOVER, MSG.MCP_CALL,
      MSG.CLOSE, MSG.RESIZE, MSG.SIGNAL,
    ].includes(type);
  }

  /**
   * Get the next channel ID.
   * @returns {number}
   */
  _nextChannelId() {
    return ++this.#channelCounter;
  }

  /**
   * Assert that the client is authenticated.
   * @param {string} action
   * @private
   */
  #assertAuthenticated(action) {
    if (this.#state !== STATE_AUTHENTICATED) {
      throw new Error(`Cannot ${action}: client is ${this.#state} (expected authenticated)`);
    }
  }

  /**
   * Emit an error through the callback.
   * @param {Error} err
   * @private
   */
  #emitError(err) {
    try {
      this.onError?.(err);
    } catch (e) {
      console.error('[wsh:client] onError handler error:', e);
    }
  }
}
