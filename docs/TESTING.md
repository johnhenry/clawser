# Testing Guide

Clawser uses a dual test strategy: Node.js unit tests for pure logic and a browser-based test harness for DOM/API integration.

## Test Infrastructure

### Node.js Tests (`web/test/*.test.mjs`)

**Framework:** Node.js built-in `node:test` with `node:assert/strict`

**Run a single test:**
```bash
node --import ./web/test/_setup-globals.mjs --test web/test/clawser-state.test.mjs
```

**Run all tests:**
```bash
node --import ./web/test/_setup-globals.mjs --test web/test/*.test.mjs
```

### Running via npm scripts

`web/test/run-tests.mjs` is the real test runner behind the `npm test*` scripts in `package.json`; it groups files in `web/test/` by filename prefix rather than by a fixed list, so group membership is whatever currently matches the prefix (use `--list` for the current set):

| Script | Group | Files matched |
|--------|-------|----------------|
| `npm test` | `all` | `core` + `mesh` + `channels` + `sprint` + `completeness` + `e2e` + `stress` |
| `npm run test:fast` | `fast` | `core` + `channels` (excludes the slower mesh/sprint/completeness/e2e/stress groups) |
| `npm run test:core` | `core` | Every `*.test.mjs` file that doesn't match the mesh/channel/sprint/completeness/e2e/stress prefixes below |
| `npm run test:mesh` | `mesh` | All `clawser-mesh-*.test.mjs` files (union of the five mesh sub-groups below) |
| `npm run test:mesh-net` | `mesh-net` | `clawser-mesh-{peer,transport,relay,gateway,websocket,discovery,swarm,dht}.test.mjs` |
| `npm run test:mesh-sync` | `mesh-sync` | `clawser-mesh-{sync,delta-sync,streams,migration}.test.mjs` |
| `npm run test:mesh-identity` | `mesh-identity` | `clawser-mesh-{identity,identity-tools,keyring,trust,acl,capabilities}.test.mjs` |
| `npm run test:mesh-apps` | `mesh-apps` | `clawser-mesh-{apps,marketplace,payments,quotas,resources,naming}.test.mjs` |
| `npm run test:mesh-ops` | `mesh-ops` | `clawser-mesh-{audit,consensus,scheduler,visualizations,chat,tools,files,wsh-bridge,gpu,stealth}.test.mjs` |
| `npm run test:e2e` | `e2e` | `clawser-e2e-*.test.mjs` |
| `npm run test:stress` | `stress` | `clawser-stress*.test.mjs` (slow — excluded from `fast`/`core`, run explicitly) |
| `npm run test:changed` | `changed` | Test files touched in `git diff HEAD` / staged changes |

Direct invocation with options:
```bash
node web/test/run-tests.mjs --group mesh-net --concurrency 4
node web/test/run-tests.mjs --group mesh-net --list   # dry-run, no execution
```

### Vitest track

