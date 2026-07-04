---
title: "Networking"
---

WSH remote tools, remote access, OAuth, auth profiles, MCP client

---

### WSH Remote Shell

**Status:** ✅ Implemented · **Category:** wsh · **Since:** v1.5.0

Web Shell Hosting protocol for remote server access. Provides SSH-like functionality over WebSocket with command execution, PTY sessions, file transfer, and MCP bridging. 11 agent tools for comprehensive remote management.

**Source files:**

- `web/clawser-wsh-tools.js`
- `web/clawser-wsh-tools.d.ts`
- `web/clawser-wsh-cli.js`
- `web/clawser-wsh-cli.d.ts`

**API surface:**

- `WshConnectTool`
- `WshExecTool`
- `WshPtyOpenTool`
- `WshPtyWriteTool`
- `WshUploadTool`
- `WshDownloadTool`
- `WshDisconnectTool`
- `WshSessionsTool`
- `WshMcpCallTool`
- `WshFetchTool`
- `registerWshTools`
- `getWshConnections`

> **Note:** 11 tools: wsh_connect, wsh_exec, wsh_pty_open, wsh_pty_write, wsh_upload, wsh_download, wsh_disconnect, wsh_sessions, wsh_mcp_call, wsh_fetch, plus wsh_compress and wsh_file_op.

**See also:**

- WSH Incoming
- Virtual Terminal Manager

---

### WSH Incoming

**Status:** ✅ Implemented · **Category:** wsh · **Since:** v1.5.0

Inbound WSH connection handling. Manages reverse-connect sessions where remote peers initiate connections to this Clawser instance. Supports participant key tracking, capability negotiation, tool call forwarding, and MCP call relaying.

**Source files:**

- `web/clawser-wsh-incoming.js`
- `web/clawser-wsh-incoming.d.ts`

**API surface:**

- `handleReverseConnect`
- `listIncomingSessions`
- `getIncomingSession`
- `setKernelBridge`
- `setToolRegistry`
- `setMcpClient`
- `setAgentGateway`
- `setVirtualTerminalManager`

---

### Virtual Terminal Manager

**Status:** ✅ Implemented · **Category:** wsh · **Since:** v1.5.0

PTY session management for remote WSH connections. Manages peer contexts, channels, and terminal I/O for each connected remote participant. Supports open, reattach, write, resize, signal, and close operations.

**Source files:**

- `web/clawser-wsh-virtual-terminal-manager.js`
- `web/clawser-wsh-virtual-terminal-manager.d.ts`
- `web/clawser-wsh-virtual-terminal-session.js`

**API surface:**

- `VirtualTerminalManager`
- `VirtualTerminalManager.registerPeerContext`
- `VirtualTerminalManager.openChannel`
- `VirtualTerminalManager.tryReattachChannel`
- `VirtualTerminalManager.writeToChannel`
- `VirtualTerminalManager.resizeChannel`
- `VirtualTerminalManager.signalChannel`
- `VirtualTerminalManager.closeChannel`
- `VirtualTerminalManager.closePeerContext`
- `buildReverseParticipantKey`

---

### Kernel WSH Bridge

**Status:** ✅ Implemented · **Category:** wsh · **Since:** v2.0.0

Bridge between the kernel microkernel and WSH subsystem. Handles guest joins, copilot attachments, session grants, reverse connects, and participant lifecycle.

**Source files:**

- `web/clawser-kernel-wsh-bridge.js`
- `web/clawser-kernel-wsh-bridge.d.ts`

**API surface:**

- `KernelWshBridge`
- `KernelWshBridge.handleGuestJoin`
- `KernelWshBridge.handleCopilotAttach`
- `KernelWshBridge.handleSessionGrant`
- `KernelWshBridge.handleReverseConnect`
- `KernelWshBridge.handleParticipantLeave`
- `KernelWshBridge.getTenantId`

---

### Remote Access Gateway

