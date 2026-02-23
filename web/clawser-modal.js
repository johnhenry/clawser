// clawser-modal.js — Modal dialogs (replaces window.alert/confirm/prompt)
import { esc } from './clawser-state.js';

/** Modal dialog system replacing window.alert/confirm/prompt with async Promise-based equivalents. */
export const modal = {
  /** @private Create and display a modal dialog. @param {Object} opts @returns {Promise<*>} Resolves on close */
  _show(opts) {
    return new Promise(resolve => {
      const overlay = document.createElement('div');
      overlay.className = 'modal-overlay';
      const box = document.createElement('div');
      box.className = 'modal-box';

      let html = '';
      if (opts.title) html += `<div class="modal-title">${esc(opts.title)}</div>`;
      if (opts.body) html += `<div class="modal-body">${esc(opts.body)}</div>`;
      if (opts.input !== undefined) {
        html += `<input class="modal-input" id="_modal_input" type="text" value="${esc(opts.input)}" />`;
      }
      html += '<div class="modal-btns">';
      if (opts.showCancel) {
        html += `<button class="modal-btn modal-btn-cancel" id="_modal_cancel">${esc(opts.cancelLabel || 'Cancel')}</button>`;
      }
      const okClass = opts.danger ? 'modal-btn-danger' : 'modal-btn-ok';
      html += `<button class="modal-btn ${okClass}" id="_modal_ok">${esc(opts.okLabel || 'OK')}</button>`;
      html += '</div>';
      box.innerHTML = html;
      overlay.appendChild(box);
      document.body.appendChild(overlay);

      const inputEl = box.querySelector('#_modal_input');
      const okBtn = box.querySelector('#_modal_ok');
      const cancelBtn = box.querySelector('#_modal_cancel');

      function close(value) { overlay.remove(); resolve(value); }

      okBtn.addEventListener('click', () => {
        if (inputEl) close(inputEl.value);
        else close(true);
      });
      if (cancelBtn) cancelBtn.addEventListener('click', () => close(opts.input !== undefined ? null : false));
      overlay.addEventListener('click', (e) => { if (e.target === overlay) close(opts.input !== undefined ? null : false); });

      if (inputEl) {
        inputEl.focus();
        inputEl.select();
        inputEl.addEventListener('keydown', (e) => {
          if (e.key === 'Enter') okBtn.click();
          if (e.key === 'Escape') { if (cancelBtn) cancelBtn.click(); else close(null); }
        });
      } else {
        okBtn.focus();
        okBtn.addEventListener('keydown', (e) => {
          if (e.key === 'Escape' && cancelBtn) cancelBtn.click();
        });
      }
    });
  },
  /** Show an alert dialog. @param {string} body @param {Object} [opts] @returns {Promise<true>} */
  alert(body, opts = {}) {
    return this._show({ body, title: opts.title, okLabel: opts.okLabel || 'OK', showCancel: false, ...opts });
  },
  /** Show a confirm dialog with OK/Cancel. @param {string} body @param {Object} [opts] @returns {Promise<boolean>} */
  confirm(body, opts = {}) {
    return this._show({ body, title: opts.title, okLabel: opts.okLabel || 'OK', showCancel: true, cancelLabel: opts.cancelLabel || 'Cancel', danger: opts.danger, ...opts });
  },
  /** Show a prompt dialog with text input. @param {string} body @param {string} [defaultValue=''] @param {Object} [opts] @returns {Promise<string|null>} Input value or null if cancelled */
  prompt(body, defaultValue = '', opts = {}) {
    return this._show({ body, title: opts.title, input: defaultValue, okLabel: opts.okLabel || 'OK', showCancel: true, cancelLabel: opts.cancelLabel || 'Cancel', ...opts });
  },
};
