---
title: "Channels"
---

All channel adapters, Channel Gateway, scope isolation, routing

---

### ChannelManager

**Status:** ✅ Implemented · **Category:** core · **Since:** v1.0.0

Central channel orchestration class. Manages channel registration, connection lifecycle, message routing, and history. Normalizes all inbound messages to the InboundMessage format. Provides tools for agent interaction with channels. Approximately 1,814 LOC across the channel subsystem.

**Source files:**

- `web/clawser-channels.js`
- `web/clawser-channels.d.ts`

**API surface:**

- `ChannelManager`
- `ChannelManager.addChannel`
- `ChannelManager.removeChannel`
- `ChannelManager.getChannel`
- `ChannelManager.listChannels`
- `ChannelManager.connect`
- `ChannelManager.disconnect`
- `ChannelManager.handleInbound`
- `ChannelManager.send`
- `ChannelManager.getHistory`
- `ChannelManager.clearHistory`
- `ChannelManager.formatForAgent`
- `ChannelManager.buildPrompt`

> **Note:** CHANNEL_TYPES constant defines: WEBHOOK, TELEGRAM, DISCORD, SLACK, MATRIX, EMAIL, IRC. Each channel has a ChannelConfig with name, enabled, allowedUsers, allowedChannels, and secret.

**See also:**

- Channel Gateway

---

### Channel Gateway

**Status:** ✅ Implemented · **Category:** gateway · **Since:** v1.0.0

Per-channel serialized message queue gateway. All channel plugins register with the gateway, which provides per-channel queuing, scope isolation (isolated, shared, grouped), and response routing back to the originating plugin. Prevents concurrent message processing conflicts.

**Source files:**

- `web/clawser-gateway.js`

**API surface:**

- `ChannelGateway`

**See also:**

- ChannelManager

---

### Gateway Server

**Status:** ✅ Implemented · **Category:** gateway · **Since:** v1.5.0

Server-side channel gateway for hosting channel bridges as a service.

**Source files:**

- `web/clawser-gateway-server.js`

**API surface:**

- `GatewayServer`

---

### Message Normalization

**Status:** ✅ Implemented · **Category:** normalization · **Since:** v1.0.0

All inbound messages from any channel are normalized to the InboundMessage format with id, channel type, channelId, sender (id, name, username), content, attachments, replyTo, and timestamp. formatForChannel() converts outbound messages to channel-specific format.

**Source files:**

- `web/clawser-channels.js`
- `web/clawser-channels.d.ts`

**API surface:**

- `createInboundMessage`
- `createChannelConfig`
- `isMessageAllowed`
- `formatForChannel`
- `InboundMessage`
- `InboundMessageSender`

---

### Discord Channel

**Status:** ✅ Implemented · **Category:** adapter · **Since:** v1.0.0

Discord bot integration via WebSocket gateway. Supports text channels in guilds. Requires Discord bot token. Fully self-contained — no server needed, the browser tab connects directly to Discord's Gateway. Add via the Channels panel (type "discord") — this constructs a real DiscordPlugin and registers it with ChannelGateway, not just a config-only entry.

**Source files:**

- `web/clawser-channel-discord.js`
- `web/clawser-ui-channels.js`

**API surface:**

- `DiscordPlugin`

> **Note:** Default gateway intents (33281 = GUILDS + GUILD_MESSAGES + MESSAGE_CONTENT) do NOT include DIRECT_MESSAGES, so DMs are not received out of the box. Pass a custom `intents` bitmask (opts.intents, with the DIRECT_MESSAGES bit added) to receive DMs.

**See also:**

- [Setup walkthrough](../docs/channel-setup/discord.md)

---

### Slack Channel

**Status:** ✅ Implemented · **Category:** adapter · **Since:** v1.0.0

