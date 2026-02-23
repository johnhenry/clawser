/**
 * Clawser Shell — Browser shell emulation layer
 *
 * Provides a virtual shell that parses command strings into an AST,
 * routes commands to JS implementations, and supports pipes, redirects,
 * and logical operators (&&, ||, ;).
 *
 * Architecture:
 *   1. Tokenizer — splits command string into tokens
 *   2. Parser — recursive descent, builds AST from tokens
 *   3. Executor — walks AST, dispatches to CommandRegistry
 *   4. Built-in commands — 22+ commands backed by OPFS via ShellFs
 *   5. ClawserShell — main API: exec(command) → {stdout, stderr, exitCode}
 *   6. ShellTool — BrowserTool subclass for agent integration
 *
 * Scoping: one ClawserShell per conversation. Shell state (cwd, env, $?)
 * is ephemeral; filesystem changes persist in OPFS.
 */

import { BrowserTool } from './clawser-tools.js';

// ── Token Types ─────────────────────────────────────────────────

const T = {
  WORD: 'WORD',
  PIPE: 'PIPE',                     // |
  AND: 'AND',                       // &&
  OR: 'OR',                         // ||
  SEMI: 'SEMI',                     // ;
  REDIRECT_OUT: 'REDIRECT_OUT',     // >
  REDIRECT_APPEND: 'REDIRECT_APPEND', // >>
  EOF: 'EOF',
};

// ── Tokenizer ───────────────────────────────────────────────────

/**
 * Tokenize a shell command string.
 * Handles: single/double quotes, backslash escaping, |, &&, ||, ;, >, >>
 * @param {string} input
 * @returns {Array<{type: string, value: string}>}
 */
export function tokenize(input) {
  const tokens = [];
  let i = 0;
  const len = input.length;

  while (i < len) {
    // Skip whitespace
    if (input[i] === ' ' || input[i] === '\t') { i++; continue; }

    // Pipe or OR
    if (input[i] === '|') {
      if (input[i + 1] === '|') {
        tokens.push({ type: T.OR, value: '||' });
        i += 2;
      } else {
        tokens.push({ type: T.PIPE, value: '|' });
        i++;
      }
      continue;
    }

    // AND
    if (input[i] === '&' && input[i + 1] === '&') {
      tokens.push({ type: T.AND, value: '&&' });
      i += 2;
      continue;
    }

    // Semicolon
    if (input[i] === ';') {
      tokens.push({ type: T.SEMI, value: ';' });
      i++;
      continue;
    }

    // Redirect
    if (input[i] === '>') {
      if (input[i + 1] === '>') {
        tokens.push({ type: T.REDIRECT_APPEND, value: '>>' });
        i += 2;
      } else {
        tokens.push({ type: T.REDIRECT_OUT, value: '>' });
        i++;
      }
      continue;
    }

    // Word (quoted or unquoted)
    let word = '';
    while (i < len && input[i] !== ' ' && input[i] !== '\t') {
      // Check for unquoted operator characters
      if (input[i] === '|' || input[i] === ';' || input[i] === '>') break;
      if (input[i] === '&' && input[i + 1] === '&') break;

      if (input[i] === '\\' && i + 1 < len) {
        // Backslash escape
        word += input[i + 1];
        i += 2;
      } else if (input[i] === '"') {
        // Double-quoted string
        i++; // skip opening quote
        while (i < len && input[i] !== '"') {
          if (input[i] === '\\' && i + 1 < len) {
            word += input[i + 1];
            i += 2;
          } else {
            word += input[i];
            i++;
          }
        }
        if (i < len) i++; // skip closing quote
      } else if (input[i] === "'") {
        // Single-quoted string (no escaping inside)
        i++; // skip opening quote
        while (i < len && input[i] !== "'") {
          word += input[i];
          i++;
        }
        if (i < len) i++; // skip closing quote
      } else {
        word += input[i];
        i++;
      }
    }
    if (word.length > 0) {
      tokens.push({ type: T.WORD, value: word });
    }
  }

  tokens.push({ type: T.EOF, value: '' });
  return tokens;
}

// ── Parser ──────────────────────────────────────────────────────

/**
 * Parse a command string (or token array) into an AST.
 *
 * Grammar (P0):
 *   list       = pipeline ((';' | '&&' | '||') pipeline)*
 *   pipeline   = command ('|' command)* redirect?
 *   command    = WORD+
 *   redirect   = '>' WORD | '>>' WORD
 *
 * @param {string|Array} input - Command string or pre-tokenized array
 * @returns {object|null} AST node or null for empty input
 */
