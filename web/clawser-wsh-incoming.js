/**
 * Clawser wsh Incoming Session Handler
 *
 * Handles incoming reverse-connect requests from remote CLI clients.
 * When a CLI sends ReverseConnect to the server targeting this browser,
 * the server forwards the message here. This module bridges the
 * incoming connection to the browser's agent tools.
 */

import { getWshConnections } from './clawser-wsh-tools.js';

// ── Incoming session tracking ────────────────────────────────────────

/** @type {Map<string, IncomingSession>} fingerprint → session */
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
  }

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

  close() {
    this.state = 'closed';
    incomingSessions.delete(this.targetFingerprint);
  }
}

// ── Handler registration ─────────────────────────────────────────────

/**
 * Handle an incoming ReverseConnect message.
 * Called by the WshClient's onReverseConnect callback.
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

  // Create incoming session
  const session = new IncomingSession(msg, activeClient);
  incomingSessions.set(msg.target_fingerprint, session);

  console.log('[wsh:incoming] Session created for', msg.username,
    `(${incomingSessions.size} active incoming sessions)`);
}

/**
 * List active incoming sessions.
 * @returns {Array<{ username: string, fingerprint: string, createdAt: number }>}
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
 * Get an incoming session by fingerprint prefix.
 * @param {string} prefix
 * @returns {IncomingSession|null}
 */
export function getIncomingSession(prefix) {
  for (const [fp, session] of incomingSessions) {
    if (fp.startsWith(prefix)) return session;
  }
  return null;
}

// Register the global handler for WshConnectTool to pick up
globalThis.__wshIncomingHandler = handleReverseConnect;
