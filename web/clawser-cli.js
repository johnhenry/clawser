/**
 * Clawser CLI — AI-Integrated Terminal Commands
 *
 * Registers the `clawser` command and its subcommands with a shell CommandRegistry.
 * Provides one-shot prompting, agentic task execution, config management,
 * tool listing, memory CRUD, and other agent introspection commands.
 *
 * Pure ES module. The agent and shell are passed via closures so no imports
 * from clawser-agent.js are needed.
 *
 * Usage:
 *   import { registerClawserCli } from './clawser-cli.js';
 *   registerClawserCli(registry, getAgent, getShell);
 */

// ── Flag Parser ─────────────────────────────────────────────────

/**
 * Minimal flag parser for CLI args.
 *
 * @param {string[]} args - Raw argument tokens
 * @param {object} spec - Flag specification object. Keys are flag names.
 *   - Short-to-long mapping: `{ p: 'print' }` means `-p` maps to `--print`
 *   - Boolean flag: `{ 'no-stream': true }` means `--no-stream` takes no value
 *   - Flags not in spec that start with `-` are treated as boolean
 * @returns {{ flags: object, positional: string[] }}
 *
 * @example
 *   parseFlags(['-p', 'hello', '--model', 'gpt-4', 'extra'], {
 *     p: 'print', m: 'model', 'no-stream': true
 *   })
 *   // => { flags: { print: 'hello', model: 'gpt-4' }, positional: ['extra'] }
 */
export function parseFlags(args, spec) {
  const flags = {};
  const positional = [];
  const booleans = new Set();
  const shortMap = {};

  // Build lookup tables from spec
  for (const [key, value] of Object.entries(spec)) {
    if (typeof value === 'string') {
      // Short-to-long mapping: { p: 'print' }
      shortMap[key] = value;
    } else if (value === true) {
      // Boolean flag: { 'no-stream': true }
      booleans.add(key);
    }
  }

  let i = 0;
  while (i < args.length) {
    const arg = args[i];

    if (arg === '--') {
      // Everything after -- is positional
      positional.push(...args.slice(i + 1));
      break;
    }

    if (arg.startsWith('--')) {
      const name = arg.slice(2);
      if (booleans.has(name)) {
        flags[name] = true;
        i++;
      } else if (i + 1 < args.length && !args[i + 1].startsWith('-')) {
        flags[name] = args[i + 1];
        i += 2;
      } else {
        flags[name] = true;
        i++;
      }
    } else if (arg.startsWith('-') && arg.length > 1) {
      const short = arg.slice(1);
      const long = shortMap[short] || short;
      if (booleans.has(long) || booleans.has(short)) {
        flags[long] = true;
        i++;
      } else if (i + 1 < args.length && !args[i + 1].startsWith('-')) {
        flags[long] = args[i + 1];
        i += 2;
      } else {
        flags[long] = true;
        i++;
      }
    } else {
      positional.push(arg);
      i++;
    }
  }

  return { flags, positional };
}

// ── Help Text ───────────────────────────────────────────────────

const HELP_TEXT = `clawser — AI agent CLI

Usage:
  clawser "prompt"              One-shot ask (shorthand for -p)
  clawser -p "prompt"           One-shot ask
  clawser do "task"             Agentic task execution (encourages tool use)
  clawser chat                  Enter interactive agent chat mode
  clawser exit                  Exit agent chat mode

  clawser config                Show current configuration
  clawser config set KEY VALUE  Set a config value (model, max_tokens, system_prompt)
  clawser status                Show agent state summary
  clawser model [name]          Show or set the current model
  clawser cost                  Show session cost
  clawser tools                 List available tools
  clawser history               List past conversation events
  clawser clear                 Clear conversation history
  clawser compact               Trigger context compaction
  clawser memory list           List all memories
  clawser memory add KEY VALUE  Add a memory entry
  clawser memory remove KEY     Remove a memory entry
  clawser mcp                   Show MCP server status
  clawser session                List terminal sessions
  clawser session new [name]     Create new terminal session
  clawser session switch <name>  Switch to a session
  clawser session rename <name>  Rename current session
  clawser session delete <name>  Delete a session
  clawser session fork [name]    Fork current session
  clawser session export [fmt]   Export session (--script|--markdown|--json|--html)
  clawser session save           Persist current session

Flags:
  -p, --print TEXT              Prompt text for one-shot mode
  -m, --model NAME              Model override
  -j, --json                    Emit machine-readable JSONL output
  --output json|text            Output format (--output json is alias for --json)
  --system TEXT                  System prompt override
  --no-stream                   Disable streaming
  --continue                    Continue previous conversation
  --resume                      Resume from checkpoint
  --tools LIST                  Comma-separated tool filter
  --max-turns N                 Max agent loop iterations
`;

