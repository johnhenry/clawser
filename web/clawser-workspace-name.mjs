/**
 * clawser-workspace-name.mjs — sanitize workspace names into safe
 * directory names for the `/home/<name>` shell view.
 *
 * Storage IDs (`ws_<base36>_<rand>`, `default`) remain the canonical
 * OPFS subdirectory key under `clawser/workspaces/`. The shell view
 * is a separate naming layer driven by the user-facing workspace
 * `name` field. This module produces the sanitized name and resolves
 * conflicts with a numeric suffix.
 *
 * Rules (intentionally narrow):
 *   - lowercased
 *   - Unicode NFKD-normalized; non-ASCII characters dropped
 *   - allowed chars: a-z, 0-9, dash, underscore
 *   - whitespace and other separators collapse to a single dash
 *   - leading/trailing dashes/underscores trimmed
 *   - reserved names rejected (`'.'`, `'..'`, top-level virtual roots)
 *   - empty result after sanitization → fallback `'workspace'`
 *
 * Conflicts (two workspaces sanitize to the same name) are resolved
 * stably by appending `-2`, `-3`, … in workspace-list order. The
 * default workspace (id === `'default'`) always wins the bare name
 * `'default'`; any other workspace named "default" gets a suffix.
 */

const RESERVED = new Set([
  '.', '..',
  // top-level virtual roots in our shell view
  'proc', 'etc', 'dev', 'tmp', 'run', 'sys', 'var', 'home', 'root',
  // a few names that would otherwise overlap real directory layouts
  'bin', 'sbin', 'usr', 'lib', 'opt', 'mnt', 'media',
]);

const FALLBACK_NAME = 'workspace';
const DEFAULT_NAME = 'default';
const DEFAULT_ID = 'default';

/**
 * Sanitize a single name (without conflict resolution).
 *
 * Used for unit-level checks; in production use `buildSanitizedNameMap`
 * which also handles cross-workspace conflicts.
 *
 * @param {string} name
 * @returns {string}
 */
export function sanitizeWorkspaceName(name) {
  if (typeof name !== 'string') return FALLBACK_NAME;
  // Decompose accented forms then drop combining marks; then drop
  // anything else outside [a-z0-9_-]
  let s = name.normalize('NFKD').toLowerCase();
  s = s.replace(/[̀-ͯ]/g, '');         // strip combining marks
  s = s.replace(/[^a-z0-9_-]+/g, '-');             // others → dash
  s = s.replace(/-{2,}/g, '-');                     // collapse dash runs
  s = s.replace(/_{2,}/g, '_');                     // collapse underscore runs
  s = s.replace(/^[-_]+|[-_]+$/g, '');              // trim leading/trailing
  if (!s) return FALLBACK_NAME;
  if (RESERVED.has(s)) return FALLBACK_NAME;
  // OPFS / Unix filename length sanity: cap at 64 chars.
  if (s.length > 64) s = s.slice(0, 64).replace(/[-_]+$/g, '') || FALLBACK_NAME;
  return s;
}

/**
 * Build a stable sanitized-name map across a list of workspaces,
 * resolving collisions with numeric suffixes.
 *
 * Iteration order: the default workspace first (so it claims the
 * `'default'` name), then the rest in given list order.
 *
 * @param {Array<{id:string, name:string}>} workspaces
 * @returns {Map<string, string>} wsId → sanitized name
 */
export function buildSanitizedNameMap(workspaces) {
  const out = new Map();
  const used = new Set();
  if (!Array.isArray(workspaces)) return out;

  const claim = (wsId, base) => {
    let candidate = base;
    // Reserve `'default'` exclusively for id === 'default'
    if (candidate === DEFAULT_NAME && wsId !== DEFAULT_ID) {
      candidate = `${candidate}-2`;
    }
    if (!used.has(candidate)) {
      used.add(candidate); out.set(wsId, candidate); return candidate;
    }
    let n = 2;
    while (used.has(`${base}-${n}`)) n++;
    used.add(`${base}-${n}`); out.set(wsId, `${base}-${n}`);
    return `${base}-${n}`;
  };

  // Default workspace first
  const def = workspaces.find(w => w.id === DEFAULT_ID);
  if (def) claim(DEFAULT_ID, DEFAULT_NAME);

  for (const ws of workspaces) {
    if (ws.id === DEFAULT_ID) continue;
    const base = sanitizeWorkspaceName(ws.name) || FALLBACK_NAME;
    claim(ws.id, base);
  }
  return out;
}

/**
 * Convenience: get the sanitized name for the active workspace, or
 * `null` if no match. Mostly used by the shell's path resolver.
 *
 * @param {Array<{id:string,name:string}>} workspaces
 * @param {string} activeId
 * @returns {string|null}
 */
export function activeSanitizedName(workspaces, activeId) {
  const map = buildSanitizedNameMap(workspaces);
  return map.get(activeId) ?? null;
}

/**
 * Reverse lookup — given a sanitized name and the workspace list,
 * find the matching wsId. Returns `null` when no match.
 *
 * @param {string} sanitizedName
 * @param {Array<{id:string,name:string}>} workspaces
 * @returns {string|null}
 */
export function wsIdForSanitizedName(sanitizedName, workspaces) {
  const map = buildSanitizedNameMap(workspaces);
  for (const [id, n] of map) {
    if (n === sanitizedName) return id;
  }
  return null;
}

export const _internals = { RESERVED, FALLBACK_NAME, DEFAULT_NAME };
