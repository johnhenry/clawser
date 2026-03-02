// clawser-channel-slack.js — Slack Channel Plugin
//
// Slack Events API webhook + Web API fetch for messaging.
// Normalizes inbound messages via createInboundMessage().
// Config: botToken, signingSecret, channel.

// ── Constants ────────────────────────────────────────────────

const SLACK_API = 'https://slack.com/api';

// ── SlackPlugin ──────────────────────────────────────────────

/**
 * Slack channel plugin using Events API (webhook) + Web API (REST).
 * Receives inbound messages via handleEvent() (webhook endpoint).
 * Sends messages via Slack Web API chat.postMessage.
 */
export class SlackPlugin {
  /** @type {object} */
  config;

  /** @type {boolean} */
  running = false;

  /** @type {Function|null} */
  _callback = null;

  /**
   * @param {object} opts
   * @param {string} opts.botToken — Slack bot token (xoxb-...)
   * @param {string} opts.signingSecret — Slack signing secret for webhook verification
   * @param {string} opts.channel — Default channel ID for sending
   * @param {string} [opts.appToken] — Slack app-level token for Socket Mode
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
   * In webhook mode, this just marks the plugin as active.
   * Messages arrive via handleEvent() from an external HTTP server.
   */
  start() {
    if (this.running) return;
    this.running = true;
  }

  /**
   * Stop the Slack plugin.
   */
  stop() {
    if (!this.running) return;
    this.running = false;
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
