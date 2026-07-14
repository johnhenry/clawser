# Build

Zero build step, PWA, Docker, CI/CD, browser compat, CDN deps, testing

---

### Zero Build Step

**Status:** ✅ Implemented · **Category:** build · **Since:** v1.0.0

No build step required. Pure ES modules served directly from the web/ directory. All 240+ modules are pre-compiled .js bundles with accompanying .d.ts type definitions. External dependencies loaded via CDN (cdnjs.cloudflare.com). Zero npm runtime deps.

**Source files:**

- `web/`
- `package.json`

> **Note:** External CDN dependencies include ai.matey, BrowserMesh packages, html2canvas, and utility libraries. All loaded on demand.

---

### Development Server

**Status:** ✅ Implemented · **Category:** server · **Since:** v1.0.0

HTTPS dev server via web/serve-https.mjs or HTTP fallback via npx serve on port 8080. HTTPS recommended for Web Crypto API and Service Worker support.

**Source files:**

- `web/serve-https.mjs`
- `web/Procfile`

> **Note:** Commands: npm start (HTTPS), npm run start:http (HTTP on :8080).

---

### PWA (Progressive Web App)

**Status:** ✅ Implemented · **Category:** pwa · **Since:** v1.0.0

Installable as a Progressive Web App. Service Worker (sw.js) provides offline caching and background sync. PWA manifest enables home screen installation on mobile and desktop. Manifest fields: id, display, display_override (window-controls-overlay / standalone / minimal-ui), categories (developer/productivity/utilities), orientation, shortcuts (New chat, Terminal), icons (192/512 + SVG, maskable).

**Source files:**

- `web/sw.js`
- `web/manifest.json`

---

### PWA Install Flow

**Status:** ✅ Implemented · **Category:** pwa · **Since:** v2.1.0

Captures the browser-fired beforeinstallprompt event, exposes an imperative tryInstall() to surface the native install prompt, and notifies subscribers when the app becomes installable or installed. Detects standalone mode (iOS Safari home-screen install or display-mode standalone media query) and platform (iOS/Android/desktop). Wired in clawser-app.js at boot.

**Source files:**

- `web/clawser-pwa-install.js`
- `web/clawser-app.js`
- `web/manifest.json`

**API surface:**

- `initPwaInstall`
- `tryInstall`
- `getInstallState`
- `onInstallStateChange`
- `isStandalone`
- `detectPlatform`

> **Note:** Returned outcome from tryInstall(): 'accepted' | 'dismissed' | 'unavailable'. iOS Safari has no beforeinstallprompt; getInstallState reports installable=false there but isStandalone correctly detects Add-to-Home-Screen.

**See also:**

- PWA (Progressive Web App)

---

### Docker Deployment

**Status:** ✅ Implemented · **Category:** docker · **Since:** v1.0.0

Dockerfile for containerized deployment. Packages the web/ directory with a Node.js server for self-hosted instances.

**Source files:**

- `Dockerfile`
- `.dockerignore`

---

### CI/CD Pipeline

**Status:** ✅ Implemented · **Category:** ci-cd · **Since:** v1.0.0

GitHub Actions workflow for continuous integration and deployment. Runs tests, linting, and type checking on pull requests and pushes.

**Source files:**

- `.github/workflows/`

---

### Test Suite

**Status:** ✅ Implemented · **Category:** testing · **Since:** v1.0.0

Comprehensive test infrastructure with 300+ test files and 8,800+ tests across 12 test groups. Custom test runner (run-tests.mjs) plus vitest for unit tests and Playwright for E2E tests.

**Source files:**

- `web/test/`
- `vitest.config.js`
- `playwright.config.js`

> **Note:** Test groups: core, mesh, mesh-net, mesh-sync, mesh-identity, mesh-apps, mesh-ops, e2e, and changed-files-only. Commands: npm test (all), npm run test:fast (fast subset), npm run test:core (core only), npm run test:e2e (end-to-end), npm run test:changed (changed files).

---

### Playwright E2E Tests

**Status:** ✅ Implemented · **Category:** testing · **Since:** v1.0.0

Playwright configuration for browser-based end-to-end testing. Tests the full UI flow including chat, tool execution, workspace management, and multi-tab coordination.

**Source files:**

- `playwright.config.js`

---

### Performance Benchmarks

**Status:** ✅ Implemented · **Category:** benchmarks · **Since:** v1.0.0

Performance benchmark page for measuring tool execution times, LLM latencies, context compaction speed, and memory usage.

**Source files:**

- `web/bench.html`

> **Note:** Performance targets: less than 64MB memory, less than 100ms startup, less than 100ms tool execution, less than 2s context compaction.

---

### Browser Compatibility

**Status:** ✅ Implemented · **Category:** compat · **Since:** v1.0.0

Targets modern browsers with ES2022+ module support. Requires Web Crypto API, OPFS (Origin Private File System), BroadcastChannel, and SharedWorker. Chrome 127+ recommended for Chrome AI features.

> **Note:** Required APIs: ES Modules, Web Crypto, OPFS, BroadcastChannel, SharedWorker, Fetch, AbortController. Optional: Web Serial, Web Bluetooth, WebUSB, Screen Wake Lock.

---

### TypeScript Definitions

**Status:** ✅ Implemented · **Category:** types · **Since:** v1.0.0

77 TypeScript definition files (.d.ts) providing complete type coverage for all modules. Shared types exported from types.d.ts. Enables IDE autocompletion and type checking for consumers.

**Source files:**

- `web/types.d.ts`
- `web/clawser-*.d.ts`

**API surface:**

- `types.d.ts`

> **Note:** 77+ .d.ts files covering all production modules.

---

### Package Ecosystem

**Status:** ✅ Implemented · **Category:** packages · **Since:** v2.0.0

Five package exports for external consumption: kernel (microkernel services), andbox (sandboxed execution), netway (virtual networking), pod (pod architecture), wsh (remote shell), and mesh-primitives (CRDT/identity/wire format).

**Source files:**

- `web/packages-kernel.js`
- `web/packages-andbox.js`
- `web/packages-netway.js`
- `web/packages-pod.js`
- `web/packages-wsh.js`
- `web/packages-mesh-primitives.js`

**API surface:**

- `packages-kernel`
- `packages-andbox`
- `packages-netway`
- `packages-pod`
- `packages-wsh`
- `packages-mesh-primitives`

---

### Reference Implementations

**Status:** ✅ Implemented · **Category:** reference · **Since:** v1.5.0

Three reference implementations in .reference/ directory: ironclaw, zeroclaw, and nullclaw. Provide alternative agent configurations for testing and comparison.

**Source files:**

- `.reference/`

---

### Sandbox (Andbox)

**Status:** ✅ Implemented · **Category:** sandbox · **Since:** v1.5.0

Sandboxed code execution environment using Web Workers and WASM. Multiple capability tiers (minimal, web, fs, full, agent) with CapabilityGate enforcement. WorkerSandbox and WasmSandbox implementations.

**Source files:**

- `web/clawser-sandbox.js`
- `web/clawser-sandbox.d.ts`

**API surface:**

- `CapabilityGate`
- `WorkerSandbox`
- `WasmSandbox`
- `SandboxManager`
- `SandboxRunTool`
- `SandboxStatusTool`
- `SANDBOX_TIERS`
- `CAPABILITIES`
- `SANDBOX_LIMITS`

> **Note:** Tiers: minimal, web, fs, full, agent. Each tier grants progressively more capabilities.

---

---

[← Pods](./pods.md) | [Index](./index.md)
