# Slack channel setup

Slack is fully self-contained via **Socket Mode** — the browser tab opens a
WebSocket directly to Slack, the same pattern used by the Discord channel's
Gateway connection. No server, relay, or public HTTPS endpoint required.

(If you'd rather run your own relay/server and use Slack's classic Events
API webhook instead, see [Alternative: Events API webhook](#alternative-events-api-webhook)
below — `SlackPlugin.handleEvent(payload)` still supports that path.)

## 1. Create a Slack app

1. Go to [api.slack.com/apps](https://api.slack.com/apps) → **Create New App** → **From scratch**. Name it and pick your workspace.
2. Under **OAuth & Permissions**, add these **Bot Token Scopes**: `chat:write`, `channels:history` (or `groups:history` for private channels), `channels:read`.
3. Click **Install to Workspace**, authorize it, and copy the **Bot User OAuth Token** (starts with `xoxb-`) — this is your **Bot Token**.

## 2. Enable Socket Mode and get an app-level token

1. Under **Settings → Socket Mode**, toggle **Enable Socket Mode** on.
2. This prompts you to generate an **App-Level Token** — give it the
   `connections:write` scope and copy the token (starts with `xapp-`). This
   is your **App Token**.
3. Under **Event Subscriptions**, toggle it on (no Request URL needed in
   Socket Mode) and subscribe to the `message.channels` bot event (and
   `message.groups` for private channels).

## 3. Get a Channel ID

Right-click the channel in Slack → **View channel details** → the ID is at
the bottom of that panel (starts with `C`). Invite the bot to the channel
(`/invite @your-bot-name`) or it won't be able to post or read there.

## 4. Configure in Clawser

Open the **Channels** panel, add a new **Slack** channel, and fill in:

| Field | Value |
|-------|-------|
| Bot Token | the `xoxb-...` token from step 1 |
| App Token | the `xapp-...` token from step 2 |
| Channel | the channel ID from step 3 |
| Signing Secret | optional — only needed for the webhook alternative below |

With both Bot Token and App Token set, the plugin opens
`apps.connections.open`, connects a WebSocket to the URL Slack returns, and
starts receiving messages immediately — no further setup needed. It
reconnects automatically (with backoff) if the socket drops, and handles
Slack's `disconnect` envelope (sent ahead of a periodic connection refresh)
by reconnecting.

## Alternative: Events API webhook

If you'd rather not use Socket Mode (e.g. you're already running a server
for this bot), Clawser also supports the classic Events API webhook path:

1. Under **Basic Information → App Credentials**, copy the **Signing
   Secret** — used to verify that inbound webhook requests really came from
   Slack.
2. Under **Event Subscriptions**, set the **Request URL** to your own relay
   (a Cloudflare Worker, a small Node/Express endpoint plus a tunnel like
   `ngrok`/`cloudflared` for development, etc.) that forwards the raw POST
   body into a running Clawser instance and calls
   `slackPlugin.handleEvent(payload)`.
3. Your relay must answer Slack's URL verification challenge (an
   unauthenticated POST with `{"type":"url_verification","challenge":"..."}`
   that expects the `challenge` value echoed back as plain text) before
   Slack will accept the subscription. `handleEvent()` already returns
   `{ challenge }` for this — your relay just needs to send it back as the
   response body.
4. Use `verifySignature(timestamp, body, signature)` in your relay to check
   the `X-Slack-Request-Timestamp` / `X-Slack-Signature` headers against the
   Signing Secret before trusting the payload.

Outbound sending (`chat.postMessage`) works the same way regardless of
which inbound path you use.

## Troubleshooting

- **Socket Mode never connects (no messages arrive)** — usually a missing
  `connections:write` scope on the App-Level Token, or the app hasn't been
  reinstalled to the workspace since Bot Token Scopes were last changed.
  Scope changes only take effect after reinstalling.
- **`not_in_channel` error when sending** — the bot must be invited to the
  channel (`/invite @your-bot-name`); being installed to the workspace
  isn't enough on its own.
- **`missing_scope` on send** — add the missing scope under **OAuth &
  Permissions** and reinstall the app.
- **Reconnect loop** — the Socket Mode connection retries up to 10 times
  with exponential backoff (starting at 1s, capped at 60s) before giving
  up silently; nothing is logged to the console, so toggle the channel off
  and on to force a fresh connection attempt.
- **401/`invalid_auth`** — on send, the Bot Token (`xoxb-...`) is wrong or
  was regenerated; on connect, it's the App Token (`xapp-...`) — regenerate
  it under **Basic Information → App-Level Tokens**.

See also: [`web/clawser-channel-slack.js`](../../web/clawser-channel-slack.js).
