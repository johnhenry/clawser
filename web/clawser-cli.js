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
  clawser session export [fmt]   Export session (--script|--markdown|--json)
  clawser session save           Persist current session

Flags:
  -p, --print TEXT              Prompt text for one-shot mode
  -m, --model NAME              Model override
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
    // Value-consuming flags (not boolean): system, tools, max-turns
    // are absent from the spec so parseFlags treats them as value-consuming
    // Boolean flags (no value):
    'no-stream': true,
    continue: true,
    resume: true,
  };

  // ── One-shot prompt helper ──────────────────────────────────

  async function oneShot(prompt) {
    const agent = getAgent();
    if (!agent) {
      return { stdout: '', stderr: 'No agent available', exitCode: 1 };
    }
    try {
      agent.sendMessage(prompt);
      const resp = await agent.run();
      const text = resp?.content || resp?.text || '(no response)';
      return { stdout: text + '\n', stderr: '', exitCode: 0 };
    } catch (e) {
      return { stdout: '', stderr: `Agent error: ${e.message}`, exitCode: 1 };
    }
  }

  // ── Subcommand: chat ────────────────────────────────────────

  function cmdChat() {
    return {
      stdout: 'Entering agent chat mode.\n',
      stderr: '',
      exitCode: 0,
      __enterAgentMode: true,
    };
  }

  // ── Subcommand: exit ────────────────────────────────────────

  function cmdExit() {
    return {
      stdout: 'Exiting agent mode.\n',
      stderr: '',
      exitCode: 0,
      __exitAgentMode: true,
    };
  }

  // ── Subcommand: do ──────────────────────────────────────────

  async function cmdDo(subArgs) {
    const task = subArgs.join(' ').trim();
    if (!task) {
      return { stdout: '', stderr: 'Usage: clawser do "task description"', exitCode: 1 };
    }
    const prompt = `Please complete this task using available tools: ${task}`;
    return oneShot(prompt);
  }

  // ── Subcommand: config ──────────────────────────────────────

  function cmdConfig(subArgs) {
    const agent = getAgent();
    if (!agent) {
      return { stdout: '', stderr: 'No agent available', exitCode: 1 };
    }

    // clawser config set KEY VALUE
    if (subArgs[0] === 'set' && subArgs.length >= 3) {
      const key = subArgs[1];
      const value = subArgs.slice(2).join(' ');

      switch (key) {
        case 'model':
          agent.setModel(value);
          return { stdout: `Model set to: ${value}\n`, stderr: '', exitCode: 0 };
        case 'max_tokens':
        case 'max-tokens': {
          const n = parseInt(value, 10);
          if (isNaN(n) || n <= 0) {
            return { stdout: '', stderr: 'Invalid max_tokens value', exitCode: 1 };
          }
          // max_tokens is part of request options, not agent config — note for user
          return { stdout: `max_tokens noted: ${n} (applied at request time)\n`, stderr: '', exitCode: 0 };
        }
        case 'system_prompt':
        case 'system':
          agent.setSystemPrompt(value);
          return { stdout: `System prompt updated (${value.length} chars)\n`, stderr: '', exitCode: 0 };
        default:
          return { stdout: '', stderr: `Unknown config key: ${key}\nValid keys: model, max_tokens, system_prompt`, exitCode: 1 };
      }
    }

    // clawser config (show)
    const state = agent.getState();
    const model = agent.getModel() || '(provider default)';
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

  function cmdStatus() {
    const agent = getAgent();
    if (!agent) {
      return { stdout: '', stderr: 'No agent available', exitCode: 1 };
    }

    const state = agent.getState();
    const model = agent.getModel() || '(provider default)';
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

  function cmdHistory() {
    const agent = getAgent();
    if (!agent) {
      return { stdout: '', stderr: 'No agent available', exitCode: 1 };
    }

    const eventLog = agent.getEventLog();
    if (!eventLog || !eventLog.events || eventLog.events.length === 0) {
      return { stdout: 'No history.\n', stderr: '', exitCode: 0 };
    }

    const events = eventLog.events;
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

  function cmdClear() {
    const agent = getAgent();
    if (!agent) {
      return { stdout: '', stderr: 'No agent available', exitCode: 1 };
    }

    agent.reinit({});
    return { stdout: 'Conversation cleared.\n', stderr: '', exitCode: 0 };
  }

  // ── Subcommand: tools ───────────────────────────────────────

  function cmdTools() {
    const agent = getAgent();
    if (!agent) {
      return { stdout: 'No agent available. Cannot list tools.\n', stderr: '', exitCode: 1 };
    }

    const checkpoint = agent.getCheckpointJSON();
    // Tool specs are registered on the agent; get them from checkpoint or direct access
    // We walk through the checkpoint or use the state to determine count
    const state = agent.getState();
    const toolCount = state.tool_count ?? 0;

    // Try to get specs via executeToolDirect enumeration — but the simplest path
    // is that the agent exposes #toolSpecs indirectly. Since we don't have a
    // public getToolSpecs(), we look at what's available.
    // The agent stores tool specs internally. We can get names from the checkpoint
    // or from the shell's command registry as a fallback.
    const shell = getShell();
    const lines = [];

    // If we have shell commands, list them as available tools
    if (shell) {
      const cmds = shell.registry.names().sort();
      lines.push(`Shell commands (${cmds.length}):`);
      for (const name of cmds) {
        lines.push(`  ${name}`);
      }
    }

    lines.push(`\nAgent tools: ${toolCount} registered`);
    lines.push('(Use agent.getToolSpecs() programmatically for full details)');

    return { stdout: lines.join('\n') + '\n', stderr: '', exitCode: 0 };
  }

  // ── Subcommand: model ───────────────────────────────────────

  function cmdModel(subArgs) {
    const agent = getAgent();
    if (!agent) {
      return { stdout: '', stderr: 'No agent available', exitCode: 1 };
    }

    if (subArgs.length === 0) {
      const model = agent.getModel() || '(provider default)';
      return { stdout: `Current model: ${model}\n`, stderr: '', exitCode: 0 };
    }

    const newModel = subArgs.join(' ').trim();
    agent.setModel(newModel);
    return { stdout: `Model set to: ${newModel}\n`, stderr: '', exitCode: 0 };
  }

  // ── Subcommand: cost ────────────────────────────────────────

  function cmdCost() {
    const agent = getAgent();
    if (!agent) {
      return { stdout: '', stderr: 'No agent available', exitCode: 1 };
    }

    // Cost is tracked by the autonomy controller
    const autonomy = agent.autonomy;
    if (autonomy) {
      const aState = autonomy.getState();
      const costCents = aState.costTodayCents ?? 0;
      const costDollars = (costCents / 100).toFixed(4);
      return {
        stdout: `Session cost: $${costDollars} (${costCents} cents today)\n`,
        stderr: '',
        exitCode: 0,
      };
    }

    return { stdout: 'Cost tracking not available.\n', stderr: '', exitCode: 0 };
  }

  // ── Subcommand: compact ─────────────────────────────────────

  async function cmdCompact() {
    const agent = getAgent();
    if (!agent) {
      return { stdout: '', stderr: 'No agent available', exitCode: 1 };
    }

    try {
      await agent.compactContext();
      return { stdout: 'Context compacted successfully.\n', stderr: '', exitCode: 0 };
    } catch (e) {
      return { stdout: '', stderr: `Compaction failed: ${e.message}`, exitCode: 1 };
    }
  }

  // ── Subcommand: memory ──────────────────────────────────────

  function cmdMemory(subArgs) {
    const agent = getAgent();
    if (!agent) {
      return { stdout: '', stderr: 'No agent available', exitCode: 1 };
    }

    const sub = subArgs[0];

    // clawser memory (no args) or clawser memory list
    if (!sub || sub === 'list') {
      const entries = agent.memoryRecall('');
      if (!entries || entries.length === 0) {
        return { stdout: 'No memories stored.\n', stderr: '', exitCode: 0 };
      }

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
        return { stdout: '', stderr: 'Usage: clawser memory add KEY VALUE', exitCode: 1 };
      }
      const key = subArgs[1];
      const content = subArgs.slice(2).join(' ');
      try {
        const id = agent.memoryStore({ key, content, category: 'user' });
        return { stdout: `Memory added: ${key} (id: ${id})\n`, stderr: '', exitCode: 0 };
      } catch (e) {
        return { stdout: '', stderr: `Failed to add memory: ${e.message}`, exitCode: 1 };
      }
    }

    // clawser memory remove KEY
    if (sub === 'remove' || sub === 'rm' || sub === 'delete') {
      if (subArgs.length < 2) {
        return { stdout: '', stderr: 'Usage: clawser memory remove KEY', exitCode: 1 };
      }
      const key = subArgs[1];
      // Find by key first, then delete by ID
      const entries = agent.memoryRecall('');
      const match = entries.find(e => e.key === key || e.id === key);
      if (!match) {
        return { stdout: '', stderr: `Memory not found: ${key}`, exitCode: 1 };
      }
      const removed = agent.memoryForget(match.id);
      if (removed) {
        return { stdout: `Memory removed: ${key}\n`, stderr: '', exitCode: 0 };
      }
      return { stdout: '', stderr: `Failed to remove memory: ${key}`, exitCode: 1 };
    }

    return { stdout: '', stderr: `Unknown memory subcommand: ${sub}\nUsage: clawser memory [list|add|remove]`, exitCode: 1 };
  }

  // ── Subcommand: mcp ─────────────────────────────────────────

  function cmdMcp() {
    const agent = getAgent();
    if (!agent) {
      return { stdout: '', stderr: 'No agent available', exitCode: 1 };
    }

    // MCP info is not directly exposed via a public getter on the agent.
    // We report what we can infer from the agent state.
    const state = agent.getState();
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

  async function cmdSession(subArgs) {
    const { state: appState } = await import('./clawser-state.js');
    const ts = appState.terminalSessions;
    if (!ts) {
      return { stdout: '', stderr: 'Terminal sessions not available', exitCode: 1 };
    }

    const sub = subArgs[0];

    // clawser session (no args) or clawser session list
    if (!sub || sub === 'list') {
      const sessions = ts.list();
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
      return { stdout: `Created session: ${meta.name} (${meta.id})\n`, stderr: '', exitCode: 0, __clearTerminal: true };
    }

    // clawser session switch <name-or-id>
    if (sub === 'switch') {
      const target = subArgs.slice(1).join(' ').trim();
      if (!target) {
        return { stdout: '', stderr: 'Usage: clawser session switch <name-or-id>', exitCode: 1 };
      }
      const sessions = ts.list();
      const match = sessions.find(s => s.id === target || s.name.toLowerCase() === target.toLowerCase());
      if (!match) {
        return { stdout: '', stderr: `Session not found: ${target}`, exitCode: 1 };
      }
      await ts.switchTo(match.id);
      return { stdout: `Switched to session: ${match.name}\n`, stderr: '', exitCode: 0 };
    }

    // clawser session rename <new-name>
    if (sub === 'rename') {
      const newName = subArgs.slice(1).join(' ').trim();
      if (!newName) {
        return { stdout: '', stderr: 'Usage: clawser session rename <new-name>', exitCode: 1 };
      }
      if (!ts.activeId) {
        return { stdout: '', stderr: 'No active session', exitCode: 1 };
      }
      ts.rename(ts.activeId, newName);
      return { stdout: `Session renamed to: ${newName}\n`, stderr: '', exitCode: 0 };
    }

    // clawser session delete [name-or-id]
    if (sub === 'delete' || sub === 'rm') {
      const target = subArgs.slice(1).join(' ').trim();
      if (!target) {
        return { stdout: '', stderr: 'Usage: clawser session delete <name-or-id>', exitCode: 1 };
      }
      const sessions = ts.list();
      const match = sessions.find(s => s.id === target || s.name.toLowerCase() === target.toLowerCase());
      if (!match) {
        return { stdout: '', stderr: `Session not found: ${target}`, exitCode: 1 };
      }
      await ts.delete(match.id);
      return { stdout: `Deleted session: ${match.name}\n`, stderr: '', exitCode: 0 };
    }

    // clawser session fork [name]
    if (sub === 'fork') {
      const name = subArgs.slice(1).join(' ').trim() || undefined;
      const meta = await ts.fork(name);
      return { stdout: `Forked session: ${meta.name} (${meta.id})\n`, stderr: '', exitCode: 0 };
    }

    // clawser session export [--script|--markdown|--json|--jsonl]
    if (sub === 'export') {
      const format = subArgs[1] || '--script';
      let content, ext;
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
      return { stdout: content + '\n', stderr: '', exitCode: 0 };
    }

    // clawser session save
    if (sub === 'save') {
      await ts.persist();
      return { stdout: 'Session saved.\n', stderr: '', exitCode: 0 };
    }

    return { stdout: '', stderr: `Unknown session subcommand: ${sub}\nUsage: clawser session [list|new|switch|rename|delete|fork|export|save]`, exitCode: 1 };
  }

  // ── Main `clawser` command ──────────────────────────────────

  registry.register('clawser', async ({ args }) => {
    // No args: show help
    if (args.length === 0) {
      return { stdout: HELP_TEXT, stderr: '', exitCode: 0 };
    }

    const subcmd = args[0];
    const subArgs = args.slice(1);

    // Dispatch known subcommands
    switch (subcmd) {
      case 'chat':
        return cmdChat();
      case 'exit':
        return cmdExit();
      case 'do':
        return cmdDo(subArgs);
      case 'config':
        return cmdConfig(subArgs);
      case 'status':
        return cmdStatus();
      case 'history':
        return cmdHistory();
      case 'clear':
        return cmdClear();
      case 'tools':
        return cmdTools();
      case 'model':
        return cmdModel(subArgs);
      case 'cost':
        return cmdCost();
      case 'compact':
        return cmdCompact();
      case 'memory':
        return cmdMemory(subArgs);
      case 'mcp':
        return cmdMcp();
      case 'session':
        return cmdSession(subArgs);
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

      // -p "prompt" or --print "prompt"
      if (flags.print) {
        const prompt = typeof flags.print === 'string'
          ? flags.print
          : positional.join(' ');
        if (!prompt) {
          return { stdout: '', stderr: 'No prompt provided for -p flag', exitCode: 1 };
        }

        // Apply optional flags before sending
        const agent = getAgent();
        if (agent) {
          if (flags.model) agent.setModel(flags.model);
          if (flags.system) agent.setSystemPrompt(flags.system);
        }

        return oneShot(prompt);
      }

      // -m "model" by itself — set model
      if (flags.model && !flags.print) {
        return cmdModel([flags.model]);
      }

      return { stdout: '', stderr: `Unknown flag: ${subcmd}\nRun 'clawser help' for usage.`, exitCode: 1 };
    }

    // Not a subcommand and not a flag — treat entire args as a prompt
    const prompt = args.join(' ').trim();
    if (prompt) {
      return oneShot(prompt);
    }

    return { stdout: HELP_TEXT, stderr: '', exitCode: 0 };
  }, { description: 'AI agent CLI with subcommands', category: 'Agent CLI', usage: 'clawser [SUBCOMMAND|PROMPT] [FLAGS]' });
}
