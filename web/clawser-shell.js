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
import { registerExtendedBuiltins, registerJqBuiltin } from './clawser-shell-builtins.js';

// ── Token Types ─────────────────────────────────────────────────

const T = {
  WORD: 'WORD',
  PIPE: 'PIPE',                     // |
  AND: 'AND',                       // &&
  OR: 'OR',                         // ||
  SEMI: 'SEMI',                     // ;
  REDIRECT_OUT: 'REDIRECT_OUT',     // >
  REDIRECT_APPEND: 'REDIRECT_APPEND', // >>
  REDIRECT_ERR: 'REDIRECT_ERR',     // 2>
  REDIRECT_ERR_APPEND: 'REDIRECT_ERR_APPEND', // 2>>
  REDIRECT_ERR_TO_OUT: 'REDIRECT_ERR_TO_OUT', // 2>&1
  BACKGROUND: 'BACKGROUND',               // &
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

    // AND or BACKGROUND
    if (input[i] === '&') {
      if (input[i + 1] === '&') {
        tokens.push({ type: T.AND, value: '&&' });
        i += 2;
      } else {
        tokens.push({ type: T.BACKGROUND, value: '&' });
        i++;
      }
      continue;
    }

    // Semicolon
    if (input[i] === ';') {
      tokens.push({ type: T.SEMI, value: ';' });
      i++;
      continue;
    }

    // Stderr redirect: 2>, 2>>, 2>&1
    // After whitespace skip, we are at a token boundary. If the next two chars are
    // '2' followed by '>', this is a stderr redirect operator (not a word starting with '2').
    if (input[i] === '2' && i + 1 < len && input[i + 1] === '>') {
      if (i + 3 < len && input[i + 2] === '&' && input[i + 3] === '1') {
        tokens.push({ type: T.REDIRECT_ERR_TO_OUT, value: '2>&1' });
        i += 4;
      } else if (i + 2 < len && input[i + 2] === '>') {
        tokens.push({ type: T.REDIRECT_ERR_APPEND, value: '2>>' });
        i += 3;
      } else {
        tokens.push({ type: T.REDIRECT_ERR, value: '2>' });
        i += 2;
      }
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
 *   pipeline   = command ('|' command)* redirect*
 *   command    = WORD+
 *   redirect   = '>' WORD | '>>' WORD | '2>' WORD | '2>>' WORD | '2>&1'
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
    let redirect = null;
    let stderrRedirect = null;

    // Parse all redirect tokens (stdout and stderr) in any order
    while (true) {
      const tok = peek();

      if (tok.type === T.REDIRECT_OUT || tok.type === T.REDIRECT_APPEND) {
        advance();
        const pathTok = peek();
        if (pathTok.type !== T.WORD) {
          throw new SyntaxError('Expected filename after redirect');
        }
        advance();
        redirect = {
          type: tok.type === T.REDIRECT_APPEND ? 'append' : 'write',
          path: pathTok.value,
        };
      } else if (tok.type === T.REDIRECT_ERR || tok.type === T.REDIRECT_ERR_APPEND) {
        advance();
        const pathTok = peek();
        if (pathTok.type !== T.WORD) {
          throw new SyntaxError('Expected filename after 2>');
        }
        advance();
        stderrRedirect = {
          type: tok.type === T.REDIRECT_ERR_APPEND ? 'err_append' : 'err_write',
          path: pathTok.value,
        };
      } else if (tok.type === T.REDIRECT_ERR_TO_OUT) {
        advance();
        stderrRedirect = { type: 'err_to_out' };
      } else {
        break;
      }
    }

    // Return combined result or null
    if (!redirect && !stderrRedirect) return null;
    // Pack stderr info into redirect object for backward compat
    if (redirect && stderrRedirect) {
      redirect.stderr = stderrRedirect;
      return redirect;
    }
    if (stderrRedirect) {
      return { type: null, stderr: stderrRedirect };
    }
    return redirect;
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

    // Check for trailing & (background)
    let background = false;
    if (peek().type === T.BACKGROUND) {
      advance();
      background = true;
    }

    if (commands.length === 1 && !background) return commands[0];
    const node = { type: 'list', commands, operators };
    if (background) node.background = true;
    return node;
  }

  return parseList();
}

