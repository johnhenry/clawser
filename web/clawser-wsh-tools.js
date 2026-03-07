/**
 * Clawser wsh Browser Tools
 *
 * BrowserTool subclasses for remote command execution, file transfer,
 * and PTY management over the wsh protocol.
 */

import { BrowserTool } from './clawser-tools.js';
import { WshClient, WshKeyStore, WshFileTransfer, WshMcpBridge } from './packages-wsh.js';

// ── Shared state ──────────────────────────────────────────────────────

/** @type {Map<string, WshClient>} host → active client */
const connections = new Map();

/** @type {WshKeyStore|null} */
let keyStore = null;

async function getKeyStore() {
  if (!keyStore) {
    keyStore = new WshKeyStore();
    await keyStore.open();
  }
  return keyStore;
}

async function getClient(host) {
  const client = connections.get(host);
  if (!client || client.state === 'closed' || client.state === 'disconnected') {
    return null;
  }
  return client;
}

// ── wsh_connect ───────────────────────────────────────────────────────

export class WshConnectTool extends BrowserTool {
  get name() { return 'wsh_connect'; }
  get description() {
    return 'Connect to a remote wsh server. Establishes an authenticated session. Use expose option to register as a reverse peer.';
  }
  get parameters() {
    return {
      type: 'object',
      properties: {
        host: { type: 'string', description: 'Server URL (e.g., wss://host:4422 or https://host:4422)' },
        user: { type: 'string', description: 'Username for authentication' },
        key_name: { type: 'string', description: 'Name of the Ed25519 key to use (default: "default")' },
        expose: { type: 'object', description: 'Expose capabilities for reverse connections: { shell: true, tools: true, fs: true }' },
      },
      required: ['host', 'user'],
    };
  }
  get permission() { return 'approve'; }

  async execute({ host, user, key_name = 'default', expose }) {
    try {
      if (connections.has(host) && connections.get(host).state === 'authenticated') {
        return { success: true, output: `Already connected to ${host}` };
      }

      const ks = await getKeyStore();
      const keyPair = await ks.getKeyPair(key_name);
      if (!keyPair) {
        return { success: false, output: '', error: `Key "${key_name}" not found. Generate one with wsh keygen.` };
      }

      const client = new WshClient();

      if (expose) {
        // Connect in reverse mode — register as a peer
        const sessionId = await client.connectReverse(host, {
          username: user,
          keyPair,
          expose,
        });
        client.__clawserExposeCapabilities = { ...expose };
        // Wire incoming session handler if available, chaining with any existing handler
        if (typeof globalThis.__wshIncomingHandler === 'function') {
          const prevHandler = client.onReverseConnect;
          client.onReverseConnect = (msg) => {
            globalThis.__wshIncomingHandler(msg);
            if (prevHandler) prevHandler(msg);
          };
        }
        connections.set(host, client);
        const caps = Object.keys(expose).filter(k => expose[k]).join(', ');
        return { success: true, output: `Connected to ${host} (session: ${sessionId}, exposing: ${caps || 'none'})` };
      }

      const sessionId = await client.connect(host, {
        username: user,
        keyPair,
      });

      connections.set(host, client);
      return { success: true, output: `Connected to ${host} (session: ${sessionId})` };
    } catch (err) {
      return { success: false, output: '', error: `Connection failed: ${err.message}` };
    }
  }
}

// ── wsh_exec ──────────────────────────────────────────────────────────

export class WshExecTool extends BrowserTool {
  get name() { return 'wsh_exec'; }
  get description() {
    return 'Execute a command on the connected remote server and return its output.';
  }
  get parameters() {
    return {
      type: 'object',
      properties: {
        command: { type: 'string', description: 'Shell command to execute' },
        host: { type: 'string', description: 'Server host (uses last connected if omitted)' },
        timeout_ms: { type: 'number', description: 'Timeout in milliseconds (default: 30000)' },
      },
      required: ['command'],
    };
  }
  get permission() { return 'approve'; }

  async execute({ command, host, timeout_ms = 30000 }) {
    try {
      const targetHost = host || [...connections.keys()].pop();
      if (!targetHost) {
        return { success: false, output: '', error: 'No active connection. Use wsh_connect first.' };
      }

      const client = await getClient(targetHost);
      if (!client) {
        return { success: false, output: '', error: `Not connected to ${targetHost}` };
      }

      const session = await client.openSession({ type: 'exec', command });

      const chunks = [];
      let exitCode = null;

      await new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          session.close();
          reject(new Error('Command timed out'));
        }, timeout_ms);

