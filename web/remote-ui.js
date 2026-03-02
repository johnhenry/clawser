/**
 * remote-ui.js — Mobile-friendly Remote UI (Phase 7d)
 *
 * Client-side logic for the remote chat interface.
 * Sends messages via POST /message, streams responses via EventSource /stream,
 * manages bearer token authentication from pairing flow.
 *
 * @module remote-ui
 */

// ── RemoteUIState ────────────────────────────────────────────────

/**
 * Reactive state container for the remote UI.
 */
export class RemoteUIState {
  #token = null;
  #messages = [];
  #connected = false;
  #listeners = new Set();

  get token() { return this.#token; }
  get authenticated() { return !!this.#token; }
  get messages() { return [...this.#messages]; }
  get connected() { return this.#connected; }

  /**
   * Set the bearer token (after successful pairing).
   * @param {string} token
   */
  setToken(token) {
    this.#token = token;
    this.#notify({ type: 'auth', authenticated: true });
  }

  /**
   * Clear the bearer token.
   */
  clearToken() {
    this.#token = null;
    this.#notify({ type: 'auth', authenticated: false });
  }

  /**
   * Set connected status.
   * @param {boolean} val
   */
  setConnected(val) {
    this.#connected = val;
    this.#notify({ type: 'connection', connected: val });
  }

  /**
   * Add a message to the chat history.
   * @param {{ role: string, content: string, timestamp?: number }} msg
   */
  addMessage(msg) {
    this.#messages.push({
      ...msg,
      timestamp: msg.timestamp || Date.now(),
    });
    this.#notify({ type: 'message', message: msg });
  }

  /**
   * Clear all messages.
   */
  clearMessages() {
    this.#messages = [];
    this.#notify({ type: 'clear' });
  }

  /**
   * Register a state change listener.
   * @param {Function} fn - (event: object) => void
   * @returns {Function} Unsubscribe function
   */
  onChange(fn) {
    this.#listeners.add(fn);
    return () => this.#listeners.delete(fn);
  }

  #notify(event) {
    for (const fn of this.#listeners) {
      try { fn(event); } catch { /* swallow listener errors */ }
    }
  }
}

// ── RemoteUI ─────────────────────────────────────────────────────

/**
 * Remote UI client — sends messages and manages SSE stream.
 */
export class RemoteUI {
  #baseUrl;
  #fetchFn;
  #state;
  #eventSource = null;

  /**
   * @param {object} opts
   * @param {string} opts.baseUrl - Gateway URL
   * @param {Function} [opts.fetchFn] - Injectable fetch
   * @param {RemoteUIState} [opts.state] - Injectable state
   */
  constructor(opts = {}) {
    this.#baseUrl = (opts.baseUrl || '').replace(/\/+$/, '');
    this.#fetchFn = opts.fetchFn || (typeof fetch !== 'undefined' ? fetch.bind(globalThis) : null);
    this.#state = opts.state || new RemoteUIState();
  }

  get baseUrl() { return this.#baseUrl; }
  get state() { return this.#state; }

  // ── Pairing ─────────────────────────────────────────────────

  /**
   * Pair with the gateway using a 6-digit code.
   * @param {string} code
   * @param {object} [meta] - { device }
   * @returns {Promise<{ token: string, expires: number }>}
   */
  async pair(code, meta = {}) {
    const resp = await this.#fetch('/pair', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code, device: meta.device || 'remote-ui' }),
    });

    if (!resp.ok) {
      throw new Error(`Pair failed: ${resp.status}`);
    }

    const data = await resp.json();
    this.#state.setToken(data.token);
    this.#state.setConnected(true);
    return data;
  }

  // ── Messaging ───────────────────────────────────────────────

  /**
   * Send a message to the agent.
   * @param {string} text
   * @returns {Promise<object>} Agent response
   */
  async sendMessage(text) {
    if (!this.#state.authenticated) {
      throw new Error('Not authenticated. Call pair() first.');
    }

    this.#state.addMessage(RemoteUI.formatMessage('user', text));

    const resp = await this.#fetch('/message', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.#state.token}`,
      },
      body: JSON.stringify({ text }),
    });

    if (!resp.ok) {
      throw new Error(`Send failed: ${resp.status}`);
    }

    const data = await resp.json();
    this.#state.addMessage(RemoteUI.formatMessage('assistant', data.response || JSON.stringify(data)));
    return data;
  }

  // ── Status ──────────────────────────────────────────────────

  /**
   * Get server status (unauthenticated).
   * @returns {Promise<object>}
   */
  async getStatus() {
    const resp = await this.#fetch('/status');
    if (!resp.ok) throw new Error(`Status failed: ${resp.status}`);
    return resp.json();
  }

  // ── SSE Streaming ───────────────────────────────────────────

  /**
   * Build the EventSource URL for SSE streaming.
   *
   * NOTE: The token is passed as a query parameter because the EventSource API
   * does not support custom headers (e.g., Authorization). This is a known
   * limitation of the browser EventSource specification. The server should
   * treat this token as a short-lived session token and rotate it frequently
   * to limit exposure in server logs and browser history.
   *
   * @returns {string}
   */
  createEventSourceUrl() {
    const params = new URLSearchParams();
    if (this.#state.token) params.set('token', this.#state.token);
    return `${this.#baseUrl}/stream?${params.toString()}`;
  }

  /**
   * Connect to the SSE event stream.
   * @param {Function} onMessage - (data: object) => void
   * @param {Function} [onError] - (error: Error) => void
   * @returns {object|null} EventSource-like object or null
   */
  connectStream(onMessage, onError) {
    if (!this.#state.authenticated) return null;

    // In browser, use EventSource
    if (typeof EventSource !== 'undefined') {
      const url = this.createEventSourceUrl();
      const es = new EventSource(url);

      es.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          onMessage(data);
        } catch { /* ignore parse errors */ }
      };

      es.onerror = () => {
        if (onError) onError(new Error('SSE connection error'));
        this.#state.setConnected(false);
      };

      es.onopen = () => {
        this.#state.setConnected(true);
      };

      this.#eventSource = es;
      return es;
    }

    return null;
  }

  /**
   * Disconnect SSE stream.
   */
  disconnectStream() {
    if (this.#eventSource) {
      this.#eventSource.close();
      this.#eventSource = null;
    }
    this.#state.setConnected(false);
  }

  // ── Disconnect ──────────────────────────────────────────────

  /**
   * Disconnect and clear all state.
   */
  disconnect() {
    this.disconnectStream();
    this.#state.clearToken();
    this.#state.setConnected(false);
  }

  // ── Static helpers ──────────────────────────────────────────

  /**
   * Format a chat message.
   * @param {string} role - 'user' or 'assistant'
   * @param {string} content
   * @returns {{ role: string, content: string, timestamp: number }}
   */
  static formatMessage(role, content) {
    return { role, content, timestamp: Date.now() };
  }

  // ── Private ─────────────────────────────────────────────────

  #fetch(path, opts = {}) {
    if (!this.#fetchFn) throw new Error('No fetch implementation available');
    return this.#fetchFn(this.#baseUrl + path, opts);
  }
}
