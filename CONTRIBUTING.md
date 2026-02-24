# Contributing to Clawser

Thank you for your interest in contributing to Clawser. This guide covers everything you need to get started.

## Getting Started

Clawser runs entirely in the browser with no build step. To start developing:

1. Clone the repository:
   ```bash
   git clone https://github.com/your-org/clawser.git
   cd clawser
   ```

2. Serve the `web/` directory with any static file server:
   ```bash
   python3 -m http.server 8080 --directory web
   # or
   npx serve web
   ```

3. Open `http://localhost:8080` in Chrome (131+ recommended for Chrome AI support).

That's it. There is no `npm install`, no bundler, no transpiler.

## Development Setup

- **Runtime**: Modern browser with ES module support
- **Build step**: None. All source files are ES modules loaded directly by the browser.
- **Dependencies**: Zero npm dependencies. External libraries (vimble, ai.matey, html2canvas, fflate) are loaded via CDN at runtime.
- **Storage**: OPFS (Origin Private File System) for persistence, localStorage for configuration
- **Testing**: Open `web/test.html` in Chrome to run the regression test suite (39 modules)

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

- Open `web/test.html` in Chrome to run the full test suite
- Tests are browser-based (no Node.js test runner)
- 39 test modules covering agent core, tools, providers, shell, skills, and feature modules
- Add new tests by creating a test function and registering it in `test.html`

## Pull Requests

1. Fork the repository and create a feature branch from `main`
2. Keep changes focused: one feature or fix per PR
3. Ensure all tests pass in `web/test.html`
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
