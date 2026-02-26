# andbox — Sandboxed JavaScript Runtime

Worker-based sandboxed JavaScript execution with RPC capabilities, import maps, timeouts, and capability gating.

andbox runs untrusted JavaScript in an isolated Web Worker with a structured bridge back to the host. Code in the sandbox can call host-provided "capabilities" via RPC, use import-mapped packages, and define virtual modules — all with configurable rate limits, timeouts, and hard-kill semantics.

## Install

```js
// ESM import (browser, no bundler needed)
import { createSandbox } from './packages/andbox/src/index.mjs';
```

Zero dependencies. Uses only Web Workers and standard browser APIs.

## Quick Start

```js
import { createSandbox } from 'andbox';

const sandbox = await createSandbox({
  capabilities: {
    readFile: async (path) => { /* host-side file read */ },
    writeFile: async (path, content) => { /* host-side file write */ },
  },
  importMap: {
    imports: {
      'lodash': 'https://esm.sh/lodash',
    },
  },
  onConsole: (level, ...args) => console.log(`[sandbox:${level}]`, ...args),
});

// Evaluate code in the sandbox
const result = await sandbox.evaluate(`
  const greeting = 'Hello from the sandbox!';
  console.log(greeting);

  // Call a host capability
  const content = await host.call('readFile', '/etc/hostname');
  return content;
`);

// Define a virtual module
await sandbox.defineModule('utils', `
  export function add(a, b) { return a + b; }
`);

// Import the virtual module from sandbox code
await sandbox.evaluate(`
  const { add } = await sandboxImport('utils');
  return add(2, 3); // 5
`);

// Clean up
await sandbox.dispose();
```

## Architecture

```
Host (main thread)
  |
  +-- createSandbox(options)
  |     |
  |     +-- Capability Gate (rate limits, payload caps)
  |     |     |
  |     |     +-- Global: maxCalls, maxArgBytes, maxConcurrent
  |     |     +-- Per-cap: maxCalls, maxArgBytes
  |     |
  |     +-- Worker (isolated execution)
  |           |
  |           +-- Import map resolution
  |           +-- Virtual module registry
  |           +-- RPC bridge (host.call)
  |           +-- Console forwarding
  |
  +-- evaluate(code, opts)
  |     |
  |     +-- Timeout → hard kill + auto-restart
  |     +-- AbortSignal support
  |     +-- Per-call console handler
  |
  +-- defineModule(name, source)
  +-- dispose()
  +-- stats()
```

### Isolation Model

Code runs inside a **Web Worker** created from a Blob URL. The worker has:

- **No DOM access** — Workers are inherently isolated from the document
- **No direct host references** — Communication only via `postMessage` RPC
- **Capability gating** — Host functions are wrapped with rate limits before exposure
- **Hard kill** — On timeout, the Worker is `terminate()`d and a fresh one is created
- **Virtual modules** — Modules defined via `defineModule()` are available via `sandboxImport()`

## API Reference

### `createSandbox(options?)`

Creates a new sandboxed runtime. Returns a promise that resolves to a sandbox instance.

**Options:**

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `importMap` | `{ imports?, scopes? }` | `{}` | Import map for package resolution |
| `capabilities` | `Record<string, Function>` | `{}` | Host functions callable via `host.call()` |
| `defaultTimeoutMs` | `number` | `30000` | Default timeout for `evaluate()` |
| `baseURL` | `string` | `location.href` | Base URL for relative imports |
| `policy` | `GatePolicy` | — | Rate limiting policy (see below) |
| `onConsole` | `(level, ...args) => void` | — | Console output handler |

**Returns:** `{ evaluate, defineModule, dispose, stats, isDisposed }`

### `sandbox.evaluate(code, opts?)`

Evaluates JavaScript code in the sandbox. The code is wrapped in an async IIFE — use `return` to produce a result.

**Options:**

