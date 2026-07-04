/**
 * clawser-ui-multi-device.mjs — My Devices + Trusted Publishers
 * settings panels.
 *
 * Two panels, scoped to the elements listed in the original spec:
 *
 *   1. My Devices (global — paired devices = "your other devices"):
 *      - list of paired devices: label, last-sync timestamp, sync
 *        toggle, "Deploy now" button per row, "Unpair" per row.
 *      - "Pair new device" button.
 *
 *   2. Trusted Publishers (per-workspace):
 *      - list of trusted source did:keys with revoke buttons.
 *      - list of approved manifest fingerprints with revoke buttons.
 *      - deploy history (audit log) with rollback button per entry.
 *
 * Pure render functions return HTML strings; bind functions wire
 * the buttons. The render outputs use the project's existing dark-
 * theme tokens (`.modal-box`, `.config-group`, etc.) so styling
 * matches adjacent panels.
 */

import { showApprovalModal } from './clawser-approval-modal.mjs';

const escHtml = (s) => String(s ?? '')
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;');

const fmtTs = (ts) => {
  if (!ts || typeof ts !== 'number') return '—';
  try { return new Date(ts).toLocaleString(); } catch { return String(ts); }
};

const shortDid = (did) => {
  if (typeof did !== 'string') return String(did);
  return did.length > 24 ? did.slice(0, 16) + '…' + did.slice(-8) : did;
};

const shortHash = (h) => {
  if (typeof h !== 'string') return String(h);
  return h.length > 16 ? h.slice(0, 8) + '…' + h.slice(-4) : h;
};

// ── My Devices — render ──────────────────────────────────────────

/**
 * @typedef {object} PairedDeviceView
 * @property {string} pubKey       — peer pubKey for routing
 * @property {string} label
 * @property {number|null} lastSyncedAt
 * @property {boolean} syncEnabled
 */

/**
 * Render the My Devices panel body.
 * @param {{devices: PairedDeviceView[]}} state
 * @returns {string}
 */
export function renderMyDevicesPanel({ devices = [] } = {}) {
  const rows = devices.length === 0
    ? '<div class="md-empty">No paired devices yet. Click "Pair new device" to add one.</div>'
    : devices.map(d => `
        <div class="md-row" data-pubkey="${escHtml(d.pubKey)}">
          <div class="md-col-label">
            <div class="md-label">${escHtml(d.label || '(unlabeled)')}</div>
            <div class="md-sub" title="${escHtml(d.pubKey)}">${escHtml(shortDid(d.pubKey))}</div>
            <div class="md-sub">Last sync: ${escHtml(fmtTs(d.lastSyncedAt))}</div>
          </div>
          <div class="md-col-actions">
            <label class="md-sync-toggle">
              <input type="checkbox" data-md-action="toggle-sync" ${d.syncEnabled ? 'checked' : ''} />
              Sync
            </label>
            <button class="btn-sm" data-md-action="deploy-now">Deploy now</button>
            <button class="btn-sm btn-surface2" data-md-action="unpair">Unpair</button>
          </div>
        </div>
      `).join('');

  return [
    '<div class="md-panel">',
    '<div class="md-panel-header">',
    '<div class="md-panel-title">My Devices</div>',
    '<button class="btn-sm" id="md-pair-new">Pair new device</button>',
    '</div>',
    `<div class="md-list">${rows}</div>`,
    '</div>',
  ].join('');
}

/**
 * Bind My Devices panel actions to a controller. The container is
 * the DOM element rendered with `renderMyDevicesPanel`. The
 * controller exposes:
 *   - `onPairNew()` : opens the existing pairing flow
 *   - `onToggleSync(pubKey, enabled)`
 *   - `onDeployNow(pubKey)`
 *   - `onUnpair(pubKey)`
 *
 * Returns an unsubscribe function.
 *
 * @param {HTMLElement} container
 * @param {object} controller
 * @returns {() => void}
 */
