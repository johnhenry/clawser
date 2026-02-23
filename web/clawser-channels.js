// clawser-channels.js — Multi-Channel Input
//
// InboundMessage: normalized message format from any channel
// ChannelConfig: per-channel allowlist configuration
// ChannelManager: browser-side channel management via bridge WebSocket
// Agent tools: channel_list, channel_send, channel_history

import { BrowserTool } from './clawser-tools.js';

// ── Constants ───────────────────────────────────────────────────

export const CHANNEL_TYPES = Object.freeze({
  WEBHOOK: 'webhook',
  TELEGRAM: 'telegram',
  DISCORD: 'discord',
  SLACK: 'slack',
  MATRIX: 'matrix',
  EMAIL: 'email',
  IRC: 'irc',
});

// ── Inbound Message ─────────────────────────────────────────────

let messageCounter = 0;

/** Reset counter (for testing). */
export function resetMessageCounter() {
  messageCounter = 0;
}

/**
 * Create a normalized inbound message.
 * @param {object} opts
 * @returns {object}
 */
export function createInboundMessage(opts = {}) {
  return {
    id: opts.id || `msg_${++messageCounter}`,
    channel: opts.channel || 'webhook',
    channelId: opts.channelId || null,
    sender: {
      id: opts.sender?.id || 'unknown',
      name: opts.sender?.name || 'Unknown',
      username: opts.sender?.username || null,
    },
    content: opts.content || '',
    attachments: opts.attachments || [],
    replyTo: opts.replyTo || null,
    timestamp: opts.timestamp || Date.now(),
  };
}

// ── Channel Config ──────────────────────────────────────────────

/**
 * Create a channel configuration with allowlists.
 * @param {object} opts
 * @returns {object}
 */
export function createChannelConfig(opts = {}) {
  return {
    name: opts.name || 'unknown',
    enabled: opts.enabled !== false,
    allowedUsers: opts.allowedUsers || [],
    allowedChannels: opts.allowedChannels || [],
    secret: opts.secret || null,
  };
}

/**
 * Check if a message is allowed by channel config.
 * @param {object} config - Channel config
 * @param {object} message - Inbound message
 * @returns {boolean}
 */
export function isMessageAllowed(config, message) {
  if (!config.enabled) return false;

  // If allowedUsers is set, check sender
  if (config.allowedUsers.length > 0) {
    const senderId = message.sender?.id || '';
    const senderUsername = message.sender?.username || '';
    const allowed = config.allowedUsers.some(u =>
      u === senderId || u === senderUsername
    );
    if (!allowed) return false;
  }

  // If allowedChannels is set, check channelId
  if (config.allowedChannels.length > 0) {
    if (!config.allowedChannels.includes(message.channelId)) return false;
  }

  return true;
}

// ── Outbound Formatting ─────────────────────────────────────────

/**
 * Format a message for a specific channel.
 * @param {string} channel
 * @param {string} message
 * @returns {string|object}
 */
export function formatForChannel(channel, message) {
  switch (channel) {
    case CHANNEL_TYPES.TELEGRAM:
      // Telegram uses HTML subset: bold → <b>, italic → <i>, code → <code>
      return message
        .replace(/\*\*(.+?)\*\*/g, '<b>$1</b>')
        .replace(/_(.+?)_/g, '<i>$1</i>')
        .replace(/`(.+?)`/g, '<code>$1</code>');
    case CHANNEL_TYPES.DISCORD:
      // Discord markdown is close to regular markdown, pass through
      return message;
    case CHANNEL_TYPES.SLACK:
      // Slack mrkdwn: bold → *text*, italic → _text_, code → `text`
      return message
        .replace(/\*\*(.+?)\*\*/g, '*$1*');
    case CHANNEL_TYPES.EMAIL:
      // Extract first line as subject
      const lines = message.split('\n');
      return { subject: lines[0].slice(0, 100), body: message };
    default:
      return message;
  }
}

// ── ChannelManager ──────────────────────────────────────────────

/**
 * Browser-side manager for multi-channel communication via bridge.
 */
export class ChannelManager {
  /** @type {Map<string, object>} channel name → config */
  #configs = new Map();

  /** @type {object|null} WebSocket connection (or mock) */
  #ws = null;

  /** @type {Array<object>} Message history */
  #history = [];