// ── Variable Expansion ──────────────────────────────────────────

/**
 * Expand shell variables in a token string.
 * Handles $VAR, ${VAR}, and $? (last exit code).
 * Leaves literal $ at end of string or $ followed by non-alphanumeric.
 * @param {string} token - Token string to expand
 * @param {object} env - Environment object (Map or plain object with get())
 * @returns {string} Token with variables expanded
 */
export function expandVariables(token, env) {
  if (!token || typeof token !== 'string') return token || '';
  const get = (key) => {
    if (env instanceof Map) return env.get(key);
    if (env && typeof env === 'object') return env[key];
    return undefined;
  };

  let result = '';
  let i = 0;
  const len = token.length;

  while (i < len) {
    if (token[i] === '$') {
      // End of string — literal $
      if (i + 1 >= len) {
        result += '$';
        i++;
        continue;
      }

      // $? — last exit code
      if (token[i + 1] === '?') {
        result += (get('?') ?? '0');
        i += 2;
        continue;
      }

      // ${VAR} — braced variable
      if (token[i + 1] === '{') {
        const close = token.indexOf('}', i + 2);
        if (close !== -1) {
          const varName = token.slice(i + 2, close);
          result += (get(varName) ?? '');
          i = close + 1;
          continue;
        }
        // No closing brace — treat as literal
        result += '$';
        i++;
        continue;
      }

      // $VAR — unbraced variable (alphanumeric + underscore)
      if (/[a-zA-Z_]/.test(token[i + 1])) {
        let end = i + 1;
        while (end < len && /[a-zA-Z0-9_]/.test(token[end])) end++;
        const varName = token.slice(i + 1, end);
        result += (get(varName) ?? '');
        i = end;
        continue;
      }

      // $ followed by non-alphanumeric — literal $
      result += '$';
      i++;
      continue;
    }

    result += token[i];
    i++;
  }

  return result;
}

// ── Command Substitution ─────────────────────────────────────────

/**
 * Expand $(cmd) command substitutions in a string.
 * Supports nested $(…) via paren-depth tracking.
 * Trailing newlines in command output are stripped (standard shell behavior).
 *
 * @param {string} token - String possibly containing $(cmd) sequences
 * @param {function} executor - async (cmdString) → {stdout, stderr, exitCode}
 * @returns {Promise<string>} Token with substitutions replaced by command output
 */
export async function expandCommandSubs(token, executor) {
  if (!token || typeof token !== 'string') return token || '';
  if (!executor) return token;

  let result = '';
  let i = 0;
  const len = token.length;

  while (i < len) {
    // Escaped \$( — keep literal $(
    if (token[i] === '\\' && i + 1 < len && token[i + 1] === '$') {
      result += token[i + 1];
      // Check if this is \$( — preserve the ( too
      if (i + 2 < len && token[i + 2] === '(') {
        result += token[i + 2];
        i += 3;
      } else {
        i += 2;
      }
      continue;
    }

    // $( — start of command substitution
    if (token[i] === '$' && i + 1 < len && token[i + 1] === '(') {
      // Find matching closing paren, tracking depth
      let depth = 1;
      let j = i + 2;
      while (j < len && depth > 0) {
        if (token[j] === '(' && token[j - 1] === '$') depth++;
        else if (token[j] === '(') depth++; // nested parens
        else if (token[j] === ')') depth--;
        if (depth > 0) j++;
      }

      if (depth !== 0) {
        // Unmatched $( — treat as literal
        result += token[i];
        i++;
        continue;
      }

      const innerCmd = token.slice(i + 2, j);

      // Recursively expand nested $(…) in the inner command
      const expandedCmd = await expandCommandSubs(innerCmd, executor);

      // Execute the command
      const { stdout } = await executor(expandedCmd);

      // Strip trailing newlines (standard shell behavior)
      result += (stdout || '').replace(/\n+$/, '');
      i = j + 1;
      continue;
    }

    result += token[i];
    i++;
  }

  return result;
}

