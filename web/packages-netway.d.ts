/**
 * Re-export bridge for the netway package.
 *
 * Provides a stable, top-level import path so that other web/ modules can write:
 *
 *   import { VirtualNetwork, GatewayBackend } from './packages-netway.js';
 *
 * instead of reaching into the nested package directory.
 */

export {
  // Constants + errors
  DEFAULTS,
  GATEWAY_ERROR,
  CAPABILITY,
  NetwayError,
  ConnectionRefusedError,
  PolicyDeniedError,
  AddressInUseError,
  QueueFullError,
  UnknownSchemeError,
  SocketClosedError,
  OperationTimeoutError,

  // Core abstractions
  StreamSocket,
  DatagramSocket,
  Listener,

  // Policy + routing
  PolicyEngine,
  Router,
  parseAddress,
  OperationQueue,

  // Backends
  Backend,
  LoopbackBackend,
  GatewayBackend,
  ServiceBackend,
  ChaosBackendWrapper,
  FsServiceBackend,

  // Network
  VirtualNetwork,
  ScopedNetwork,
} from './packages/netway/src/index.mjs';

export type {
  DefaultsConfig,
  GatewayErrorCodes,
  CapabilityTags,
  CapabilityTag,
  OperationQueueOptions,
  StreamSocketPairOptions,
  DatagramSocketOptions,
  ListenerOptions,
  PolicyRequest,
  PolicyDecision,
  PolicyCallback,
  PolicyScopeOptions,
  ParsedAddress,
  ResolveResult,
  GatewayBackendOptions,
  ScopeOptions,
} from './packages/netway/src/index.d.ts';
