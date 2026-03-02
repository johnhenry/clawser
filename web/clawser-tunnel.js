/**
 * clawser-tunnel.js — Tunnel Integration (Phase 7b)
 *
 * TunnelManager with TunnelProvider interface. Supports Cloudflare
 * (cloudflared via wsh exec) and ngrok (via wsh exec + localhost API).
 *
 * @module clawser-tunnel
 */

// ── Constants ────────────────────────────────────────────────────

export const TUNNEL_STATE = Object.freeze({
  DISCONNECTED: 'disconnected',
  CONNECTING: 'connecting',
  CONNECTED: 'connected',
  ERROR: 'error',
});

const NGROK_API_URL = 'http://127.0.0.1:4040/api/tunnels';
const NGROK_API_RETRY_DELAY = 1000;
const NGROK_API_MAX_RETRIES = 5;

// ── TunnelProvider (interface) ───────────────────────────────────

/**
 * Abstract tunnel provider interface.
 * Subclasses must implement connect(), disconnect(), getUrl(), getState(), getName().
 */
export class TunnelProvider {
  /**
   * Start the tunnel to expose a local port.
   * @param {number} port - Local port to tunnel
   * @returns {Promise<void>}
   */
  async connect(port) {
    throw new Error('connect() not implemented');
  }

  /**
   * Stop the tunnel.
   * @returns {Promise<void>}
   */
  async disconnect() {
    throw new Error('disconnect() not implemented');
  }

  /**
   * Get the public tunnel URL.
   * @returns {string|null}
   */
  getUrl() { return null; }

  /**
   * Get current tunnel state.
   * @returns {string} One of TUNNEL_STATE values
   */
  getState() { return TUNNEL_STATE.DISCONNECTED; }

  /**
   * Get the provider name.
   * @returns {string}
   */
  getName() { return 'unknown'; }
}

// ── CloudflareTunnel ─────────────────────────────────────────────

/**
 * Cloudflare Tunnel via `cloudflared` CLI (wsh exec).
 * Uses quick tunnels (no account required).
 */
export class CloudflareTunnel extends TunnelProvider {
  #exec;
  #state = TUNNEL_STATE.DISCONNECTED;
  #url = null;
  #processId = null;

  /**
   * @param {object} opts
   * @param {Function} opts.exec - wsh exec function (cmd, args) => { exitCode, stdout, stderr }
   */
  constructor(opts = {}) {
    super();
    this.#exec = opts.exec;
  }

  getName() { return 'cloudflare'; }
  getState() { return this.#state; }
  getUrl() { return this.#url; }

  async connect(port) {
    this.#state = TUNNEL_STATE.CONNECTING;

    try {
      const result = await this.#exec('cloudflared', [
        'tunnel', '--url', `http://localhost:${port}`,
      ]);

      // Capture process ID from exec result if available
      if (result.pid != null) {
        this.#processId = result.pid;
      }

      if (result.exitCode !== 0) {
        this.#state = TUNNEL_STATE.ERROR;
        throw new Error(`cloudflared failed: ${result.stderr || 'unknown error'}`);
      }

      // Extract URL from stdout — cloudflared prints the tunnel URL
      const urlMatch = (result.stdout || '').match(/https?:\/\/[^\s]+\.trycloudflare\.com[^\s]*/);
      if (urlMatch) {
        this.#url = urlMatch[0];
      } else {
        // Fallback: the entire stdout might be the URL
        this.#url = (result.stdout || '').trim();
      }

      this.#state = TUNNEL_STATE.CONNECTED;
    } catch (err) {
      this.#state = TUNNEL_STATE.ERROR;
      throw err;
    }
  }

  async disconnect() {
    if (this.#processId) {
      try {
        await this.#exec('kill', [String(this.#processId)]);
      } catch { /* best effort */ }
    }
    this.#state = TUNNEL_STATE.DISCONNECTED;
    this.#url = null;
    this.#processId = null;
  }
}

// ── NgrokTunnel ──────────────────────────────────────────────────

/**
 * ngrok tunnel via CLI (wsh exec) + localhost API for URL retrieval.
 */
export class NgrokTunnel extends TunnelProvider {
  #exec;
  #fetchFn;
  #state = TUNNEL_STATE.DISCONNECTED;
  #url = null;
  #apiUrl;

  /**
   * @param {object} opts
   * @param {Function} opts.exec - wsh exec function
   * @param {Function} opts.fetchFn - fetch implementation
   * @param {string} [opts.apiUrl] - ngrok local API URL
   */
  constructor(opts = {}) {
    super();
    this.#exec = opts.exec;
    this.#fetchFn = opts.fetchFn || (typeof fetch !== 'undefined' ? fetch.bind(globalThis) : null);
    this.#apiUrl = opts.apiUrl || NGROK_API_URL;
  }