        session.onData = (data) => chunks.push(data);
        session.onExit = (code) => {
          exitCode = code;
          clearTimeout(timer);
          resolve();
        };
        session.onClose = () => {
          clearTimeout(timer);
          resolve();
        };
      });

      const decoder = new TextDecoder();
      const output = chunks.map((c, i) => decoder.decode(c, { stream: i < chunks.length - 1 })).join('');

      return {
        success: exitCode === 0,
        output: output || `(exited with code ${exitCode})`,
        error: exitCode !== 0 ? `Command exited with code ${exitCode}` : undefined,
      };
    } catch (err) {
      return { success: false, output: '', error: `Exec failed: ${err.message}` };
    }
  }
}

// ── wsh_pty_open ──────────────────────────────────────────────────────

export class WshPtyOpenTool extends BrowserTool {
  get name() { return 'wsh_pty_open'; }
  get description() {
    return 'Open an interactive PTY session on the remote server.';
  }
  get parameters() {
    return {
      type: 'object',
      properties: {
        host: { type: 'string', description: 'Server host (uses last connected if omitted)' },
        command: { type: 'string', description: 'Shell command (default: login shell)' },
        cols: { type: 'number', description: 'Terminal columns (default: 80)' },
        rows: { type: 'number', description: 'Terminal rows (default: 24)' },
      },
    };
  }
  get permission() { return 'approve'; }

  async execute({ host, command, cols = 80, rows = 24 }) {
    try {
      const targetHost = host || [...connections.keys()].pop();
      if (!targetHost) {
        return { success: false, output: '', error: 'No active connection.' };
      }

      const client = await getClient(targetHost);
      if (!client) {
        return { success: false, output: '', error: `Not connected to ${targetHost}` };
      }

      const session = await client.openSession({ type: 'pty', command, cols, rows });
      return {
        success: true,
        output: `PTY session opened: ${session.id} (${cols}x${rows})`,
      };
    } catch (err) {
      return { success: false, output: '', error: `PTY open failed: ${err.message}` };
    }
  }
}

// ── wsh_pty_write ─────────────────────────────────────────────────────

export class WshPtyWriteTool extends BrowserTool {
  get name() { return 'wsh_pty_write'; }
  get description() {
    return 'Write data (keystrokes) to an open PTY session.';
  }
  get parameters() {
    return {
      type: 'object',
      properties: {
        session_id: { type: 'string', description: 'PTY session ID' },
        data: { type: 'string', description: 'Data to write (supports \\n, \\t, \\x03 for Ctrl-C)' },
      },
      required: ['session_id', 'data'],
    };
  }
  get permission() { return 'approve'; }

  async execute({ session_id, data }) {
    try {
      // Find the session across all connections
      for (const client of connections.values()) {
        if (client.state !== 'authenticated') continue;
        const sessions = client.listSessions();
        const session = sessions.find(s => s.id === session_id || s.channelId?.toString() === session_id);
        if (session) {
          // Unescape common control sequences
          const unescaped = data
            .replace(/\\n/g, '\n')
            .replace(/\\t/g, '\t')
            .replace(/\\r/g, '\r')
            .replace(/\\x([0-9a-fA-F]{2})/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)));

          session.write(unescaped);
          return { success: true, output: `Wrote ${unescaped.length} bytes to session ${session_id}` };
        }
      }
      return { success: false, output: '', error: `Session ${session_id} not found` };
    } catch (err) {
      return { success: false, output: '', error: `PTY write failed: ${err.message}` };
    }
  }
}

// ── wsh_upload ────────────────────────────────────────────────────────

export class WshUploadTool extends BrowserTool {
  get name() { return 'wsh_upload'; }
  get description() {
    return 'Upload a file to the remote server.';
  }
  get parameters() {
    return {
      type: 'object',
      properties: {
        local_path: { type: 'string', description: 'Local OPFS path of the file to upload' },
        remote_path: { type: 'string', description: 'Destination path on the remote server' },
        host: { type: 'string', description: 'Server host (uses last connected if omitted)' },
      },
      required: ['local_path', 'remote_path'],
    };
  }
  get permission() { return 'approve'; }

  async execute({ local_path, remote_path, host }) {
    try {
      const targetHost = host || [...connections.keys()].pop();
      if (!targetHost) {
        return { success: false, output: '', error: 'No active connection.' };
      }

      const client = await getClient(targetHost);
      if (!client) {
        return { success: false, output: '', error: `Not connected to ${targetHost}` };
      }

      // Read local file from OPFS
      const root = await navigator.storage.getDirectory();
      const parts = local_path.replace(/^\//, '').split('/');
      let dir = root;
      for (const part of parts.slice(0, -1)) {
        dir = await dir.getDirectoryHandle(part);
      }
      const fileHandle = await dir.getFileHandle(parts[parts.length - 1]);
      const file = await fileHandle.getFile();
      const data = new Uint8Array(await file.arrayBuffer());

      const ft = new WshFileTransfer(client);
      const result = await ft.upload(data, remote_path);
      return {
        success: true,
        output: `Uploaded ${data.length} bytes to ${remote_path}`,
      };
    } catch (err) {
      return { success: false, output: '', error: `Upload failed: ${err.message}` };
    }
  }
}

// ── wsh_download ──────────────────────────────────────────────────────

export class WshDownloadTool extends BrowserTool {
  get name() { return 'wsh_download'; }
  get description() {
    return 'Download a file from the remote server to local OPFS storage.';
  }
  get parameters() {
    return {
      type: 'object',
      properties: {
        remote_path: { type: 'string', description: 'Path of the file on the remote server' },
        local_path: { type: 'string', description: 'Destination OPFS path' },
        host: { type: 'string', description: 'Server host (uses last connected if omitted)' },
      },
      required: ['remote_path', 'local_path'],
    };
  }
  get permission() { return 'approve'; }

