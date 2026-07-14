/**
 * clawser-reactive-config.mjs — Reactive config store backed by OPFS file watching.
 *
 * Wraps FileWatcher with a subscribe/unsubscribe API and integrates with
 * the event bus and Web Locks for safe concurrent writes.
 *
 * @module clawser-reactive-config
 *
 * @example
 *   const store = new ReactiveConfigStore(watcher, shellFs);
 *   store.register('autonomy', '~/.config/clawser/autonomy.json', {
 *     apply: (config) => state.agent?.updateAutonomy(config),
 *     validate: (config) => {
 *       const errors = [];
 *       if (config.level && !['full', 'supervised', 'locked'].includes(config.level))
 *         errors.push('Invalid autonomy level');
 *       return errors;
 *     },
 *   });
 *   store.subscribe('autonomy', ({ newValue }) => console.log('autonomy changed', newValue));
 *   const cfg = store.get('autonomy');
 *   await store.set('autonomy', { ...cfg, level: 'full' });
 */

import { withLock } from './clawser-opfs.js';
import { emit } from './clawser-state.js';

/**
 * @typedef {Object} DomainHandler
 * @property {string} path - Virtual file path
 * @property {(config: *) => void} apply - Apply config to subsystem
 * @property {(config: *) => string[]} [validate] - Return error strings, empty = valid
 */

/**
 * @typedef {Object} DomainEntry
 * @property {string} path
 * @property {(config: *) => void} apply
 * @property {(config: *) => string[]} [validate]
 * @property {string} domain
 * @property {Set<(event: import('./clawser-file-watcher.mjs').FileChangeEvent) => void>} subscribers
 * @property {string|undefined} lastAppliedKey - Serialized form of the last applied config (dedupe)
 */

export class ReactiveConfigStore {
  /** @type {import('./clawser-file-watcher.mjs').FileWatcher} */
  #watcher;

  /** @type {import('./clawser-shell.js').ShellFs} */
  #fs;

  /** @type {Map<string, DomainEntry>} domain name → entry */
  #domains = new Map();

  /** @type {Map<string, string>} path → domain name (reverse lookup) */
  #pathToDomain = new Map();

  /**
   * @param {import('./clawser-file-watcher.mjs').FileWatcher} watcher
   * @param {import('./clawser-shell.js').ShellFs} fs - ShellFs for writes
   *
   * @example
   *   const store = new ReactiveConfigStore(watcher, shellFs);
   */
  constructor(watcher, fs) {
    this.#watcher = watcher;
    this.#fs = fs;
  }