// ── Brace Expansion ─────────────────────────────────────────────

/**
 * Expand {a,b,c} brace patterns into all alternatives.
 * Supports nested braces: {a,b{1,2}} → [a, b1, b2].
 * Returns [token] if no braces present.
 *
 * @param {string} token - String possibly containing {alternatives}
 * @returns {string[]} Array of expanded alternatives
 */
export function expandBraces(token) {
  if (!token || typeof token !== 'string') return [token || ''];
  if (!token.includes('{')) return [token];

  // Find the first top-level brace group
  let start = -1;
  let end = -1;
  let depth = 0;

  for (let i = 0; i < token.length; i++) {
    if (token[i] === '{') {
      if (depth === 0) start = i;
      depth++;
    } else if (token[i] === '}') {
      depth--;
      if (depth === 0 && start !== -1) {
        end = i;
        break;
      }
    }
  }

  if (start === -1 || end === -1) return [token];

  const prefix = token.slice(0, start);
  const suffix = token.slice(end + 1);
  const body = token.slice(start + 1, end);

  // Split body on commas at depth 0 only
  const alternatives = [];
  let current = '';
  depth = 0;
  for (let i = 0; i < body.length; i++) {
    if (body[i] === '{') depth++;
    else if (body[i] === '}') depth--;
    if (body[i] === ',' && depth === 0) {
      alternatives.push(current);
      current = '';
    } else {
      current += body[i];
    }
  }
  alternatives.push(current);

  if (alternatives.length <= 1) return [token]; // No comma → literal braces

  // Recursively expand each alternative (handles nested braces)
  const results = [];
  for (const alt of alternatives) {
    const expanded = expandBraces(prefix + alt + suffix);
    results.push(...expanded);
  }
  return results;
}

// ── Glob Expansion ──────────────────────────────────────────────

/**
 * Expand glob patterns in a token by matching against filesystem entries.
 * Handles *, ?, [abc] character classes, ** recursive, {a,b} braces, !(pattern) negation.
 * If no matches found, returns the original token (standard shell behavior).
 * @param {string} token - Token string that may contain glob characters
 * @param {object} fs - Filesystem object with listDir(path) method
 * @param {string} cwd - Current working directory
 * @returns {Promise<string[]>} Array of matched filenames, or [token] if no matches
 */
