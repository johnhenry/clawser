// clawser-channel-email.js — Email Channel Plugin
//
// IMAP polling via fetch (wsh-based proxy) + SMTP/Gmail API send.
// Normalizes inbound messages via createInboundMessage().
// Config: imapHost, smtpHost, credentials, useGmailApi.

// ── Constants ────────────────────────────────────────────────

const GMAIL_API = 'https://gmail.googleapis.com/gmail/v1/users/me';

// ── EmailPlugin ──────────────────────────────────────────────

/**
 * Email channel plugin supporting IMAP polling and SMTP/Gmail API sending.
 * Uses wsh-based fetch proxy for IMAP/SMTP in browser environments.
 * Supports Gmail API as an alternative transport.
 */
export class EmailPlugin {
  /** @type {object} */
  config;

  /** @type {boolean} */
  running = false;

  /** @type {Function|null} */
  _callback = null;

  /** @type {Set<string>} Seen message IDs for deduplication */
  #seenIds = new Set();

  /** @type {number|null} Polling timer */
  #pollTimer = null;

  /**
   * @param {object} opts
   * @param {string} opts.imapHost — IMAP server host
   * @param {string} opts.smtpHost — SMTP server host
   * @param {object} opts.credentials — {user, pass, accessToken?}
   * @param {number} [opts.pollingInterval=60000] — Polling interval in ms
   * @param {boolean} [opts.useGmailApi=false] — Use Gmail API instead of SMTP
   * @param {string} [opts.folder='INBOX'] — IMAP folder to poll
   * @param {number} [opts.maxSeenIds=1000] — Max tracked message IDs
   * @param {string} [opts.imapProtocol='https://'] — Protocol for IMAP URL
   * @param {string} [opts.smtpProtocol='https://'] — Protocol for SMTP URL
   */
  constructor(opts = {}) {
    this.config = {
      imapHost: opts.imapHost,
      smtpHost: opts.smtpHost,
      credentials: opts.credentials || {},
      pollingInterval: opts.pollingInterval || 60000,
      useGmailApi: opts.useGmailApi || false,
      folder: opts.folder || 'INBOX',
      maxSeenIds: opts.maxSeenIds || 1000,
      imapProtocol: opts.imapProtocol || 'https://',
      smtpProtocol: opts.smtpProtocol || 'https://',
    };
  }

  // ── Message normalization ───────────────────────────────

  /**
   * Normalize an email envelope into standard inbound message format.
   * @param {object} raw — Email envelope/parsed object
   * @returns {object} Standard InboundMessage
   */
  createInboundMessage(raw) {
    let body = raw.body || '';
    if (!body && raw.subject) {
      body = `[Subject: ${raw.subject}]`;
    }

    // Parse "Name <email>" format for sender
    const fromRaw = raw.from || 'unknown';
    const emailMatch = fromRaw.match(/^(.+?)\s*<(.+?)>$/);
    const senderName = emailMatch ? emailMatch[1].trim() : fromRaw;
    const senderEmail = emailMatch ? emailMatch[2].trim() : fromRaw;

    return {
      id: raw.messageId || `email_${Date.now()}`,
      channel: 'email',
      channelId: raw.to || null,
      sender: {
        id: senderEmail,
        name: senderName || 'Unknown',
        username: senderEmail || null,
      },
      content: body,
      attachments: (raw.attachments || []).map(a => ({
        filename: a.filename || a.name,
        size: a.size,
        contentType: a.contentType || a.mimeType,
      })),
      replyTo: raw.inReplyTo || null,
      timestamp: raw.date ? new Date(raw.date).getTime() : Date.now(),
    };
  }

  // ── Lifecycle ───────────────────────────────────────────

  /**
   * Start polling for new emails.
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
        const emails = await this.fetchEmails();
        this.processEmails(emails);
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
   * Fetch emails via IMAP proxy or Gmail API.
   * @returns {Promise<Array>}
   */
  async fetchEmails() {
    if (this.config.useGmailApi) {
      return this.#fetchGmailEmails();
    }
    return this.#fetchImapEmails();
  }