  /**
   * Register a config domain. Sets up a file watch and wires the apply/validate handlers.
   *
   * @param {string} domain - Logical name (e.g. 'autonomy', 'identity')
   * @param {string} path - Virtual file path to watch
   * @param {DomainHandler} handler - { apply, validate? }
   *
   * @example
   *   store.register('security', '~/.config/clawser/security.json', {
   *     apply: (config) => state.safetyPipeline?.updatePolicy(config),
   *   });
   */
  register(domain, path, handler) {
    const entry = {
      path,
      apply: handler.apply,
      validate: handler.validate,
      domain,
      subscribers: new Set(),
    };

    this.#domains.set(domain, entry);
    this.#pathToDomain.set(path, domain);

    this.#watcher.watch(path, (changeEvent) => {
      this.#onFileChange(domain, entry, changeEvent);
    });
  }

  /**
   * Unregister a domain and stop watching its file.
   * @param {string} domain
   */
  unregister(domain) {
    const entry = this.#domains.get(domain);
    if (!entry) return;
    this.#watcher.unwatch(entry.path);
    this.#pathToDomain.delete(entry.path);
    this.#domains.delete(domain);
  }

  /**
   * Subscribe to changes for a config domain.
   * The callback receives the same FileChangeEvent shape as the watcher.
   *
   * @param {string} domain
   * @param {(event: import('./clawser-file-watcher.mjs').FileChangeEvent) => void} callback
   * @returns {() => void} Unsubscribe function
   *
   * @example
   *   const unsub = store.subscribe('autonomy', ({ newValue }) => {
   *     renderAutonomyPanel(newValue);
   *   });
   *   // Later:
   *   unsub();
   */
  subscribe(domain, callback) {
    const entry = this.#domains.get(domain);
    if (!entry) {
      console.warn(`[ReactiveConfig] Cannot subscribe to unregistered domain: ${domain}`);
      return () => {};
    }
    entry.subscribers.add(callback);
    return () => entry.subscribers.delete(callback);
  }

  /**
   * Get the current cached config for a domain (synchronous read from cache).
   * Returns null if the domain isn't registered or hasn't been read yet.
   *
   * @param {string} domain
   * @returns {*}
   *
   * @example
   *   const cfg = store.get('autonomy');
   *   // → { level: 'supervised', rateLimit: { perHour: 60 }, ... }
   */
  get(domain) {
    const entry = this.#domains.get(domain);
    if (!entry) return null;
    return this.#watcher.getCached(entry.path);
  }

  /**
   * Write a config value for a domain. Uses Web Locks for concurrency safety.
   * Marks the write as "by me" so the watcher suppresses self-notifications.
   *
   * @param {string} domain
   * @param {*} value - Config object to serialize and write
   * @returns {Promise<void>}
   *
   * @example
   *   await store.set('autonomy', { level: 'full', rateLimit: { perHour: 120 } });
   */
  async set(domain, value) {
    const entry = this.#domains.get(domain);
    if (!entry) {
      console.warn(`[ReactiveConfig] Cannot write to unregistered domain: ${domain}`);
      return;
    }

    const json = JSON.stringify(value, null, 2);

    await withLock(`clawser:config:${domain}`, async () => {
      await this.#fs.writeFile(entry.path, json);
    });

    // Mark as self-written (with content, for deterministic suppression)
    // so the watcher skips notification for this tab
    this.#watcher.markWrittenByMe(entry.path, json);
  }

  /**
   * Read a config directly from disk (bypasses cache). Useful for initial load.
   *
   * @param {string} domain
   * @returns {Promise<*>} Parsed config or null
   *
   * @example
   *   const fresh = await store.readFromDisk('identity');
   */
  async readFromDisk(domain) {
    const entry = this.#domains.get(domain);
    if (!entry) return null;

    try {
      const content = await this.#fs.readFile(entry.path);
      return JSON.parse(content);
    } catch {
      return null;
    }
  }

  /**
   * List all registered domain names.
   * @returns {string[]}
   */
  listDomains() {
    return [...this.#domains.keys()];
  }

  // ── Private ─────────────────────────────────────────────────────

  /**
   * Handle a file change detected by the watcher.
   * Validates, applies to subsystem, notifies subscribers, emits on event bus.
   */
  #onFileChange(domain, entry, changeEvent) {
    const { newValue } = changeEvent;

    // Validate if a validator is registered
    if (entry.validate && newValue != null) {
      const errors = entry.validate(newValue);
      if (errors && errors.length > 0) {
        console.warn(`[ReactiveConfig] Validation failed for ${domain}:`, errors);
        return; // keep previous config, don't apply
      }
    }

    // Dedupe: watchers in multiple tabs poll the same OPFS files, so the
    // same change can be detected more than once. Skip if content is
    // identical to what was last applied.
    const contentKey = newValue != null ? JSON.stringify(newValue) : undefined;
    if (contentKey !== undefined && contentKey === entry.lastAppliedKey) {
      return;
    }

    // Apply to subsystem
    try {
      if (newValue != null) {
        entry.apply(newValue);
        entry.lastAppliedKey = contentKey;
      }
    } catch (e) {
      console.error(`[ReactiveConfig] Error applying ${domain} config:`, e);
      return; // don't notify subscribers if apply failed
    }

    // Notify domain subscribers
    for (const cb of entry.subscribers) {
      try {
        cb(changeEvent);
      } catch (e) {
        console.error(`[ReactiveConfig] Subscriber error for ${domain}:`, e);
      }
    }

    // Emit on global event bus
    emit('configChanged', { domain, path: changeEvent.path, ...changeEvent });
  }
}

// ── Default domain registrations ─────────────────────────────────