export function bindMyDevicesPanel(container, controller) {
  if (!container || !controller) return () => {};
  const pairBtn = container.querySelector('#md-pair-new');
  const onClick = (ev) => {
    const t = ev.target;
    if (t === pairBtn) { controller.onPairNew?.(); return; }
    const action = t?.getAttribute?.('data-md-action');
    if (!action) return;
    const row = t.closest?.('.md-row');
    const pubKey = row?.getAttribute?.('data-pubkey');
    if (!pubKey) return;
    if (action === 'toggle-sync') controller.onToggleSync?.(pubKey, !!t.checked);
    else if (action === 'deploy-now') controller.onDeployNow?.(pubKey);
    else if (action === 'unpair') controller.onUnpair?.(pubKey);
  };
  container.addEventListener('click', onClick);
  container.addEventListener('change', onClick);
  return () => {
    container.removeEventListener('click', onClick);
    container.removeEventListener('change', onClick);
  };
}

// ── Trusted Publishers — render ──────────────────────────────────

/**
 * @typedef {object} TrustedPublishersView
 * @property {Array<{source:string, label:string|null, addedAt:number, revokedAt:number|null}>} sources
 * @property {Array<{source:string, manifestHash:string, approvedAt:number}>} approvals
 * @property {Array<{id:string, timestamp:number, source:string, manifestHash:string|null, items:object[], status:string, error:string|null}>} auditEvents
 */

/**
 * Render the Trusted Publishers panel body.
 * @param {TrustedPublishersView} state
 * @returns {string}
 */
export function renderTrustedPublishersPanel({ sources = [], approvals = [], auditEvents = [] } = {}) {
  const sourceRows = sources.length === 0
    ? '<div class="tp-empty">No trusted sources. Approve a deploy or add one manually.</div>'
    : sources.map(s => `
        <div class="tp-row" data-source="${escHtml(s.source)}">
          <div class="tp-col-label">
            <div class="tp-label">${escHtml(s.label || '(no label)')}</div>
            <div class="tp-sub" title="${escHtml(s.source)}">${escHtml(shortDid(s.source))}</div>
            <div class="tp-sub">${s.revokedAt ? 'Revoked ' + escHtml(fmtTs(s.revokedAt)) : 'Trusted ' + escHtml(fmtTs(s.addedAt))}</div>
          </div>
          <div class="tp-col-actions">
            <button class="btn-sm btn-surface2" data-tp-action="revoke-source">${s.revokedAt ? 'Re-trust' : 'Revoke'}</button>
          </div>
        </div>
      `).join('');

  const approvalRows = approvals.length === 0
    ? '<div class="tp-empty">No manifest approvals yet.</div>'
    : approvals.map(a => `
        <div class="tp-row" data-source="${escHtml(a.source)}" data-hash="${escHtml(a.manifestHash)}">
          <div class="tp-col-label">
            <div class="tp-label tp-mono" title="${escHtml(a.manifestHash)}">${escHtml(shortHash(a.manifestHash))}</div>
            <div class="tp-sub" title="${escHtml(a.source)}">From ${escHtml(shortDid(a.source))}</div>
            <div class="tp-sub">Approved ${escHtml(fmtTs(a.approvedAt))}</div>
          </div>
          <div class="tp-col-actions">
            <button class="btn-sm btn-surface2" data-tp-action="revoke-approval">Revoke</button>
          </div>
        </div>
      `).join('');

  const auditRows = auditEvents.length === 0
    ? '<div class="tp-empty">No deploy events yet.</div>'
    : auditEvents.map(e => `
        <div class="tp-audit-row" data-event-id="${escHtml(e.id)}">
          <div class="tp-col-label">
            <div class="tp-label">${escHtml(e.status)} — ${escHtml((e.items || []).map(i => `${i.kind}:${i.itemId}`).join(', ') || '(no items)')}</div>
            <div class="tp-sub">${escHtml(fmtTs(e.timestamp))} from ${escHtml(shortDid(e.source))}</div>
            ${e.error ? `<div class="tp-sub tp-error">${escHtml(e.error)}</div>` : ''}
          </div>
          <div class="tp-col-actions">
            ${e.status === 'applied'
              ? `<button class="btn-sm btn-surface2" data-tp-action="rollback">Roll back</button>`
              : ''}
          </div>
        </div>
      `).join('');

  return [
    '<div class="tp-panel">',
    '<div class="tp-section"><div class="tp-section-title">Trusted source DIDs</div>' + sourceRows + '</div>',
    '<div class="tp-section"><div class="tp-section-title">Approved manifest fingerprints</div>' + approvalRows + '</div>',
    '<div class="tp-section"><div class="tp-section-title">Deploy history</div>' + auditRows + '</div>',
    '</div>',
  ].join('');
}

