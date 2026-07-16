# Contributing to Clawser

Thank you for your interest in contributing to Clawser. This guide covers everything you need to get started.

## Getting Started

Clawser runs entirely in the browser with no build step. To start developing:

1. Clone the repository:
   ```bash
   git clone https://github.com/johnhenry/clawser.git
   cd clawser
   ```

2. Serve the `web/` directory with any static file server:
   ```bash
   python3 -m http.server 8080 --directory web
   # or
   npx serve web
   ```

3. Open `http://localhost:8080` in Chrome (131+ recommended for Chrome AI support). Or use the built-in HTTPS server: `npm start`.

There is no bundler and no transpiler — the app itself has zero npm runtime dependencies. Running the test suite does require `npm install` first, since several mesh/kernel packages (`browsermesh-pod`, `browsermesh-primitives`, `browsermesh-netway`, `wsh-upon-star`, `andbox`, `vitest`, `ws`, etc.) are consumed as devDependencies from `package.json`.

## Development Setup

- **Node.js**: 24+ required (for running tests)
- **Runtime**: Modern browser with ES module support
- **Build step**: None. All source files are ES modules loaded directly by the browser.
- **Dependencies**: Zero npm dependencies at runtime. Browser-facing external libraries (vimble, ai.matey, html2canvas, fflate) are loaded via CDN at runtime. `npm install` is required for the devDependencies used by the test suite (mesh/kernel packages, `vitest`, `ws`).
- **Storage**: OPFS (Origin Private File System) for persistence, localStorage for configuration
- **Testing**: `npm test` runs 359+ test files via `node:test` (see Testing section below)
- **Rust toolchain (optional)**: Only needed if you're working on the native `wsh-server`/`wsh-cli` companion in `crates/` (real PTYs + native WebTransport/QUIC — see [docs/WSH-INTO-CLAWSER.md](docs/WSH-INTO-CLAWSER.md)). Build with `cargo build --workspace`, test with `cargo test --workspace`. Not required for browser-app development.

## Code Style

### Module Naming

All modules follow the pattern `clawser-{domain}.js`:

| Module | Domain |
|--------|--------|
| `clawser-agent.js` | Agent core |
| `clawser-providers.js` | LLM providers |
| `clawser-tools.js` | Browser tools |
| `clawser-skills.js` | Skills system |
| `clawser-shell.js` | Virtual shell |
| `clawser-ui-chat.js` | Chat UI |
| `clawser-ui-panels.js` | Panel UIs |

### Conventions

- Pure ES modules with explicit `export` declarations
- No default exports; use named exports
- JSDoc comments on all public classes and methods
- Private fields use the `#` prefix (ES private class fields)
- Async functions return Promises; use `async`/`await` throughout
- Error handling: return `{ success, output, error? }` from tools, throw from internal methods
- No semicolons are enforced or forbidden; follow the style of the file you are editing

## Adding Tools

All browser tools extend the `BrowserTool` base class in `clawser-tools.js`.

1. Create a new class extending `BrowserTool`:
   ```js
   export class MyNewTool extends BrowserTool {
     get name() { return 'my_new_tool'; }
     get description() { return 'Does something useful'; }
     get parameters() {
       return {
         type: 'object',
         properties: {
           input: { type: 'string', description: 'The input value' },
         },
         required: ['input'],
       };
     }
     get permission() { return 'read'; } // 'internal' | 'read' | 'write' | 'network' | 'browser'

     async execute(params) {
       try {
         const result = doSomething(params.input);
         return { success: true, output: result };
       } catch (e) {
         return { success: false, output: '', error: e.message };
       }
     }
   }
   ```

2. Register it in `createDefaultRegistry()` at the bottom of `clawser-tools.js`:
   ```js
   registry.register(new MyNewTool());
   ```

3. The tool will automatically appear in the agent's tool list and be callable by the LLM.

### Permission Levels

