import { silentCatch } from './clawser-silent-catch.mjs'
// clawser-channel-slack.js — Slack Channel Plugin
//
// Web API fetch for outbound messaging (chat.postMessage).
// Inbound messages arrive one of two ways:
//   - Socket Mode (self-contained): when `appToken` (xapp-...) is configured,
//     the plugin opens `apps.connections.open` and connects a WebSocket
//     directly to Slack — no public HTTPS endpoint needed, same pattern as
//     the Discord Gateway plugin.
//   - Events API webhook: handleEvent(payload) can still be called directly
//     by an external HTTP server/relay that forwards Slack's webhook POSTs.
// Normalizes inbound messages via createInboundMessage().
// Config: botToken, signingSecret, channel, appToken.

// ── Constants ────────────────────────────────────────────────

const SLACK_API = 'https://slack.com/api';

// ── SlackPlugin ──────────────────────────────────────────────

/**
 * Slack channel plugin using Socket Mode (WebSocket) or Events API (webhook)
 * for inbound, and Web API (REST) for outbound.
 * Sends messages via Slack Web API chat.postMessage.
 */
export class SlackPlugin {
  /** @type {object} */
  config;

  /** @type {boolean} */
  running = false;

  /** @type {Function|null} */
  _callback = null;

  /** @type {object|null} Socket Mode WebSocket connection */
  #ws = null;

  /** @type {number} Reconnect attempt counter */
  #reconnectAttempts = 0;

  /** @type {number} Max reconnect attempts before giving up */
  #maxReconnectAttempts = 10;

  /**
   * @param {object} opts
   * @param {string} opts.botToken — Slack bot token (xoxb-...)
   * @param {string} opts.signingSecret — Slack signing secret for webhook verification
   * @param {string} opts.channel — Default channel ID for sending
   * @param {string} [opts.appToken] — Slack app-level token (xapp-...) enabling Socket Mode
   */
  constructor(opts = {}) {
    this.config = {
      botToken: opts.botToken,
      signingSecret: opts.signingSecret,
      channel: opts.channel,
      appToken: opts.appToken || null,
    };
  }

  // ── Message normalization ───────────────────────────────

  /**
   * Normalize a Slack event into standard inbound message format.
   * @param {object} raw — Slack event object
   * @returns {object} Standard InboundMessage
   */
  createInboundMessage(raw) {
    return {
      id: raw.client_msg_id || raw.ts || String(Date.now()),
      channel: 'slack',
      channelId: raw.channel || null,
      sender: {
        id: raw.user || 'unknown',
        name: raw.user_profile?.real_name || raw.user || 'Unknown',
        username: raw.user_profile?.display_name || raw.user || null,
      },
      content: raw.text || '',
      attachments: (raw.files || []).map(f => ({
        id: f.id,
        url: f.url_private,
        filename: f.name,
        size: f.size,
      })),
      replyTo: raw.thread_ts && raw.thread_ts !== raw.ts ? raw.thread_ts : null,
      timestamp: raw.ts ? Math.floor(parseFloat(raw.ts) * 1000) : Date.now(),
    };
  }

  // ── Lifecycle ───────────────────────────────────────────

  /**
   * Start the Slack plugin.
   * When `appToken` is configured, opens a Socket Mode WebSocket connection
   * directly to Slack (self-contained, no relay needed). Otherwise runs in
   * webhook-only mode — messages arrive via handleEvent() from an external
   * HTTP server/relay.
   */
  start() {
    if (this.running) return;
    this.running = true;
    if (this.config.appToken) {
      this._socketModePromise = this.#connectSocketMode();
    }
  }

