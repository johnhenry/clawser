// sw.js — Service Worker for Clawser PWA (cache-first for app shell)

const CACHE_NAME = 'clawser-v1';

const APP_SHELL = [
  '/web/',
  '/web/index.html',
  '/web/clawser.css',
  '/web/clawser-app.js',
  '/web/clawser-state.js',
  '/web/clawser-router.js',
  '/web/clawser-agent.js',
  '/web/clawser-providers.js',
  '/web/clawser-tools.js',
  '/web/clawser-codex.js',
  '/web/clawser-shell.js',
  '/web/clawser-shell-builtins.js',
  '/web/clawser-skills.js',
  '/web/clawser-mcp.js',
  '/web/clawser-ui-chat.js',
  '/web/clawser-ui-panels.js',
  '/web/clawser-ui-files.js',
  '/web/clawser-ui-memory.js',
  '/web/clawser-ui-goals.js',
  '/web/clawser-ui-config.js',
  '/web/clawser-modal.js',
  '/web/clawser-workspaces.js',
  '/web/clawser-item-bar.js',
  '/web/clawser-home-views.js',
  '/web/clawser-route-handler.js',
  '/web/clawser-workspace-lifecycle.js',
  '/web/manifest.json',
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