  async execute({ remote_path, local_path, host }) {
    try {
      const targetHost = host || [...connections.keys()].pop();
      if (!targetHost) {
        return { success: false, output: '', error: 'No active connection.' };
      }

      const client = await getClient(targetHost);
      if (!client) {
        return { success: false, output: '', error: `Not connected to ${targetHost}` };
      }

      const ft = new WshFileTransfer(client);
      const data = await ft.download(remote_path);

      // Write to OPFS
      const root = await navigator.storage.getDirectory();
      const parts = local_path.replace(/^\//, '').split('/');
      let dir = root;
      for (const part of parts.slice(0, -1)) {
        dir = await dir.getDirectoryHandle(part, { create: true });
      }
      const fileHandle = await dir.getFileHandle(parts[parts.length - 1], { create: true });
      const writable = await fileHandle.createWritable();
      await writable.write(data);
      await writable.close();

      return {
        success: true,
        output: `Downloaded ${data.length} bytes from ${remote_path} to ${local_path}`,
      };
    } catch (err) {
      return { success: false, output: '', error: `Download failed: ${err.message}` };
    }
  }
}

// ── wsh_disconnect ────────────────────────────────────────────────────

export class WshDisconnectTool extends BrowserTool {
  get name() { return 'wsh_disconnect'; }
  get description() {
    return 'Disconnect from a remote wsh server.';
  }
  get parameters() {
    return {
      type: 'object',
      properties: {
        host: { type: 'string', description: 'Server host to disconnect from (disconnects all if omitted)' },
      },
    };
  }
  get permission() { return 'auto'; }

  async execute({ host } = {}) {
    try {
      if (host) {
        const client = connections.get(host);
        if (client) {
          await client.disconnect();
          connections.delete(host);
          return { success: true, output: `Disconnected from ${host}` };
        }
        return { success: true, output: `Not connected to ${host}` };
      }

      // Disconnect all
      const hosts = [...connections.keys()];
      for (const h of hosts) {
        const c = connections.get(h);
        if (c) await c.disconnect().catch(() => {});
        connections.delete(h);
      }
      return { success: true, output: `Disconnected from ${hosts.length} host(s)` };
    } catch (err) {
      return { success: false, output: '', error: `Disconnect failed: ${err.message}` };
    }
  }
}

// ── wsh_sessions ──────────────────────────────────────────────────────

export class WshSessionsTool extends BrowserTool {
  get name() { return 'wsh_sessions'; }
  get description() {
    return 'List active wsh sessions across all connected hosts.';
  }
  get parameters() {
    return { type: 'object', properties: {} };
  }
  get permission() { return 'read'; }

  async execute() {
    try {
      const results = [];
      for (const [host, client] of connections) {
        if (client.state !== 'authenticated') continue;
        const sessions = client.listSessions();
        for (const s of sessions) {
          results.push({ host, ...s });
        }
      }
      if (results.length === 0) {
        return { success: true, output: 'No active sessions.' };
      }
      const lines = results.map(s => `${s.host} | ${s.channelId} | ${s.kind} | ${s.state}`);
      return { success: true, output: `HOST | ID | KIND | STATE\n${lines.join('\n')}` };
    } catch (err) {
      return { success: false, output: '', error: err.message };
    }
  }
}

// ── wsh_mcp_call ──────────────────────────────────────────────────────

export class WshMcpCallTool extends BrowserTool {
  get name() { return 'wsh_mcp_call'; }
  get description() {
    return 'Call a remote MCP tool on a connected wsh server.';
  }
  get parameters() {
    return {
      type: 'object',
      properties: {
        host: { type: 'string', description: 'Server host' },
        tool: { type: 'string', description: 'Tool name to call' },
        arguments: { type: 'object', description: 'Tool arguments' },
      },
      required: ['tool'],
    };
  }
  get permission() { return 'approve'; }

