# Discord channel setup

Discord support connects directly from the browser tab to Discord's real-time
Gateway (WebSocket) and REST API — no server or relay needed. This is a
fully-working, self-contained setup.

## 1. Create a Discord application + bot

1. Go to the [Discord Developer Portal](https://discord.com/developers/applications) and click **New Application**. Name it anything (e.g. "My Clawser Agent").
2. In the left sidebar, open **Bot**. Click **Reset Token** (or **Add Bot** if this is the first time) and copy the token — this is your **Bot Token**. Keep it secret; anyone with it can control the bot.
3. Under **Privileged Gateway Intents** (same Bot page), enable **Message Content Intent**. Clawser's Discord adapter requests the `GUILDS` + `GUILD_MESSAGES` + `MESSAGE_CONTENT` intents by default, and Discord requires this toggle before it will send message content over the Gateway.

## 2. Invite the bot to your server

1. In the left sidebar, open **OAuth2 → URL Generator**.
2. Under **Scopes**, check `bot`.
3. Under **Bot Permissions**, check at least **Send Messages**, **Read Message History**, and **View Channels**.
4. Copy the generated URL, open it in a browser, and select the server (guild) to add the bot to.

## 3. Get your Guild ID

1. In Discord, enable **Developer Mode**: User Settings → Advanced → Developer Mode.
2. Right-click your server's icon in the sidebar → **Copy Server ID**. This is your **Guild ID**.

## 4. Configure in Clawser

Open the **Channels** panel, add a new **Discord** channel, and fill in:

| Field | Value |
|-------|-------|
| Bot Token | the token from step 1 |
| Guild ID | the server ID from step 3 |

Click **Connect**. Clawser opens a Gateway WebSocket connection and starts
receiving `MESSAGE_CREATE` events for every guild and channel the bot has
been added to — the Gateway connection itself isn't scoped to a single
guild, and the **Guild ID** field is currently just stored alongside the
channel config rather than used to filter inbound events. If you need to
restrict which channels the agent reacts to, use the channel manager's
`allowedChannels`/`allowedUsers` config instead. Replies go out over the
Discord REST API (`POST /channels/{id}/messages`).

## Troubleshooting

- **Bot connects but never receives messages** — almost always the missing
  **Message Content Intent** toggle from step 1. Discord silently omits
  `content` from message events without it.
- **401/403 on send** — the bot token is wrong, or the bot lacks the
  **Send Messages** permission in that channel/server.
- **Reconnect loop** — the adapter retries up to 10 times with exponential
  backoff (starting at 5s, capped at 60s) before giving up silently; it
  doesn't log the Gateway close code anywhere, so if reconnects keep
  failing, open DevTools → Network → WS to inspect the closed frame, or
  toggle the channel off and on to trigger a fresh connection attempt (a
  successful reconnect resets the retry count).

See also: [`web/clawser-channel-discord.js`](../../web/clawser-channel-discord.js).
