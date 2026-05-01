/**
 * clawser-mesh-relay.js -- Relay Client for Peer Discovery & Signal Forwarding.
 *
 * Connects to a signaling/relay server for peer discovery and signal
 * forwarding when direct connections aren't possible. Provides a
 * MockRelayServer for testing without real WebSocket infrastructure.
 *
 * Run tests:
 *   node --import ./web/test/_setup-globals.mjs --test web/test/clawser-mesh-relay.test.mjs
 */

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** @type {readonly string[]} */
const RELAY_STATES = Object.freeze([
  'disconnected',
  'connecting',
  'connected',
]);

// ---------------------------------------------------------------------------
// MockRelayServer
// ---------------------------------------------------------------------------

/**
 * In-memory relay server for testing.
 * Tracks connected clients and forwards signals between them.
 */
export class MockRelayServer {
  /** @type {Map<string, MeshRelayClient>} fingerprint -> client */
  #clients = new Map();

  /**
   * Register a client with the relay.
   *
   * @param {MeshRelayClient} client
   */
  registerClient(client) {
    this.#clients.set(client.fingerprint, client);
  }

  /**
   * Remove a client by fingerprint.
   *
   * @param {string} fingerprint
   * @returns {boolean} true if the client existed
   */
  removeClient(fingerprint) {
    return this.#clients.delete(fingerprint);
  }

  /**
   * Get all currently connected peers as descriptors.
   *
   * @returns {Array<{ fingerprint: string, capabilities: string[], endpoint: string|null }>}
   */
  getConnectedPeers() {
    return [...this.#clients.values()].map(c => ({
      fingerprint: c.fingerprint,
      capabilities: [...c._announcedCapabilities],
      endpoint: c._endpoint,
    }));
  }

  /**
   * Find peers matching a query.
   * Supports filtering by `capability` (string) -- returns peers whose
   * capabilities array includes the value.
   *
   * @param {object} [query]
   * @param {string} [query.capability] - Required capability
   * @returns {Array<{ fingerprint: string, capabilities: string[], endpoint: string|null }>}
   */
  findPeers(query = {}) {
    let peers = this.getConnectedPeers();
    if (query.capability) {
      peers = peers.filter(p => p.capabilities.includes(query.capability));
    }
    return peers;
  }

  /**
   * Forward a signaling message from one client to another.
   * Delivers via the target client's internal signal handler if connected.
   *
   * @param {string} fromFingerprint
   * @param {string} toFingerprint
   * @param {*} signal - Signal data (SDP offer/answer, ICE candidate, etc.)
   * @returns {boolean} true if the signal was delivered
   */
  forwardSignal(fromFingerprint, toFingerprint, signal) {
    const target = this.#clients.get(toFingerprint);
    if (!target) return false;
    target._deliverSignal(fromFingerprint, signal);
    return true;
  }

  /**
   * Notify all connected clients about a peer announcement.
   * Skips the announcing client itself.
   *
   * @param {string} fingerprint - The announcing peer
   * @param {string[]} capabilities
   */
  broadcastPresence(fingerprint, capabilities) {
    for (const [fp, client] of this.#clients) {
      if (fp === fingerprint) continue;
      client._deliverPeerAnnounce({ fingerprint, capabilities });
    }
  }

  /** @returns {number} */
  get size() {
    return this.#clients.size;
  }
}

// ---------------------------------------------------------------------------
// MeshRelayClient
// ---------------------------------------------------------------------------

/**
 * Client for connecting to a signaling/relay server.
 *
 * Handles peer discovery and signal forwarding for establishing
 * direct peer-to-peer connections (WebRTC offers/answers, ICE candidates).
 *
 * State machine: disconnected -> connecting -> connected -> disconnected
 */
export class MeshRelayClient {
  /** @type {string} */
  #relayUrl;

  /** @type {string} */
  #fingerprint;

  /** @type {string} */
  #state = 'disconnected';

