/**
 * clawser-fs-ui-sync.mjs — Phase 7: Bidirectional UI ↔ File Sync
 *
 * Bridges config files and UI panels so that:
 *   - When a config panel renders, it reads from the reactive config store
 *   - When the user saves in the UI, it writes to the config file
 *   - When a config file changes externally, the UI refreshes
 *
 * Uses ReactiveConfigStore from Phase 2 as the single source of truth.
 *
 * @module clawser-fs-ui-sync
 *
 * @example
 *   import { FsUiSync } from './clawser-fs-ui-sync.mjs';
 *   const sync = new FsUiSync(reactiveConfig);
 *   sync.registerPanel('autonomy', {
 *     render: (config) => renderAutonomyPanel(config),
 *     collect: () => collectAutonomyForm(),
 *   });
 *   await sync.save('autonomy');
 */

/**
 * @typedef {object} PanelBinding
 * @property {string} domain - Config domain name
 * @property {(config: *) => void} render - Render/refresh the panel with config data
 * @property {() => *} collect - Collect current form values from the panel DOM
 * @property {() => void} [unsub] - Unsubscribe function from reactive store
 */

/**
 * Bidirectional sync layer between config files and UI panels.
 * Each panel is registered with a domain name matching a ReactiveConfigStore domain.
 */
export class FsUiSync {
  /** @type {import('./clawser-reactive-config.mjs').ReactiveConfigStore} */
  #store;

  /** @type {Map<string, PanelBinding>} domain → binding */
  #panels = new Map();

  /** @type {Set<(event: {domain: string, action: string, config?: *}) => void>} */
  #listeners = new Set();

  /** @type {boolean} Suppresses re-render during save to avoid loops */
  #saving = false;

  /**
   * @param {import('./clawser-reactive-config.mjs').ReactiveConfigStore} reactiveConfig
   *
   * @example
   *   const sync = new FsUiSync(reactiveConfig);
   */
  constructor(reactiveConfig) {
    this.#store = reactiveConfig;
  }

  /**
   * Register a UI panel for bidirectional sync with a config domain.
   *
   * @param {string} domain - Config domain (must be registered in ReactiveConfigStore)
   * @param {object} binding
   * @param {(config: *) => void} binding.render - Called to render/refresh the panel
   * @param {() => *} binding.collect - Called to collect form values from the panel
   * @returns {() => void} Unregister function
   *
   * @example
   *   sync.registerPanel('autonomy', {
   *     render: (config) => {
   *       document.getElementById('autonomyLevel').value = config?.level || 'supervised';
   *     },
   *     collect: () => ({
   *       level: document.getElementById('autonomyLevel').value,
   *     }),
   *   });
   */
  registerPanel(domain, { render, collect }) {
    // Subscribe to config changes from the reactive store
    const unsub = this.#store.subscribe(domain, (event) => {
      if (this.#saving) return; // suppress re-render during our own save
      try {
        render(event.newValue);
        this.#notify({ domain, action: 'refresh', config: event.newValue });
      } catch (e) {
        console.error(`[FsUiSync] Error rendering panel ${domain}:`, e);
      }
    });

    const binding = { domain, render, collect, unsub };
    this.#panels.set(domain, binding);

    return () => this.unregisterPanel(domain);
  }

  /**
   * Unregister a panel binding and stop listening for changes.
   * @param {string} domain
   */
  unregisterPanel(domain) {
    const binding = this.#panels.get(domain);
    if (binding?.unsub) binding.unsub();
    this.#panels.delete(domain);
  }

  /**
   * Load config from the store and render a panel.
   * Call this when a panel is first shown / mounted.
   *
   * @param {string} domain
   * @returns {Promise<*>} The loaded config
   *
   * @example
   *   const config = await sync.load('autonomy');
   */
  async load(domain) {
    const binding = this.#panels.get(domain);
    if (!binding) {
      console.warn(`[FsUiSync] No panel registered for domain: ${domain}`);
      return null;
    }

    // Try cached value first, fall back to disk read
    let config = this.#store.get(domain);
    if (config == null) {
      config = await this.#store.readFromDisk(domain);
    }

    try {
      binding.render(config);
      this.#notify({ domain, action: 'load', config });
    } catch (e) {
      console.error(`[FsUiSync] Error loading panel ${domain}:`, e);
    }

    return config;
  }

  /**
   * Collect form values from the panel and write to the config file.
   *
   * @param {string} domain
   * @returns {Promise<*>} The saved config value
   *
   * @example
   *   await sync.save('autonomy');
   */
  async save(domain) {
    const binding = this.#panels.get(domain);
    if (!binding) {
      console.warn(`[FsUiSync] No panel registered for domain: ${domain}`);
      return null;
    }

    const value = binding.collect();
    if (value == null) return null;

    this.#saving = true;
    try {
      await this.#store.set(domain, value);
      this.#notify({ domain, action: 'save', config: value });
      return value;
    } finally {
      this.#saving = false;
    }
  }

  /**
   * Save an explicit value (not collected from form) to the config file.
   *
   * @param {string} domain
   * @param {*} value
   * @returns {Promise<void>}
   *
   * @example
   *   await sync.saveValue('autonomy', { level: 'full' });
   */
  async saveValue(domain, value) {
    this.#saving = true;
    try {
      await this.#store.set(domain, value);
      this.#notify({ domain, action: 'save', config: value });
    } finally {
      this.#saving = false;
    }
  }

  /**
   * Get the current config for a domain (synchronous, from cache).
   * @param {string} domain
   * @returns {*}
   */
  get(domain) {
    return this.#store.get(domain);
  }

  /**
   * Subscribe to sync events (load, save, refresh).
   * @param {(event: {domain: string, action: string, config?: *}) => void} callback
   * @returns {() => void} Unsubscribe function
   */
  subscribe(callback) {
    this.#listeners.add(callback);
    return () => this.#listeners.delete(callback);
  }

  /**
   * List all registered panel domains.
   * @returns {string[]}
   */
  listPanels() {
    return [...this.#panels.keys()];
  }

  /**
   * Destroy all bindings and subscriptions.
   */
  destroy() {
    for (const [, binding] of this.#panels) {
      if (binding.unsub) binding.unsub();
    }
    this.#panels.clear();
    this.#listeners.clear();
  }

  // ── Private ─────────────────────────────────────────────────────

  #notify(event) {
    for (const cb of this.#listeners) {
      try { cb(event); } catch { /* swallow */ }
    }
  }
}

/**
 * Wire standard config panels to FsUiSync.
 * Called during workspace init after ReactiveConfigStore is ready.
 *
 * @param {FsUiSync} sync
 * @param {object} panelHandlers - Map of domain → { render, collect }
 *
 * @example
 *   wireDefaultPanels(sync, {
 *     autonomy: {
 *       render: renderAutonomySection,
 *       collect: collectAutonomySettings,
 *     },
 *   });
 */
export const wireDefaultPanels = (sync, panelHandlers) => {
  for (const [domain, handler] of Object.entries(panelHandlers)) {
    sync.registerPanel(domain, handler);
  }
};
