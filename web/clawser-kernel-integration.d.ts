/**
 * Type definitions for clawser-kernel-integration.js
 * — System-wide kernel integration adapter.
 */

export interface CreateTenantOptions {
  capabilities?: string[];
  env?: Record<string, string>;
}

export interface LlmCallUsage {
  model: string;
  provider: string;
  input_tokens: number;
  output_tokens: number;
  cost_usd: number;
  tenant_id?: string;
}

export interface SchedulerClock {
  nowWall: () => number;
  sleep: (ms: number) => Promise<void>;
}

export interface SandboxTenantResult {
  tenantId: string;
  serializedCaps: string[];
}

/**
 * Centralized kernel integration adapter.
 * Each hook method is safe to call with or without a kernel instance.
 */
export declare class KernelIntegration {
  constructor(kernel: unknown | null);

  /** The underlying kernel instance (may be null). */
  get kernel(): unknown | null;

  /** Whether kernel integration is active. */
  get active(): boolean;

  // ── Step 23: Workspace lifecycle as kernel tenants ──────────

  /**
   * Create a kernel tenant for a workspace.
   */
  createWorkspaceTenant(
    wsId: string,
    opts?: CreateTenantOptions,
  ): unknown | null;

  /**
   * Destroy the kernel tenant for a workspace.
   */
  destroyWorkspaceTenant(wsId: string): void;

  /**
   * Get the tenant ID for a workspace.
   */
  getWorkspaceTenantId(wsId: string): string | undefined;

  /**
   * Create a sub-tenant for a skill within a workspace.
   */
  createSkillTenant(
    wsId: string,
    skillName: string,
    requiredCaps: string[],
  ): unknown | null;

  // ── Step 24: Shell pipes as kernel ByteStreams ──────────────

  /**
   * Create a ByteStream pipe pair for shell pipeline use.
   */
  createShellPipe(): [unknown, unknown] | null;

  // ── Step 25: MCP servers as svc:// services ────────────────

  /**
   * Register an MCP server as a kernel service.
   */
  registerMcpService(name: string, mcpClient: unknown): void;

  /**
   * Unregister an MCP server from the kernel service registry.
   */
  unregisterMcpService(name: string): void;

  // ── Step 26: Provider cost tracking via Tracer ─────────────

  /**
   * Emit an LLM call trace event for cost tracking.
   */
  traceLlmCall(usage: LlmCallUsage): void;

  // ── Step 27: Sandbox as kernel tenant runtime ──────────────

  /**
   * Create a tenant for a sandbox (andbox) Worker.
   */
  createSandboxTenant(
    wsId: string,
    caps?: string[],
  ): SandboxTenantResult | null;

  // ── Step 28: Daemon IPC via MessagePorts ────────────────────

  /**
   * Create a kernel MessagePort pair for tab-to-daemon communication.
   */
  createDaemonChannel(): [unknown, unknown] | null;

  // ── Step 29: EventLog + Tracer unification ─────────────────

  /**
   * Hook an EventLog to pipe events to the kernel Tracer.
   */
  hookEventLog(eventLog: unknown): ((...args: unknown[]) => unknown) | null;

  // ── Step 30: Scheduler via kernel Clock + Signal ───────────

  /**
   * Get the kernel clock for scheduler use.
   */
  getSchedulerClock(): SchedulerClock | null;

  /**
   * Create a SignalController for a scheduler job.
   */
  createJobSignalController(): unknown | null;

  // ── Lifecycle ──────────────────────────────────────────────

  /**
   * Clean up all integration state.
   */
  close(): void;
}