  /**
   * Stop the Slack plugin.
   */
  stop() {
    if (!this.running) return;
    this.running = false;

    if (this.#ws) {
      try { this.#ws.close(); } catch (e) { silentCatch('clawser-channel-slack', 'this', e) }
      this.#ws = null;
    }
  }

  // ── Socket Mode ──────────────────────────────────────────

  /**
   * Open a Socket Mode connection: request a WebSocket URL via
   * apps.connections.open, then connect to it.
   */
  async #connectSocketMode() {
    if (!this.running) return;

    try {
      const res = await fetch(`${SLACK_API}/apps.connections.open`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${this.config.appToken}` },
      });
      const data = await res.json();
      if (!this.running) return;
      if (!data.ok || !data.url) throw new Error(data.error || 'apps.connections.open failed');

      this.#ws = new WebSocket(data.url);

      this.#ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(typeof event.data === 'string' ? event.data : event);
          this.#handleSocketMessage(msg);
        } catch { /* parse error */ }
      };

      this.#ws.onopen = () => {
        this.#reconnectAttempts = 0;
      };

      this.#ws.onclose = () => {
        if (this.running && this.#reconnectAttempts < this.#maxReconnectAttempts) {
          const delay = Math.min(1000 * Math.pow(1.5, this.#reconnectAttempts), 60000);
          this.#reconnectAttempts++;
          setTimeout(() => this.#connectSocketMode(), delay);
        }
      };

      this.#ws.onerror = () => { /* handled by onclose */ };
    } catch {
      if (this.running && this.#reconnectAttempts < this.#maxReconnectAttempts) {
        const delay = Math.min(1000 * Math.pow(1.5, this.#reconnectAttempts), 60000);
        this.#reconnectAttempts++;
        setTimeout(() => this.#connectSocketMode(), delay);
      }
    }
  }

  /**
   * Handle a Socket Mode envelope. Acknowledges any envelope carrying an
   * `envelope_id` (required within 3s or Slack will retry/disconnect).
   * @param {object} data — Socket Mode envelope {type, envelope_id, payload}
   */
  #handleSocketMessage(data) {
    switch (data.type) {
      case 'events_api':
        if (data.payload) this.handleEvent(data.payload);
        break;

      case 'disconnect':
        // Slack is closing this connection (refresh/warning) — reconnect.
        if (this.#ws) {
          try { this.#ws.close(); } catch (e) { silentCatch('clawser-channel-slack', 'this', e) }
        }
        return;

      case 'hello':
      default:
        break;
    }

    if (data.envelope_id && this.#ws && this.#ws.readyState === 1) {
      this.#ws.send(JSON.stringify({ envelope_id: data.envelope_id }));
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
   * Handle an incoming Slack Events API payload.
   * Supports url_verification challenge and event_callback dispatching.
   * @param {object} payload — Slack event payload
   * @returns {object|undefined} — Returns challenge response for url_verification
   */
  handleEvent(payload) {
    // Handle URL verification challenge
    if (payload.type === 'url_verification') {
      return { challenge: payload.challenge };
    }

    // Handle event callbacks
    if (payload.type === 'event_callback' && payload.event) {
      const event = payload.event;

      // Only handle message events
      if (event.type !== 'message') return;

      // Ignore bot messages
      if (event.bot_id || event.subtype === 'bot_message') return;

      const msg = this.createInboundMessage(event);
      if (this._callback) {
        this._callback(msg);
      }
    }
  }

  /**
   * Verify a Slack request signature.
   * @param {string} timestamp — X-Slack-Request-Timestamp header
   * @param {string} body — Raw request body
   * @param {string} signature — X-Slack-Signature header
   * @returns {Promise<boolean>}
   */
  async verifySignature(timestamp, body, signature) {
    // Check timestamp is within 5 minutes
    const now = Math.floor(Date.now() / 1000);
    if (Math.abs(now - parseInt(timestamp, 10)) > 300) {
      return false;
    }

    // Compute HMAC-SHA256
    const sigBasestring = `v0:${timestamp}:${body}`;

    try {
      const encoder = new TextEncoder();
      const key = await crypto.subtle.importKey(
        'raw',
        encoder.encode(this.config.signingSecret),
        { name: 'HMAC', hash: 'SHA-256' },
        false,
        ['sign'],
      );
      const sig = await crypto.subtle.sign('HMAC', key, encoder.encode(sigBasestring));
      const hex = Array.from(new Uint8Array(sig)).map(b => b.toString(16).padStart(2, '0')).join('');
      return `v0=${hex}` === signature;
    } catch {
      return false;
    }
  }

  // ── Outbound ────────────────────────────────────────────

  /**
   * Send a message via Slack Web API.
   * @param {string} text — Message text
   * @param {object} [opts]
   * @param {string} [opts.channel] — Override default channel
   * @param {string} [opts.threadTs] — Thread timestamp for threaded replies
   * @returns {Promise<boolean>}
   */
  async sendMessage(text, opts = {}) {
    const channel = opts.channel || this.config.channel;

    const body = {
      channel,
      text,
    };

    if (opts.threadTs) {
      body.thread_ts = opts.threadTs;
    }

    try {
      const res = await fetch(`${SLACK_API}/chat.postMessage`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.config.botToken}`,
        },
        body: JSON.stringify(body),
      });

      if (!res.ok) return false;
      const data = await res.json();
      return data.ok === true;
    } catch {
      return false;
    }
  }
}
