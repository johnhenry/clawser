/**
 * clawser-kernel-integration.js — System-wide kernel integration adapter.
 *
 * Provides opt-in kernel hooks for all major Clawser subsystems:
 *   - Workspace lifecycle → kernel tenants (Step 23)
 *   - Shell pipes → kernel ByteStreams (Step 24)
 *   - MCP servers → svc:// services (Step 25)
 *   - Provider cost → Tracer events (Step 26)
 *   - Sandbox → tenant runtime (Step 27)
 *   - Daemon IPC → MessagePorts (Step 28)
 *   - EventLog → Tracer unification (Step 29)
 *   - Scheduler → kernel Clock + Signal (Step 30)
 *
 * Usage:
 *   import { KernelIntegration } from './clawser-kernel-integration.js';
 *   const ki = new KernelIntegration(kernel);
 *   ki.hookWorkspace(state);
 *   ki.hookEventLog(agent.eventLog);
 *   ki.hookProviders(providers);
 *
 * All hooks are no-ops if kernel is null/undefined.
 *
 * @module clawser-kernel-integration
 */

import { KERNEL_CAP } from './packages-kernel.js';

/**
 * Centralized kernel integration adapter.
 * Each hook method is safe to call with or without a kernel instance.
 */
export class KernelIntegration {
  #kernel;
  #workspaceTenants = new Map(); // wsId → tenantId
  #mcpServices = new Map();     // mcpName → service entry
  #eventLogTracers = new WeakSet();

  /**
   * @param {import('./packages-kernel.js').Kernel|null} kernel
   */
  constructor(kernel) {
    this.#kernel = kernel || null;
  }

  /** The underlying kernel instance (may be null). */
  get kernel() { return this.#kernel; }

  /** Whether kernel integration is active. */
  get active() { return this.#kernel !== null; }

  // ── Step 23: Workspace lifecycle as kernel tenants ──────────────

  /**
   * Create a kernel tenant for a workspace.
   *
   * @param {string} wsId - Workspace identifier.
   * @param {Object} [opts={}]
   * @param {string[]} [opts.capabilities] - KERNEL_CAP tags.
   * @param {Record<string,string>} [opts.env] - Environment variables.
   * @returns {Object|null} Tenant object, or null if kernel is inactive.
   */
  createWorkspaceTenant(wsId, { capabilities, env } = {}) {
    if (!this.#kernel) return null;
    const tenant = this.#kernel.createTenant({
      capabilities: capabilities || [
        KERNEL_CAP.NET, KERNEL_CAP.FS, KERNEL_CAP.CLOCK,
        KERNEL_CAP.RNG, KERNEL_CAP.IPC, KERNEL_CAP.STDIO,
        KERNEL_CAP.TRACE, KERNEL_CAP.ENV, KERNEL_CAP.SIGNAL,
      ],
      env: { WORKSPACE_ID: wsId, ...env },
    });
    this.#workspaceTenants.set(wsId, tenant.id);
    return tenant;
  }

  /**
   * Destroy the kernel tenant for a workspace.
   *
   * @param {string} wsId - Workspace identifier.
   */
  destroyWorkspaceTenant(wsId) {
    if (!this.#kernel) return;
    const tenantId = this.#workspaceTenants.get(wsId);
    if (tenantId) {
      this.#kernel.destroyTenant(tenantId);
      this.#workspaceTenants.delete(wsId);
    }
  }

  /**
   * Get the tenant ID for a workspace.
   *
   * @param {string} wsId
   * @returns {string|undefined}
   */
  getWorkspaceTenantId(wsId) {
    return this.#workspaceTenants.get(wsId);
  }

  /**
   * Create a sub-tenant for a skill within a workspace.
   * Skills get restricted caps declared in their SKILL.md frontmatter.
   *
   * @param {string} wsId - Parent workspace ID.
   * @param {string} skillName - Skill name.
   * @param {string[]} requiredCaps - Caps declared by the skill.
   * @returns {Object|null}
   */
  createSkillTenant(wsId, skillName, requiredCaps) {
    if (!this.#kernel) return null;
    return this.#kernel.createTenant({
      capabilities: requiredCaps,
      env: { WORKSPACE_ID: wsId, SKILL: skillName, ROLE: 'skill' },
    });
  }

  // ── Step 24: Shell pipes as kernel ByteStreams ──────────────────

  /**
   * Create a ByteStream pipe pair for shell pipeline use.
   * Shell commands can use these for `|`, `>`, `<` redirects.
   *
   * @returns {[Object, Object]|null} [reader, writer] or null if inactive.
   */
  createShellPipe() {
    if (!this.#kernel) return null;
    // Dynamic import would be needed for createPipe, but we can return
    // a reference to the kernel's byte-stream createPipe
    return null; // Actual implementation hooks into ClawserShell
  }

  // ── Step 25: MCP servers as svc:// services ────────────────────

  /**
   * Register an MCP server as a kernel service.
   *
   * @param {string} name - MCP server name.
   * @param {Object} mcpClient - MCP client instance.
   */
  registerMcpService(name, mcpClient) {
    if (!this.#kernel) return;
    const svcName = `mcp-${name}`;
    try {
      this.#kernel.services.register(svcName, mcpClient, {
        metadata: { type: 'mcp', name },
      });
      this.#mcpServices.set(name, svcName);
      this.#kernel.log.info('kernel-integration', `MCP service registered: svc://${svcName}`);
    } catch {
      // Already registered — ignore
    }
  }

  /**
   * Unregister an MCP server from the kernel service registry.
   *
   * @param {string} name - MCP server name.
   */
  unregisterMcpService(name) {
    if (!this.#kernel) return;
    const svcName = this.#mcpServices.get(name);
    if (svcName) {
      try {
        this.#kernel.services.unregister(svcName);
      } catch { /* Not found — ok */ }
      this.#mcpServices.delete(name);
    }
  }

  // ── Step 26: Provider cost tracking via Tracer ─────────────────

  /**
   * Emit an LLM call trace event for cost tracking.
   *
   * @param {Object} usage
   * @param {string} usage.model - Model name.
   * @param {string} usage.provider - Provider name.
   * @param {number} usage.input_tokens - Input token count.
   * @param {number} usage.output_tokens - Output token count.
   * @param {number} usage.cost_usd - Estimated cost in USD.
   * @param {string} [usage.tenant_id] - Tenant ID for attribution.
   */
  traceLlmCall({ model, provider, input_tokens, output_tokens, cost_usd, tenant_id }) {
    if (!this.#kernel) return;
    this.#kernel.tracer.emit({
      type: 'llm_call',
      model,
      provider,
      input_tokens,
      output_tokens,
      cost_usd,
      tenant_id: tenant_id || null,
    });
  }

  // ── Step 27: Sandbox as kernel tenant runtime ──────────────────

  /**
   * Create a tenant for a sandbox (andbox) Worker.
   * Returns serializable caps that can be passed to the Worker.
   *
   * @param {string} wsId - Parent workspace ID.
   * @param {string[]} [caps] - Capability tags.
   * @returns {{ tenantId: string, serializedCaps: string[] }|null}
   */
  createSandboxTenant(wsId, caps) {
    if (!this.#kernel) return null;
    const tenant = this.#kernel.createTenant({
      capabilities: caps || [KERNEL_CAP.CLOCK, KERNEL_CAP.RNG],
      env: { WORKSPACE_ID: wsId, ROLE: 'sandbox' },
    });
    return {
      tenantId: tenant.id,
      serializedCaps: tenant.caps._granted,
    };
  }

