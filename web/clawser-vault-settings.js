import { silentCatch } from './clawser-silent-catch.mjs'
import { state } from './clawser-state.js'
import {
  isPasskeyPRFSupported,
  enrollPasskey,
  assertPasskeyForUnlock,
} from './clawser-passkey.mjs'
/**
 * clawser-vault-settings.js — Settings panel for the vault lock screen.
 *
 * Provides reset-all-data, export vault backup, and import vault backup
 * functionality accessible via a gear icon on the vault modal.
 *
 * @example
 *   import { initVaultSettings } from './clawser-vault-settings.js';
 *   initVaultSettings();            // wire up gear icon + panel
 */

// ── Reset all data ──────────────────────────────────────────────

/**
 * Recursively remove all entries from an OPFS directory.
 * @param {FileSystemDirectoryHandle} dir
 */
const clearOPFSDir = async (dir) => {
  for await (const [name, handle] of dir) {
    if (handle.kind === 'directory') {
      const sub = await dir.getDirectoryHandle(name);
      await clearOPFSDir(sub);
    }
    await dir.removeEntry(name, { recursive: true });
  }
};

/**
 * Nuke every storage mechanism the browser provides.
 * Called after user confirms the destructive action.
 */
const resetAllData = async () => {
  // localStorage
  try { localStorage.clear(); } catch (e) { silentCatch('clawser-vault-settings', 'localStorage.clear', e) }

  // sessionStorage
  try { sessionStorage.clear(); } catch (e) { silentCatch('clawser-vault-settings', 'sessionStorage.clear', e) }

  // OPFS (recursive)
  try {
    const root = await navigator.storage.getDirectory();
    await clearOPFSDir(root);
  } catch { /* OPFS not available or already empty */ }

  // IndexedDB — delete every database
  try {
    const dbs = await indexedDB.databases();
    for (const db of dbs) {
      if (db.name) indexedDB.deleteDatabase(db.name);
    }
  } catch { /* databases() may not be supported */ }

  // Cache API
  try {
    const keys = await caches.keys();
    for (const k of keys) await caches.delete(k);
  } catch (e) { silentCatch('clawser-vault-settings', 'ignore', e) }

  // Unregister service workers
  try {
    const regs = await navigator.serviceWorker?.getRegistrations();
    if (regs) for (const r of regs) await r.unregister();
  } catch (e) { silentCatch('clawser-vault-settings', 'ignore', e) }

  location.reload();
};

/**
 * Show confirmation dialog, then wipe everything.
 * @returns {Promise<void>}
 */
export const confirmAndReset = async () => {
  const ok = window.confirm(
    'Reset all data?\n\nThis will permanently erase all stored data including API keys, conversations, memory, and files. This cannot be undone.'
  );
  if (ok) await resetAllData();
};

// ── Export vault backup ─────────────────────────────────────────

/**
 * Read every .enc file from the clawser_vault OPFS directory and
 * produce a JSON download containing base64-encoded blobs.
 */