  async execute({ host, tool, arguments: args = {} }) {
    try {
      const targetHost = host || [...connections.keys()].pop();
      if (!targetHost) {
        return { success: false, output: '', error: 'No active connection.' };
      }

      const client = await getClient(targetHost);
      if (!client) {
        return { success: false, output: '', error: `Not connected to ${targetHost}` };
      }

      const bridge = new WshMcpBridge(client);
      const result = await bridge.call(tool, args);
      return result;
    } catch (err) {
      return { success: false, output: '', error: `MCP call failed: ${err.message}` };
    }
  }
}

// ── wsh_fetch ─────────────────────────────────────────────────────────

export class WshFetchTool extends BrowserTool {
  get name() { return 'wsh_fetch'; }
  get description() {
    return 'Fetch a URL via the remote wsh server (CORS bypass). Runs curl on the server and returns status, headers, and body.';
  }
  get parameters() {
    return {
      type: 'object',
      properties: {
        url: { type: 'string', description: 'URL to fetch' },
        method: { type: 'string', description: 'HTTP method (default: GET)' },
        headers: { type: 'object', description: 'Request headers as key-value pairs' },
        body: { type: 'string', description: 'Request body (for POST/PUT/PATCH)' },
        host: { type: 'string', description: 'Server host (uses last connected if omitted)' },
        timeout_ms: { type: 'number', description: 'Timeout in milliseconds (default: 30000)' },
      },
      required: ['url'],
    };
  }
  get permission() { return 'approve'; }

  async execute({ url, method = 'GET', headers = {}, body, host, timeout_ms = 30000 }) {
    try {
      const targetHost = host || [...connections.keys()].pop();
      if (!targetHost) {
        return { success: false, output: '', error: 'No active connection. Use wsh_connect first.' };
      }

      const client = await getClient(targetHost);
      if (!client) {
        return { success: false, output: '', error: `Not connected to ${targetHost}` };
      }

      // Build curl command
      const parts = ['curl', '-sS', '-D-', '-X', method];
      for (const [k, v] of Object.entries(headers)) {
        parts.push('-H', `${k}: ${v}`);
      }
      if (body && ['POST', 'PUT', 'PATCH'].includes(method.toUpperCase())) {
        parts.push('-d', body);
      }
      parts.push('--max-time', String(Math.ceil(timeout_ms / 1000)));
      parts.push('--', url);

      // Shell-escape each argument
      const command = parts.map(p => {
        if (/^[a-zA-Z0-9_./:@=,-]+$/.test(p)) return p;
        return "'" + p.replace(/'/g, "'\\''") + "'";
      }).join(' ');

      const session = await client.openSession({ type: 'exec', command });

      const chunks = [];
      let exitCode = null;

      await new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          session.close();
          reject(new Error('Fetch timed out'));
        }, timeout_ms + 5000); // extra buffer beyond curl's own timeout

        session.onData = (data) => chunks.push(data);
        session.onExit = (code) => {
          exitCode = code;
          clearTimeout(timer);
          resolve();
        };
        session.onClose = () => {
          clearTimeout(timer);
          resolve();
        };
      });

      const decoder = new TextDecoder();
      const raw = chunks.map((c, i) => decoder.decode(c, { stream: i < chunks.length - 1 })).join('');

      if (exitCode !== 0) {
        return { success: false, output: raw || `curl exited with code ${exitCode}`, error: `Fetch failed (exit ${exitCode})` };
      }

      // Parse curl -D- output: headers then blank line then body
      const splitIdx = raw.indexOf('\r\n\r\n');
      if (splitIdx === -1) {
        return { success: true, output: raw };
      }

      const headerBlock = raw.slice(0, splitIdx);
      const bodyContent = raw.slice(splitIdx + 4);

      // Extract status from first line (e.g. "HTTP/1.1 200 OK")
      const statusMatch = headerBlock.match(/^HTTP\/[\d.]+ (\d+)/);
      const status = statusMatch ? parseInt(statusMatch[1], 10) : 0;

      const bodyPreview = bodyContent.length > 8000
        ? bodyContent.slice(0, 8000) + `\n... (truncated, ${bodyContent.length} chars total)`
        : bodyContent;

      return {
        success: status >= 200 && status < 400,
        output: `Status: ${status}\n${headerBlock}\n\nBody (${bodyContent.length} chars):\n${bodyPreview}`,
      };
    } catch (err) {
      return { success: false, output: '', error: `Fetch failed: ${err.message}` };
    }
  }
}

// ── wsh_suspend_session ───────────────────────────────────────────────

export class WshSuspendSessionTool extends BrowserTool {
  get name() { return 'wsh_suspend_session'; }
  get description() { return 'Suspend a remote wsh session.'; }
  get parameters() {
    return {
      type: 'object',
      properties: {
        session_id: { type: 'string', description: 'Session ID to suspend' },
        action: { type: 'string', description: 'Action: suspend or hibernate (default: suspend)' },
        host: { type: 'string', description: 'Server host' },
      },
      required: ['session_id'],
    };
  }
  get permission() { return 'approve'; }

