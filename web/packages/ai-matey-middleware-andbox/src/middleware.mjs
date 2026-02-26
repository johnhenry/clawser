/**
 * ai.matey middleware for code-based tool execution via andbox.
 *
 * Intercepts LLM responses, extracts code blocks, adapts them,
 * executes via sandbox with tools as capabilities, and attaches results.
 */

import { extractCodeBlocks, stripCodeBlocks } from './code-extractor.mjs';
import { adaptPythonisms, autoAwait } from './code-adapter.mjs';
import { toolsToCapabilities, toolsToPreamble } from './tool-injector.mjs';
import { formatResults, resultsToToolCalls } from './result-formatter.mjs';

/**
 * @typedef {Object} CodeExecutionMiddlewareOptions
 * @property {import('andbox').createSandbox} sandbox - andbox sandbox instance
 * @property {Array<{name: string, description?: string, parameters?: object}>} tools - Tool definitions
 * @property {(name: string, params: object) => Promise<any>} executeToolFn - Tool execution function
 * @property {number} [maxResultLength=4096] - Max characters per result
 * @property {string[]} [codeLanguages] - Code block languages to execute
 * @property {number} [timeoutMs=30000] - Execution timeout
 */

/**
 * Create an ai.matey middleware for code-based tool execution.
 *
 * The middleware intercepts LLM responses (in the `after` phase) and:
 * 1. Extracts fenced code blocks
 * 2. Adapts Python-isms and auto-inserts await
 * 3. Executes each block in the sandbox with tool stubs
 * 4. Attaches results as `_codeResults` and `_toolCalls` on the response
 *
 * @param {CodeExecutionMiddlewareOptions} options
 * @returns {{ before?: Function, after: Function }}
 */
export function createCodeExecutionMiddleware(options) {
  const {
    sandbox,
    tools,
    executeToolFn,
    maxResultLength = 4096,
    codeLanguages = ['js', 'javascript', 'tool_code', 'python', 'py', ''],
    timeoutMs = 30_000,
  } = options;

  const langSet = new Set(codeLanguages.map(l => l.toLowerCase()));
  const preamble = toolsToPreamble(tools);

  return {
    /**
     * After-phase: intercept LLM response, execute code blocks.
     */
    async after(response) {
      const content = response?.content || response?.text || '';
      if (!content) return response;

      const blocks = extractCodeBlocks(content);
      const executableBlocks = blocks.filter(b => langSet.has(b.lang));

      if (executableBlocks.length === 0) return response;

      const results = [];

      for (const { lang, code: rawCode } of executableBlocks) {
        let code = rawCode;

        // Adapt Python-ish code
        if (lang === 'python' || lang === 'py' || lang === 'tool_code') {
          code = adaptPythonisms(code);
        }
        code = autoAwait(code);

        // Prepend tool stubs
        const fullCode = preamble + '\n' + code;

        // Collect console output
        const consoleOutput = [];

        try {
          const returnValue = await sandbox.evaluate(fullCode, {
            timeoutMs,
            onConsole: (_level, ...args) => { consoleOutput.push(args.join(' ')); },
          });

          let output = consoleOutput.join('\n');
          if (!output && returnValue !== undefined) {
            output = typeof returnValue === 'string'
              ? returnValue
              : JSON.stringify(returnValue, null, 2);
          }

          results.push({ code: rawCode, output: output || '(no output)' });
        } catch (e) {
          results.push({ code: rawCode, output: '', error: e.message || String(e) });
        }
      }

      // Attach results to response
      const cleanText = stripCodeBlocks(content);
      response._codeResults = results;
      response._toolCalls = resultsToToolCalls(results);
      response._cleanText = cleanText;
      response._resultSummary = formatResults(results, maxResultLength);

      return response;
    },
  };
}
