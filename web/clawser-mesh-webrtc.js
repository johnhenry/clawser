/**
 * clawser-mesh-webrtc.js -- WebRTC mesh transport.
 *
 * Provides WebRTC DataChannel-based P2P connections for the BrowserMesh.
 * Includes signaling helpers, connection management, and a transport
 * adapter that integrates with MeshTransportNegotiator.
 *
 * No browser-only imports at module level.
 *
 * Run tests:
 *   node --import ./web/test/_setup-globals.mjs --test web/test/clawser-mesh-webrtc.test.mjs
 */

import { MeshTransport } from './clawser-mesh-transport.js'

// ---------------------------------------------------------------------------
// Feature detection
// ---------------------------------------------------------------------------

/**
 * Returns true when the current environment supports WebRTC.
 * @returns {boolean}
 */
export function supportsWebRTC() {
  return typeof RTCPeerConnection !== 'undefined'
}

// ---------------------------------------------------------------------------
// ICE defaults
// ---------------------------------------------------------------------------

/** @type {RTCIceServer[]} */
const DEFAULT_ICE_SERVERS = Object.freeze([
  { urls: 'stun:stun.l.google.com:19302' },
])

// ---------------------------------------------------------------------------
// WebRTCPeerConnection
// ---------------------------------------------------------------------------

/**
 * Manages a single WebRTC peer connection with a DataChannel.
 *
 * Lifecycle:
 *   1. Caller side:  createOffer() -> send offer via signaling -> handleAnswer()
 *   2. Callee side:  handleOffer(offer) -> send answer via signaling
 *   3. Both sides:   exchange ICE candidates via onIceCandidate / addIceCandidate
 *   4. DataChannel opens -> state becomes 'connected'
 *   5. close() tears down everything
 */
export class WebRTCPeerConnection {
  #localPodId
  #remotePodId
  #pc = null
  #dataChannel = null
  #iceServers
  #onLog
  #state = 'new'   // new | connecting | connected | closed
  #iceCandidateCbs = []
  #messageCbs = []
  #closeCbs = []
  #errorCbs = []
  #stats = { bytesSent: 0, bytesReceived: 0, messagesIn: 0, messagesOut: 0 }

  /**
   * @param {object} opts
   * @param {string} opts.localPodId  - This pod's identifier
   * @param {string} opts.remotePodId - Target pod's identifier
   * @param {RTCIceServer[]} [opts.iceServers]
   * @param {Function} [opts.onLog]   - Optional logging callback
   */
  constructor({ localPodId, remotePodId, iceServers, onLog } = {}) {
    if (!localPodId) throw new Error('localPodId is required')
    if (!remotePodId) throw new Error('remotePodId is required')
    this.#localPodId = localPodId
    this.#remotePodId = remotePodId
    this.#iceServers = iceServers || [...DEFAULT_ICE_SERVERS]
    this.#onLog = onLog || null
  }

  // -- Accessors ------------------------------------------------------------