export async function expandGlobs(token, fs, cwd) {
  if (!token || !fs) return [token];

  // Handle brace expansion first — expand {a,b} into multiple patterns
  if (token.includes('{')) {
    const braceExpanded = expandBraces(token);
    if (braceExpanded.length > 1) {
      const allMatches = [];
      for (const pattern of braceExpanded) {
        const matches = await expandGlobs(pattern, fs, cwd);
        allMatches.push(...matches);
      }
      // Deduplicate and sort
      const unique = [...new Set(allMatches)];
      return unique.length > 0 ? unique.sort() : [token];
    }
  }

  // Check if token contains glob characters
  if (!/[*?\[!]/.test(token)) return [token];

  // Handle ** recursive glob
  if (token.includes('**')) {
    return expandRecursiveGlob(token, fs, cwd);
  }

  // Handle !(pattern) negation — extglob
  if (/!\(/.test(token)) {
    return expandNegationGlob(token, fs, cwd);
  }

  // Convert glob pattern to regex
  let regexStr = '^';
  let i = 0;
  const len = token.length;

  while (i < len) {
    const ch = token[i];
    if (ch === '*') {
      regexStr += '[^/]*';
      i++;
    } else if (ch === '?') {
      regexStr += '[^/]';
      i++;
    } else if (ch === '[') {
      // Character class — find closing ]
      const close = token.indexOf(']', i + 1);
      if (close !== -1) {
        regexStr += token.slice(i, close + 1);
        i = close + 1;
      } else {
        // No closing bracket — treat as literal
        regexStr += '\\[';
        i++;
      }
    } else {
      // Escape regex special characters
      regexStr += ch.replace(/[.+^${}()|\\]/g, '\\$&');
      i++;
    }
  }
  regexStr += '$';

  let regex;
  try {
    regex = new RegExp(regexStr);
  } catch {
    return [token];
  }

  try {
    const entries = await fs.listDir(cwd || '/');
    const matches = entries
      .map(e => e.name)
      .filter(name => regex.test(name))
      .sort();

    return matches.length > 0 ? matches : [token];
  } catch {
    return [token];
  }
}

/**
 * Expand ** recursive glob pattern.
 * Traverses directory tree and matches files against the pattern.
 */
async function expandRecursiveGlob(pattern, fs, cwd) {
  const parts = pattern.split('/');
  const results = [];

  async function walk(dir, partIndex) {
    if (partIndex >= parts.length) return;

    const part = parts[partIndex];
    const isLast = partIndex === parts.length - 1;

    try {
      const entries = await fs.listDir(dir);

      if (part === '**') {
        // Match zero or more directories
        // Try matching remaining pattern parts at this level
        for (const entry of entries) {
          const fullPath = dir === '/' ? '/' + entry.name : dir + '/' + entry.name;
          const relPath = fullPath.startsWith(cwd + '/') ? fullPath.slice(cwd.length + 1) : entry.name;

          if (isLast) {
            // ** at end matches everything
            results.push(relPath);
          } else {
            // Try matching next part against this entry
            const nextPart = parts[partIndex + 1];
            if (simpleGlobMatch(nextPart, entry.name)) {
              if (partIndex + 1 === parts.length - 1) {
                results.push(relPath);
              } else if (entry.isDirectory) {
                await walk(fullPath, partIndex + 2);
              }
            }
          }

          // Recurse into subdirectories (** keeps matching)
          if (entry.isDirectory) {
            await walk(fullPath, partIndex);
          }
        }
      } else {
        for (const entry of entries) {
          if (simpleGlobMatch(part, entry.name)) {
            const fullPath = dir === '/' ? '/' + entry.name : dir + '/' + entry.name;
            const relPath = fullPath.startsWith(cwd + '/') ? fullPath.slice(cwd.length + 1) : entry.name;

            if (isLast) {
              results.push(relPath);
            } else if (entry.isDirectory) {
              await walk(fullPath, partIndex + 1);
            }
          }
        }
      }
    } catch {
      // Directory not accessible
    }
  }

  await walk(cwd || '/', 0);
  return results.length > 0 ? results.sort() : [pattern];
}

/**
 * Simple glob match for a single filename segment (* and ?).
 */
function simpleGlobMatch(pattern, name) {
  let regexStr = '^';
  for (let i = 0; i < pattern.length; i++) {
    if (pattern[i] === '*') regexStr += '[^/]*';
    else if (pattern[i] === '?') regexStr += '[^/]';
    else regexStr += pattern[i].replace(/[.+^${}()|\\[\]]/g, '\\$&');
  }
  regexStr += '$';
  try {
    return new RegExp(regexStr).test(name);
  } catch {
    return false;
  }
}

/**
 * Expand !(pattern) negation glob.
 * Matches files that do NOT match the inner pattern.
 */
async function expandNegationGlob(token, fs, cwd) {
  // Parse !(pattern) — extract the negation part and any surrounding text
  const match = token.match(/^(.*)!\(([^)]+)\)(.*)$/);
  if (!match) return [token];

  const [, prefix, negPattern, suffix] = match;
  const positiveGlob = prefix + '*' + suffix;

  try {
    const entries = await fs.listDir(cwd || '/');
    const negRegex = new RegExp('^' + negPattern.replace(/\*/g, '.*').replace(/\?/g, '.') + '$');
    const suffixRegex = suffix ? new RegExp(suffix.replace(/[.+^${}()|\\[\]]/g, '\\$&') + '$') : null;

    const matches = entries
      .map(e => e.name)
      .filter(name => {
        // Must match the overall pattern (prefix + something + suffix)
        if (prefix && !name.startsWith(prefix)) return false;
        if (suffix && !name.endsWith(suffix)) return false;

        // The part between prefix and suffix must NOT match the negation
        const middle = name.slice(prefix.length, suffix ? name.length - suffix.length : undefined);
        return !negRegex.test(middle);
      })
      .sort();

    return matches.length > 0 ? matches : [token];
  } catch {
    return [token];
  }
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
    /** @type {Map<string, string>} Shell aliases (name → expanded command) */
    this.aliases = new Map();
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
   * Register a command handler with optional metadata.
   * @param {string} name
   * @param {Function} handler - async ({ args, stdin, state, registry, fs }) → { stdout, stderr, exitCode }
   * @param {object} [meta] - { description, category, usage, flags? }
   */
  register(name, handler, meta) {
    this.#commands.set(name, { handler, meta: meta || {} });
  }

  /** @returns {Function|null} */
  get(name) {
    const entry = this.#commands.get(name);
    return entry ? entry.handler : null;
  }

  /**
   * Unregister a command.
   * @param {string} name
   * @returns {boolean} True if command existed
   */
  unregister(name) {
    return this.#commands.delete(name);
  }

  /** @returns {boolean} */
  has(name) {
    return this.#commands.has(name);
  }

  /** @returns {string[]} */
  names() {
    return [...this.#commands.keys()];
  }

  /** @returns {object|null} metadata for a command, or null if not found */
  getMeta(name) {
    const entry = this.#commands.get(name);
    return entry ? entry.meta : null;
  }

  /** @returns {Array<{name: string, description?: string, category?: string, usage?: string, flags?: object}>} */
  allEntries() {
    const result = [];
    for (const [name, { meta }] of this.#commands) {
      result.push({ name, ...meta });
    }
    return result;
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
  // Alias expansion: if the command name is an alias, re-parse and execute the expanded form
  if (state.aliases?.has(node.name)) {
    const expanded = state.aliases.get(node.name) + (node.args.length > 0 ? ' ' + node.args.join(' ') : '');
    const expandedAst = parse(expanded);
    if (expandedAst) return execute(expandedAst, state, registry, opts);
    return { stdout: '', stderr: '', exitCode: 0 };
  }

  // Bare variable assignment: VAR=VALUE (no args, no command lookup)
  const eqIdx = node.name.indexOf('=');
  if (eqIdx > 0 && node.args.length === 0 && /^[A-Za-z_][A-Za-z0-9_]*$/.test(node.name.slice(0, eqIdx))) {
    const varName = node.name.slice(0, eqIdx);
    const varValue = node.name.slice(eqIdx + 1);
    if (!(state.env instanceof Map)) state.env = new Map();
    state.env.set(varName, expandVariables(varValue, state.env));
    state.lastExitCode = 0;
    return { stdout: '', stderr: '', exitCode: 0 };
  }

  // Variable expansion: expand $VAR, ${VAR}, $? in command name and args
  const envObj = state.env instanceof Map ? state.env : new Map();
  envObj.set('?', String(state.lastExitCode));
  const expandedName = expandVariables(node.name, envObj);
  let expandedArgs = node.args.map(a => expandVariables(a, envObj));

  // Glob expansion: expand *, ?, [abc] patterns in args
  if (opts.fs) {
    const globExpanded = [];
    for (const arg of expandedArgs) {
      const matches = await expandGlobs(arg, opts.fs, state.cwd);
      globExpanded.push(...matches);
    }
    expandedArgs = globExpanded;
  }

  const handler = registry.get(expandedName);
  if (!handler) {
    state.lastExitCode = 127;
    return { stdout: '', stderr: `command not found: ${expandedName}`, exitCode: 127 };
  }

  try {
    const result = await handler({
      args: expandedArgs,
      stdin: opts.stdin || '',
      state,
      registry,
      fs: opts.fs,
    });
    const exitCode = result.exitCode ?? 0;
    state.lastExitCode = exitCode;
    return {
      ...result,
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
  if (node.redirect) {
    const redir = node.redirect;

    // Handle stderr redirect first
    if (redir.stderr) {
      const stderrRedir = redir.stderr;
      if (stderrRedir.type === 'err_to_out') {
        // 2>&1 — merge stderr into stdout
        lastResult = {
          ...lastResult,
          stdout: lastResult.stdout + lastResult.stderr,
          stderr: '',
        };
      } else if (opts.fs && (stderrRedir.type === 'err_write' || stderrRedir.type === 'err_append')) {
        const errPath = state.resolvePath(stderrRedir.path);
        try {
          if (stderrRedir.path === '/dev/null') {
            // 2>/dev/null — suppress stderr
            lastResult = { ...lastResult, stderr: '' };
          } else if (stderrRedir.type === 'err_append') {
            let existing = '';
            try { existing = await opts.fs.readFile(errPath); } catch { /* file doesn't exist yet */ }
            await opts.fs.writeFile(errPath, existing + lastResult.stderr);
            lastResult = { ...lastResult, stderr: '' };
          } else {
            await opts.fs.writeFile(errPath, lastResult.stderr);
            lastResult = { ...lastResult, stderr: '' };
          }
        } catch (e) {
          return { stdout: '', stderr: `redirect: ${e.message}`, exitCode: 1 };
        }
      } else if (!opts.fs && stderrRedir.path === '/dev/null') {
        // 2>/dev/null works even without a real filesystem
        lastResult = { ...lastResult, stderr: '' };
      }
    }

    // Handle stdout redirect
    if (redir.type && redir.type !== null && opts.fs) {
      const path = state.resolvePath(redir.path);
      try {
        if (redir.type === 'append') {
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
  }, { description: 'Print arguments to stdout', category: 'Generators', usage: 'echo [STRING...]' });

  // ── true / false ──
  registry.register('true', () => ({ stdout: '', stderr: '', exitCode: 0 }),
    { description: 'Return success (exit 0)', category: 'Shell', usage: 'true' });
  registry.register('false', () => ({ stdout: '', stderr: '', exitCode: 1 }),
    { description: 'Return failure (exit 1)', category: 'Shell', usage: 'false' });

  // ── pwd ──
  registry.register('pwd', ({ state }) => {
    return { stdout: state.cwd + '\n', stderr: '', exitCode: 0 };
  }, { description: 'Print current working directory', category: 'Shell', usage: 'pwd' });

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
  }, { description: 'Change current directory', category: 'Shell', usage: 'cd [DIR]' });

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
  }, { description: 'List directory contents', category: 'File Operations', usage: 'ls [-l] [PATH]', flags: { '-l': 'Long format' } });

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
  }, { description: 'Concatenate and print files', category: 'File Operations', usage: 'cat [FILE...]' });

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
  }, { description: 'Create directories', category: 'File Operations', usage: 'mkdir [-p] DIR...' });

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
  }, { description: 'Remove files or directories', category: 'File Operations', usage: 'rm [-r] FILE...', flags: { '-r': 'Recursive' } });

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
  }, { description: 'Copy files', category: 'File Operations', usage: 'cp SRC DST' });

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
  }, { description: 'Move or rename files', category: 'File Operations', usage: 'mv SRC DST' });

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
  }, { description: 'Output first lines of stdin', category: 'Text Processing', usage: 'head [-n N]', flags: { '-n': 'Number of lines' } });

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
  }, { description: 'Output last lines of stdin', category: 'Text Processing', usage: 'tail [-n N]', flags: { '-n': 'Number of lines' } });

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
  }, { description: 'Search stdin for pattern matches', category: 'Text Processing', usage: 'grep [-ivc] PATTERN', flags: { '-i': 'Case insensitive', '-v': 'Invert match', '-c': 'Count only' } });

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
  }, { description: 'Count lines, words, and characters', category: 'Text Processing', usage: 'wc [-lwc]', flags: { '-l': 'Lines only', '-w': 'Words only', '-c': 'Chars only' } });

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
  }, { description: 'Sort lines of stdin', category: 'Text Processing', usage: 'sort [-rnu]', flags: { '-r': 'Reverse', '-n': 'Numeric', '-u': 'Unique' } });

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
  }, { description: 'Filter adjacent duplicate lines', category: 'Text Processing', usage: 'uniq [-c]', flags: { '-c': 'Prefix count' } });

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
  }, { description: 'Write stdin to files and stdout', category: 'File Operations', usage: 'tee [-a] FILE...', flags: { '-a': 'Append' } });

  // ── env ──
  registry.register('env', ({ state }) => {
    const lines = [];
    for (const [k, v] of state.env) {
      lines.push(`${k}=${v}`);
    }
    return { stdout: lines.join('\n') + (lines.length > 0 ? '\n' : ''), stderr: '', exitCode: 0 };
  }, { description: 'Print environment variables', category: 'Shell', usage: 'env' });

  // ── export ──
  registry.register('export', ({ args, state }) => {
    for (const arg of args) {
      const eq = arg.indexOf('=');
      if (eq > 0) {
        state.env.set(arg.slice(0, eq), arg.slice(eq + 1));
      }
    }
    return { stdout: '', stderr: '', exitCode: 0 };
  }, { description: 'Set environment variables', category: 'Shell', usage: 'export KEY=VALUE...' });

  // ── which ──
  registry.register('which', ({ args, registry }) => {
    if (args.length === 0) return { stdout: '', stderr: 'which: missing argument', exitCode: 1 };
    const name = args[0];
    if (registry.has(name)) {
      return { stdout: `${name}: shell built-in\n`, stderr: '', exitCode: 0 };
    }
    return { stdout: '', stderr: `${name} not found`, exitCode: 1 };
  }, { description: 'Show command location', category: 'Shell', usage: 'which COMMAND' });

  // ── help ──
  registry.register('help', ({ args, registry }) => {
    // help NAME — show specific command details
    if (args.length > 0) {
      const name = args[0];
      if (!registry.has(name)) {
        return { stdout: '', stderr: `help: no such command: ${name}`, exitCode: 1 };
      }
      const meta = registry.getMeta(name) || {};
      const lines = [name];
      if (meta.description) lines.push(`  ${meta.description}`);
      if (meta.usage) lines.push(`\n  Usage: ${meta.usage}`);
      if (meta.flags) {
        lines.push('\n  Flags:');
        for (const [flag, desc] of Object.entries(meta.flags)) {
          lines.push(`    ${flag.padEnd(16)}${desc}`);
        }
      }
      return { stdout: lines.join('\n') + '\n', stderr: '', exitCode: 0 };
    }

    // help (no args) — grouped by category
    const entries = registry.allEntries();
    const groups = new Map();
    for (const entry of entries) {
      const cat = entry.category || 'Other';
      if (!groups.has(cat)) groups.set(cat, []);
      groups.get(cat).push(entry);
    }

    const sortedGroups = [...groups.entries()].sort((a, b) => a[0].localeCompare(b[0]));
    const lines = [];
    for (const [category, cmds] of sortedGroups) {
      lines.push(`\n${category}:`);
      cmds.sort((a, b) => a.name.localeCompare(b.name));
      for (const cmd of cmds) {
        const desc = cmd.description ? ` — ${cmd.description}` : '';
        lines.push(`  ${cmd.name.padEnd(16)}${desc}`);
      }
    }
    return { stdout: lines.join('\n') + '\n', stderr: '', exitCode: 0 };
  }, { description: 'Show help for commands', category: 'Shell', usage: 'help [COMMAND]' });
}

