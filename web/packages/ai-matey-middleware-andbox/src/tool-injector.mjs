/**
 * Convert tool definitions to sandbox capabilities and code preambles.
 */

/**
 * Convert an array of tool definitions into sandbox capabilities.
 * Each tool becomes a capability that calls executeToolFn.
 *
 * @param {Array<{name: string, description?: string, parameters?: object}>} tools
 * @param {(name: string, params: object) => Promise<any>} executeToolFn
 * @returns {Record<string, Function>}
 */
export function toolsToCapabilities(tools, executeToolFn) {
  const caps = {};
  for (const tool of tools) {
    caps[tool.name] = async (params = {}) => {
      return executeToolFn(tool.name, params);
    };
  }
  return caps;
}

/**
 * Generate a code preamble that creates local function stubs for each tool.
 * These stubs call host.call() to route back to the host.
 *
 * @param {Array<{name: string}>} tools
 * @returns {string}
 */
export function toolsToPreamble(tools) {
  const lines = [];
  for (const tool of tools) {
    lines.push(`async function ${tool.name}(params) { return await host.call('${tool.name}', params || {}); }`);
  }

  // Add print() helper
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

  return lines.join('\n');
}