// ── Subcommand Metadata ─────────────────────────────────────────

/**
 * Metadata for all `clawser` subcommands, for use by the Shell Commands UI panel.
 * @type {Array<{name: string, description: string, usage: string, flags?: object}>}
 */
export const CLAWSER_SUBCOMMAND_META = [
  { name: 'chat', description: 'Enter interactive agent chat mode', usage: 'clawser chat' },
  { name: 'exit', description: 'Exit agent chat mode', usage: 'clawser exit' },
  { name: 'do', description: 'Agentic task execution with tool use', usage: 'clawser do "TASK"' },
  { name: 'config', description: 'Show or set agent configuration', usage: 'clawser config [set KEY VALUE]' },
  { name: 'status', description: 'Show agent state summary', usage: 'clawser status' },
  { name: 'history', description: 'List past conversation events', usage: 'clawser history' },
  { name: 'clear', description: 'Clear conversation history', usage: 'clawser clear' },
  { name: 'tools', description: 'List available tools', usage: 'clawser tools' },
  { name: 'model', description: 'Show or set the current model', usage: 'clawser model [NAME]' },
  { name: 'cost', description: 'Show session cost estimate', usage: 'clawser cost' },
  { name: 'compact', description: 'Trigger context compaction', usage: 'clawser compact' },
  { name: 'memory', description: 'Manage agent memory entries', usage: 'clawser memory [list|add|remove] [KEY] [VALUE]' },
  { name: 'mcp', description: 'Show MCP server status', usage: 'clawser mcp' },
  { name: 'session', description: 'Manage terminal sessions', usage: 'clawser session [list|new|switch|rename|delete|fork|export|save]' },
];

// ── JSON Output Helpers ────────────────────────────────────────

/**
 * Wrap structured data as a successful JSON output envelope.
 *
 * @param {object} data - The payload
 * @param {string} command - The command string that produced this output
 * @returns {{ stdout: string, stderr: string, exitCode: number }}
 *
 * @example
 *   jsonOut({ model: 'claude-sonnet-4-20250514' }, 'clawser model')
 *   // => { stdout: '{"ok":true,"command":"clawser model","data":{"model":"claude-sonnet-4-20250514"}}\n', ... }
 */
export const jsonOut = (data, command) => ({
  stdout: JSON.stringify({ ok: true, command, data }) + '\n',
  stderr: '',
  exitCode: 0,
});

/**
 * Wrap an error as a JSON output envelope.
 *
 * @param {{ code: string, message: string }} error - Error details
 * @param {string} command - The command string that produced this error
 * @returns {{ stdout: string, stderr: string, exitCode: number }}
 *
 * @example
 *   jsonErr({ code: 'NO_AGENT', message: 'No agent available' }, 'clawser status')
 */
export const jsonErr = (error, command) => ({
  stdout: JSON.stringify({ ok: false, command, error }) + '\n',
  stderr: '',
  exitCode: 1,
});

/**
 * Emit a single JSONL line for streaming output.
 *
 * @param {string} type - Line type (message, tool_call, tool_result, error, status)
 * @param {object} fields - Additional fields to include
 * @returns {string} A single JSON line with trailing newline
 *
 * @example
 *   jsonLine('status', { state: 'thinking' })
 *   // => '{"type":"status","state":"thinking","timestamp":"2026-04-29T..."}\n'
 */
export const jsonLine = (type, fields = {}) =>
  JSON.stringify({ type, ...fields, timestamp: new Date().toISOString() }) + '\n';

/**
 * Resolve whether JSON mode is active from parsed flags.
 *
 * @param {object} flags - Parsed flag object
 * @returns {boolean}
 */
export const isJsonMode = (flags) =>
  flags.json === true || flags.output === 'json';

// ── Command Registration ────────────────────────────────────────

/**
 * Register the `clawser` command and all subcommands with a CommandRegistry.
 *
 * @param {import('./clawser-shell.js').CommandRegistry} registry
 * @param {() => import('./clawser-agent.js').ClawserAgent | null} getAgent
 * @param {() => import('./clawser-shell.js').ClawserShell | null} getShell
 */
