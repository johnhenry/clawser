/**
 * Clawser wsh Incoming Session Handler
 *
 * Handles incoming reverse-connect requests from remote CLI clients.
 * When a CLI sends ReverseConnect to the server targeting this browser,
 * the server forwards the message here. This module bridges the
 * incoming connection to the browser's agent tools.
 *
 * Flow:
 *   1. CLI sends ReverseConnect → server forwards to browser
 *   2. Browser creates IncomingSession, wires onRelayMessage on WshClient
 *   3. Server relay bridge forwards Open/McpCall/McpDiscover/Close etc.
 *   4. IncomingSession routes each message to the appropriate handler
 *   5. Results are sent back through the WshClient → server → CLI
 */

import { getWshConnections } from './clawser-wsh-tools.js';

// ── Kernel bridge integration (optional) ────────────────────────────
/** @type {import('./clawser-kernel-wsh-bridge.js').KernelWshBridge|null} */
let _kernelBridge = null;

/** Set the kernel-wsh bridge for tenant lifecycle. */
export function setKernelBridge(bridge) { _kernelBridge = bridge; }

/** Get the current kernel-wsh bridge. */
export function getKernelBridge() { return _kernelBridge; }

// ── Incoming session tracking ────────────────────────────────────────

/** @type {Map<string, IncomingSession>} username → session */
const incomingSessions = new Map();

/**
 * An incoming session from a remote CLI client.
 * Bridges the relay to browser agent tools.
 */
class IncomingSession {
  /** @param {object} msg - ReverseConnect message */
  constructor(msg, client) {
    this.username = msg.username;
    this.targetFingerprint = msg.target_fingerprint;
    this.client = client;
    this.createdAt = Date.now();
    this.state = 'active';
    /** @type {string|null} Kernel tenant ID (set by handleReverseConnect if bridge is active). */
    this.tenantId = null;
    /** @type {boolean} Whether this session is actively listening for relay messages. */
    this._listening = false;
  }

  // ── Relay message listener ──────────────────────────────────────────

  /**
   * Start listening for relay-forwarded messages from the CLI peer.
   * The server's relay bridge forwards Open, McpCall, McpDiscover, etc.
   * to our WshClient. We wire the client's onRelayMessage callback to
   * route those messages through this session.
   */
  startListening() {
    if (this._listening) return;
    this._listening = true;

    // Wire the client's onRelayMessage callback.
    // If multiple sessions share a client (unlikely but possible),
    // we chain the handlers.
    const prevHandler = this.client.onRelayMessage;

    this.client.onRelayMessage = (msg) => {
      // Only handle if this session is still active.
      if (this.state === 'active') {
        this.handleRelayMessage(msg);
      } else if (prevHandler) {
        prevHandler(msg);
      }
    };
  }

  /**
   * Stop listening for relay messages and restore any previous handler.
   */
  stopListening() {
    if (!this._listening) return;
    this._listening = false;
    // Clear our handler — don't try to restore a stale chain reference.
    // If the session is closing, the client callback should be cleared.
    if (this.client.onRelayMessage) {
      this.client.onRelayMessage = null;
    }
  }

  // ── Relay message dispatch ──────────────────────────────────────────