export function parse(input) {
  const tokens = typeof input === 'string' ? tokenize(input) : input;
  let pos = 0;

  function peek() { return tokens[pos] || { type: T.EOF, value: '' }; }
  function advance() { return tokens[pos++]; }

  function parseCommand() {
    const words = [];
    while (peek().type === T.WORD) {
      words.push(advance().value);
    }
    if (words.length === 0) return null;
    return { type: 'command', name: words[0], args: words.slice(1) };
  }

  function parseRedirect() {
    const tok = peek();
    if (tok.type === T.REDIRECT_OUT || tok.type === T.REDIRECT_APPEND) {
      advance();
      const pathTok = peek();
      if (pathTok.type !== T.WORD) {
        throw new SyntaxError('Expected filename after redirect');
      }
      advance();
      return {
        type: tok.type === T.REDIRECT_APPEND ? 'append' : 'write',
        path: pathTok.value,
      };
    }
    return null;
  }

  function parsePipeline() {
    const commands = [];
    const first = parseCommand();
    if (!first) return null;
    commands.push(first);

    while (peek().type === T.PIPE) {
      advance(); // consume |
      const next = parseCommand();
      if (!next) throw new SyntaxError('Expected command after |');
      commands.push(next);
    }

    const redirect = parseRedirect();

    if (commands.length === 1 && !redirect) {
      return commands[0];
    }
    return { type: 'pipeline', commands, redirect };
  }

  function parseList() {
    const first = parsePipeline();
    if (!first) return null;

    const commands = [first];
    const operators = [];

    while (peek().type === T.AND || peek().type === T.OR || peek().type === T.SEMI) {
      const op = advance();
      operators.push(op.value);
      const next = parsePipeline();
      if (!next) {
        // Trailing semicolons are ok
        if (op.type === T.SEMI) break;
        throw new SyntaxError(`Expected command after ${op.value}`);
      }
      commands.push(next);
    }

    if (commands.length === 1) return commands[0];
    return { type: 'list', commands, operators };
  }

  return parseList();
}

// ── Path Utilities ──────────────────────────────────────────────

/**
 * Normalize a path: resolve . and .., collapse //, ensure leading /.
 * @param {string} p
 * @returns {string}
 */
export function normalizePath(p) {
  const parts = p.split('/').filter(Boolean);
  const resolved = [];
  for (const part of parts) {
    if (part === '.') continue;
    if (part === '..') { resolved.pop(); continue; }
    resolved.push(part);
  }
  return '/' + resolved.join('/');
}

// ── Shell State ─────────────────────────────────────────────────

export class ShellState {
  constructor() {
    /** @type {string} Virtual working directory (workspace-relative, starts at /) */
    this.cwd = '/';
    /** @type {Map<string, string>} Environment variables */
    this.env = new Map();
    /** @type {string[]} Command history for this session */
    this.history = [];
    /** @type {number} Exit code of last command ($?) */
    this.lastExitCode = 0;
    /** @type {boolean} Fail-fast on pipeline errors (like bash set -o pipefail) */
    this.pipefail = true;
  }

  /**
   * Resolve a path relative to cwd.
   * Leading / means absolute (relative to workspace root).
   * @param {string} path
   * @returns {string}
   */
  resolvePath(path) {
    if (!path) return this.cwd;
    // Absolute path
    if (path.startsWith('/')) return normalizePath(path);
    // Relative path
    const base = this.cwd === '/' ? '' : this.cwd;
    return normalizePath(`${base}/${path}`);
  }
}

// ── Command Registry ────────────────────────────────────────────

/**
 * Registry of shell commands. Each command is an async function:
 *   ({ args, stdin, state, registry, fs }) → { stdout, stderr, exitCode }
 */
export class CommandRegistry {
  #commands = new Map();

  /**
   * Register a command handler.
   * @param {string} name
   * @param {Function} handler - async ({ args, stdin, state, registry, fs }) → { stdout, stderr, exitCode }
   */
  register(name, handler) {
    this.#commands.set(name, handler);
  }

  /** @returns {Function|null} */
  get(name) {
    return this.#commands.get(name) || null;
  }

  /** @returns {boolean} */
  has(name) {
    return this.#commands.has(name);
  }

