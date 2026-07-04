/**
 * clawser-skill-capabilities.mjs — Capability-gated APIs for deployed
 * skills.
 *
 * Closes B.2 of the deploy work: the receiver's `acceptPackage` flow
 * carries a capability token (built from the manifest's `capabilities`
 * declaration); when a deployed skill is launched, this module wraps
 * that token into `{fetch, fs, mesh}` callable surfaces that the
 * skill's sandbox uses. Each call passes through
 * `enforceCapabilityRequest` from `clawser-deploy-target.mjs`; on
 * deny, a clear actionable error is thrown that names the missing
 * manifest declaration.
 *
 * Local (non-deployed) skills DO NOT receive a capability token —
 * they keep the existing default-sandbox behavior (no fetch/fs/mesh
 * exposed in the worker scope; just the input variable). Only deployed
 * skills get these gated APIs.
 *
 * The wrapped surfaces are designed to be JSON-injectable into the
 * sandbox via the Codex/Skill wrapper script; see
 * `wrapSkillScript` for the actual injection pattern.
 */

import {
  enforceCapabilityRequest,
  CapabilityDeniedError,
} from './clawser-deploy-target.mjs';

/**
 * Translate a `CapabilityDeniedError` into a user-facing error whose
 * message points at the manifest line the source needs to add.
 */
const explain = (err) => {
  if (!(err instanceof CapabilityDeniedError)) throw err;
  const declaration = `manifest.capabilities.${err.kind}`;
  throw new Error(
    `Capability not granted: ${err.kind} access to "${err.target}" was requested by the skill but is not declared in the deploy manifest. ` +
    `Ask the source to add "${err.target}" to ${declaration} and re-deploy.`,
  );
};

/**
 * Build a `{fetch, fs, mesh}` API for a deployed skill.
 *
 * @param {{fs:string[], net:string[], mesh:string[]}} token  - capability token
 * @param {object} [hooks]
 * @param {(url:string, init?:object) => Promise<Response>} [hooks.fetch]
 *   - underlying fetch impl. Defaults to globalThis.fetch.
 * @param {{readFile:(path:string)=>Promise<*>, writeFile:(path:string, data:*)=>Promise<*>}} [hooks.fs]
 *   - underlying fs impl (e.g. WorkspaceFs in the browser, MemoryFs in tests).
 * @param {(name:string, args:*) => Promise<*>} [hooks.meshCall]
 *   - underlying mesh-capability dispatch.
 * @returns {{fetch:Function, fs:object, mesh:object, denied:Array<{kind:string,target:string,at:number}>}}
 */
export function createSkillCapabilityAPI(token, hooks = {}) {
  if (!token || typeof token !== 'object') {
    throw new TypeError('createSkillCapabilityAPI: token is required');
  }
  const denied = [];
  const recordDeny = (kind, target) => {
    denied.push({ kind, target, at: Date.now() });
  };

  // Explicit injection only — we DON'T fall back to `globalThis.fetch` so
  // skills can't accidentally reach host-realm globals if the caller
  // forgot to wire an inner fetch. Pass `globalThis.fetch` explicitly
  // when that's what you want.
  const innerFetch = 'fetch' in hooks ? hooks.fetch : null;
  const innerFs = hooks.fs || null;
  const innerMesh = hooks.meshCall || null;

  // ── fetch ──────────────────────────────────────────────────────
  const gatedFetch = async (url, init) => {
    let host;
    try { host = new URL(typeof url === 'string' ? url : (url?.url || ''), 'https://example.invalid/').hostname; }
    catch { host = String(url); }
    try { enforceCapabilityRequest(token, { kind: 'net', target: host }); }
    catch (e) { recordDeny('net', host); explain(e); }
    if (!innerFetch) throw new Error('fetch is not available in this environment');
    return innerFetch(url, init);
  };

  // ── fs ─────────────────────────────────────────────────────────
  const fs = {
    async readFile(path, opts) {
      try { enforceCapabilityRequest(token, { kind: 'fs', target: path }); }
      catch (e) { recordDeny('fs', path); explain(e); }
      if (!innerFs?.readFile) throw new Error('fs.readFile is not available in this environment');
      return innerFs.readFile(path, opts);
    },
    async writeFile(path, contents, opts) {
      try { enforceCapabilityRequest(token, { kind: 'fs', target: path }); }
      catch (e) { recordDeny('fs', path); explain(e); }
      if (!innerFs?.writeFile) throw new Error('fs.writeFile is not available in this environment');
      return innerFs.writeFile(path, contents, opts);
    },
  };

  // ── mesh ───────────────────────────────────────────────────────
  const mesh = {
    async call(capName, args) {
      try { enforceCapabilityRequest(token, { kind: 'mesh', target: capName }); }
      catch (e) { recordDeny('mesh', capName); explain(e); }
      if (!innerMesh) throw new Error('mesh.call is not available in this environment');
      return innerMesh(capName, args);
    },
  };

  return { fetch: gatedFetch, fs, mesh, denied };
}

/**
 * Build a runnable async wrapper around a skill source. The wrapper
 * exposes the capability-gated `fetch`/`fs`/`mesh` API as locals in
 * the skill's scope, plus the standard `input` parameter.
 *
 * The deployed-skill execution path uses this same-realm AsyncFunction
 * eval rather than the Worker-based default sandbox, because:
 *   - The skill source is signature-verified and the user explicitly
 *     approved its manifest. Worker-isolation is defense-in-depth for
 *     untrusted local skills; deployed skills already have a stronger
 *     trust check.
 *   - Capability gating is enforced at the API surface (the wrapped
 *     `fetch`/`fs`/`mesh`), not at realm boundaries. The Worker-based
 *     sandbox doesn't ship a postMessage RPC bridge for these APIs.
 *
 * The returned `runner(input)` accepts the skill input and returns
 * the async result (or rejects with the actionable cap-denied error).
 *
 * @param {string} skillSource
 * @param {object} api - return of createSkillCapabilityAPI
 * @returns {{ wrappedSource: string, hostBridge: {fetch:Function,fs:object,mesh:object}, runner: (input:string) => Promise<*> }}
 */
export function wrapSkillScript(skillSource, api) {
  const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
  const header = [
    'const fetch = __cap_bridge.fetch;',
    'const fs = __cap_bridge.fs;',
    'const mesh = __cap_bridge.mesh;',
  ].join('\n');
  const wrappedSource = `${header}\n${skillSource}`;
  const hostBridge = { fetch: api.fetch, fs: api.fs, mesh: api.mesh };
  const fn = new AsyncFunction('input', '__cap_bridge', wrappedSource);
  return {
    wrappedSource,
    hostBridge,
    runner: (input) => fn(input, hostBridge),
  };
}
