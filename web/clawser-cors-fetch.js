/**
 * Clawser CORS-free Fetch Proxy
 *
 * Provides a BrowserTool that delegates fetch requests to the Chrome extension
 * background.js service worker, bypassing CORS restrictions.
 *
 * The standalone fallback function and client setter live in
 * clawser-cors-fetch-util.js to avoid a circular dependency with clawser-tools.js.
 */

import { BrowserTool } from './clawser-tools.js';
export { setCorsFetchClient, corsFetchFallback } from './clawser-cors-fetch-util.js';

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

