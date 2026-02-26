/**
 * Code adaptation utilities for LLM-generated code.
 * Extracted from clawser-codex.js for reuse in ai.matey middleware.
 */

/**
 * Light Python-to-JS transform for common patterns.
 * Handles the most frequent mismatches from models that think in Python.
 *
 * @param {string} code
 * @returns {string}
 */
export function adaptPythonisms(code) {
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
 * Handles: print(...), browser_*(...), and custom function names.
 * Only adds await if not already preceded by await.
 *
 * @param {string} code
 * @param {string[]} [asyncFnPatterns] - Additional function name patterns to auto-await
 * @returns {string}
 */
export function autoAwait(code, asyncFnPatterns = []) {
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

  // Auto-await additional patterns
  for (const pattern of asyncFnPatterns) {
    const re = new RegExp(`(?<!\\bawait\\s+)(\\b${pattern}\\s*\\()`, 'g');
    code = code.replace(re, (match, p1, offset) => {
      if (inString(offset)) return match;
      return 'await ' + p1;
    });
  }

  return code;
}
