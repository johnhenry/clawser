// clawser-channel-irc.js — IRC Channel Plugin
//
// IRC over WebSocket with PING/PONG/PRIVMSG/JOIN/PART parser.
// Normalizes inbound messages via createInboundMessage().
// Config: server, channel, nick.

// ── IRC Message Parser ───────────────────────────────────────

/**
 * Parse a raw IRC protocol line into structured components.
 * Format: [:prefix] command [params...] [:trailing]
 * @param {string} line — Raw IRC line
 * @returns {{prefix: string, command: string, params: string[], trailing: string}}
 */
export function parseIrcMessage(line) {
  let prefix = '';
  let rest = line.trim();

  // Extract prefix (starts with :)
  if (rest.startsWith(':')) {
    const idx = rest.indexOf(' ');
    if (idx === -1) {
      return { prefix: rest.slice(1), command: '', params: [], trailing: '' };
    }
    prefix = rest.slice(1, idx);
    rest = rest.slice(idx + 1);
  }

  // Extract trailing (after ' :')
  let trailing = '';
  const trailingIdx = rest.indexOf(' :');
  if (trailingIdx !== -1) {
    trailing = rest.slice(trailingIdx + 2);
    rest = rest.slice(0, trailingIdx);
  }

  // Split remaining into command + params
  const parts = rest.split(' ').filter(Boolean);
  const command = parts[0] || '';
  const params = parts.slice(1);

  return { prefix, command, params, trailing };
}

// ── Helpers ──────────────────────────────────────────────────

/**
 * Extract nick from IRC prefix (nick!user@host).
 * @param {string} prefix
 * @returns {string}
 */
function extractNick(prefix) {
  if (!prefix) return 'unknown';
  const bangIdx = prefix.indexOf('!');
  return bangIdx > 0 ? prefix.slice(0, bangIdx) : prefix;
}

let ircMsgCounter = 0;

// ── IrcPlugin ────────────────────────────────────────────────

/**
 * IRC channel plugin using WebSocket transport.
 * Handles PING/PONG keepalive, PRIVMSG parsing, JOIN/PART commands.
 */
export class IrcPlugin {
  /** @type {object} */
  config;

  /** @type {boolean} */
  running = false;

  /** @type {Function|null} */
  _callback = null;

  /** @type {object|null} WebSocket connection */
  _ws = null;

  /** @type {boolean} Whether registration is complete */
  #registered = false;

  /** @type {string} Buffer for incomplete lines */
  #lineBuffer = '';

  /**
   * @param {object} opts
   * @param {string} opts.server — WebSocket IRC server URL (wss://...)
   * @param {string} opts.channel — IRC channel to join (e.g. #general)
   * @param {string} opts.nick — Bot nickname
   * @param {string} [opts.password=null] — Server or NickServ password
   * @param {string} [opts.realname='Clawser Bot'] — Real name field
   * @param {string} [opts.username='clawser'] — Username field
   */
  constructor(opts = {}) {
    this.config = {
      server: opts.server,
      channel: opts.channel,
      nick: opts.nick,
      password: opts.password || null,
      realname: opts.realname || 'Clawser Bot',
      username: opts.username || 'clawser',
    };
  }

  // ── Message normalization ───────────────────────────────

  /**
   * Normalize a parsed IRC message into standard inbound message format.
   * @param {object} raw — Parsed IRC message {prefix, command, params, trailing}
   * @returns {object} Standard InboundMessage
   */
  createInboundMessage(raw) {
    const nick = extractNick(raw.prefix);
    // params[0] is the target channel/user for PRIVMSG
    const ircChannel = (raw.params && raw.params[0]) || null;

    return {
      id: `irc_${Date.now()}_${++ircMsgCounter}`,
      channel: 'irc',
      channelId: ircChannel,
      sender: {
        id: raw.prefix || nick,
        name: nick,
        username: nick,
      },
      content: raw.trailing || '',
      attachments: [],
      replyTo: null,
      timestamp: Date.now(),
    };
  }

  // ── Lifecycle ───────────────────────────────────────────

  /**
   * Start the IRC connection via WebSocket.
   */
  start() {
    if (this.running) return;
    this.running = true;
    this.#connect();
  }

