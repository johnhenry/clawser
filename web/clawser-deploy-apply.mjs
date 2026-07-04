/**
 * clawser-deploy-apply.mjs — per-kind handler registry for deploy
 * `applyTransport`.
 *
 * `acceptPackage` calls `applyTransport.applyBatch(items)` after
 * verifying signature + ACL + manifest approval. Each item has
 * `{kind, itemId, payload, ts, source, capabilities, itemKind}`.
 * This module turns that abstract contract into real persistence
 * via three handlers:
 *
 *   - `skill` : write the skill files into OPFS via the existing
 *               `SkillStorage.writeSkill` path.
 *   - `config`: write to `~/.config/clawser/<domain>.json` via the
 *               existing `writeConfig` API; gated by
 *               `manifest.capabilities.config[]`.
 *   - `memory`: write into the active agent's memory store; gated
 *               by `manifest.capabilities.memory[]` (category).
 *
 * Capability gating is shaped so the deploy receiver fails
 * loudly: a deployed `config` item targeting a domain not in the
 * manifest's declared `config` capabilities throws
 * `CapabilityDeniedError`, which `acceptPackage` translates into a
 * `rolled-back` audit entry.
 *
 * The registry is composable: `createApplyTransport({ctx, handlers})`
 * builds an `applyTransport` object with `applyBatch(items)`. Tests
 * pass mock handlers via the `handlers` override; production wiring
 * uses `defaultHandlers(ctx)` which reaches into `state.agent` and
 * `wsId` for skill/config/memory persistence.
 */

import { CapabilityDeniedError, enforceCapabilityRequest } from './clawser-deploy-target.mjs';

/**
 * @typedef {object} DeployApplyCtx
 * @property {string}   wsId
 * @property {object}   [agent]                  — has `memoryStore({key, content, category})`
 * @property {object}   [skillsAPI]              — `{writeSkill(scope, wsId, name, files)}`
 * @property {Function} [writeConfig]            — `(domain, wsId, value) => Promise<void>`
 * @property {string[]} [knownConfigDomains]     — set of valid config domain names
 */

/**
 * @typedef {(item: object, token: object, ctx: DeployApplyCtx) => Promise<{ok:boolean, error?:string}>} DeployHandler
 */

const DEFAULT_KNOWN_DOMAINS = new Set([
  'autonomy', 'identity', 'security', 'hooks', 'peripherals', 'routines',
  'modelConfig', 'terminalRenderer', 'selfRepair', 'sandbox', 'heartbeat',
]);

/**
 * Skill apply handler.
 *
 * Payload shape:
 *   {
 *     files: { [relPath]: string },   // skill directory contents
 *     scope: 'workspace' | 'global'    // optional, default 'workspace'
 *   }
 *
 * Capability gating: skills don't require an extra capability for
 * persistence (they're already gated by manifest approval) — runtime
 * capabilities (fs/net/mesh) gate execution, not install. We DO
 * verify the payload structure to refuse hostile payloads.
 */
export const handleSkillItem = async (item, _token, ctx) => {
  const payload = item?.payload;
  if (!payload || typeof payload !== 'object') {
    return { ok: false, error: `skill: payload must be an object with .files` };
  }
  const files = payload.files;
  if (!files || typeof files !== 'object') {
    return { ok: false, error: `skill: payload.files must be an object {<path>: <content>}` };
  }
  const scope = payload.scope === 'global' ? 'global' : 'workspace';
  if (!ctx.skillsAPI?.writeSkill) {
    return { ok: false, error: 'skill: no skillsAPI.writeSkill in apply context' };
  }
  // Validate the skill name itself — must not contain path separators
  // or traversal components. The name is used directly as a directory
  // name under the skills root.
  if (typeof item.itemId !== 'string' || !item.itemId
      || item.itemId === '.' || item.itemId === '..'
      || /[\/\\]/.test(item.itemId)) {
    return { ok: false, error: `skill: invalid itemId: ${item.itemId}` };
  }
  // Convert to the Map format SkillStorage.writeSkill expects.
  // Reject paths with traversal segments or absolute roots — defense-in-
  // depth even though OPFS treats `..` as a literal name. Hostile
  // packages shouldn't be able to create files with names like
  // `..`, `../..`, leading `/`, or backslashes.
  const fileMap = new Map();
  for (const [path, content] of Object.entries(files)) {
    if (typeof path !== 'string' || !path) continue;
    if (typeof content !== 'string') continue;
    if (path.startsWith('/') || path.startsWith('\\')) continue;
    const segments = path.split(/[\/\\]/);
    if (segments.some(s => s === '..' || s === '.')) continue;
    fileMap.set(path, content);
  }
  if (fileMap.size === 0) {
    return { ok: false, error: 'skill: payload.files contained no usable entries (after traversal filter)' };
  }
  await ctx.skillsAPI.writeSkill(scope, scope === 'global' ? null : ctx.wsId, item.itemId, fileMap);
  return { ok: true };
};

/**
 * Config apply handler.
 *
 * Payload shape: any JSON value — written to
 * `~/.config/clawser/<itemId>.json`. `itemId` IS the config domain.
 *
 * Capability gating: throws if the manifest didn't declare
 * `manifest.capabilities.config: [<domain>, …]` containing the item's
 * domain.
 */
