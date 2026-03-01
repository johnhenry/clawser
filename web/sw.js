// sw.js — Service Worker for Clawser PWA (cache-first for app shell + virtual server)

const CACHE_NAME = 'clawser-v2';

// ── Virtual Server Subsystem (Phase 7) ──────────────────────────

const SERVER_DB_NAME = 'clawser-server-routes';
const SERVER_DB_VERSION = 1;
const SERVER_STORE = 'routes';

/** Open (or create) the server route IndexedDB. Caches the connection. */
let _serverDB = null;
function openServerDB() {
  if (_serverDB) return Promise.resolve(_serverDB);
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(SERVER_DB_NAME, SERVER_DB_VERSION);
    req.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains(SERVER_STORE)) {
        const store = db.createObjectStore(SERVER_STORE, { keyPath: 'id' });
        store.createIndex('host_port', ['hostname', 'port'], { unique: false });
        store.createIndex('scope', 'scope', { unique: false });
      }
    };
    req.onsuccess = () => { _serverDB = req.result; resolve(_serverDB); };
    req.onerror = () => reject(req.error);
  });
}

/** SSRF check: returns true if hostname is a private/reserved address. */
function isPrivateAddress(hostname) {
  return /^(127\.|10\.|172\.(1[6-9]|2\d|3[01])\.|192\.168\.|0\.|169\.254\.|fc|fd|fe80|::ffff:|0x|0177)/i.test(hostname) ||
    /^\d+$/.test(hostname) ||
    hostname === 'localhost' || hostname === '::1' || hostname === '[::1]';
}

/**
 * Parse a `/http/{host}[:{port}]/{path}` URL into components.
 * Supports: bare names, domains, IPv4, IPv6 (bracketed).
 * @param {string} urlStr - Full request URL
 * @returns {{ hostname: string, port: number, path: string } | null}
 */
function parseServerUrl(url) {
  // Match /http/ prefix (may be under /web/http/ depending on SW scope)
  const scopePath = self.registration?.scope ? new URL(self.registration.scope).pathname : '/';
  const rel = url.pathname.startsWith(scopePath)
    ? url.pathname.slice(scopePath.length)
    : url.pathname.slice(1); // strip leading /

  const match = /^http\/(.+)/.exec(rel);
  if (!match) return null;

  const rest = match[1]; // everything after "http/"

  let hostname, port, path;

  // IPv6: [addr]:port/path or [addr]/path
  if (rest.startsWith('[')) {
    const bracketEnd = rest.indexOf(']');
    if (bracketEnd === -1) return null;
    hostname = rest.slice(1, bracketEnd); // strip brackets for consistent storage
    const after = rest.slice(bracketEnd + 1);
    if (after.startsWith(':')) {
      const slashIdx = after.indexOf('/');
      port = parseInt(after.slice(1, slashIdx === -1 ? undefined : slashIdx), 10);
      path = slashIdx === -1 ? '/' : after.slice(slashIdx);
    } else {
      port = 80;
      path = after.startsWith('/') ? after : '/' + after;
    }
  } else {
    // host:port/path or host/path
    const slashIdx = rest.indexOf('/');
    const hostPort = slashIdx === -1 ? rest : rest.slice(0, slashIdx);
    path = slashIdx === -1 ? '/' : rest.slice(slashIdx);

    const colonIdx = hostPort.lastIndexOf(':');
    if (colonIdx !== -1 && /^\d+$/.test(hostPort.slice(colonIdx + 1))) {
      hostname = hostPort.slice(0, colonIdx);
      port = parseInt(hostPort.slice(colonIdx + 1), 10);
    } else {
      hostname = hostPort;
      port = 80;
    }
  }

  if (!hostname) return null;
  // Append query string to path
  if (url.search) path += url.search;
  return { hostname: hostname.toLowerCase(), port, path };
}

/**
 * Look up a route in IndexedDB by hostname + port.
 * Returns the best match: per-workspace routes over global.
 */
async function lookupRoute(hostname, port) {
  const db = await openServerDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(SERVER_STORE, 'readonly');
    const store = tx.objectStore(SERVER_STORE);
    const idx = store.index('host_port');
    const req = idx.getAll([hostname, port]);
    req.onsuccess = () => {
      const routes = (req.result || []).filter(r => r.enabled);
      if (routes.length === 0) { resolve(null); return; }
      // Per-workspace takes priority over global
      const wsRoute = routes.find(r => r.scope !== '_global');
      resolve(wsRoute || routes[0]);
    };
    req.onerror = () => reject(req.error);
  });
}

/**
 * Handle a server request matched by parseServerUrl.
 * Looks up route, dispatches to SW-mode or page-mode handler.
 */
