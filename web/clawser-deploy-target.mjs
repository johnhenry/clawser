/**
 * clawser-deploy-target.mjs — Receiver-side deploy logic.
 *
 * A device can receive deploy packages from any peer that shares its
 * mesh identity (personal multi-device sync) OR from any peer in the
 * "trusted sources" ACL. This module handles four receiver concerns:
 *
 *   B.1 Trusted-sources ACL + manifest-fingerprint approval cache
 *       — Each first-time manifest from a source prompts the user.
 *         Approval is cached by manifest hash; future deploys with the
 *         same hash auto-apply. Hash changes re-prompt.
 *
 *   B.2 Capability tokens — manifests declare required capabilities
 *       (fs paths, net hosts, mesh privileges); the sandbox honors
 *       only what was approved. The actual sandbox enforcement lives
 *       wherever skill execution happens — this module ships
 *       `enforceCapabilityRequest()` for that path to call.
 *
 *   B.3 Audit log — each deploy event appends one JSONL line to
 *       `__deploy_audit__.jsonl`. Read by the Deploy panel UI.
 *
 *   B.4 Versioned rollback — each deploy creates a tagged snapshot
 *       (via the existing snapshot manager). Retention: last 5 per
 *       source. Roll back via `rollbackTo(eventId)`.
 *
 * The flow on the target:
 *
 *   1. `acceptPackage(pkg)`:
 *      - verify signature + replay counter (clawser-deploy-package.mjs)
 *      - look up source in ACL; if not trusted, reject (UI prompt)
 *      - compute manifest hash; if not approved, prompt (UI flow)
 *      - take a tagged snapshot
 *      - hand items to the sync engine's atomic apply
 *      - append audit log entry
 *      - prune old snapshots beyond retention
 */

const ACL_FILE = '__deploy_acl__';
const APPROVALS_FILE = '__deploy_approvals__';
const AUDIT_FILE = '__deploy_audit__';
const SNAPSHOTS_FILE = '__deploy_snapshots__';
const DEFAULT_RETENTION = 5;

const enc = new TextEncoder();
const dec = new TextDecoder();

const readJson = async (storage, name, fallback) => {
  const raw = await storage.read(name);
  if (!raw) return fallback;
  try { return JSON.parse(dec.decode(raw)); }
  catch { return fallback; }
};
const writeJson = async (storage, name, value) =>
  storage.write(name, enc.encode(JSON.stringify(value)));

// ── B.1: Trusted sources ACL ─────────────────────────────────────

/**
 * Trusted-sources ACL. Each entry: `{source, label, addedAt, revokedAt}`.
 * A source is trusted iff it's present and not revoked.
 */
export class DeployAcl {
  #storage;