export const handleConfigItem = async (item, token, ctx) => {
  const domain = item.itemId;
  if (typeof domain !== 'string' || !domain) {
    return { ok: false, error: 'config: itemId must be a domain name string' };
  }
  // Reject unknown domains entirely — prevents typo'd manifests from
  // creating phantom config files.
  const knownDomains = ctx.knownConfigDomains instanceof Set
    ? ctx.knownConfigDomains
    : DEFAULT_KNOWN_DOMAINS;
  if (!knownDomains.has(domain)) {
    return { ok: false, error: `config: unknown domain "${domain}"` };
  }
  // Capability gate
  try { enforceCapabilityRequest(token, { kind: 'config', target: domain }); }
  catch (e) {
    if (e instanceof CapabilityDeniedError) {
      return { ok: false, error: `config: capability not granted for domain "${domain}" — declare in manifest.capabilities.config` };
    }
    throw e;
  }
  if (typeof ctx.writeConfig !== 'function') {
    return { ok: false, error: 'config: no writeConfig in apply context' };
  }
  await ctx.writeConfig(domain, ctx.wsId, item.payload);
  return { ok: true };
};

/**
 * Memory apply handler.
 *
 * Payload shape:
 *   {
 *     key: string,
 *     content: string,
 *     category: 'core'|'learned'|'user'|'context'
 *   }
 *
 * Capability gating: throws if the manifest didn't declare
 * `manifest.capabilities.memory: [<category>, …]` containing the
 * item's category.
 */
export const handleMemoryItem = async (item, token, ctx) => {
  const payload = item?.payload;
  if (!payload || typeof payload !== 'object') {
    return { ok: false, error: 'memory: payload must be an object {key, content, category}' };
  }
  const { key, content, category } = payload;
  if (typeof key !== 'string' || !key) {
    return { ok: false, error: 'memory: payload.key required' };
  }
  if (typeof content !== 'string') {
    return { ok: false, error: 'memory: payload.content required' };
  }
  const cat = category || 'learned';
  // Capability gate
  try { enforceCapabilityRequest(token, { kind: 'memory', target: cat }); }
  catch (e) {
    if (e instanceof CapabilityDeniedError) {
      return { ok: false, error: `memory: capability not granted for category "${cat}" — declare in manifest.capabilities.memory` };
    }
    throw e;
  }
  if (!ctx.agent?.memoryStore) {
    return { ok: false, error: 'memory: no agent.memoryStore in apply context' };
  }
  ctx.agent.memoryStore({ key, content, category: cat });
  return { ok: true };
};

const DEFAULT_HANDLERS = Object.freeze({
  skill: handleSkillItem,
  config: handleConfigItem,
  memory: handleMemoryItem,
});

/**
 * Build an `applyTransport` (the `{applyBatch(items)}` shape that
 * `acceptPackage` consumes) from a per-kind handler registry.
 *
 * The transport iterates every item, dispatches by `item.itemKind`
 * (or `item.kind` as fallback), and aggregates results. If ANY
 * item fails, the whole batch fails — `acceptPackage` then rolls
 * back via the snapshot. That matches the existing atomicity
 * contract: deploys are all-or-nothing.
 *
 * @param {object} args
 * @param {DeployApplyCtx} args.ctx
 * @param {Object<string, DeployHandler>} [args.handlers] — per-kind handler map
 * @returns {{applyBatch: (items: object[]) => Promise<{ok:boolean, applied:string[], error?:string, snapshotId:null}>}}
 */
export function createApplyTransport({ ctx, handlers = DEFAULT_HANDLERS } = {}) {
  if (!ctx) throw new Error('createApplyTransport: ctx is required');
  return {
    async applyBatch(items) {
      const applied = [];
      for (const item of items) {
        const kind = item.itemKind || item.kind;
        const handler = handlers[kind];
        if (!handler) {
          return { ok: false, applied: [], error: `no handler for kind "${kind}"`, snapshotId: null };
        }
        const token = item.capabilities || { fs: [], net: [], mesh: [], config: [], memory: [] };
        let result;
        try { result = await handler(item, token, ctx); }
        catch (err) {
          return { ok: false, applied: [], error: `handler threw on ${kind}:${item.itemId}: ${err?.message || String(err)}`, snapshotId: null };
        }
        if (!result?.ok) {
          return { ok: false, applied: [], error: result?.error || `${kind}:${item.itemId} failed`, snapshotId: null };
        }
        applied.push(item.itemId);
      }
      return { ok: true, applied, snapshotId: null };
    },
  };
}

/**
 * Convenience: build a default-handlers `applyTransport` from the live
 * workspace state. Uses `state.agent` for memory writes and the
 * canonical `writeConfig` + `SkillStorage.writeSkill` paths.
 *
 * @param {object} args
 * @param {object} args.state
 * @param {string} args.wsId
 * @param {Function} [args.writeConfig]
 * @param {object}   [args.skillsAPI]
 * @returns {{applyBatch: Function}}
 */
export function createDefaultApplyTransport({ state, wsId, writeConfig, skillsAPI }) {
  return createApplyTransport({
    ctx: {
      wsId,
      agent: state?.agent || null,
      skillsAPI,
      writeConfig,
    },
  });
}

export const _internals = { DEFAULT_HANDLERS, DEFAULT_KNOWN_DOMAINS };
