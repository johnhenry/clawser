/**
 * Clawser CORS Fetch Utilities
 *
 * Extracted from clawser-cors-fetch.js to break the circular dependency
 * between clawser-tools.js and clawser-cors-fetch.js.
 *
 * clawser-tools.js needs corsFetchFallback (for FetchTool CORS retry).
 * clawser-cors-fetch.js needs BrowserTool (for ExtCorsFetchTool class).
 * This module holds the fallback logic with no dependency on either.
 */

// ── Singleton extension client reference ─────────────────────────
let _extClient = null;

/**
 * Set the extension RPC client for corsFetchFallback to use.
 * Typically called once during app bootstrap.
 * @param {object} client - ExtensionRpcClient instance
 */
export function setCorsFetchClient(client) {
  _extClient = client;
}

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
