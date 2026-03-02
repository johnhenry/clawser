// clawser-oauth-wsh.js — OAuth code exchange via wsh shell exec
//
// Exchanges an OAuth authorization code for tokens by shelling out to curl
// through a wsh connection, avoiding browser CORS restrictions on token endpoints.
//
// Usage:
//   const tokens = await exchangeCodeViaWsh(tokenEndpoint, params, wshExec);

/**
 * Build a URL-encoded form body from a plain object.
 * Values are URI-encoded; keys are assumed safe (ASCII identifiers).
 * @param {Record<string, string>} params
 * @returns {string}
 */
function buildFormBody(params) {
  return Object.entries(params)
    .filter(([, v]) => v !== undefined && v !== null)
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join('&');
}

/**
 * Shell-escape a string for safe embedding in single-quoted curl arguments.
 * Replaces ' with '\'' (end quote, escaped quote, start quote).
 * @param {string} s
 * @returns {string}
 */
function shellEscape(s) {
  return s.replace(/'/g, "'\\''");
}

/**
 * Exchange an OAuth authorization code for tokens via wsh shell exec (curl).
 *
 * @param {string} tokenEndpoint - Full URL of the OAuth token endpoint
 * @param {Record<string, string>} params - POST parameters (grant_type, code, client_id, etc.)
 * @param {(cmd: string) => Promise<string>} wshExec - wsh shell exec function
 * @returns {Promise<object>} Parsed token response
 * @throws {Error} If wshExec is not a function, response is not JSON, or provider returns error
 */
export async function exchangeCodeViaWsh(tokenEndpoint, params, wshExec) {
  if (typeof wshExec !== 'function') {
    throw new Error('wshExec must be a function');
  }

  const body = buildFormBody(params);
  const escapedUrl = shellEscape(tokenEndpoint);
  const escapedBody = shellEscape(body);

  const cmd = `curl -s -X POST '${escapedUrl}' -H 'Content-Type: application/x-www-form-urlencoded' -d '${escapedBody}'`;

  const raw = await wshExec(cmd);

  let data;
  try {
    data = JSON.parse(raw);
  } catch {
    throw new Error(`Failed to parse token response: ${raw.slice(0, 200)}`);
  }

  if (data.error) {
    const desc = data.error_description ? `: ${data.error_description}` : '';
    throw new Error(`${data.error}${desc}`);
  }

  return data;
}
