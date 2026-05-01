/**
 * clawser-runtime.js — Runtime state initialization for /proc, /run, and /dev virtual files.
 *
 * Wires ProcFileHandler with application context (tool registry, cost tracker,
 * daemon state, tab coordinator, memory) and returns a configured handler
 * ready for use with VirtualFs.
 *
 * Also initializes DeviceFileHandler for /dev/clawser/ device files
 * (providers, channels, hardware, special devices).
 *
 * Usage:
 *   import { initRuntimeFs, initDeviceFs } from './clawser-runtime.js';
 *   const procHandler = initRuntimeFs({ toolRegistry, costTracker, ... });
 *   const deviceHandler = initDeviceFs({ providerRegistry, channelManager });
 *   const shell = new ClawserShell({ workspaceFs, wsId, procHandler, deviceHandler });
 */

import {
  ProcFileHandler,
  registerProcGenerators,
  registerRunGenerators,
} from './clawser-proc.js';
import { PermissionManager } from './clawser-permissions.js';
import {
  DeviceFileHandler,
  registerProviderDevice,
  registerChannelDevice,
  registerHardwareDevice,
  registerSpecialDevices,
} from './clawser-fs-devices.mjs';

/**
 * Initialize a ProcFileHandler with all /proc/clawser/* and /run/clawser/* generators.
 *
 * @param {object} ctx - Application context
 * @param {import('./clawser-tools.js').BrowserToolRegistry} [ctx.toolRegistry]
 * @param {import('./clawser-cost-tracker.js').CostTracker} [ctx.costTracker]
 * @param {import('./clawser-memory.js').SemanticMemory} [ctx.memory]
 * @param {import('./clawser-daemon.js').DaemonState} [ctx.daemonState]
 * @param {import('./clawser-daemon.js').TabCoordinator} [ctx.tabCoordinator]
 * @param {object[]} [ctx.agentConfig] - Agent configuration array
 * @param {object} [ctx.providerStatus] - Provider health status map
 * @param {number} [ctx.initTime] - performance.now() at workspace init
 * @param {string} [ctx.wsId] - Workspace ID
 * @param {PermissionManager} [ctx.permissions] - Permission manager for /proc/clawser/permissions
 * @returns {ProcFileHandler}
 */
export const initRuntimeFs = (ctx = {}) => {
  const handler = new ProcFileHandler();
  const fullCtx = { initTime: performance.now(), ...ctx };

  registerProcGenerators(handler, fullCtx);
  registerRunGenerators(handler, fullCtx);

  // Register /proc/clawser/permissions if a PermissionManager is provided
  if (fullCtx.permissions && fullCtx.permissions instanceof PermissionManager) {
    handler.register('/proc/clawser/permissions', () => fullCtx.permissions.dump());
  }

  return handler;
};

/**
 * Update provider status in an existing handler.
 * Useful when provider health checks complete asynchronously.
 *
 * @param {ProcFileHandler} handler
 * @param {object} providerStatus - { providerName: { healthy: boolean, error?: string } }
 * @param {string} [wsId]
 */
export const updateProviderStatus = (handler, providerStatus, wsId = 'default') => {
  handler.register('/proc/clawser/providers', () => {
    const lines = Object.entries(providerStatus).map(([name, info]) => {
      const status = info.healthy ? 'healthy' : 'error';
      const detail = info.error || '';
      return `${name}\t${status}\t${detail}`;
    });
    return lines.join('\n') + '\n';
  });
};

/**
 * Update agent configuration in an existing handler.
 *
 * @param {ProcFileHandler} handler
 * @param {object[]} agents - Array of { name, provider, ... }
 */
export const updateAgentConfig = (handler, agents) => {
  handler.register('/proc/clawser/agents', () => {
    if (!agents || agents.length === 0) return '(no agents configured)\n';
    return agents.map(a => `${a.name}\t${a.provider || a.model || 'unknown'}`).join('\n') + '\n';
  });
};

// ── Device File System Initialization ──────────────────────────────

/**
 * Initialize a DeviceFileHandler with provider, channel, hardware,
 * and special device files.
 *
 * @param {object} ctx
 * @param {import('./clawser-providers.js').ProviderRegistry} [ctx.providerRegistry] - Provider registry
 * @param {import('./clawser-channels.js').ChannelManager} [ctx.channelManager] - Channel manager
 * @param {Map<string, object>} [ctx.hardwareAdapters] - Map of name → { write, read } adapters
 * @param {object} [ctx.providerOpts] - Per-provider options { [name]: { apiKey, model } }
 * @returns {DeviceFileHandler}
 *
 * @example
 *   const deviceHandler = initDeviceFs({ providerRegistry, channelManager });
 *   const shell = new ClawserShell({ workspaceFs, wsId, procHandler, deviceHandler });
 */
export const initDeviceFs = (ctx = {}) => {
  const handler = new DeviceFileHandler();
  const { providerRegistry, channelManager, hardwareAdapters, providerOpts = {} } = ctx;

  // Register special devices first (/dev/clawser/null, /dev/clawser/random, /dev/clawser/zero)
  registerSpecialDevices(handler);

  // Register provider devices
  if (providerRegistry) {
    for (const name of providerRegistry.names()) {
      registerProviderDevice(handler, name, providerRegistry, providerOpts[name] || {});
    }
  }

  // Register channel devices
  if (channelManager) {
    // Channel names come from CHANNEL_TYPES or configured channels
    const channelNames = ['slack', 'discord', 'telegram', 'matrix', 'email', 'irc', 'webhook'];
    for (const name of channelNames) {
      registerChannelDevice(handler, name, channelManager);
    }
  }

  // Register hardware devices
  if (hardwareAdapters) {
    for (const [name, adapter] of hardwareAdapters) {
      registerHardwareDevice(handler, name, adapter);
    }
  }

  return handler;
};

/**
 * Register a new provider device on an existing handler.
 * Useful when providers are added dynamically after init.
 *
 * @param {DeviceFileHandler} handler
 * @param {string} providerName
 * @param {import('./clawser-providers.js').ProviderRegistry} providerRegistry
 * @param {object} [opts]
 */
export const addProviderDevice = (handler, providerName, providerRegistry, opts = {}) => {
  registerProviderDevice(handler, providerName, providerRegistry, opts);
};

/**
 * Register a new channel device on an existing handler.
 *
 * @param {DeviceFileHandler} handler
 * @param {string} channelName
 * @param {import('./clawser-channels.js').ChannelManager} channelManager
 */
export const addChannelDevice = (handler, channelName, channelManager) => {
  registerChannelDevice(handler, channelName, channelManager);
};

// Re-export device types for consumers
export { DeviceFileHandler } from './clawser-fs-devices.mjs';
