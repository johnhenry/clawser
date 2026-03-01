# Plugin System

The Clawser plugin system (`clawser-plugins.js`) provides a formal extension point for third-party tools and behaviors.

## Overview

Plugins register tools, hooks, and metadata with the agent through the `PluginLoader` class. This allows external packages to extend Clawser's capabilities without modifying core code.

## PluginLoader API

### `register(plugin)`

Register a plugin. Throws if a plugin with the same name already exists.

```js
loader.register({
  name: 'my-plugin',
  version: '1.0.0',
  tools: [
    { name: 'my_tool', description: 'Does something', parameters: { type: 'object', properties: {} } }
  ],
  hooks: {
    beforeOutbound: (msg) => { /* modify outbound message */ },
    onSessionStart: () => { /* setup */ },
  },
  metadata: { author: 'John' },
});
```

**Plugin descriptor shape:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `name` | string | yes | Unique plugin identifier |
| `version` | string | no | Semver version (default `'0.0.0'`) |
| `tools` | Array | no | Tool definitions to register |
| `hooks` | object | no | Hook callbacks keyed by hook name |
| `metadata` | object | no | Arbitrary metadata |

### `unregister(name)`

Remove a plugin by name. Returns `true` if found and removed, `false` otherwise.

### `list()`

Returns array of `{ name, version, toolCount }` for all registered plugins.

### `get(name)`

Returns the full plugin descriptor or `null`.

### `getTools()`

Collects all tools from all plugins into a flat array. Each tool is annotated with `_plugin` indicating its source.

### `getHooks()`

Collects all hooks from all plugins into `{ hookName: [fn1, fn2, ...] }`. Multiple plugins can register the same hook — they execute in registration order.

### `size`

Number of registered plugins.

## Hook Points

Plugins can register callbacks for these hooks:

| Hook | Signature | When |
|------|-----------|------|
| `beforeInbound` | `(message) => message` | Before processing an inbound user message |
| `beforeOutbound` | `(message) => message` | Before sending a message to the LLM |
| `transformResponse` | `(response) => response` | After receiving an LLM response |
| `beforeToolCall` | `(toolName, args) => args` | Before a tool is invoked |
| `onSessionStart` | `() => void` | When a new conversation session begins |
| `onSessionEnd` | `() => void` | When a session ends |

## Tool Registration

Tools registered via plugins follow the same schema as built-in tools:

```js
{
  name: 'plugin_tool_name',
  description: 'What this tool does',
  parameters: {
    type: 'object',
    properties: {
      arg1: { type: 'string', description: 'First argument' },
    },
    required: ['arg1'],
  },
}
```

## Usage

```js
import { PluginLoader } from './clawser-plugins.js';

const loader = new PluginLoader();

// Register
loader.register({ name: 'analytics', version: '1.0.0', tools: [...] });

// Query
console.log(loader.size);        // 1
console.log(loader.list());      // [{ name: 'analytics', version: '1.0.0', toolCount: ... }]
console.log(loader.getTools());  // [...all plugin tools...]

// Cleanup
loader.unregister('analytics');  // true
```

## Related Files

- `web/clawser-plugins.js` — PluginLoader class (102 LOC)
- `web/clawser-tools.js` — Built-in tool registry
- `web/clawser-skills.js` — Skills system (similar extension mechanism)