  /** @type {MockRelayServer|null} */
  #server = null;

  /** @type {Function} */
  #onLog;

  /** @type {Function[]} */
  #signalCallbacks = [];

  /** @type {Function[]} */
  #peerAnnounceCallbacks = [];

  /** @type {Function[]} */
  #connectCallbacks = [];

  /** @type {Function[]} */
  #disconnectCallbacks = [];

  /** @type {Function[]} */
  #errorCallbacks = [];

  /** @type {string[]} Exposed for MockRelayServer to read. */
  _announcedCapabilities = [];

  /** @type {string|null} Exposed for MockRelayServer to read. */
  _endpoint = null;

  /** @type {number} */
  #knownPeerCount = 0;

  /**
   * @param {object} opts
   * @param {string} opts.relayUrl - WebSocket endpoint for the relay
   * @param {{ fingerprint: string }} opts.identity - Local identity
   * @param {Function} [opts.onLog] - Logging callback (level, msg)
   */
  constructor({ relayUrl, identity, onLog } = {}) {
    if (!relayUrl || typeof relayUrl !== 'string') {
      throw new Error('relayUrl is required and must be a non-empty string');
    }
    if (!identity || !identity.fingerprint) {
      throw new Error('identity with fingerprint is required');
    }
    this.#relayUrl = relayUrl;
    this.#fingerprint = identity.fingerprint;
    this.#onLog = onLog || (() => {});
  }

  // -- Accessors ------------------------------------------------------------

  /** Relay server URL. */
  get relayUrl() {
    return this.#relayUrl;
  }

  /** Local fingerprint. */
  get fingerprint() {
    return this.#fingerprint;
  }

  /** Current connection state. */
  get state() {
    return this.#state;
  }

  /** True when connected to the relay. */
  get connected() {
    return this.#state === 'connected';
  }

  // -- Lifecycle ------------------------------------------------------------

