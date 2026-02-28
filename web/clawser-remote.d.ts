/**
 * Type definitions for clawser-remote.js
 * — Remote Access Gateway + Pairing.
 */

import type { ToolResult } from './types.d.ts';

// ── Constants ────────────────────────────────────────────────

export declare const DEFAULT_CODE_LENGTH: 6;
export declare const DEFAULT_CODE_EXPIRY_MS: number;
export declare const DEFAULT_TOKEN_EXPIRY_MS: number;
export declare const DEFAULT_RATE_LIMIT: 60;

// ── Pairing Code ─────────────────────────────────────────────

/**
 * Generate a random N-digit numeric pairing code.
 */
export declare function generatePairingCode(length?: number): string;

/**
 * Generate a random bearer token.
 */
export declare function generateToken(): string;

// ── PairingManager ───────────────────────────────────────────

export interface PairingExchangeResult {
  token: string;
  expires: number;
}

export interface SessionInfo {
  token: string;
  device: string | null;
  created: number;
  expires: number;
}

export declare class PairingManager {
  constructor(opts?: {
    codeExpiry?: number;
    tokenExpiry?: number;
    onLog?: (msg: string) => void;
  });

  /** Generate a new pairing code. */
  createCode(): string;

  /**
   * Exchange a pairing code for a bearer token.
   */
  exchangeCode(
    code: string,
    meta?: { device?: string; ip?: string },
  ): PairingExchangeResult | null;

  /** Validate a bearer token. */
  validateToken(token: string): boolean;

  /** Revoke a token. */
  revokeToken(token: string): boolean;

  /** Revoke all tokens. */
  revokeAll(): void;

  /** List active sessions. */
  listSessions(): SessionInfo[];

  /** Number of active sessions. */
  get sessionCount(): number;

  /** Number of active (unexpired) codes. */
  get codeCount(): number;
}

// ── RateLimiter ──────────────────────────────────────────────

export declare class RateLimiter {
  constructor(maxPerMinute?: number);

  /** Check if a request should be allowed. */
  allow(token: string): boolean;

  /** Get remaining requests for a token. */
  remaining(token: string): number;

  /** Max requests per minute. */
  get maxPerMinute(): number;
}

// ── GatewayClient ────────────────────────────────────────────

export declare class GatewayClient {
  constructor(opts?: {
    baseUrl?: string;
    token?: string;
    fetchFn?: typeof fetch;
  });

  get token(): string | null;
  get baseUrl(): string;
  get authenticated(): boolean;

  /** Pair with the gateway using a 6-digit code. */
  pair(
    code: string,
    meta?: Record<string, unknown>,
  ): Promise<{ token: string; expires: number }>;

  /** Send a message to the agent. */
  sendMessage(
    text: string,
    meta?: Record<string, unknown>,
  ): Promise<unknown>;

  /** Get agent status. */
  getStatus(): Promise<unknown>;

  /** Disconnect and clear token. */
  disconnect(): void;
}

// ── Agent Tools ──────────────────────────────────────────────

export declare class RemoteStatusTool {
  constructor(pairing: PairingManager);
  get name(): 'remote_status';
  get description(): string;
  get parameters(): object;
  get permission(): 'read';
  execute(): Promise<ToolResult>;
}

export declare class RemotePairTool {
  constructor(pairing: PairingManager);
  get name(): 'remote_pair';
  get description(): string;
  get parameters(): object;
  get permission(): 'approve';
  execute(): Promise<ToolResult>;
}

export declare class RemoteRevokeTool {
  constructor(pairing: PairingManager);
  get name(): 'remote_revoke';
  get description(): string;
  get parameters(): object;
  get permission(): 'approve';
  execute(params?: { all?: boolean }): Promise<ToolResult>;
}
