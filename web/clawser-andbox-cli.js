/**
 * Clawser Andbox CLI — Browser sandbox shell command.
 *
 * Registers the `andbox` command with clawser's shell CommandRegistry,
 * providing a node/deno-like interactive JS runtime inside the terminal.
 *
 * Usage:
 *   import { registerAndboxCli } from './clawser-andbox-cli.js';
 *   registerAndboxCli(registry, getAgent, getShell);
 */

import { createSandbox } from './packages-andbox.js';
import { parseFlags } from './clawser-cli.js';

// ── Profiles ──────────────────────────────────────────────────────

const PROFILES = {
  minimal: {},
  web: { 'allow-net': true, 'allow-import': true },
  fs: { 'allow-read': true, 'allow-write': true },
  full: { 'allow-all': true },
  agent: { 'allow-net': true, 'allow-read': true, 'allow-write': true, 'allow-import': true },
};

// ── Flag Spec ─────────────────────────────────────────────────────

const FLAG_SPEC = {
  N: 'allow-net',
  R: 'allow-read',
  W: 'allow-write',
  I: 'allow-import',
  A: 'allow-all',
  'allow-net': true,
  'allow-read': true,
  'allow-write': true,
  'allow-import': true,
  'allow-all': true,
  'inspect': true,
};

// ── Help Text ─────────────────────────────────────────────────────

const HELP_TEXT = `andbox — Sandboxed JavaScript Runtime

Usage:
  andbox                           Start interactive REPL (minimal profile)
  andbox "code"                    One-shot eval
  andbox --eval "code"             One-shot eval (explicit)
  andbox run <file>                Execute a script file from OPFS
  andbox repl                      Start interactive REPL explicitly
  andbox define <name> <file>      Define a virtual module from OPFS file
  andbox import-map <file>         Load import map from OPFS file
  andbox status                    Show sandbox status
  andbox dispose                   Terminate sandbox

Flags:
  --allow-net[=hosts]   -N   Enable fetchText, fetchJson capabilities
  --allow-read[=paths]  -R   Enable readFile, readDir, stat (via OPFS)
  --allow-write[=paths] -W   Enable writeFile, mkdir, rm (via OPFS)
  --allow-import[=hosts]-I   Enable CDN dynamic imports
  --allow-all           -A   Enable everything

Profiles:
  --profile=minimal     No permissions (pure compute only)
  --profile=web         --allow-net --allow-import
  --profile=fs          --allow-read --allow-write
  --profile=full        --allow-all
  --profile=agent       --allow-net --allow-read --allow-write --allow-import

Config:
  --import-map=path     Load import map from OPFS path
  --timeout=ms          Evaluation timeout (default: 30000)
  --inspect             Log import graph + console output

REPL Dot Commands:
  .exit                 Exit REPL mode
  .help                 Show this help
  .define <name> <code> Define a virtual module inline
  .import <specifier>   Import and inspect a module
  .graph                Show virtual module graph
  .stats                Show sandbox stats
`;

// ── Subcommand Metadata (for Shell Commands UI) ──

export const ANDBOX_SUBCOMMAND_META = [
  { name: 'andbox', description: 'Start andbox REPL or one-shot eval', usage: 'andbox ["code"]' },
  { name: 'andbox run', description: 'Execute a script file from OPFS', usage: 'andbox run <file>' },
  { name: 'andbox repl', description: 'Start interactive REPL', usage: 'andbox repl [--profile=NAME]' },
  { name: 'andbox define', description: 'Define a virtual module', usage: 'andbox define <name> <file>' },
  { name: 'andbox import-map', description: 'Load import map from OPFS', usage: 'andbox import-map <file>' },
  { name: 'andbox status', description: 'Show sandbox status', usage: 'andbox status' },
  { name: 'andbox dispose', description: 'Terminate sandbox', usage: 'andbox dispose' },
];

// ── Auto-return for REPL ─────────────────────────────────────────

/**
 * Auto-prepend `return` to the last expression so REPL prints its value.
 * Skips lines starting with control-flow keywords or declarations.
 */
