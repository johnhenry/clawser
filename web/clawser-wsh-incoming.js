/**
 * Clawser wsh incoming reverse-session router.
 *
 * Accepts reverse-connect requests from CLI peers, creates a stable peer
 * context, and routes relay-forwarded terminal/tool/file/policy messages into
 * browser-local handlers.
 */

import { getWshConnections } from './clawser-wsh-tools.js';
import { buildReverseParticipantKey } from './clawser-wsh-virtual-terminal-manager.js';
import {
  MSG,
  fileResult,
  mcpResult,
  mcpTools,
  openFail,
  openOk,
  policyResult,
  reverseAccept,
  reverseReject,
} from './packages-wsh.js';
import { supportHintsForRuntime } from './clawser-remote-runtime-types.js';

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

function concatBytes(chunks) {
  const total = chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0);
  const output = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return output;
}

function decodeU64(bytes, offset = 0) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return Number(view.getBigUint64(offset));
}

function encodeU64(value) {
  const output = new Uint8Array(8);
  const view = new DataView(output.buffer);
  view.setBigUint64(0, BigInt(value));
  return output;
}

function parseTransferHeader(bytes, includeSize = false) {
  if (!(bytes instanceof Uint8Array) || bytes.byteLength < 4) {
    throw new Error('invalid file transfer header');
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const pathLength = view.getUint32(0);
  const baseLength = 4 + pathLength + (includeSize ? 8 : 0);
  if (bytes.byteLength < baseLength) {
    throw new Error('truncated file transfer header');
  }
  const pathBytes = bytes.slice(4, 4 + pathLength);
  const path = textDecoder.decode(pathBytes);
  const totalSize = includeSize ? decodeU64(bytes, 4 + pathLength) : null;
  return {
    path,
    totalSize,
    headerLength: baseLength,
  };
}

// ── Kernel bridge integration (optional) ────────────────────────────
/** @type {import('./clawser-kernel-wsh-bridge.js').KernelWshBridge|null} */
let _kernelBridge = null;

export function setKernelBridge(bridge) { _kernelBridge = bridge; }
export function getKernelBridge() { return _kernelBridge; }

// ── Service injection ────────────────────────────────────────────────
/** @type {import('./clawser-tools.js').BrowserToolRegistry|null} */
let _toolRegistry = null;
/** @type {object|null} */
let _mcpClient = null;
/** @type {import('./clawser-gateway.js').ChannelGateway|null} */
let _agentGateway = null;
/** @type {import('./clawser-wsh-virtual-terminal-manager.js').VirtualTerminalManager|null} */
let _virtualTerminalManager = null;
/** @type {((request: object) => Promise<boolean>|boolean)|null} */
let _sessionApprovalProvider = null;
/** @type {import('./clawser-remote-runtime-audit.js').RemoteRuntimeAuditRecorder|null} */
let _remoteAuditRecorder = null;

export function setToolRegistry(registry) { _toolRegistry = registry; }
export function setMcpClient(client) { _mcpClient = client; }
export function setAgentGateway(gateway) { _agentGateway = gateway; }
export function setVirtualTerminalManager(manager) { _virtualTerminalManager = manager; }
export function setIncomingSessionApprovalProvider(provider) { _sessionApprovalProvider = provider; }
export function setRemoteRuntimeAuditRecorder(recorder) { _remoteAuditRecorder = recorder; }

// ── Peer context tracking ────────────────────────────────────────────

/** @type {Map<string, IncomingPeerContext>} */
const incomingSessions = new Map();

function getVirtualTerminalManager() {
  return _virtualTerminalManager;
}

function getParticipantCapabilities(client) {
  return client?.__clawserExposeCapabilities
    || client?.exposedCapabilities
    || { shell: true, exec: true, tools: true, fs: true };
}

function getParticipantMetadata(client) {
  const metadata = client?.__clawserPeerMetadata
    || {
      peerType: 'browser-shell',
      shellBackend: 'virtual-shell',
    };
  return {
    ...metadata,
    ...supportHintsForRuntime(metadata),
  };
}

function capabilityList(capabilities) {
  return Object.entries(capabilities || {})
    .filter(([, enabled]) => !!enabled)
    .map(([name]) => name);
}

function emitIncomingStatusChanged(detail = {}) {
  globalThis.dispatchEvent?.(new CustomEvent('clawser:wsh-exposure-changed', { detail }));
}

function selectActiveClient(msg) {
  const connections = getWshConnections();

  for (const client of connections.values()) {
    if (client.state === 'authenticated' && client.fingerprint === msg.target_fingerprint) {
      return client;
    }
  }

  for (const client of connections.values()) {
    if (client.state === 'authenticated') {
      return client;
    }
  }

  return null;
}

async function closeContextsForClient(client, exceptParticipantKey = null) {
  const matches = [...incomingSessions.values()]
    .filter((session) => session.client === client && session.participantKey !== exceptParticipantKey);

  for (const session of matches) {
    await session.close({ notifyRemote: false });
  }
}

class IncomingPeerContext {
  constructor({
    participantKey,
    username,
    targetFingerprint,
    client,
    capabilities,
    tenantId = null,
  }) {
    this.participantKey = participantKey;
    this.username = username;
    this.targetFingerprint = targetFingerprint;
    this.client = client;
    this.capabilities = capabilities;
    this.tenantId = tenantId;
    this.createdAt = Date.now();
    this.state = 'active';
    this._listening = false;
    this._prevRelayHandler = null;
    this._nextChannelId = 1;
    this._channels = new Map();
  }

  startListening() {
    if (this._listening) return;
    this._listening = true;
    this._prevRelayHandler = this.client.onRelayMessage;

    this.client.onRelayMessage = async (msg) => {
      if (this.state === 'active') {
        try {
          await this.handleRelayMessage(msg);
        } catch (err) {
          console.error('[wsh:incoming] relay handler failed:', err);
        }
        return;
      }

      if (this._prevRelayHandler) {
        return this._prevRelayHandler(msg);
      }
    };
  }

  stopListening() {
    if (!this._listening) return;
    this._listening = false;
    this.client.onRelayMessage = this._prevRelayHandler;
    this._prevRelayHandler = null;
  }

  reattach({
    username,
    targetFingerprint,
    client,
    capabilities,
    tenantId = this.tenantId,
  } = {}) {
    const nextClient = client || this.client;
    const clientChanged = this.client !== nextClient;

    if (clientChanged) {
      this.stopListening();
      this.client = nextClient;
    }

    this.username = username || this.username;
    this.targetFingerprint = targetFingerprint || this.targetFingerprint;
    this.capabilities = capabilities || this.capabilities;
    this.tenantId = tenantId;
    this.state = 'active';

    if (clientChanged || !this._listening) {
      this.startListening();
    }
    emitIncomingStatusChanged({ participantKey: this.participantKey, state: this.state });
  }

  async handleRelayMessage(msg) {
    switch (msg.type) {
      case MSG.OPEN:
        await this.#handleOpen(msg);
        return;
      case MSG.SESSION_DATA:
        await this.#handleSessionData(msg);
        return;
      case MSG.RESIZE:
        await this.#handleResize(msg);
        return;
      case MSG.SIGNAL:
        await this.#handleSignal(msg);
        return;
      case MSG.CLOSE:
        await this.#handleClose(msg);
        return;
      case MSG.MCP_DISCOVER:
        await this.#handleMcpDiscover();
        return;
      case MSG.MCP_CALL:
        await this.#handleMcpCall(msg);
        return;
      case MSG.FILE_OP:
        await this.#handleFileOp(msg);
        return;
      case MSG.POLICY_EVAL:
        await this.#handlePolicyEval(msg);
        return;
      case MSG.GUEST_JOIN:
      case MSG.GUEST_REVOKE:
      case MSG.COPILOT_ATTACH:
      case MSG.COPILOT_DETACH:
        // Preserve existing reverse control-plane flows without introducing
        // new behavior in this phase.
        return;
      default:
        console.log('[wsh:incoming] Unhandled relay message type:', `0x${msg.type.toString(16)}`);
    }
  }

  async handleToolCall(tool, args) {
    const registry = _toolRegistry || globalThis.__clawserToolRegistry;
    if (!registry) {
      return { success: false, output: '', error: 'No tool registry available' };
    }

    if (typeof registry.execute === 'function') {
      return registry.execute(tool, args);
    }

    const browserTool = registry.get?.(tool);
    if (!browserTool) {
      return { success: false, output: '', error: `Tool "${tool}" not found` };
    }

    try {
      return await browserTool.execute(args);
    } catch (err) {
      return { success: false, output: '', error: err.message };
    }
  }

  async handleMcpCall(tool, args) {
    const mcpClient = _mcpClient || globalThis.__clawserMcpClient;
    if (!mcpClient) {
      return { success: false, output: '', error: 'No MCP client available' };
    }

    try {
      const result = await mcpClient.callTool(tool, args);
      return { success: true, output: JSON.stringify(result) };
    } catch (err) {
      return { success: false, output: '', error: err.message };
    }
  }

  async close({ notifyRemote = false } = {}) {
    if (this.state === 'closed') return;
    this.state = 'closed';
    this.stopListening();

    const manager = getVirtualTerminalManager();
    if (manager) {
      await manager.closePeerContext(this.participantKey, { notifyRemote });
    }

    if (_kernelBridge) {
      _kernelBridge.handleParticipantLeave(this.participantKey);
    }

    incomingSessions.delete(this.participantKey);
    emitIncomingStatusChanged({ participantKey: this.participantKey, state: this.state });
  }

  async #handleOpen(msg) {
    if (msg.kind !== 'pty' && msg.kind !== 'exec' && msg.kind !== 'file') {
      await this.#sendReply(openFail({ reason: `unsupported reverse channel kind: ${msg.kind}` }));
      return;
    }

    if (msg.kind === 'file' && !this.capabilities.fs) {
      await this.#sendReply(openFail({ reason: 'reverse peer did not expose filesystem access' }));
      return;
    }

    if (msg.kind === 'pty' && !this.capabilities.shell) {
      await this.#sendReply(openFail({ reason: 'reverse peer did not expose shell access' }));
      return;
    }

    if (msg.kind === 'exec' && !(this.capabilities.exec || this.capabilities.shell)) {
      await this.#sendReply(openFail({ reason: 'reverse peer did not expose exec access' }));
      return;
    }

    const approved = await this.#approveOpen(msg);
    if (!approved.allowed) {
      await this.#sendReply(openFail({ reason: approved.reason }));
      return;
    }

    const manager = getVirtualTerminalManager();
    if (!manager) {
      await this.#sendReply(openFail({ reason: 'virtual terminal manager is not ready' }));
      return;
    }

    if (msg.kind === 'file') {
      const channelId = Number.isInteger(msg.channel_id) ? msg.channel_id : this._nextChannelId++;
      this._channels.set(channelId, {
        kind: 'file',
        command: msg.command || '',
        transfer: {
          mode: String(msg.command || '').split(':', 1)[0] || null,
          header: null,
          received: [],
        },
      });
      await this.#sendReply(openOk({
        channelId,
        dataMode: 'virtual',
        capabilities: [],
      }));
      emitIncomingStatusChanged({ participantKey: this.participantKey, state: this.state });
      return;
    }

    const resumed = await manager.tryReattachChannel(this.participantKey, {
      kind: msg.kind,
      command: msg.command || '',
      cols: msg.cols || 80,
      rows: msg.rows || 24,
    });
    if (resumed) {
      this._channels.set(resumed.channelId, {
        kind: msg.kind,
        command: msg.command || '',
        cols: msg.cols || 80,
        rows: msg.rows || 24,
      });
      await this.#sendReply(openOk({
        channelId: resumed.channelId,
        dataMode: 'virtual',
        capabilities: msg.kind === 'pty' ? ['resize', 'signal'] : [],
      }));
      emitIncomingStatusChanged({ participantKey: this.participantKey, state: this.state });
      return;
    }

    const channelId = Number.isInteger(msg.channel_id) ? msg.channel_id : this._nextChannelId++;
    const session = await manager.openChannel(this.participantKey, {
      channelId,
      kind: msg.kind,
      command: msg.command || '',
      cols: msg.cols || 80,
      rows: msg.rows || 24,
      autoStart: false,
    });
    this._channels.set(channelId, {
      kind: msg.kind,
      command: msg.command || '',
      cols: msg.cols || 80,
      rows: msg.rows || 24,
    });

    await this.#sendReply(openOk({
      channelId,
      dataMode: 'virtual',
      capabilities: msg.kind === 'pty' ? ['resize', 'signal'] : [],
    }));

    await session.start();
    emitIncomingStatusChanged({ participantKey: this.participantKey, state: this.state });
  }

  async #handleSessionData(msg) {
    const manager = getVirtualTerminalManager();
    const channel = this._channels.get(msg.channel_id);
    if (channel?.kind === 'file') {
      await this.#handleFileChannelData(channel, msg);
      return;
    }
    if (!manager) return;
    await manager.writeToChannel(this.participantKey, msg.channel_id, msg.data);
  }

  async #handleResize(msg) {
    const manager = getVirtualTerminalManager();
    if (!manager) return;
    await manager.resizeChannel(this.participantKey, msg.channel_id, msg.cols, msg.rows);
  }

  async #handleSignal(msg) {
    const manager = getVirtualTerminalManager();
    if (!manager) return;
    await manager.signalChannel(this.participantKey, msg.channel_id, msg.signal);
  }

  async #handleClose(msg) {
    const manager = getVirtualTerminalManager();
    if (!manager) return;

    if (Number.isInteger(msg.channel_id)) {
      this._channels.delete(msg.channel_id);
      await manager.closeChannel(this.participantKey, msg.channel_id, { notifyRemote: false });
      emitIncomingStatusChanged({ participantKey: this.participantKey, state: this.state });
      return;
    }

    await this.close({ notifyRemote: false });
  }

  async #handleMcpDiscover() {
    if (!this.capabilities.tools) {
      await this.#sendReply(mcpTools({ tools: [] }));
      return;
    }

    const registry = _toolRegistry || globalThis.__clawserToolRegistry;
    const tools = typeof registry?.allSpecs === 'function'
      ? registry.allSpecs()
      : [];
    await this.#sendReply(mcpTools({ tools }));
  }

  async #handleMcpCall(msg) {
    if (!this.capabilities.tools) {
      await this.#sendReply(mcpResult({
        result: { success: false, output: '', error: 'reverse peer did not expose tool access' },
      }));
      return;
    }

    const result = await this.handleMcpCall(msg.tool, msg.arguments || {});
    await this.#sendReply(mcpResult({ result }));
  }

  async #handleFileOp(msg) {
    if (!this.capabilities.fs) {
      await this.#sendReply(fileResult({
        channelId: msg.channel_id,
        success: false,
        errorMessage: 'reverse peer did not expose filesystem access',
      }));
      return;
    }

    try {
      const manager = getVirtualTerminalManager();
      const backend = manager ? await manager.getRuntimeBackend(this.participantKey) : null;
      if (backend?.metadata?.capabilities?.includes?.('fs') && typeof this.#handleVmFileOp === 'function') {
        const vmResult = await this.#handleVmFileOp(msg, backend);
        await this.#sendReply(fileResult({
          channelId: msg.channel_id,
          success: true,
          metadata: vmResult,
        }));
        return;
      }

      const result = await this.handleToolCall(`fs_${msg.op}`, {
        path: msg.path,
        offset: msg.offset,
        length: msg.length,
        data: msg.data,
      });

      await this.#sendReply(fileResult({
        channelId: msg.channel_id,
        success: result.success !== false,
        metadata: result.output ? { data: result.output } : {},
        errorMessage: result.error,
      }));
    } catch (err) {
      await this.#sendReply(fileResult({
        channelId: msg.channel_id,
        success: false,
        errorMessage: err.message,
      }));
    }
  }

  async #handleVmFileOp(msg, backend) {
    switch (msg.op) {
      case 'stat':
        return await backend.statFile(msg.path);
      case 'list':
        return { entries: await backend.listFiles(msg.path) };
      case 'read': {
        const result = await backend.readFile(msg.path, {
          offset: msg.offset,
          length: msg.length,
        });
        return { data: result.text, size: result.size };
      }
      case 'write': {
        const bytes = msg.data instanceof Uint8Array ? msg.data : textEncoder.encode(String(msg.data || ''));
        return await backend.writeFile(msg.path, bytes, { offset: msg.offset });
      }
      case 'mkdir':
        return await backend.mkdir(msg.path);
      case 'remove':
        return await backend.remove(msg.path);
      default:
        throw new Error(`unsupported VM file op: ${msg.op}`);
    }
  }

  async #handleFileChannelData(channel, msg) {
    const manager = getVirtualTerminalManager();
    const backend = manager ? await manager.getRuntimeBackend(this.participantKey) : null;
    if (!backend || !backend.metadata?.capabilities?.includes?.('fs')) {
      throw new Error('file channels are only supported for VM-console peers');
    }

    const transfer = channel.transfer || { mode: null, header: null, received: [] };
    transfer.received = transfer.received || [];
    const chunk = msg.data instanceof Uint8Array ? msg.data : new Uint8Array(msg.data || []);
    transfer.received.push(chunk);

    if (transfer.mode === 'download' && !transfer.header) {
      const buffer = concatBytes(transfer.received);
      const header = parseTransferHeader(buffer, false);
      transfer.header = header;
      transfer.received = [];
      const data = await backend.download(header.path);
      await this.#sendReply({
        type: MSG.SESSION_DATA,
        channel_id: msg.channel_id,
        data: concatBytes([encodeU64(data.byteLength), data]),
      });
      return;
    }

    if (transfer.mode === 'upload') {
      const buffer = concatBytes(transfer.received);
      if (!transfer.header) {
        transfer.header = parseTransferHeader(buffer, true);
        transfer.received = [buffer.slice(transfer.header.headerLength)];
      }
      const payload = concatBytes(transfer.received);
      if (payload.byteLength >= transfer.header.totalSize) {
        await backend.upload(payload.slice(0, transfer.header.totalSize), transfer.header.path);
        await this.#sendReply({
          type: MSG.SESSION_DATA,
          channel_id: msg.channel_id,
          data: textEncoder.encode('ok'),
        });
        transfer.received = [];
      }
    }

    channel.transfer = transfer;
  }

  async #handlePolicyEval(msg) {
    const registry = _toolRegistry || globalThis.__clawserToolRegistry;
    const tool = registry?.get?.(msg.action) || null;
    const allowedByCapability = msg.action?.startsWith?.('fs_')
      ? this.capabilities.fs
      : this.capabilities.tools;
    const allowedByPermission = !!tool && ['auto', 'read', 'internal'].includes(tool.permission);

    await this.#sendReply(policyResult({
      requestId: msg.request_id,
      allowed: allowedByCapability && allowedByPermission,
      reason: allowedByCapability && allowedByPermission
        ? 'permitted by local reverse-peer policy'
        : 'blocked by reverse-peer capability policy',
    }));
  }

  async #sendReply(msg) {
    if (this.state !== 'active') return;
    await this.client.sendRelayControl(msg);
  }

  async #approveOpen(msg) {
    const metadata = getParticipantMetadata(this.client);
    const requireApproval = !!(this.client?.__clawserApprovalPolicy?.requireApproval || metadata.requireApproval);
    if (!requireApproval) {
      return { allowed: true, reason: 'auto-approved by reverse-peer policy' };
    }

    if (typeof _sessionApprovalProvider !== 'function') {
      await _remoteAuditRecorder?.record?.('remote_session_denied', {
        participantKey: this.participantKey,
        username: this.username,
        fingerprint: this.targetFingerprint,
        kind: msg.kind,
        command: msg.command || '',
        layer: 'local-exposure',
        code: 'approval-required',
        reason: 'reverse peer requires approval but no approval provider is configured',
        actor: 'operator',
      });
      return {
        allowed: false,
        reason: 'reverse peer requires approval but no approval UI is configured',
      };
    }

    const approved = await _sessionApprovalProvider({
      participantKey: this.participantKey,
      username: this.username,
      fingerprint: this.targetFingerprint,
      kind: msg.kind,
      command: msg.command || '',
      capabilities: capabilityList(this.capabilities),
      peerType: metadata.peerType,
      shellBackend: metadata.shellBackend,
    });
    await _remoteAuditRecorder?.record?.(
      approved ? 'remote_session_approved' : 'remote_session_denied',
      {
        participantKey: this.participantKey,
        username: this.username,
        fingerprint: this.targetFingerprint,
        kind: msg.kind,
        command: msg.command || '',
        layer: 'local-exposure',
        code: approved ? 'approved' : 'approval-denied',
        reason: approved
          ? 'operator approved incoming reverse session'
          : 'operator denied incoming reverse session',
        actor: 'operator',
      },
    );
    return approved
      ? { allowed: true, reason: 'approved by operator' }
      : { allowed: false, reason: 'incoming reverse session was denied locally' };
  }
}

