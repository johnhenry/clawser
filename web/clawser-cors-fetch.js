/**
 * Clawser CORS-free Fetch Proxy
 *
 * Provides a BrowserTool that delegates fetch requests to the Chrome extension
 * background.js service worker, bypassing CORS restrictions. Also exports a
 * fallback function that FetchTool can use when direct fetch fails.
 */

import { BrowserTool } from './clawser-tools.js';

// ── Singleton extension client reference ─────────────────────────
// Lazily resolved — avoids circular imports with clawser-extension-tools.js.
let _extClient = null;

/**
 * Set the extension RPC client for corsFetchFallback to use.
 * Typically called once during app bootstrap.
 * @param {object} client - ExtensionRpcClient instance
 */
export function setCorsFetchClient(client) {
  _extClient = client;
}

// ── ExtCorsFetchTool ─────────────────────────────────────────────

export class ExtCorsFetchTool extends BrowserTool {
  #rpc;

  constructor(rpc) {
    super();
    this.#rpc = rpc;
  }

  get name() { return 'ext_cors_fetch'; }
  get description() { return 'Fetch a URL via the Chrome extension, bypassing CORS restrictions.'; }
  get permission() { return 'network'; }
  get parameters() {
    return {
      type: 'object',
      properties: {
        url: { type: 'string', description: 'URL to fetch' },
        method: { type: 'string', description: 'HTTP method (default GET)' },
        headers: { type: 'object', description: 'Request headers' },
        body: { type: 'string', description: 'Request body' },
      },
      required: ['url'],
    };
  }

  async execute(params) {
    if (!params.url) {
      return { success: false, output: '', error: 'url is required' };
    }
    if (!this.#rpc.connected) {
      return { success: false, output: '', error: 'Extension not connected' };
    }
    try {
      const resp = await this.#rpc.call('cors_fetch', {
        url: params.url,
        method: params.method || 'GET',
        headers: params.headers || {},
        body: params.body || undefined,
      });
      const summary = `HTTP ${resp.status || 0} — ${(resp.body || '').length} bytes`;
      return {
        success: true,
        output: JSON.stringify({ status: resp.status, headers: resp.headers, body: resp.body, summary }),
      };
    } catch (err) {
      return { success: false, output: '', error: err.message || String(err) };
    }
  }
}

// ── Fallback function for FetchTool ──────────────────────────────

/**
 * Attempt a CORS-free fetch via the extension. Returns the response object
 * { status, headers, body } on success, or null if the extension is unavailable.
 *
 * @param {string} url
 * @param {object} [opts] - { method, headers, body }
 * @returns {Promise<{status: number, headers: object, body: string}|null>}
 */
export async function corsFetchFallback(url, opts = {}) {
  const client = _extClient;
  if (!client || !client.connected) return null;
  try {
    return await client.call('cors_fetch', {
      url,
      method: opts.method || 'GET',
      headers: opts.headers || {},
      body: opts.body || undefined,
    });
  } catch {
    return null;
  }
}