  /** Local pod identifier. */
  get localPodId() { return this.#localPodId }

  /** Remote pod identifier. */
  get remotePodId() { return this.#remotePodId }

  /** Current connection state. */
  get state() { return this.#state }

  /** Byte-level stats (copy). */
  get stats() { return { ...this.#stats } }

  /** True when the DataChannel is open and usable. */
  get isOpen() {
    return this.#state === 'connected' &&
           this.#dataChannel?.readyState === 'open'
  }

  // -- Offer / Answer -------------------------------------------------------

  /**
   * Create an SDP offer (caller side).
   * Sets up the RTCPeerConnection, creates a DataChannel, and returns
   * the offer to be sent through signaling.
   *
   * @returns {Promise<{type: 'offer', sdp: string}>}
   */
  async createOffer() {
    this.#ensureNotClosed()
    this.#pc = new RTCPeerConnection({ iceServers: this.#iceServers })
    this.#setupIceHandling()
    this.#setupConnectionStateHandling()

    this.#dataChannel = this.#pc.createDataChannel('mesh', {
      ordered: true,
    })
    this.#setupDataChannel(this.#dataChannel)

    const offer = await this.#pc.createOffer()
    await this.#pc.setLocalDescription(offer)
    this.#state = 'connecting'
    this.#log(`Created offer for ${this.#remotePodId}`)
    return { type: 'offer', sdp: offer.sdp }
  }

  /**
   * Handle an incoming SDP offer (callee side).
   * Creates a peer connection, waits for the remote DataChannel, and
   * returns an SDP answer to send back through signaling.
   *
   * @param {{type: string, sdp: string}} offer
   * @returns {Promise<{type: 'answer', sdp: string}>}
   */
  async handleOffer(offer) {
    this.#ensureNotClosed()
    if (!offer || !offer.sdp) throw new Error('Invalid offer: missing sdp')

    this.#pc = new RTCPeerConnection({ iceServers: this.#iceServers })
    this.#setupIceHandling()
    this.#setupConnectionStateHandling()

    this.#pc.ondatachannel = (event) => {
      this.#dataChannel = event.channel
      this.#setupDataChannel(this.#dataChannel)
    }

    await this.#pc.setRemoteDescription({ type: 'offer', sdp: offer.sdp })
    const answer = await this.#pc.createAnswer()
    await this.#pc.setLocalDescription(answer)
    this.#state = 'connecting'
    this.#log(`Created answer for ${this.#remotePodId}`)
    return { type: 'answer', sdp: answer.sdp }
  }

  /**
   * Apply the remote SDP answer (caller side, after receiving answer).
   *
   * @param {{type: string, sdp: string}} answer
   */
  async handleAnswer(answer) {
    if (!this.#pc) throw new Error('No peer connection — call createOffer() first')
    if (!answer || !answer.sdp) throw new Error('Invalid answer: missing sdp')
    await this.#pc.setRemoteDescription({ type: 'answer', sdp: answer.sdp })
    this.#log(`Applied answer from ${this.#remotePodId}`)
  }

  // -- ICE ------------------------------------------------------------------

  /**
   * Add a remote ICE candidate received through signaling.
   *
   * @param {RTCIceCandidate|object} candidate
   */
  addIceCandidate(candidate) {
    if (!this.#pc) throw new Error('No peer connection')
    this.#pc.addIceCandidate(candidate)
  }

  /**
   * Register callback for locally-gathered ICE candidates.
   * These must be sent to the remote peer through signaling.
   *
   * @param {Function} cb - Called with (candidate: RTCIceCandidate)
   */
  onIceCandidate(cb) {
    this.#iceCandidateCbs.push(cb)
  }

  // -- Messaging ------------------------------------------------------------

  /**
   * Register a callback for incoming DataChannel messages.
   * JSON strings are automatically parsed.
   *
   * @param {Function} cb
   */
  onMessage(cb) { this.#messageCbs.push(cb) }

  /**
   * Register a callback for connection close.
   *
   * @param {Function} cb
   */
  onClose(cb) { this.#closeCbs.push(cb) }

  /**
   * Register a callback for connection errors.
   *
   * @param {Function} cb
   */
  onError(cb) { this.#errorCbs.push(cb) }

  /**
   * Send data over the DataChannel.
   * Objects are JSON-serialized automatically.
   *
   * @param {string|object} data
   */
  send(data) {
    if (!this.#dataChannel) throw new Error('No data channel')
    if (this.#dataChannel.readyState !== 'open') {
      throw new Error('Data channel not open')
    }
    const str = typeof data === 'string' ? data : JSON.stringify(data)
    this.#dataChannel.send(str)
    this.#stats.bytesSent += str.length
    this.#stats.messagesOut += 1
  }

  /**
   * Close the connection and clean up all resources.
   */
  close() {
    if (this.#state === 'closed') return
    this.#state = 'closed'
    if (this.#dataChannel) {
      try { this.#dataChannel.close() } catch { /* ignore */ }
      this.#dataChannel = null
    }
    if (this.#pc) {
      try { this.#pc.close() } catch { /* ignore */ }
      this.#pc = null
    }
    this.#fireClose()
    this.#log(`Connection closed with ${this.#remotePodId}`)
  }

  // -- Internal helpers -----------------------------------------------------

  #ensureNotClosed() {
    if (this.#state === 'closed') {
      throw new Error('Connection is closed')
    }
  }

  #setupIceHandling() {
    this.#pc.onicecandidate = (event) => {
      if (event.candidate) {
        for (const cb of this.#iceCandidateCbs) {
          try { cb(event.candidate) } catch { /* swallow */ }
        }
      }
    }
  }

  #setupConnectionStateHandling() {
    this.#pc.onconnectionstatechange = () => {
      const pcState = this.#pc?.connectionState
      if (pcState === 'failed' || pcState === 'disconnected') {
        this.#fireError(new Error(`PeerConnection state: ${pcState}`))
      }
    }
  }

  #setupDataChannel(dc) {
    dc.onopen = () => {
      this.#state = 'connected'
      this.#log(`DataChannel open with ${this.#remotePodId}`)
    }
    dc.onmessage = (event) => {
      const rawLen = event.data?.length || 0
      this.#stats.bytesReceived += rawLen
      this.#stats.messagesIn += 1
      let parsed = event.data
      try { parsed = JSON.parse(event.data) } catch { /* keep as string */ }
      for (const cb of this.#messageCbs) {
        try { cb(parsed) } catch { /* swallow */ }
      }
    }
    dc.onclose = () => {
      if (this.#state !== 'closed') {
        this.#state = 'closed'
        this.#fireClose()
      }
    }
    dc.onerror = (event) => {
      this.#fireError(event?.error || new Error('DataChannel error'))
      if (this.#state !== 'closed') {
        this.#state = 'closed'
        this.#fireClose()
      }
    }
  }

  #fireClose() {
    for (const cb of this.#closeCbs) {
      try { cb() } catch { /* swallow */ }
    }
  }

  #fireError(err) {
    for (const cb of this.#errorCbs) {
      try { cb(err) } catch { /* swallow */ }
    }
  }

  #log(msg) {
    if (this.#onLog) this.#onLog(msg)
  }
}

// ---------------------------------------------------------------------------
// WebRTCMeshManager
// ---------------------------------------------------------------------------

/**
 * Manages multiple WebRTC peer connections indexed by remotePodId.
 * Thin orchestration layer — signaling is left to the caller.
 */
export class WebRTCMeshManager {
  #localPodId
  #iceServers
  #connections = new Map()   // remotePodId -> WebRTCPeerConnection
  #onLog
  #messageCbs = []

  /**
   * @param {object} opts
   * @param {string} opts.localPodId
   * @param {RTCIceServer[]} [opts.iceServers]
   * @param {Function} [opts.onLog]
   */
  constructor({ localPodId, iceServers, onLog } = {}) {
    if (!localPodId) throw new Error('localPodId is required')
    this.#localPodId = localPodId
    this.#iceServers = iceServers || [...DEFAULT_ICE_SERVERS]
    this.#onLog = onLog || null
  }

  /** Local pod identifier. */
  get localPodId() { return this.#localPodId }

  /** Number of tracked connections. */
  get connectionCount() { return this.#connections.size }

  /**
   * Register a global message listener that fires for all connections.
   *
   * @param {Function} cb - Called with (data, remotePodId)
   */
  onMessage(cb) { this.#messageCbs.push(cb) }

  /**
   * Create or return an existing WebRTCPeerConnection for a remote pod.
   * Returns the same instance on duplicate calls with the same remotePodId.
   *
   * @param {string} remotePodId
   * @returns {Promise<WebRTCPeerConnection>}
   */
  async connectToPeer(remotePodId) {
    if (this.#connections.has(remotePodId)) {
      return this.#connections.get(remotePodId)
    }
    const conn = new WebRTCPeerConnection({
      localPodId: this.#localPodId,
      remotePodId,
      iceServers: this.#iceServers,
      onLog: this.#onLog,
    })
    // Forward messages to manager-level listeners
    conn.onMessage((data) => {
      for (const cb of this.#messageCbs) {
        try { cb(data, remotePodId) } catch { /* swallow */ }
      }
    })
    // Auto-remove on close
    conn.onClose(() => {
      this.#connections.delete(remotePodId)
    })
    this.#connections.set(remotePodId, conn)
    return conn
  }

  /**
   * Get an existing connection by remotePodId.
   *
   * @param {string} remotePodId
   * @returns {WebRTCPeerConnection|null}
   */
  getConnection(remotePodId) {
    return this.#connections.get(remotePodId) || null
  }

  /**
   * Check whether a connection to remotePodId exists.
   *
   * @param {string} remotePodId
   * @returns {boolean}
   */
  hasConnection(remotePodId) {
    return this.#connections.has(remotePodId)
  }

  /**
   * List all tracked connections with their current state.
   *
   * @returns {Array<{remotePodId: string, state: string}>}
   */
  listConnections() {
    return [...this.#connections.entries()].map(([remotePodId, conn]) => ({
      remotePodId,
      state: conn.state,
    }))
  }

  /**
   * Broadcast data to all connected peers.
   *
   * @param {string|object} data
   * @returns {number} Number of peers the message was sent to
   */
  broadcast(data) {
    let sent = 0
    for (const conn of this.#connections.values()) {
      if (conn.isOpen) {
        try {
          conn.send(data)
          sent++
        } catch { /* skip failed sends */ }
      }
    }
    return sent
  }

  /**
   * Close a specific peer connection.
   *
   * @param {string} remotePodId
   * @returns {boolean} True if a connection was found and closed
   */
  closePeer(remotePodId) {
    const conn = this.#connections.get(remotePodId)
    if (!conn) return false
    conn.close()
    this.#connections.delete(remotePodId)
    return true
  }

  /**
   * Close all peer connections and clear internal state.
   */
  closeAll() {
    for (const conn of this.#connections.values()) {
      try { conn.close() } catch { /* ignore */ }
    }
    this.#connections.clear()
  }
}

// ---------------------------------------------------------------------------
// WebRTCTransportAdapter
// ---------------------------------------------------------------------------

/**
 * Wraps a WebRTCPeerConnection as a MeshTransport for use with
 * MeshTransportNegotiator. The connection negotiation (offer/answer/ICE)
 * happens externally; this adapter handles the send/close lifecycle.
 */
export class WebRTCTransportAdapter extends MeshTransport {
  #connection

  /**
   * @param {WebRTCPeerConnection} connection
   */
  constructor(connection) {
    super('webrtc')
    if (!connection) throw new Error('connection is required')
    this.#connection = connection

    // Forward messages from the underlying connection
    this.#connection.onMessage((data) => {
      this._fire('message', data)
    })
    this.#connection.onClose(() => {
      if (this.state !== 'closed') {
        this._setState('closed')
      }
    })
    this.#connection.onError((err) => {
      this._fire('error', err)
    })
  }

  /**
   * Mark transport as connected.
   * The actual WebRTC negotiation (offer/answer) happens outside this adapter.
   */
  async connect() {
    this._setState('connecting')
    this._setState('connected')
  }

  /**
   * Send data through the underlying WebRTC DataChannel.
   *
   * @param {string|object} data
   */
  send(data) {
    this.#connection.send(data)
  }

  /**
   * Close the underlying WebRTC connection.
   */
  close() {
    this.#connection.close()
    super.close()
  }

  /** The underlying WebRTCPeerConnection. */
  get peerConnection() { return this.#connection }
}

// ---------------------------------------------------------------------------
// WebRTCAdapterFactory
// ---------------------------------------------------------------------------

/**
 * Factory for creating WebRTC transports.
 * Plugs into MeshTransportNegotiator.registerAdapter().
 */
export class WebRTCAdapterFactory {
  /**
   * Returns true for transport type 'webrtc'.
   *
   * @param {string} type
   * @returns {boolean}
   */
  canCreate(type) { return type === 'webrtc' }

  /**
   * Create a WebRTCTransportAdapter wrapping an existing connection.
   *
   * @param {string} remotePodId
   * @param {object} opts
   * @param {WebRTCPeerConnection} opts.connection - Pre-negotiated connection
   * @returns {WebRTCTransportAdapter}
   */
  create(remotePodId, opts) {
    if (!opts || !opts.connection) {
      throw new Error('WebRTCAdapterFactory requires opts.connection')
    }
    return new WebRTCTransportAdapter(opts.connection)
  }
}
