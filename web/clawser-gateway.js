// clawser-gateway.js — Channel Gateway
//
// Orchestrates channel plugins, WSH, and P2P mesh sessions into the agent.
// Inbound messages are queued per-channel (serialized) and fed to the agent.
// Responses are routed back to the originating channel.
//
// Scope modes:
//   'isolated'          — each channel gets a separate conversation context
//   'shared'            — all channels share the active conversation
//   'shared:group-name' — channels grouped into named shared conversations

import { createInboundMessage, formatForChannel } from './clawser-channels.js'

// ── Constants ────────────────────────────────────────────────────

/**
 * Enumerated scope modes for channel isolation.
 * Note: 'shared:group-name' is also valid at runtime (arbitrary group names).
 * @type {Readonly<{ISOLATED: 'isolated', SHARED: 'shared'}>}
 */
export const CHANNEL_SCOPES = Object.freeze({
  ISOLATED: 'isolated',
  SHARED: 'shared',
})

/**
 * Canonical badge colors for each channel type, used for UI rendering.
 * Kept in sync with CHANNEL_BADGE_COLORS in clawser-ui-chat.js.
 * @type {Readonly<Record<string, string>>}
 */
export const CHANNEL_COLORS = Object.freeze({
  telegram: '#2AABEE',
  discord: '#5865F2',
  slack: '#4A154B',
  email: '#EA4335',
  matrix: '#0DBD8B',
  irc: '#999999',
  relay: '#FF9800',
  wsh: '#FF6D00',
  mesh: '#00BCD4',
  dom: '#666666',
  ext: '#9C27B0',
  scheduler: '#7CB342',  // cron/routine lane (virtual channel, no plugin)
})

// ── Serialized Queue ─────────────────────────────────────────────

/**
 * Per-channel serialized task queue.
 * Tasks for the same channel run one at a time.
 * Tasks for different channels run concurrently.
 */
class ChannelQueue {
  /** @type {Map<string, Array<Function>>} channelId → pending tasks */
  #queues = new Map()

  /** @type {Set<string>} channels currently processing */
  #active = new Set()

  /**
   * Enqueue an async task for a channel.
   * @param {string} channelId
   * @param {Function} task — async () => any
   * @returns {Promise<any>} Resolves when the task completes
   */
  enqueue(channelId, task) {
    return new Promise((resolve, reject) => {
      if (!this.#queues.has(channelId)) {
        this.#queues.set(channelId, [])
      }
      this.#queues.get(channelId).push({ task, resolve, reject })
      this.#drain(channelId)
    })
  }

  /** Drain pending tasks for a channel, processing one at a time. */
  async #drain(channelId) {
    if (this.#active.has(channelId)) return
    const queue = this.#queues.get(channelId)
    if (!queue || queue.length === 0) return

    this.#active.add(channelId)
    while (queue.length > 0) {
      const { task, resolve, reject } = queue.shift()
      try {
        const result = await task()
        resolve(result)
      } catch (err) {
        reject(err)
      }
    }
    this.#active.delete(channelId)
    this.#queues.delete(channelId)
  }