  async execute({ session_id, action = 'suspend', host }) {
    try {
      const targetHost = host || [...connections.keys()].pop();
      const client = targetHost ? await getClient(targetHost) : null;
      if (!client) return { success: false, output: '', error: 'No active connection.' };
      await client.suspendSession(session_id, action);
      return { success: true, output: `Session ${session_id} ${action} requested` };
    } catch (err) {
      return { success: false, output: '', error: err.message };
    }
  }
}

// ── wsh_restart_pty ──────────────────────────────────────────────────

export class WshRestartPtyTool extends BrowserTool {
  get name() { return 'wsh_restart_pty'; }
  get description() { return 'Restart the PTY process in a remote wsh session.'; }
  get parameters() {
    return {
      type: 'object',
      properties: {
        session_id: { type: 'string', description: 'Session ID' },
        command: { type: 'string', description: 'New command (optional, defaults to original)' },
        host: { type: 'string', description: 'Server host' },
      },
      required: ['session_id'],
    };
  }
  get permission() { return 'approve'; }

  async execute({ session_id, command, host }) {
    try {
      const targetHost = host || [...connections.keys()].pop();
      const client = targetHost ? await getClient(targetHost) : null;
      if (!client) return { success: false, output: '', error: 'No active connection.' };
      await client.restartPty(session_id, command);
      return { success: true, output: `PTY restart requested for session ${session_id}` };
    } catch (err) {
      return { success: false, output: '', error: err.message };
    }
  }
}

// ── wsh_metrics ──────────────────────────────────────────────────────

export class WshMetricsTool extends BrowserTool {
  get name() { return 'wsh_metrics'; }
  get description() { return 'Request server metrics (CPU, memory, sessions) from a connected wsh host.'; }
  get parameters() {
    return {
      type: 'object',
      properties: {
        host: { type: 'string', description: 'Server host (uses last connected if omitted)' },
      },
    };
  }
  get permission() { return 'read'; }

  async execute({ host } = {}) {
    try {
      const targetHost = host || [...connections.keys()].pop();
      const client = targetHost ? await getClient(targetHost) : null;
      if (!client) return { success: false, output: '', error: 'No active connection.' };
      const metrics = await client.requestMetrics();
      return { success: true, output: JSON.stringify(metrics, null, 2) };
    } catch (err) {
      return { success: false, output: '', error: err.message };
    }
  }
}

// ── wsh_guest_invite ─────────────────────────────────────────────────

export class WshGuestInviteTool extends BrowserTool {
  get name() { return 'wsh_guest_invite'; }
  get description() { return 'Invite a guest to a wsh session with time-limited access.'; }
  get parameters() {
    return {
      type: 'object',
      properties: {
        session_id: { type: 'string', description: 'Session to share' },
        ttl: { type: 'number', description: 'Invitation TTL in seconds' },
        permissions: { type: 'array', description: 'Permissions: read, write, control', items: { type: 'string' } },
        host: { type: 'string', description: 'Server host' },
      },
      required: ['session_id', 'ttl'],
    };
  }
  get permission() { return 'approve'; }

  async execute({ session_id, ttl, permissions = ['read'], host }) {
    try {
      const targetHost = host || [...connections.keys()].pop();
      const client = targetHost ? await getClient(targetHost) : null;
      if (!client) return { success: false, output: '', error: 'No active connection.' };
      const result = await client.inviteGuest(session_id, ttl, permissions);
      return { success: true, output: JSON.stringify(result) };
    } catch (err) {
      return { success: false, output: '', error: err.message };
    }
  }
}

// ── wsh_guest_revoke ─────────────────────────────────────────────────

export class WshGuestRevokeTool extends BrowserTool {
  get name() { return 'wsh_guest_revoke'; }
  get description() { return 'Revoke a guest invitation token.'; }
  get parameters() {
    return {
      type: 'object',
      properties: {
        token: { type: 'string', description: 'Guest token to revoke' },
        reason: { type: 'string', description: 'Reason for revocation' },
        host: { type: 'string', description: 'Server host' },
      },
      required: ['token'],
    };
  }
  get permission() { return 'approve'; }

  async execute({ token, reason, host }) {
    try {
      const targetHost = host || [...connections.keys()].pop();
      const client = targetHost ? await getClient(targetHost) : null;
      if (!client) return { success: false, output: '', error: 'No active connection.' };
      await client.revokeGuest(token, reason);
      return { success: true, output: `Guest token revoked` };
    } catch (err) {
      return { success: false, output: '', error: err.message };
    }
  }
}

// ── wsh_share_session ────────────────────────────────────────────────

export class WshShareSessionTool extends BrowserTool {
  get name() { return 'wsh_share_session'; }
  get description() { return 'Share a wsh session for multi-attach access.'; }
  get parameters() {
    return {
      type: 'object',
      properties: {
        session_id: { type: 'string', description: 'Session to share' },
        mode: { type: 'string', description: 'Share mode: read or control (default: read)' },
        ttl: { type: 'number', description: 'Share TTL in seconds' },
        host: { type: 'string', description: 'Server host' },
      },
      required: ['session_id'],
    };
  }
  get permission() { return 'approve'; }

