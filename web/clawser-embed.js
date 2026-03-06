// clawser-embed.js — Embedding API
//
// EmbeddedPod: Drop-in class for embedding the Clawser agent into any web app.
// Extends Pod with container rendering, messaging, and lazy agent init.
// Re-exports as ClawserEmbed for backward compatibility.

import { Pod } from './packages/pod/src/pod.mjs'

// ── EmbeddedPod ────────────────────────────────────────────────

/**
 * Embeddable Clawser agent pod.
 * Provides a minimal API for integrating the agent into external web apps.
 * Extends Pod for identity, discovery, and peer messaging.
 */
export class EmbeddedPod extends Pod {
  #config

  /**
   * @param {object} [config]
   * @param {string} [config.containerId] - DOM element ID to render into
   * @param {string} [config.provider] - Default LLM provider
   * @param {string} [config.model] - Default model
   * @param {object} [config.tools] - Tool configuration overrides
   * @param {object} [config.theme] - UI theme overrides
   */
  constructor(config = {}) {
    super()
    this.#config = {
      containerId: config.containerId || 'clawser',
      provider: config.provider || null,
      model: config.model || null,
      tools: config.tools || {},
      theme: config.theme || {},
      ...config,
    }
  }

  get config() { return { ...this.#config } }

  /**
   * Send a message to the agent.
   * @param {string} text - User message
   * @param {object} [opts] - Options (streaming, model override, etc.)
   * @returns {Promise<{ content: string, toolCalls?: Array }>}
   */
  async sendMessage(text, opts = {}) {
    // In a real implementation, this would route to the agent
    return { content: '', toolCalls: [] }
  }

  _onMessage(msg) {
    // Subclass hook — forward pod messages to the event bus
  }
}

/** Backward-compatible alias */
export const ClawserEmbed = EmbeddedPod