  /** Number of channels with pending work. @returns {number} */
  get pendingChannels() { return this.#queues.size }

  /** Whether a specific channel is currently processing. @param {string} channelId @returns {boolean} */
  isProcessing(channelId) { return this.#active.has(channelId) }

  /** Clear all pending tasks. */
  clear() {
    this.#queues.clear()
    this.#active.clear()
  }
}

// ── Channel Gateway ──────────────────────────────────────────────

/**
 * Central gateway that connects channel plugins to the agent runtime.
 *
 * Lifecycle:
 *   1. register(channelId, plugin, config)  — register a channel
 *   2. start(channelId) or startAll()       — activate plugin + wire onMessage
 *   3. plugin fires onMessage → gateway.ingest()
 *   4. ingest() queues per-channel → agent.sendMessage() + agent.runStream()
 *   5. respond() routes agent response back to originating channel
 */
export class ChannelGateway {
  /** @type {object|null} ClawserAgent reference */
  #agent = null

  /** @type {Map<string, {plugin: object, config: object, scope: string}>} */
  #channels = new Map()

  /** @type {ChannelQueue} */
  #queue = new ChannelQueue()

  /** @type {Set<string>} Running channel IDs */
  #active = new Set()

  /** @type {Function|null} Called when a message is ingested */
  #onIngest = null

  /** @type {Function|null} Called when a response is sent */
  #onRespond = null

  /** @type {Function|null} Logging callback */
  #onLog = null

  /** @type {string|null} Default tenant ID for resource tracking */
  #tenantId = null

  /**
   * @param {object} opts
   * @param {object} opts.agent - ClawserAgent instance
   * @param {string} [opts.tenantId] - Default kernel tenant ID for resource tracking
   * @param {Function} [opts.onIngest] - (channelId, message) => void
   * @param {Function} [opts.onRespond] - (channelId, text) => void
   * @param {Function} [opts.onLog] - (msg) => void
   */
  constructor(opts = {}) {
    this.#agent = opts.agent || null
    this.#tenantId = opts.tenantId ?? null
    this.#onIngest = opts.onIngest || null
    this.#onRespond = opts.onRespond || null
    this.#onLog = opts.onLog || null
  }

  /** Set or replace the agent reference. @param {object|null} agent */
  setAgent(agent) { this.#agent = agent }

  /**
   * Set or replace the default tenant ID for all subsequent ingests.
   * Called on workspace switch to keep tenant context current.
   * Pass null to clear. Per-ingest overrides still take precedence.
   * @param {string|null} tenantId
   */
  setTenantId(tenantId) { this.#tenantId = tenantId ?? null }

  /** Get agent reference. @returns {object|null} */
  get agent() { return this.#agent }

  // ── Channel Registration ─────────────────────────────────

  /**
   * Register a channel plugin.
   * @param {string} channelId - Unique channel identifier (e.g., 'telegram', 'slack:general')
   * @param {object} plugin - Channel plugin with start/stop/onMessage/sendMessage
   * @param {object} [config] - Channel configuration
   * @param {string} [config.scope='shared'] - 'isolated' | 'shared' | 'shared:group-name'
   */
  register(channelId, plugin, config = {}) {
    if (this.#channels.has(channelId)) {
      this.stop(channelId)
    }
    this.#channels.set(channelId, {
      plugin,
      config: { scope: 'shared', ...config },
      scope: config.scope || 'shared',
    })
    this.#log(`Channel registered: ${channelId}`)
  }

  /**
   * Unregister a channel plugin.
   * @param {string} channelId
   * @returns {boolean}
   */
  unregister(channelId) {
    if (this.#active.has(channelId)) {
      this.stop(channelId)
    }
    const removed = this.#channels.delete(channelId)
    if (removed) this.#log(`Channel unregistered: ${channelId}`)
    return removed
  }

  /**
   * Get a registered channel entry.
   * @param {string} channelId
   * @returns {{plugin: object, config: object, scope: string}|undefined}
   */
  getChannel(channelId) {
    return this.#channels.get(channelId)
  }

  /**
   * List all registered channel IDs.
   * @returns {string[]}
   */
  listChannels() {
    return [...this.#channels.keys()]
  }

  /**
   * Get all registered channels with their status.
   * @returns {Array<{id: string, scope: string, active: boolean}>}
   */
  listChannelStatus() {
    return [...this.#channels.entries()].map(([id, entry]) => ({
      id,
      scope: entry.scope,
      active: this.#active.has(id),
    }))
  }

  // ── Channel Lifecycle ────────────────────────────────────

  /**
   * Start a channel plugin and wire its onMessage to gateway.ingest().
   * No-ops silently if channelId is unknown or already active.
   * @param {string} channelId
   */
  start(channelId) {
    const entry = this.#channels.get(channelId)
    if (!entry) {
      this.#log(`Cannot start unknown channel: ${channelId}`)
      return
    }
    if (this.#active.has(channelId)) return

    const { plugin } = entry

    // Wire inbound messages to gateway
    if (typeof plugin.onMessage === 'function') {
      plugin.onMessage((msg) => {
        this.ingest(msg, channelId)
      })
    }

    // Start the plugin (polling, WebSocket, etc.)
    if (typeof plugin.start === 'function') {
      plugin.start()
    }

    this.#active.add(channelId)
    this.#log(`Channel started: ${channelId}`)
  }

  /**
   * Stop a channel plugin. No-ops if not registered or not active.
   * @param {string} channelId
   */
  stop(channelId) {
    const entry = this.#channels.get(channelId)
    if (!entry) return
    if (!this.#active.has(channelId)) return

    if (typeof entry.plugin.stop === 'function') {
      entry.plugin.stop()
    }

    this.#active.delete(channelId)
    this.#log(`Channel stopped: ${channelId}`)
  }

  /** Start all registered channels. */
  startAll() {
    for (const channelId of this.#channels.keys()) {
      this.start(channelId)
    }
  }

  /** Stop all running channels. */
  stopAll() {
    for (const channelId of [...this.#active]) {
      this.stop(channelId)
    }
  }

  /** Whether a channel is running. @param {string} channelId @returns {boolean} */
  isActive(channelId) { return this.#active.has(channelId) }

  /** Number of running channels. @returns {number} */
  get activeCount() { return this.#active.size }

  /** Number of registered channels. @returns {number} */
  get channelCount() { return this.#channels.size }

  // ── Ingest ───────────────────────────────────────────────

  /**
   * Ingest an inbound message from any channel.
   * Normalizes, queues per-channel, and feeds the agent.
   *
   * @param {object} message - Raw or normalized inbound message
   * @param {string} channelId - Source channel identifier
   * @param {object} [opts] - Options
   * @param {string|null} [opts.tenantId] - Tenant ID override (defaults to gateway-level tenantId).
   *   Pass explicit null to clear; omit (undefined) to use the gateway default.
   * @returns {Promise<string>} Agent response text
   */
  async ingest(message, channelId, { tenantId } = {}) {
    if (!this.#agent) {
      this.#log('No agent available — dropping message')
      return ''
    }

    // Normalize if needed
    const msg = message.id && message.channel && message.sender
      ? message
      : createInboundMessage({ ...message, channel: channelId })

    // Notify listener
    if (this.#onIngest) {
      this.#onIngest(channelId, msg)
    }

    // Resolve tenant: explicit override (including null) > gateway default.
    // undefined means "not provided" → fall through to this.#tenantId.
    const resolvedTenant = tenantId !== undefined ? tenantId : this.#tenantId

    // Queue per-channel for serialized processing
    return this.#queue.enqueue(channelId, async () => {
      return this.#processMessage(msg, channelId, resolvedTenant)
    })
  }

  /**
   * Process a single message through the agent.
   * @param {object} msg - Normalized InboundMessage
   * @param {string} channelId - Source channel
   * @param {string|null} [tenantId] - Kernel tenant ID for resource tracking
   * @returns {Promise<string>} Agent response text
   */
  async #processMessage(msg, channelId, tenantId = null) {
    const entry = this.#channels.get(channelId)
    const scope = entry?.scope || 'shared'

    // Format message with channel context for the agent
    const agentText = `[${msg.channel}/${msg.sender.name}]: ${msg.content}`

    // Send to agent with source metadata + tenant context
    this.#agent.sendMessage(agentText, { source: channelId, tenantId })

    // Record in event log
    this.#agent.recordEvent('channel_inbound', {
      channelId,
      channel: msg.channel,
      sender: msg.sender,
      content: msg.content,
      tenantId,
    }, 'user')

    // Run agent and collect response
    let responseText = ''

    try {
      if (typeof this.#agent.runStream === 'function') {
        for await (const chunk of this.#agent.runStream()) {
          if (chunk.type === 'text') {
            responseText += chunk.text
          } else if (chunk.type === 'done') {
            if (chunk.response?.data) {
              responseText = chunk.response.data
            }
            break
          } else if (chunk.type === 'error') {
            responseText = `Error: ${chunk.error}`
            break
          }
        }
      } else {
        const result = await this.#agent.run()
        responseText = result.data || ''
      }
    } catch (err) {
      responseText = `Error processing message: ${err.message}`
      this.#log(`Agent error for ${channelId}: ${err.message}`)
    }

    // Route response back to originating channel
    if (responseText) {
      await this.respond(channelId, responseText, msg)
    }

    return responseText
  }

  // ── Respond ──────────────────────────────────────────────

  /**
   * Route an agent response back to the originating channel.
   * Always fires onRespond callback and records outbound event, even for
   * plugin-less virtual channels (e.g., scheduler). Only sends via plugin
   * when the channel is registered with one.
   * @param {string} channelId - Channel to respond to
   * @param {string} text - Response text
   * @param {object} [originalMsg] - Original inbound message (for reply targeting)
   * @returns {Promise<void>}
   */
  async respond(channelId, text, originalMsg = null) {
    const entry = this.#channels.get(channelId)

    // Send via plugin (if channel is registered with a plugin)
    if (entry) {
      const { plugin } = entry

      // Format for channel (Markdown → channel-specific markup)
      const formatted = formatForChannel(
        originalMsg?.channel || channelId,
        text,
      )

      if (typeof plugin.sendMessage === 'function') {
        try {
          const replyOpts = {}
          if (originalMsg?.channelId) {
            replyOpts.chatId = originalMsg.channelId
          }
          if (originalMsg?.id) {
            replyOpts.replyTo = originalMsg.id
          }
          await plugin.sendMessage(
            typeof formatted === 'string' ? formatted : formatted.body || text,
            replyOpts,
          )
        } catch (err) {
          this.#log(`Send error for ${channelId}: ${err.message}`)
        }
      }
    }

    // Record outbound event (always, even for plugin-less channels like scheduler)
    this.#agent?.recordEvent('channel_outbound', {
      channelId,
      content: text.slice(0, 500),
    }, 'agent')

    // Notify listener (always — UI display doesn't require a plugin)
    if (this.#onRespond) {
      this.#onRespond(channelId, text)
    }
  }

  // ── Cleanup ──────────────────────────────────────────────

  /** Stop all channels, clear registrations, and null out the agent reference. */
  destroy() {
    this.stopAll()
    this.#queue.clear()
    this.#channels.clear()
    this.#agent = null
    this.#log('Gateway destroyed')
  }

  // ── Internals ────────────────────────────────────────────

  #log(msg) {
    if (this.#onLog) this.#onLog(msg)
  }
}

// ── Exported helpers ─────────────────────────────────────────────

export { ChannelQueue }
