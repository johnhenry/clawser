/**
 * Clawser CORS-free Fetch Proxy
 *
 * Provides a BrowserTool that delegates fetch requests to the Chrome extension
 * background.js service worker, bypassing CORS restrictions.
 *
 * The standalone fallback function, client setter, and WSH transport provider
 * live in clawser-cors-fetch-util.js to avoid a circular dependency with
 * clawser-tools.js.
 *
 * Block 2 (WSH bridge replacement): The extension CORS bridge is now deprecated
 * in favor of direct WSH transport. When a WSH connection is available,
 * corsFetchFallback routes through it automatically. ExtCorsFetchTool emits
 * a deprecation warning when invoked while WSH transport is available.
 */

import { BrowserTool } from './clawser-tools.js';
import { hasWshTransport } from './clawser-cors-fetch-util.js';
export {
  setCorsFetchClient,
  setCorsFetchWshProvider,
  corsFetchFallback,
  hasWshTransport,
  _resetBridgeDeprecation,
} from './clawser-cors-fetch-util.js';

// ── ExtCorsFetchTool ─────────────────────────────────────────────

export class ExtCorsFetchTool extends BrowserTool {
  #rpc;

  constructor(rpc) {
    super();
    this.#rpc = rpc;
  }

  get name() { return 'ext_cors_fetch'; }
  get description() {
    return 'DEPRECATED: Fetch a URL via the Chrome extension, bypassing CORS restrictions. ' +
      'Prefer wsh_fetch when a WSH connection is available.';
  }
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

    // Block 2: Deprecation warning when WSH transport is available
    if (hasWshTransport()) {
      try { console.warn(
        `[clawser] DEPRECATED: ext_cors_fetch invoked for "${params.url}" — ` +
        'use wsh_fetch or the automatic corsFetchFallback instead. ' +
        'The extension CORS bridge will be removed in a future release.',
      ); } catch { /* test env */ }
    }

    try {
      const resp = await this.#rpc.call('cors_fetch', {
        url: params.url,
        method: params.method || 'GET',
        headers: params.headers || {},
        body: params.body || undefined,
      });
      const summary = `HTTP ${resp.status || 0} — ${(resp.body || '').length} bytes`;
      const result = {
        success: true,
        output: JSON.stringify({ status: resp.status, headers: resp.headers, body: resp.body, summary }),
      };
      // Attach deprecation metadata so callers know this path is legacy
      if (hasWshTransport()) {
        result.deprecated = true;
        result.deprecationMessage = 'Extension CORS bridge is deprecated — prefer WSH transport.';
      }
      return result;
    } catch (err) {
      return { success: false, output: '', error: err.message || String(err) };
    }
  }
}

