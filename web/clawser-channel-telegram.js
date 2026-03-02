// clawser-channel-telegram.js — Telegram Channel Plugin
//
// Polls Telegram Bot API via getUpdates, sends via sendMessage.
// Normalizes inbound messages via createInboundMessage().
// Config: botToken, chatId, pollingInterval.

// ── Constants ────────────────────────────────────────────────

const TELEGRAM_API = 'https://api.telegram.org';

// ── TelegramPlugin ───────────────────────────────────────────

/**
 * Telegram channel plugin using Bot API long polling.
 * Polls getUpdates for inbound messages and sends via sendMessage API.
 */
export class TelegramPlugin {
  /** @type {object} */
  config;

  /** @type {boolean} */
  running = false;

  /** @type {Function|null} */
  _callback = null;

  /** @type {number} Last processed update_id */
  _offset = 0;

  /** @type {number|null} Polling timer */
  #pollTimer = null;

  /**
   * @param {object} opts
   * @param {string} opts.botToken — Telegram bot token
   * @param {string} opts.chatId — Default chat ID for sending
   * @param {number} [opts.pollingInterval=3000] — Polling interval in ms
   * @param {number} [opts.timeout=30] — Long polling timeout in seconds
   */
  constructor(opts = {}) {
    this.config = {
      botToken: opts.botToken,
      chatId: opts.chatId,
      pollingInterval: opts.pollingInterval || 3000,
      timeout: opts.timeout || 30,
    };
  }

  // ── API URL builder ─────────────────────────────────────

  /**
   * Build a Telegram Bot API URL.
   * @param {string} method
   * @returns {string}
   */
  #apiUrl(method) {
    return `${TELEGRAM_API}/bot${this.config.botToken}/${method}`;
  }

  // ── Message normalization ───────────────────────────────

  /**
   * Normalize a Telegram update into standard inbound message format.
   * @param {object} raw — Telegram update object
   * @returns {{id: string, text: string, sender: string, channel: string, timestamp: number}}
   */
  createInboundMessage(raw) {
    const message = raw.message || {};
    const from = message.from || {};

    return {
      id: String(message.message_id || raw.update_id || Date.now()),
      text: message.text || '',
      sender: from.username || from.first_name || 'unknown',
      channel: 'telegram',
      timestamp: message.date ? message.date * 1000 : Date.now(),
    };
  }

  // ── Lifecycle ───────────────────────────────────────────

  /**
   * Start polling for updates.
   */
  start() {
    if (this.running) return;
    this.running = true;
    this.#startPolling();
  }

  /**
   * Stop polling.
   */
  stop() {
    if (!this.running) return;
    this.running = false;
    if (this.#pollTimer) {
      clearTimeout(this.#pollTimer);
      this.#pollTimer = null;
    }
  }

  #startPolling() {
    if (!this.running) return;
    this.#pollTimer = setTimeout(async () => {
      try {
        const updates = await this.getUpdates();
        this.processUpdates(updates);
      } catch {
        // Polling error — retry on next interval
      }
      this.#startPolling();
    }, this.config.pollingInterval);
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
   * Fetch updates from Telegram API.
   * @returns {Promise<Array>}
   */
  async getUpdates() {
    const params = new URLSearchParams({
      timeout: String(this.config.timeout),
      allowed_updates: JSON.stringify(['message']),
    });
    if (this._offset > 0) {
      params.set('offset', String(this._offset + 1));
    }

    const url = `${this.#apiUrl('getUpdates')}?${params}`;
    const res = await fetch(url);
    if (!res.ok) return [];

    const data = await res.json();
    return data.ok ? data.result : [];
  }

  /**
   * Process an array of Telegram updates.
   * Invokes the onMessage callback for each and updates the offset.
   * @param {Array} updates
   */
  processUpdates(updates) {
    if (!updates || updates.length === 0) return;

    for (const update of updates) {
      // Track offset for next poll
      if (update.update_id > this._offset) {
        this._offset = update.update_id;
      }

      const msg = this.createInboundMessage(update);
      if (this._callback) {
        this._callback(msg);
      }
    }
  }

  // ── Outbound ────────────────────────────────────────────

  /**
   * Send a message via Telegram Bot API.
   * @param {string} text — Message text
   * @param {object} [opts]
   * @param {string} [opts.chatId] — Override default chat ID
   * @param {string} [opts.parseMode] — Parse mode (HTML, Markdown, MarkdownV2)
   * @returns {Promise<boolean>}
   */
  async sendMessage(text, opts = {}) {
    const chatId = opts.chatId || this.config.chatId;
    const body = {
      chat_id: chatId,
      text,
    };

    if (opts.parseMode) {
      body.parse_mode = opts.parseMode;
    }

    try {
      const res = await fetch(this.#apiUrl('sendMessage'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
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
