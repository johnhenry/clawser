import { VirtualTerminalSession } from './clawser-wsh-virtual-terminal-session.js';

function normalizeCapabilities(capabilities) {
  if (Array.isArray(capabilities)) {
    return {
      shell: capabilities.includes('shell'),
      tools: capabilities.includes('tools'),
      fs: capabilities.includes('fs'),
    };
  }

  if (capabilities && typeof capabilities === 'object') {
    return {
      shell: capabilities.shell !== false,
      tools: capabilities.tools !== false,
      fs: capabilities.fs !== false,
    };
  }

  return { shell: true, tools: true, fs: true };
}

export function buildReverseParticipantKey({ username = '', targetFingerprint = '' } = {}) {
  return `reverse:${targetFingerprint || 'unknown'}:${username || 'anonymous'}`;
}

export class VirtualTerminalManager {
  #shellFactory;
  #vmConsoleFactory;
  #contexts = new Map();

  constructor({ shellFactory, vmConsoleFactory = null } = {}) {
    if (typeof shellFactory !== 'function') {
      throw new Error('shellFactory is required');
    }
    this.#shellFactory = shellFactory;
    this.#vmConsoleFactory = vmConsoleFactory;
  }

  async registerPeerContext({
    participantKey,
    username,
    targetFingerprint,
    client,
    capabilities,
    peerType = 'browser-shell',
    shellBackend = 'virtual-shell',
    vmRuntimeId = null,
    tenantId = null,
  } = {}) {
    if (!participantKey) {
      throw new Error('participantKey is required');
    }
    if (!client || typeof client.sendRelayControl !== 'function') {
      throw new Error('client.sendRelayControl is required');
    }

    const existing = this.#contexts.get(participantKey);
    if (existing) {
      existing.username = username || existing.username;
      existing.targetFingerprint = targetFingerprint || existing.targetFingerprint;
      existing.client = client;
      existing.capabilities = normalizeCapabilities(capabilities);
      existing.peerType = peerType || existing.peerType;
      existing.shellBackend = shellBackend || existing.shellBackend;
      existing.vmRuntimeId = vmRuntimeId || existing.vmRuntimeId || null;
      existing.tenantId = tenantId;
      existing.state = 'active';
      existing.pendingReattachChannelIds = new Set(existing.channels.keys());
      return existing;
    }

    const context = {
      participantKey,
      username: username || '',
      targetFingerprint: targetFingerprint || '',
      client,
      capabilities: normalizeCapabilities(capabilities),
      peerType,
      shellBackend,
      vmRuntimeId,
      tenantId,
      state: 'active',
      channels: new Map(),
      pendingReattachChannelIds: new Set(),
    };

    this.#contexts.set(participantKey, context);
    return context;
  }

  getPeerContext(participantKey) {
    return this.#contexts.get(participantKey) || null;
  }