  /**
   * Connect to the relay server.
   * Accepts an optional MockRelayServer for testing.
   *
   * @param {MockRelayServer} [mockServer] - Mock server instance for testing
   * @returns {Promise<void>}
   */
  async connect(mockServer) {
    if (this.#state === 'connected') return;
    this.#state = 'connecting';
    this.#onLog(2, `Connecting to relay: ${this.#relayUrl}`);

    try {
      if (mockServer) {
        this.#server = mockServer;
        mockServer.registerClient(this);
      }
      // In production this would open a WebSocket to this.#relayUrl.
      // For now only the mock path is supported.
      this.#state = 'connected';
      this.#onLog(2, 'Connected to relay');
      this.#fire(this.#connectCallbacks);
    } catch (err) {
      this.#state = 'disconnected';
      this.#fire(this.#errorCallbacks, err);
      throw err;
    }
  }

  /**
   * Disconnect from the relay server.
   */
  disconnect() {
    if (this.#state === 'disconnected') return;
    if (this.#server) {
      this.#server.removeClient(this.#fingerprint);
      this.#server = null;
    }
    this.#state = 'disconnected';
    this._announcedCapabilities = [];
    this.#knownPeerCount = 0;
    this.#onLog(2, 'Disconnected from relay');
    this.#fire(this.#disconnectCallbacks);
  }

  // -- Presence & Discovery -------------------------------------------------

  /**
   * Announce this peer's presence and capabilities to the relay.
   *
   * @param {string[]} capabilities - List of capability strings to advertise
   */
  announcePresence(capabilities) {
    this.#assertConnected();
    this._announcedCapabilities = [...capabilities];
    this.#onLog(
      2,
      `Announced presence with capabilities: ${capabilities.join(', ')}`,
    );
    if (this.#server) {
      this.#server.broadcastPresence(this.#fingerprint, capabilities);
    }
  }

  /**
   * Query the relay for peers matching criteria.
   *
   * @param {object} [query]
   * @param {string} [query.capability] - Required capability
   * @returns {Promise<Array<{ fingerprint: string, capabilities: string[], endpoint: string|null }>>}
   */
  async findPeers(query = {}) {
    this.#assertConnected();
    if (!this.#server) return [];
    const peers = this.#server.findPeers(query);
    // Exclude ourselves from results
    const filtered = peers.filter(p => p.fingerprint !== this.#fingerprint);
    this.#knownPeerCount = filtered.length;
    return filtered;
  }

  // -- Signal Forwarding ----------------------------------------------------

  /**
   * Forward a signaling message to a target peer via the relay.
   *
   * @param {string} targetFingerprint - Recipient's fingerprint
   * @param {*} signal - Signal data (SDP offer/answer, ICE candidate, etc.)
   * @returns {boolean} true if the signal was delivered
   */
  forwardSignal(targetFingerprint, signal) {
    this.#assertConnected();
    this.#onLog(2, `Forwarding signal to ${targetFingerprint}`);
    if (!this.#server) return false;
    return this.#server.forwardSignal(
      this.#fingerprint,
      targetFingerprint,
      signal,
    );
  }

  // -- Event Registration ---------------------------------------------------

  /**
   * Register a callback for incoming signals from other peers.
   * Callback receives (fromFingerprint, signal).
   *
   * @param {Function} cb
   */
  onSignal(cb) {
    this.#signalCallbacks.push(cb);
  }

  /**
   * Register a callback for peer presence announcements.
   * Callback receives ({ fingerprint, capabilities }).
   *
   * @param {Function} cb
   */
  onPeerAnnounce(cb) {
    this.#peerAnnounceCallbacks.push(cb);
  }

  /**
   * Register a callback for when the relay connection is established.
   *
   * @param {Function} cb
   */
  onConnect(cb) {
    this.#connectCallbacks.push(cb);
  }

  /**
   * Register a callback for when the relay connection is closed.
   *
   * @param {Function} cb
   */
  onDisconnect(cb) {
    this.#disconnectCallbacks.push(cb);
  }

  /**
   * Register a callback for relay errors.
   *
   * @param {Function} cb
   */
  onError(cb) {
    this.#errorCallbacks.push(cb);
  }

  // -- Serialization --------------------------------------------------------

  /**
   * Serialize to a JSON-safe object (no callbacks/handles).
   *
   * @returns {object}
   */
  toJSON() {
    return {
      relayUrl: this.#relayUrl,
      fingerprint: this.#fingerprint,
      connected: this.connected,
      state: this.#state,
      capabilities: [...this._announcedCapabilities],
      knownPeerCount: this.#knownPeerCount,
    };
  }

  // -- Internal (used by MockRelayServer) -----------------------------------

  /**
   * Deliver an incoming signal from another peer.
   * Called by MockRelayServer.forwardSignal().
   *
   * @param {string} fromFingerprint
   * @param {*} signal
   */
  _deliverSignal(fromFingerprint, signal) {
    this.#fire(this.#signalCallbacks, fromFingerprint, signal);
  }

  /**
   * Deliver a peer presence announcement.
   * Called by MockRelayServer.broadcastPresence().
   *
   * @param {{ fingerprint: string, capabilities: string[] }} info
   */
  _deliverPeerAnnounce(info) {
    this.#fire(this.#peerAnnounceCallbacks, info);
  }

  // -- Private Helpers ------------------------------------------------------

  /**
   * Assert the client is connected. Throws if not.
   */
  #assertConnected() {
    if (this.#state !== 'connected') {
      throw new Error('Not connected to relay');
    }
  }

  /**
   * Fire all callbacks in a list, swallowing listener errors.
   *
   * @param {Function[]} callbacks
   * @param {...*} args
   */
  #fire(callbacks, ...args) {
    for (const cb of callbacks) {
      try {
        cb(...args);
      } catch {
        /* listener errors do not propagate */
      }
    }
  }
}

export { RELAY_STATES };
