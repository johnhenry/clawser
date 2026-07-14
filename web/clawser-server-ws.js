/**
 * clawser-server-ws.js — Server WebSocket Emulation (Block 4)
 *
 * WebSocket-compatible interface for the browser-based virtual server.
 * Connections are multiplexed over BroadcastChannel (cross-tab) or
 * MessagePort (iframe / worker), giving handler code the same API
 * surface as a real WebSocket server without leaving the browser.
 *
 * Architecture:
 *   ServerWebSocketServer  — listens on a named channel, accepts connections
 *   ServerWebSocket        — server-side socket handed to the route handler
 *   ClientWebSocket        — client-side socket that connects to the server
 *
 * Wire protocol (JSON over BroadcastChannel / MessagePort):
 *   { type: 'ws:connect',    connId, protocols? }
 *   { type: 'ws:accept',     connId, protocol? }
 *   { type: 'ws:reject',     connId, code, reason }
 *   { type: 'ws:message',    connId, data, binary }
 *   { type: 'ws:close',      connId, code, reason }
 *   { type: 'ws:ping',       connId }
 *   { type: 'ws:pong',       connId }
 *
 * Run tests:
 *   node --import ./web/test/_setup-globals.mjs --test web/test/clawser-server-ws.test.mjs
 *
 * @module clawser-server-ws
 */

// ── Constants ────────────────────────────────────────────────────

export const WS_READY_STATE = Object.freeze({
  CONNECTING: 0,
  OPEN:       1,
  CLOSING:    2,
  CLOSED:     3,
});

const CLOSE_NORMAL        = 1000;
const CLOSE_GOING_AWAY    = 1001;
const CLOSE_NO_STATUS     = 1005;

/** Default heartbeat / ping interval (ms). */
const DEFAULT_PING_INTERVAL = 30_000;

/** Max queued outbound bytes before back-pressure warning. */
const MAX_BUFFERED = 64 * 1024;

// ── Helpers ──────────────────────────────────────────────────────

let _connCounter = 0;

const generateConnId = () =>
  `ws_${Date.now().toString(36)}_${(++_connCounter).toString(36)}`;

const byteLength = (data) => {
  if (typeof data === 'string') return data.length * 2; // rough UTF-16
  if (data instanceof ArrayBuffer) return data.byteLength;
  if (ArrayBuffer.isView(data)) return data.byteLength;
  return 0;
};

const encodeForTransfer = (data) => {
  if (typeof data === 'string') return { data, binary: false };
  if (data instanceof ArrayBuffer) {
    return { data: Array.from(new Uint8Array(data)), binary: true };
  }
  if (ArrayBuffer.isView(data)) {
    return { data: Array.from(new Uint8Array(data.buffer, data.byteOffset, data.byteLength)), binary: true };
  }
  return { data: String(data), binary: false };
};

const decodeFromTransfer = (payload) => {
  if (!payload.binary) return payload.data;
  return new Uint8Array(payload.data).buffer;
};

// ── ServerWebSocket ──────────────────────────────────────────────

/**
 * Server-side WebSocket handle, handed to route handlers on connection.
 * Mirrors the browser WebSocket API (readyState, send, close, event
 * callbacks) but runs entirely in-process over a message channel.
 */
export class ServerWebSocket {
  #connId;
  #protocol;
  #readyState = WS_READY_STATE.OPEN;
  #bufferedAmount = 0;
  #extensions = '';

  /** @type {Function|null} */ onopen    = null;
  /** @type {Function|null} */ onmessage = null;
  /** @type {Function|null} */ onclose   = null;
  /** @type {Function|null} */ onerror   = null;

  #callbacks = { open: [], message: [], close: [], error: [], ping: [], pong: [] };
  #postMessage; // (msg) => void — injected by the server

  /**
   * @param {string} connId
   * @param {Function} postMessage — send a wire message to the client
   * @param {string} [protocol]
   */
  constructor(connId, postMessage, protocol = '') {
    this.#connId = connId;
    this.#postMessage = postMessage;
    this.#protocol = protocol;
  }

