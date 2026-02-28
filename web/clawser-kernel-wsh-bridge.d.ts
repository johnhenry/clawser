/**
 * Type definitions for clawser-kernel-wsh-bridge.js
 * — Kernel ↔ wsh bridge: maps wsh session participants to kernel tenants.
 */

export interface GuestJoinEvent {
  guestId: string;
  ttl?: number;
}

export interface CopilotAttachEvent {
  copilotId: string;
}

export interface SessionGrantEvent {
  participantId: string;
  capabilities: string[];
  env?: Record<string, string>;
}

export interface ReverseConnectEvent {
  username: string;
  fingerprint: string;
  capabilities?: string[];
}

export interface TenantResult {
  tenantId: string;
}

/**
 * Bridge between wsh session events and kernel tenant lifecycle.
 */
export declare class KernelWshBridge {
  constructor(kernel: unknown);

  /**
   * Handle a wsh GuestJoin event.
   */
  handleGuestJoin(event: GuestJoinEvent): TenantResult;

  /**
   * Handle a wsh CopilotAttach event.
   */
  handleCopilotAttach(event: CopilotAttachEvent): TenantResult;

  /**
   * Handle a wsh SessionGrant event (arbitrary capability grant).
   */
  handleSessionGrant(event: SessionGrantEvent): TenantResult;

  /**
   * Handle an incoming reverse connection from a remote CLI client.
   */
  handleReverseConnect(event: ReverseConnectEvent): TenantResult;

  /**
   * Handle a participant departure (GuestRevoke, CopilotDetach, SessionRevoke).
   */
  handleParticipantLeave(participantId: string): void;

  /**
   * Get the tenant ID for a participant.
   */
  getTenantId(participantId: string): string | undefined;

  /**
   * Bind to a wsh client's callback properties.
   */
  bind(wshClient: unknown): void;

  /**
   * Clean up all tenants managed by this bridge.
   */
  close(): void;
}
