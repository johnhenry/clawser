/**
 * Type definitions for clawser-channels.js
 * — Multi-Channel Input: ChannelManager, message formatting, and agent tools.
 */

import type { ToolResult } from './types.d.ts';

// ── Constants ────────────────────────────────────────────────

export declare const CHANNEL_TYPES: Readonly<{
  WEBHOOK: 'webhook';
  TELEGRAM: 'telegram';
  DISCORD: 'discord';
  SLACK: 'slack';
  MATRIX: 'matrix';
  EMAIL: 'email';
  IRC: 'irc';
}>;

export type ChannelType =
  | 'webhook'
  | 'telegram'
  | 'discord'
  | 'slack'
  | 'matrix'
  | 'email'
  | 'irc';

// ── Inbound Message ──────────────────────────────────────────

export interface InboundMessageSender {
  id: string;
  name: string;
  username: string | null;
}

export interface InboundMessage {
  id: string;
  channel: string;
  channelId: string | null;
  sender: InboundMessageSender;
  content: string;
  attachments: unknown[];
  replyTo: string | null;
  timestamp: number;
}

/** Reset the internal message counter (for testing). */
export declare function resetMessageCounter(): void;

/**
 * Create a normalized inbound message.
 */
export declare function createInboundMessage(opts?: {
  id?: string;
  channel?: string;
  channelId?: string | null;
  sender?: Partial<InboundMessageSender>;
  content?: string;
  attachments?: unknown[];
  replyTo?: string | null;
  timestamp?: number;
}): InboundMessage;

// ── Channel Config ───────────────────────────────────────────

export interface ChannelConfig {
  name: string;
  enabled: boolean;
  allowedUsers: string[];
  allowedChannels: string[];
  secret: string | null;
}

/**
 * Create a channel configuration with allowlists.
 */
export declare function createChannelConfig(opts?: {
  name?: string;
  enabled?: boolean;
  allowedUsers?: string[];
  allowedChannels?: string[];
  secret?: string | null;
}): ChannelConfig;

/**
 * Check if a message is allowed by channel config.
 */
export declare function isMessageAllowed(
  config: ChannelConfig,
  message: InboundMessage,
): boolean;

/**
 * Format a message for a specific channel.
 */
export declare function formatForChannel(
  channel: string,
  message: string,
): string | { subject: string; body: string };

// ── ChannelManager ───────────────────────────────────────────

export declare class ChannelManager {
  constructor(opts?: {
    onMessage?: (message: InboundMessage) => void;
    onLog?: (msg: string) => void;
    maxHistory?: number;
    createWs?: (url: string) => unknown;
  });

  /** Whether connected to bridge WebSocket. */
  get connected(): boolean;

  /** Number of configured channels. */
  get channelCount(): number;

  /** Add or update a channel configuration. */
  addChannel(config: Partial<ChannelConfig> & { name: string }): void;

  /** Remove a channel configuration. */
  removeChannel(name: string): boolean;

  /** Get channel configuration. */
  getChannel(name: string): ChannelConfig | undefined;

  /** List all channel configurations. */
  listChannels(): ChannelConfig[];

  /** Connect to bridge WebSocket. */
  connect(url: string): void;

  /** Disconnect from bridge. */
  disconnect(): void;

  /**
   * Handle an inbound message directly (for testing or non-WebSocket usage).
   */
  handleInbound(raw: unknown): void;

  /**
   * Send a message to a channel via bridge.
   * @returns Whether send was attempted.
   */
  send(channel: string, channelId: string, message: string): boolean;

  /**
   * Get recent messages, optionally filtered by channel.
   */
  getHistory(opts?: {
    channel?: string;
    limit?: number;
  }): InboundMessage[];

  /**
   * Format a message for agent context.
   */
  formatForAgent(msg: InboundMessage): string;

  /**
   * Build a system prompt section describing connected channels.
   */
  buildPrompt(): string;
}

// ── Agent Tools ──────────────────────────────────────────────

export declare class ChannelListTool {
  constructor(manager: ChannelManager);
  get name(): 'channel_list';
  get description(): string;
  get parameters(): object;
  get permission(): 'read';
  execute(): Promise<ToolResult>;
}

export declare class ChannelSendTool {
  constructor(manager: ChannelManager);
  get name(): 'channel_send';
  get description(): string;
  get parameters(): object;
  get permission(): 'approve';
  execute(params: {
    channel: string;
    channel_id: string;
    message: string;
  }): Promise<ToolResult>;
}

export declare class ChannelHistoryTool {
  constructor(manager: ChannelManager);
  get name(): 'channel_history';
  get description(): string;
  get parameters(): object;
  get permission(): 'read';
  execute(params?: {
    channel?: string;
    limit?: number;
  }): Promise<ToolResult>;
}

export declare class ChannelCreateTool {
  constructor(manager: ChannelManager);
  get name(): 'channel_create';
  get description(): string;
  get parameters(): object;
  get permission(): 'approve';
  execute(params: {
    name: string;
    enabled?: boolean;
    allowed_users?: string[];
    allowed_channels?: string[];
    secret?: string;
  }): Promise<ToolResult>;
}

export declare class ChannelDeleteTool {
  constructor(manager: ChannelManager);
  get name(): 'channel_delete';
  get description(): string;
  get parameters(): object;
  get permission(): 'approve';
  execute(params: {
    channel_id: string;
  }): Promise<ToolResult>;
}
