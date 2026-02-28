/**
 * Clawser Codex — Code-based tool execution via andbox
 *
 * Instead of parsing structured tool calls, this module lets LLMs write
 * code that calls tool functions directly. The code runs in andbox's
 * isolated Worker sandbox with browser tools injected as capabilities.
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

import { createSandbox } from './packages-andbox.js';

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
  // Skip matches inside string literals (single, double, backtick)
  const stringPattern = /(['"`])(?:(?!\1|\\).|\\.)*\1/g;
  const stringRanges = [];
  let m;
  while ((m = stringPattern.exec(code)) !== null) {
    stringRanges.push([m.index, m.index + m[0].length]);
  }
  function inString(idx) {
    return stringRanges.some(([s, e]) => idx >= s && idx < e);
  }

  // await before print() calls — skip if inside string
  code = code.replace(/(?<!\bawait\s+)(\bprint\s*\()/g, (match, p1, offset) => {
    if (inString(offset)) return match;
    return 'await ' + p1;
  });
  // await before browser_* tool calls at statement level
  code = code.replace(/(^|;\s*)(?!await\s)(browser_\w+\s*\()/gm, (match, p1, p2, offset) => {
    if (inString(offset)) return match;
    return p1 + 'await ' + p2;
  });
  return code;
}

export class Codex {
  // Long timeout: user approval dialogs can add arbitrary time to tool calls
  static #EXEC_TIMEOUT_MS = 300_000;

  #seq = 0;
  /** @type {import('./clawser-tools.js').BrowserToolRegistry} */
  #tools;
  /** @type {Function} */
  #onLog;
  /** @type {import('./packages-andbox.js').createSandbox|null} */
  #sandbox = null;
  /** @type {boolean} */
  #sandboxInitializing = false;

  constructor(browserTools, opts = {}) {
    this.#tools = browserTools;
    this.#onLog = opts.onLog || (() => {});
  }

  /**
   * Build capability functions from browser tools for the andbox sandbox.
   * Each tool becomes a callable capability via host.call('tool_name', params).
   */
  #buildCapabilities() {
    const caps = {};
    const tools = this.#tools;

    // Expose each browser tool as a capability
    for (const name of tools.names()) {
      caps[name] = async (params = {}) => {
        const result = await tools.execute(name, params);
        if (!result.success) {
          return { _error: true, message: result.error || `${name} failed` };
        }
        try { return JSON.parse(result.output); }
        catch { return result.output; }
      };
    }

    // print capability — async-aware: auto-awaits promises before returning output
    caps._print = async (...args) => {
      const resolved = [];
      for (const arg of args) {
        if (arg && typeof arg === 'object' && typeof arg.then === 'function') {
          resolved.push(await arg);
        } else {
          resolved.push(arg);
        }
      }
      const formatted = resolved.map(v =>
        typeof v === 'object' && v !== null ? JSON.stringify(v, null, 2) : String(v)
      );
      return formatted.join(' ');
    };

    // Fetch routed through FetchTool to enforce domain allowlist
    caps._fetch = async (url, init) => {
      const result = await this.#tools.execute('browser_fetch', {
        url, method: init?.method || 'GET', headers: init?.headers, body: init?.body
      });
      if (!result.success) throw new Error(result.error || 'Fetch failed');
      return result.output;
    };

    return caps;
  }

  /**
   * Ensure the sandbox is created and ready.
   */
  async #ensureSandbox() {
    if (this.#sandbox && !this.#sandbox.isDisposed()) return this.#sandbox;
    if (this.#sandboxInitializing) {
      // Wait for initialization
      while (this.#sandboxInitializing) {
        await new Promise(r => setTimeout(r, 10));
      }
      return this.#sandbox;
    }

    this.#sandboxInitializing = true;
    try {
      const caps = this.#buildCapabilities();
      this.#sandbox = await createSandbox({
        capabilities: caps,
        defaultTimeoutMs: Codex.#EXEC_TIMEOUT_MS,
      });
      return this.#sandbox;
    } finally {
      this.#sandboxInitializing = false;
    }
  }

  /**
   * Build the wrapper code that injects tool functions and print() into the
   * sandbox evaluation scope. Tools are called via host.call() RPC.
   */
  #wrapCode(code) {
    const tools = this.#tools;
    const lines = [];

    // Inject each tool as a local async function that calls host.call()
    for (const name of tools.names()) {
      lines.push(`async function ${name}(params) { return await host.call('${name}', params || {}); }`);
    }

    // Short aliases: browser_fetch → fetch, browser_fs_read → fsRead, etc.
    for (const name of tools.names()) {
      if (name.startsWith('browser_')) {
        const short = name.slice(8).replace(/_([a-z])/g, (_, c) => c.toUpperCase());
        // Don't shadow fetch with browser_fetch alias
        if (short !== 'fetch') {
          lines.push(`const ${short} = ${name};`);
        }
      }
    }

    // Inject print() that calls host._print capability
    lines.push(`async function print(...args) {
  const resolved = [];
  for (const a of args) {
    if (a && typeof a === 'object' && typeof a.then === 'function') resolved.push(await a);
    else resolved.push(a);
  }
  const msg = resolved.map(v => typeof v === 'object' && v !== null ? JSON.stringify(v, null, 2) : String(v)).join(' ');
  console.log(msg);
  return msg;
}`);

    // Inject fetch via host._fetch capability
    lines.push(`async function fetch(url, init) { return await host.call('_fetch', url, init); }`);

    lines.push('');
    lines.push(code);

    return lines.join('\n');
  }

  /**
   * Execute an LLM response by extracting and running its code blocks.
   *
   * Processing pipeline for each code block:
   * 1. Code block extraction via extractCodeBlocks()
   * 2. Python normalization via adaptPythonisms()
   * 3. autoAwait() inserts missing await keywords
   * 4. andbox execution via sandbox.evaluate() with tools as host capabilities
   * 5. Results collected as synthetic _codex_eval tool calls
   *
   * @param {string} llmResponse - Raw LLM output text that may contain fenced code blocks.
   * @returns {Promise<{text: string, results: Array, toolCalls: Array}>}
   */
  async execute(llmResponse) {
    const blocks = extractCodeBlocks(llmResponse);
    const text = stripCodeBlocks(llmResponse);
    const results = [];
    const toolCalls = [];

    if (blocks.length === 0) {
      return { text: llmResponse, results, toolCalls };
    }

    const sandbox = await this.#ensureSandbox();

    for (const { lang, code: rawCode } of blocks) {
      // Adapt code for safe async execution
      let code = rawCode;
      if (lang === 'python' || lang === 'py' || lang === 'tool_code') {
        code = adaptPythonisms(code);
      }
      code = autoAwait(code);

      // Wrap with tool injections
      const wrappedCode = this.#wrapCode(code);

      // Per-block console output collector
      const consoleOutput = [];

      try {
        this.#onLog(2, `codex: executing ${lang || 'code'} block (${code.length} chars)`);

        const returnValue = await sandbox.evaluate(wrappedCode, {
          timeoutMs: Codex.#EXEC_TIMEOUT_MS,
          onConsole: (_level, ...args) => { consoleOutput.push(args.join(' ')); },
        });

        let output = consoleOutput.join('\n');
        if (!output && returnValue !== undefined) {
          output = typeof returnValue === 'string'
            ? returnValue
            : JSON.stringify(returnValue, null, 2);
        }

        results.push({ code: rawCode, output: output || '(no output)' });
        toolCalls.push({
          id: `codex_${Date.now()}_${++this.#seq}`,
          name: '_codex_eval',
          arguments: JSON.stringify({ code: rawCode }),
          _result: { success: true, output: output || '(executed successfully)' },
        });
      } catch (e) {
        const errMsg = e.message || String(e);
        this.#onLog(3, `codex: execution error: ${errMsg}`);
        results.push({ code: rawCode, output: '', error: errMsg });
        toolCalls.push({
          id: `codex_${Date.now()}_${++this.#seq}`,
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

  /** Access the underlying andbox sandbox instance. */
  get _sandbox() { return this.#sandbox; }

  /**
   * Dispose the underlying sandbox.
   */
  async dispose() {
    if (this.#sandbox && !this.#sandbox.isDisposed()) {
      await this.#sandbox.dispose();
    }
    this.#sandbox = null;
  }
}

export { extractCodeBlocks, stripCodeBlocks, adaptPythonisms, autoAwait };