  getName() { return 'ngrok'; }
  getState() { return this.#state; }
  getUrl() { return this.#url; }

  async connect(port) {
    this.#state = TUNNEL_STATE.CONNECTING;

    try {
      // Start ngrok in background
      const result = await this.#exec('ngrok', ['http', String(port)]);

      if (result.exitCode !== 0) {
        this.#state = TUNNEL_STATE.ERROR;
        throw new Error(`ngrok failed: ${result.stderr || 'unknown error'}`);
      }

      // Query the ngrok local API for the tunnel URL
      const url = await this.#pollForUrl();
      this.#url = url;
      this.#state = TUNNEL_STATE.CONNECTED;
    } catch (err) {
      if (this.#state !== TUNNEL_STATE.ERROR) {
        this.#state = TUNNEL_STATE.ERROR;
      }
      throw err;
    }
  }

  async disconnect() {
    try {
      await this.#exec('pkill', ['-f', 'ngrok']);
    } catch { /* best effort */ }
    this.#state = TUNNEL_STATE.DISCONNECTED;
    this.#url = null;
  }

  async #pollForUrl(retries = NGROK_API_MAX_RETRIES) {
    for (let i = 0; i < retries; i++) {
      try {
        const resp = await this.#fetchFn(this.#apiUrl);
        if (resp.ok) {
          const data = await resp.json();
          const tunnels = data.tunnels || [];
          const https = tunnels.find(t => t.proto === 'https') || tunnels[0];
          if (https && https.public_url) return https.public_url;
        }
      } catch { /* retry */ }

      if (i < retries - 1) {
        await new Promise(r => setTimeout(r, NGROK_API_RETRY_DELAY));
      }
    }
    throw new Error('Failed to retrieve ngrok tunnel URL');
  }
}

// ── TunnelManager ────────────────────────────────────────────────

/**
 * Manages tunnel providers and active tunnel lifecycle.
 */
export class TunnelManager {
  /** @type {Map<string, TunnelProvider>} */
  #providers = new Map();
  /** @type {string|null} */
  #activeName = null;
  /** @type {Set<Function>} */
  #listeners = new Set();

  /**
   * Register a tunnel provider.
   * @param {string} name
   * @param {TunnelProvider} provider
   */
  registerProvider(name, provider) {
    this.#providers.set(name, provider);
  }

  /**
   * List registered provider names.
   * @returns {string[]}
   */
  listProviders() {
    return [...this.#providers.keys()];
  }

  /**
   * Connect using a named provider.
   * @param {string} name - Provider name
   * @param {number} port - Local port
   * @returns {Promise<string>} Tunnel URL
   */
  async connect(name, port) {
    const provider = this.#providers.get(name);
    if (!provider) throw new Error(`Unknown provider: ${name}`);

    // Disconnect any active tunnel first
    if (this.#activeName) {
      await this.disconnect();
    }

    this.#activeName = name;
    this.#notify(TUNNEL_STATE.CONNECTING);

    try {
      await provider.connect(port);
      this.#notify(provider.getState());
      return provider.getUrl();
    } catch (err) {
      this.#notify(TUNNEL_STATE.ERROR);
      this.#activeName = null;
      throw err;
    }
  }

  /**
   * Disconnect the active tunnel.
   * @returns {Promise<void>}
   */
  async disconnect() {
    if (!this.#activeName) return;
    const provider = this.#providers.get(this.#activeName);
    if (provider) {
      await provider.disconnect();
    }
    this.#activeName = null;
    this.#notify(TUNNEL_STATE.DISCONNECTED);
  }

  /**
   * Get the active tunnel provider name.
   * @returns {string|null}
   */
  getActiveTunnel() {
    return this.#activeName;
  }

  /**
   * Get the active tunnel URL.
   * @returns {string|null}
   */
  getUrl() {
    if (!this.#activeName) return null;
    const provider = this.#providers.get(this.#activeName);
    return provider ? provider.getUrl() : null;
  }

  /**
   * Get the active tunnel state.
   * @returns {string}
   */
  getState() {
    if (!this.#activeName) return TUNNEL_STATE.DISCONNECTED;
    const provider = this.#providers.get(this.#activeName);
    return provider ? provider.getState() : TUNNEL_STATE.DISCONNECTED;
  }

  /**
   * Register a state change listener.
   * @param {Function} fn - (state: string) => void
   * @returns {Function} Unsubscribe function
   */
  onChange(fn) {
    this.#listeners.add(fn);
    return () => this.#listeners.delete(fn);
  }

  #notify(state) {
    for (const fn of this.#listeners) {
      fn(state);
    }
  }
}
