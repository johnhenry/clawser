/**
 * Kernel ↔ wsh bridge — maps wsh session participants to kernel tenants.
 *
 * Listens to wsh client events and manages tenant lifecycle automatically:
 *   GuestJoin      → createTenant({ capabilities: [CLOCK, STDIO], env: { GUEST: 'true', TTL: '3600' } })
 *   CopilotAttach  → createTenant({ capabilities: [STDIO], env: { COPILOT: 'true', MODE: 'read-only' } })
 *   SessionGrant   → createTenant({ capabilities: [...grantedCaps] })
 *   ReverseConnect → createTenant({ capabilities: [STDIO, CLOCK], env: { REVERSE: 'true' } })
 *   GuestRevoke / CopilotDetach / SessionRevoke / close → destroyTenant(tenantId)
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
   * Handle an incoming reverse connection from a remote CLI client.
   * Grants restricted capabilities — STDIO and CLOCK only by default,
   * since the remote user is executing tools through the relay and should
   * not get full FS or NET access.
   *
   * @param {Object} event
   * @param {string} event.username - Remote CLI username.
   * @param {string} event.fingerprint - Remote CLI fingerprint.
   * @param {string[]} [event.capabilities] - Override default caps.
   * @returns {{ tenantId: string }}
   */
  handleReverseConnect({ username, fingerprint, capabilities }) {
    const caps = capabilities || [KERNEL_CAP.STDIO, KERNEL_CAP.CLOCK];
    const tenant = this.#kernel.createTenant({
      capabilities: caps,
      env: {
        REVERSE: 'true',
        USERNAME: username,
        FINGERPRINT: fingerprint,
        PARTICIPANT_ID: username,
      },
    });
    this.#tenantMap.set(username, tenant.id);
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
   * Bind to a wsh client's callback properties.
   *
   * WshClient uses direct callback properties (onReverseConnect, onClose, etc.)
   * rather than EventEmitter `.on()`. This method wires those callbacks,
   * chaining with any previously-set handler.
   *
   * @param {Object} wshClient - wsh client with callback properties.
   */
  bind(wshClient) {
    if (!wshClient) return;

    // Wire onReverseConnect — the primary entry point for incoming CLI peers.
    const prevReverseConnect = wshClient.onReverseConnect;
    wshClient.onReverseConnect = (msg) => {
      this.handleReverseConnect({
        username: msg.username,
        fingerprint: msg.target_fingerprint || msg.fingerprint || '',
      });
      if (prevReverseConnect) prevReverseConnect(msg);
    };

    // Wire onClose — clean up all tenants when the client disconnects.
    const prevClose = wshClient.onClose;
    wshClient.onClose = (reason) => {
      this.close();
      if (prevClose) prevClose(reason);
    };
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