  // -- WebSocket-compat getters -------------------------------------------

  get readyState()      { return this.#readyState; }
  get bufferedAmount()  { return this.#bufferedAmount; }
  get protocol()        { return this.#protocol; }
  get extensions()      { return this.#extensions; }
  get connId()          { return this.#connId; }

  // -- Public API ---------------------------------------------------------

  /**
   * Send data to the client.
   * @param {string|ArrayBuffer|ArrayBufferView} data
   */
  send(data) {
    if (this.#readyState !== WS_READY_STATE.OPEN) {
      throw new Error('WebSocket is not open');
    }
    const encoded = encodeForTransfer(data);
    this.#bufferedAmount += byteLength(data);
    this.#postMessage({
      type: 'ws:message',
      connId: this.#connId,
      ...encoded,
    });
    this.#bufferedAmount -= byteLength(data);
  }

  /**
   * Close the connection.
   * @param {number} [code=1000]
   * @param {string} [reason='']
   */
  close(code = CLOSE_NORMAL, reason = '') {
    if (this.#readyState === WS_READY_STATE.CLOSED ||
        this.#readyState === WS_READY_STATE.CLOSING) return;
    this.#readyState = WS_READY_STATE.CLOSING;
    this.#postMessage({
      type: 'ws:close',
      connId: this.#connId,
      code,
      reason,
    });
    this.#readyState = WS_READY_STATE.CLOSED;
    this._fireEvent('close', { code, reason, wasClean: true });
  }

  /** Send a ping frame. */
  ping() {
    if (this.#readyState !== WS_READY_STATE.OPEN) return;
    this.#postMessage({ type: 'ws:ping', connId: this.#connId });
  }

  /**
   * Register an event listener.
   * @param {'open'|'message'|'close'|'error'|'ping'|'pong'} event
   * @param {Function} cb
   */
  addEventListener(event, cb) {
    if (this.#callbacks[event]) this.#callbacks[event].push(cb);
  }

  /**
   * Remove an event listener.
   * @param {string} event
   * @param {Function} cb
   */
  removeEventListener(event, cb) {
    if (this.#callbacks[event]) {
      this.#callbacks[event] = this.#callbacks[event].filter(f => f !== cb);
    }
  }

  // -- Internal (called by ServerWebSocketServer) -------------------------

  /** @internal Handle an inbound message from the client. */
  _receiveMessage(payload) {
    if (this.#readyState !== WS_READY_STATE.OPEN) return;
    const data = decodeFromTransfer(payload);
    this._fireEvent('message', { data });
  }

  /** @internal Handle client-initiated close. */
  _receiveClose(code = CLOSE_NORMAL, reason = '') {
    if (this.#readyState === WS_READY_STATE.CLOSED) return;
    this.#readyState = WS_READY_STATE.CLOSED;
    this._fireEvent('close', { code, reason, wasClean: true });
  }

  /** @internal Handle a pong from the client. */
  _receivePong() {
    this._fireEvent('pong', {});
  }

  /** @internal Handle a ping from the client. */
  _receivePing() {
    this._fireEvent('ping', {});
    // Auto-reply with pong
    if (this.#readyState === WS_READY_STATE.OPEN) {
      this.#postMessage({ type: 'ws:pong', connId: this.#connId });
    }
  }

  /** @internal Terminate abruptly (server shutting down). */
  _terminate(code = CLOSE_GOING_AWAY, reason = 'server shutdown') {
    if (this.#readyState === WS_READY_STATE.CLOSED) return;
    this.#postMessage({ type: 'ws:close', connId: this.#connId, code, reason });
    this.#readyState = WS_READY_STATE.CLOSED;
    this._fireEvent('close', { code, reason, wasClean: false });
  }

  /** @internal */
  _fireEvent(name, detail = {}) {
    const evt = { type: name, target: this, ...detail };
    if (name === 'message' && typeof this.onmessage === 'function') this.onmessage(evt);
    if (name === 'close'   && typeof this.onclose   === 'function') this.onclose(evt);
    if (name === 'error'   && typeof this.onerror   === 'function') this.onerror(evt);
    if (name === 'open'    && typeof this.onopen    === 'function') this.onopen(evt);
    for (const cb of (this.#callbacks[name] || [])) cb(evt);
  }
}

// ── ClientWebSocket ──────────────────────────────────────────────

/**
 * Client-side WebSocket that connects to a ServerWebSocketServer.
 * Drop-in replacement for `new WebSocket(url)` in browser contexts
 * where the server lives in the same origin (another tab, iframe, or
 * worker).
 */
export class ClientWebSocket {
  #connId;
  #readyState = WS_READY_STATE.CONNECTING;
  #protocol = '';
  #protocols;
  #bufferedAmount = 0;
  #extensions = '';
  #url;

  /** @type {Function|null} */ onopen    = null;
  /** @type {Function|null} */ onmessage = null;
  /** @type {Function|null} */ onclose   = null;
  /** @type {Function|null} */ onerror   = null;

  #callbacks = { open: [], message: [], close: [], error: [], ping: [], pong: [] };
  #postMessage; // injected transport send
  #messageHandler; // stored for cleanup

  /**
   * @param {object} opts
   * @param {string} opts.url - Logical WebSocket URL (for compat)
   * @param {string|string[]} [opts.protocols]
   * @param {Function} opts.postMessage - (msg) => void
   * @param {Function} opts.onWire - (handler) => cleanup — subscribe to inbound wire messages
   */
  constructor(opts = {}) {
    this.#url = opts.url || '';
    this.#protocols = typeof opts.protocols === 'string'
      ? [opts.protocols]
      : (opts.protocols || []);
    this.#postMessage = opts.postMessage;
    this.#connId = generateConnId();

    // Subscribe to wire messages
    this.#messageHandler = (msg) => this.#handleWire(msg);
    if (typeof opts.onWire === 'function') {
      this._cleanup = opts.onWire(this.#messageHandler);
    }

    // Initiate handshake
    this.#postMessage({
      type: 'ws:connect',
      connId: this.#connId,
      protocols: this.#protocols,
    });
  }

  // -- WebSocket-compat getters -------------------------------------------

  get readyState()      { return this.#readyState; }
  get bufferedAmount()  { return this.#bufferedAmount; }
  get protocol()        { return this.#protocol; }
  get extensions()      { return this.#extensions; }
  get url()             { return this.#url; }
  get connId()          { return this.#connId; }

  // Statics matching WebSocket API
  static get CONNECTING() { return 0; }
  static get OPEN()       { return 1; }
  static get CLOSING()    { return 2; }
  static get CLOSED()     { return 3; }

  // -- Public API ---------------------------------------------------------

  /**
   * Send data to the server.
   * @param {string|ArrayBuffer|ArrayBufferView} data
   */
  send(data) {
    if (this.#readyState !== WS_READY_STATE.OPEN) {
      throw new Error('WebSocket is not open');
    }
    const encoded = encodeForTransfer(data);
    this.#bufferedAmount += byteLength(data);
    this.#postMessage({
      type: 'ws:message',
      connId: this.#connId,
      ...encoded,
    });
    this.#bufferedAmount -= byteLength(data);
  }

  /**
   * Close the connection.
   * @param {number} [code=1000]
   * @param {string} [reason='']
   */
  close(code = CLOSE_NORMAL, reason = '') {
    if (this.#readyState === WS_READY_STATE.CLOSED ||
        this.#readyState === WS_READY_STATE.CLOSING) return;
    this.#readyState = WS_READY_STATE.CLOSING;
    this.#postMessage({
      type: 'ws:close',
      connId: this.#connId,
      code,
      reason,
    });
    this.#readyState = WS_READY_STATE.CLOSED;
    this._fireEvent('close', { code, reason, wasClean: true });
    if (this._cleanup) this._cleanup();
  }

  addEventListener(event, cb) {
    if (this.#callbacks[event]) this.#callbacks[event].push(cb);
  }

  removeEventListener(event, cb) {
    if (this.#callbacks[event]) {
      this.#callbacks[event] = this.#callbacks[event].filter(f => f !== cb);
    }
  }

  // -- Wire protocol handling ---------------------------------------------

  #handleWire(msg) {
    if (!msg || msg.connId !== this.#connId) return;

    switch (msg.type) {
      case 'ws:accept':
        this.#readyState = WS_READY_STATE.OPEN;
        this.#protocol = msg.protocol || '';
        this._fireEvent('open', {});
        break;

      case 'ws:reject':
        this.#readyState = WS_READY_STATE.CLOSED;
        this._fireEvent('error', { code: msg.code, reason: msg.reason });
        this._fireEvent('close', { code: msg.code, reason: msg.reason, wasClean: false });
        if (this._cleanup) this._cleanup();
        break;

      case 'ws:message': {
        if (this.#readyState !== WS_READY_STATE.OPEN) return;
        const data = decodeFromTransfer(msg);
        this._fireEvent('message', { data });
        break;
      }

      case 'ws:close':
        if (this.#readyState === WS_READY_STATE.CLOSED) return;
        this.#readyState = WS_READY_STATE.CLOSED;
        this._fireEvent('close', {
          code: msg.code || CLOSE_NO_STATUS,
          reason: msg.reason || '',
          wasClean: true,
        });
        if (this._cleanup) this._cleanup();
        break;

      case 'ws:ping':
        this.#postMessage({ type: 'ws:pong', connId: this.#connId });
        this._fireEvent('ping', {});
        break;

      case 'ws:pong':
        this._fireEvent('pong', {});
        break;
    }
  }

  /** @internal */
  _fireEvent(name, detail = {}) {
    const evt = { type: name, target: this, ...detail };
    if (name === 'message' && typeof this.onmessage === 'function') this.onmessage(evt);
    if (name === 'close'   && typeof this.onclose   === 'function') this.onclose(evt);
    if (name === 'error'   && typeof this.onerror   === 'function') this.onerror(evt);
    if (name === 'open'    && typeof this.onopen    === 'function') this.onopen(evt);
    for (const cb of (this.#callbacks[name] || [])) cb(evt);
  }
}

// ── ServerWebSocketServer ────────────────────────────────────────

/**
 * WebSocket server that accepts connections over BroadcastChannel
 * or MessagePort. Each incoming `ws:connect` message creates a new
 * ServerWebSocket and fires the `connection` event.
 *
 * @example
 *   const wss = new ServerWebSocketServer({ channelName: 'my-server' });
 *   wss.on('connection', (socket, req) => {
 *     socket.onmessage = (e) => socket.send(`echo: ${e.data}`);
 *   });
 *   wss.listen();
 *
 *   // Client (different tab):
 *   const ws = ServerWebSocketServer.createClient({
 *     channelName: 'my-server',
 *     url: 'ws://my-server/',
 *   });
 *   ws.onopen = () => ws.send('hello');
 *   ws.onmessage = (e) => console.log(e.data); // "echo: hello"
 */
export class ServerWebSocketServer {
  #channelName;
  #connections = new Map(); // connId → ServerWebSocket
  #callbacks = { connection: [], close: [], error: [] };
  #listening = false;
  #channel = null; // BroadcastChannel or mock
  #ports = new Set(); // MessagePorts
  #messageHandler = null;
  #pingInterval = null;
  #pingIntervalMs;
  #protocols; // supported sub-protocols

  // Injectable constructors for testing
  #BroadcastChannelCtor;

  /**
   * @param {object} opts
   * @param {string} opts.channelName - BroadcastChannel name
   * @param {string[]} [opts.protocols] - Supported sub-protocols
   * @param {number} [opts.pingIntervalMs=30000] - Ping interval (0 to disable)
   * @param {Function} [opts._BroadcastChannel] - Injectable constructor
   */
  constructor(opts = {}) {
    if (!opts.channelName) throw new Error('channelName is required');
    this.#channelName = opts.channelName;
    this.#protocols = opts.protocols || [];
    this.#pingIntervalMs = opts.pingIntervalMs ?? DEFAULT_PING_INTERVAL;
    this.#BroadcastChannelCtor = opts._BroadcastChannel || globalThis.BroadcastChannel;
  }

  // -- Getters ------------------------------------------------------------

  /** Channel name this server listens on. */
  get channelName() { return this.#channelName; }

  /** Whether the server is currently listening. */
  get listening() { return this.#listening; }

  /** Number of active connections. */
  get connectionCount() { return this.#connections.size; }

  /** Iterate active connections. */
  get connections() { return this.#connections.values(); }

  /** Supported sub-protocols. */
  get protocols() { return [...this.#protocols]; }

  // -- Public API ---------------------------------------------------------

  /**
   * Start listening for connections on the BroadcastChannel.
   */
  listen() {
    if (this.#listening) return;

    this.#channel = new this.#BroadcastChannelCtor(this.#channelName);
    this.#messageHandler = (event) => {
      const msg = event.data ?? event; // BroadcastChannel wraps in event.data
      this.#handleWire(msg, (reply) => this.#channel.postMessage(reply));
    };
    this.#channel.addEventListener
      ? this.#channel.addEventListener('message', this.#messageHandler)
      : (this.#channel.onmessage = this.#messageHandler);

    this.#listening = true;

    // Start ping interval
    if (this.#pingIntervalMs > 0) {
      this.#pingInterval = setInterval(() => this.#pingAll(), this.#pingIntervalMs);
    }
  }

  /**
   * Attach a MessagePort as an additional transport (for iframes / workers).
   * @param {MessagePort} port
   */
  addPort(port) {
    this.#ports.add(port);
    const handler = (event) => {
      const msg = event.data ?? event;
      this.#handleWire(msg, (reply) => port.postMessage(reply));
    };
    port.addEventListener('message', handler);
    port.start?.();
    // Return cleanup
    return () => {
      port.removeEventListener('message', handler);
      this.#ports.delete(port);
    };
  }

  /**
   * Register an event listener.
   * @param {'connection'|'close'|'error'} event
   * @param {Function} cb
   */
  on(event, cb) {
    if (this.#callbacks[event]) this.#callbacks[event].push(cb);
  }

  /**
   * Remove an event listener.
   * @param {string} event
   * @param {Function} cb
   */
  off(event, cb) {
    if (this.#callbacks[event]) {
      this.#callbacks[event] = this.#callbacks[event].filter(f => f !== cb);
    }
  }

  /**
   * Get a connection by ID.
   * @param {string} connId
   * @returns {ServerWebSocket|undefined}
   */
  getConnection(connId) {
    return this.#connections.get(connId);
  }

  /**
   * Broadcast data to all connected clients.
   * @param {string|ArrayBuffer|ArrayBufferView} data
   * @param {object} [opts]
   * @param {Set<string>} [opts.exclude] - Connection IDs to skip
   */
  broadcast(data, opts = {}) {
    const exclude = opts.exclude || new Set();
    for (const [id, socket] of this.#connections) {
      if (exclude.has(id)) continue;
      if (socket.readyState === WS_READY_STATE.OPEN) {
        socket.send(data);
      }
    }
  }

  /**
   * Close all connections and stop listening.
   * @param {number} [code=1001]
   * @param {string} [reason='server shutdown']
   */
  close(code = CLOSE_GOING_AWAY, reason = 'server shutdown') {
    // Terminate all connections
    for (const [, socket] of this.#connections) {
      socket._terminate(code, reason);
    }
    this.#connections.clear();

    // Stop ping
    if (this.#pingInterval) {
      clearInterval(this.#pingInterval);
      this.#pingInterval = null;
    }

    // Close channel
    if (this.#channel) {
      if (this.#channel.close) this.#channel.close();
      this.#channel = null;
    }

    this.#listening = false;
    this._fire('close', {});
  }

  // -- Static factory for clients -----------------------------------------

  /**
   * Create a ClientWebSocket that connects to a ServerWebSocketServer
   * over BroadcastChannel.
   *
   * @param {object} opts
   * @param {string} opts.channelName - Must match server's channelName
   * @param {string} [opts.url] - Logical URL (for WebSocket compat)
   * @param {string|string[]} [opts.protocols]
   * @param {Function} [opts._BroadcastChannel]
   * @returns {ClientWebSocket}
   */
  static createClient(opts = {}) {
    if (!opts.channelName) throw new Error('channelName is required');
    const Ctor = opts._BroadcastChannel || globalThis.BroadcastChannel;
    const bc = new Ctor(opts.channelName);

    const client = new ClientWebSocket({
      url: opts.url || `ws-bc://${opts.channelName}/`,
      protocols: opts.protocols,
      postMessage: (msg) => bc.postMessage(msg),
      onWire: (handler) => {
        const listener = (event) => handler(event.data ?? event);
        bc.addEventListener
          ? bc.addEventListener('message', listener)
          : (bc.onmessage = listener);
        return () => {
          if (bc.removeEventListener) bc.removeEventListener('message', listener);
          if (bc.close) bc.close();
        };
      },
    });

    return client;
  }

  /**
   * Create a ClientWebSocket that connects over a MessagePort pair.
   * Returns { client, port } — pass `port` to the server via addPort().
   *
   * @param {object} [opts]
   * @param {string} [opts.url]
   * @param {string|string[]} [opts.protocols]
   * @returns {{ client: ClientWebSocket, port: MessagePort }}
   */
  static createPortClient(opts = {}) {
    const { port1, port2 } = new MessageChannel();

    const client = new ClientWebSocket({
      url: opts.url || 'ws-port://localhost/',
      protocols: opts.protocols,
      postMessage: (msg) => port1.postMessage(msg),
      onWire: (handler) => {
        const listener = (event) => handler(event.data ?? event);
        port1.addEventListener('message', listener);
        port1.start();
        return () => {
          port1.removeEventListener('message', listener);
          port1.close();
        };
      },
    });

    return { client, port: port2 };
  }

  // -- Wire protocol handling (internal) ----------------------------------

  #handleWire(msg, reply) {
    if (!msg || typeof msg.type !== 'string') return;

    switch (msg.type) {
      case 'ws:connect':
        this.#handleConnect(msg, reply);
        break;

      case 'ws:message': {
        const socket = this.#connections.get(msg.connId);
        if (socket) socket._receiveMessage(msg);
        break;
      }

      case 'ws:close': {
        const socket = this.#connections.get(msg.connId);
        if (socket) {
          socket._receiveClose(msg.code, msg.reason);
          this.#connections.delete(msg.connId);
        }
        break;
      }

      case 'ws:ping': {
        const socket = this.#connections.get(msg.connId);
        if (socket) socket._receivePing();
        break;
      }

      case 'ws:pong': {
        const socket = this.#connections.get(msg.connId);
        if (socket) socket._receivePong();
        break;
      }
    }
  }

  #handleConnect(msg, reply) {
    const connId = msg.connId;
    const requestedProtocols = msg.protocols || [];

    // Negotiate sub-protocol
    let selectedProtocol = '';
    if (this.#protocols.length > 0 && requestedProtocols.length > 0) {
      selectedProtocol = requestedProtocols.find(p => this.#protocols.includes(p)) || '';
    }

    // Create the server-side socket
    const socket = new ServerWebSocket(connId, reply, selectedProtocol);
    this.#connections.set(connId, socket);

    // Accept the connection
    reply({
      type: 'ws:accept',
      connId,
      protocol: selectedProtocol,
    });

    // Fire connection event
    this._fire('connection', socket, {
      connId,
      protocols: requestedProtocols,
    });

    // Wire up removal on close
    socket.addEventListener('close', () => {
      this.#connections.delete(connId);
    });
  }

  #pingAll() {
    for (const [, socket] of this.#connections) {
      socket.ping();
    }
  }

  /** @internal */
  _fire(event, ...args) {
    for (const cb of (this.#callbacks[event] || [])) cb(...args);
  }
}