**Status:** ✅ Implemented · **Category:** remote · **Since:** v1.5.0

Pairing-based remote access system. Generates pairing codes with configurable length and expiry. Manages sessions with tokens, rate limiting, and revocation. Three agent tools: remote_pair, remote_revoke, remote_status.

**Source files:**

- `web/clawser-remote.js`
- `web/clawser-remote.d.ts`

**API surface:**

- `PairingManager`
- `RateLimiter`
- `GatewayClient`
- `generatePairingCode`
- `generateToken`
- `RemotePairTool`
- `RemoteRevokeTool`
- `RemoteStatusTool`
- `DEFAULT_CODE_LENGTH`
- `DEFAULT_CODE_EXPIRY_MS`
- `DEFAULT_TOKEN_EXPIRY_MS`
- `DEFAULT_RATE_LIMIT`

---

### OAuth Integration

**Status:** ✅ Implemented · **Category:** oauth · **Since:** v1.5.0

OAuth 2.0 connection management for third-party services. OAuthConnection handles token storage with automatic refresh. OAuthManager manages connection lifecycle with vault integration. Supports 9+ providers (Google, GitHub, Slack, etc). Four agent tools: oauth_list, oauth_connect, oauth_disconnect, oauth_api.

**Source files:**

- `web/clawser-oauth.js`
- `web/clawser-oauth.d.ts`

**API surface:**

- `OAuthManager`
- `OAuthConnection`
- `OAuthConnection.fetch`
- `oauth_list`
- `oauth_connect`
- `oauth_disconnect`
- `oauth_api`

> **Note:** Supported providers: Google, GitHub, Slack, and 6+ others. OAuthConnection.fetch() adds auth headers automatically.

---

### Auth Profiles

**Status:** ✅ Implemented · **Category:** auth · **Since:** v1.5.0

Multi-profile authentication system. Multiple auth profiles per provider with active profile switching. Profiles include provider, authType (api_key/oauth/token/none), baseUrl, defaultModel, and metadata. Credentials stored in vault.

**Source files:**

- `web/clawser-auth-profiles.js`
- `web/clawser-auth-profiles.d.ts`

**API surface:**

- `AuthProfileManager`
- `AuthProfile`
- `AuthListProfilesTool`
- `AuthSwitchProfileTool`
- `AuthStatusTool`

> **Note:** Auth types: api_key, oauth, token, none.

---

### MCP Client

**Status:** ✅ Implemented · **Category:** mcp · **Since:** v2.0.0

Model Context Protocol client for connecting to external MCP servers. McpClient handles single server connections with endpoint, tool discovery, and JSON-RPC calling. McpManager orchestrates multiple server connections with svc:// prefix routing. WebMCPDiscovery parses tool descriptors from web pages.

**Source files:**

- `web/clawser-mcp.js`
- `web/clawser-mcp.d.ts`

**API surface:**

- `McpClient`
- `McpManager`
- `WebMCPDiscovery`

> **Note:** JSON-RPC over HTTP with 30-second configurable timeout. Tools auto-registered with svc:// prefix.

---

### CORS Fetch

**Status:** ✅ Implemented · **Category:** network · **Since:** v2.0.0

CORS-aware fetch utility via the Chrome extension. Bypasses same-origin restrictions for approved requests.

**Source files:**

- `web/clawser-cors-fetch.js`
- `web/clawser-cors-fetch-util.js`

**API surface:**

- `corsFetch`
- `ext_cors_fetch`

---

### Tunnel/Proxy

**Status:** ✅ Implemented · **Category:** network · **Since:** v2.0.0

Network tunnel and proxy support for routing traffic through relay servers.

**Source files:**

- `web/clawser-tunnel.js`

**API surface:**

- `tunnel`

---

### Virtual Network (Netway)

**Status:** ✅ Implemented · **Category:** netway · **Since:** v2.0.0