  listPeerContexts() {
    return [...this.#contexts.values()].map((context) => ({
      participantKey: context.participantKey,
      username: context.username,
      targetFingerprint: context.targetFingerprint,
      tenantId: context.tenantId,
      state: context.state,
      capabilities: { ...context.capabilities },
      peerType: context.peerType,
      shellBackend: context.shellBackend,
      channelIds: [...context.channels.keys()],
      pendingReattachChannelIds: [...context.pendingReattachChannelIds],
    }));
  }

  hasCapability(participantKey, capability) {
    return !!this.#requirePeerContext(participantKey).capabilities?.[capability];
  }

  async openChannel(participantKey, {
    channelId,
    kind = 'pty',
    command = '',
    cols = 80,
    rows = 24,
    autoStart = true,
  } = {}) {
    const context = this.#requirePeerContext(participantKey);

    if (context.channels.has(channelId)) {
      await this.closeChannel(participantKey, channelId, { notifyRemote: false });
    }

    const session = new VirtualTerminalSession({
      participantKey,
      channelId,
      kind,
      command,
      cols,
      rows,
      shellFactory: () => this.#createShell({ context, participantKey, channelId, kind }),
      sendControl: (msg) => context.client.sendRelayControl(msg),
    });

    session.onClose = () => {
      context.channels.delete(channelId);
      context.pendingReattachChannelIds.delete(channelId);
    };

    context.channels.set(channelId, session);
    if (autoStart) {
      await session.start();
    }
    return session;
  }

  async tryReattachChannel(participantKey, {
    kind = 'pty',
    command = '',
    cols = 80,
    rows = 24,
  } = {}) {
    const context = this.#requirePeerContext(participantKey);
    if (!(context.pendingReattachChannelIds instanceof Set) || context.pendingReattachChannelIds.size === 0) {
      return null;
    }

    const candidates = [...context.pendingReattachChannelIds]
      .map((channelId) => context.channels.get(channelId) || null)
      .filter(Boolean)
      .filter((session) => !session.closed && session.kind === kind)
      .filter((session) => {
        if (kind === 'exec') {
          return session.command === (command || '');
        }
        return !command;
      });

    if (candidates.length !== 1) {
      return null;
    }

    const session = candidates[0];
    context.pendingReattachChannelIds.delete(session.channelId);
    await session.replayToRemote({ cols, rows });
    return session;
  }

  getChannel(participantKey, channelId) {
    return this.#requirePeerContext(participantKey).channels.get(channelId) || null;
  }

  async writeToChannel(participantKey, channelId, data) {
    const session = this.#requireChannel(participantKey, channelId);
    await session.write(data);
    return session;
  }

  async resizeChannel(participantKey, channelId, cols, rows) {
    const session = this.#requireChannel(participantKey, channelId);
    await session.resize(cols, rows);
    return session;
  }

  async signalChannel(participantKey, channelId, signal) {
    const session = this.#requireChannel(participantKey, channelId);
    await session.signal(signal);
    return session;
  }

  async closeChannel(participantKey, channelId, { notifyRemote = true } = {}) {
    const context = this.#requirePeerContext(participantKey);
    const session = context.channels.get(channelId);
    if (!session) return;
    await session.close({ notifyRemote });
    context.channels.delete(channelId);
    context.pendingReattachChannelIds.delete(channelId);
  }

  async closePeerContext(participantKey, { notifyRemote = false } = {}) {
    const context = this.#contexts.get(participantKey);
    if (!context) return;

    context.state = 'closing';
    const channelIds = [...context.channels.keys()];
    for (const channelId of channelIds) {
      await this.closeChannel(participantKey, channelId, { notifyRemote });
    }

    this.#contexts.delete(participantKey);
  }

  async close() {
    const participantKeys = [...this.#contexts.keys()];
    for (const participantKey of participantKeys) {
      await this.closePeerContext(participantKey, { notifyRemote: false });
    }
  }

  async getRuntimeBackend(participantKey) {
    const context = this.#requirePeerContext(participantKey);
    if (context?.shellBackend === 'vm-console' && this.#vmConsoleFactory) {
      return this.#vmConsoleFactory({
        peerContext: context,
        participantKey,
        kind: 'backend',
      });
    }
    return null;
  }

  #requirePeerContext(participantKey) {
    const context = this.#contexts.get(participantKey);
    if (!context) {
      throw new Error(`Unknown reverse peer context: ${participantKey}`);
    }
    return context;
  }

  #requireChannel(participantKey, channelId) {
    const session = this.#requirePeerContext(participantKey).channels.get(channelId);
    if (!session) {
      throw new Error(`Unknown reverse terminal channel: ${channelId}`);
    }
    return session;
  }

  async #createShell({ context, participantKey, channelId, kind }) {
    if (context?.shellBackend === 'vm-console' && this.#vmConsoleFactory) {
      return this.#vmConsoleFactory({
        peerContext: context,
        participantKey,
        channelId,
        kind,
      });
    }
    return this.#shellFactory({
      peerContext: context,
      participantKey,
      channelId,
      kind,
    });
  }
}
