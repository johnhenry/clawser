/**
 * Re-export bridge for the kernel package.
 *
 * Provides a stable, top-level import path so that other web/ modules can write:
 *
 *   import { Kernel, KERNEL_CAP } from './packages-kernel.js';
 *
 * instead of reaching into the nested package directory.
 */
export {
  // Constants + errors
  KERNEL_DEFAULTS, KERNEL_CAP, KERNEL_ERROR,
  KernelError, HandleNotFoundError, HandleTypeMismatchError,
  TableFullError, StreamClosedError, CapabilityDeniedError,
  AlreadyRegisteredError, NotFoundError,

  // Resource management
  ResourceTable,

  // ByteStream protocol
  BYTE_STREAM, isByteStream, asByteStream, createPipe, pipe, devNull, compose,

  // Clock + RNG
  Clock, RNG,

  // Capabilities
  buildCaps, requireCap, CapsBuilder,

  // IPC
  KernelMessagePort, createChannel,
  ServiceRegistry,

  // Observability
  Tracer, Logger, LOG_LEVEL,

  // Chaos
  ChaosEngine,

  // Environment
  Environment,

  // Signals + Stdio
  SIGNAL, SignalController, Stdio,

  // Kernel facade
  Kernel,
} from './packages/kernel/src/index.mjs';
