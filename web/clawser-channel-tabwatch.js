// clawser-channel-tabwatch.js — Tab Watcher Channel Plugin
//
// Monitors a browser tab's DOM for new messages using the Chrome Extension's
// tab_watch_start/poll/stop actions. Implements the channel plugin interface
// (start/stop/onMessage/sendMessage) for integration with ChannelGateway.
//
// Site profiles provide pre-built selectors for Slack, Gmail, Discord.
// Custom mode allows user-specified selectors.
//
// Run tests:
//   node --import ./web/test/_setup-globals.mjs --test web/test/clawser-channel-tabwatch.test.mjs

// ── Site Profiles ────────────────────────────────────────────────

export const SITE_PROFILES = Object.freeze({
  slack: {
    name: 'Slack',
    containerSelector: '[data-qa="slack_kit_list"]',
    messageSelector: '[data-qa="virtual-list-item"]',
    senderSelector: '[data-qa="message_sender_name"]',
    inputSelector: '[data-qa="message_input"] [contenteditable]',
    sendMethod: 'enter',
  },
  gmail: {
    name: 'Gmail',
    containerSelector: 'table.F.cf.zt',
    messageSelector: 'tr.zA',
    senderSelector: '.yW .yP, .yW .zF',
    inputSelector: '.Am.Al.editable',
    sendMethod: 'ctrl+enter',
  },
  discord: {
    name: 'Discord',
    containerSelector: 'ol[data-list-id="chat-messages"]',
    messageSelector: 'li[id^="chat-messages-"]',
    senderSelector: 'h3 span[class*="username"]',
    inputSelector: 'div[role="textbox"]',
    sendMethod: 'enter',
  },
})

// ── TabWatcherPlugin ─────────────────────────────────────────────

/**
 * Channel plugin that monitors a browser tab's DOM for new messages.
 * Uses the Chrome Extension's tab_watch_* actions via an RPC client.
 *
 * Implements the channel plugin interface:
 *   start()                 — inject observer + begin polling
 *   stop()                  — stop polling + remove observer
 *   onMessage(callback)     — register inbound message callback
 *   sendMessage(text, opts) — type response into the web UI
 */
export class TabWatcherPlugin {
  /** @type {number} Chrome tab ID */
  #tabId

  /** @type {string|null} Site profile key */
  #siteProfile

  /** @type {string|null} Custom container selector */
  #selector

  /** @type {object} RPC client with .call(action, params) */
  #rpc

  /** @type {number} Polling interval in ms */
  #pollInterval

  /** @type {number|null} Polling timer */
  #pollTimer = null

  /** @type {boolean} */
  running = false

  /** @type {Function|null} */
  _callback = null

  /**
   * @param {object} opts
   * @param {number} opts.tabId — Chrome tab ID to watch
   * @param {object} opts.rpc — Extension RPC client
   * @param {string} [opts.siteProfile] — 'slack' | 'gmail' | 'discord'
   * @param {string} [opts.selector] — Custom container CSS selector
   * @param {number} [opts.pollInterval=5000] — Polling interval in ms
   */
  constructor(opts = {}) {
    if (!opts.tabId) throw new Error('tabId is required')
    if (!opts.rpc) throw new Error('rpc client is required')

    this.#tabId = opts.tabId
    this.#rpc = opts.rpc
    this.#siteProfile = opts.siteProfile || null
    this.#selector = opts.selector || null
    this.#pollInterval = opts.pollInterval || 5000
  }

  /** Chrome tab ID being watched. */
  get tabId() { return this.#tabId }

  /** Site profile key. */
  get siteProfile() { return this.#siteProfile }

  // ── Lifecycle ─────────────────────────────────────────────

  /**
   * Start watching the tab — inject MutationObserver and begin polling.
   */
  async start() {
    if (this.running) return

    const params = { tabId: this.#tabId }
    if (this.#siteProfile) {
      params.siteProfile = this.#siteProfile
    } else if (this.#selector) {
      params.selector = this.#selector
    } else {
      throw new Error('Either siteProfile or selector is required')
    }

    await this.#rpc.call('tab_watch_start', params)
    this.running = true
    this.#startPolling()
  }

  /**
   * Stop watching — clear poll timer and remove observer.
   */
  async stop() {
    if (!this.running) return

    this.running = false
    if (this.#pollTimer) {
      clearTimeout(this.#pollTimer)
      this.#pollTimer = null
    }

    try {
      await this.#rpc.call('tab_watch_stop', { tabId: this.#tabId })
    } catch {
      // Tab may already be closed
    }
  }

  // ── Inbound ───────────────────────────────────────────────

  /**
   * Register a callback for inbound messages.
   * @param {Function} callback — (msg: InboundMessage) => void
   */
  onMessage(callback) {
    this._callback = callback
  }

  // ── Outbound ──────────────────────────────────────────────

  /**
   * Send a message by typing into the web UI's input field.
   * Uses ext_type + ext_key to enter text and submit.
   *
   * @param {string} text — Message text to send
   * @param {object} [opts]
   * @returns {Promise<boolean>}
   */
  async sendMessage(text, opts = {}) {
    const profile = this.#siteProfile ? SITE_PROFILES[this.#siteProfile] : null
    const inputSelector = profile?.inputSelector || opts.inputSelector
    const sendMethod = profile?.sendMethod || opts.sendMethod || 'enter'

    if (!inputSelector) return false

    try {
      // Focus and type into the input
      await this.#rpc.call('type', {
        tabId: this.#tabId,
        selector: inputSelector,
        text,
        submit: false,
      })

      // Send via the appropriate method
      if (sendMethod === 'enter') {
        await this.#rpc.call('key', { tabId: this.#tabId, key: 'Enter' })
      } else if (sendMethod === 'ctrl+enter') {
        await this.#rpc.call('key', { tabId: this.#tabId, key: 'ctrl+Enter' })
      }

      return true
    } catch {
      return false
    }
  }

  // ── Polling ───────────────────────────────────────────────

  #startPolling() {
    if (!this.running) return

    this.#pollTimer = setTimeout(async () => {
      try {
        const result = await this.#rpc.call('tab_watch_poll', { tabId: this.#tabId })
        const messages = result?.messages || []

        for (const raw of messages) {
          if (this._callback) {
            this._callback(this.#normalizeMessage(raw))
          }
        }
      } catch {
        // Poll error — retry next interval
      }

      this.#startPolling()
    }, this.#pollInterval)
  }

  /**
   * Normalize a raw polled message into standard InboundMessage format.
   * @param {object} raw — { text, sender, timestamp }
   * @returns {object} InboundMessage
   */
  #normalizeMessage(raw) {
    const profileName = this.#siteProfile || 'tabwatch'
    return {
      id: `tw_${this.#tabId}_${raw.timestamp || Date.now()}`,
      channel: `ext:${profileName}`,
      channelId: String(this.#tabId),
      sender: {
        id: raw.sender || 'unknown',
        name: raw.sender || 'Unknown',
        username: null,
      },
      content: raw.text || '',
      attachments: [],
      replyTo: null,
      timestamp: raw.timestamp || Date.now(),
    }
  }

  // ── Serialization ─────────────────────────────────────────

  toJSON() {
    return {
      tabId: this.#tabId,
      siteProfile: this.#siteProfile,
      selector: this.#selector,
      pollInterval: this.#pollInterval,
      running: this.running,
    }
  }
}
