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
 * High-confidence secret VALUE shapes, for scanning free-form tool
 * RESULT text (`output` strings, serialized API responses, etc.).
 * Intentionally narrow — matches well-known prefixed token formats
 * and structurally distinctive shapes (JWTs) only, not a general
 * secret scanner. Deliberately does NOT try to flag arbitrary-looking
 * random strings, since that produces too many false positives on
 * legitimate content (hashes, IDs, etc.) — see the module docstring
 * for why field-name matching alone isn't enough here.
 */
export const SECRET_VALUE_RE = /\b(sk-[A-Za-z0-9]{20,}|gh[pousr]_[A-Za-z0-9]{36,}|AKIA[0-9A-Z]{16}|xox[baprs]-[A-Za-z0-9-]{10,}|eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,})\b/g;

/**
 * Mask any high-confidence secret shapes found in free-form text,
 * leaving the surrounding content readable.
 *
 * @param {*} text
 * @returns {*} - text with matches replaced, or the input unchanged if not a string
 */
export function redactSecretValuesInText(text) {
  if (typeof text !== 'string') return text;
  return text.replace(SECRET_VALUE_RE, (m) => `[redacted:${m.length}chars]`);
}

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
 * Redact a tool RESULT (as opposed to call arguments — see `redactArgs`).
 * Combines field-name-based redaction (declared fields + regex fallback,
 * same as `redactArgs`) with content scanning: every string leaf value
 * (most commonly `{ output: "..." }`) is passed through
 * `redactSecretValuesInText` regardless of its field name, since result
 * output is typically free-form and can't be redacted by field name alone.
 *
 * @param {*} result                              — typically {success, output, error}
 * @param {string[]} [explicitFields=[]]           — declared by the tool (redactedResultFields)
 * @returns {*}
 */
export function redactResult(result, explicitFields = []) {
  if (typeof result === 'string') return redactSecretValuesInText(result);
  if (!result || typeof result !== 'object') return result;
  if (Array.isArray(result)) return result.map(v => redactResult(v, explicitFields));
  if (result.redacted === true && typeof result.kind === 'string') return result; // idempotent

  const declared = new Set(explicitFields.map(f => f.toLowerCase()));
  const out = {};
  for (const [key, value] of Object.entries(result)) {
    const lower = key.toLowerCase();
    if (declared.has(lower) || SECRET_FIELD_RE.test(key)) {
      out[key] = (value && typeof value === 'object' && value.redacted === true && typeof value.kind === 'string')
        ? value
        : redactedPlaceholder(value);
    } else if (typeof value === 'string') {
      out[key] = redactSecretValuesInText(value);
    } else if (value && typeof value === 'object' && !(value instanceof Uint8Array)) {
      out[key] = redactResult(value, explicitFields);
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
  } else if (event.type === 'tool_result' && event.data?.result !== undefined) {
    // No tool instance available at migration/replay time, so only the
    // regex/content-scan defaults apply here (no per-tool declared
    // redactedResultFields — those are applied at append time by the
    // agent, which does have the tool instance).
    event.data.result = redactResult(event.data.result);
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
    } else if (evt?.type === 'tool_result' && evt.data?.result !== undefined) {
      const before = JSON.stringify(evt.data.result);
      evt.data.result = redactResult(evt.data.result);
      const after = JSON.stringify(evt.data.result);
      if (before !== after) scrubbed++;
    }
  }
  return { events, scrubbed };
}