  /** @type {number} Max history entries */
  #maxHistory;

  /** @type {Function|null} */
  #onMessage;

  /** @type {Function|null} */
  #onLog;

  /** @type {boolean} */
  #connected = false;

  /**
   * @param {object} [opts]
   * @param {Function} [opts.onMessage] - (message: InboundMessage) => void
   * @param {Function} [opts.onLog] - (msg: string) => void
   * @param {number} [opts.maxHistory=200]
   * @param {Function} [opts.createWs] - (url) => WebSocket — injectable for testing
   */
  constructor(opts = {}) {
    this.#onMessage = opts.onMessage || null;
    this.#onLog = opts.onLog || null;
    this.#maxHistory = opts.maxHistory || 200;
    this._createWs = opts.createWs || null;
  }

  /** Whether connected to bridge WebSocket. */
  get connected() { return this.#connected; }

  /** Number of configured channels. */
  get channelCount() { return this.#configs.size; }

  // ── Configuration ─────────────────────────────────────

  /**
   * Add or update a channel configuration.
   * @param {object} config
   */
  addChannel(config) {
    const cfg = createChannelConfig(config);
    this.#configs.set(cfg.name, cfg);
    this.#log(`Channel configured: ${cfg.name}`);
  }

  /**
   * Remove a channel configuration.
   * @param {string} name
   * @returns {boolean}
   */
  removeChannel(name) {
    return this.#configs.delete(name);
  }

  /**
   * Get channel configuration.
   * @param {string} name
   * @returns {object|undefined}
   */
  getChannel(name) {
    return this.#configs.get(name);
  }

  /**
   * List all channel configurations.
   * @returns {Array<object>}
   */
  listChannels() {
    return [...this.#configs.values()];
  }

  // ── Connection ────────────────────────────────────────

  /**
   * Connect to bridge WebSocket.
   * @param {string} url - Bridge WebSocket URL
   */
  connect(url) {
    if (this._createWs) {
      this.#ws = this._createWs(url);
    } else if (typeof WebSocket !== 'undefined') {
      this.#ws = new WebSocket(url);
    } else {
      throw new Error('WebSocket not available');
    }

    this.#ws.onopen = () => {
      this.#connected = true;
      this.#log('Connected to bridge');
    };

    this.#ws.onmessage = (event) => {
      try {
        const data = typeof event.data === 'string' ? JSON.parse(event.data) : event.data;
        this.#handleInbound(data);
      } catch (e) {
        this.#log(`Parse error: ${e.message}`);
      }
    };

    this.#ws.onclose = () => {
      this.#connected = false;
      this.#log('Disconnected from bridge');
    };

    this.#ws.onerror = (err) => {
      this.#log(`WebSocket error: ${err?.message || 'unknown'}`);
    };
  }

  /**
   * Disconnect from bridge.
   */
  disconnect() {
    if (this.#ws) {
      try { this.#ws.close(); } catch {}
      this.#ws = null;
    }
    this.#connected = false;
  }

  /**
   * Handle an inbound message directly (for testing or non-WebSocket usage).
   * @param {object} raw
   */
  handleInbound(raw) {
    this.#handleInbound(raw);
  }

  #handleInbound(raw) {
    const msg = createInboundMessage(raw);

    // Check allowlist
    const config = this.#configs.get(msg.channel);
    if (config && !isMessageAllowed(config, msg)) {
      this.#log(`Blocked message from ${msg.channel}/${msg.sender.name} (not allowed)`);
      return;
    }

    // Store in history
    this.#history.push(msg);
    if (this.#history.length > this.#maxHistory) {
      this.#history = this.#history.slice(-this.#maxHistory);
    }

    // Forward to handler
    if (this.#onMessage) {
      this.#onMessage(msg);
    }
  }

  // ── Outbound ──────────────────────────────────────────

  /**
   * Send a message to a channel via bridge.
   * @param {string} channel
   * @param {string} channelId
   * @param {string} message
   * @returns {boolean} Whether send was attempted
   */
  send(channel, channelId, message) {
    if (!this.#ws || !this.#connected) return false;

    const formatted = formatForChannel(channel, message);
    const payload = {
      type: 'send',
      channel,
      channelId,
      message: formatted,
    };

    try {
      this.#ws.send(JSON.stringify(payload));
      this.#log(`Sent to ${channel}/${channelId}`);
      return true;
    } catch (e) {
      this.#log(`Send error: ${e.message}`);
      return false;
    }
  }

  // ── History ───────────────────────────────────────────

  /**
   * Get recent messages, optionally filtered by channel.
   * @param {object} [opts]
   * @param {string} [opts.channel]
   * @param {number} [opts.limit=20]
   * @returns {Array<object>}
   */
  getHistory(opts = {}) {
    let msgs = this.#history;
    if (opts.channel) {
      msgs = msgs.filter(m => m.channel === opts.channel);
    }
    return msgs.slice(-(opts.limit || 20));
  }

  /**
   * Format a message for agent context.
   * @param {object} msg - InboundMessage
   * @returns {string}
   */
  formatForAgent(msg) {
    return `[${msg.channel}/${msg.sender.name}]: ${msg.content}`;
  }

  /**
   * Build a system prompt section describing connected channels.
   * @returns {string}
   */
  buildPrompt() {
    const channels = this.listChannels();
    if (channels.length === 0) return '';
    const lines = channels.map(c =>
      `  ${c.name}: ${c.enabled ? 'enabled' : 'disabled'}`
    );
    return `Multi-channel input:\n${lines.join('\n')}`;
  }

  #log(msg) {
    if (this.#onLog) this.#onLog(msg);
  }
}