const exportVaultBackup = async () => {
  try {
    const root = await navigator.storage.getDirectory();
    let vaultDir;
    try {
      vaultDir = await root.getDirectoryHandle('clawser_vault');
    } catch {
      window.alert('No vault data found to export.');
      return;
    }

    const backup = { version: 1, created: new Date().toISOString(), entries: {} };
    for await (const [name, handle] of vaultDir) {
      if (handle.kind === 'file') {
        const file = await handle.getFile();
        const buf = await file.arrayBuffer();
        const bytes = new Uint8Array(buf);
        let binary = '';
        for (let i = 0; i < bytes.byteLength; i++) {
          binary += String.fromCharCode(bytes[i]);
        }
        backup.entries[name] = btoa(binary);
      }
    }

    const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `clawser-vault-backup-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  } catch (err) {
    window.alert(`Export failed: ${err.message}`);
  }
};

// ── Import vault backup ─────────────────────────────────────────

/**
 * Restore a previously exported vault JSON back into OPFS.
 * @param {File} file
 */
const importVaultBackup = async (file) => {
  try {
    const text = await file.text();
    const backup = JSON.parse(text);
    if (!backup.entries || typeof backup.entries !== 'object') {
      throw new Error('Invalid backup format');
    }

    const root = await navigator.storage.getDirectory();
    const vaultDir = await root.getDirectoryHandle('clawser_vault', { create: true });

    for (const [name, b64] of Object.entries(backup.entries)) {
      const bytes = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
      const fh = await vaultDir.getFileHandle(name, { create: true });
      const writable = await fh.createWritable();
      await writable.write(bytes);
      await writable.close();
    }

    window.alert(`Imported ${Object.keys(backup.entries).length} vault entries. Reload to use.`);
    location.reload();
  } catch (err) {
    window.alert(`Import failed: ${err.message}`);
  }
};

// ── Change passphrase ────────────────────────────────────────────

const MIN_NEW_PASSPHRASE_LENGTH = 12;

/**
 * Pure validation helper for the new-passphrase form. Exported so it can
 * be unit-tested without a DOM. Returns null on valid input or a
 * user-visible error string otherwise.
 *
 * @param {object} input
 * @param {string} input.oldPassphrase
 * @param {string} input.newPassphrase
 * @param {string} input.confirmPassphrase
 * @returns {string|null}
 */
export const validateChangePassphraseInput = ({ oldPassphrase, newPassphrase, confirmPassphrase }) => {
  if (!oldPassphrase) return 'Current passphrase is required';
  if (!newPassphrase) return 'New passphrase is required';
  if (newPassphrase.length < MIN_NEW_PASSPHRASE_LENGTH) {
    return `New passphrase must be at least ${MIN_NEW_PASSPHRASE_LENGTH} characters`;
  }
  if (newPassphrase === oldPassphrase) return 'New passphrase must differ from the current one';
  if (newPassphrase !== confirmPassphrase) return 'New passphrases do not match';
  return null;
};

/**
 * Run a passphrase change against an unlocked-or-lockable vault.
 *
 * Strategy: ensure the vault is unlocked with the old passphrase first
 * (this both verifies the old passphrase and gets a DEK we can rewrap),
 * then call `changePassphrase`. Returns `{ ok, error? }` for the UI.
 *
 * Exported (and the vault is injected) so it's testable without a DOM.
 *
 * @param {object} vault - SecretVault-shaped: isLocked, unlock(), changePassphrase()
 * @param {{ oldPassphrase: string, newPassphrase: string, confirmPassphrase: string }} input
 * @returns {Promise<{ ok: boolean, error?: string }>}
 */
export const performChangePassphrase = async (vault, input) => {
  const validationError = validateChangePassphraseInput(input);
  if (validationError) return { ok: false, error: validationError };
  const { oldPassphrase, newPassphrase } = input;

  // If the vault is locked (user entered settings before unlocking), unlock
  // it with the old passphrase first. If unlock throws, the old passphrase
  // is wrong.
  if (vault.isLocked) {
    try {
      await vault.unlock(oldPassphrase);
    } catch {
      return { ok: false, error: 'Current passphrase is incorrect' };
    }
  }

  try {
    await vault.changePassphrase(oldPassphrase, newPassphrase);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e?.message || 'Failed to change passphrase' };
  }
};

const showChangePassphraseForm = () => {
  const unlockForm = document.getElementById('vaultUnlockForm');
  const changeForm = document.getElementById('vaultChangeForm');
  const settingsPanel = document.getElementById('vaultSettingsPanel');
  const gear = document.getElementById('vaultSettingsGear');
  if (!unlockForm || !changeForm) return;
  unlockForm.style.display = 'none';
  changeForm.style.display = '';
  if (settingsPanel) settingsPanel.style.display = 'none';
  if (gear) gear.classList.remove('active');
  document.getElementById('vaultChangeOld')?.focus();
};

const hideChangePassphraseForm = () => {
  const unlockForm = document.getElementById('vaultUnlockForm');
  const changeForm = document.getElementById('vaultChangeForm');
  if (!unlockForm || !changeForm) return;
  changeForm.style.display = 'none';
  unlockForm.style.display = '';
  // Clear inputs so secrets don't linger in the DOM
  for (const id of ['vaultChangeOld', 'vaultChangeNew', 'vaultChangeConfirm']) {
    const el = document.getElementById(id);
    if (el) el.value = '';
  }
  const err = document.getElementById('vaultChangeError');
  if (err) { err.textContent = ''; err.style.display = 'none'; }
};

const wireChangePassphraseForm = () => {
  const form = document.getElementById('vaultChangeForm');
  if (!form || form._wired) return;
  form._wired = true;
  const cancelBtn = document.getElementById('vaultChangeCancel');
  const errEl = document.getElementById('vaultChangeError');

  cancelBtn?.addEventListener('click', (e) => {
    e.preventDefault();
    hideChangePassphraseForm();
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const oldPassphrase = document.getElementById('vaultChangeOld').value;
    const newPassphrase = document.getElementById('vaultChangeNew').value;
    const confirmPassphrase = document.getElementById('vaultChangeConfirm').value;

    if (errEl) { errEl.textContent = ''; errEl.style.display = 'none'; }

    const vault = state?.vault;
    if (!vault) {
      if (errEl) { errEl.textContent = 'Vault not available'; errEl.style.display = ''; }
      return;
    }

    const result = await performChangePassphrase(vault, {
      oldPassphrase, newPassphrase, confirmPassphrase,
    });
    if (!result.ok) {
      if (errEl) { errEl.textContent = result.error; errEl.style.display = ''; }
      return;
    }

    // Success — clear inputs, close the modal.
    hideChangePassphraseForm();
    const modal = document.getElementById('vaultModal');
    if (modal && typeof modal.close === 'function') modal.close();
  });
};

// ── Passkey enrollment / unlock ──────────────────────────────────

/**
 * Pure helper for the passkey-list rendering layer. Given an array of
 * wrap entries (as returned by `vault.listWraps()`), returns a list of
 * objects ready for the UI to render: `{id, label, isPasskey, lastUsedLabel}`.
 *
 * Exported for unit testing without a DOM.
 *
 * @param {Array<{id:string,kind:string,label:string|null,createdAt:number,lastUsedAt:number|null}>} wraps
 * @param {(ts:number) => string} [formatTs] - Override for deterministic tests
 * @returns {Array<{id:string,label:string,isPasskey:boolean,lastUsedLabel:string}>}
 */
export const buildPasskeyListItems = (wraps, formatTs) => {
  const fmt = formatTs || ((ts) => new Date(ts).toLocaleString());
  return wraps
    .filter(w => w.kind === 'passkey')
    .map(w => ({
      id: w.id,
      label: w.label || 'Unlabeled passkey',
      isPasskey: true,
      lastUsedLabel: w.lastUsedAt ? `Last used ${fmt(w.lastUsedAt)}` : 'Never used',
    }));
};

const renderPasskeyList = () => {
  const listEl = document.getElementById('vaultPasskeyList');
  if (!listEl) return;
  listEl.innerHTML = '';
  const vault = state?.vault;
  if (!vault || vault.isLocked) {
    listEl.textContent = 'Unlock the vault to manage passkeys.';
    return;
  }
  const items = buildPasskeyListItems(vault.listWraps());
  if (items.length === 0) {
    listEl.textContent = 'No passkeys registered.';
    return;
  }
  for (const item of items) {
    const row = document.createElement('div');
    row.className = 'vault-passkey-row';
    const meta = document.createElement('div');
    meta.className = 'vault-passkey-meta';
    const labelEl = document.createElement('div');
    labelEl.className = 'vault-passkey-label';
    labelEl.textContent = item.label;
    const subEl = document.createElement('div');
    subEl.className = 'vault-passkey-sub';
    subEl.textContent = item.lastUsedLabel;
    meta.appendChild(labelEl);
    meta.appendChild(subEl);
    const removeBtn = document.createElement('button');
    removeBtn.type = 'button';
    removeBtn.className = 'btn-sm btn-surface2';
    removeBtn.textContent = 'Remove';
    removeBtn.addEventListener('click', async () => {
      try {
        await vault.removeWrap(item.id);
        renderPasskeyList();
      } catch (e) {
        const errEl = document.getElementById('vaultPasskeyError');
        if (errEl) { errEl.textContent = e.message; errEl.style.display = ''; }
      }
    });
    row.appendChild(meta);
    row.appendChild(removeBtn);
    listEl.appendChild(row);
  }
};

const showPasskeysForm = () => {
  const unlockForm = document.getElementById('vaultUnlockForm');
  const changeForm = document.getElementById('vaultChangeForm');
  const passkeysForm = document.getElementById('vaultPasskeysForm');
  const settingsPanel = document.getElementById('vaultSettingsPanel');
  if (unlockForm) unlockForm.style.display = 'none';
  if (changeForm) changeForm.style.display = 'none';
  if (settingsPanel) settingsPanel.style.display = 'none';
  if (passkeysForm) passkeysForm.style.display = '';
  renderPasskeyList();
};

const hidePasskeysForm = () => {
  const unlockForm = document.getElementById('vaultUnlockForm');
  const passkeysForm = document.getElementById('vaultPasskeysForm');
  if (passkeysForm) passkeysForm.style.display = 'none';
  if (unlockForm) unlockForm.style.display = '';
  const errEl = document.getElementById('vaultPasskeyError');
  if (errEl) { errEl.textContent = ''; errEl.style.display = 'none'; }
};

const handleAddPasskey = async () => {
  const errEl = document.getElementById('vaultPasskeyError');
  const setError = (msg) => { if (errEl) { errEl.textContent = msg; errEl.style.display = msg ? '' : 'none'; } };
  setError('');
  const vault = state?.vault;
  if (!vault) return setError('Vault not available');
  if (vault.isLocked) return setError('Unlock the vault first');
  if (!isPasskeyPRFSupported()) {
    return setError('This browser does not support passkeys with the PRF extension.');
  }
  try {
    const prfSalt = await vault.getOrCreatePrfSalt();
    const label = prompt('Label for this passkey (e.g. "MacBook Touch ID"):', 'Passkey');
    if (label === null) return; // user cancelled
    const enrolled = await enrollPasskey({ prfSalt, label: label || 'Passkey' });
    await vault.addPasskeyWrap({
      credentialId: enrolled.credentialId,
      prfOutput: enrolled.prfOutput,
      label: enrolled.label,
    });
    renderPasskeyList();
  } catch (e) {
    setError(e.message || 'Failed to add passkey');
  }
};

const handleUnlockWithPasskey = async () => {
  const errEl = document.getElementById('vaultError');
  const setError = (msg) => { if (errEl) { errEl.textContent = msg; errEl.style.display = msg ? '' : 'none'; } };
  setError('');
  const vault = state?.vault;
  if (!vault) return setError('Vault not available');
  if (!isPasskeyPRFSupported()) {
    return setError('Passkey unlock is not supported in this browser.');
  }
  try {
    const allowCredentialIds = await vault.peekPasskeyCredentialIds();
    const prfSalt = await vault.peekPrfSalt();
    if (!allowCredentialIds.length || !prfSalt) {
      return setError('No passkeys are registered for this vault.');
    }
    const asserted = await assertPasskeyForUnlock({ allowCredentialIds, prfSalt });
    await vault.unlockWithPasskey(asserted.credentialId, asserted.prfOutput);
    if (typeof vault.resetIdleTimer === 'function') vault.resetIdleTimer();
    const modal = document.getElementById('vaultModal');
    if (modal && typeof modal.close === 'function') modal.close();
  } catch (e) {
    setError(e.message || 'Passkey unlock failed');
  }
};

const wirePasskeysForm = () => {
  const form = document.getElementById('vaultPasskeysForm');
  if (!form || form._wired) return;
  form._wired = true;
  document.getElementById('vaultPasskeysClose')?.addEventListener('click', hidePasskeysForm);
  document.getElementById('vaultPasskeyAddBtn')?.addEventListener('click', handleAddPasskey);
};

/**
 * Show the "Unlock with passkey" button on the lock screen if any
 * passkey wraps exist for this vault. Safe to call on every modal show.
 *
 * @param {object} vault - SecretVault-shaped (peekPasskeyCredentialIds)
 */
export const updatePasskeyUnlockButton = async (vault) => {
  const btn = document.getElementById('vaultUnlockWithPasskey');
  if (!btn) return;
  if (!vault || typeof vault.peekPasskeyCredentialIds !== 'function') {
    btn.style.display = 'none';
    return;
  }
  try {
    const ids = await vault.peekPasskeyCredentialIds();
    btn.style.display = (ids.length && isPasskeyPRFSupported()) ? '' : 'none';
  } catch {
    btn.style.display = 'none';
  }
};

// ── Panel wiring ────────────────────────────────────────────────

/**
 * Attach event listeners to the gear icon and settings panel buttons
 * inside the vault modal. Call once after DOM is ready.
 */
export const initVaultSettings = () => {
  const gear = document.getElementById('vaultSettingsGear');
  const panel = document.getElementById('vaultSettingsPanel');
  if (!gear || !panel) return;

  // Toggle panel visibility
  gear.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    const open = panel.style.display !== 'none';
    panel.style.display = open ? 'none' : 'block';
    gear.classList.toggle('active', !open);
  });

  // Change passphrase
  const changePassBtn = document.getElementById('vaultChangePassBtn');
  if (changePassBtn) {
    wireChangePassphraseForm();
    changePassBtn.addEventListener('click', () => showChangePassphraseForm());
  }

  // Passkeys
  const passkeysBtn = document.getElementById('vaultManagePasskeysBtn');
  if (passkeysBtn) {
    wirePasskeysForm();
    passkeysBtn.addEventListener('click', () => showPasskeysForm());
  }

  // Unlock-with-passkey button on the lock screen
  const unlockWithPasskeyBtn = document.getElementById('vaultUnlockWithPasskey');
  if (unlockWithPasskeyBtn) {
    unlockWithPasskeyBtn.addEventListener('click', () => handleUnlockWithPasskey());
  }

  // Reset button
  const resetBtn = document.getElementById('vaultResetBtn');
  if (resetBtn) resetBtn.addEventListener('click', () => confirmAndReset());

  // Export button
  const exportBtn = document.getElementById('vaultExportBtn');
  if (exportBtn) exportBtn.addEventListener('click', () => exportVaultBackup());

  // Import file input
  const importInput = document.getElementById('vaultImportInput');
  const importBtn = document.getElementById('vaultImportBtn');
  if (importBtn && importInput) {
    importBtn.addEventListener('click', () => importInput.click());
    importInput.addEventListener('change', () => {
      if (importInput.files?.[0]) {
        importVaultBackup(importInput.files[0]);
        importInput.value = '';
      }
    });
  }

  // Close panel when clicking outside
  document.addEventListener('click', (e) => {
    if (panel.style.display !== 'none' && !panel.contains(e.target) && e.target !== gear) {
      panel.style.display = 'none';
      gear.classList.remove('active');
    }
  });
};
