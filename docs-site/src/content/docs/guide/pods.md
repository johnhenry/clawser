---
title: "Pods"
---

Pod architecture, ClawserPod, EmbeddedPod, InjectedPod, Chrome extension

---

### Pod Base Class

**Status:** ✅ Implemented · **Category:** base · **Since:** v2.0.0

Core pod class from the browsermesh-pod package. Provides 6-phase boot sequence, wire protocol (HELLO, HELLO_ACK, GOODBYE, MESSAGE, RPC_REQUEST, RPC_RESPONSE), pod kind detection, and capability discovery.

**Source files:**

- `web/packages-pod.js`

**API surface:**

- `Pod`
- `detectPodKind`
- `detectCapabilities`
- `createHello`
- `createHelloAck`
- `createGoodbye`
- `createMessage`
- `createRpcRequest`
- `createRpcResponse`
- `installPodRuntime`
- `createRuntime`
- `createClient`
- `createServer`

> **Note:** Wire protocol constants: POD_HELLO, POD_HELLO_ACK, POD_GOODBYE, POD_MESSAGE, POD_RPC_REQUEST, POD_RPC_RESPONSE.

**See also:**

- ClawserPod
- EmbeddedPod

---

### ClawserPod

**Status:** ✅ Implemented · **Category:** clawser-pod · **Since:** v2.0.0

Full-featured Clawser pod extending the base Pod class. Initializes the complete mesh subsystem with 60+ lazy-loaded components including peer node, swarm coordinator, wallet, discovery, transport, audit chain, stream multiplexer, file transfer, service directory, sync engine, marketplace, quotas, consensus, relay, orchestrator, and more. Provides initMesh() and shutdown() lifecycle methods.

**Source files:**

- `web/clawser-pod.js`

**API surface:**

- `ClawserPod`
- `ClawserPod.initMesh`
- `ClawserPod.shutdown`

> **Note:** 60+ lazy-loaded subsystem getters including: peerNode, swarmCoordinator, wallet, registry, discoveryManager, transportNegotiator, auditChain, streamMultiplexer, fileTransfer, serviceDirectory, syncEngine, meshMarketplace, quotaManager, consensusManager, relayClient, nameResolver, orchestrator, meshACL, meshChat, gatewayNode, torrentManager, ipfsStore, federatedCompute, agentSwarmCoordinator, meshScheduler, healthMonitor, timestampAuthority, stealthAgent, escrowManager, dhtNode, creditLedger, groupKeyManager, pbftConsensus, and more.

**See also:**

- Mesh Peer
- Mesh Swarm

---

### EmbeddedPod

**Status:** ✅ Implemented · **Category:** embedded · **Since:** v2.0.0

Lightweight embeddable pod for integrating Clawser into external applications. Provides a simple API: sendMessage(), on()/off() event handling, setAgent(), and config access. Used as the ClawserEmbed export for embedding.

**Source files:**

- `web/clawser-embed.js`

**API surface:**

- `EmbeddedPod`
- `ClawserEmbed`

> **Note:** Exported as ClawserEmbed alias for external use.

---

### InjectedPod

**Status:** ✅ Implemented · **Category:** injected · **Since:** v2.0.0

Pod variant for injecting Clawser capabilities into existing web pages. Used by the Chrome extension to inject agent functionality into any website.

**Source files:**

- `web/packages-pod.js`

**API surface:**

- `InjectedPod`

**See also:**

- Chrome Extension

---

### Chrome Extension

**Status:** ✅ Implemented · **Category:** extension · **Since:** v1.5.0

Chrome extension (Clawser Browser Control) that injects an InjectedPod into web pages. Provides 32 extension tools for tab management, DOM interaction, form filling, screenshots, cookie access, console monitoring, and network request inspection. Uses RPC-based communication between the extension and the Clawser web app.

**Source files:**

- `web/clawser-extension-tools.js`
- `web/clawser-extension-tools.d.ts`

**API surface:**

- `ExtensionRpcClient`
- `registerExtensionTools`

> **Note:** Available at Chrome Web Store. 32 tools across categories: status/info, tab management, navigation, screenshots, DOM reading, input simulation, forms, monitoring, execution, cookies, and WebMCP discovery.

**See also:**

- Browser Automation

---

### Browser Automation

**Status:** ✅ Implemented · **Category:** automation · **Since:** v1.5.0

Automated browser interaction via the chrome extension or native APIs. AutomationSession manages tab sessions with domain allowlists. AutomationManager coordinates multi-session automation. Includes workflow recording and export as skill or JSON.

**Source files:**

- `web/clawser-browser-auto.js`
- `web/clawser-browser-auto.d.ts`

**API surface:**

- `AutomationSession`
- `AutomationManager`
- `PageSnapshot`
- `WorkflowRecorder`
- `BrowserOpenTool`
- `BrowserReadPageTool`
- `BrowserClickTool`
- `BrowserFillTool`
- `BrowserWaitTool`
- `BrowserEvaluateTool`
- `BrowserListTabsTool`
- `BrowserCloseTabTool`

> **Note:** PageSnapshot captures URL, title, text, links, forms, and interactive elements. WorkflowRecorder can export recorded steps as a skill or JSON.

---

### Kernel Package

**Status:** ✅ Implemented · **Category:** kernel · **Since:** v2.0.0

Microkernel package (packages-kernel) providing foundational services: ResourceTable, ByteStream, Clock, RNG, ServiceRegistry (svc:// URLs), Logger, Tracer, Signal, Caps (capabilities), Env, Stdio, MessagePort, Constants, and Errors. Approximately 2,862 LOC across 16 ES modules.

**Source files:**

- `web/packages/kernel/src/index.mjs`
- `web/packages/kernel/src/kernel.mjs`
- `web/packages/kernel/src/service-registry.mjs`
- `web/packages/kernel/src/resource-table.mjs`
- `web/packages/kernel/src/message-port.mjs`
- `web/packages/kernel/src/signal.mjs`
- `web/packages/kernel/src/logger.mjs`
- `web/packages/kernel/src/errors.mjs`
- `web/packages/kernel/src/byte-stream.mjs`
- `web/packages/kernel/src/stdio.mjs`
- `web/packages/kernel/src/caps.mjs`
- `web/packages/kernel/src/env.mjs`
- `web/packages/kernel/src/chaos.mjs`
- `web/packages/kernel/src/clock.mjs`
- `web/packages/kernel/src/constants.mjs`
- `web/packages/kernel/src/rng.mjs`
- `web/packages/kernel/src/tracer.mjs`

**API surface:**

- `Kernel`
- `ServiceRegistry`
- `ResourceTable`
- `ByteStream`
- `Clock`
- `RNG`
- `Logger`
- `Tracer`
- `Signal`
- `Caps`
- `Env`
- `Stdio`
- `MessagePort`

> **Note:** 16 ES modules providing microkernel services. Tenant isolation and capability enforcement.

---

### Raijin Bridge

**Status:** ✅ Implemented · **Category:** integration · **Since:** v2.0.0

Integration bridge with the Raijin framework for state management and WSH adapter functionality.

**Source files:**

- `web/clawser-raijin-bridge.js`
- `web/clawser-raijin-state-view.js`
- `web/clawser-raijin-wsh-adapter.js`

**API surface:**

- `RaijinBridge`

---

---

[← Networking](/docs/guide/networking/) | [Index](/docs/) | [Build →](/docs/guide/build/)