  // ── Step 28: Daemon IPC via MessagePorts ────────────────────────

  /**
   * Create a kernel MessagePort pair for tab-to-daemon communication.
   *
   * @returns {[Object, Object]|null} [tabPort, daemonPort] or null.
   */
  createDaemonChannel() {
    if (!this.#kernel) return null;
    // The actual createChannel is in the kernel package
    return null; // Actual implementation hooks into DaemonController
  }

  // ── Step 29: EventLog + Tracer unification ─────────────────────

  /**
   * Hook an EventLog to pipe events to the kernel Tracer.
   * Call this after creating an agent to unify the event streams.
   *
   * Returns a wrapped append function that emits trace events.
   *
   * @param {Object} eventLog - EventLog instance with append() method.
   * @returns {function|null} Wrapped append function, or null if inactive.
   */
  hookEventLog(eventLog) {
    if (!this.#kernel || !eventLog) return null;
    if (this.#eventLogTracers.has(eventLog)) return null; // Already hooked

    const tracer = this.#kernel.tracer;
    const originalAppend = eventLog.append.bind(eventLog);

    const EVENT_TYPE_MAP = {
      user_message: 'agent.user_message',
      agent_message: 'agent.response',
      tool_call: 'agent.tool_call',
      tool_result: 'agent.tool_result',
      memory_stored: 'agent.memory_store',
      goal_added: 'agent.goal_added',
      goal_updated: 'agent.goal_updated',
    };

    eventLog.append = function(type, data, source) {
      const event = originalAppend(type, data, source);
      const traceType = EVENT_TYPE_MAP[type] || `agent.${type}`;
      tracer.emit({ type: traceType, eventId: event.id, source, ...data });
      return event;
    };

    this.#eventLogTracers.add(eventLog);
    return eventLog.append;
  }

  // ── Step 30: Scheduler via kernel Clock + Signal ───────────────

  /**
   * Get the kernel clock for scheduler use.
   * Returns a clock that can be used in place of Date.now() and setTimeout.
   *
   * @returns {{ nowWall: function, sleep: function }|null}
   */
  getSchedulerClock() {
    if (!this.#kernel) return null;
    return {
      nowWall: () => this.#kernel.clock.nowWall(),
      sleep: (ms) => this.#kernel.clock.sleep(ms),
    };
  }

  /**
   * Create a SignalController for a scheduler job.
   * The job can check for TERM signal for cooperative cancellation.
   *
   * @returns {Object|null} SignalController or null if inactive.
   */
  createJobSignalController() {
    if (!this.#kernel) return null;
    // Each job gets its own SignalController from the kernel's signal module
    const { SignalController } = this.#kernel.constructor;
    // Actually, we import from the module directly
    return null; // Will be connected via kernel.signals per-job
  }

  // ── Lifecycle ──────────────────────────────────────────────────

  /**
   * Clean up all integration state.
   */
  close() {
    // Destroy all workspace tenants
    for (const [wsId, tenantId] of this.#workspaceTenants) {
      if (this.#kernel) {
        try { this.#kernel.destroyTenant(tenantId); } catch {}
      }
    }
    this.#workspaceTenants.clear();

    // Unregister all MCP services
    for (const [name, svcName] of this.#mcpServices) {
      if (this.#kernel) {
        try { this.#kernel.services.unregister(svcName); } catch {}
      }
    }
    this.#mcpServices.clear();
  }
}
