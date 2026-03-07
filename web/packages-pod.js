/**
 * Re-export bridge for the pod package.
 *
 * Provides a stable, top-level import path so that other web/ modules can write:
 *
 *   import { Pod, detectPodKind } from './packages-pod.js';
 *
 * instead of reaching into the nested package directory.
 */
export {
  // Core
  Pod,
  detectPodKind,
  detectCapabilities,

  // Wire protocol
  POD_HELLO, POD_HELLO_ACK, POD_GOODBYE, POD_MESSAGE,
  POD_RPC_REQUEST, POD_RPC_RESPONSE,
  createHello, createHelloAck, createGoodbye, createMessage,
  createRpcRequest, createRpcResponse,

  // Variants
  InjectedPod,

  // Runtime entrypoints
  installPodRuntime,
  createRuntime,
  createClient,
  createServer,
} from './packages/pod/src/index.mjs';