  async execute({ session_id, mode = 'read', ttl, host }) {
    try {
      const targetHost = host || [...connections.keys()].pop();
      const client = targetHost ? await getClient(targetHost) : null;
      if (!client) return { success: false, output: '', error: 'No active connection.' };
      const result = await client.shareSession(session_id, mode, ttl);
      return { success: true, output: JSON.stringify(result) };
    } catch (err) {
      return { success: false, output: '', error: err.message };
    }
  }
}

// ── wsh_share_revoke ─────────────────────────────────────────────────

export class WshShareRevokeTool extends BrowserTool {
  get name() { return 'wsh_share_revoke'; }
  get description() { return 'Revoke a session share.'; }
  get parameters() {
    return {
      type: 'object',
      properties: {
        share_id: { type: 'string', description: 'Share ID to revoke' },
        reason: { type: 'string', description: 'Reason for revocation' },
        host: { type: 'string', description: 'Server host' },
      },
      required: ['share_id'],
    };
  }
  get permission() { return 'approve'; }

  async execute({ share_id, reason, host }) {
    try {
      const targetHost = host || [...connections.keys()].pop();
      const client = targetHost ? await getClient(targetHost) : null;
      if (!client) return { success: false, output: '', error: 'No active connection.' };
      await client.revokeShare(share_id, reason);
      return { success: true, output: `Share ${share_id} revoked` };
    } catch (err) {
      return { success: false, output: '', error: err.message };
    }
  }
}

// ── wsh_compress ─────────────────────────────────────────────────────

export class WshCompressTool extends BrowserTool {
  get name() { return 'wsh_compress'; }
  get description() { return 'Negotiate compression with a connected wsh server.'; }
  get parameters() {
    return {
      type: 'object',
      properties: {
        algorithm: { type: 'string', description: 'Compression algorithm (e.g. zstd, lz4)' },
        level: { type: 'number', description: 'Compression level (default: 3)' },
        host: { type: 'string', description: 'Server host' },
      },
      required: ['algorithm'],
    };
  }
  get permission() { return 'approve'; }

  async execute({ algorithm, level = 3, host }) {
    try {
      const targetHost = host || [...connections.keys()].pop();
      const client = targetHost ? await getClient(targetHost) : null;
      if (!client) return { success: false, output: '', error: 'No active connection.' };
      const result = await client.negotiateCompression(algorithm, level);
      return { success: true, output: JSON.stringify(result) };
    } catch (err) {
      return { success: false, output: '', error: err.message };
    }
  }
}

// ── wsh_rate_control ─────────────────────────────────────────────────

export class WshRateControlTool extends BrowserTool {
  get name() { return 'wsh_rate_control'; }
  get description() { return 'Set rate control parameters for a wsh session.'; }
  get parameters() {
    return {
      type: 'object',
      properties: {
        session_id: { type: 'string', description: 'Session ID' },
        max_bytes_per_sec: { type: 'number', description: 'Maximum bytes per second' },
        policy: { type: 'string', description: 'Rate limit policy: pause or drop (default: pause)' },
        host: { type: 'string', description: 'Server host' },
      },
      required: ['session_id', 'max_bytes_per_sec'],
    };
  }
  get permission() { return 'approve'; }

  async execute({ session_id, max_bytes_per_sec, policy = 'pause', host }) {
    try {
      const targetHost = host || [...connections.keys()].pop();
      const client = targetHost ? await getClient(targetHost) : null;
      if (!client) return { success: false, output: '', error: 'No active connection.' };
      await client.setRateControl(session_id, max_bytes_per_sec, policy);
      return { success: true, output: `Rate control set: ${max_bytes_per_sec} B/s (${policy})` };
    } catch (err) {
      return { success: false, output: '', error: err.message };
    }
  }
}

// ── wsh_link_session ─────────────────────────────────────────────────

export class WshLinkSessionTool extends BrowserTool {
  get name() { return 'wsh_link_session'; }
  get description() { return 'Link a wsh session to another host for cross-session routing.'; }
  get parameters() {
    return {
      type: 'object',
      properties: {
        source_session: { type: 'string', description: 'Source session ID' },
        target_host: { type: 'string', description: 'Target host' },
        target_port: { type: 'number', description: 'Target port' },
        target_user: { type: 'string', description: 'Target username' },
        host: { type: 'string', description: 'Server host' },
      },
      required: ['source_session', 'target_host', 'target_port'],
    };
  }
  get permission() { return 'approve'; }

  async execute({ source_session, target_host, target_port, target_user, host }) {
    try {
      const h = host || [...connections.keys()].pop();
      const client = h ? await getClient(h) : null;
      if (!client) return { success: false, output: '', error: 'No active connection.' };
      await client.linkSession(source_session, target_host, target_port, target_user);
      return { success: true, output: `Session link requested: ${source_session} → ${target_host}:${target_port}` };
    } catch (err) {
      return { success: false, output: '', error: err.message };
    }
  }
}

