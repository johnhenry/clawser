/**
 * Kernel ↔ wsh bridge — maps wsh session participants to kernel tenants.
 *
 * Listens to wsh client events and manages tenant lifecycle automatically:
 *   GuestJoin    → createTenant({ capabilities: [CLOCK, STDIO], env: { GUEST: 'true', TTL: '3600' } })
 *   CopilotAttach → createTenant({ capabilities: [STDIO], env: { COPILOT: 'true', MODE: 'read-only' } })
 *   SessionGrant  → createTenant({ capabilities: [...grantedCaps] })
 *   GuestRevoke / CopilotDetach / SessionRevoke → destroyTenant(tenantId)
 *
 * @module clawser-kernel-wsh-bridge
 */

import { KERNEL_CAP } from './packages-kernel.js';

/**
 * Bridge between wsh session events and kernel tenant lifecycle.
 */
export class KernelWshBridge {
  #kernel;
  #tenantMap = new Map(); // participantId → tenantId
  #unsubscribers = [];

  /**
   * @param {import('./packages-kernel.js').Kernel} kernel - Kernel instance.
   */
  constructor(kernel) {
    this.#kernel = kernel;
  }

  /**
   * Handle a wsh GuestJoin event.
   *
   * @param {Object} event
   * @param {string} event.guestId - Guest participant identifier.
   * @param {number} [event.ttl=3600] - Guest TTL in seconds.
   * @returns {{ tenantId: string }} The created tenant ID.
   */
  handleGuestJoin({ guestId, ttl = 3600 }) {
    const tenant = this.#kernel.createTenant({
      capabilities: [KERNEL_CAP.CLOCK, KERNEL_CAP.STDIO],
      env: { GUEST: 'true', TTL: String(Math.min(ttl, 86400)), PARTICIPANT_ID: guestId },
    });
    this.#tenantMap.set(guestId, tenant.id);
    return { tenantId: tenant.id };
  }

  /**
   * Handle a wsh CopilotAttach event.
   *
   * @param {Object} event
   * @param {string} event.copilotId - Copilot participant identifier.
   * @returns {{ tenantId: string }}
   */
  handleCopilotAttach({ copilotId }) {
    const tenant = this.#kernel.createTenant({
      capabilities: [KERNEL_CAP.STDIO],
      env: { COPILOT: 'true', MODE: 'read-only', PARTICIPANT_ID: copilotId },
    });
    this.#tenantMap.set(copilotId, tenant.id);
    return { tenantId: tenant.id };
  }

  /**
   * Handle a wsh SessionGrant event (arbitrary capability grant).
   *
   * @param {Object} event
   * @param {string} event.participantId - Participant identifier.
   * @param {string[]} event.capabilities - KERNEL_CAP tags to grant.
   * @param {Record<string,string>} [event.env={}] - Additional environment variables.
   * @returns {{ tenantId: string }}
   */
  handleSessionGrant({ participantId, capabilities, env = {} }) {
    const tenant = this.#kernel.createTenant({
      capabilities,
      env: { ...env, PARTICIPANT_ID: participantId },
    });
    this.#tenantMap.set(participantId, tenant.id);
    return { tenantId: tenant.id };
  }

  /**
   * Handle a participant departure (GuestRevoke, CopilotDetach, SessionRevoke).
   *
   * @param {string} participantId - Participant identifier.
   */
  handleParticipantLeave(participantId) {
    const tenantId = this.#tenantMap.get(participantId);
    if (tenantId) {
      this.#kernel.destroyTenant(tenantId);
      this.#tenantMap.delete(participantId);
    }
  }

  /**
   * Get the tenant ID for a participant.
   *
   * @param {string} participantId
   * @returns {string|undefined}
   */
  getTenantId(participantId) {
    return this.#tenantMap.get(participantId);
  }

  /**
   * Bind to a wsh client event emitter. Expects the client to have
   * `on(event, callback)` method.
   *
   * @param {Object} wshClient - wsh client with event emitter interface.
   */
  bind(wshClient) {
    if (!wshClient || typeof wshClient.on !== 'function') return;

    const handlers = [
      ['GuestJoin', (e) => this.handleGuestJoin(e)],
      ['CopilotAttach', (e) => this.handleCopilotAttach(e)],
      ['SessionGrant', (e) => this.handleSessionGrant(e)],
      ['GuestRevoke', (e) => this.handleParticipantLeave(e.guestId)],
      ['CopilotDetach', (e) => this.handleParticipantLeave(e.copilotId)],
      ['SessionRevoke', (e) => this.handleParticipantLeave(e.participantId)],
    ];

    for (const [event, handler] of handlers) {
      wshClient.on(event, handler);
    }
  }

  /**
   * Clean up all tenants managed by this bridge.
   */
  close() {
    for (const [participantId, tenantId] of this.#tenantMap) {
      this.#kernel.destroyTenant(tenantId);
    }
    this.#tenantMap.clear();
  }
}