/**
 * Wire all standard config domains to a ReactiveConfigStore.
 * Called during workspace init after the filesystem is bootstrapped.
 *
 * @param {ReactiveConfigStore} store
 * @param {Object} state - The global state object from clawser-state.js
 *
 * @example
 *   registerDefaultDomains(store, state);
 */
export const registerDefaultDomains = (store, state) => {
  store.register('autonomy', '~/.config/clawser/autonomy.json', {
    apply: (config) => {
      state.agent?.updateAutonomy?.(config);
      emit('refreshDashboard');
    },
    validate: (config) => {
      const errors = [];
      if (config.level && !['full', 'supervised', 'locked'].includes(config.level))
        errors.push('Invalid autonomy level');
      if (config.maxAutoIterations != null && typeof config.maxAutoIterations !== 'number')
        errors.push('maxAutoIterations must be a number');
      if (config.rateLimit?.perHour != null && typeof config.rateLimit.perHour !== 'number')
        errors.push('rateLimit.perHour must be a number');
      if (config.costLimit?.perDay != null && typeof config.costLimit.perDay !== 'number')
        errors.push('costLimit.perDay must be a number');
      return errors;
    },
  });

  store.register('identity', '~/.config/clawser/identity.json', {
    apply: (config) => {
      if (config.systemPrompt) {
        state.agent?.setSystemPrompt?.(config.systemPrompt);
      }
      emit('identityConfigChanged', config);
      emit('refreshDashboard');
    },
    validate: (config) => {
      const errors = [];
      if (config.name != null && typeof config.name !== 'string')
        errors.push('name must be a string');
      if (config.systemPrompt != null && typeof config.systemPrompt !== 'string')
        errors.push('systemPrompt must be a string');
      return errors;
    },
  });

  store.register('security', '~/.config/clawser/security.json', {
    apply: (config) => {
      const pipeline = state.safetyPipeline;
      if (pipeline) {
        const anyOn = ['inputSanitization', 'outputScanning', 'xssPrevention']
          .some((key) => config[key] !== false);
        // Only ever re-enable from a file change. Disabling the safety
        // pipeline requires explicit confirmation through the UI — a
        // watched file must not be able to bypass confirmDisable().
        if (anyOn && !pipeline.enabled) pipeline.confirmEnable?.();
      }
      emit('securityConfigChanged', config);
    },
    validate: (config) => {
      const errors = [];
      for (const key of ['inputSanitization', 'outputScanning', 'xssPrevention']) {
        if (config[key] != null && typeof config[key] !== 'boolean')
          errors.push(`${key} must be a boolean`);
      }
      return errors;
    },
  });

  store.register('daemon', '~/.config/clawser/daemon.json', {
    apply: (config) => {
      // DaemonController.start()/stop() are state-machine guarded, so
      // repeated calls with the same enabled value are safe no-ops.
      const daemon = state.daemonController;
      if (daemon) {
        if (config.enabled === true) daemon.start?.();
        else if (config.enabled === false) daemon.stop?.();
      }
      // If reactiveConfig is explicitly toggled, emit so the app layer can respond
      if (config.reactiveConfig != null) {
        emit('reactiveConfigToggled', { enabled: !!config.reactiveConfig });
      }
      emit('refreshDashboard');
    },
    validate: (config) => {
      const errors = [];
      if (config.checkpointInterval != null && typeof config.checkpointInterval !== 'number')
        errors.push('checkpointInterval must be a number');
      return errors;
    },
  });

  store.register('terminal', '~/.config/clawser/terminal.json', {
    apply: (config) => {
      // Terminal adapter swaps are handled by the UI layer listening for
      // this event (see initTerminalAdapter in clawser-ui-panels.js).
      emit('terminalSettingsChanged', config);
    },
    validate: (config) => {
      const errors = [];
      if (config.renderer && !['auto', 'custom-dom', 'wterm'].includes(config.renderer))
        errors.push('Invalid renderer value');
      return errors;
    },
  });

  store.register('hooks', '~/.config/clawser/hooks.json', {
    apply: (config) => {
      emit('hooksReloaded', config);
    },
    validate: (config) => {
      const errors = [];
      if (config.hooks != null && !Array.isArray(config.hooks))
        errors.push('hooks must be an array');
      return errors;
    },
  });
};
