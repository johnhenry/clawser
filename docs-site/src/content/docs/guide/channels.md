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

Discord bot integration via WebSocket gateway. Supports text channels and DMs. Requires Discord bot token.

**Source files:**

- `web/clawser-channel-discord.js`

**API surface:**

- `DiscordChannel`

---

### Slack Channel

**Status:** ⚠️ Partial · **Category:** adapter · **Since:** v1.0.0

Slack integration via Socket Mode. Text messages and thread replies supported. Slash commands planned for future release.

**Source files:**

- `web/clawser-channel-slack.js`

**API surface:**

- `SlackChannel`

> **Note:** Requires Slack bot token and app-level token for Socket Mode.

---

### Telegram Channel

**Status:** ✅ Implemented · **Category:** adapter · **Since:** v1.0.0

Telegram bot integration via long-polling. Supports text messages, images, and inline keyboards.

**Source files:**

- `web/clawser-channel-telegram.js`

**API surface:**

- `TelegramChannel`

> **Note:** Requires bot token from BotFather.

---

### Email Channel

**Status:** 📋 Planned · **Category:** adapter · **Since:** v2.0.0

IMAP/SMTP email channel for receiving and sending email as the agent. Will support HTML and plain text formatting with subject/body separation.

**Source files:**

- `web/clawser-channel-email.js`

**API surface:**

- `EmailChannel`

> **Note:** Planned for next release cycle.

---

### IRC Channel

**Status:** ✅ Implemented · **Category:** adapter · **Since:** v1.0.0

IRC client integration with channel and private message support. Connects to IRC servers via WebSocket bridge.

**Source files:**

- `web/clawser-channel-irc.js`

**API surface:**

- `IRCChannel`

---

### Matrix Channel

**Status:** ✅ Implemented · **Category:** adapter · **Since:** v1.0.0

Matrix protocol integration for decentralized chat. Supports encrypted rooms via Olm. Connects to any Matrix homeserver.

**Source files:**

- `web/clawser-channel-matrix.js`

**API surface:**

- `MatrixChannel`

---

### Relay Channel

**Status:** ✅ Implemented · **Category:** adapter · **Since:** v1.5.0

Generic relay channel for bridging messages between Clawser instances or external systems via WebSocket.

**Source files:**

- `web/clawser-channel-relay.js`

**API surface:**

- `RelayChannel`

---

### TabWatch Channel

**Status:** ✅ Implemented · **Category:** adapter · **Since:** v1.5.0

Browser tab monitoring channel. Watches for changes in specified browser tabs and routes events as inbound messages to the agent.

**Source files:**

- `web/clawser-channel-tabwatch.js`

**API surface:**

- `TabWatchChannel`

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