| Permission | Default Policy | Use When |
|-----------|---------------|----------|
| `internal` | `auto` (always allowed) | Agent-internal operations (memory, goals) |
| `read` | `auto` | Read-only operations with no side effects |
| `write` | `approve` | Modifies state (files, DOM, storage) |
| `network` | `approve` | Makes network requests |
| `browser` | `approve` | Browser navigation, notifications |

## Adding Providers

LLM providers extend `LLMProvider` in `clawser-providers.js`.

1. Create a new class extending `LLMProvider`:
   ```js
   export class MyProvider extends LLMProvider {
     get name() { return 'my-provider'; }
     get displayName() { return 'My Provider'; }
     get requiresApiKey() { return true; }
     get supportsStreaming() { return true; }
     get supportsNativeTools() { return true; }

     async chat(request, apiKey, modelOverride, options = {}) {
       // Make API call, return ChatResponse shape:
       return {
         content: 'response text',
         tool_calls: [],
         usage: { input_tokens: 0, output_tokens: 0 },
         model: 'model-name',
       };
     }
   }
   ```

2. For OpenAI-compatible APIs, use `OpenAICompatibleProvider` and add an entry to `OPENAI_COMPATIBLE_SERVICES` instead of writing a new class.

3. Register in `createDefaultProviders()`.

## Testing

Tests use `node:test` with `node:assert/strict`. All test files live in `web/test/` and follow the naming pattern `clawser-<module>.test.mjs`. The custom runner `web/test/run-tests.mjs` organizes tests into groups for fast feedback.

### Running Tests

```bash
# Full suite
npm test                # All test files (359+)

# Group-based execution (recommended for development)
npm run test:fast       # Core + channels — fast feedback loop (~280 files)
npm run test:core       # Agent, tools, providers, shell (~270 files)
npm run test:mesh       # All mesh networking (33 files)
npm run test:mesh-net   # Peer, transport, relay, gateway, websocket (8 files)
npm run test:mesh-sync  # Sync, delta-sync, streams, migration (4 files)
npm run test:mesh-identity # Identity, keyring, trust, ACL, capabilities (6 files)
npm run test:mesh-apps  # Apps, marketplace, payments, quotas (6 files)
npm run test:mesh-ops   # Audit, consensus, scheduler, tools, wsh-bridge (9 files)
npm run test:e2e        # End-to-end scenarios (8 files)
npm run test:stress     # Concurrency/scale stress suite (slow — run explicitly)
npm run test:changed    # Only files with git changes
npm run test:vitest     # Vitest-based test files (agent hardening, CLI JSON output, etc.)

# Direct runner with options
node web/test/run-tests.mjs --group fast --concurrency 4
node web/test/run-tests.mjs --group mesh-net --list  # dry-run

# Individual test file
node --import ./web/test/_setup-globals.mjs --test web/test/clawser-<module>.test.mjs
```

File counts drift as the suite grows — pass `--list` to `run-tests.mjs` for the current set.

### Writing Tests

- Stub browser globals (`BrowserTool`, `window`, `document`) before importing modules
- `web/test/_setup-globals.mjs` provides localStorage, document, and navigator stubs
- Use `async` test functions, never callback-style `done`
- Clean up timers in `afterEach` to prevent process hangs
- Add new tests by creating `web/test/clawser-<module>.test.mjs`

## Pull Requests

1. Fork the repository and create a feature branch from `main`
2. Keep changes focused: one feature or fix per PR
3. Ensure all tests pass (`npm test`)
4. Add tests for new tools, providers, or significant features
5. Update documentation if you change public APIs
6. Write a clear PR description explaining the "why" behind the change

### Commit Messages

Follow the conventions used in the repository:

- `Add {feature}` for new functionality
- `Fix {description}` for bug fixes
- `Update {module}` for enhancements to existing features
- `Integrate {feature}` for wiring new modules into the app

## Architecture Overview

See [ARCHITECTURE.md](ARCHITECTURE.md) for a detailed breakdown of the module structure, data flow, and design decisions.
