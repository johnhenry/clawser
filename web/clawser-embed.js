// clawser-embed.js — Embedding API
//
// ClawserEmbed: Drop-in class for embedding the Clawser agent into any web app.
// Provides a simple event-driven API for messaging and lifecycle.

// ── ClawserEmbed ────────────────────────────────────────────────

/**
 * Embeddable Clawser agent interface.
 * Provides a minimal API for integrating the agent into external web apps.
 */
export class ClawserEmbed {
  #config;
  #listeners = new Map();

  /**
   * @param {object} config
   * @param {string} config.containerId - DOM element ID to render into
   * @param {string} [config.provider] - Default LLM provider
   * @param {string} [config.model] - Default model
   * @param {object} [config.tools] - Tool configuration overrides
   * @param {object} [config.theme] - UI theme overrides
   */
  constructor(config = {}) {
    this.#config = {
      containerId: config.containerId || 'clawser',
      provider: config.provider || null,
      model: config.model || null,
      tools: config.tools || {},
      theme: config.theme || {},
      ...config,
    };
  }

  get config() { return { ...this.#config }; }

  /**
   * Send a message to the agent.
   * @param {string} text - User message
   * @param {object} [opts] - Options (streaming, model override, etc.)
   * @returns {Promise<{ content: string, toolCalls?: Array }>}
   */
  async sendMessage(text, opts = {}) {
    this.emit('message_sent', { text, ...opts });
    // In a real implementation, this would route to the agent
    return { content: '', toolCalls: [] };
  }

  /**
   * Register an event listener.
   * @param {string} event - Event name
   * @param {Function} fn - Callback
   */
  on(event, fn) {
    if (!this.#listeners.has(event)) this.#listeners.set(event, []);
    this.#listeners.get(event).push(fn);
  }

  /**
   * Remove an event listener.
   * @param {string} event - Event name
   * @param {Function} fn - Callback to remove
   */
  off(event, fn) {
    const listeners = this.#listeners.get(event);
    if (!listeners) return;
    const idx = listeners.indexOf(fn);
    if (idx !== -1) listeners.splice(idx, 1);
  }

  /**
   * Emit an event to all registered listeners.
   * @param {string} event - Event name
   * @param {*} data - Event data
   */
  emit(event, data) {
    const listeners = this.#listeners.get(event);
    if (!listeners) return;
    for (const fn of listeners) {
      fn(data);
    }
  }
}
