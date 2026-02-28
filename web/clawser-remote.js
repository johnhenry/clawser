// clawser-remote.js — Remote Access Gateway + Pairing
//
// generatePairingCode: 6-digit code generation
// PairingManager: code → token exchange with expiry
// RemoteSession: bearer token management and validation
// GatewayClient: browser-side client for remote gateway
// Agent tools: remote_status, remote_pair, remote_revoke

import { BrowserTool } from './clawser-tools.js';

// ── Constants ───────────────────────────────────────────────────

export const DEFAULT_CODE_LENGTH = 6;
export const DEFAULT_CODE_EXPIRY_MS = 5 * 60_000; // 5 minutes
export const DEFAULT_TOKEN_EXPIRY_MS = 24 * 60 * 60_000; // 24 hours
export const DEFAULT_RATE_LIMIT = 60; // requests per minute

// ── Pairing Code ────────────────────────────────────────────────

/**
 * Generate a random N-digit numeric pairing code.
 * @param {number} [length=6]
 * @returns {string}
 */
export function generatePairingCode(length = DEFAULT_CODE_LENGTH) {
  const arr = new Uint32Array(length);
  crypto.getRandomValues(arr);
  return Array.from(arr, v => v % 10).join('');
}

/**
 * Generate a random bearer token.
 * @returns {string}
 */
export function generateToken() {
  const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  const limit = 256 - (256 % chars.length); // reject samples >= limit to avoid modulo bias
  const result = [];
  while (result.length < 32) {
    const bytes = new Uint8Array(32 - result.length);
    crypto.getRandomValues(bytes);
    for (const b of bytes) {
      if (b < limit) result.push(chars[b % chars.length]);
    }
  }
  return `bearer_${result.join('')}`;
}

// ── PairingManager ──────────────────────────────────────────────

/**
 * Manages pairing codes and token exchange.
 */
export class PairingManager {
  /** @type {Map<string, { code: string, created: number, used: boolean }>} */
  #codes = new Map();

  /** @type {Map<string, { token: string, created: number, expires: number, device?: string }>} */
  #sessions = new Map();

  /** @type {number} */
  #codeExpiry;

  /** @type {number} */
  #tokenExpiry;

  /** @type {Function|null} */
  #onLog;

  /**
   * @param {object} [opts]
   * @param {number} [opts.codeExpiry] - Code expiry in ms
   * @param {number} [opts.tokenExpiry] - Token expiry in ms
   * @param {Function} [opts.onLog]
   */
  /** @type {number[]} */
  #exchangeAttempts = [];

  /** @type {number} */
  #maxExchangeAttempts;

  constructor(opts = {}) {
    this.#codeExpiry = opts.codeExpiry || DEFAULT_CODE_EXPIRY_MS;
    this.#tokenExpiry = opts.tokenExpiry || DEFAULT_TOKEN_EXPIRY_MS;
    this.#onLog = opts.onLog || null;
    this.#maxExchangeAttempts = opts.maxExchangeAttempts || 5; // max attempts per minute
  }