Slack integration via Socket Mode (WebSocket, self-contained — same pattern as Discord's Gateway) when an appToken is configured, or the classic Events API webhook for deployments that run their own relay. Outbound sends via the Web API (chat.postMessage). Add via the Channels panel (type "slack") — this constructs a real SlackPlugin and registers it with ChannelGateway, not just a config-only entry.

**Source files:**

- `web/clawser-channel-slack.js`
- `web/clawser-ui-channels.js`

**API surface:**

- `SlackPlugin`

> **Note:** Fully self-contained via Socket Mode — no server needed, the browser tab connects directly to Slack using an app-level token (xapp-...). The webhook path (handleEvent()) still works for anyone who'd rather run their own relay/server instead.

**See also:**

- [Setup walkthrough](../docs/channel-setup/slack.md)

---

### Telegram Channel

**Status:** ✅ Implemented · **Category:** adapter · **Since:** v1.0.0

Telegram bot integration via long-polling. Supports text messages only — `createInboundMessage()` hardcodes `attachments: []` and there is no image or inline-keyboard support (inbound or outbound). Fully self-contained — no server needed. Add via the Channels panel (type "telegram") — this constructs a real TelegramPlugin and registers it with ChannelGateway, not just a config-only entry.

**Source files:**

- `web/clawser-channel-telegram.js`
- `web/clawser-ui-channels.js`

**API surface:**

- `TelegramPlugin`

> **Note:** Requires bot token from BotFather. Images/attachments and inline keyboards are not implemented; tracked as a gap, not a documentation omission.

**See also:**

- [Setup walkthrough](../docs/channel-setup/telegram.md)

---

### Email Channel

**Status:** ✅ Implemented · **Category:** adapter · **Since:** v2.0.0

IMAP polling (via a wsh-based fetch proxy) + SMTP/Gmail API send. Normalizes inbound messages via createInboundMessage(). Add via the Channels panel (type "email") — the form's flat username/password fields are combined into a credentials object at construction time (EmailPlugin's real constructor shape).

**Source files:**

- `web/clawser-channel-email.js`
- `web/clawser-ui-channels.js`

**API surface:**

- `EmailPlugin`

> **Note:** Was fully built and tested (15 tests) but never actually instantiated anywhere in the app until it was wired into the Channels panel's start/stop flow.

---

### IRC Channel

**Status:** ✅ Implemented · **Category:** adapter · **Since:** v1.0.0

IRC client integration with channel and private message support. Connects to IRC servers via WebSocket bridge. Add via the Channels panel (type "irc") — this constructs a real IrcPlugin and registers it with ChannelGateway, not just a config-only entry. Supports a single channel per configured connection (IrcPlugin.config.channel), not multiple.

**Source files:**

- `web/clawser-channel-irc.js`
- `web/clawser-ui-channels.js`

**API surface:**

- `IrcPlugin`

> **Note:** Bring your own server: the `server` field must be a `wss://` URL for a WebSocket-to-IRC gateway, not a raw IRC address — browsers can't open plain TCP sockets. Point it at a public WS-IRC bridge (e.g. the kind IRC web clients use) or run your own.

---

### Matrix Channel

**Status:** ✅ Implemented · **Category:** adapter · **Since:** v1.0.0

Matrix protocol integration for decentralized chat. Supports encrypted rooms via Olm. Connects to any Matrix homeserver. Add via the Channels panel (type "matrix") — the form's homeserverUrl field is mapped to MatrixPlugin's real constructor field (homeserver) at construction time.

**Source files:**

- `web/clawser-channel-matrix.js`
- `web/clawser-ui-channels.js`

**API surface:**

- `MatrixPlugin`

> **Note:** Bring your own homeserver: works directly from the browser via the Matrix client-server API's long-poll /sync — no bridge needed, unlike IRC. Point homeserverUrl at any Matrix homeserver you have an account (and access token) on, self-hosted or matrix.org.

---

### Relay Channel

**Status:** ✅ Implemented · **Category:** adapter · **Since:** v1.5.0

Virtual webhook server route + BroadcastChannel relay for bridging messages between Clawser instances or external systems. Add via the Channels panel (type "webhook") — this constructs a real ChannelRelay and registers it with ChannelGateway. The cross-tab BroadcastChannel relay half works standalone once registered; the virtual-server webhook-receiving half (handleWebhook()) still needs to be wired to the app's virtual server routing (clawser-server.js) separately.

**Source files:**

- `web/clawser-channel-relay.js`
- `web/clawser-ui-channels.js`

**API surface:**

- `ChannelRelay`

---

### TabWatch Channel

**Status:** ✅ Implemented · **Category:** adapter · **Since:** v1.5.0

Browser tab monitoring channel. Watches for changes in specified browser tabs and routes events as inbound messages to the agent.

**Source files:**

- `web/clawser-channel-tabwatch.js`

**API surface:**

- `TabWatcherPlugin`

---

### Channel Tools

**Status:** ✅ Implemented · **Category:** tools · **Since:** v1.0.0

Five agent tools for channel interaction: channel_list, channel_send, channel_history, channel_create, channel_delete.

**Source files:**

- `web/clawser-channels.js`
- `web/clawser-channels.d.ts`

**API surface:**

- `ChannelListTool`
- `ChannelSendTool`
- `ChannelHistoryTool`
- `ChannelCreateTool`
- `ChannelDeleteTool`

---

---

[← Mesh](/docs/guide/mesh/) | [Index](/docs/) | [Ui →](/docs/guide/ui/)
