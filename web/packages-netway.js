/**
 * Re-export bridge for the netway package.
 *
 * Browser ES module imports require flat, predictable paths — relative
 * specifiers like `./packages/netway/src/index.mjs` are long and couple
 * consumers to the internal package layout.  This bridge provides a
 * stable, top-level import path so that other web/ modules can write:
 *
 *   import { VirtualNetwork, GatewayBackend } from './packages-netway.js';
 *
 * instead of reaching into the nested package directory.  If the netway
 * package is ever restructured or published to a CDN, only this file
 * needs to change — all consumers keep the same import.
 */
export {
  // Constants + errors
  DEFAULTS, GATEWAY_ERROR, CAPABILITY,
  NetwayError, ConnectionRefusedError, PolicyDeniedError,
  AddressInUseError, QueueFullError, UnknownSchemeError, SocketClosedError,

  // Core abstractions
  StreamSocket, DatagramSocket, Listener,

  // Policy + routing
  PolicyEngine, Router, parseAddress, OperationQueue,

  // Backends
  Backend, LoopbackBackend, GatewayBackend,

  // Network
  VirtualNetwork, ScopedNetwork,
} from './packages/netway/src/index.mjs';
