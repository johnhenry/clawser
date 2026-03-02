// clawser-channel-discord.js — Discord Channel Plugin
//
// Discord Gateway WebSocket + REST API for messaging.
// Normalizes inbound messages via createInboundMessage().
// Config: botToken, guildId.

// ── Constants ────────────────────────────────────────────────

const DISCORD_API = 'https://discord.com/api/v10';
const DISCORD_GATEWAY = 'wss://gateway.discord.gg/?v=10&encoding=json';

// Gateway opcodes
const OP_DISPATCH = 0;
const OP_HEARTBEAT = 1;
const OP_IDENTIFY = 2;
const OP_HELLO = 10;
const OP_HEARTBEAT_ACK = 11;

// ── DiscordPlugin ────────────────────────────────────────────

/**
 * Discord channel plugin using Gateway WebSocket + REST API.
 * Connects to Discord Gateway for real-time MESSAGE_CREATE events.
 * Sends messages via Discord REST API.
 */
export class DiscordPlugin {
  /** @type {object} */
  config;

  /** @type {boolean} */
  running = false;

  /** @type {Function|null} */
  _callback = null;

  /** @type {object|null} WebSocket connection */
  #ws = null;

  /** @type {number|null} Heartbeat timer */
  #heartbeatTimer = null;

  /** @type {number|null} Last sequence number */
  #seq = null;

  /** @type {number} Reconnect attempt counter */
  #reconnectAttempts = 0;

  /** @type {number} Max reconnect attempts before giving up */
  #maxReconnectAttempts = 10;

  /**
   * @param {object} opts
   * @param {string} opts.botToken — Discord bot token
   * @param {string} opts.guildId — Discord guild (server) ID
   * @param {string} [opts.gatewayUrl] — Custom gateway URL
   * @param {number} [opts.intents=33281] — Gateway intents bitmask
   */
  constructor(opts = {}) {
    this.config = {
      botToken: opts.botToken,
      guildId: opts.guildId,
      gatewayUrl: opts.gatewayUrl || DISCORD_GATEWAY,
      // Default intents: GUILDS (1) + GUILD_MESSAGES (512) + MESSAGE_CONTENT (32768) = 33281
      intents: opts.intents || 33281,
    };
  }

  // ── Message normalization ───────────────────────────────

  /**
   * Normalize a Discord MESSAGE_CREATE payload into standard inbound format.
   * @param {object} raw — Discord message object
   * @returns {object} Standard InboundMessage
   */
  createInboundMessage(raw) {
    const author = raw.author || {};

    return {
      id: raw.id || String(Date.now()),
      channel: 'discord',
      channelId: raw.channel_id || null,
      sender: {
        id: author.id || 'unknown',
        name: author.global_name || author.username || 'Unknown',
        username: author.username || null,
      },
      content: raw.content || '',
      attachments: (raw.attachments || []).map(a => ({
        id: a.id,
        url: a.url,
        filename: a.filename,
        size: a.size,
      })),
      replyTo: raw.message_reference?.message_id || null,
      timestamp: raw.timestamp ? new Date(raw.timestamp).getTime() : Date.now(),
    };
  }

  // ── Lifecycle ───────────────────────────────────────────

  /**
   * Start the Discord Gateway connection.
   */
  start() {
    if (this.running) return;
    this.running = true;
    this.#connectGateway();
  }

  /**
   * Stop the Discord Gateway connection.
   */
  stop() {
    if (!this.running) return;
    this.running = false;

    if (this.#heartbeatTimer) {
      clearInterval(this.#heartbeatTimer);
      this.#heartbeatTimer = null;
    }

    if (this.#ws) {
      try { this.#ws.close(); } catch { /* ignore */ }
      this.#ws = null;
    }
  }

  #connectGateway() {
    if (!this.running) return;

    try {
      this.#ws = new WebSocket(this.config.gatewayUrl);

      this.#ws.onmessage = (event) => {
        try {
          const data = JSON.parse(typeof event.data === 'string' ? event.data : event);
          this.#handleGatewayMessage(data);
        } catch { /* parse error */ }
      };

      this.#ws.onclose = () => {
        if (this.#heartbeatTimer) {
          clearInterval(this.#heartbeatTimer);
          this.#heartbeatTimer = null;
        }
        // Reconnect with exponential backoff and max attempts
        if (this.running && this.#reconnectAttempts < this.#maxReconnectAttempts) {
          const delay = Math.min(5000 * Math.pow(1.5, this.#reconnectAttempts), 60000);
          this.#reconnectAttempts++;
          setTimeout(() => this.#connectGateway(), delay);
        }
      };

      this.#ws.onerror = () => { /* handled by onclose */ };
    } catch {
      // WebSocket creation failed — retry
      if (this.running) {
        setTimeout(() => this.#connectGateway(), 5000);
      }
    }
  }

  #handleGatewayMessage(data) {
    if (data.s !== null && data.s !== undefined) {
      this.#seq = data.s;
    }

    switch (data.op) {
      case OP_HELLO:
        // Start heartbeat
        this.#startHeartbeat(data.d.heartbeat_interval);
        // Identify
        this.#identify();
        // Reset reconnect counter on successful connection
        this.#reconnectAttempts = 0;
        break;

      case OP_HEARTBEAT:
        // Server requested heartbeat
        this.#sendHeartbeat();
        break;

      case OP_HEARTBEAT_ACK:
        // Heartbeat acknowledged — all good
        break;

      case OP_DISPATCH:
        this.handleGatewayEvent(data);
        break;
    }
  }

  #startHeartbeat(interval) {
    if (this.#heartbeatTimer) clearInterval(this.#heartbeatTimer);
    this.#heartbeatTimer = setInterval(() => this.#sendHeartbeat(), interval);
    // Send first heartbeat immediately
    this.#sendHeartbeat();
  }

  #sendHeartbeat() {
    if (this.#ws && this.#ws.readyState === 1) {
      this.#ws.send(JSON.stringify({ op: OP_HEARTBEAT, d: this.#seq }));
    }
  }

  #identify() {
    if (this.#ws && this.#ws.readyState === 1) {
      this.#ws.send(JSON.stringify({
        op: OP_IDENTIFY,
        d: {
          token: this.config.botToken,
          intents: this.config.intents,
          properties: {
            os: 'browser',
            browser: 'clawser',
            device: 'clawser',
          },
        },
      }));
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
   * Handle a Gateway dispatch event.
   * Filters for MESSAGE_CREATE and ignores bot messages.
   * @param {object} event — Gateway event {t, d}
   */
  handleGatewayEvent(event) {
    if (event.t !== 'MESSAGE_CREATE') return;

    const data = event.d;
    if (!data) return;

    // Ignore bot messages
    if (data.author && data.author.bot) return;

    const msg = this.createInboundMessage(data);
    if (this._callback) {
      this._callback(msg);
    }
  }

  // ── Outbound ────────────────────────────────────────────

  /**
   * Send a message via Discord REST API.
   * @param {string} text — Message content
   * @param {object} [opts]
   * @param {string} opts.channelId — Channel ID to send to
   * @returns {Promise<boolean>}
   */
  async sendMessage(text, opts = {}) {
    const channelId = opts.channelId;
    if (!channelId) return false;

    try {
      const res = await fetch(`${DISCORD_API}/channels/${channelId}/messages`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bot ${this.config.botToken}`,
        },
        body: JSON.stringify({ content: text }),
      });

      return res.ok;
    } catch {
      return false;
    }
  }
}