  /**
   * Generate a new pairing code.
   * @returns {string} The 6-digit code
   */
  createCode() {
    // Expire old codes
    this.#pruneExpiredCodes();

    let code;
    let attempts = 0;
    do {
      code = generatePairingCode();
      attempts++;
      if (attempts > 10) throw new Error('Failed to generate unique pairing code');
    } while (this.#codes.has(code));
    this.#codes.set(code, {
      code,
      created: Date.now(),
      used: false,
    });
    this.#log(`Pairing code generated: ${code}`);
    return code;
  }

  /**
   * Exchange a pairing code for a bearer token.
   * @param {string} code
   * @param {object} [meta] - { device, ip }
   * @returns {{ token: string, expires: number }|null}
   */
  exchangeCode(code, meta = {}) {
    // Rate limit: max N attempts per 60s window
    const now = Date.now();
    this.#exchangeAttempts = this.#exchangeAttempts.filter(t => now - t < 60_000);
    if (this.#exchangeAttempts.length >= this.#maxExchangeAttempts) {
      this.#log('Pairing exchange rate limit exceeded');
      return null;
    }
    this.#exchangeAttempts.push(now);

    const entry = this.#codes.get(code);
    if (!entry) return null;

    // Check expiry
    if (Date.now() - entry.created > this.#codeExpiry) {
      this.#codes.delete(code);
      return null;
    }

    // Check one-time use
    if (entry.used) return null;
    entry.used = true;

    // Generate token
    const token = generateToken();
    const expires = Date.now() + this.#tokenExpiry;
    this.#sessions.set(token, {
      token,
      created: Date.now(),
      expires,
      device: meta.device || null,
      ip: meta.ip || null,
    });

    // Clean up used code
    this.#codes.delete(code);
    this.#log(`Pairing successful. Token issued for ${meta.device || 'unknown device'}`);

    return { token, expires };
  }

  /**
   * Validate a bearer token.
   * @param {string} token
   * @returns {boolean}
   */
  validateToken(token) {
    const session = this.#sessions.get(token);
    if (!session) return false;
    if (Date.now() > session.expires) {
      this.#sessions.delete(token);
      return false;
    }
    return true;
  }

  /**
   * Revoke a token.
   * @param {string} token
   * @returns {boolean}
   */
  revokeToken(token) {
    return this.#sessions.delete(token);
  }

  /**
   * Revoke all tokens.
   */
  revokeAll() {
    this.#sessions.clear();
    this.#codes.clear();
    this.#log('All sessions revoked');
  }

  /**
   * List active sessions.
   * @returns {Array<{ token: string, device: string|null, created: number, expires: number }>}
   */
  listSessions() {
    this.#pruneExpiredSessions();
    return [...this.#sessions.values()].map(s => ({
      token: s.token.slice(0, 12) + '...', // truncated for display
      device: s.device,
      created: s.created,
      expires: s.expires,
    }));
  }

  /** Number of active sessions. */
  get sessionCount() {
    this.#pruneExpiredSessions();
    return this.#sessions.size;
  }

  /** Number of active (unexpired) codes. */
  get codeCount() {
    this.#pruneExpiredCodes();
    return this.#codes.size;
  }

  #pruneExpiredCodes() {
    const now = Date.now();
    for (const [code, entry] of this.#codes) {
      if (now - entry.created > this.#codeExpiry || entry.used) {
        this.#codes.delete(code);
      }
    }
  }

  #pruneExpiredSessions() {
    const now = Date.now();
    for (const [token, session] of this.#sessions) {
      if (now > session.expires) {
        this.#sessions.delete(token);
      }
    }
  }

  #log(msg) {
    if (this.#onLog) this.#onLog(1, msg);
  }
}

// ── RateLimiter ─────────────────────────────────────────────────

/**
 * Simple per-token rate limiter.
 */
export class RateLimiter {
  /** @type {Map<string, { count: number, windowStart: number }>} */
  #windows = new Map();

  /** @type {number} */
  #maxPerMinute;

  /**
   * @param {number} [maxPerMinute=60]
   */
  constructor(maxPerMinute = DEFAULT_RATE_LIMIT) {
    this.#maxPerMinute = maxPerMinute;
  }

  /**
   * Check if a request should be allowed.
   * @param {string} token
   * @returns {boolean}
   */
  allow(token) {
    const now = Date.now();
    let entry = this.#windows.get(token);

    if (!entry || now - entry.windowStart >= 60_000) {
      entry = { count: 0, windowStart: now };
      this.#windows.set(token, entry);
    }

    entry.count++;
    return entry.count <= this.#maxPerMinute;
  }

