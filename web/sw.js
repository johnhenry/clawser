// sw.js — Service Worker for Clawser PWA (cache-first for app shell)

const CACHE_NAME = 'clawser-v2';

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