A small, separate suite runs under [Vitest](https://vitest.dev) instead of `node:test`, for cases that want Vitest's assertion/mocking API. Config: `vitest.config.js` (root), setup: `web/test/_setup-vitest.mjs`. Test files use the `*.vitest.mjs` suffix under `web/test/` (a handful of files as of this writing, e.g. `cli-json-output.vitest.mjs`, `agent-hardening.vitest.mjs`).

```bash
npm run test:vitest         # run once
npm run test:vitest:watch   # watch mode
```

**Pattern:**
```js
// Run with: node --import ./web/test/_setup-globals.mjs --test web/test/clawser-foo.test.mjs
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

// Stub BrowserTool if the module extends it
globalThis.BrowserTool = class { constructor() {} };

import { MyClass } from '../clawser-foo.js';

describe('MyClass', () => {
  it('does something', () => {
    assert.equal(new MyClass().value, 42);
  });
});
```

### Browser Tests (`web/test.html`)

Custom in-browser test framework that imports 40+ modules and tests them with DOM access.

**API:**
- `section(name)` — Group tests under a heading
- `assert(label, condition)` — Assert a boolean condition
- `assertEq(label, actual, expected)` — Assert equality
- `assertThrows(label, fn)` — Assert a function throws

**CI integration:** Logs `__TEST_RESULT__:PASS` or `__TEST_RESULT__:FAIL` to console. Results stored in `window.__testResults`.

**Run:** Open `web/test.html` in a browser, or use a headless browser for CI.

## Test Setup Polyfills (`_setup-globals.mjs`)

The setup module stubs browser globals for Node.js:

| Global | Stub |
|--------|------|
| `localStorage` | In-memory key-value store |
| `document` | Minimal `{ getElementById, createElement, addEventListener }` |
| `location` | `{ search: '', hash: '', href: '' }` |
| `history` | `{ replaceState() {} }` |
| `navigator.storage` | `{ getDirectory: async () => ({}) }` |
| `navigator.locks` | `{ request: async () => {} }` |
| `BroadcastChannel` | No-op class |
| `URL`, `TextEncoder`, `TextDecoder` | Node.js builtins |

**Important:** `globalThis.document` is a stub object (not undefined). Code that checks `typeof document === 'undefined'` to detect Node.js will see the stub and think it's in a browser. Use more specific checks (e.g., `document.head`) to distinguish.

## Writing Tests

### 1. Identify testable exports

Read the source module and identify its `export` statements. Focus on:
- Pure functions (no side effects)
- Classes with testable constructors and methods
- Constants and configuration objects

### 2. Handle dependencies

**BrowserTool subclasses:** Add before import:
```js
globalThis.BrowserTool = class { constructor() {} };
```

**Modules using `state`:** The state module reads from `localStorage`, which is stubbed by `_setup-globals.mjs`. Tests can set/clear localStorage as needed.

**Modules using `crypto`:** Available in Node.js 19+. For older versions:
```js
if (!globalThis.crypto) {
  const { webcrypto } = await import('node:crypto');
  globalThis.crypto = webcrypto;
}
```

**Modules using `window`:** Add before import:
```js
globalThis.window = { addEventListener: () => {}, postMessage: () => {} };
```

### 3. Avoid timer leaks

If a module uses `setInterval` or `setTimeout`, ensure cleanup in `afterEach`:
```js
afterEach(() => { runner.stop(); });
```

Node.js `node:test` keeps the process alive if timers are outstanding. Use `afterEach` to clear them.

### 4. Async tests

Use `async` functions, not callback-style `done` parameters:
```js
// GOOD
it('waits for result', async () => {
  const result = await doAsync();
  assert.equal(result, 'ok');
});

// BAD — node:test doesn't support done callbacks like Mocha
it('waits for result', (t, done) => {
  doAsync().then(result => { assert.equal(result, 'ok'); done(); });
});
```

## Test Categories

| Category | Files | Coverage |
|----------|-------|----------|
| **Unit tests** | `clawser-*.test.mjs` | Individual module exports |
| **Sprint tests** | `clawser-sprint{14-22}.test.mjs` | Cross-module feature tests |
| **Wiring tests** | `clawser-*-wiring.test.mjs` | Integration between modules |
| **Enhanced tests** | `clawser-*-enhanced.test.mjs` | Deep coverage of complex modules |
| **Browser tests** | `test.html` | DOM interaction, browser APIs |

## Adding a New Test File

1. Create `web/test/clawser-<module>.test.mjs`
2. Add the run comment at the top
3. Import from `node:test` and `node:assert/strict`
4. Stub any browser globals needed before importing the module
5. Write `describe`/`it` blocks
6. Run individually to verify: `node --import ./web/test/_setup-globals.mjs --test web/test/clawser-<module>.test.mjs`
7. Run full suite to confirm no regressions: `node --import ./web/test/_setup-globals.mjs --test web/test/*.test.mjs`

## Related Files

- `web/test/_setup-globals.mjs` — Browser global polyfills
- `web/test.html` — In-browser test harness
- `web/bench.html` — Performance micro-benchmarks
