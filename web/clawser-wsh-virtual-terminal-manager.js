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
  #contexts = new Map();

  constructor({ shellFactory } = {}) {
    if (typeof shellFactory !== 'function') {
      throw new Error('shellFactory is required');
    }
    this.#shellFactory = shellFactory;
  }

  async registerPeerContext({
    participantKey,
    username,
    targetFingerprint,
    client,
    capabilities,
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
      existing.tenantId = tenantId;
      existing.state = 'active';
      return existing;
    }

    const context = {
      participantKey,
      username: username || '',
      targetFingerprint: targetFingerprint || '',
      client,
      capabilities: normalizeCapabilities(capabilities),
      tenantId,
      state: 'active',
      channels: new Map(),
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
      channelIds: [...context.channels.keys()],
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
      shellFactory: () => this.#shellFactory({ participantKey, channelId, kind }),
      sendControl: (msg) => context.client.sendRelayControl(msg),
    });

    session.onClose = () => {
      context.channels.delete(channelId);
    };

    context.channels.set(channelId, session);
    await session.start();
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
}
