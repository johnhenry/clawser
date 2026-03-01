// clawser-plugins.js — Plugin API
//
// PluginLoader: formal extension point for third-party tools and behaviors.
// Plugins can register tools, hooks, and providers with the agent.

// ── PluginLoader ────────────────────────────────────────────────

/**
 * Manages third-party plugin registration and lifecycle.
 *
 * This is an intentional extension point for future plugins. Third-party code
 * can register tools, hooks, and providers through this loader without
 * modifying core agent source. The class is deliberately minimal today —
 * it will grow as the plugin API stabilises.
 */
export class PluginLoader {
  /** @type {Map<string, object>} name → plugin descriptor */
  #plugins = new Map();

  /**
   * Register a plugin.
   * @param {object} plugin
   * @param {string} plugin.name - Unique plugin name
   * @param {string} plugin.version - Semver version
   * @param {Array} [plugin.tools] - Tool definitions to register
   * @param {object} [plugin.hooks] - Hook callbacks { beforeOutbound, onSessionStart, etc. }
   * @param {object} [plugin.metadata] - Additional metadata
   * @throws {Error} If a plugin with the same name is already registered
   */
  register(plugin) {
    if (!plugin || !plugin.name) throw new Error('Plugin must have a name');
    if (this.#plugins.has(plugin.name)) {
      throw new Error(`Plugin "${plugin.name}" is already registered`);
    }
    this.#plugins.set(plugin.name, {
      name: plugin.name,
      version: plugin.version || '0.0.0',
      tools: plugin.tools || [],
      hooks: plugin.hooks || {},
      metadata: plugin.metadata || {},
      enabled: true,
      registeredAt: Date.now(),
    });
  }

  /**
   * Unregister a plugin by name.
   * @param {string} name
   * @returns {boolean} True if the plugin was found and removed
   */
  unregister(name) {
    return this.#plugins.delete(name);
  }

  /**
   * List all registered plugins.
   * @returns {Array<{ name: string, version: string, toolCount: number }>}
   */
  list() {
    return [...this.#plugins.values()].map(p => ({
      name: p.name,
      version: p.version,
      toolCount: p.tools.length,
    }));
  }

  /**
   * Get a plugin by name.
   * @param {string} name
   * @returns {object|null}
   */
  get(name) {
    return this.#plugins.get(name) || null;
  }

  /**
   * Get all tools from all registered plugins.
   * @returns {Array<object>}
   */
  getTools() {
    const tools = [];
    for (const plugin of this.#plugins.values()) {
      if (plugin.enabled === false) continue;
      for (const tool of plugin.tools) {
        tools.push({ ...tool, _plugin: plugin.name });
      }
    }
    return tools;
  }

  /**
   * Get all hooks from all registered plugins.
   * @returns {Object<string, Array<Function>>}
   */
  getHooks() {
    const hooks = {};
    for (const plugin of this.#plugins.values()) {
      if (plugin.enabled === false) continue;
      for (const [hookName, fn] of Object.entries(plugin.hooks)) {
        if (!hooks[hookName]) hooks[hookName] = [];
        hooks[hookName].push(fn);
      }
    }
    return hooks;
  }

  /**
   * Enable a plugin by name.
   * @param {string} name
   * @returns {boolean} True if the plugin was found
   */
  enable(name) {
    const plugin = this.#plugins.get(name);
    if (!plugin) return false;
    plugin.enabled = true;
    return true;
  }

  /**
   * Disable a plugin by name (keeps it registered but excludes from getTools/getHooks).
   * @param {string} name
   * @returns {boolean} True if the plugin was found
   */
  disable(name) {
    const plugin = this.#plugins.get(name);
    if (!plugin) return false;
    plugin.enabled = false;
    return true;
  }

  /** Number of registered plugins */
  get size() { return this.#plugins.size; }
}
