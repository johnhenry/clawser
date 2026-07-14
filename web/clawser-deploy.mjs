/**
 * clawser-deploy.mjs — Push-mode orchestration on top of the sync engine.
 *
 * Two modes:
 *
 *   1. Always-sync — paired devices receive every flagged item update
 *      live. Implemented as a thin observer: `recordLocalChange()`
 *      enqueues into the engine's debounced outbound queue, which
 *      flushes after the 500ms window. (The engine already does this;
 *      this module just guards on the sync flag.)
 *
 *   2. Manual deploy — "Deploy now" button. Builds an explicit batch
 *      from the current state of every flagged item and dispatches in
 *      one go. Caller shows a confirmation dialog using
 *      `buildDeployPreview()` before invoking `runDeploy()`.
 *
 * The module is purely orchestration; storage of items, peer routing,
 * snapshotting, and atomic apply all live in `clawser-sync.mjs` and
 * its dependencies.
 */

/**
 * @typedef {object} DeployItemSnapshot
 * @property {string} kind     — 'lww' or 'yjs'
 * @property {string} itemId
 * @property {*}      payload  — current value to send
 */

/**
 * @typedef {object} DeployContext
 * @property {object}                                pod        — has `sendMessage`
 * @property {import('./clawser-sync.mjs').SyncEngine} engine
 * @property {import('./clawser-sync-flags.mjs').SyncFlags} flags
 * @property {(fid: string) => Promise<DeployItemSnapshot|null>} resolveItem
 *   — Given a `kind:id` flag, return the item's current value or null
 *     if the flag refers to something no longer present.
 * @property {() => string[]} listPeers — paired device ids
 */

/**
 * Build a preview of what a manual deploy would push, for the user's
 * confirmation dialog. Pure — does no I/O on the engine itself.
 *
 * @param {DeployContext} ctx
 * @returns {Promise<{items: Array<{fid:string, kind:string, present:boolean}>, peers:string[]}>}
 */
export const buildDeployPreview = async (ctx) => {
  const fids = await ctx.flags.listFlagged();
  const items = [];
  for (const fid of fids) {
    const snap = await ctx.resolveItem(fid);
    items.push({
      fid,
      kind: snap?.kind || 'unknown',
      present: !!snap,
    });
  }
  return { items, peers: ctx.listPeers() };
};

/**
 * Execute a manual deploy: enumerate every flagged item, queue it on
 * the engine, and flush immediately (skipping the debounce). Items
 * whose flag points at something no longer present are silently
 * skipped (UI surface should warn during preview).
 *
 * @param {DeployContext} ctx
 * @returns {Promise<{queued:number, sent:number, peers:number, missing:string[]}>}
 */
export const runDeploy = async (ctx) => {
  const fids = await ctx.flags.listFlagged();
  let queued = 0;
  const missing = [];
  for (const fid of fids) {
    const snap = await ctx.resolveItem(fid);
    if (!snap) { missing.push(fid); continue; }
    ctx.engine.queueLocal(snap.itemId, snap.kind, snap.payload);
    queued++;
  }
  const result = await ctx.engine.flush({ manual: true });
  return { queued, sent: result.sent, peers: result.peers, missing };
};

/**
 * Always-sync path: called by item-storage layers when an item changes
 * locally. Checks the sync flag; if set, enqueues on the engine. The
 * engine handles debounced delivery and resolves all paired peers.
 *
 * @param {DeployContext} ctx
 * @param {string} fid     — `kind:id` flag for this item
 * @param {string} kind    — 'lww' or 'yjs' (transport kind)
 * @param {string} itemId  — engine-side itemId (often the same as `id` part of fid)
 * @param {*}      payload
 * @returns {Promise<boolean>} true if queued, false if not flagged
 */
export const recordLocalChange = async (ctx, fid, kind, itemId, payload) => {
  const flagged = await ctx.flags.isFlagged(fid);
  if (!flagged) return false;
  ctx.engine.queueLocal(itemId, kind, payload);
  return true;
};
