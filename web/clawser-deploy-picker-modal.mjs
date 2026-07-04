/**
 * clawser-deploy-picker-modal.mjs — item picker modal for "Deploy now".
 *
 * Three sections (skills / configs / memory items) with checkboxes.
 * Capabilities are declared explicitly per-item by the user — NO
 * automatic capability inference from item content. The modal shows
 * a "Capabilities being requested" preview that updates as items
 * toggle, but the actual capability values come from the user's
 * declarations or sensible per-kind defaults (configs: list of
 * domain names; memory: list of categories; skills: empty by default
 * since we explicitly don't infer).
 *
 * Returns `{items, manifest}` on confirm; `null` on cancel.
 */

const escHtml = (s) => String(s ?? '')
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;');

/**
 * @typedef {object} PickerItemRef
 * @property {'skill'|'config'|'memory'} kind
 * @property {string} itemId
 * @property {string} [label]
 * @property {*}      payload
 */

/**
 * Build the manifest capabilities from selected items. Per the user's
 * "no magic capability inference" decision, this is purely
 * declarative:
 *   - configs contribute their domain to `capabilities.config[]`
 *   - memory items contribute their category to `capabilities.memory[]`
 *   - skills contribute nothing — skill-specific runtime caps (fs/net/mesh)
 *     would be source-author work, not picker inference
 *
 * Exported for unit testing without DOM.
 *
 * @param {PickerItemRef[]} items
 * @returns {{fs:string[], net:string[], mesh:string[], config:string[], memory:string[]}}
 */
export function deriveCapabilities(items) {
  const config = new Set();
  const memory = new Set();
  for (const it of items) {
    if (it.kind === 'config') config.add(it.itemId);
    else if (it.kind === 'memory' && it.payload?.category) memory.add(it.payload.category);
  }
  return {
    fs: [], net: [], mesh: [],
    config: [...config].sort(),
    memory: [...memory].sort(),
  };
}

/**
 * Render the picker modal body. Pure / testable.
 *
 * @param {{
 *   skills: PickerItemRef[],
 *   configs: PickerItemRef[],
 *   memory: PickerItemRef[],
 *   selected?: Set<string>,
 *   capabilities?: object
 * }} state
 * @returns {string}
 */
export function renderPickerBody(state) {
  const { skills = [], configs = [], memory = [], selected = new Set(), capabilities } = state || {};
  const checkbox = (it) => {
    const fid = `${it.kind}:${it.itemId}`;
    const checked = selected.has(fid) ? 'checked' : '';
    const label = it.label || it.itemId;
    return `<label class="pck-item-row"><input type="checkbox" data-pck-item="${escHtml(fid)}" ${checked} /><span class="pck-item-label">${escHtml(label)}</span><span class="pck-item-id pck-mono">${escHtml(it.itemId)}</span></label>`;
  };
  const section = (title, arr) => arr.length === 0
    ? `<div class="pck-section"><div class="pck-section-title">${title}</div><div class="pck-empty">(none)</div></div>`
    : `<div class="pck-section"><div class="pck-section-title">${title}</div>${arr.map(checkbox).join('')}</div>`;

  const caps = capabilities || deriveCapabilities([]);
  const capLine = (kind) => {
    const arr = Array.isArray(caps[kind]) ? caps[kind] : [];
    if (arr.length === 0) return `<div class="pck-cap-row"><span class="pck-cap-kind">${kind}</span><span class="pck-cap-none">(none)</span></div>`;
    return `<div class="pck-cap-row"><span class="pck-cap-kind">${kind}</span><span class="pck-cap-values">${arr.map(escHtml).join(', ')}</span></div>`;
  };

  return [
    '<div class="pck-modal-content">',
    section('Skills', skills),
    section('Configs', configs),
    section('Memory items', memory),
    '<div class="pck-section pck-cap-preview">',
    '<div class="pck-section-title">Capabilities being requested</div>',
    capLine('fs'), capLine('net'), capLine('mesh'), capLine('config'), capLine('memory'),
    '</div>',
    '</div>',
  ].join('');
}

/**
 * Open the picker modal. Resolves to `{items, manifest}` on confirm,
 * `null` on cancel/close.
 *
 * @param {object} args
 * @param {PickerItemRef[]} args.skills
 * @param {PickerItemRef[]} args.configs
 * @param {PickerItemRef[]} args.memory
 * @param {string} [args.sourceLabel]
 * @param {Document} [args._doc]
 * @returns {Promise<{items:PickerItemRef[], manifest:object}|null>}
 */
export function showPickerModal(args = {}) {
  const fallbackDoc = (typeof document !== 'undefined' && document?.body && typeof document.createElement === 'function')
    ? document : null;
  const doc = args._doc || fallbackDoc;
  if (!doc || !doc.body || typeof doc.createElement !== 'function') {
    return Promise.resolve(null);
  }

  const allItems = [
    ...(args.skills || []),
    ...(args.configs || []),
    ...(args.memory || []),
  ];
  const byFid = new Map(allItems.map(it => [`${it.kind}:${it.itemId}`, it]));

  return new Promise((resolve) => {
    const selected = new Set();
    const overlay = doc.createElement('div');
    overlay.className = 'modal-overlay';
    const box = doc.createElement('div');
    box.className = 'modal-box pck-modal-box';

    const refresh = () => {
      const items = [...selected].map(fid => byFid.get(fid)).filter(Boolean);
      const caps = deriveCapabilities(items);
      box.innerHTML = [
        '<div class="modal-title">Pick items to deploy</div>',
        '<div class="modal-body">',
        renderPickerBody({
          skills: args.skills || [],
          configs: args.configs || [],
          memory: args.memory || [],
          selected,
          capabilities: caps,
        }),
        '</div>',
        '<div class="modal-btns">',
        '<button class="modal-btn modal-btn-cancel" id="_pck_cancel">Cancel</button>',
        `<button class="modal-btn modal-btn-ok" id="_pck_ok"${items.length === 0 ? ' disabled' : ''}>Deploy ${items.length} item(s)</button>`,
        '</div>',
      ].join('');

      const cancelBtn = box.querySelector('#_pck_cancel');
      const okBtn = box.querySelector('#_pck_ok');
      cancelBtn.addEventListener('click', () => { overlay.remove(); resolve(null); });
      okBtn.addEventListener('click', () => {
        overlay.remove();
        resolve({
          items,
          manifest: {
            sourceLabel: args.sourceLabel || 'Picker deploy',
            items: items.map(it => ({ kind: it.kind, itemId: it.itemId })),
            capabilities: caps,
            createdAt: Date.now(),
          },
        });
      });
      // Re-bind checkboxes
      box.querySelectorAll('input[type="checkbox"]').forEach(cb => {
        cb.addEventListener('change', () => {
          const fid = cb.getAttribute('data-pck-item');
          if (cb.checked) selected.add(fid); else selected.delete(fid);
          refresh();
        });
      });
    };

    overlay.appendChild(box);
    doc.body.appendChild(overlay);
    refresh();

    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) { overlay.remove(); resolve(null); }
    });
  });
}
