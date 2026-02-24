/**
 * Clawser Codex — Code-based tool execution via vimble
 *
 * Instead of parsing structured tool calls, this module lets LLMs write
 * code that calls tool functions directly. The code runs in vimble's
 * isolated context with browser tools injected.
 *
 * Handles multiple LLM output formats:
 *   - ```js or ```javascript blocks (standard markdown)
 *   - ```tool_code blocks (Chrome AI / Gemini Nano)
 *   - ```python-ish blocks (auto-adapted to JS)
 *   - Any other fenced code block
 *
 * Key adaptations for small models:
 *   - print() is injected as an async-aware console.log that auto-awaits promises
 *   - Tool functions work with or without await
 *   - Python dict syntax {key: value} works in JS
 */

import { run, InjectedConsole } from 'https://ga.jspm.io/npm:vimble@0.0.1/src/index.mjs';

let _codexSeq = 0;

/**
 * Extract fenced code blocks from LLM text output.
 * Matches any fenced code block: ```js, ```tool_code, ```python, bare ```, etc.
 */
function extractCodeBlocks(text) {
  const regex = /```(\w*)\s*\n([\s\S]*?)```/g;
  const blocks = [];
  let match;
  while ((match = regex.exec(text)) !== null) {
    const lang = match[1].toLowerCase();
    const code = match[2].trim();
    if (code) blocks.push({ lang, code });
  }
  return blocks;
}

/**
 * Remove all fenced code blocks from text, leaving conversational content.
 */
function stripCodeBlocks(text) {
  return text.replace(/```\w*\s*\n[\s\S]*?```/g, '').trim();
}

/**
 * Light Python-to-JS transform for common patterns.
 * Handles the most frequent mismatches from models that think in Python.
 */
function adaptPythonisms(code) {
  let adapted = code;
  // True/False/None → true/false/null
  adapted = adapted.replace(/\bTrue\b/g, 'true');
  adapted = adapted.replace(/\bFalse\b/g, 'false');
  adapted = adapted.replace(/\bNone\b/g, 'null');
  // f"..." or f'...' → template literals (simple cases)
  adapted = adapted.replace(/f"([^"]*?)"/g, '`$1`');
  adapted = adapted.replace(/f'([^']*?)'/g, '`$1`');
  // {variable} inside template literals → ${variable}
  adapted = adapted.replace(/`([^`]*?)\{(\w+)\}([^`]*?)`/g, '`$1${$2}$3`');
  return adapted;
}

/**
 * Auto-insert `await` before async calls that the model forgot to await.
 * Handles: print(...), browser_*(...), and short aliases.
 * Only adds await if not already preceded by await.
 */