  /** @returns {string[]} */
  names() {
    return [...this.#commands.keys()];
  }
}

// ── Executor ────────────────────────────────────────────────────

/**
 * Execute an AST node.
 * @param {object} node - AST node from parse()
 * @param {ShellState} state
 * @param {CommandRegistry} registry
 * @param {object} [opts] - { stdin, fs }
 * @returns {Promise<{stdout: string, stderr: string, exitCode: number}>}
 */
export async function execute(node, state, registry, opts = {}) {
  if (!node) return { stdout: '', stderr: '', exitCode: 0 };

  switch (node.type) {
    case 'command':
      return executeCommand(node, state, registry, opts);
    case 'pipeline':
      return executePipeline(node, state, registry, opts);
    case 'list':
      return executeList(node, state, registry, opts);
    default:
      return { stdout: '', stderr: `Unknown AST node type: ${node.type}`, exitCode: 1 };
  }
}

async function executeCommand(node, state, registry, opts) {
  const handler = registry.get(node.name);
  if (!handler) {
    state.lastExitCode = 127;
    return { stdout: '', stderr: `command not found: ${node.name}`, exitCode: 127 };
  }

  try {
    const result = await handler({
      args: node.args,
      stdin: opts.stdin || '',
      state,
      registry,
      fs: opts.fs,
    });
    const exitCode = result.exitCode ?? 0;
    state.lastExitCode = exitCode;
    return {
      stdout: result.stdout ?? '',
      stderr: result.stderr ?? '',
      exitCode,
    };
  } catch (e) {
    state.lastExitCode = 1;
    return { stdout: '', stderr: e.message, exitCode: 1 };
  }
}

async function executePipeline(node, state, registry, opts) {
  let stdin = opts.stdin || '';
  let lastResult = { stdout: '', stderr: '', exitCode: 0 };

  for (const cmd of node.commands) {
    lastResult = await execute(cmd, state, registry, { ...opts, stdin });
    stdin = lastResult.stdout;

    // pipefail: abort pipeline on non-zero exit
    if (state.pipefail && lastResult.exitCode !== 0) {
      break;
    }
  }

  // Handle redirect
  if (node.redirect && opts.fs) {
    const path = state.resolvePath(node.redirect.path);
    try {
      if (node.redirect.type === 'append') {
        let existing = '';
        try { existing = await opts.fs.readFile(path); } catch { /* file doesn't exist yet */ }
        await opts.fs.writeFile(path, existing + lastResult.stdout);
      } else {
        await opts.fs.writeFile(path, lastResult.stdout);
      }
    } catch (e) {
      return { stdout: '', stderr: `redirect: ${e.message}`, exitCode: 1 };
    }
  }

  state.lastExitCode = lastResult.exitCode;
  return lastResult;
}

async function executeList(node, state, registry, opts) {
  let lastResult = await execute(node.commands[0], state, registry, opts);

  for (let i = 0; i < node.operators.length; i++) {
    const op = node.operators[i];
    const nextCmd = node.commands[i + 1];

    if (op === '&&' && lastResult.exitCode !== 0) continue;
    if (op === '||' && lastResult.exitCode === 0) continue;
    // ';' always executes

    lastResult = await execute(nextCmd, state, registry, opts);
  }

  return lastResult;
}

// ── OPFS Filesystem Adapter ─────────────────────────────────────

/**
 * Filesystem adapter that bridges shell commands to WorkspaceFs/OPFS.
 * Provides readFile, writeFile, listDir, mkdir, delete, copy, move, stat.
 */
export class ShellFs {
  /** @type {import('./clawser-tools.js').WorkspaceFs} */
  #ws;

  constructor(ws) {
    this.#ws = ws;
  }

  async #root() {
    return navigator.storage.getDirectory();
  }