function autoReturn(code) {
  const lines = code.split('\n');
  // Find last non-empty line
  let lastIdx = lines.length - 1;
  while (lastIdx >= 0 && !lines[lastIdx].trim()) lastIdx--;
  if (lastIdx < 0) return code;

  const last = lines[lastIdx].trim();

  // Already has return
  if (/^\s*return\b/.test(last)) return code;

  // Don't return declarations, control flow, or block-ending braces
  if (/^(if|else|for|while|do|switch|try|catch|finally|class|function|const|let|var|import|export|throw)\b/.test(last)) {
    return code;
  }
  if (/^[{}]/.test(last)) return code;

  // Strip trailing semicolon for the return expression
  const expr = last.replace(/;$/, '');
  lines[lastIdx] = 'return ' + expr;
  return lines.join('\n');
}

// ── Registration ──────────────────────────────────────────────────

/**
 * Register the `andbox` shell command.
 *
 * @param {import('./clawser-shell.js').CommandRegistry} registry
 * @param {() => import('./clawser-agent.js').ClawserAgent} getAgent
 * @param {() => import('./clawser-shell.js').ClawserShell} getShell
 */
export function registerAndboxCli(registry, getAgent, getShell) {
  // Persistent sandbox instance — survives across command invocations
  let sandbox = null;
  let sandboxFlags = {};

  /**
   * Build capabilities from enabled flags and shell fs.
   */
  function buildCapabilities(flags) {
    const caps = {};
    const shell = getShell();
    const fs = shell?.fs;

    // Time capability (always available)
    caps.now = () => Date.now();

    // Network capabilities
    if (flags['allow-net'] || flags['allow-all']) {
      caps.fetchText = async (url) => {
        const resp = await fetch(url);
        if (!resp.ok) throw new Error(`Fetch failed: ${resp.status} ${resp.statusText}`);
        return resp.text();
      };
      caps.fetchJson = async (url) => {
        const resp = await fetch(url);
        if (!resp.ok) throw new Error(`Fetch failed: ${resp.status} ${resp.statusText}`);
        return resp.json();
      };
    }

    // Read capabilities (via OPFS)
    if ((flags['allow-read'] || flags['allow-all']) && fs) {
      caps.readFile = async (path) => fs.readFile(path);
      caps.readDir = async (path) => fs.readDir(path || '/');
      caps.stat = async (path) => fs.stat(path);
    }

    // Write capabilities (via OPFS)
    if ((flags['allow-write'] || flags['allow-all']) && fs) {
      caps.writeFile = async (path, content) => fs.writeFile(path, content);
      caps.mkdir = async (path) => fs.mkdir(path);
      caps.rm = async (path) => fs.rm(path);
    }

    return caps;
  }

  /**
   * Ensure sandbox is created with given flags.
   */
  async function ensureSandbox(flags) {
    if (sandbox && !sandbox.isDisposed()) return sandbox;

    const caps = buildCapabilities(flags);
    const importMap = flags.importMap || { imports: {}, scopes: {} };
    const timeoutMs = flags.timeout ? parseInt(flags.timeout, 10) : 30_000;

    const consoleLines = [];
    sandbox = await createSandbox({
      capabilities: caps,
      importMap,
      defaultTimeoutMs: timeoutMs,
      onConsole: (level, ...args) => {
        consoleLines.push(`[${level}] ${args.join(' ')}`);
      },
    });
    sandbox._consoleLines = consoleLines;
    sandboxFlags = { ...flags };
    return sandbox;
  }

  /**
   * Format a result value for terminal output.
   */
  function formatResult(value) {
    if (value === undefined) return 'undefined';
    if (value === null) return 'null';
    if (typeof value === 'string') return value;
    try { return JSON.stringify(value, null, 2); }
    catch { return String(value); }
  }

  // ── Subcommands ──

  async function cmdEval(code, flags) {
    const sb = await ensureSandbox(flags);
    sb._consoleLines.length = 0;

    try {
      const timeoutMs = flags.timeout ? parseInt(flags.timeout, 10) : undefined;
      const result = await sb.evaluate(code, { timeoutMs });
      const consoleOutput = sb._consoleLines.join('\n');
      const resultStr = formatResult(result);

      let output = '';
      if (consoleOutput) output += consoleOutput + '\n';
      if (result !== undefined) output += resultStr;
      if (!output) output = '(no output)';

      return { stdout: output + '\n', stderr: '', exitCode: 0 };
    } catch (e) {
      return { stdout: '', stderr: `Error: ${e.message}\n`, exitCode: 1 };
    }
  }

  async function cmdRun(filePath, flags) {
    const shell = getShell();
    if (!shell?.fs) {
      return { stdout: '', stderr: 'No filesystem available.\n', exitCode: 1 };
    }

    try {
      const code = await shell.fs.readFile(filePath);
      return cmdEval(code, flags);
    } catch (e) {
      return { stdout: '', stderr: `Failed to read ${filePath}: ${e.message}\n`, exitCode: 1 };
    }
  }

  async function cmdDefine(name, filePath, flags) {
    const shell = getShell();
    if (!shell?.fs) {
      return { stdout: '', stderr: 'No filesystem available.\n', exitCode: 1 };
    }

    try {
      const source = await shell.fs.readFile(filePath);
      const sb = await ensureSandbox(flags);
      await sb.defineModule(name, source);
      return { stdout: `Module '${name}' defined.\n`, stderr: '', exitCode: 0 };
    } catch (e) {
      return { stdout: '', stderr: `Failed to define module: ${e.message}\n`, exitCode: 1 };
    }
  }

  async function cmdImportMap(filePath, flags) {
    const shell = getShell();
    if (!shell?.fs) {
      return { stdout: '', stderr: 'No filesystem available.\n', exitCode: 1 };
    }

    try {
      const content = await shell.fs.readFile(filePath);
      const importMap = JSON.parse(content);
      flags.importMap = importMap;
      // Dispose and recreate sandbox with new import map
      if (sandbox && !sandbox.isDisposed()) {
        await sandbox.dispose();
        sandbox = null;
      }
      await ensureSandbox(flags);
      return { stdout: `Import map loaded from ${filePath}.\n`, stderr: '', exitCode: 0 };
    } catch (e) {
      return { stdout: '', stderr: `Failed to load import map: ${e.message}\n`, exitCode: 1 };
    }
  }

  function cmdStatus() {
    if (!sandbox || sandbox.isDisposed()) {
      return { stdout: 'Sandbox: not running\n', stderr: '', exitCode: 0 };
    }
    const s = sandbox.stats();
    const lines = [
      'Sandbox: running',
      `  Virtual modules: ${s.virtualModules.join(', ') || '(none)'}`,
      `  Pending evaluations: ${s.pendingEvaluations}`,
      `  Gate calls: ${s.gate.totalCalls}`,
      `  Gate arg bytes: ${s.gate.totalArgBytes}`,
    ];
    return { stdout: lines.join('\n') + '\n', stderr: '', exitCode: 0 };
  }

  async function cmdDispose() {
    if (!sandbox || sandbox.isDisposed()) {
      return { stdout: 'No sandbox to dispose.\n', stderr: '', exitCode: 0 };
    }
    await sandbox.dispose();
    sandbox = null;
    return { stdout: 'Sandbox disposed.\n', stderr: '', exitCode: 0 };
  }

  /**
   * Enter REPL mode — returns __enterReplMode with a line handler.
   */
  async function cmdRepl(flags) {
    await ensureSandbox(flags);
    return {
      stdout: `andbox REPL (type .help for commands, .exit to quit)\n`,
      stderr: '',
      exitCode: 0,
      __enterReplMode: true,
      __replPrompt: 'andbox> ',
      __replHandler: async (line) => {
        const trimmed = line.trim();

        // Dot commands
        if (trimmed === '.exit') {
          return { stdout: '', stderr: '', exitCode: 0, __exitReplMode: true };
        }
        if (trimmed === '.help') {
          return { stdout: HELP_TEXT, stderr: '', exitCode: 0 };
        }
        if (trimmed.startsWith('.define ')) {
          const parts = trimmed.slice(8).trim().split(/\s+/);
          const name = parts[0];
          const code = parts.slice(1).join(' ');
          if (!name || !code) {
            return { stdout: '', stderr: 'Usage: .define <name> <code>\n', exitCode: 1 };
          }
          try {
            const sb = await ensureSandbox(flags);
            await sb.defineModule(name, code);
            return { stdout: `Module '${name}' defined.\n`, stderr: '', exitCode: 0 };
          } catch (e) {
            return { stdout: '', stderr: `Error: ${e.message}\n`, exitCode: 1 };
          }
        }
        if (trimmed.startsWith('.import ')) {
          const specifier = trimmed.slice(8).trim();
          return cmdEval(`const m = await sandboxImport('${specifier}'); return Object.keys(m);`, flags);
        }
        if (trimmed === '.graph') {
          if (!sandbox || sandbox.isDisposed()) {
            return { stdout: 'No sandbox running.\n', stderr: '', exitCode: 0 };
          }
          const s = sandbox.stats();
          const modules = s.virtualModules;
          if (modules.length === 0) {
            return { stdout: '(no virtual modules defined)\n', stderr: '', exitCode: 0 };
          }
          return { stdout: modules.map(m => `  - ${m}`).join('\n') + '\n', stderr: '', exitCode: 0 };
        }
        if (trimmed === '.stats') {
          return cmdStatus();
        }

        // Skip empty lines
        if (!trimmed) {
          return { stdout: '', stderr: '', exitCode: 0 };
        }

        // Evaluate as code — auto-return last expression for REPL output
        return cmdEval(autoReturn(trimmed), flags);
      },
    };
  }

  // ── Main Command Registration ──

  registry.register('andbox', async ({ args }) => {
    // No args: start REPL
    if (args.length === 0) {
      return cmdRepl({});
    }

    const subcmd = args[0];
    const subArgs = args.slice(1);

    // Parse flags from all args
    const { flags, positional } = parseFlags(args, FLAG_SPEC);

    // Apply profile
    if (flags.profile && PROFILES[flags.profile]) {
      Object.assign(flags, PROFILES[flags.profile]);
    }

    // Dispatch subcommands
    switch (subcmd) {
      case 'repl':
        return cmdRepl(flags);

      case 'run': {
        const file = positional[1] || subArgs[0];
        if (!file) {
          return { stdout: '', stderr: 'Usage: andbox run <file>\n', exitCode: 1 };
        }
        return cmdRun(file, flags);
      }

      case 'define': {
        const name = positional[1] || subArgs[0];
        const file = positional[2] || subArgs[1];
        if (!name || !file) {
          return { stdout: '', stderr: 'Usage: andbox define <name> <file>\n', exitCode: 1 };
        }
        return cmdDefine(name, file, flags);
      }

      case 'import-map': {
        const file = positional[1] || subArgs[0];
        if (!file) {
          return { stdout: '', stderr: 'Usage: andbox import-map <file>\n', exitCode: 1 };
        }
        return cmdImportMap(file, flags);
      }

      case 'status':
        return cmdStatus();

      case 'dispose':
        return cmdDispose();

      case 'help':
      case '--help':
      case '-h':
        return { stdout: HELP_TEXT, stderr: '', exitCode: 0 };

      default:
        break;
    }

    // --eval flag
    if (flags.eval) {
      const code = typeof flags.eval === 'string' ? flags.eval : positional.join(' ');
      if (!code) {
        return { stdout: '', stderr: 'No code provided for --eval\n', exitCode: 1 };
      }
      return cmdEval(code, flags);
    }

    // Bare code string (not a subcommand, not a flag)
    if (!subcmd.startsWith('-')) {
      const code = args.join(' ');
      return cmdEval(code, flags);
    }

    return { stdout: '', stderr: `Unknown command: ${subcmd}\nRun 'andbox help' for usage.\n`, exitCode: 1 };
  }, {
    description: 'Sandboxed JavaScript runtime',
    category: 'Development',
    usage: 'andbox [SUBCOMMAND|CODE] [FLAGS]',
  });
}