function autoAwait(code) {
  // await before print() calls
  code = code.replace(/(?<!\bawait\s+)(\bprint\s*\()/g, 'await $1');
  // await before browser_* tool calls at statement level (not inside print())
  // Match: start of line or after ; then optional whitespace, then browser_xxx(
  code = code.replace(/(^|;\s*)(?!await\s)(browser_\w+\s*\()/gm, '$1await $2');
  return code;
}

export class Codex {
  static #EXEC_TIMEOUT_MS = 30_000;

  /** @type {import('./clawser-tools.js').BrowserToolRegistry} */
  #tools;
  /** @type {Function} */
  #onLog;

  constructor(browserTools, opts = {}) {
    this.#tools = browserTools;
    this.#onLog = opts.onLog || (() => {});
  }

  /**
   * Build the execution context object injected into the vimble sandbox.
   *
   * The returned context provides the following to executing code:
   *
   * - **Tool injection**: Every registered browser tool is exposed as an async
   *   function under its full name (e.g. `browser_fetch`, `browser_fs_read`).
   *   Each function accepts a params object, calls `tools.execute(name, params)`,
   *   throws on failure, and auto-parses JSON output (falling back to raw string).
   *
   * - **Short-alias naming convention**: Tools prefixed with `browser_` also get
   *   a camelCase short alias (e.g. `browser_fs_read` becomes `fsRead`,
   *   `browser_fetch` becomes `fetch`). Short aliases do not overwrite existing
   *   context keys, so the native `fetch` injection takes precedence.
   *
   * - **Native fetch injection**: `globalThis.fetch` is bound and injected as
   *   `ctx.fetch`, giving code blocks direct HTTP access outside the tool system.
   *
   * - **Async `print()` wrapper**: `print(...args)` resolves any Promise arguments
   *   before logging. This lets models write `print(browser_fetch({url}))` without
   *   explicit `await`. Resolved values are pretty-printed (objects as indented
   *   JSON, primitives as strings) and logged to the block's `InjectedConsole`.
   *
   * @param {import('vimble').InjectedConsole} localConsole - Per-block console
   *   instance that captures `print()` output.
   * @returns {object} A plain object mapping function names to async functions,
   *   suitable as the `context` argument to `vimble.run()`.
   */
  #buildContext(localConsole) {
    const ctx = {};
    const tools = this.#tools;

    // Inject each browser tool as an async function
    for (const name of tools.names()) {
      ctx[name] = async (params = {}) => {
        const result = await tools.execute(name, params);
        if (!result.success) {
          return { _error: true, message: result.error || `${name} failed` };
        }
        try { return JSON.parse(result.output); }
        catch { return result.output; }
      };
    }

    // Short aliases: browser_fetch → fetch, browser_fs_read → fsRead, etc.
    for (const name of tools.names()) {
      if (name.startsWith('browser_')) {
        const short = name.slice(8).replace(/_([a-z])/g, (_, c) => c.toUpperCase());
        if (!ctx[short]) ctx[short] = ctx[name];
      }
    }

    // Inject native fetch
    ctx.fetch = fetch.bind(globalThis);

    // print() — async-aware: auto-awaits promises before logging.
    // This handles `print(browser_fetch({url: "..."}))` without explicit await.
    ctx.print = async (...args) => {
      const resolved = [];
      for (const arg of args) {
        if (arg && typeof arg === 'object' && typeof arg.then === 'function') {
          resolved.push(await arg);
        } else {
          resolved.push(arg);
        }
      }
      // Pretty-print objects
      const formatted = resolved.map(v =>
        typeof v === 'object' && v !== null ? JSON.stringify(v, null, 2) : String(v)
      );
      localConsole.log(...formatted);
    };

    return ctx;
  }

  /**
   * Execute an LLM response by extracting and running its code blocks.
   *
   * Processing pipeline for each code block:
   * 1. **Code block extraction**: Uses `extractCodeBlocks()` to find all fenced
   *    code blocks (` ```js `, ` ```tool_code `, ` ```python `, bare ` ``` `, etc.).
   *    The conversational text outside code blocks is separated via `stripCodeBlocks()`.
   * 2. **Python normalization**: Blocks tagged as `python`, `py`, or `tool_code` are
   *    run through `adaptPythonisms()` which converts `True`/`False`/`None` to JS
   *    equivalents and translates f-strings to template literals.
   * 3. **autoAwait**: `autoAwait()` inserts missing `await` keywords before known
   *    async calls (`print()`, `browser_*()`) so models that forget `await` still work.
   * 4. **vimble execution**: Each adapted block is executed in an isolated vimble
   *    sandbox via `run(code, context)`. The context is built by `#buildContext()` and
   *    includes all browser tools as async functions, short aliases, native `fetch`,
   *    and `print()`. Each block gets its own `InjectedConsole` for output capture.
   * 5. **toolCalls collection**: Every executed block produces a synthetic tool call
   *    entry with `name: '_codex_eval'`, the original code as arguments, and the
   *    execution result (success/error + output). These are consumed by
   *    `#executeAndSummarize()` for history injection.
   *
   * If no code blocks are found, returns immediately with the original text and
   * empty `results`/`toolCalls` arrays.
   *
   * @param {string} llmResponse - Raw LLM output text that may contain fenced code blocks.
   * @returns {Promise<{text: string, results: Array<{code: string, output: string, error?: string}>, toolCalls: Array<{id: string, name: string, arguments: string, _result: {success: boolean, output: string, error?: string}}>}>}
   *   - `text`: Conversational content with code blocks stripped.
   *   - `results`: Per-block execution outcomes (output or error).
   *   - `toolCalls`: Synthetic tool call entries for history/event-log injection.
   */
  async execute(llmResponse) {
    const blocks = extractCodeBlocks(llmResponse);
    const text = stripCodeBlocks(llmResponse);
    const results = [];
    const toolCalls = [];

    if (blocks.length === 0) {
      return { text: llmResponse, results, toolCalls };
    }

    for (const { lang, code: rawCode } of blocks) {
      const localConsole = new InjectedConsole();
      const context = {
        ...this.#buildContext(localConsole),
        console: localConsole,
      };

      // Adapt code for safe async execution
      let code = rawCode;
      if (lang === 'python' || lang === 'py' || lang === 'tool_code') {
        code = adaptPythonisms(code);
      }
      code = autoAwait(code);

      try {
        this.#onLog(2, `codex: executing ${lang || 'code'} block (${code.length} chars)`);
        const timeout = new Promise((_, reject) =>
          setTimeout(() => reject(new Error('Code execution timed out after 30s')), Codex.#EXEC_TIMEOUT_MS)
        );
        const returnValue = await Promise.race([run(code, context), timeout]);

        let output = localConsole.result;
        if (!output && returnValue !== undefined) {
          output = typeof returnValue === 'string'
            ? returnValue
            : JSON.stringify(returnValue, null, 2);
        }

        results.push({ code: rawCode, output: output || '(no output)' });
        toolCalls.push({
          id: `codex_${Date.now()}_${++_codexSeq}`,
          name: '_codex_eval',
          arguments: JSON.stringify({ code: rawCode }),
          _result: { success: true, output: output || '(executed successfully)' },
        });
      } catch (e) {
        const errMsg = e.message || String(e);
        this.#onLog(3, `codex: execution error: ${errMsg}`);
        results.push({ code: rawCode, output: '', error: errMsg });
        toolCalls.push({
          id: `codex_${Date.now()}_${++_codexSeq}`,
          name: '_codex_eval',
          arguments: JSON.stringify({ code: rawCode }),
          _result: { success: false, output: '', error: errMsg },
        });
      }
    }

    return { text, results, toolCalls };
  }

  /**
   * Build a system prompt fragment describing available tools.
   * Designed to work with models that output various code formats.
   */
  buildToolPrompt() {
    const tools = this.#tools;
    const lines = [
      'You have browser tools available as JavaScript functions.',
      'To use them, write code in a fenced code block (```js or ```tool_code).',
      'Use print() to output results. print() auto-awaits async results.',
      '',
      'Available functions:',
    ];

    for (const spec of tools.allSpecs()) {
      const params = spec.parameters?.properties || {};
      const short = spec.name.startsWith('browser_')
        ? spec.name.slice(8).replace(/_([a-z])/g, (_, c) => c.toUpperCase())
        : null;
      const names = short ? `${spec.name}() / ${short}()` : `${spec.name}()`;
      lines.push(`- ${names}: ${spec.description || ''}`);
      if (Object.keys(params).length > 0) {
        lines.push(`  Params: { ${Object.entries(params).map(([k, v]) => `${k}: ${v.type || 'string'}`).join(', ')} }`);
      }
    }

    lines.push('');
    lines.push('If a tool fails, it returns { _error: true, message: "..." } instead of throwing.');
    lines.push('Check the _error field to handle failures gracefully.');
    lines.push('');
    lines.push('fetch() is also available for HTTP requests.');
    lines.push('');
    lines.push('Example:');
    lines.push('```tool_code');
    lines.push('print(browser_fetch({url: "https://example.com"}))');
    lines.push('```');

    return lines.join('\n');
  }
}

export { extractCodeBlocks, stripCodeBlocks };