  /** Navigate to a directory handle from a shell path */
  async #getDir(shellPath) {
    const opfsPath = this.#ws.resolve(shellPath.replace(/^\//, ''));
    const root = await this.#root();
    const parts = opfsPath.split('/').filter(Boolean);
    let dir = root;
    for (const part of parts) {
      dir = await dir.getDirectoryHandle(part);
    }
    return dir;
  }

  /** Get [parentHandle, filename] for a shell path */
  async #getParentAndName(shellPath) {
    const opfsPath = this.#ws.resolve(shellPath.replace(/^\//, ''));
    const parts = opfsPath.split('/').filter(Boolean);
    if (parts.length === 0) throw new Error('Invalid path');
    const root = await this.#root();
    let dir = root;
    for (const part of parts.slice(0, -1)) {
      dir = await dir.getDirectoryHandle(part);
    }
    return [dir, parts[parts.length - 1]];
  }

  async readFile(path) {
    const [parent, name] = await this.#getParentAndName(path);
    const fh = await parent.getFileHandle(name);
    const file = await fh.getFile();
    return file.text();
  }

  async writeFile(path, content) {
    const opfsPath = this.#ws.resolve(path.replace(/^\//, ''));
    const root = await this.#root();
    const parts = opfsPath.split('/').filter(Boolean);
    let dir = root;
    for (const part of parts.slice(0, -1)) {
      dir = await dir.getDirectoryHandle(part, { create: true });
    }
    const fh = await dir.getFileHandle(parts[parts.length - 1], { create: true });
    const writable = await fh.createWritable();
    await writable.write(content);
    await writable.close();
  }

  async listDir(path) {
    const dir = await this.#getDir(path);
    const entries = [];
    for await (const [name, handle] of dir) {
      entries.push({ name, kind: handle.kind });
    }
    return entries;
  }

  async mkdir(path) {
    const opfsPath = this.#ws.resolve(path.replace(/^\//, ''));
    const root = await this.#root();
    const parts = opfsPath.split('/').filter(Boolean);
    let dir = root;
    for (const part of parts) {
      dir = await dir.getDirectoryHandle(part, { create: true });
    }
  }

  async delete(path, recursive = false) {
    const [parent, name] = await this.#getParentAndName(path);
    await parent.removeEntry(name, { recursive });
  }

  async copy(src, dst) {
    const content = await this.readFile(src);
    await this.writeFile(dst, content);
  }

  async move(src, dst) {
    await this.copy(src, dst);
    await this.delete(src);
  }

  async stat(path) {
    try {
      const [parent, name] = await this.#getParentAndName(path);
      try {
        const fh = await parent.getFileHandle(name);
        const file = await fh.getFile();
        return { kind: 'file', size: file.size, lastModified: file.lastModified };
      } catch {
        await parent.getDirectoryHandle(name);
        return { kind: 'directory' };
      }
    } catch {
      return null;
    }
  }
}

// ── In-Memory Filesystem (for testing) ──────────────────────────

/**
 * Simple in-memory filesystem for testing shell commands without OPFS.
 * Mimics the ShellFs interface.
 */
export class MemoryFs {
  /** @type {Map<string, string>} file path → content */
  #files = new Map();
  /** @type {Set<string>} directory paths */
  #dirs = new Set(['/']);