  async #fetchImapEmails() {
    try {
      // Uses wsh-based proxy endpoint for IMAP access
      const url = `${this.config.imapProtocol}${this.config.imapHost}/fetch`;
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Basic ${btoa(`${this.config.credentials.user}:${this.config.credentials.pass}`)}`,
        },
        body: JSON.stringify({
          folder: this.config.folder,
          unseen: true,
          limit: 20,
        }),
      });

      if (!res.ok) return [];
      const data = await res.json();
      return data.messages || [];
    } catch {
      return [];
    }
  }

  async #fetchGmailEmails() {
    try {
      const token = this.config.credentials.accessToken;
      const res = await fetch(`${GMAIL_API}/messages?q=is:unread&maxResults=20`, {
        headers: { 'Authorization': `Bearer ${token}` },
      });

      if (!res.ok) return [];
      const data = await res.json();

      // Fetch full message details for each
      const messages = data.messages || [];
      const emails = [];
      for (const msg of messages.slice(0, 10)) {
        try {
          const detail = await fetch(`${GMAIL_API}/messages/${msg.id}?format=full`, {
            headers: { 'Authorization': `Bearer ${token}` },
          });
          if (detail.ok) {
            const d = await detail.json();
            emails.push(this.#parseGmailMessage(d));
          }
        } catch { /* skip individual message errors */ }
      }

      return emails;
    } catch {
      return [];
    }
  }

  #parseGmailMessage(msg) {
    const headers = msg.payload?.headers || [];
    const getHeader = (name) => headers.find(h => h.name.toLowerCase() === name.toLowerCase())?.value || '';

    let body = '';
    if (msg.payload?.body?.data) {
      try { body = atob(msg.payload.body.data.replace(/-/g, '+').replace(/_/g, '/')); } catch { /* ignore */ }
    } else if (msg.payload?.parts) {
      const textPart = msg.payload.parts.find(p => p.mimeType === 'text/plain');
      if (textPart?.body?.data) {
        try { body = atob(textPart.body.data.replace(/-/g, '+').replace(/_/g, '/')); } catch { /* ignore */ }
      }
    }

    return {
      messageId: msg.id,
      from: getHeader('From'),
      subject: getHeader('Subject'),
      body,
      date: getHeader('Date') || new Date(parseInt(msg.internalDate, 10)).toISOString(),
    };
  }

  /**
   * Process an array of fetched emails.
   * Deduplicates by messageId and invokes callback for new messages.
   * @param {Array} emails
   */
  processEmails(emails) {
    if (!emails || emails.length === 0) return;

    for (const email of emails) {
      const id = email.messageId || `email_${Date.now()}_${Math.random()}`;

      // Skip already-seen messages
      if (this.#seenIds.has(id)) continue;
      this.#seenIds.add(id);

      // Prune seen IDs if too many
      if (this.#seenIds.size > this.config.maxSeenIds) {
        const arr = [...this.#seenIds];
        this.#seenIds = new Set(arr.slice(-Math.floor(this.config.maxSeenIds / 2)));
      }

      const msg = this.createInboundMessage(email);
      if (this._callback) {
        this._callback(msg);
      }
    }
  }

  // ── Outbound ────────────────────────────────────────────

  /**
   * Send an email via SMTP proxy or Gmail API.
   * @param {string} text — Email body
   * @param {object} [opts]
   * @param {string} opts.to — Recipient address
   * @param {string} [opts.subject='No Subject'] — Email subject
   * @param {string} [opts.from] — Sender address override
   * @returns {Promise<boolean>}
   */
  async sendMessage(text, opts = {}) {
    if (this.config.useGmailApi) {
      return this.#sendViaGmail(text, opts);
    }
    return this.#sendViaSmtp(text, opts);
  }

  async #sendViaSmtp(text, opts) {
    try {
      const url = `${this.config.smtpProtocol}${this.config.smtpHost}/send`;
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Basic ${btoa(`${this.config.credentials.user}:${this.config.credentials.pass}`)}`,
        },
        body: JSON.stringify({
          to: opts.to,
          from: opts.from || this.config.credentials.user,
          subject: opts.subject || 'No Subject',
          body: text,
        }),
      });

      return res.ok;
    } catch {
      return false;
    }
  }

  async #sendViaGmail(text, opts) {
    try {
      const to = opts.to;
      const subject = opts.subject || 'No Subject';
      const from = opts.from || this.config.credentials.user;

      // Build RFC 2822 message
      const rawMessage = [
        `From: ${from}`,
        `To: ${to}`,
        `Subject: ${subject}`,
        'Content-Type: text/plain; charset=utf-8',
        '',
        text,
      ].join('\r\n');

      // Base64url encode
      const encoded = btoa(rawMessage).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

      const token = this.config.credentials.accessToken;
      const res = await fetch(`${GMAIL_API}/messages/send`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify({ raw: encoded }),
      });

      return res.ok;
    } catch {
      return false;
    }
  }
}