Browser-native virtual networking layer. Supports TCP/UDP-like connections via in-memory transport (mem://), with plans for real network transports. Eight agent tools for socket operations.

**Source files:**

- `web/clawser-netway-tools.js`
- `web/clawser-netway-tools.d.ts`

**API surface:**

- `NetwayConnectTool`
- `NetwayListenTool`
- `NetwaySendTool`
- `NetwayReadTool`
- `NetwayCloseTool`
- `NetwayResolveTool`
- `NetwayStatusTool`
- `NetwayUdpSendTool`
- `registerNetwayTools`
- `getVirtualNetwork`

---

### QR Code Generation

**Status:** ✅ Implemented · **Category:** utility · **Since:** v1.5.0

QR code generation for sharing pairing codes and connection URLs.

**Source files:**

- `web/clawser-qr.js`

**API surface:**

- `generateQR`

---

### WISP Transport

**Status:** ✅ Implemented · **Category:** transport · **Since:** v2.1.0

WISP (WebSocket-based Internet Stream Protocol) transport adapter for WSH. Carries WSH protocol messages through a WISP relay tunnel with dedicated control streams. Additional streams for data transfer, RPC, and mesh relay. Implements the same interface as WebSocketTransport for drop-in use.

**Source files:**

- `web/clawser-wisp-transport.mjs`
- `web/clawser-wisp.mjs`

**API surface:**

- `WispTransport`
- `WispClient`

> **Note:** Standalone uses beyond WSH: exposing RPC mode over a tunneled port, mesh relay through restrictive networks, and future v86 guest networking.

**See also:**

- WSH Remote Shell

---

### WSH Bridge Deprecation

**Status:** ✅ Implemented · **Category:** wsh · **Since:** v2.1.0

The legacy Kernel WSH Bridge (clawser-kernel-wsh-bridge.js) is deprecated in favor of direct mesh transport connections via WISP and Server WebSocket emulation. Bridge remains functional but emits deprecation warnings. New code should use mesh-native transports.

**Source files:**

- `web/clawser-kernel-wsh-bridge.js`
- `web/clawser-mesh-wsh-bridge.js`

> **Note:** Migration path documented. Bridge will be removed in 3.0.0.

**See also:**

- WISP Transport
- Server WebSocket Emulation

---

### Server WebSocket Emulation

**Status:** ✅ Implemented · **Category:** transport · **Since:** v2.1.0

WebSocket-compatible server interface running entirely in the browser. Connections multiplexed over BroadcastChannel (cross-tab) or MessagePort (iframe/worker). Gives handler code the same API surface as a real WebSocket server — accept, send, close, event listeners — without leaving the browser.

**Source files:**

- `web/clawser-server-ws.js`

**API surface:**

- `ServerWebSocketServer`
- `ServerWebSocket`
- `ClientWebSocket`

> **Note:** Wire protocol uses JSON over BroadcastChannel/MessagePort. Supports sub-protocol negotiation.

---

### Mesh Hardening

**Status:** ✅ Implemented · **Category:** mesh · **Since:** v2.1.0

Five production-hardening primitives that compose with existing MeshTransport without breaking backward compatibility. RetryWithBackoff (exponential backoff + circuit breaker), TransportHealthCheck (ping/pong liveness probes), ConnectionPool (per-peer pooling with idle eviction), TransportMetrics (byte/message/error/latency counters), and TransportFailover (graceful degradation across transport types).

**Source files:**

- `web/clawser-mesh-hardening.js`

**API surface:**

- `RetryWithBackoff`
- `TransportHealthCheck`
- `ConnectionPool`
- `TransportMetrics`
- `TransportFailover`
- `CIRCUIT_STATES`

> **Note:** Additive layer — existing mesh code unchanged. Circuit breaker states: closed, open, half-open.

---

---

[← Hardware](/docs/guide/hardware/) | [Index](/docs/) | [Pods →](/docs/guide/pods/)
