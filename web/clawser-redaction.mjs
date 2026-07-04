/**
 * clawser-redaction.mjs — eventlog redaction for tool-call arguments.
 *
 * Tool-call arguments persist to the agent's eventlog, which is stored
 * in OPFS and included in workspace exports. Without redaction, an
 * agent that calls e.g. `auth_set_credentials({apiKey: "sk-..."})`
 * would persist the API key in plaintext.
 *
 * Two layers:
 *   1. Per-tool declaration via `BrowserTool.redactedFields` — explicit
 *      list of field names to redact.
 *   2. Regex fallback — any field name matching common secret patterns
 *      (`key`, `token`, `password`, etc.) is auto-redacted regardless
 *      of declaration. Tools that don't declare anything still get
 *      defense-in-depth coverage.
 *
 * Redacted values become `{ redacted: true, kind: <type>, length?: <n> }`
 * — preserves the fact that a value was there for replay/debug, without
 * the actual content.
 */

/**
 * Pattern that flags a field name as containing sensitive data.
 * Case-insensitive. Designed to catch common secret-bearing
 * parameter names without being so broad it false-positives.
 */
export const SECRET_FIELD_RE = /(api[_-]?key|api[_-]?secret|token|password|passphrase|secret|auth(?:orization)?|cookie|bearer|credentials?|private[_-]?key|access[_-]?token|refresh[_-]?token|client[_-]?secret|session[_-]?id)/i;

/**
 * Build a redacted placeholder for a value. Preserves type + length
 * so replay/debug can tell something was there.
 *
 * @param {*} value
 * @returns {object}
 */
export function redactedPlaceholder(value) {
  if (typeof value === 'string') {
    return { redacted: true, kind: 'string', length: value.length };
  }
  if (value instanceof Uint8Array) {
    return { redacted: true, kind: 'bytes', length: value.byteLength };
  }
  if (Array.isArray(value)) {
    return { redacted: true, kind: 'array', length: value.length };
  }
  if (value === null) return { redacted: true, kind: 'null' };
  if (typeof value === 'object') {
    return { redacted: true, kind: 'object', keys: Object.keys(value).length };
  }
  return { redacted: true, kind: typeof value };
}

/**
 * Redact sensitive fields from a tool-call arguments object.
 *
 * @param {*} args                              — typically an object; may be a JSON string
 * @param {string[]} [explicitFields=[]]         — declared by the tool
 * @returns {*}                                 — same shape as input, with sensitive fields replaced
 */
export function redactArgs(args, explicitFields = []) {
  // Strings (JSON pre-parse): try to parse, redact, re-stringify. If it
  // doesn't parse as JSON, return as-is (the agent path passes parsed
  // objects normally; pre-parse strings come from streaming providers).
  if (typeof args === 'string') {
    try {
      const parsed = JSON.parse(args);
      return JSON.stringify(redactArgs(parsed, explicitFields));
    } catch { return args; }
  }
  if (!args || typeof args !== 'object') return args;
  if (Array.isArray(args)) return args.map(v => redactArgs(v, explicitFields));
  // Idempotency: an already-redacted placeholder ({redacted:true,...})
  // passes through unchanged. Without this, re-running redactArgs over
  // a previously-redacted log would re-wrap the placeholder.
  if (args.redacted === true && typeof args.kind === 'string') return args;

  const declared = new Set(explicitFields.map(f => f.toLowerCase()));
  const out = {};
  for (const [key, value] of Object.entries(args)) {
    const lower = key.toLowerCase();
    if (declared.has(lower) || SECRET_FIELD_RE.test(key)) {
      // Don't double-wrap a placeholder.
      if (value && typeof value === 'object' && value.redacted === true && typeof value.kind === 'string') {
        out[key] = value;
      } else {
        out[key] = redactedPlaceholder(value);
      }
    } else if (value && typeof value === 'object' && !(value instanceof Uint8Array)) {
      // Recurse into nested objects/arrays — secrets can be nested.
      out[key] = redactArgs(value, explicitFields);
    } else {
      out[key] = value;
    }
  }
  return out;
}

/**
 * Re-redact a stored event-log entry so legacy entries (recorded
 * before redaction shipped) are scrubbed in place. Idempotent:
 * already-redacted placeholders are passed through unchanged.
 *
 * @param {object} event
 * @returns {object} event (mutated in place AND returned)
 */
export function redactEvent(event) {
  if (!event || typeof event !== 'object') return event;
  if (event.type === 'tool_call' && event.data) {
    if (event.data.arguments !== undefined) {
      event.data.arguments = redactArgs(event.data.arguments);
    }
  } else if (event.type === 'tool_result' && event.data?.result) {
    // Tool results often contain the original arguments echoed back
    // (e.g., MCP tool that returns {success, output: 'set apiKey to X'}).
    // We don't redact tool result OUTPUT because that's free-form text
    // that may legitimately contain user-readable content. Instead we
    // surface this gap in the audit doc for design-level review.
    // (Output is by far the harder case — it's natural-language and
    //  can't be regex-redacted without breaking legitimate content.)
  }
  return event;
}

/**
 * Apply redaction across an entire eventlog array. Used by the
 * one-time migration that scrubs pre-redaction entries.
 *
 * @param {object[]} events
 * @returns {{events:object[], scrubbed:number}}
 */
export function redactEventLog(events) {
  if (!Array.isArray(events)) return { events: events || [], scrubbed: 0 };
  let scrubbed = 0;
  for (const evt of events) {
    if (evt?.type === 'tool_call' && evt.data?.arguments !== undefined) {
      const before = JSON.stringify(evt.data.arguments);
      evt.data.arguments = redactArgs(evt.data.arguments);
      const after = JSON.stringify(evt.data.arguments);
      if (before !== after) scrubbed++;
    }
  }
  return { events, scrubbed };
}