  /**
   * Stop the IRC connection.
   */
  stop() {
    if (!this.running) return;
    this.running = false;
    this.#registered = false;
    this.#lineBuffer = '';

    if (this._ws) {
      try {
        // Send QUIT before closing
        this.#send('QUIT :Goodbye');
        this._ws.close();
      } catch { /* ignore */ }
      this._ws = null;
    }
  }

  #connect() {
    if (!this.running) return;

    try {
      this._ws = new WebSocket(this.config.server);

      this._ws.onopen = () => {
        this.#register();
      };

      this._ws.onmessage = (event) => {
        const data = typeof event === 'string' ? event : (event.data || '');
        this.#handleData(data);
      };

      this._ws.onclose = () => {
        this.#registered = false;
        // Reconnect after delay if still running
        if (this.running) {
          setTimeout(() => this.#connect(), 5000);
        }
      };

      this._ws.onerror = () => { /* handled by onclose */ };
    } catch {
      if (this.running) {
        setTimeout(() => this.#connect(), 5000);
      }
    }
  }

  #register() {
    // Send PASS if configured
    if (this.config.password) {
      this.#send(`PASS ${this.config.password}`);
    }

    // Send NICK and USER
    this.#send(`NICK ${this.config.nick}`);
    this.#send(`USER ${this.config.username} 0 * :${this.config.realname}`);
  }

  #handleData(data) {
    // Buffer incomplete lines
    this.#lineBuffer += data;
    const lines = this.#lineBuffer.split('\r\n');
    // Keep last incomplete line in buffer
    this.#lineBuffer = lines.pop() || '';

    for (const line of lines) {
      if (line.trim()) {
        this.handleLine(line);
      }
    }
  }

  // ── IRC line processing ─────────────────────────────────

  /**
   * Handle a single IRC protocol line.
   * Public for testing — normally called via WebSocket data handler.
   * @param {string} line — Raw IRC line
   */
  handleLine(line) {
    const parsed = parseIrcMessage(line);

    switch (parsed.command) {
      case 'PING':
        // Respond with PONG to keep connection alive
        this.#send(`PONG :${parsed.trailing}`);
        break;

      case '001': // RPL_WELCOME — registration complete
        this.#registered = true;
        // Join configured channel
        this.#send(`JOIN ${this.config.channel}`);
        break;

      case 'PRIVMSG':
        this.#handlePrivmsg(parsed);
        break;

      case '433': // ERR_NICKNAMEINUSE
        // Append underscore and retry
        this.config.nick += '_';
        this.#send(`NICK ${this.config.nick}`);
        break;

      // JOIN, PART, QUIT, etc. — ignored for now
    }
  }

  #handlePrivmsg(parsed) {
    // Ignore messages from self
    const sender = extractNick(parsed.prefix);
    if (sender === this.config.nick) return;

    const msg = this.createInboundMessage(parsed);
    if (this._callback) {
      this._callback(msg);
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

  // ── Outbound ────────────────────────────────────────────

  /**
   * Send a PRIVMSG to a channel or user.
   * @param {string} text — Message text
   * @param {object} [opts]
   * @param {string} [opts.channel] — Override default channel
   * @returns {boolean}
   */
  sendMessage(text, opts = {}) {
    const target = opts.channel || this.config.channel;

    if (!this._ws || this._ws.readyState !== 1) {
      return false;
    }

    this.#send(`PRIVMSG ${target} :${text}`);
    return true;
  }

  /**
   * Join an IRC channel.
   * @param {string} channel — Channel name (e.g. #general)
   */
  join(channel) {
    this.#send(`JOIN ${channel}`);
  }

  /**
   * Leave an IRC channel.
   * @param {string} channel — Channel name
   * @param {string} [reason=''] — Part reason
   */
  part(channel, reason = '') {
    this.#send(`PART ${channel}${reason ? ` :${reason}` : ''}`);
  }

  /**
   * Send a raw IRC line.
   * @param {string} line
   */
  #send(line) {
    if (this._ws && this._ws.readyState === 1) {
      this._ws.send(`${line}\r\n`);
    }
  }
}