/**
 * Bind Trusted Publishers panel actions to a controller. Controller:
 *   - `onRevokeSource(source)`
 *   - `onRetrustSource(source)`         — when the row is currently revoked
 *   - `onRevokeApproval(source, manifestHash)`
 *   - `onRollback(eventId)`
 *
 * Returns an unsubscribe function.
 *
 * @param {HTMLElement} container
 * @param {object} controller
 * @param {Array} state.sources    — needed to know retrust vs revoke (passed via dataset)
 * @returns {() => void}
 */
export function bindTrustedPublishersPanel(container, controller) {
  if (!container || !controller) return () => {};
  const onClick = (ev) => {
    const t = ev.target;
    const action = t?.getAttribute?.('data-tp-action');
    if (!action) return;
    if (action === 'revoke-source') {
      const row = t.closest?.('.tp-row');
      const source = row?.getAttribute?.('data-source');
      if (!source) return;
      // Revoke vs re-trust: button text was 'Revoke' or 'Re-trust' —
      // simplest correct dispatch: peek at the button text content.
      if ((t.textContent || '').trim() === 'Re-trust') controller.onRetrustSource?.(source);
      else controller.onRevokeSource?.(source);
    } else if (action === 'revoke-approval') {
      const row = t.closest?.('.tp-row');
      const source = row?.getAttribute?.('data-source');
      const hash = row?.getAttribute?.('data-hash');
      if (source && hash) controller.onRevokeApproval?.(source, hash);
    } else if (action === 'rollback') {
      const row = t.closest?.('.tp-audit-row');
      const id = row?.getAttribute?.('data-event-id');
      if (id) controller.onRollback?.(id);
    }
  };
  container.addEventListener('click', onClick);
  return () => container.removeEventListener('click', onClick);
}

// ── Pair-new-device modal hook ───────────────────────────────────

/**
 * Convenience: open the pairing flow modal. The modal infrastructure
 * lives in `clawser-pairing.mjs` (already shipped). This wrapper
 * surfaces the user-facing "show QR + 6-digit code" flow.
 *
 * Returns an `{cancel()}` handle. The actual pairing completion is
 * detected on the OTHER device (consume side); this device just
 * waits for the QR to be scanned and the bundle imported.
 *
 * @param {object} args
 * @param {Function} args.generatePayload  — async function returning the pairing text
 * @param {Document} [args._doc]
 * @returns {Promise<void>}
 */
export async function showPairNewDeviceModal({ generatePayload, _doc } = {}) {
  const doc = _doc || (typeof document !== 'undefined' && document?.body ? document : null);
  if (!doc) return;
  if (typeof generatePayload !== 'function') {
    return showApprovalModal({
      source: '(error)', manifestHash: '(error)',
      manifest: { sourceLabel: 'Pair-new-device requires a generator', items: [], capabilities: {} },
    }, { _doc: doc });
  }
  let payload;
  try { payload = await generatePayload(); }
  catch (e) { payload = `Error: ${e?.message || e}`; }

  const overlay = doc.createElement('div');
  overlay.className = 'modal-overlay';
  const box = doc.createElement('div');
  box.className = 'modal-box';
  box.innerHTML = [
    '<div class="modal-title">Pair new device</div>',
    '<div class="modal-body">',
    'On the target device, scan the QR or paste the text below. Then enter the 6-digit code shown on the source.',
    '<pre class="md-pair-payload">' + escHtml(payload) + '</pre>',
    'This pairing code expires in 5 minutes.',
    '</div>',
    '<div class="modal-btns"><button class="modal-btn modal-btn-ok" id="_pair_close">Close</button></div>',
  ].join('');
  overlay.appendChild(box);
  doc.body.appendChild(overlay);
  return new Promise((resolve) => {
    const btn = box.querySelector('#_pair_close');
    const close = () => { overlay.remove(); resolve(); };
    btn?.addEventListener('click', close);
    overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
  });
}
