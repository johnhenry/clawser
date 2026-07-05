# Slack channel setup

**Known limitation up front:** Slack's Events API delivers messages by
**POSTing to a public HTTPS URL you control** — unlike Discord (outbound
Gateway WebSocket) or Telegram (outbound long-polling), there's no way for
a browser tab alone to receive them. `SlackPlugin.handleEvent(payload)`
implements the receiving side, but nothing in Clawser currently exposes
that method to the internet — you need to run your own small relay that
forwards Slack's webhook POST body into a running Clawser instance (a
Cloudflare Worker, a tiny local Node/Express endpoint plus a tunnel like
`ngrok`/`cloudflared` for development, etc.) and calls `handleEvent()` in
that page — this glue code doesn't ship yet. Sending messages (outbound,
via `chat.postMessage`) already works standalone. Track this as an open
item if you plan to rely on Slack; Discord or Telegram are fully
self-contained if you don't need Slack specifically.

## 1. Create a Slack app

1. Go to [api.slack.com/apps](https://api.slack.com/apps) → **Create New App** → **From scratch**. Name it and pick your workspace.
2. Under **OAuth & Permissions**, add these **Bot Token Scopes**: `chat:write`, `channels:history` (or `groups:history` for private channels), `channels:read`.
3. Click **Install to Workspace**, authorize it, and copy the **Bot User OAuth Token** (starts with `xoxb-`) — this is your **Bot Token**.
4. Under **Basic Information → App Credentials**, copy the **Signing Secret** — used to verify that inbound webhook requests really came from Slack.

## 2. Get a Channel ID

Right-click the channel in Slack → **View channel details** → the ID is at
the bottom of that panel (starts with `C`). Invite the bot to the channel
(`/invite @your-bot-name`) or it won't be able to post or read there.

## 3. Set up the Events API webhook (the part that needs a relay)

1. Under **Event Subscriptions**, toggle it on and set the **Request URL**
   to wherever your relay is running (see the limitation note above — this
   is not a Clawser-hosted URL).
2. Subscribe to the `message.channels` bot event (and `message.groups` for
   private channels).
3. Your relay must answer Slack's URL verification challenge (an
   unauthenticated POST with `{"type":"url_verification","challenge":"..."}`
   that expects the `challenge` value echoed back as plain text) before
   Slack will accept the subscription.

## 4. Configure in Clawser

Open the **Channels** panel, add a new **Slack** channel, and fill in:

| Field | Value |
|-------|-------|
| Bot Token | the `xoxb-...` token from step 1 |
| Channel | the channel ID from step 2 |
| Signing Secret | the signing secret from step 1 |

Outbound sending (`chat.postMessage`) works immediately after this. Inbound
receiving requires the relay from step 3.

See also: [`web/clawser-channel-slack.js`](../../web/clawser-channel-slack.js).
