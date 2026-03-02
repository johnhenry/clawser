// clawser-channel-matrix.js — Matrix Channel Plugin
//
// Matrix client-server API long-poll sync for messaging.
// Normalizes inbound messages via createInboundMessage().
// Config: homeserver, accessToken, roomId.

// ── MatrixPlugin ─────────────────────────────────────────────

/**
 * Matrix channel plugin using client-server API.
 * Uses long-poll /sync for real-time message delivery.
 * Sends messages via PUT /rooms/{roomId}/send/m.room.message.
 */
export class MatrixPlugin {
  /** @type {object} */
  config;

  /** @type {boolean} */
  running = false;

  /** @type {Function|null} */
  _callback = null;

  /** @type {string|null} Sync batch token */
  _since = null;

  /** @type {number} Transaction counter for unique txnIds */
  #txnCounter = 0;

  /** @type {boolean} Currently polling */
  #polling = false;

  /**
   * @param {object} opts
   * @param {string} opts.homeserver — Matrix homeserver URL (e.g. https://matrix.example.org)
   * @param {string} opts.accessToken — Matrix access token
   * @param {string} opts.roomId — Default room ID (e.g. !abc:example.org)
   * @param {number} [opts.pollingTimeout=30000] — Long-poll timeout in ms
   */
  constructor(opts = {}) {
    this.config = {
      homeserver: opts.homeserver,
      accessToken: opts.accessToken,
      roomId: opts.roomId,
      pollingTimeout: opts.pollingTimeout || 30000,
    };
  }

  // ── Helpers ─────────────────────────────────────────────

  /**
   * Build a Matrix client-server API URL.
   * @param {string} path — API path (without /_matrix/client/v3 prefix)
   * @returns {string}
   */
  #apiUrl(path) {
    const base = this.config.homeserver.replace(/\/$/, '');
    return `${base}/_matrix/client/v3${path}`;
  }

  /**
   * Build common headers with auth token.
   * @returns {object}
   */
  #headers() {
    return {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${this.config.accessToken}`,
    };
  }

  // ── Message normalization ───────────────────────────────

  /**
   * Normalize a Matrix event into standard inbound message format.
   * @param {object} raw — Matrix event object
   * @returns {object} Standard InboundMessage
   */
  createInboundMessage(raw) {
    const eventContent = raw.content || {};
    const senderId = raw.sender || 'unknown';
    // Matrix sender IDs are like @user:server — extract localpart as name
    const senderName = senderId.startsWith('@')
      ? senderId.slice(1).split(':')[0]
      : senderId;

    return {
      id: raw.event_id || String(Date.now()),
      channel: 'matrix',
      channelId: raw.room_id || null,
      sender: {
        id: senderId,
        name: senderName || 'Unknown',
        username: senderName || null,
      },
      content: eventContent.body || '',
      attachments: [],
      replyTo: eventContent['m.relates_to']?.['m.in_reply_to']?.event_id || null,
      timestamp: raw.origin_server_ts || Date.now(),
    };
  }

  // ── Lifecycle ───────────────────────────────────────────

  /**
   * Start long-poll sync loop.
   */
  start() {
    if (this.running) return;
    this.running = true;
    this.#pollLoop();
  }

  /** @type {number|null} */
  #pollTimer = null;

  /**
   * Stop sync loop.
   */
  stop() {
    if (!this.running) return;
    this.running = false;
    if (this.#pollTimer) {
      clearTimeout(this.#pollTimer);
      this.#pollTimer = null;
    }
  }

  async #pollLoop() {
    if (!this.running || this.#polling) return;
    this.#polling = true;

    try {
      const params = new URLSearchParams({
        timeout: String(this.config.pollingTimeout),
      });
      if (this._since) {
        params.set('since', this._since);
      }
      // Filter to only get room messages
      params.set('filter', JSON.stringify({
        room: { timeline: { types: ['m.room.message'] } },
      }));

      const url = `${this.#apiUrl('/sync')}?${params}`;
      const res = await fetch(url, { headers: this.#headers() });

      if (res.ok) {
        const data = await res.json();
        this.processSyncResponse(data);
      }
    } catch {
      // Sync error — retry on next iteration
    }

    this.#polling = false;

    // Schedule next poll
    if (this.running) {
      this.#pollTimer = setTimeout(() => this.#pollLoop(), 100);
    }
  }

  // ── Inbound handling ────────────────────────────────────

  /**
   * Register a callback for inbound messages.
   * @param {Function} callback — (msg: InboundMessage) => void
   */
  onMessage(callback) {
    this._callback = callback;
  }

  /**
   * Process a /sync response.
   * Extracts m.room.message events and dispatches to callback.
   * @param {object} data — Matrix sync response
   */
  processSyncResponse(data) {
    // Update since token
    if (data.next_batch) {
      this._since = data.next_batch;
    }

    // Process joined rooms
    const joined = data.rooms?.join || {};
    for (const [roomId, room] of Object.entries(joined)) {
      const events = room.timeline?.events || [];
      for (const event of events) {
        // Only process m.room.message events
        if (event.type !== 'm.room.message') continue;

        const msg = this.createInboundMessage(event);
        if (this._callback) {
          this._callback(msg);
        }
      }
    }
  }

  // ── Outbound ────────────────────────────────────────────

  /**
   * Send a message via Matrix client-server API.
   * @param {string} text — Message body
   * @param {object} [opts]
   * @param {string} [opts.roomId] — Override default room ID
   * @param {string} [opts.msgtype='m.text'] — Message type
   * @returns {Promise<boolean>}
   */
  async sendMessage(text, opts = {}) {
    const roomId = opts.roomId || this.config.roomId;
    const msgtype = opts.msgtype || 'm.text';
    const txnId = `clawser_${Date.now()}_${++this.#txnCounter}`;

    const encodedRoom = encodeURIComponent(roomId);
    const url = `${this.#apiUrl(`/rooms/${encodedRoom}/send/m.room.message/${txnId}`)}`;

    try {
      const res = await fetch(url, {
        method: 'PUT',
        headers: this.#headers(),
        body: JSON.stringify({
          msgtype,
          body: text,
        }),
      });

      return res.ok;
    } catch {
      return false;
    }
  }
}