async function handleServerRequest(parsed, request) {
  const { hostname, port, path } = parsed;

  const route = await lookupRoute(hostname, port);
  if (!route) {
    return new Response(JSON.stringify({ error: 'Not Found', hostname, port, path }), {
      status: 404,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const execution = route.handler?.execution || 'page';

  if (execution === 'sw') {
    return handleSWExecution(route, path, request);
  }

  // Default: relay to a client page via MessageChannel
  return handlePageExecution(route, parsed, request);
}

/**
 * Execute handler directly in the Service Worker context.
 * Supports inline code and proxy handler types.
 */
async function handleSWExecution(route, path, request) {
  const handler = route.handler;

  // Proxy handler
  if (handler.type === 'proxy' && handler.proxyTarget) {
    return handleSWProxy(handler, path, request);
  }

  // Inline function handler (limited — no DOM, no agent access)
  // Note: dynamic import() is not supported in Service Workers, so we use
  // new Function() to evaluate handler code. Handlers must assign to `exports`.
  if (handler.type === 'function' && handler.code) {
    try {
      // Wrap code so `export default fn` patterns work as `exports.default = fn`
      const wrapped = handler.code
        .replace(/export\s+default\s+/g, 'exports.default = ')
        .replace(/export\s+(const|let|var|function|async\s+function)\s+(\w+)/g, '$1 $2; exports.$2 = $2');
      const exports = {};
      (new Function('exports', wrapped))(exports);
      const method = request.method;
      const methodKey = `onRequest${method.charAt(0).toUpperCase() + method.slice(1).toLowerCase()}`;
      const fn = exports[methodKey] || exports.default;
      if (typeof fn !== 'function') {
        return new Response('Handler has no default export or method handler', { status: 500 });
      }
      const innerReq = new Request(
        `http://${route.hostname}:${route.port}${path}`,
        {
          method: request.method,
          headers: request.headers,
          body: ['GET', 'HEAD'].includes(request.method) ? undefined : request.body,
        }
      );
      return await fn({ request: innerReq, env: route.env || {} });
    } catch (e) {
      return new Response(`SW handler error: ${e.message}`, { status: 500 });
    }
  }

  return new Response('SW execution not supported for this handler type', { status: 501 });
}

/** Proxy handler: rewrite URL, forward request, inject headers. */
async function handleSWProxy(handler, path, request) {
  if (!handler.proxyTarget) {
    return new Response('Proxy handler missing proxyTarget', { status: 500 });
  }

  // SSRF check: block proxying to private/reserved addresses
  try {
    const targetHost = new URL(handler.proxyTarget).hostname.toLowerCase();
    if (isPrivateAddress(targetHost)) {
      return new Response(`Proxy to private address "${targetHost}" blocked`, { status: 403 });
    }
  } catch { /* proxyTarget may not be a full URL — checked below */ }

  let targetPath = path;
  if (handler.proxyRewrite) {
    try {
      const arrowIdx = handler.proxyRewrite.indexOf('->');
      if (arrowIdx !== -1) {
        const pattern = handler.proxyRewrite.slice(0, arrowIdx).trim();
        const replacement = handler.proxyRewrite.slice(arrowIdx + 2).trim();
        if (pattern) targetPath = path.replace(new RegExp(pattern), replacement);
      }
    } catch { /* ignore bad rewrite rules */ }
  }

  const targetUrl = handler.proxyTarget.replace(/\/$/, '') + targetPath;

  const headers = new Headers(request.headers);
  // Inject configured headers
  if (handler.proxyHeaders) {
    for (const [k, v] of Object.entries(handler.proxyHeaders)) {
      headers.set(k, v);
    }
  }
  headers.set('X-Forwarded-Host', request.headers.get('Host') || '');

  try {
    const resp = await fetch(targetUrl, {
      method: request.method,
      headers,
      body: ['GET', 'HEAD'].includes(request.method) ? undefined : request.body,
      redirect: 'follow',
    });
    return resp;
  } catch (e) {
    return new Response(`Proxy error: ${e.message}`, { status: 502 });
  }
}

/**
 * Relay request to a client page via MessageChannel.
 * The client executes the handler with full agent/tool/DOM access.
 */
async function handlePageExecution(route, parsed, request) {
  const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: false });
  if (clients.length === 0) {
    return new Response('No active Clawser client tab', { status: 503 });
  }

  // Pick the first visible client, or fallback to any client
  const client = clients.find(c => c.visibilityState === 'visible') || clients[0];

  // Build pseudo-request (transferable)
  const method = request.method;
  const headers = [...request.headers.entries()];
  let body = null;
  if (!['GET', 'HEAD'].includes(method)) {
    try { body = await request.arrayBuffer(); } catch { body = null; }
  }

  const pseudoRequest = {
    url: parsed.path,
    method,
    headers,
    hostname: parsed.hostname,
    port: parsed.port,
    routeId: route.id,
  };

  const messageChannel = new MessageChannel();

  return new Promise((resolve) => {
    const timeout = setTimeout(() => {
      messageChannel.port1.onmessage = null;
      messageChannel.port1.close();
      resolve(new Response('Page handler timeout', { status: 504 }));
    }, 30000);

    messageChannel.port1.onmessage = ({ data }) => {
      clearTimeout(timeout);
      messageChannel.port1.close();
      if (data.error) {
        resolve(new Response(data.error, { status: 500 }));
        return;
      }
      const { pseudoResponse } = data;
      resolve(new Response(pseudoResponse.body, {
        status: pseudoResponse.status || 200,
        statusText: pseudoResponse.statusText || 'OK',
        headers: new Headers(pseudoResponse.headers || []),
      }));
    };

    const transferables = [messageChannel.port2];
    if (body) {
      pseudoRequest.body = body;
      transferables.push(body);
    }

    client.postMessage({
      type: 'server-fetch',
      port: messageChannel.port2,
      pseudoRequest,
    }, transferables);
  });
}

const APP_SHELL = [
  '/web/',
  '/web/index.html',
  '/web/bench.html',
  '/web/test.html',
  '/web/clawser.css',
  '/web/manifest.json',
  '/web/icons/icon.svg',
  '/web/clawser-accounts.js',
  '/web/clawser-agent.js',
  '/web/clawser-agent-ref.js',
  '/web/clawser-agent-storage.js',
  '/web/clawser-app.js',
  '/web/clawser-auth-profiles.js',
  '/web/clawser-browser-auto.js',
  '/web/clawser-extension-tools.js',
  '/web/clawser-channels.js',
  '/web/clawser-cli.js',
  '/web/clawser-cmd-palette.js',
  '/web/clawser-codex.js',
  '/web/clawser-conversations.js',
  '/web/clawser-daemon.js',
  '/web/clawser-delegate.js',
  '/web/clawser-fallback.js',
  '/web/clawser-git.js',
  '/web/clawser-goals.js',
  '/web/clawser-hardware.js',
  '/web/clawser-heartbeat.js',
  '/web/clawser-home-views.js',
  '/web/clawser-identity.js',
  '/web/clawser-intent.js',
  '/web/clawser-log.js',
  '/web/clawser-item-bar.js',
  '/web/clawser-keys.js',
  '/web/clawser-mcp.js',
  '/web/clawser-memory.js',
  '/web/clawser-metrics.js',
  '/web/clawser-modal.js',
  '/web/clawser-mount.js',
  '/web/clawser-oauth.js',
  '/web/clawser-providers.js',
  '/web/clawser-remote.js',
  '/web/clawser-route-handler.js',
  '/web/clawser-router.js',
  '/web/clawser-routines.js',
  '/web/clawser-safety.js',
  '/web/clawser-sandbox.js',
  '/web/clawser-self-repair.js',
  '/web/clawser-server.js',
  '/web/clawser-server-tools.js',
  '/web/clawser-ui-servers.js',
  '/web/clawser-shell.js',
  '/web/clawser-shell-builtins.js',
  '/web/clawser-skills.js',
  '/web/clawser-state.js',
  '/web/clawser-terminal-sessions.js',
  '/web/clawser-tool-builder.js',
  '/web/clawser-tools.js',
  '/web/clawser-ui-chat.js',
  '/web/clawser-ui-config.js',
  '/web/clawser-ui-files.js',
  '/web/clawser-ui-goals.js',
  '/web/clawser-ui-memory.js',
  '/web/clawser-ui-panels.js',
  '/web/clawser-undo.js',
  '/web/clawser-vault.js',
  '/web/clawser-workspace-lifecycle.js',
  '/web/clawser-wsh-tools.js',
  '/web/clawser-workspaces.js',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((names) =>
      Promise.all(
        names
          .filter((name) => name !== CACHE_NAME)
          .map((name) => caches.delete(name))
      )
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // ── Virtual server intercept (Phase 7) — runs before cache logic ──
  if (url.origin === location.origin) {
    const serverMatch = parseServerUrl(url);
    if (serverMatch) {
      event.respondWith(handleServerRequest(serverMatch, event.request));
      return;
    }
  }

  // Cache-first for app shell (same-origin JS, CSS, HTML)
  if (url.origin === location.origin) {
    event.respondWith(
      caches.match(event.request).then((cached) => {
        if (cached) {
          // Return cached, but refresh in background (stale-while-revalidate)
          const fetchPromise = fetch(event.request).then((response) => {
            if (response.ok) {
              const clone = response.clone();
              caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
            }
            return response;
          }).catch(() => cached);
          return cached;
        }
        return fetch(event.request);
      })
    );
    return;
  }

  // Network-first for CDN/external resources
  event.respondWith(
    fetch(event.request).catch(() => caches.match(event.request))
  );
});
