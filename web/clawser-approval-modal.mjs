/**
 * clawser-approval-modal.mjs — async modal for first-time deploy
 * approval.
 *
 * `acceptPackage` calls a `promptApprove({source, manifestHash,
 * manifest})` function when it sees a new (source, manifestHash)
 * pair. This module provides that function as a UI modal that
 * shows the user:
 *   - Source did:key (with a copyable short form)
 *   - Manifest fingerprint (the SHA-256 hash of the canonical JSON)
 *   - Capability list — fs paths, network hosts, mesh names,
 *     config domains, memory categories
 *   - Items being deployed (kind:itemId)
 *   - Approve / Deny buttons
 *
 * Returns a Promise resolving to `true` on approve, `false` on deny
 * (clicking outside, Escape, or Cancel).
 *
 * Designed to slot into `installMultiDeviceWiring({promptApprove})`.
 *
 * The DOM markup matches the project's modal-overlay pattern from
 * `clawser-modal.js` so the existing `.modal-overlay`/`.modal-box`
 * dark-theme CSS applies.
 *
 * Tests pass `_doc` to inject a fake DOM. In production the modal
 * uses the live `document`.
 */

const escHtml = (s) => String(s ?? '')
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;');

const shortDid = (did) => {
  if (typeof did !== 'string') return String(did);
  if (did.length <= 24) return did;
  return did.slice(0, 16) + '…' + did.slice(-8);
};

const shortHash = (h) => {
  if (typeof h !== 'string') return String(h);
  return h.length > 16 ? h.slice(0, 8) + '…' + h.slice(-4) : h;
};

/**
 * Render the body HTML for the approval modal. Pure — testable.
 * Exported for tests.
 *
 * @param {{source:string, manifestHash:string, manifest:object}} req
 * @returns {string}
 */
export function renderApprovalBody(req) {
  const m = req?.manifest || {};
  const caps = m.capabilities || {};
  const items = Array.isArray(m.items) ? m.items : [];
  const sourceLabel = m.sourceLabel || '(no label)';

  const capLine = (kind) => {
    const arr = Array.isArray(caps[kind]) ? caps[kind] : [];
    if (arr.length === 0) return `<div class="approval-cap-row"><span class="approval-cap-kind">${kind}</span><span class="approval-cap-none">(none requested)</span></div>`;
    return `<div class="approval-cap-row"><span class="approval-cap-kind">${kind}</span><span class="approval-cap-values">${arr.map(escHtml).join(', ')}</span></div>`;
  };

  return [
    '<div class="approval-modal-content">',
    `<div class="approval-row"><span class="approval-label">Source:</span><span class="approval-value approval-mono" title="${escHtml(req.source)}">${escHtml(sourceLabel)} — ${escHtml(shortDid(req.source))}</span></div>`,
    `<div class="approval-row"><span class="approval-label">Manifest fingerprint:</span><span class="approval-value approval-mono" title="${escHtml(req.manifestHash)}">${escHtml(shortHash(req.manifestHash))}</span></div>`,
    '<div class="approval-section approval-caps">',
    '<div class="approval-section-title">Requested capabilities</div>',
    capLine('fs'),
    capLine('net'),
    capLine('mesh'),
    capLine('config'),
    capLine('memory'),
    '</div>',
    '<div class="approval-section approval-items">',
    '<div class="approval-section-title">Items being deployed</div>',
    items.length === 0
      ? '<div class="approval-cap-none">(no items)</div>'
      : items.map(it => `<div class="approval-item-row"><span class="approval-mono">${escHtml(it.kind)}</span>:<span class="approval-mono">${escHtml(it.itemId)}</span></div>`).join(''),
    '</div>',
    '</div>',
  ].join('');
}

/**
 * Open the approval modal. Resolves to `true` if the user clicks
 * "Approve", `false` otherwise (Deny, Escape, click outside).
 *
 * @param {{source:string, manifestHash:string, manifest:object}} req
 * @param {object} [opts]
 * @param {Document} [opts._doc]   — DOM injection for tests
 * @param {(approved:boolean) => void} [opts._onClose] — test hook fired on close
 * @returns {Promise<boolean>}
 */
export function showApprovalModal(req, opts = {}) {
  const fallbackDoc = (typeof document !== 'undefined' && document?.body && typeof document.createElement === 'function')
    ? document
    : null;
  const doc = opts._doc || fallbackDoc;
  if (!doc || !doc.body || typeof doc.createElement !== 'function') {
    // No usable DOM — auto-deny so callers get a deterministic result
    // rather than hanging. Happens in Node tests without a body shim.
    return Promise.resolve(false);
  }

  return new Promise((resolve) => {
    const overlay = doc.createElement('div');
    overlay.className = 'modal-overlay';
    const box = doc.createElement('div');
    box.className = 'modal-box approval-modal-box';

    box.innerHTML = [
      '<div class="modal-title">Approve deploy from peer?</div>',
      '<div class="modal-body">',
      renderApprovalBody(req),
      'Once approved, future deploys from this peer with the same manifest fingerprint will auto-apply. Manifest changes will re-prompt.',
      '</div>',
      '<div class="modal-btns">',
      '<button class="modal-btn modal-btn-cancel" id="_approval_deny">Deny</button>',
      '<button class="modal-btn modal-btn-ok" id="_approval_approve">Approve</button>',
      '</div>',
    ].join('');

    overlay.appendChild(box);
    doc.body.appendChild(overlay);

    const denyBtn = box.querySelector('#_approval_deny');
    const approveBtn = box.querySelector('#_approval_approve');

    const close = (approved) => {
      overlay.remove();
      try { opts._onClose?.(approved); } catch { /* test hook is best-effort */ }
      resolve(!!approved);
    };

    approveBtn.addEventListener('click', () => close(true));
    denyBtn.addEventListener('click', () => close(false));
    overlay.addEventListener('click', (e) => { if (e.target === overlay) close(false); });
    box.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') close(false);
      if (e.key === 'Enter') close(true);
    });

    // Focus the Deny button by default — defensive UX, makes the
    // user explicitly opt in rather than hit Enter through a default
    // approve.
    if (typeof denyBtn.focus === 'function') {
      try { denyBtn.focus(); } catch { /* tests with stub DOM may lack focus */ }
    }
  });
}

/**
 * Convenience: a `promptApprove` function shaped for
 * `installMultiDeviceWiring`. Calls `showApprovalModal` and resolves
 * to `boolean`.
 *
 * @param {{source:string, manifestHash:string, manifest:object}} req
 * @returns {Promise<boolean>}
 */
export const approvalModalPrompt = (req) => showApprovalModal(req);