  /**
   * Handle a relay-forwarded message from the CLI peer.
   * Routes Open, McpDiscover, McpCall, Close, Resize, and Signal.
   *
   * @param {object} msg - Decoded control message from the relay bridge
   */
  async handleRelayMessage(msg) {
    // Lazy-import MSG constants to avoid circular dependency at module load.
    const { MSG, mcpTools, mcpResult, openOk, openFail, close: closeMsg } =
      await import('./packages-wsh.js');

    switch (msg.type) {
      case MSG.OPEN: {
        // CLI wants to open a session on the browser.
        // For exec-type opens, run the command and send the result back.
        console.log('[wsh:incoming] Open from peer:', msg.kind, msg.command);

        const command = msg.command || 'echo "connected"';
        try {
          const result = await this.handleExec(command);
          // Send OpenOk acknowledgment back through the relay.
          await this._sendReply(openOk({ channelId: msg.channel_id || 0 }));
          // If there's output, we would send it as data frames.
          // For now, log the result.  Full data streaming will be added
          // when the relay bridge supports bidirectional data channels.
          console.log('[wsh:incoming] Exec result:', result);
        } catch (err) {
          console.error('[wsh:incoming] Exec error:', err);
          await this._sendReply(openFail({ reason: err.message }));
        }
        break;
      }

      case MSG.MCP_DISCOVER: {
        // CLI wants to discover browser tools.
        console.log('[wsh:incoming] McpDiscover from peer');

        const registry = globalThis.__clawserToolRegistry;
        const tools = registry
          ? [...registry.entries()].map(([name, tool]) => ({
              name,
              description: tool.description || '',
              parameters: tool.parameters || {},
            }))
          : [];

        await this._sendReply(mcpTools({ tools }));
        break;
      }

      case MSG.MCP_CALL: {
        // CLI wants to call a browser tool.
        const toolName = msg.tool;
        const args = msg.arguments || {};
        console.log('[wsh:incoming] McpCall from peer:', toolName);

        const result = await this.handleToolCall(toolName, args);
        await this._sendReply(mcpResult({ result }));
        break;
      }

      case MSG.CLOSE: {
        // CLI is closing the session.
        console.log('[wsh:incoming] Close from peer');
        this.close();
        break;
      }

      case MSG.RESIZE: {
        // CLI wants to resize a terminal (informational in browser context).
        console.log('[wsh:incoming] Resize from peer:', msg.cols, 'x', msg.rows);
        break;
      }

      case MSG.SIGNAL: {
        // CLI is sending a signal (e.g., SIGINT).
        console.log('[wsh:incoming] Signal from peer:', msg.signal);
        break;
      }

      default:
        console.log('[wsh:incoming] Unhandled relay message type:',
          `0x${msg.type.toString(16)}`);
    }
  }

  // ── Reply helper ────────────────────────────────────────────────────

  /**
   * Send a reply message back through the WshClient.
   * The server's relay bridge will forward it to the CLI peer.
   *
   * @param {object} msg - Encoded control message to send
   * @returns {Promise<void>}
   */
  async _sendReply(msg) {
    if (this.state !== 'active') {
      console.warn('[wsh:incoming] Attempted to send reply on inactive session');
      return;
    }

    try {
      // Access the transport through the client.
      // WshClient doesn't expose sendControl publicly, but the transport
      // is accessible via the _transport getter if available, or we use
      // a method that the client does expose.
      //
      // For now, we use the internal transport reference.  A cleaner API
      // (client.sendRelay()) could be added later.
      const transport = this.client._transport || this.client['#transport'];
      if (transport && typeof transport.sendControl === 'function') {
        await transport.sendControl(msg);
      } else {
        console.warn('[wsh:incoming] No transport available to send reply');
      }
    } catch (err) {
      console.error('[wsh:incoming] Failed to send reply:', err);
    }
  }

  // ── Tool execution ──────────────────────────────────────────────────

  /**
   * Handle a tool call from the remote CLI.
   * @param {string} tool - Tool name
   * @param {object} args - Tool arguments
   * @returns {Promise<object>} Tool result
   */
  async handleToolCall(tool, args) {
    // Look up tool in the browser's registry (if available)
    const registry = globalThis.__clawserToolRegistry;
    if (!registry) {
      return { success: false, error: 'No tool registry available' };
    }

    const browserTool = registry.get(tool);
    if (!browserTool) {
      return { success: false, error: `Tool "${tool}" not found` };
    }

    try {
      return await browserTool.execute(args);
    } catch (err) {
      return { success: false, error: err.message };
    }
  }

  /**
   * Handle a shell exec request from the remote CLI.
   * Delegates to the shell_exec tool if available.
   * @param {string} command - Command to execute
   * @returns {Promise<object>} Execution result
   */
  async handleExec(command) {
    return this.handleToolCall('shell_exec', { command });
  }

