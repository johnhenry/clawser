/**
 * Local re-export of andbox for browser use.
 * Maps `import { createSandbox } from './packages-andbox.js'` to the local package.
 */
export {
  createSandbox,
  resolveWithImportMap,
  gateCapabilities,
  createStdio,
  createNetworkFetch,
  makeDeferred,
  makeAbortError,
  makeTimeoutError,
  makeWorkerSource,
  DEFAULT_TIMEOUT_MS,
  DEFAULT_LIMITS,
  DEFAULT_CAPABILITY_LIMITS,
} from './packages/andbox/src/index.mjs';
