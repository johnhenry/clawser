# Telegram channel setup

Telegram support polls the Bot API's `getUpdates` endpoint from the browser
tab (long-polling, default 30s timeout, checked every 3s) — no server or
relay needed. This is a fully-working, self-contained setup.

## 1. Create a bot with BotFather

1. Open a chat with [@BotFather](https://t.me/BotFather) in Telegram.
2. Send `/newbot` and follow the prompts (choose a name and a username ending in `bot`).
3. BotFather replies with your **Bot Token** — a string like `123456789:ABCdefGhIJKlmNoPQRsTUVwxyZ`. Keep it secret.

## 2. Get a Chat ID

The chat ID is whichever conversation you want the bot to read/write —
your own DM with the bot, a group, or a channel.

**Easiest way:** send any message to your bot (or add it to a group), then
visit this URL in your browser (replace `<TOKEN>`):

```
https://api.telegram.org/bot<TOKEN>/getUpdates
```

Look for `"chat":{"id": ...}` in the JSON response — that number (can be
negative for groups) is your **Chat ID**.

If a group, make sure to **disable Privacy Mode** for the bot first
(`/setprivacy` in BotFather → select your bot → **Disable**), or it will
only see messages that start with `/` or explicitly mention it.

## 3. Configure in Clawser

Open the **Channels** panel, add a new **Telegram** channel, and fill in:

| Field | Value |
|-------|-------|
| Bot Token | the token from step 1 |
| Chat ID | the id from step 2 |

Click **Connect**. Clawser starts polling `getUpdates` every ~3 seconds;
replies go out via `sendMessage`.

## Troubleshooting

- **Getting old/duplicate messages on connect** — the adapter tracks an
  internal `offset` starting at 0, so the very first poll after connecting
  can surface a backlog of unread updates from before Clawser was running.
  This clears after the first poll.
- **Bot doesn't see group messages** — check Privacy Mode (step 2).
- **429 Too Many Requests** — you have another poller running against the
  same bot token elsewhere (e.g. a second Clawser tab, or a leftover
  process). Telegram allows only one long-poll consumer per bot at a time.

See also: [`web/clawser-channel-telegram.js`](../../web/clawser-channel-telegram.js).
