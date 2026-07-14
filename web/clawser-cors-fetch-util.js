/**
 * Clawser CORS Fetch Utilities
 *
 * Extracted from clawser-cors-fetch.js to break the circular dependency
 * between clawser-tools.js and clawser-cors-fetch.js.
 *
 * clawser-tools.js needs corsFetchFallback (for FetchTool CORS retry).
 * clawser-cors-fetch.js needs BrowserTool (for ExtCorsFetchTool class).
 * This module holds the fallback logic with no dependency on either.
 *
 * Transport priority (Block 2 — WSH bridge replacement):
 *   1. WSH direct — if any authenticated wsh connection exists, proxy
 *      the request through `curl` on the remote host (no extension needed).
 *   2. Extension bridge — legacy path via Chrome extension service worker.
 *   When the extension bridge is used while a WSH connection is available,
 *   a deprecation warning is emitted so callers can migrate.
 */

// ── Singleton extension client reference ─────────────────────────
let _extClient = null;

// ── WSH provider (supplies connected WshClient instances) ────────
/** @type {Function|null} () => Map<string, WshClient> */
let _wshProvider = null;

/**
 * Set the extension RPC client for corsFetchFallback to use.
 * Typically called once during app bootstrap.
 * @param {object} client - ExtensionRpcClient instance
 */
export function setCorsFetchClient(client) {
  _extClient = client;
}

/**
 * Set the WSH connection provider for direct CORS-free fetching.
 * The provider is a function that returns the live Map<host, WshClient>.
 *
 * @example
 *   import { getWshConnections } from './clawser-wsh-tools.js';
 *   setCorsFetchWshProvider(() => getWshConnections());
 *
 * @param {Function} provider - () => Map<string, WshClient>
 */
export function setCorsFetchWshProvider(provider) {
  _wshProvider = provider;
}

// ── Deprecation tracking ─────────────────────────────────────────
let _bridgeDeprecationLogged = false;

/**
 * Emit a one-time deprecation warning when the extension CORS bridge is
 * used while a WSH transport is available.
 * @param {string} url - The URL that triggered the warning
 */
function _emitBridgeDeprecation(url) {
  if (_bridgeDeprecationLogged) return;
  _bridgeDeprecationLogged = true;
  const msg = `[clawser] DEPRECATED: Extension CORS bridge used for "${url}" — ` +
    'a WSH connection is available and should be preferred. ' +
    'The extension CORS bridge will be removed in a future release.';
  try { console.warn(msg); } catch { /* SSR / test env */ }
  try {
    globalThis.dispatchEvent?.(new CustomEvent('clawser:cors-bridge-deprecated', {
      detail: { url, timestamp: Date.now() },
    }));
  } catch { /* event dispatch unavailable */ }
}

/** Reset the deprecation flag (for testing). */
export function _resetBridgeDeprecation() {
  _bridgeDeprecationLogged = false;
}

// ── WSH fetch implementation ─────────────────────────────────────

/**
 * Find the first authenticated WshClient from the provider.
 * @returns {object|null} { host, client } or null
 */
function _getWshClient() {
  if (!_wshProvider) return null;
  try {
    const connections = _wshProvider();
    if (!connections || connections.size === 0) return null;
    for (const [host, client] of connections) {
      if (client && client.state === 'authenticated') {
        return { host, client };
      }
    }
  } catch { /* provider threw — no WSH available */ }
  return null;
}

/**
 * Check whether at least one WSH connection is available.
 * @returns {boolean}
 */
export function hasWshTransport() {
  return _getWshClient() !== null;
}

/**
 * Attempt a CORS-free fetch via an authenticated WSH connection.
 * Runs `curl` on the remote host and parses the response.
 *
 * @param {string} url
 * @param {object} [opts] - { method, headers, body }
 * @returns {Promise<{status: number, headers: object, body: string}|null>}
 */
async function _wshFetchFallback(url, opts = {}) {
  const entry = _getWshClient();
  if (!entry) return null;

  const { client } = entry;
  const method = opts.method || 'GET';
  const headers = opts.headers || {};
  const body = opts.body;

  // Build curl command — mirrors WshFetchTool logic
  const parts = ['curl', '-sS', '-D-', '-X', method];
  for (const [k, v] of Object.entries(headers)) {
    parts.push('-H', `${k}: ${v}`);
  }
  if (body && ['POST', 'PUT', 'PATCH'].includes(method.toUpperCase())) {
    parts.push('-d', body);
  }
  parts.push('--max-time', '30');
  parts.push('--', url);

  // Shell-escape each argument
  const command = parts.map(p => {
    if (/^[a-zA-Z0-9_./:@=,-]+$/.test(p)) return p;
    return "'" + p.replace(/'/g, "'\\''") + "'";
  }).join(' ');

  try {
    const session = await client.openSession({ type: 'exec', command });

    const chunks = [];
    let exitCode = null;

    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        session.close();
        reject(new Error('WSH fetch timed out'));
      }, 35000);

      session.onData = (data) => chunks.push(data);
      session.onExit = (code) => {
        exitCode = code;
        clearTimeout(timer);
        resolve();
      };
      session.onClose = () => {
        clearTimeout(timer);
        resolve();
      };
    });

    if (exitCode !== 0) return null;

    const decoder = new TextDecoder();
    const raw = chunks.map((c, i) => decoder.decode(c, { stream: i < chunks.length - 1 })).join('');

    // Parse curl -D- output: headers then blank line then body
    const splitIdx = raw.indexOf('\r\n\r\n');
    if (splitIdx === -1) {
      return { status: 0, headers: {}, body: raw };
    }

    const headerBlock = raw.slice(0, splitIdx);
    const bodyContent = raw.slice(splitIdx + 4);

    const statusMatch = headerBlock.match(/^HTTP\/[\d.]+ (\d+)/);
    const status = statusMatch ? parseInt(statusMatch[1], 10) : 0;

    // Parse response headers
    const respHeaders = {};
    for (const line of headerBlock.split('\r\n').slice(1)) {
      const colonIdx = line.indexOf(':');
      if (colonIdx > 0) {
        respHeaders[line.slice(0, colonIdx).trim().toLowerCase()] = line.slice(colonIdx + 1).trim();
      }
    }

    return { status, headers: respHeaders, body: bodyContent };
  } catch {
    return null;
  }
}

// ── Public fallback function ─────────────────────────────────────

/**
 * Attempt a CORS-free fetch using the best available transport.
 *
 * Priority: WSH direct > Extension bridge.
 *
 * Returns the response object { status, headers, body } on success,
 * or null if no transport is available.
 *
 * @param {string} url
 * @param {object} [opts] - { method, headers, body }
 * @returns {Promise<{status: number, headers: object, body: string}|null>}
 */
export async function corsFetchFallback(url, opts = {}) {
  // 1. Try WSH direct transport (preferred)
  const wshResp = await _wshFetchFallback(url, opts);
  if (wshResp) return wshResp;

  // 2. Fall back to extension bridge (deprecated when WSH is available)
  const client = _extClient;
  if (!client || !client.connected) return null;

  // Emit deprecation if WSH could have handled this but didn't
  // (e.g., the WSH fetch itself failed but connections exist)
  if (hasWshTransport()) {
    _emitBridgeDeprecation(url);
  }

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