| Option | Type | Description |
|--------|------|-------------|
| `timeoutMs` | `number` | Override default timeout |
| `signal` | `AbortSignal` | Abort evaluation |
| `onConsole` | `(level, ...args) => void` | Per-call console handler |

**Inside sandbox code:**

- `host.call(name, ...args)` — Call a host capability by name
- `sandboxImport(name)` — Import a virtual module
- `console.log/warn/error/info` — Forwarded to host `onConsole`

### `sandbox.defineModule(name, source)`

Defines a virtual module that sandbox code can import via `sandboxImport(name)`.

### `sandbox.dispose()`

Terminates the Worker and rejects all pending evaluations.

### `sandbox.stats()`

Returns runtime statistics including pending evaluations, virtual modules, and gate stats.

## Capability Gating

The capability gate wraps host functions with rate limits to prevent abuse.

```js
const sandbox = await createSandbox({
  capabilities: {
    fetch: async (url) => (await fetch(url)).text(),
    db: async (query) => runQuery(query),
  },
  policy: {
    limits: {
      maxCalls: 100,        // Max total capability calls
      maxArgBytes: 1_000_000, // Max total argument bytes
      maxConcurrent: 8,     // Max concurrent pending calls
    },
    capabilities: {
      db: { maxCalls: 10, maxArgBytes: 4096 },
    },
  },
});
```

When a limit is exceeded, the capability call throws with a descriptive error.

## Module Map

| File | LOC | Purpose |
|------|-----|---------|
| `src/sandbox.mjs` | ~300 | `createSandbox()` — main API, Worker lifecycle, evaluate/dispose |
| `src/worker-source.mjs` | ~220 | Worker code generation (import map, virtual modules, RPC bridge) |
| `src/capability-gate.mjs` | ~95 | `gateCapabilities()` — rate limiting proxy around host functions |
| `src/import-map-resolver.mjs` | ~70 | `resolveWithImportMap()` — resolve specifiers against import maps |
| `src/network-policy.mjs` | ~37 | `createNetworkFetch()` — fetch with URL allowlist |
| `src/stdio.mjs` | ~58 | `createStdio()` — async iterable stdout/stderr streams |
| `src/deferred.mjs` | ~23 | `makeDeferred()`, `makeAbortError()`, `makeTimeoutError()` |
| `src/constants.mjs` | ~25 | Default timeouts and limits |
| `src/index.mjs` | ~15 | Public API re-exports |

## Utilities

### `createNetworkFetch(allowedHosts?)`

Creates a fetch function that only allows requests to specified hostnames.

```js
const safeFetch = createNetworkFetch(['api.example.com', 'cdn.example.com']);
await safeFetch('https://api.example.com/data'); // OK
await safeFetch('https://evil.com/steal');        // throws
```

### `createStdio()`

Creates an async iterable stream for console output capture.

```js
const { push, end, stream } = createStdio();

// In another async context:
for await (const line of stream) {
  process.stdout.write(line);
}
```

### `resolveWithImportMap(specifier, importMap, baseURL?)`

Resolves a module specifier against an import map, following the browser import map algorithm.

## Design Origins

andbox combines ideas from two projects:

- **almostnode** — Node-like browser runtime with polyfilled `process`, `fs`, `path`
- **vimble** — Modern ESM-first sandboxed execution via `data:` URI imports

The key insight: use Web Workers (not iframes) for isolation, ES modules with import maps for package resolution, and a structured RPC bridge for capability-based host access. No CommonJS, no bundler, no legacy shims.

## Tests

```bash
node --test web/packages/andbox/test/*.test.mjs
```

Test suites:
- `sandbox.test.mjs` — Sandbox creation, evaluation, timeouts, virtual modules, console forwarding
- `capability-gate.test.mjs` — Rate limiting, per-capability limits, concurrent limits
- `import-map-resolver.test.mjs` — Import map resolution algorithm

## License

MIT
