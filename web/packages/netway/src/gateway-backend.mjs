/**
 * GatewayBackend — proxies network operations through a wsh (WebSocket Shell)
 * server to perform real TCP/UDP/DNS from the browser.
 *
 * When the wsh client is authenticated, operations are sent immediately as
 * control messages over the WebSocket. When the client is disconnected or not
 * yet authenticated, operations are queued in an {@link OperationQueue} and
 * drained automatically once connectivity is restored (call {@link GatewayBackend#drain}).
 *
 * The backend communicates with the server using a binary control protocol where
 * message types are identified by numeric codes (0x70-0x7d). Responses are
 * dispatched to pending promises via gateway/listener IDs.
 *
 * @module gateway-backend
 */

import { Backend } from './backend.mjs';
import { StreamSocket } from './stream-socket.mjs';
import { DatagramSocket } from './datagram-socket.mjs';
import { Listener } from './listener.mjs';
import { OperationQueue } from './queue.mjs';
import { ConnectionRefusedError, NetwayError } from './errors.mjs';
import { GATEWAY_ERROR } from './constants.mjs';

/**
 * A backend that proxies all networking through a remote wsh gateway server.
 *
 * @extends Backend
 */
export class GatewayBackend extends Backend {
  #wshClient;
  #queue;
  #pendingConnections = new Map();  // gateway_id -> { resolve, reject }
  #pendingListens = new Map();      // listener_id -> { resolve, reject, listener }
  #pendingDns = new Map();          // gateway_id -> { resolve, reject }
  #activeListeners = new Map();     // listener_id -> Listener
  #activeSockets = new Map();       // gateway_id -> StreamSocket (outbound channel)
  #closed = false;
  #gatewayIdCounter = 0;
  #listenerIdCounter = 0;

  /**
   * Create a GatewayBackend.
   *
   * @param {Object} [opts={}]
   * @param {Object} opts.wshClient - A wsh client instance. Must expose
   *   `state` (string), `sendControl(msg)` (async), and an assignable
   *   `onGatewayMessage` callback property.
   * @param {Object} [opts.queueConfig] - Configuration passed to the internal
   *   {@link OperationQueue} (accepts `maxSize` and `drainTimeoutMs`).
   */
  constructor({ wshClient, queueConfig } = {}) {
    super();
    this.#wshClient = wshClient;
    this.#queue = new OperationQueue(queueConfig);
    if (wshClient) {
      wshClient.onGatewayMessage = (msg) => this.#handleGatewayMessage(msg);
    }
  }

  /**
   * Whether the backend is currently able to send operations to the gateway.
   * Returns `true` when not closed and the wsh client is in the `'authenticated'` state.
   */
  get connected() {
    return !this.#closed && this.#wshClient?.state === 'authenticated';
  }

  /** @private */
  #nextGatewayId() { return ++this.#gatewayIdCounter; }
  /** @private */
  #nextListenerId() { return ++this.#listenerIdCounter; }

  /**
   * Open a stream connection through the gateway. If the gateway is not
   * connected, the operation is queued and the returned promise settles when
   * the queue is drained.
   *
   * @param {string} host - The remote hostname or IP.
   * @param {number} port - The remote port number.
   * @returns {Promise<import('./stream-socket.mjs').StreamSocket>} The client-side socket.
   * @throws {ConnectionRefusedError} If the remote end refuses the connection.
   * @throws {QueueFullError} If offline and the operation queue is full.
   */
  async connect(host, port) {
    if (!this.connected) {
      return this.#queue.enqueue({ type: 'connect', host, port });
    }
    return this.#doConnect(host, port);
  }

  /**
   * Send an OPEN_TCP (0x70) control message and wait for GATEWAY_OK/FAIL.
   * @private
   */
  async #doConnect(host, port) {
    const gatewayId = this.#nextGatewayId();
    const msg = { type: 0x70, gateway_id: gatewayId, host, port }; // OPEN_TCP
    await this.#wshClient.sendControl(msg);

