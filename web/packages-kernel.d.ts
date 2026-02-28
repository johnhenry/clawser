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
  // Constants
  KERNEL_DEFAULTS,
  KERNEL_CAP,
  KERNEL_ERROR,

  // Derived type aliases
  type KernelCapTag,
  type KernelErrorCode,

  // Errors
  KernelError,
  HandleNotFoundError,
  HandleTypeMismatchError,
  TableFullError,
  StreamClosedError,
  CapabilityDeniedError,
  AlreadyRegisteredError,
  NotFoundError,

  // Resource management
  ResourceTable,
  type ResourceEntry,
  type ResourceTableOptions,

  // ByteStream protocol
  BYTE_STREAM,
  isByteStream,
  asByteStream,
  createPipe,
  pipe,
  devNull,
  compose,
  type ByteStream,
  type ByteStreamTransform,
  type CreatePipeOptions,

  // Clock + RNG
  Clock,
  RNG,
  type ClockOptions,
  type RNGOptions,

  // Capabilities
  buildCaps,
  requireCap,
  CapsBuilder,
  type Caps,

  // IPC
  KernelMessagePort,
  createChannel,
  ServiceRegistry,
  type MessageHandler,
  type ServiceEntry,
  type ServiceRegisterOptions,

  // Observability
  Tracer,
  Logger,
  LOG_LEVEL,
  type TraceEvent,
  type TracerOptions,
  type LogLevelValue,
  type LogEntry,
  type ModuleLogger,
  type LoggerOptions,
  type LogFilterOptions,

  // Chaos
  ChaosEngine,
  type ChaosConfig,
  type ChaosEngineOptions,

  // Environment
  Environment,

  // Signals + Stdio
  SIGNAL,
  SignalController,
  Stdio,
  type SignalName,
  type StdioOptions,

  // Kernel facade
  Kernel,
  type Tenant,
  type CreateTenantOptions,
  type KernelOptions,
} from './packages/kernel/src/index.js';