  async readFile(path) {
    const norm = normalizePath(path);
    if (!this.#files.has(norm)) throw new Error(`ENOENT: ${norm}`);
    return this.#files.get(norm);
  }

  async writeFile(path, content) {
    const norm = normalizePath(path);
    // Auto-create parent dirs
    const parts = norm.split('/').filter(Boolean);
    for (let i = 1; i <= parts.length - 1; i++) {
      this.#dirs.add('/' + parts.slice(0, i).join('/'));
    }
    this.#files.set(norm, content);
  }

  async listDir(path) {
    const norm = normalizePath(path);
    if (!this.#dirs.has(norm) && norm !== '/') throw new Error(`ENOENT: ${norm}`);
    const prefix = norm === '/' ? '/' : norm + '/';
    const entries = [];
    const seen = new Set();

    // List files
    for (const [fp] of this.#files) {
      if (fp.startsWith(prefix)) {
        const rest = fp.slice(prefix.length);
        const name = rest.split('/')[0];
        if (!seen.has(name)) {
          seen.add(name);
          // Is it a direct child file or a directory?
          if (!rest.includes('/')) {
            entries.push({ name, kind: 'file' });
          } else {
            entries.push({ name, kind: 'directory' });
          }
        }
      }
    }

    // List directories that have no files in them
    for (const dp of this.#dirs) {
      if (dp.startsWith(prefix) && dp !== norm) {
        const rest = dp.slice(prefix.length);
        const name = rest.split('/')[0];
        if (!seen.has(name)) {
          seen.add(name);
          entries.push({ name, kind: 'directory' });
        }
      }
    }

    return entries;
  }

  async mkdir(path) {
    const norm = normalizePath(path);
    const parts = norm.split('/').filter(Boolean);
    for (let i = 1; i <= parts.length; i++) {
      this.#dirs.add('/' + parts.slice(0, i).join('/'));
    }
  }

  async delete(path, recursive = false) {
    const norm = normalizePath(path);
    if (this.#files.has(norm)) {
      this.#files.delete(norm);
      return;
    }
    if (this.#dirs.has(norm)) {
      const prefix = norm + '/';
      const childFiles = [...this.#files.keys()].filter(f => f.startsWith(prefix));
      const childDirs = [...this.#dirs].filter(d => d.startsWith(prefix));
      if (!recursive && (childFiles.length > 0 || childDirs.length > 0)) {
        throw new Error(`Directory not empty: ${norm}`);
      }
      for (const f of childFiles) this.#files.delete(f);
      for (const d of childDirs) this.#dirs.delete(d);
      this.#dirs.delete(norm);
      return;
    }
    throw new Error(`ENOENT: ${norm}`);
  }

  async copy(src, dst) {
    const content = await this.readFile(src);
    await this.writeFile(dst, content);
  }

  async move(src, dst) {
    await this.copy(src, dst);
    await this.delete(src);
  }

  async stat(path) {
    const norm = normalizePath(path);
    if (this.#files.has(norm)) return { kind: 'file', size: this.#files.get(norm).length };
    if (this.#dirs.has(norm)) return { kind: 'directory' };
    return null;
  }
}

// ── Built-in Commands ───────────────────────────────────────────

/**
 * Register all built-in shell commands with a CommandRegistry.
 * @param {CommandRegistry} registry
 */
export function registerBuiltins(registry) {
  // ── echo ──
  registry.register('echo', ({ args }) => {
    return { stdout: args.join(' ') + '\n', stderr: '', exitCode: 0 };
  });

  // ── true / false ──
  registry.register('true', () => ({ stdout: '', stderr: '', exitCode: 0 }));
  registry.register('false', () => ({ stdout: '', stderr: '', exitCode: 1 }));

  // ── pwd ──
  registry.register('pwd', ({ state }) => {
    return { stdout: state.cwd + '\n', stderr: '', exitCode: 0 };
  });

  // ── cd ──
  registry.register('cd', async ({ args, state, fs }) => {
    const target = args[0] || '/';
    const resolved = state.resolvePath(target);
    // Verify directory exists when filesystem is available
    if (fs) {
      try {
        const stat = await fs.stat(resolved);
        if (stat && stat.kind !== 'directory') {
          return { stdout: '', stderr: `cd: ${target}: Not a directory`, exitCode: 1 };
        }
        if (!stat && resolved !== '/') {
          // Try listDir as fallback (stat may not exist for root-like paths)
          await fs.listDir(resolved);
        }
      } catch {
        return { stdout: '', stderr: `cd: ${target}: No such directory`, exitCode: 1 };
      }
    }
    state.cwd = resolved;
    return { stdout: '', stderr: '', exitCode: 0 };
  });

  // ── ls ──
  registry.register('ls', async ({ args, state, fs }) => {
    if (!fs) return { stdout: '', stderr: 'ls: no filesystem', exitCode: 1 };
    const flags = args.filter(a => a.startsWith('-'));
    const paths = args.filter(a => !a.startsWith('-'));
    const target = paths[0] || '.';
    const resolved = state.resolvePath(target);
    const longFormat = flags.some(f => f.includes('l'));
    try {
      const entries = await fs.listDir(resolved);
      entries.sort((a, b) => a.name.localeCompare(b.name));
      let lines;
      if (longFormat) {
        lines = entries.map(e => {
          const prefix = e.kind === 'directory' ? 'd ' : '- ';
          return prefix + e.name;
        });
      } else {
        lines = entries.map(e => e.kind === 'directory' ? e.name + '/' : e.name);
      }
      return { stdout: lines.join('\n') + (lines.length > 0 ? '\n' : ''), stderr: '', exitCode: 0 };
    } catch {
      return { stdout: '', stderr: `ls: ${target}: No such file or directory`, exitCode: 1 };
    }
  });

  // ── cat ──
  registry.register('cat', async ({ args, stdin, state, fs }) => {
    if (args.length === 0) {
      // cat with no args passes through stdin
      return { stdout: stdin, stderr: '', exitCode: 0 };
    }
    if (!fs) return { stdout: '', stderr: 'cat: no filesystem', exitCode: 1 };
    let output = '';
    for (const arg of args) {
      const resolved = state.resolvePath(arg);
      try {
        output += await fs.readFile(resolved);
      } catch {
        return { stdout: output, stderr: `cat: ${arg}: No such file or directory`, exitCode: 1 };
      }
    }
    return { stdout: output, stderr: '', exitCode: 0 };
  });

  // ── mkdir ──
  registry.register('mkdir', async ({ args, state, fs }) => {
    if (!fs) return { stdout: '', stderr: 'mkdir: no filesystem', exitCode: 1 };
    const paths = args.filter(a => !a.startsWith('-'));
    if (paths.length === 0) return { stdout: '', stderr: 'mkdir: missing operand', exitCode: 1 };
    for (const arg of paths) {
      const resolved = state.resolvePath(arg);
      try {
        await fs.mkdir(resolved);
      } catch (e) {
        return { stdout: '', stderr: `mkdir: ${arg}: ${e.message}`, exitCode: 1 };
      }
    }
    return { stdout: '', stderr: '', exitCode: 0 };
  });

  // ── rm ──
  registry.register('rm', async ({ args, state, fs }) => {
    if (!fs) return { stdout: '', stderr: 'rm: no filesystem', exitCode: 1 };
    const recursive = args.some(a => a === '-r' || a === '-rf' || a === '-fr');
    const paths = args.filter(a => !a.startsWith('-'));
    if (paths.length === 0) return { stdout: '', stderr: 'rm: missing operand', exitCode: 1 };
    for (const p of paths) {
      const resolved = state.resolvePath(p);
      try {
        await fs.delete(resolved, recursive);
      } catch (e) {
        return { stdout: '', stderr: `rm: ${p}: ${e.message}`, exitCode: 1 };
      }
    }
    return { stdout: '', stderr: '', exitCode: 0 };
  });

  // ── cp ──
  registry.register('cp', async ({ args, state, fs }) => {
    if (!fs) return { stdout: '', stderr: 'cp: no filesystem', exitCode: 1 };
    if (args.length < 2) return { stdout: '', stderr: 'cp: missing operand', exitCode: 1 };
    const src = state.resolvePath(args[0]);
    const dst = state.resolvePath(args[1]);
    try {
      await fs.copy(src, dst);
      return { stdout: '', stderr: '', exitCode: 0 };
    } catch (e) {
      return { stdout: '', stderr: `cp: ${e.message}`, exitCode: 1 };
    }
  });

  // ── mv ──
  registry.register('mv', async ({ args, state, fs }) => {
    if (!fs) return { stdout: '', stderr: 'mv: no filesystem', exitCode: 1 };
    if (args.length < 2) return { stdout: '', stderr: 'mv: missing operand', exitCode: 1 };
    const src = state.resolvePath(args[0]);
    const dst = state.resolvePath(args[1]);
    try {
      await fs.move(src, dst);
      return { stdout: '', stderr: '', exitCode: 0 };
    } catch (e) {
      return { stdout: '', stderr: `mv: ${e.message}`, exitCode: 1 };
    }
  });

  // ── head ──
  registry.register('head', ({ args, stdin }) => {
    let n = 10;
    const nIdx = args.indexOf('-n');
    if (nIdx >= 0 && args[nIdx + 1]) n = parseInt(args[nIdx + 1], 10) || 10;
    // Also handle -N shorthand (e.g. -5)
    for (const a of args) {
      if (/^-\d+$/.test(a)) n = parseInt(a.slice(1), 10);
    }
    const lines = stdin.split('\n');
    return { stdout: lines.slice(0, n).join('\n') + '\n', stderr: '', exitCode: 0 };
  });

  // ── tail ──
  registry.register('tail', ({ args, stdin }) => {
    let n = 10;
    const nIdx = args.indexOf('-n');
    if (nIdx >= 0 && args[nIdx + 1]) n = parseInt(args[nIdx + 1], 10) || 10;
    for (const a of args) {
      if (/^-\d+$/.test(a)) n = parseInt(a.slice(1), 10);
    }
    const lines = stdin.split('\n');
    // Remove trailing empty line from split
    if (lines[lines.length - 1] === '') lines.pop();
    return { stdout: lines.slice(-n).join('\n') + '\n', stderr: '', exitCode: 0 };
  });

  // ── grep ──
  registry.register('grep', ({ args, stdin }) => {
    const flags = [];
    const nonFlags = [];
    for (const a of args) {
      if (a.startsWith('-') && a.length > 1 && !/^-\d+$/.test(a)) {
        flags.push(...a.slice(1).split(''));
      } else {
        nonFlags.push(a);
      }
    }
    const pattern = nonFlags[0];
    if (!pattern) return { stdout: '', stderr: 'grep: missing pattern', exitCode: 2 };

    const ignoreCase = flags.includes('i');
    const invert = flags.includes('v');
    const countOnly = flags.includes('c');

    let regex;
    try {
      regex = new RegExp(pattern, ignoreCase ? 'i' : '');
    } catch {
      return { stdout: '', stderr: `grep: invalid regex: ${pattern}`, exitCode: 2 };
    }

    const lines = stdin.split('\n');
    // Don't match the trailing empty line from split
    const inputLines = lines[lines.length - 1] === '' ? lines.slice(0, -1) : lines;

    const matched = inputLines.filter(line => {
      const m = regex.test(line);
      return invert ? !m : m;
    });

    if (countOnly) {
      return { stdout: matched.length + '\n', stderr: '', exitCode: matched.length > 0 ? 0 : 1 };
    }
    if (matched.length === 0) {
      return { stdout: '', stderr: '', exitCode: 1 };
    }
    return { stdout: matched.join('\n') + '\n', stderr: '', exitCode: 0 };
  });

  // ── wc ──
  registry.register('wc', ({ args, stdin }) => {
    const lines = stdin.split('\n');
    const lineCount = stdin.endsWith('\n') ? lines.length - 1 : lines.length;
    const wordCount = stdin.trim() ? stdin.trim().split(/\s+/).length : 0;
    const charCount = stdin.length;

    const onlyLines = args.includes('-l');
    const onlyWords = args.includes('-w');
    const onlyChars = args.includes('-c') || args.includes('-m');

    if (onlyLines) return { stdout: lineCount + '\n', stderr: '', exitCode: 0 };
    if (onlyWords) return { stdout: wordCount + '\n', stderr: '', exitCode: 0 };
    if (onlyChars) return { stdout: charCount + '\n', stderr: '', exitCode: 0 };

    return { stdout: `${lineCount} ${wordCount} ${charCount}\n`, stderr: '', exitCode: 0 };
  });

  // ── sort ──
  registry.register('sort', ({ args, stdin }) => {
    const reverse = args.includes('-r');
    const numeric = args.includes('-n');
    const unique = args.includes('-u');

    let lines = stdin.split('\n');
    if (lines[lines.length - 1] === '') lines.pop();

    if (numeric) {
      lines.sort((a, b) => parseFloat(a) - parseFloat(b));
    } else {
      lines.sort();
    }
    if (reverse) lines.reverse();
    if (unique) lines = [...new Set(lines)];

    return { stdout: lines.join('\n') + '\n', stderr: '', exitCode: 0 };
  });

  // ── uniq ──
  registry.register('uniq', ({ args, stdin }) => {
    const countMode = args.includes('-c');
    const lines = stdin.split('\n');
    if (lines[lines.length - 1] === '') lines.pop();

    const result = [];
    let prev = null;
    let count = 0;

    for (const line of lines) {
      if (line === prev) {
        count++;
      } else {
        if (prev !== null) {
          result.push(countMode ? `${count} ${prev}` : prev);
        }
        prev = line;
        count = 1;
      }
    }
    if (prev !== null) {
      result.push(countMode ? `${count} ${prev}` : prev);
    }

    return { stdout: result.join('\n') + '\n', stderr: '', exitCode: 0 };
  });

  // ── tee ──
  registry.register('tee', async ({ args, stdin, state, fs }) => {
    const append = args.includes('-a');
    const paths = args.filter(a => !a.startsWith('-'));

    if (fs) {
      for (const p of paths) {
        const resolved = state.resolvePath(p);
        try {
          if (append) {
            let existing = '';
            try { existing = await fs.readFile(resolved); } catch { /* file doesn't exist */ }
            await fs.writeFile(resolved, existing + stdin);
          } else {
            await fs.writeFile(resolved, stdin);
          }
        } catch (e) {
          return { stdout: stdin, stderr: `tee: ${p}: ${e.message}`, exitCode: 1 };
        }
      }
    }
    // tee passes stdin through to stdout
    return { stdout: stdin, stderr: '', exitCode: 0 };
  });

  // ── env ──
  registry.register('env', ({ state }) => {
    const lines = [];
    for (const [k, v] of state.env) {
      lines.push(`${k}=${v}`);
    }
    return { stdout: lines.join('\n') + (lines.length > 0 ? '\n' : ''), stderr: '', exitCode: 0 };
  });

  // ── export ──
  registry.register('export', ({ args, state }) => {
    for (const arg of args) {
      const eq = arg.indexOf('=');
      if (eq > 0) {
        state.env.set(arg.slice(0, eq), arg.slice(eq + 1));
      }
    }
    return { stdout: '', stderr: '', exitCode: 0 };
  });

  // ── which ──
  registry.register('which', ({ args, registry }) => {
    if (args.length === 0) return { stdout: '', stderr: 'which: missing argument', exitCode: 1 };
    const name = args[0];
    if (registry.has(name)) {
      return { stdout: `${name}: shell built-in\n`, stderr: '', exitCode: 0 };
    }
    return { stdout: '', stderr: `${name} not found`, exitCode: 1 };
  });

  // ── help ──
  registry.register('help', ({ registry }) => {
    const names = registry.names().sort();
    return { stdout: 'Available commands:\n' + names.map(n => `  ${n}`).join('\n') + '\n', stderr: '', exitCode: 0 };
  });
}

// ── ClawserShell (main API) ─────────────────────────────────────

export class ClawserShell {
  /** @type {ShellState} */
  state;
  /** @type {CommandRegistry} */
  registry;
  /** @type {ShellFs|MemoryFs|null} */
  fs;

  /**
   * Create a new shell instance.
   * @param {object} [opts]
   * @param {import('./clawser-tools.js').WorkspaceFs} [opts.workspaceFs] - OPFS filesystem adapter
   * @param {object} [opts.fs] - Pre-built filesystem (e.g. MemoryFs for testing)
   * @param {CommandRegistry} [opts.registry] - Pre-built command registry
   */
  constructor(opts = {}) {
    this.state = new ShellState();
    this.registry = opts.registry || new CommandRegistry();
    this.fs = opts.fs || (opts.workspaceFs ? new ShellFs(opts.workspaceFs) : null);

    if (!opts.registry) {
      registerBuiltins(this.registry);
    }
  }

  /**
   * Execute a command string.
   * @param {string} command
   * @returns {Promise<{stdout: string, stderr: string, exitCode: number}>}
   */
  async exec(command) {
    if (!command || !command.trim()) {
      return { stdout: '', stderr: '', exitCode: 0 };
    }

    // Record in history
    this.state.history.push(command);

    let ast;
    try {
      ast = parse(command);
    } catch (e) {
      this.state.lastExitCode = 2;
      return { stdout: '', stderr: `syntax error: ${e.message}`, exitCode: 2 };
    }

    return execute(ast, this.state, this.registry, { fs: this.fs });
  }

  /**
   * Source a file: execute each non-empty, non-comment line as a command.
   * @param {string} path - Path to the file to source
   */
  async source(path) {
    if (!this.fs) return;
    try {
      const content = await this.fs.readFile(path);
      const lines = content.split('\n').filter(l => l.trim() && !l.trim().startsWith('#'));
      for (const line of lines) {
        await this.exec(line);
      }
    } catch {
      // .clawserrc not found is fine — not an error
    }
  }
}

// ── ShellTool (agent-facing tool) ───────────────────────────────

/**
 * Agent-facing tool that exposes the shell as a single string-based tool.
 * Takes a function that returns the current shell instance, so the tool
 * survives conversation switches (the shell reference is always fresh).
 */
export class ShellTool extends BrowserTool {
  /** @type {Function} */
  #getShell;

  /**
   * @param {Function} getShell - () → ClawserShell|null
   */
  constructor(getShell) {
    super();
    this.#getShell = getShell;
  }

  get name() { return 'shell'; }
  get description() {
    return 'Execute shell commands in a virtual browser shell. Supports pipes (|), redirects (>, >>), logical operators (&&, ||), and semicolons (;). Built-in commands include: cd, ls, pwd, cat, mkdir, rm, cp, mv, echo, head, tail, grep, wc, sort, uniq, tee, env, export, which, help. All filesystem commands operate on the workspace OPFS.';
  }
  get parameters() {
    return {
      type: 'object',
      properties: {
        command: { type: 'string', description: 'Shell command to execute' },
      },
      required: ['command'],
    };
  }
  get permission() { return 'internal'; }

  async execute({ command }) {
    const shell = this.#getShell();
    if (!shell) {
      return { success: false, output: '', error: 'No active shell session' };
    }
    const result = await shell.exec(command);
    const output = [result.stdout, result.stderr].filter(Boolean).join('\n');
    return {
      success: result.exitCode === 0,
      output: output || `(exit code: ${result.exitCode})`,
      error: result.exitCode !== 0 ? (result.stderr || `exit code: ${result.exitCode}`) : undefined,
    };
  }
}
