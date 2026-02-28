/**
 * Local re-export of andbox for browser use.
 * Maps `import { ... } from './packages-andbox.js'` to the local package.
 */
export {
  // sandbox (main export)
  createSandbox,
  // import-map-resolver
  resolveWithImportMap,
  // capability-gate
  gateCapabilities,
  // stdio
  createStdio,
  // network-policy
  createNetworkFetch,
  // deferred
  makeDeferred,
  makeAbortError,
  makeTimeoutError,
  // worker-source
  makeWorkerSource,
  // constants
  DEFAULT_TIMEOUT_MS,
  DEFAULT_LIMITS,
  DEFAULT_CAPABILITY_LIMITS,
} from './packages/andbox/src/index.js';

export type {
  // deferred
  Deferred,
  // capability-gate
  GateLimits,
  CapabilityLimits,
  GatePolicy,
  CapabilityStats,
  GateStatsResult,
  GateResult,
  // import-map-resolver
  ImportMap,
  // stdio
  StdioStream,
  // sandbox
  EvaluateOptions,
  SandboxOptions,
  SandboxStats,
  Sandbox,
} from './packages/andbox/src/index.js';