  /**
   * Get remaining requests for a token.
   * @param {string} token
   * @returns {number}
   */
  remaining(token) {
    const entry = this.#windows.get(token);
    if (!entry || Date.now() - entry.windowStart >= 60_000) {
      return this.#maxPerMinute;
    }
    return Math.max(0, this.#maxPerMinute - entry.count);
  }

  /** Max requests per minute. */
  get maxPerMinute() { return this.#maxPerMinute; }

  /**
   * Reset rate limit windows.
   * @param {string} [token] - If provided, reset only that token. Otherwise clear all.
   */
  reset(token) {
    if (token !== undefined) {
      this.#windows.delete(token);
    } else {
      this.#windows.clear();
    }
  }
}

// ── GatewayClient ───────────────────────────────────────────────

/**
 * Browser-side client for connecting to a remote gateway.
 */
export class GatewayClient {
  #baseUrl;
  #token = null;
  #fetchFn;

  /**
   * @param {object} [opts]
   * @param {string} [opts.baseUrl]
   * @param {string} [opts.token]
   * @param {Function} [opts.fetchFn] - Injectable fetch
   */
  constructor(opts = {}) {
    this.#baseUrl = (opts.baseUrl || '').replace(/\/+$/, '');
    this.#token = opts.token || null;
    this.#fetchFn = opts.fetchFn || (typeof fetch !== 'undefined' ? fetch.bind(globalThis) : null);
  }

  get token() { return this.#token; }
  get baseUrl() { return this.#baseUrl; }
  get authenticated() { return !!this.#token; }

  /**
   * Pair with the gateway using a 6-digit code.
   * @param {string} code
   * @param {object} [meta]
   * @returns {Promise<{ token: string, expires: number }>}
   */
  async pair(code, meta = {}) {
    const resp = await this.#fetch('/pair', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code, ...meta }),
    });
    if (!resp.ok) {
      throw new Error(`Pairing failed: ${resp.status}`);
    }
    const data = await resp.json();
    this.#token = data.token;
    return data;
  }

  /**
   * Send a message to the agent.
   * @param {string} text
   * @param {object} [meta]
   * @returns {Promise<object>}
   */
  async sendMessage(text, meta = {}) {
    const resp = await this.#fetch('/message', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, ...meta }),
    });
    if (!resp.ok) {
      throw new Error(`Send failed: ${resp.status}`);
    }
    return resp.json();
  }

  /**
   * Get agent status.
   * @returns {Promise<object>}
   */
  async getStatus() {
    const resp = await this.#fetch('/status');
    if (!resp.ok) throw new Error(`Status failed: ${resp.status}`);
    return resp.json();
  }

  /**
   * Disconnect and clear token.
   */
  disconnect() {
    this.#token = null;
  }

  #fetch(path, opts = {}) {
    if (!this.#fetchFn) throw new Error('No fetch implementation available');
    const headers = { ...(opts.headers || {}) };
    if (this.#token) {
      headers['Authorization'] = `Bearer ${this.#token}`;
    }
    return this.#fetchFn(this.#baseUrl + path, { ...opts, headers });
  }
}

// ── Agent Tools ─────────────────────────────────────────────────

export class RemoteStatusTool extends BrowserTool {
  #pairing;

  constructor(pairing) {
    super();
    this.#pairing = pairing;
  }

  get name() { return 'remote_status'; }
  get description() { return 'Show remote access status and active sessions.'; }
  get parameters() { return { type: 'object', properties: {} }; }
  get permission() { return 'read'; }

  async execute() {
    const sessions = this.#pairing.listSessions();
    const lines = [
      `Active sessions: ${sessions.length}`,
      `Pending codes: ${this.#pairing.codeCount}`,
    ];
    if (sessions.length > 0) {
      lines.push('', 'Sessions:');
      for (const s of sessions) {
        const device = s.device || 'unknown';
        const expires = new Date(s.expires).toISOString();
        lines.push(`  ${s.token} | ${device} | expires: ${expires}`);
      }
    }
    return { success: true, output: lines.join('\n') };
  }
}

export class RemotePairTool extends BrowserTool {
  #pairing;

  constructor(pairing) {
    super();
    this.#pairing = pairing;
  }

  get name() { return 'remote_pair'; }
  get description() { return 'Generate a pairing code for remote access.'; }
  get parameters() { return { type: 'object', properties: {} }; }
  get permission() { return 'approve'; }

  async execute() {
    const code = this.#pairing.createCode();
    return {
      success: true,
      output: `Pairing code: ${code}\nExpires in 5 minutes. Enter this code on your remote device.`,
    };
  }
}

export class RemoteRevokeTool extends BrowserTool {
  #pairing;

  constructor(pairing) {
    super();
    this.#pairing = pairing;
  }

  get name() { return 'remote_revoke'; }
  get description() { return 'Revoke remote access sessions.'; }
  get parameters() {
    return {
      type: 'object',
      properties: {
        all: { type: 'boolean', description: 'Revoke all sessions (default false)' },
      },
    };
  }
  get permission() { return 'approve'; }

  async execute({ all } = {}) {
    if (all) {
      this.#pairing.revokeAll();
      return { success: true, output: 'All remote sessions revoked.' };
    }
    return { success: true, output: `Active sessions: ${this.#pairing.sessionCount}. Use all=true to revoke all.` };
  }
}