export function registerClawserCli(registry, getAgent, getShell) {

  const FLAG_SPEC = {
    p: 'print',
    m: 'model',
    s: 'system',
    j: 'json',
    json: true,
    // Value-consuming flags (not boolean): system, tools, max-turns, output
    // are absent from the spec so parseFlags treats them as value-consuming
    // Boolean flags (no value):
    'no-stream': true,
    continue: true,
    resume: true,
  };

  // ── One-shot prompt helper ──────────────────────────────────

  async function oneShot(prompt, json = false) {
    const agent = getAgent();
    if (!agent) {
      if (json) return jsonErr({ code: 'NO_AGENT', message: 'No agent available' }, 'clawser');
      return { stdout: '', stderr: 'No agent available', exitCode: 1 };
    }
    try {
      agent.sendMessage(prompt);
      const resp = await agent.run();
      const text = resp?.content || resp?.text || '(no response)';
      if (json) {
        let stdout = jsonLine('status', { state: 'thinking' });
        stdout += jsonLine('message', { role: 'assistant', content: text });
        stdout += jsonLine('status', { state: 'done' });
        return { stdout, stderr: '', exitCode: 0 };
      }
      return { stdout: text + '\n', stderr: '', exitCode: 0 };
    } catch (e) {
      if (json) return jsonErr({ code: 'AGENT_ERROR', message: e.message }, 'clawser');
      return { stdout: '', stderr: `Agent error: ${e.message}`, exitCode: 1 };
    }
  }

  // ── Subcommand: chat ────────────────────────────────────────

  function cmdChat(json = false) {
    if (json) {
      const result = jsonOut({ mode: 'chat' }, 'clawser chat');
      result.__enterAgentMode = true;
      return result;
    }
    return {
      stdout: 'Entering agent chat mode.\n',
      stderr: '',
      exitCode: 0,
      __enterAgentMode: true,
    };
  }

  // ── Subcommand: exit ────────────────────────────────────────

  function cmdExit(json = false) {
    if (json) {
      const result = jsonOut({ mode: 'exit' }, 'clawser exit');
      result.__exitAgentMode = true;
      return result;
    }
    return {
      stdout: 'Exiting agent mode.\n',
      stderr: '',
      exitCode: 0,
      __exitAgentMode: true,
    };
  }

  // ── Subcommand: do ──────────────────────────────────────────

  async function cmdDo(subArgs, json = false) {
    const task = subArgs.join(' ').trim();
    if (!task) {
      if (json) return jsonErr({ code: 'MISSING_TASK', message: 'No task description provided' }, 'clawser do');
      return { stdout: '', stderr: 'Usage: clawser do "task description"', exitCode: 1 };
    }
    const prompt = `Please complete this task using available tools: ${task}`;
    return oneShot(prompt, json);
  }

  // ── Subcommand: config ──────────────────────────────────────

  function cmdConfig(subArgs, json = false) {
    const agent = getAgent();
    if (!agent) {
      if (json) return jsonErr({ code: 'NO_AGENT', message: 'No agent available' }, 'clawser config');
      return { stdout: '', stderr: 'No agent available', exitCode: 1 };
    }

    // clawser config set KEY VALUE
    if (subArgs[0] === 'set' && subArgs.length >= 3) {
      const key = subArgs[1];
      const value = subArgs.slice(2).join(' ');

      switch (key) {
        case 'model':
          agent.setModel(value);
          if (json) return jsonOut({ key: 'model', value }, 'clawser config set');
          return { stdout: `Model set to: ${value}\n`, stderr: '', exitCode: 0 };
        case 'max_tokens':
        case 'max-tokens': {
          const n = parseInt(value, 10);
          if (isNaN(n) || n <= 0) {
            if (json) return jsonErr({ code: 'INVALID_VALUE', message: 'Invalid max_tokens value' }, 'clawser config set');
            return { stdout: '', stderr: 'Invalid max_tokens value', exitCode: 1 };
          }
          if (json) return jsonOut({ key: 'max_tokens', value: n }, 'clawser config set');
          return { stdout: `max_tokens noted: ${n} (applied at request time)\n`, stderr: '', exitCode: 0 };
        }
        case 'system_prompt':
        case 'system':
          agent.setSystemPrompt(value);
          if (json) return jsonOut({ key: 'system_prompt', value, length: value.length }, 'clawser config set');
          return { stdout: `System prompt updated (${value.length} chars)\n`, stderr: '', exitCode: 0 };
        default:
          if (json) return jsonErr({ code: 'UNKNOWN_KEY', message: `Unknown config key: ${key}` }, 'clawser config set');
          return { stdout: '', stderr: `Unknown config key: ${key}\nValid keys: model, max_tokens, system_prompt`, exitCode: 1 };
      }
    }

    // clawser config (show)
    const state = agent.getState();
    const model = agent.getModel() || '(provider default)';
    if (json) {
      return jsonOut({
        model,
        tool_count: state.tool_count ?? null,
        max_iterations: state.maxToolIterations ?? 20,
        history_len: state.history_len ?? 0,
      }, 'clawser config');
    }
    const lines = [
      `Model:          ${model}`,
      `Provider:       (use 'clawser status' for full state)`,
      `Tool count:     ${state.tool_count ?? '(unknown)'}`,
      `Max iterations: ${state.maxToolIterations ?? 20}`,
      `History length: ${state.history_len ?? 0}`,
    ];
    return { stdout: lines.join('\n') + '\n', stderr: '', exitCode: 0 };
  }

  // ── Subcommand: status ──────────────────────────────────────

  function cmdStatus(json = false) {
    const agent = getAgent();
    if (!agent) {
      if (json) return jsonErr({ code: 'NO_AGENT', message: 'No agent available' }, 'clawser status');
      return { stdout: '', stderr: 'No agent available', exitCode: 1 };
    }

    const state = agent.getState();
    const model = agent.getModel() || '(provider default)';
    if (json) {
      return jsonOut({
        model,
        state: state.agent_state || 'Idle',
        history_len: state.history_len ?? 0,
        memory_count: state.memory_count ?? 0,
        goals: state.goals?.length ?? 0,
        scheduler_jobs: state.scheduler_jobs ?? 0,
      }, 'clawser status');
    }
    const lines = [
      'Agent Status',
      '────────────',
      `Model:           ${model}`,
      `State:           ${state.agent_state || 'Idle'}`,
      `History length:  ${state.history_len ?? 0}`,
      `Memory count:    ${state.memory_count ?? 0}`,
      `Goals:           ${state.goals?.length ?? 0}`,
      `Scheduler jobs:  ${state.scheduler_jobs ?? 0}`,
    ];
    return { stdout: lines.join('\n') + '\n', stderr: '', exitCode: 0 };
  }

  // ── Subcommand: history ─────────────────────────────────────

  function cmdHistory(json = false) {
    const agent = getAgent();
    if (!agent) {
      if (json) return jsonErr({ code: 'NO_AGENT', message: 'No agent available' }, 'clawser history');
      return { stdout: '', stderr: 'No agent available', exitCode: 1 };
    }

    const eventLog = agent.getEventLog();
    if (!eventLog || !eventLog.events || eventLog.events.length === 0) {
      if (json) return jsonOut({ events: [] }, 'clawser history');
      return { stdout: 'No history.\n', stderr: '', exitCode: 0 };
    }

    const events = eventLog.events;
    if (json) {
      return jsonOut({ events }, 'clawser history');
    }

    const lines = events.slice(-30).map(evt => {
      const time = new Date(evt.timestamp).toLocaleTimeString();
      const preview = evt.data?.content
        ? evt.data.content.slice(0, 60).replace(/\n/g, ' ')
        : JSON.stringify(evt.data).slice(0, 60);
      return `  [${time}] ${evt.type}: ${preview}`;
    });

    const header = `Showing last ${lines.length} of ${events.length} events:\n`;
    return { stdout: header + lines.join('\n') + '\n', stderr: '', exitCode: 0 };
  }

  // ── Subcommand: clear ───────────────────────────────────────

  async function cmdClear(json = false) {
    const agent = getAgent();
    if (!agent) {
      if (json) return jsonErr({ code: 'NO_AGENT', message: 'No agent available' }, 'clawser clear');
      return { stdout: '', stderr: 'No agent available', exitCode: 1 };
    }

    await agent.reinit({});
    if (json) return jsonOut({ cleared: true }, 'clawser clear');
    return { stdout: 'Conversation cleared.\n', stderr: '', exitCode: 0 };
  }

  // ── Subcommand: tools ───────────────────────────────────────

  function cmdTools(json = false) {
    const agent = getAgent();
    if (!agent) {
      if (json) return jsonErr({ code: 'NO_AGENT', message: 'No agent available' }, 'clawser tools');
      return { stdout: 'No agent available. Cannot list tools.\n', stderr: '', exitCode: 1 };
    }

    const checkpoint = agent.getCheckpointJSON();
    const state = agent.getState();
    const toolCount = state.tool_count ?? 0;

    const shell = getShell();
    const shellCommands = shell ? shell.registry.names().sort() : [];

    if (json) {
      return jsonOut({
        shell_commands: shellCommands,
        agent_tools: toolCount,
      }, 'clawser tools');
    }

    const lines = [];
    if (shell) {
      lines.push(`Shell commands (${shellCommands.length}):`);
      for (const name of shellCommands) {
        lines.push(`  ${name}`);
      }
    }

    lines.push(`\nAgent tools: ${toolCount} registered`);
    lines.push('(Use agent.getToolSpecs() programmatically for full details)');

    return { stdout: lines.join('\n') + '\n', stderr: '', exitCode: 0 };
  }

  // ── Subcommand: model ───────────────────────────────────────

  function cmdModel(subArgs, json = false) {
    const agent = getAgent();
    if (!agent) {
      if (json) return jsonErr({ code: 'NO_AGENT', message: 'No agent available' }, 'clawser model');
      return { stdout: '', stderr: 'No agent available', exitCode: 1 };
    }

    if (subArgs.length === 0) {
      const model = agent.getModel() || '(provider default)';
      if (json) return jsonOut({ model }, 'clawser model');
      return { stdout: `Current model: ${model}\n`, stderr: '', exitCode: 0 };
    }

    const newModel = subArgs.join(' ').trim();
    agent.setModel(newModel);
    if (json) return jsonOut({ model: newModel }, 'clawser model');
    return { stdout: `Model set to: ${newModel}\n`, stderr: '', exitCode: 0 };
  }

  // ── Subcommand: cost ────────────────────────────────────────

  function cmdCost(json = false) {
    const agent = getAgent();
    if (!agent) {
      if (json) return jsonErr({ code: 'NO_AGENT', message: 'No agent available' }, 'clawser cost');
      return { stdout: '', stderr: 'No agent available', exitCode: 1 };
    }

    const autonomy = agent.autonomy;
    if (autonomy) {
      const aState = autonomy.stats;
      const costCents = aState.costTodayCents ?? 0;
      const costDollars = (costCents / 100).toFixed(4);
      if (json) return jsonOut({ cost_cents: costCents, cost_dollars: parseFloat(costDollars) }, 'clawser cost');
      return {
        stdout: `Session cost: $${costDollars} (${costCents} cents today)\n`,
        stderr: '',
        exitCode: 0,
      };
    }

    if (json) return jsonOut({ cost_cents: 0, cost_dollars: 0 }, 'clawser cost');
    return { stdout: 'Cost tracking not available.\n', stderr: '', exitCode: 0 };
  }

  // ── Subcommand: compact ─────────────────────────────────────

  async function cmdCompact(json = false) {
    const agent = getAgent();
    if (!agent) {
      if (json) return jsonErr({ code: 'NO_AGENT', message: 'No agent available' }, 'clawser compact');
      return { stdout: '', stderr: 'No agent available', exitCode: 1 };
    }

    try {
      await agent.compactContext();
      if (json) return jsonOut({ compacted: true }, 'clawser compact');
      return { stdout: 'Context compacted successfully.\n', stderr: '', exitCode: 0 };
    } catch (e) {
      if (json) return jsonErr({ code: 'COMPACT_FAILED', message: e.message }, 'clawser compact');
      return { stdout: '', stderr: `Compaction failed: ${e.message}`, exitCode: 1 };
    }
  }

  // ── Subcommand: memory ──────────────────────────────────────

  function cmdMemory(subArgs, json = false) {
    const agent = getAgent();
    if (!agent) {
      if (json) return jsonErr({ code: 'NO_AGENT', message: 'No agent available' }, 'clawser memory');
      return { stdout: '', stderr: 'No agent available', exitCode: 1 };
    }

    const sub = subArgs[0];

    // clawser memory (no args) or clawser memory list
    if (!sub || sub === 'list') {
      const entries = agent.memoryRecall('');
      if (!entries || entries.length === 0) {
        if (json) return jsonOut({ memories: [] }, 'clawser memory list');
        return { stdout: 'No memories stored.\n', stderr: '', exitCode: 0 };
      }

      if (json) return jsonOut({ memories: entries }, 'clawser memory list');

      const lines = entries.map(e =>
        `  [${e.category || 'core'}] ${e.key}: ${(e.content || '').slice(0, 80)}`
      );
      return {
        stdout: `Memories (${entries.length}):\n${lines.join('\n')}\n`,
        stderr: '',
        exitCode: 0,
      };
    }

    // clawser memory add KEY VALUE
    if (sub === 'add') {
      if (subArgs.length < 3) {
        if (json) return jsonErr({ code: 'MISSING_ARGS', message: 'Usage: clawser memory add KEY VALUE' }, 'clawser memory add');
        return { stdout: '', stderr: 'Usage: clawser memory add KEY VALUE', exitCode: 1 };
      }
      const key = subArgs[1];
      const content = subArgs.slice(2).join(' ');
      try {
        const id = agent.memoryStore({ key, content, category: 'user' });
        if (json) return jsonOut({ key, id }, 'clawser memory add');
        return { stdout: `Memory added: ${key} (id: ${id})\n`, stderr: '', exitCode: 0 };
      } catch (e) {
        if (json) return jsonErr({ code: 'STORE_FAILED', message: e.message }, 'clawser memory add');
        return { stdout: '', stderr: `Failed to add memory: ${e.message}`, exitCode: 1 };
      }
    }

    // clawser memory remove KEY
    if (sub === 'remove' || sub === 'rm' || sub === 'delete') {
      if (subArgs.length < 2) {
        if (json) return jsonErr({ code: 'MISSING_ARGS', message: 'Usage: clawser memory remove KEY' }, 'clawser memory remove');
        return { stdout: '', stderr: 'Usage: clawser memory remove KEY', exitCode: 1 };
      }
      const key = subArgs[1];
      const entries = agent.memoryRecall('');
      const match = entries.find(e => e.key === key || e.id === key);
      if (!match) {
        if (json) return jsonErr({ code: 'NOT_FOUND', message: `Memory not found: ${key}` }, 'clawser memory remove');
        return { stdout: '', stderr: `Memory not found: ${key}`, exitCode: 1 };
      }
      const removed = agent.memoryForget(match.id);
      if (removed) {
        if (json) return jsonOut({ key, removed: true }, 'clawser memory remove');
        return { stdout: `Memory removed: ${key}\n`, stderr: '', exitCode: 0 };
      }
      if (json) return jsonErr({ code: 'REMOVE_FAILED', message: `Failed to remove memory: ${key}` }, 'clawser memory remove');
      return { stdout: '', stderr: `Failed to remove memory: ${key}`, exitCode: 1 };
    }

    if (json) return jsonErr({ code: 'UNKNOWN_SUBCOMMAND', message: `Unknown memory subcommand: ${sub}` }, 'clawser memory');
    return { stdout: '', stderr: `Unknown memory subcommand: ${sub}\nUsage: clawser memory [list|add|remove]`, exitCode: 1 };
  }

  // ── Subcommand: mcp ─────────────────────────────────────────

  function cmdMcp(json = false) {
    const agent = getAgent();
    if (!agent) {
      if (json) return jsonErr({ code: 'NO_AGENT', message: 'No agent available' }, 'clawser mcp');
      return { stdout: '', stderr: 'No agent available', exitCode: 1 };
    }

    const state = agent.getState();
    if (json) {
      return jsonOut({
        agent_state: state.agent_state || 'Idle',
        total_tools: state.tool_count ?? null,
      }, 'clawser mcp');
    }
    const lines = [
      'MCP Status',
      '──────────',
      `Agent state: ${state.agent_state || 'Idle'}`,
      `Total tools: ${state.tool_count ?? '(unknown)'}`,
      '',
      'Use agent.addMcpServer(name, endpoint) to connect MCP servers.',
    ];
    return { stdout: lines.join('\n') + '\n', stderr: '', exitCode: 0 };
  }

  // ── Subcommand: session ────────────────────────────────────

  async function cmdSession(subArgs, json = false) {
    const { state: appState } = await import('./clawser-state.js');
    const ts = appState.terminalSessions;
    if (!ts) {
      if (json) return jsonErr({ code: 'NO_SESSIONS', message: 'Terminal sessions not available' }, 'clawser session');
      return { stdout: '', stderr: 'Terminal sessions not available', exitCode: 1 };
    }

    const sub = subArgs[0];

    // clawser session (no args) or clawser session list
    if (!sub || sub === 'list') {
      const sessions = ts.list();
      if (json) return jsonOut({ sessions, active: ts.activeId }, 'clawser session');
      if (sessions.length === 0) {
        return { stdout: 'No terminal sessions.\n', stderr: '', exitCode: 0 };
      }
      const lines = sessions.map(s => {
        const active = s.id === ts.activeId ? ' *' : '';
        const age = new Date(s.lastUsed).toLocaleTimeString();
        return `  ${s.name}${active}  (${s.commandCount || 0} cmds, ${age})`;
      });
      return { stdout: `Sessions (${sessions.length}):\n${lines.join('\n')}\n`, stderr: '', exitCode: 0 };
    }

    // clawser session new [name]
    if (sub === 'new' || sub === 'create') {
      const name = subArgs.slice(1).join(' ').trim() || undefined;
      const meta = await ts.create(name);
      if (json) return jsonOut({ name: meta.name, id: meta.id }, 'clawser session new');
      return { stdout: `Created session: ${meta.name} (${meta.id})\n`, stderr: '', exitCode: 0, __clearTerminal: true };
    }

    // clawser session switch <name-or-id>
    if (sub === 'switch') {
      const target = subArgs.slice(1).join(' ').trim();
      if (!target) {
        if (json) return jsonErr({ code: 'MISSING_TARGET', message: 'No session target provided' }, 'clawser session switch');
        return { stdout: '', stderr: 'Usage: clawser session switch <name-or-id>', exitCode: 1 };
      }
      const sessions = ts.list();
      const match = sessions.find(s => s.id === target || s.name.toLowerCase() === target.toLowerCase());
      if (!match) {
        if (json) return jsonErr({ code: 'NOT_FOUND', message: `Session not found: ${target}` }, 'clawser session switch');
        return { stdout: '', stderr: `Session not found: ${target}`, exitCode: 1 };
      }
      await ts.switchTo(match.id);
      if (json) return jsonOut({ name: match.name, id: match.id }, 'clawser session switch');
      return { stdout: `Switched to session: ${match.name}\n`, stderr: '', exitCode: 0 };
    }

    // clawser session rename <new-name>
    if (sub === 'rename') {
      const newName = subArgs.slice(1).join(' ').trim();
      if (!newName) {
        if (json) return jsonErr({ code: 'MISSING_NAME', message: 'No name provided' }, 'clawser session rename');
        return { stdout: '', stderr: 'Usage: clawser session rename <new-name>', exitCode: 1 };
      }
      if (!ts.activeId) {
        if (json) return jsonErr({ code: 'NO_ACTIVE', message: 'No active session' }, 'clawser session rename');
        return { stdout: '', stderr: 'No active session', exitCode: 1 };
      }
      ts.rename(ts.activeId, newName);
      if (json) return jsonOut({ name: newName, id: ts.activeId }, 'clawser session rename');
      return { stdout: `Session renamed to: ${newName}\n`, stderr: '', exitCode: 0 };
    }

    // clawser session delete [name-or-id]
    if (sub === 'delete' || sub === 'rm') {
      const target = subArgs.slice(1).join(' ').trim();
      if (!target) {
        if (json) return jsonErr({ code: 'MISSING_TARGET', message: 'No session target provided' }, 'clawser session delete');
        return { stdout: '', stderr: 'Usage: clawser session delete <name-or-id>', exitCode: 1 };
      }
      const sessions = ts.list();
      const match = sessions.find(s => s.id === target || s.name.toLowerCase() === target.toLowerCase());
      if (!match) {
        if (json) return jsonErr({ code: 'NOT_FOUND', message: `Session not found: ${target}` }, 'clawser session delete');
        return { stdout: '', stderr: `Session not found: ${target}`, exitCode: 1 };
      }
      await ts.delete(match.id);
      if (json) return jsonOut({ name: match.name, id: match.id, deleted: true }, 'clawser session delete');
      return { stdout: `Deleted session: ${match.name}\n`, stderr: '', exitCode: 0 };
    }

    // clawser session fork [name]
    if (sub === 'fork') {
      const name = subArgs.slice(1).join(' ').trim() || undefined;
      const meta = await ts.fork(name);
      if (json) return jsonOut({ name: meta.name, id: meta.id }, 'clawser session fork');
      return { stdout: `Forked session: ${meta.name} (${meta.id})\n`, stderr: '', exitCode: 0 };
    }

    // clawser session export [--script|--markdown|--json|--jsonl|--html]
    if (sub === 'export') {
      const format = subArgs[1] || '--script';
      let content, ext;

      // Rich export formats (markdown conversation, HTML standalone, JSON envelope)
      // use the new clawser-session-export module for sanitization + formatting.
      if (format === '--html' || format === '-h'
        || format === '--rich-markdown' || format === '--rich-md'
        || format === '--rich-json') {
        const { exportSessionAsHTML, exportSessionAsMarkdown, exportSessionAsJSON } =
          await import('./clawser-session-export.js');
        const events = ts.cloneEvents();
        const agent = getAgent();
        const model = agent?.getState()?.model || 'unknown';
        const title = ts.activeName || 'Clawser Session';
        const exportOpts = { title, model };

        switch (format) {
          case '--html':
          case '-h':
            content = exportSessionAsHTML(events, exportOpts);
            ext = 'html';
            break;
          case '--rich-markdown':
          case '--rich-md':
            content = exportSessionAsMarkdown(events, exportOpts);
            ext = 'md';
            break;
          case '--rich-json':
            content = exportSessionAsJSON(events, exportOpts);
            ext = 'json';
            break;
        }
      } else {
        // Legacy export formats (simple script, text log, basic markdown)
        switch (format) {
          case '--script':
          case '-s':
            content = ts.exportAsScript();
            ext = 'sh';
            break;
          case '--markdown':
          case '--md':
          case '-m':
            content = ts.exportAsMarkdown();
            ext = 'md';
            break;
          case '--json':
            content = ts.exportAsLog('json');
            ext = 'json';
            break;
          case '--jsonl':
            content = ts.exportAsLog('jsonl');
            ext = 'jsonl';
            break;
          default:
            content = ts.exportAsLog('text');
            ext = 'log';
            break;
        }
      }
      if (json) return jsonOut({ format: ext, content }, 'clawser session export');
      return { stdout: content + '\n', stderr: '', exitCode: 0 };
    }

    // clawser session save
    if (sub === 'save') {
      await ts.persist();
      if (json) return jsonOut({ saved: true }, 'clawser session save');
      return { stdout: 'Session saved.\n', stderr: '', exitCode: 0 };
    }

    if (json) return jsonErr({ code: 'UNKNOWN_SUBCOMMAND', message: `Unknown session subcommand: ${sub}` }, 'clawser session');
    return { stdout: '', stderr: `Unknown session subcommand: ${sub}\nUsage: clawser session [list|new|switch|rename|delete|fork|export|save]`, exitCode: 1 };
  }

  // ── Main `clawser` command ──────────────────────────────────

  registry.register('clawser', async ({ args }) => {
    // No args: show help
    if (args.length === 0) {
      return { stdout: HELP_TEXT, stderr: '', exitCode: 0 };
    }

    // Pre-parse flags to detect --json / -j / --output json across all invocations.
    const { flags: preFlags } = parseFlags(args, FLAG_SPEC);
    const json = isJsonMode(preFlags);

    const subcmd = args[0];

    // Build clean subArgs with json-related flags stripped
    const cleanSubArgs = [];
    for (let i = 1; i < args.length; i++) {
      if (args[i] === '--json' || args[i] === '-j') continue;
      if (args[i] === '--output' && (args[i + 1] === 'json' || args[i + 1] === 'text')) { i++; continue; }
      cleanSubArgs.push(args[i]);
    }

    // Dispatch known subcommands
    switch (subcmd) {
      case 'chat':
        return cmdChat(json);
      case 'exit':
        return cmdExit(json);
      case 'do':
        return cmdDo(cleanSubArgs, json);
      case 'config':
        return cmdConfig(cleanSubArgs, json);
      case 'status':
        return cmdStatus(json);
      case 'history':
        return cmdHistory(json);
      case 'clear':
        return cmdClear(json);
      case 'tools':
        return cmdTools(json);
      case 'model':
        return cmdModel(cleanSubArgs, json);
      case 'cost':
        return cmdCost(json);
      case 'compact':
        return cmdCompact(json);
      case 'memory':
        return cmdMemory(cleanSubArgs, json);
      case 'mcp':
        return cmdMcp(json);
      case 'session':
        return cmdSession(cleanSubArgs, json);
      case 'help':
      case '--help':
      case '-h':
        return { stdout: HELP_TEXT, stderr: '', exitCode: 0 };
      default:
        break;
    }

    // Not a known subcommand — check for flags
    if (subcmd.startsWith('-')) {
      const { flags, positional } = parseFlags(args, FLAG_SPEC);
      const flagJson = isJsonMode(flags);

      // -p "prompt" or --print "prompt"
      if (flags.print) {
        const prompt = typeof flags.print === 'string'
          ? flags.print
          : positional.join(' ');
        if (!prompt) {
          if (flagJson) return jsonErr({ code: 'MISSING_PROMPT', message: 'No prompt provided for -p flag' }, 'clawser');
          return { stdout: '', stderr: 'No prompt provided for -p flag', exitCode: 1 };
        }

        // Apply optional flags before sending
        const agent = getAgent();
        if (agent) {
          if (flags.model) agent.setModel(flags.model);
          if (flags.system) agent.setSystemPrompt(flags.system);
        }

        return oneShot(prompt, flagJson);
      }

      // -m "model" by itself — set model
      if (flags.model && !flags.print) {
        return cmdModel([flags.model], flagJson);
      }

      // If the only flag is --json with no subcommand, show help
      if (flagJson && !flags.print && !flags.model) {
        return { stdout: HELP_TEXT, stderr: '', exitCode: 0 };
      }

      return { stdout: '', stderr: `Unknown flag: ${subcmd}\nRun 'clawser help' for usage.`, exitCode: 1 };
    }

    // Not a subcommand and not a flag — treat entire args as a prompt
    // Filter out --json/-j/--output from the prompt text
    const promptArgs = args.filter((a, i) => {
      if (a === '--json' || a === '-j') return false;
      if (a === '--output' && (args[i + 1] === 'json' || args[i + 1] === 'text')) return false;
      if ((args[i - 1] === '--output') && (a === 'json' || a === 'text')) return false;
      return true;
    });
    const prompt = promptArgs.join(' ').trim();
    if (prompt) {
      return oneShot(prompt, json);
    }

    return { stdout: HELP_TEXT, stderr: '', exitCode: 0 };
  }, { description: 'AI agent CLI with subcommands', category: 'Agent CLI', usage: 'clawser [SUBCOMMAND|PROMPT] [FLAGS]' });
}