// ── Public API ───────────────────────────────────────────────────────

export async function handleReverseConnect(msg) {
  const activeClient = selectActiveClient(msg);
  if (!activeClient) {
    console.warn('[wsh:incoming] No active relay client is available for reverse connect');
    return;
  }

  const manager = getVirtualTerminalManager();
  if (!manager) {
    await activeClient.sendRelayControl(reverseReject({
      targetFingerprint: msg.target_fingerprint,
      username: msg.username,
      reason: 'virtual terminal manager is not ready',
    }));
    return;
  }

  const participantKey = buildReverseParticipantKey({
    username: msg.username,
    targetFingerprint: msg.target_fingerprint,
  });
  const capabilities = getParticipantCapabilities(activeClient);
  const metadata = getParticipantMetadata(activeClient);

  await closeContextsForClient(activeClient, participantKey);

  const existing = incomingSessions.get(participantKey);
  let tenantId = existing?.tenantId || null;
  if (!tenantId && _kernelBridge) {
    tenantId = _kernelBridge.handleReverseConnect({
      participantId: participantKey,
      username: msg.username,
      fingerprint: msg.target_fingerprint || '',
    }).tenantId;
  }

  await manager.registerPeerContext({
    participantKey,
    username: msg.username,
    targetFingerprint: msg.target_fingerprint,
    client: activeClient,
    capabilities,
    peerType: metadata.peerType,
    shellBackend: metadata.shellBackend,
    vmRuntimeId: metadata.vmRuntimeId || null,
    tenantId,
  });

  if (existing) {
    existing.reattach({
      username: msg.username,
      targetFingerprint: msg.target_fingerprint,
      client: activeClient,
      capabilities,
      peerType: metadata.peerType,
      shellBackend: metadata.shellBackend,
      vmRuntimeId: metadata.vmRuntimeId || null,
      tenantId,
    });
  } else {
    const session = new IncomingPeerContext({
      participantKey,
      username: msg.username,
      targetFingerprint: msg.target_fingerprint,
      client: activeClient,
      capabilities,
      tenantId,
    });
    incomingSessions.set(participantKey, session);
    session.startListening();
  }

  await activeClient.sendRelayControl(reverseAccept({
    targetFingerprint: msg.target_fingerprint,
    username: msg.username,
    capabilities: capabilityList(capabilities),
    peerType: metadata.peerType || 'browser-shell',
    shellBackend: metadata.shellBackend || 'virtual-shell',
    supportsAttach: metadata.supportsAttach,
    supportsReplay: metadata.supportsReplay,
    supportsEcho: metadata.supportsEcho,
    supportsTermSync: metadata.supportsTermSync,
  }));
}

export function listIncomingSessions() {
  return [...incomingSessions.values()].map((session) => ({
    participantKey: session.participantKey,
    username: session.username,
    fingerprint: session.targetFingerprint,
    createdAt: session.createdAt,
    state: session.state,
    host: session.client?.__clawserReverseRegistration?.relayHost || null,
    activeChannels: session._channels?.size || 0,
    channels: [...(session._channels?.entries?.() || [])].map(([channelId, channel]) => ({
      channelId,
      ...channel,
    })),
  }));
}

export function getIncomingSession(prefix) {
  if (incomingSessions.has(prefix)) {
    return incomingSessions.get(prefix);
  }

  for (const session of incomingSessions.values()) {
    if (session.participantKey.startsWith(prefix)) return session;
    if (session.targetFingerprint?.startsWith(prefix)) return session;
    if (session.username === prefix) return session;
  }

  return null;
}

globalThis.__wshIncomingHandler = handleReverseConnect;