  /**
   * Handle an MCP tool call from the remote CLI.
   * Forwards to the agent's MCP client.
   * @param {string} tool - Tool name
   * @param {object} args - Tool arguments
   * @returns {Promise<object>}
   */
  async handleMcpCall(tool, args) {
    const mcpClient = globalThis.__clawserMcpClient;
    if (!mcpClient) {
      return { success: false, error: 'No MCP client available' };
    }

    try {
      const result = await mcpClient.callTool(tool, args);
      return { success: true, output: JSON.stringify(result) };
    } catch (err) {
      return { success: false, error: err.message };
    }
  }

  // ── Lifecycle ───────────────────────────────────────────────────────

  close() {
    this.state = 'closed';
    this.stopListening();
    // Destroy kernel tenant for this reverse-connect peer.
    if (_kernelBridge) {
      _kernelBridge.handleParticipantLeave(this.username);
    }
    incomingSessions.delete(this.username);
  }
}

// ── Handler registration ─────────────────────────────────────────────

/**
 * Handle an incoming ReverseConnect message.
 * Called by the WshClient's onReverseConnect callback.
 *
 * Creates an IncomingSession and wires up relay message listening so
 * the browser can receive and respond to Open/McpCall/McpDiscover etc.
 * from the remote CLI peer.
 *
 * @param {object} msg - Decoded ReverseConnect message
 *   { target_fingerprint, username }
 */
export function handleReverseConnect(msg) {
  console.log('[wsh:incoming] Reverse connect from:', msg.username,
    'target:', msg.target_fingerprint);

  // Find the client whose fingerprint matches the target (this browser is the target).
  // If the message has a sourceClient reference, use that; otherwise find the client
  // that is connected to the relay where this ReverseConnect arrived.
  const connections = getWshConnections();
  let activeClient = null;

  // First, try to find the client that received this message by matching
  // our own fingerprint against the target_fingerprint
  for (const client of connections.values()) {
    if (client.state === 'authenticated' && client.fingerprint === msg.target_fingerprint) {
      activeClient = client;
      break;
    }
  }

  // Fallback: use any authenticated client connected as a reverse peer
  if (!activeClient) {
    for (const client of connections.values()) {
      if (client.state === 'authenticated') {
        activeClient = client;
        break;
      }
    }
  }

  if (!activeClient) {
    console.warn('[wsh:incoming] No active client to accept connection');
    return;
  }

  // Close any existing session for this username (replace stale sessions).
  const existing = incomingSessions.get(msg.username);
  if (existing && existing.state === 'active') {
    console.log('[wsh:incoming] Replacing existing session for', msg.username);
    existing.close();
  }

  // Create incoming session, keyed by username.
  const session = new IncomingSession(msg, activeClient);
  incomingSessions.set(msg.username, session);

  // Create a kernel tenant for this reverse-connect peer.
  if (_kernelBridge) {
    const { tenantId } = _kernelBridge.handleReverseConnect({
      username: msg.username,
      fingerprint: msg.target_fingerprint || '',
    });
    session.tenantId = tenantId;
  }

  // Wire up relay message listening so Open/McpCall/etc. from the CLI
  // are routed through this session.
  session.startListening();

  console.log('[wsh:incoming] Session created, listening for relay messages from',
    msg.username, `(${incomingSessions.size} active incoming sessions)`);
}

/**
 * List active incoming sessions.
 * @returns {Array<{ username: string, fingerprint: string, createdAt: number, state: string }>}
 */
export function listIncomingSessions() {
  return [...incomingSessions.values()].map(s => ({
    username: s.username,
    fingerprint: s.targetFingerprint,
    createdAt: s.createdAt,
    state: s.state,
  }));
}

/**
 * Get an incoming session by username or fingerprint prefix.
 * @param {string} prefix - Username or fingerprint prefix
 * @returns {IncomingSession|null}
 */
export function getIncomingSession(prefix) {
  // Try exact username match first.
  if (incomingSessions.has(prefix)) {
    return incomingSessions.get(prefix);
  }
  // Then try fingerprint prefix match.
  for (const session of incomingSessions.values()) {
    if (session.targetFingerprint?.startsWith(prefix)) return session;
  }
  return null;
}

// Register the global handler for WshConnectTool to pick up
globalThis.__wshIncomingHandler = handleReverseConnect;
