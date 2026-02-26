/**
 * Code block extraction from LLM text output.
 * Extracted from clawser-codex.js for reuse in ai.matey middleware.
 */

/**
 * Extract fenced code blocks from LLM text output.
 * Matches any fenced code block: ```js, ```tool_code, ```python, bare ```, etc.
 *
 * @param {string} text - LLM response text
 * @returns {Array<{lang: string, code: string}>}
 */
export function extractCodeBlocks(text) {
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
 *
 * @param {string} text - LLM response text
 * @returns {string}
 */
export function stripCodeBlocks(text) {
  return text.replace(/```\w*\s*\n[\s\S]*?```/g, '').trim();
}