// ── wsh_unlink_session ───────────────────────────────────────────────

export class WshUnlinkSessionTool extends BrowserTool {
  get name() { return 'wsh_unlink_session'; }
  get description() { return 'Unlink a previously linked wsh session.'; }
  get parameters() {
    return {
      type: 'object',
      properties: {
        link_id: { type: 'string', description: 'Link ID to remove' },
        reason: { type: 'string', description: 'Reason for unlinking' },
        host: { type: 'string', description: 'Server host' },
      },
      required: ['link_id'],
    };
  }
  get permission() { return 'approve'; }

  async execute({ link_id, reason, host }) {
    try {
      const h = host || [...connections.keys()].pop();
      const client = h ? await getClient(h) : null;
      if (!client) return { success: false, output: '', error: 'No active connection.' };
      await client.unlinkSession(link_id, reason);
      return { success: true, output: `Session unlinked: ${link_id}` };
    } catch (err) {
      return { success: false, output: '', error: err.message };
    }
  }
}

// ── wsh_copilot_attach ───────────────────────────────────────────────

export class WshCopilotAttachTool extends BrowserTool {
  get name() { return 'wsh_copilot_attach'; }
  get description() { return 'Attach an AI copilot to a wsh session for suggestions.'; }
  get parameters() {
    return {
      type: 'object',
      properties: {
        session_id: { type: 'string', description: 'Session to attach copilot to' },
        model: { type: 'string', description: 'AI model name' },
        context_window: { type: 'number', description: 'Context window size' },
        host: { type: 'string', description: 'Server host' },
      },
      required: ['session_id', 'model'],
    };
  }
  get permission() { return 'approve'; }

  async execute({ session_id, model, context_window, host }) {
    try {
      const h = host || [...connections.keys()].pop();
      const client = h ? await getClient(h) : null;
      if (!client) return { success: false, output: '', error: 'No active connection.' };
      await client.copilotAttach(session_id, model, context_window);
      return { success: true, output: `Copilot attached: ${model} → session ${session_id}` };
    } catch (err) {
      return { success: false, output: '', error: err.message };
    }
  }
}

// ── wsh_copilot_detach ───────────────────────────────────────────────

export class WshCopilotDetachTool extends BrowserTool {
  get name() { return 'wsh_copilot_detach'; }
  get description() { return 'Detach the copilot from a wsh session.'; }
  get parameters() {
    return {
      type: 'object',
      properties: {
        session_id: { type: 'string', description: 'Session ID' },
        reason: { type: 'string', description: 'Reason for detaching' },
        host: { type: 'string', description: 'Server host' },
      },
      required: ['session_id'],
    };
  }
  get permission() { return 'approve'; }

  async execute({ session_id, reason, host }) {
    try {
      const h = host || [...connections.keys()].pop();
      const client = h ? await getClient(h) : null;
      if (!client) return { success: false, output: '', error: 'No active connection.' };
      await client.copilotDetach(session_id, reason);
      return { success: true, output: `Copilot detached from session ${session_id}` };
    } catch (err) {
      return { success: false, output: '', error: err.message };
    }
  }
}

// ── wsh_file_op ──────────────────────────────────────────────────────

export class WshFileOpTool extends BrowserTool {
  get name() { return 'wsh_file_op'; }
  get description() { return 'Perform structured file operations on a remote wsh host (stat, list, read, write, mkdir, remove, rename).'; }
  get parameters() {
    return {
      type: 'object',
      properties: {
        op: { type: 'string', description: 'Operation: stat, list, read, write, mkdir, remove, rename' },
        path: { type: 'string', description: 'File path' },
        offset: { type: 'number', description: 'Read/write offset' },
        length: { type: 'number', description: 'Read length' },
        host: { type: 'string', description: 'Server host' },
      },
      required: ['op', 'path'],
    };
  }
  get permission() { return 'approve'; }

  async execute({ op, path, offset, length, host }) {
    try {
      const h = host || [...connections.keys()].pop();
      const client = h ? await getClient(h) : null;
      if (!client) return { success: false, output: '', error: 'No active connection.' };
      const result = await client.fileOperation(op, path, { offset, length });
      return { success: true, output: JSON.stringify(result) };
    } catch (err) {
      return { success: false, output: '', error: err.message };
    }
  }
}

// ── wsh_policy_eval ──────────────────────────────────────────────────

export class WshPolicyEvalTool extends BrowserTool {
  get name() { return 'wsh_policy_eval'; }
  get description() { return 'Evaluate a policy action on a connected wsh server.'; }
  get parameters() {
    return {
      type: 'object',
      properties: {
        action: { type: 'string', description: 'Action to evaluate' },
        principal: { type: 'string', description: 'Principal requesting the action' },
        context: { type: 'object', description: 'Additional context' },
        host: { type: 'string', description: 'Server host' },
      },
      required: ['action', 'principal'],
    };
  }
  get permission() { return 'read'; }