  constructor(storage) { this.#storage = storage; }

  async list() {
    const data = await readJson(this.#storage, ACL_FILE, { sources: [] });
    return data.sources;
  }

  async isTrusted(source) {
    const list = await this.list();
    const entry = list.find(s => s.source === source);
    return !!entry && !entry.revokedAt;
  }

  async grant(source, label = null) {
    const data = await readJson(this.#storage, ACL_FILE, { sources: [] });
    const existing = data.sources.find(s => s.source === source);
    if (existing) {
      existing.revokedAt = null;
      if (label) existing.label = label;
    } else {
      data.sources.push({ source, label, addedAt: Date.now(), revokedAt: null });
    }
    await writeJson(this.#storage, ACL_FILE, data);
  }

  async revoke(source) {
    const data = await readJson(this.#storage, ACL_FILE, { sources: [] });
    const entry = data.sources.find(s => s.source === source);
    if (!entry) return false;
    entry.revokedAt = Date.now();
    await writeJson(this.#storage, ACL_FILE, data);
    return true;
  }
}

// ── B.1: Manifest-fingerprint approvals ──────────────────────────

/**
 * Per-(source, manifestHash) auto-approval cache. First deploy from a
 * source with a given manifest hash needs an explicit approval; future
 * deploys with the same hash auto-apply. Manifest changes re-prompt.
 */
export class DeployApprovals {
  #storage;

  constructor(storage) { this.#storage = storage; }

  async isApproved(source, manifestHash) {
    const data = await readJson(this.#storage, APPROVALS_FILE, { approvals: [] });
    return data.approvals.some(a => a.source === source && a.manifestHash === manifestHash);
  }

  async approve(source, manifestHash, opts = {}) {
    const data = await readJson(this.#storage, APPROVALS_FILE, { approvals: [] });
    if (!data.approvals.some(a => a.source === source && a.manifestHash === manifestHash)) {
      data.approvals.push({
        source, manifestHash,
        approvedAt: Date.now(),
        capabilities: opts.capabilities || null,
      });
      await writeJson(this.#storage, APPROVALS_FILE, data);
    }
  }

  async revoke(source, manifestHash) {
    const data = await readJson(this.#storage, APPROVALS_FILE, { approvals: [] });
    const before = data.approvals.length;
    data.approvals = data.approvals.filter(
      a => !(a.source === source && a.manifestHash === manifestHash),
    );
    if (data.approvals.length !== before) {
      await writeJson(this.#storage, APPROVALS_FILE, data);
      return true;
    }
    return false;
  }

  async list() {
    const data = await readJson(this.#storage, APPROVALS_FILE, { approvals: [] });
    return data.approvals;
  }
}

// ── B.2: Capability tokens ───────────────────────────────────────

/**
 * Build a capability token from an approved manifest. The token is the
 * inert data structure the sandbox + apply handlers consume; calling
 * `enforceCapabilityRequest(token, request)` either returns silently
 * (allowed) or throws a `CapabilityDeniedError` (rejected).
 *
 * Capability kinds:
 *   - `fs`     : filesystem path prefixes (e.g. `/tmp/`)
 *   - `net`    : hostnames; supports `*.suffix` glob
 *   - `mesh`   : exact-string mesh capability names
 *   - `config` : config domain names (`autonomy`, `identity`, …) the
 *                deployed item is allowed to write
 *   - `memory` : memory categories (`learned`, `core`, `user`, `context`)
 *                the deployed item is allowed to write into
 *
 * @param {object} manifest
 * @returns {{fs: string[], net: string[], mesh: string[], config: string[], memory: string[]}}
 */
export const buildCapabilityToken = (manifest) => {
  const caps = manifest?.capabilities || {};
  return {
    fs: Array.isArray(caps.fs) ? [...caps.fs] : [],
    net: Array.isArray(caps.net) ? [...caps.net] : [],
    mesh: Array.isArray(caps.mesh) ? [...caps.mesh] : [],
    config: Array.isArray(caps.config) ? [...caps.config] : [],
    memory: Array.isArray(caps.memory) ? [...caps.memory] : [],
  };
};

export class CapabilityDeniedError extends Error {
  constructor(kind, target) {
    super(`Capability denied: ${kind}:${target}`);
    this.name = 'CapabilityDeniedError';
    this.kind = kind;
    this.target = target;
  }
}

/**
 * Check whether a given access request is permitted by a capability
 * token. Throws `CapabilityDeniedError` on rejection so the calling
 * skill code raises a clear error rather than silently failing.
 *
 * Path matching for `fs`: prefix match. `'/tmp/'` allows `'/tmp/foo'`.
 * Hostname matching for `net`: exact or `*.suffix` glob.
 * Mesh capability strings are matched exactly.
 *
 * @param {{fs:string[], net:string[], mesh:string[]}} token
 * @param {{kind:'fs'|'net'|'mesh', target:string}} request
 */
export const enforceCapabilityRequest = (token, request) => {
  const { kind, target } = request || {};
  if (!token || typeof target !== 'string') throw new CapabilityDeniedError(kind, target);
  if (kind === 'fs') {
    const ok = (token.fs || []).some(allowed => target === allowed || target.startsWith(allowed));
    if (!ok) throw new CapabilityDeniedError('fs', target);
    return;
  }
  if (kind === 'net') {
    const ok = (token.net || []).some(allowed => {
      if (allowed === target) return true;
      if (allowed.startsWith('*.')) {
        const suffix = allowed.slice(1); // ".example.com"
        return target.endsWith(suffix) && target.length > suffix.length;
      }
      return false;
    });
    if (!ok) throw new CapabilityDeniedError('net', target);
    return;
  }
  if (kind === 'mesh') {
    const ok = (token.mesh || []).includes(target);
    if (!ok) throw new CapabilityDeniedError('mesh', target);
    return;
  }
  if (kind === 'config') {
    const ok = (token.config || []).includes(target);
    if (!ok) throw new CapabilityDeniedError('config', target);
    return;
  }
  if (kind === 'memory') {
    const ok = (token.memory || []).includes(target);
    if (!ok) throw new CapabilityDeniedError('memory', target);
    return;
  }
  throw new CapabilityDeniedError(kind, target);
};

// ── B.3: Audit log ───────────────────────────────────────────────

/**
 * Append-only deploy audit log. One JSONL-style entry per event,
 * stored under `__deploy_audit__`.
 *
 * Storage shape: a JSON array of entries (we keep it as JSON-array
 * rather than literal newline-delimited because OPFSVaultStorage exposes
 * read/write whole files; the wire spelling above remains JSONL for the
 * docs/external readers, but internal storage is just `JSON.stringify(arr)`).
 */
export class DeployAuditLog {
  #storage;
  #cap;

  constructor(storage, opts = {}) {
    this.#storage = storage;
    this.#cap = opts.cap ?? 1000;
  }

  async append(entry) {
    const data = await readJson(this.#storage, AUDIT_FILE, { entries: [] });
    const enriched = { id: makeEventId(), timestamp: Date.now(), ...entry };
    data.entries.push(enriched);
    if (data.entries.length > this.#cap) {
      data.entries = data.entries.slice(-this.#cap);
    }
    await writeJson(this.#storage, AUDIT_FILE, data);
    return enriched;
  }

  async list({ limit = 50, sourceFilter = null } = {}) {
    const data = await readJson(this.#storage, AUDIT_FILE, { entries: [] });
    let entries = data.entries.slice().reverse();
    if (sourceFilter) entries = entries.filter(e => e.source === sourceFilter);
    return entries.slice(0, limit);
  }

  async clear() { await writeJson(this.#storage, AUDIT_FILE, { entries: [] }); }
}

const makeEventId = () => {
  const r = crypto.getRandomValues(new Uint8Array(8));
  let hex = '';
  for (let i = 0; i < r.length; i++) hex += r[i].toString(16).padStart(2, '0');
  return `evt-${Date.now().toString(36)}-${hex}`;
};

// ── B.4: Snapshot retention per source ───────────────────────────

/**
 * Track per-source snapshot rings. Each deploy event creates a snapshot
 * whose id is recorded against the event id. We keep the last N
 * (default 5) per source; older ones are pruned via the snapshot
 * driver's `delete()` (best-effort — the driver is plug-able).
 */
export class DeploySnapshotRing {
  #storage;
  #snapshotDriver;
  #retention;

  /**
   * @param {object} storage
   * @param {object} snapshotDriver  - has `create()`, optionally `delete(id)` and `restore(id)`
   * @param {number} [retention=5]
   */
  constructor(storage, snapshotDriver, retention = DEFAULT_RETENTION) {
    this.#storage = storage;
    this.#snapshotDriver = snapshotDriver;
    this.#retention = retention;
  }

  async record(source, eventId, snapshotId) {
    const data = await readJson(this.#storage, SNAPSHOTS_FILE, { rings: {} });
    if (!data.rings[source]) data.rings[source] = [];
    data.rings[source].push({ eventId, snapshotId, at: Date.now() });
    // Prune to last N
    while (data.rings[source].length > this.#retention) {
      const evicted = data.rings[source].shift();
      if (evicted?.snapshotId && this.#snapshotDriver.delete) {
        try { await this.#snapshotDriver.delete(evicted.snapshotId); }
        catch (e) { /* prune is best-effort */ }
      }
    }
    await writeJson(this.#storage, SNAPSHOTS_FILE, data);
    return data.rings[source].slice();
  }

  async listFor(source) {
    const data = await readJson(this.#storage, SNAPSHOTS_FILE, { rings: {} });
    return (data.rings[source] || []).slice();
  }

  async findByEvent(eventId) {
    const data = await readJson(this.#storage, SNAPSHOTS_FILE, { rings: {} });
    for (const [source, entries] of Object.entries(data.rings)) {
      const match = entries.find(e => e.eventId === eventId);
      if (match) return { source, ...match };
    }
    return null;
  }

  async restore(eventId) {
    const found = await this.findByEvent(eventId);
    if (!found) throw new Error(`No snapshot recorded for event ${eventId}`);
    if (!this.#snapshotDriver.restore) {
      throw new Error('Snapshot driver does not support restore()');
    }
    await this.#snapshotDriver.restore(found.snapshotId);
    return found;
  }
}

// ── End-to-end target receiver ───────────────────────────────────

/**
 * @typedef {object} DeployTargetCtx
 * @property {object}                packageVerifier  - has `verifySignedPackage(pkg, pubKey)`
 * @property {object}                replay           - ReplayCounterTracker
 * @property {DeployAcl}             acl
 * @property {DeployApprovals}       approvals
 * @property {DeployAuditLog}        audit
 * @property {DeploySnapshotRing}    snapshots
 * @property {(source:string) => Promise<CryptoKey>} resolvePublicKey
 *   — resolve the Ed25519 public key for a `did:key:` URI
 * @property {object}                applyTransport    — `applyBatch(items)` returning `{ok, error?}`
 *                                                        Typically `(items) => syncEngine.applyBatch(...)`
 *                                                        but kept abstract for testing.
 * @property {(req:{source:string, manifestHash:string, manifest:object}) => Promise<boolean>}
 *           [promptApprove] — async user-prompt; returns true to approve. If absent, packages
 *                              with unapproved manifests are rejected without prompting.
 */

/**
 * Run the full receiver pipeline for a single signed deploy package.
 *
 * @param {object} pkg
 * @param {DeployTargetCtx} ctx
 * @returns {Promise<{ok:boolean, applied?:string[], rejected?:string, eventId?:string}>}
 */
export const acceptPackage = async (pkg, ctx) => {
  // 1. Resolve public key + verify signature + payloads.
  let pubKey;
  try { pubKey = await ctx.resolvePublicKey(pkg.source); }
  catch (e) {
    return logRejection(ctx, pkg, `unable to resolve source public key: ${e.message}`);
  }
  const verify = await ctx.packageVerifier.verifySignedPackage(pkg, pubKey);
  if (!verify.ok) {
    return logRejection(ctx, pkg, `signature: ${verify.reason}`);
  }
  const manifestHash = verify.manifestHash;

  // 2. Replay-counter check.
  const fresh = await ctx.replay.accept(pkg.source, pkg.counter);
  if (!fresh) {
    return logRejection(ctx, pkg, 'replay or stale counter');
  }

  // 3. ACL: source must be trusted.
  if (!(await ctx.acl.isTrusted(pkg.source))) {
    return logRejection(ctx, pkg, 'source not trusted', { manifestHash });
  }

  // 4. Approval cache: prompt only if first-time-this-manifest.
  let approved = await ctx.approvals.isApproved(pkg.source, manifestHash);
  if (!approved) {
    if (typeof ctx.promptApprove !== 'function') {
      return logRejection(ctx, pkg, 'manifest not approved (no prompt configured)', { manifestHash });
    }
    approved = await ctx.promptApprove({
      source: pkg.source, manifestHash, manifest: pkg.manifest,
    });
    if (!approved) {
      return logRejection(ctx, pkg, 'user rejected manifest', { manifestHash });
    }
    await ctx.approvals.approve(pkg.source, manifestHash, {
      capabilities: pkg.manifest.capabilities,
    });
  }

  // 5. Snapshot before apply (delegated to applyTransport via a snapshot
  //    driver hooked into SyncEngine). We also track event→snapshot here
  //    so the rollback UI knows what to restore.
  //
  //    Capability flow-through: every item carries the manifest's full
  //    capability token. The store records the token alongside the item;
  //    when the skill is later launched, the token is passed to
  //    `executeSkillScript({ capabilities })` so the gated `fetch`/`fs`/
  //    `mesh` API enforces what the user approved.
  const capabilityToken = buildCapabilityToken(pkg.manifest);
  const result = await ctx.applyTransport.applyBatch(
    (pkg.manifest.items || []).map(item => ({
      kind: item.kind === 'yjs' ? 'yjs' : 'lww',
      itemId: item.itemId,
      payload: pkg.payloads?.[item.itemId],
      ts: pkg.manifest.createdAt || Date.now(),
      source: pkg.source,
      capabilities: capabilityToken,
      itemKind: item.kind, // preserved so the store knows it's a skill vs config
    })),
  );

  // 6. Audit log + snapshot ring entry.
  const status = result.ok ? 'applied' : (result.rolledBack ? 'rolled-back' : 'failed');
  const event = await ctx.audit.append({
    source: pkg.source,
    manifestHash,
    items: (pkg.manifest.items || []).map(i => ({ kind: i.kind, itemId: i.itemId })),
    status,
    error: result.error || null,
  });
  if (result.snapshotId) {
    await ctx.snapshots.record(pkg.source, event.id, result.snapshotId);
  }

  if (!result.ok) {
    return { ok: false, rejected: result.error || 'apply failed', eventId: event.id };
  }
  return { ok: true, applied: result.applied || [], eventId: event.id };
};

const logRejection = async (ctx, pkg, reason, extra = {}) => {
  const event = await ctx.audit.append({
    source: pkg?.source || 'unknown',
    manifestHash: extra.manifestHash || null,
    items: [],
    status: 'rejected',
    error: reason,
  });
  return { ok: false, rejected: reason, eventId: event.id };
};
