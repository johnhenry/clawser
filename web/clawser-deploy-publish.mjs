/**
 * clawser-deploy-publish.mjs — outbound deploy orchestrator.
 *
 * Builds + signs + sends a deploy package end-to-end.
 *
 * Inputs (as a single options object to `publishDeploy`):
 *   - `items`     : array of `{kind, itemId, payload}` — payloads
 *                   are the bytes/JSON to ship. The caller collects
 *                   payloads from the workspace's storage layer
 *                   (skills via SkillStorage.readSkill, configs via
 *                   readConfig, memory via the agent).
 *   - `targetPubKey` : recipient pubKey (`peerNode.sendTo` arg).
 *   - `manifestExtras` : `{sourceLabel?, capabilities?, ...}` —
 *                        optional manifest fields. `items` are
 *                        derived from the items array; `createdAt`
 *                        is set; `capabilities` defaults to `{}` if
 *                        not passed.
 *   - `signingKey`   : Ed25519 private key (CryptoKey).
 *   - `sourceDid`    : `did:key:z…` for the signer.
 *   - `pod`          : has `sendMessage(peerId, envelope)`.
 *   - `nextCounter`  : function returning the next monotonic counter
 *                      for this source. Defaults to a Date.now-based
 *                      counter (sufficient for single-instance use;
 *                      production should use a persistent counter).
 *
 * Returns `{ok, packageBytes?, error?}`. Failures bubble cleanly so
 * the UI can surface what happened.
 */

import { buildSignedPackage } from './clawser-deploy-package.mjs';

/**
 * Default counter: monotonic microsecond-ish timestamp. Two calls
 * within the same millisecond increment the suffix to keep order.
 * Sufficient for one-instance use; multi-instance senders should
 * pass a persistent counter from `ReplayCounterTracker`.
 */
const _counterState = { last: 0 };
const defaultNextCounter = () => {
  const now = Date.now();
  if (now <= _counterState.last) {
    _counterState.last += 1;
  } else {
    _counterState.last = now;
  }
  return _counterState.last;
};

/**
 * @typedef {object} DeployItem
 * @property {string} kind         — 'skill' | 'config' | 'memory'
 * @property {string} itemId
 * @property {string|Uint8Array|object} payload  — JSON-serializable or raw bytes
 */

/**
 * Build a payload-bytes map for `buildSignedPackage`. Each item's
 * `payload` is normalized:
 *   - Uint8Array  : passed through as-is
 *   - string      : encoded to UTF-8 bytes
 *   - object      : JSON.stringify'd, then UTF-8 bytes
 *
 * Exported for tests.
 */
export const normalizePayloads = (items) => {
  const out = {};
  for (const it of items) {
    if (it.payload instanceof Uint8Array) {
      out[it.itemId] = it.payload;
    } else if (typeof it.payload === 'string') {
      out[it.itemId] = new TextEncoder().encode(it.payload);
    } else {
      out[it.itemId] = new TextEncoder().encode(JSON.stringify(it.payload));
    }
  }
  return out;
};

/**
 * Publish a deploy package to a single target peer.
 *
 * @param {object} args
 * @param {DeployItem[]} args.items
 * @param {string}   args.targetPubKey
 * @param {object}   [args.manifestExtras]
 * @param {CryptoKey} args.signingKey
 * @param {string}   args.sourceDid
 * @param {object}   args.pod                — `{sendMessage}`
 * @param {() => number} [args.nextCounter]
 * @returns {Promise<{ok:boolean, counter?:number, error?:string}>}
 */
export async function publishDeploy({
  items,
  targetPubKey,
  manifestExtras = {},
  signingKey,
  sourceDid,
  pod,
  nextCounter = defaultNextCounter,
}) {
  if (!Array.isArray(items) || items.length === 0) {
    return { ok: false, error: 'publishDeploy: items array required' };
  }
  if (typeof targetPubKey !== 'string' || !targetPubKey) {
    return { ok: false, error: 'publishDeploy: targetPubKey required' };
  }
  if (!signingKey) return { ok: false, error: 'publishDeploy: signingKey required' };
  if (typeof sourceDid !== 'string' || !sourceDid.startsWith('did:key:')) {
    return { ok: false, error: 'publishDeploy: sourceDid must be a did:key URI' };
  }
  if (!pod || typeof pod.sendMessage !== 'function') {
    return { ok: false, error: 'publishDeploy: pod with sendMessage required' };
  }

  for (const it of items) {
    if (!it || typeof it.kind !== 'string' || typeof it.itemId !== 'string') {
      return { ok: false, error: `publishDeploy: malformed item (need {kind, itemId, payload})` };
    }
    if (it.payload === undefined || it.payload === null) {
      return { ok: false, error: `publishDeploy: missing payload for ${it.kind}:${it.itemId}` };
    }
  }

  const counter = nextCounter();
  const payloads = normalizePayloads(items);
  const manifest = {
    sourceLabel: manifestExtras.sourceLabel || 'unknown source',
    items: items.map(it => ({ kind: it.kind, itemId: it.itemId })),
    capabilities: manifestExtras.capabilities || { fs: [], net: [], mesh: [], config: [], memory: [] },
    createdAt: Date.now(),
    ...(manifestExtras.extra || {}),
  };

  let pkg;
  try {
    pkg = await buildSignedPackage({
      source: sourceDid,
      privateKey: signingKey,
      counter,
      manifest,
      payloads,
    });
  } catch (err) {
    return { ok: false, error: `publishDeploy: sign failed: ${err?.message || String(err)}` };
  }

  try {
    await pod.sendMessage(targetPubKey, { type: 'deploy', package: pkg });
  } catch (err) {
    return { ok: false, error: `publishDeploy: send failed: ${err?.message || String(err)}` };
  }

  return { ok: true, counter };
}

/**
 * Convenience: publish to multiple targets in parallel. Returns
 * per-target results. A failure to send to one peer doesn't abort
 * the others.
 *
 * @param {object} args
 * @param {string[]} args.targets
 * @param {object}   args.publishOpts  — passed to `publishDeploy` minus `targetPubKey`
 * @returns {Promise<{ targetPubKey: string, ok: boolean, error?: string }[]>}
 */
export async function publishDeployToAll({ targets, publishOpts }) {
  if (!Array.isArray(targets) || targets.length === 0) return [];
  return Promise.all(
    targets.map(async (targetPubKey) => {
      const r = await publishDeploy({ ...publishOpts, targetPubKey });
      return { targetPubKey, ok: r.ok, error: r.error };
    }),
  );
}

export const _internals = { defaultNextCounter, _counterState };