  async execute({ action, principal, context = {}, host }) {
    try {
      const h = host || [...connections.keys()].pop();
      const client = h ? await getClient(h) : null;
      if (!client) return { success: false, output: '', error: 'No active connection.' };
      const result = await client.evaluatePolicy(action, principal, context);
      return { success: true, output: JSON.stringify(result) };
    } catch (err) {
      return { success: false, output: '', error: err.message };
    }
  }
}

// ── wsh_policy_update ────────────────────────────────────────────────

export class WshPolicyUpdateTool extends BrowserTool {
  get name() { return 'wsh_policy_update'; }
  get description() { return 'Update a policy on a connected wsh server.'; }
  get parameters() {
    return {
      type: 'object',
      properties: {
        policy_id: { type: 'string', description: 'Policy ID to update' },
        rules: { type: 'object', description: 'New policy rules' },
        version: { type: 'number', description: 'Policy version' },
        host: { type: 'string', description: 'Server host' },
      },
      required: ['policy_id', 'rules', 'version'],
    };
  }
  get permission() { return 'approve'; }

  async execute({ policy_id, rules, version, host }) {
    try {
      const h = host || [...connections.keys()].pop();
      const client = h ? await getClient(h) : null;
      if (!client) return { success: false, output: '', error: 'No active connection.' };
      await client.updatePolicy(policy_id, rules, version);
      return { success: true, output: `Policy ${policy_id} updated to v${version}` };
    } catch (err) {
      return { success: false, output: '', error: err.message };
    }
  }
}

// ── Registry helper ───────────────────────────────────────────────────

/**
 * Register all wsh tools with a BrowserToolRegistry.
 * @param {import('./clawser-tools.js').BrowserToolRegistry} registry
 */
// ── wsh_gpu_probe ────────────────────────────────────────────────────

export class WshGpuProbeTool extends BrowserTool {
  get name() { return 'wsh_gpu_probe'; }
  get description() {
    return 'Probe a remote host for GPU capabilities via wsh. Runs nvidia-smi or GPU detection on the remote machine.';
  }
  get parameters() {
    return {
      type: 'object',
      properties: {
        host: { type: 'string', description: 'Remote host to probe' },
      },
      required: ['host'],
    };
  }
  get permission() { return 'read'; }

  async execute({ host }) {
    try {
      const client = await getClient(host);
      if (!client) {
        return { success: false, output: '', error: `No active wsh connection to ${host}. Connect first with wsh_connect.` };
      }
      const result = await client.exec('nvidia-smi --query-gpu=name,memory.total,driver_version --format=csv,noheader 2>/dev/null || echo "NO_GPU"');
      const output = typeof result === 'string' ? result : (result?.stdout || result?.output || '');
      if (output.trim() === 'NO_GPU' || !output.trim()) {
        return {
          success: true,
          output: JSON.stringify({ host, hasGpu: false, details: 'No NVIDIA GPU detected on remote host' }),
        };
      }
      return {
        success: true,
        output: JSON.stringify({ host, hasGpu: true, details: output.trim() }),
      };
    } catch (err) {
      return { success: false, output: '', error: `GPU probe failed: ${err.message}` };
    }
  }
}

export function registerWshTools(registry) {
  registry.register(new WshConnectTool());
  registry.register(new WshExecTool());
  registry.register(new WshPtyOpenTool());
  registry.register(new WshPtyWriteTool());
  registry.register(new WshUploadTool());
  registry.register(new WshDownloadTool());
  registry.register(new WshDisconnectTool());
  registry.register(new WshSessionsTool());
  registry.register(new WshMcpCallTool());
  registry.register(new WshFetchTool());
  registry.register(new WshGpuProbeTool());
  // Phase 5 additions
  registry.register(new WshSuspendSessionTool());
  registry.register(new WshRestartPtyTool());
  registry.register(new WshMetricsTool());
  registry.register(new WshGuestInviteTool());
  registry.register(new WshGuestRevokeTool());
  registry.register(new WshShareSessionTool());
  registry.register(new WshShareRevokeTool());
  registry.register(new WshCompressTool());
  registry.register(new WshRateControlTool());
  registry.register(new WshLinkSessionTool());
  registry.register(new WshUnlinkSessionTool());
  registry.register(new WshCopilotAttachTool());
  registry.register(new WshCopilotDetachTool());
  registry.register(new WshFileOpTool());
  registry.register(new WshPolicyEvalTool());
  registry.register(new WshPolicyUpdateTool());
}

/**
 * Get the shared connections map (for CLI integration).
 * @returns {Map<string, WshClient>}
 */
export function getWshConnections() {
  return connections;
}