// ── ClawserShell (main API) ─────────────────────────────────────

export class ClawserShell {
  /** @type {ShellState} */
  state;
  /** @type {CommandRegistry} */
  registry;
  /** @type {ShellFs|MemoryFs|null} */
  fs;
  /** @type {Map<number, {id: number, command: string, promise: Promise, status: string, result: object|null}>} */
  #jobTable = new Map();
  /** @type {number} */
  #nextJobId = 1;

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
      registerExtendedBuiltins(this.registry);
      registerJqBuiltin(this.registry);
    }

    // Register job-related builtins
    this.#registerJobBuiltins();
  }

  /** @type {Map<string, {name: string, commands: object}>} */
  #packages = new Map();

  /**
   * Install a CLI package that registers commands.
   * @param {object} pkg
   * @param {string} pkg.name - Package name
   * @param {object} pkg.commands - Map of command name → async handler
   */
  installPackage(pkg) {
    if (!pkg || !pkg.name) throw new Error('Package must have a name');
    if (!pkg.commands || typeof pkg.commands !== 'object') throw new Error('Package must have commands');
    this.#packages.set(pkg.name, pkg);
    for (const [cmdName, handler] of Object.entries(pkg.commands)) {
      this.registry.register(cmdName, async (ctx) => {
        return handler(ctx.args || ctx);
      }, { description: `From package ${pkg.name}`, category: 'Package' });
    }
  }

  /**
   * Uninstall a CLI package and remove its commands.
   * @param {string} name - Package name
   */
  uninstallPackage(name) {
    const pkg = this.#packages.get(name);
    if (!pkg) return;
    for (const cmdName of Object.keys(pkg.commands)) {
      this.registry.unregister(cmdName);
    }
    this.#packages.delete(name);
  }

  /**
   * List installed packages.
   * @returns {Array<{name: string, commands: string[]}>}
   */
  listPackages() {
    return [...this.#packages.values()].map(p => ({
      name: p.name,
      commands: Object.keys(p.commands),
    }));
  }

  /** List background jobs. */
  jobs() {
    return [...this.#jobTable.values()].map(j => ({
      id: j.id, command: j.command, status: j.status,
    }));
  }

  #registerJobBuiltins() {
    this.registry.register('jobs', async () => {
      const list = this.jobs();
      if (list.length === 0) {
        return { stdout: 'No active jobs', stderr: '', exitCode: 0 };
      }
      const lines = list.map(j => `[${j.id}] ${j.status.padEnd(8)} ${j.command}`);
      return { stdout: lines.join('\n'), stderr: '', exitCode: 0 };
    }, { description: 'List background jobs', category: 'Process', usage: 'jobs' });

    this.registry.register('fg', async (args) => {
      // Find the most recent running job, or by ID
      let job;
      if (args.length > 0) {
        const id = parseInt(args[0].replace('%', ''), 10);
        job = this.#jobTable.get(id);
      } else {
        // Most recent running job
        for (const j of this.#jobTable.values()) {
          if (j.status === 'running') job = j;
        }
      }
      if (!job) {
        return { stdout: '', stderr: 'fg: no current job', exitCode: 1 };
      }
      // Wait for the job to complete
      const result = await job.promise;
      job.status = 'done';
      job.result = result;
      this.#jobTable.delete(job.id);
      return result;
    }, { description: 'Bring a background job to foreground', category: 'Process', usage: 'fg [%job_id]' });
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

    // Handle background execution
    if (ast && ast.background) {
      const jobId = this.#nextJobId++;
      const bgAst = { ...ast };
      delete bgAst.background;
      const promise = execute(bgAst, this.state, this.registry, { fs: this.fs });
      const job = { id: jobId, command: command.replace(/\s*&\s*$/, ''), promise, status: 'running', result: null };
      this.#jobTable.set(jobId, job);
      promise.then(result => {
        job.status = 'done';
        job.result = result;
      }).catch(() => {
        job.status = 'failed';
      });
      return { stdout: `[${jobId}] started`, stderr: '', exitCode: 0, jobId };
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
      // Join continuation lines (trailing backslash)
      const joined = content.replace(/\\\n/g, '');
      const lines = joined.split('\n').filter(l => l.trim() && !l.trim().startsWith('#'));
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

  get name() { return 'browser_shell'; }
  get description() {
    return 'Execute shell commands in a virtual browser shell. Supports pipes (|), redirects (>, >>), stderr redirects (2>, 2>>, 2>&1, 2>/dev/null), logical operators (&&, ||), and semicolons (;). Built-in commands include: cd, ls, pwd, cat, mkdir, rm, cp, mv, echo, head, tail, grep, wc, sort, uniq, tee, env, export, which, help. All filesystem commands operate on the workspace OPFS.';
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
  get permission() { return 'approve'; }

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