// ── Agent Tools ─────────────────────────────────────────────────

export class ChannelListTool extends BrowserTool {
  #manager;

  constructor(manager) {
    super();
    this.#manager = manager;
  }

  get name() { return 'channel_list'; }
  get description() { return 'List connected channels and their status.'; }
  get parameters() { return { type: 'object', properties: {} }; }
  get permission() { return 'read'; }

  async execute() {
    const channels = this.#manager.listChannels();
    if (channels.length === 0) {
      return { success: true, output: 'No channels configured.' };
    }
    const lines = channels.map(c => {
      const users = c.allowedUsers.length > 0
        ? `users: ${c.allowedUsers.join(', ')}`
        : 'users: any';
      return `${c.name} | ${c.enabled ? 'enabled' : 'disabled'} | ${users}`;
    });
    return {
      success: true,
      output: `Channels (${channels.length}), bridge: ${this.#manager.connected ? 'connected' : 'disconnected'}\n${lines.join('\n')}`,
    };
  }
}

export class ChannelSendTool extends BrowserTool {
  #manager;

  constructor(manager) {
    super();
    this.#manager = manager;
  }

  get name() { return 'channel_send'; }
  get description() { return 'Send a message to a specific channel.'; }
  get parameters() {
    return {
      type: 'object',
      properties: {
        channel: { type: 'string', description: 'Channel name (telegram, discord, slack, etc.)' },
        channel_id: { type: 'string', description: 'Specific conversation/room ID' },
        message: { type: 'string', description: 'Message to send' },
      },
      required: ['channel', 'channel_id', 'message'],
    };
  }
  get permission() { return 'approve'; }

  async execute({ channel, channel_id, message }) {
    const ok = this.#manager.send(channel, channel_id, message);
    if (ok) {
      return { success: true, output: `Sent to ${channel}/${channel_id}` };
    }
    return { success: false, output: '', error: 'Not connected to bridge or send failed' };
  }
}

export class ChannelHistoryTool extends BrowserTool {
  #manager;

  constructor(manager) {
    super();
    this.#manager = manager;
  }

  get name() { return 'channel_history'; }
  get description() { return 'Recent messages from a channel.'; }
  get parameters() {
    return {
      type: 'object',
      properties: {
        channel: { type: 'string', description: 'Channel name to filter by' },
        limit: { type: 'number', description: 'Number of messages (default 20)' },
      },
    };
  }
  get permission() { return 'read'; }

  async execute({ channel, limit } = {}) {
    const msgs = this.#manager.getHistory({ channel, limit: limit || 20 });
    if (msgs.length === 0) {
      return { success: true, output: channel ? `No messages from ${channel}.` : 'No messages.' };
    }
    const lines = msgs.map(m =>
      `[${new Date(m.timestamp).toISOString().slice(11, 19)}] ${m.channel}/${m.sender.name}: ${m.content}`
    );
    return { success: true, output: lines.join('\n') };
  }
}
