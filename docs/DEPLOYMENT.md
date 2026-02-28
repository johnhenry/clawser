# Deployment

Clawser is a pure client-side application — no backend server required. All processing happens in the browser.

## Static File Server

Serve the `web/` directory with any HTTP server:

```bash
# Python
python3 -m http.server 8080

# Node.js (npx)
npx serve .

# Deno
deno run --allow-net --allow-read https://deno.land/std/http/file_server.ts
```

Open `http://localhost:8080/web/` in Chrome 131+.

## Docker

```bash
docker build -t clawser .
docker run -p 8080:80 clawser
```

## Requirements

- **Browser**: Chrome 131+ (for Chrome AI / Prompt API support)
- **HTTPS**: Required for Service Worker and OPFS in production
- **MIME types**: Server must serve `.js` files as `application/javascript`

## API Keys

API keys for external providers (OpenAI, Anthropic, etc.) are stored in the browser's `localStorage`. They never leave the client unless sent directly to the provider's API endpoint.

## OPFS Storage

Clawser uses the Origin Private File System (OPFS) for:
- Workspace files
- Conversation checkpoints
- Skill installations
- Event logs

Storage is scoped to the origin. Clearing browser data will remove all OPFS content.

## PWA Installation

Clawser includes a `manifest.json` for PWA installation. When served over HTTPS, users can install it as a standalone app via Chrome's install prompt.

## Demo Mode

Append `?demo` or `?demo=true` to the URL to start Clawser in demo mode:

```
http://localhost:8080/web/?demo=true
```

Demo mode:
- Skips the vault passphrase prompt on startup
- Forces the **Echo** provider (no LLM or API key required)
- Shows a blue banner indicating demo mode is active

Use `?demo=false` to explicitly disable demo mode. This is useful for live demos, screenshots, and letting users explore the UI without configuring an API key. The Echo provider mirrors back user messages, so tool calling and streaming are not exercised.

## Service Worker

The included `web/sw.js` provides stale-while-revalidate caching for the app shell. Register it in production by uncommenting the SW registration in `index.html` or adding:

```js
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/web/sw.js');
}
```