    return new Promise((resolve, reject) => {
      this.#pendingConnections.set(gatewayId, { resolve, reject });
    });
  }

  /**
   * Request the gateway to listen for incoming connections on a port. If
   * offline, the operation is queued.
   *
   * @param {number} port - The port to listen on. Pass `0` for server-assigned.
   * @returns {Promise<import('./listener.mjs').Listener>} A listener bound to
   *   the actual (possibly server-assigned) port.
   * @throws {NetwayError} If the server rejects the listen request.
   * @throws {QueueFullError} If offline and the operation queue is full.
   */
  async listen(port) {
    if (!this.connected) {
      return this.#queue.enqueue({ type: 'listen', port });
    }
    return this.#doListen(port);
  }

  /**
   * Send a LISTEN_REQUEST (0x7a) and wait for LISTEN_OK/FAIL.
   * @private
   */
  async #doListen(port) {
    const listenerId = this.#nextListenerId();
    const listener = new Listener({ localPort: port });
    const msg = { type: 0x7a, listener_id: listenerId, port, bind_addr: '0.0.0.0' }; // LISTEN_REQUEST
    await this.#wshClient.sendControl(msg);

    return new Promise((resolve, reject) => {
      this.#pendingListens.set(listenerId, { resolve, reject, listener });
    });
  }

  /**
   * Send a datagram through the gateway. If offline, the operation is queued.
   *
   * Note: The current implementation sends an OPEN_UDP (0x71) message but does
   * not yet relay the actual datagram payload (simplified).
   *
   * @param {string} host - The target hostname or IP.
   * @param {number} port - The target port number.
   * @param {Uint8Array} data - The datagram payload.
   * @returns {Promise<void>}
   * @throws {QueueFullError} If offline and the operation queue is full.
   */
  async sendDatagram(host, port, data) {
    if (!this.connected) {
      return this.#queue.enqueue({ type: 'sendDatagram', host, port, data });
    }
    const gatewayId = this.#nextGatewayId();
    const msg = { type: 0x71, gateway_id: gatewayId, host, port }; // OPEN_UDP
    await this.#wshClient.sendControl(msg);
    // For UDP, data is sent as a follow-up once channel is open
    // Simplified: just send the open for now
  }

  /**
   * Resolve a hostname through the gateway's DNS. If offline, the operation
   * is queued.
   *
   * @param {string} name - The hostname to resolve.
   * @param {string} [type='A'] - DNS record type (e.g. `'A'`, `'AAAA'`).
   * @returns {Promise<string[]>} An array of resolved address strings.
   * @throws {ConnectionRefusedError} If the gateway reports a DNS failure.
   * @throws {QueueFullError} If offline and the operation queue is full.
   */
  async resolve(name, type = 'A') {
    if (!this.connected) {
      return this.#queue.enqueue({ type: 'resolve', name, recordType: type });
    }
    return this.#doResolve(name, type);
  }

  /**
   * Send a RESOLVE_DNS (0x72) message and wait for DNS_RESULT/GATEWAY_FAIL.
   * @private
   */
  async #doResolve(name, type) {
    const gatewayId = this.#nextGatewayId();
    const msg = { type: 0x72, gateway_id: gatewayId, name, record_type: type }; // RESOLVE_DNS
    await this.#wshClient.sendControl(msg);

    return new Promise((resolve, reject) => {
      this.#pendingDns.set(gatewayId, { resolve, reject });
    });
  }

  /**
   * Handle an inbound gateway control message from the wsh server.
   *
   * Dispatches by message type code:
   * - **0x73 GATEWAY_OK** — Resolves a pending connection with a new StreamSocket pair.
   * - **0x74 GATEWAY_FAIL** — Rejects a pending connection or DNS request.
   * - **0x75 GATEWAY_CLOSE** — Closes an active relayed socket.
   * - **0x76 INBOUND_OPEN** — Auto-accepts an incoming connection on an active listener.
   * - **0x79 DNS_RESULT** — Resolves a pending DNS request with addresses.
   * - **0x7b LISTEN_OK** — Resolves a pending listen with the bound listener.
   * - **0x7c LISTEN_FAIL** — Rejects a pending listen request.
   * - **0x7d LISTEN_CLOSE** — Closes a server-side listener.
   *
   * @param {Object} msg - The decoded gateway control message.
   * @private
   */
  #handleGatewayMessage(msg) {
    const type = msg.type;

    switch (type) {
      case 0x73: { // GATEWAY_OK
        const pending = this.#pendingConnections.get(msg.gateway_id);
        if (pending) {
          this.#pendingConnections.delete(msg.gateway_id);
          // Create a StreamSocket pair — one side for the user, one for wsh data relay
          const [userSocket, relaySocket] = StreamSocket.createPair();
          this.#activeSockets.set(msg.gateway_id, relaySocket);
          pending.resolve(userSocket);
        }
        break;
      }

      case 0x74: { // GATEWAY_FAIL
        const pending = this.#pendingConnections.get(msg.gateway_id)
          || this.#pendingDns.get(msg.gateway_id);
        if (pending) {
          this.#pendingConnections.delete(msg.gateway_id);
          this.#pendingDns.delete(msg.gateway_id);
          pending.reject(new ConnectionRefusedError(`${msg.message} (code: ${msg.code})`));
        }
        break;
      }

      case 0x75: { // GATEWAY_CLOSE
        const socket = this.#activeSockets.get(msg.gateway_id);
        if (socket) {
          socket.close();
          this.#activeSockets.delete(msg.gateway_id);
        }
        break;
      }

      case 0x76: { // INBOUND_OPEN
        const listener = this.#activeListeners.get(msg.listener_id);
        if (listener && !listener.closed) {
          // Auto-accept: create socket pair, enqueue server socket, send accept
          const [userSocket, relaySocket] = StreamSocket.createPair();
          this.#activeSockets.set(msg.channel_id, relaySocket);
          listener._enqueue(userSocket);
          // Send InboundAccept
          this.#wshClient.sendControl({ type: 0x77, channel_id: msg.channel_id }).catch(() => {});
        } else {
          // Reject if no listener
          this.#wshClient.sendControl({ type: 0x78, channel_id: msg.channel_id, reason: 'no listener' }).catch(() => {});
        }
        break;
      }

      case 0x79: { // DNS_RESULT
        const pending = this.#pendingDns.get(msg.gateway_id);
        if (pending) {
          this.#pendingDns.delete(msg.gateway_id);
          pending.resolve(msg.addresses);
        }
        break;
      }

      case 0x7b: { // LISTEN_OK
        const pending = this.#pendingListens.get(msg.listener_id);
        if (pending) {
          this.#pendingListens.delete(msg.listener_id);
          // Update listener with actual bound port from server
          if (msg.actual_port != null) {
            pending.listener._setLocalPort(msg.actual_port);
          }
          this.#activeListeners.set(msg.listener_id, pending.listener);
          pending.resolve(pending.listener);
        }
        break;
      }

      case 0x7c: { // LISTEN_FAIL
        const pending = this.#pendingListens.get(msg.listener_id);
        if (pending) {
          this.#pendingListens.delete(msg.listener_id);
          pending.reject(new NetwayError(msg.reason, 'ELISTENFAIL'));
        }
        break;
      }

      case 0x7d: { // LISTEN_CLOSE
        const listener = this.#activeListeners.get(msg.listener_id);
        if (listener) {
          listener.close();
          this.#activeListeners.delete(msg.listener_id);
        }
        break;
      }
    }
  }

  /**
   * Drain all queued operations by executing them against the (now-connected)
   * gateway. Call this after the wsh client reconnects and re-authenticates.
   * Operations are replayed in FIFO order.
   *
   * @returns {Promise<void>} Resolves when all queued operations have been processed.
   */
  async drain() {
    await this.#queue.drain(async (op) => {
      switch (op.type) {
        case 'connect': return this.#doConnect(op.host, op.port);
        case 'listen': return this.#doListen(op.port);
        case 'resolve': return this.#doResolve(op.name, op.recordType);
        case 'sendDatagram': return this.sendDatagram(op.host, op.port, op.data);
        default: throw new Error(`Unknown queued op: ${op.type}`);
      }
    });
  }

  /**
   * Close the backend. Clears the operation queue (rejecting pending promises),
   * closes all active sockets and listeners, and rejects all outstanding
   * connection/listen/DNS requests with an `ECLOSED` error.
   *
   * @returns {Promise<void>}
   */
  async close() {
    this.#closed = true;
    this.#queue.clear();
    for (const socket of this.#activeSockets.values()) await socket.close();
    for (const listener of this.#activeListeners.values()) listener.close();
    this.#activeSockets.clear();
    this.#activeListeners.clear();
    // Reject all pending
    for (const p of this.#pendingConnections.values()) p.reject(new NetwayError('Backend closed', 'ECLOSED'));
    for (const p of this.#pendingListens.values()) p.reject(new NetwayError('Backend closed', 'ECLOSED'));
    for (const p of this.#pendingDns.values()) p.reject(new NetwayError('Backend closed', 'ECLOSED'));
    this.#pendingConnections.clear();
    this.#pendingListens.clear();
    this.#pendingDns.clear();
  }
}
