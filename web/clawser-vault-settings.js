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

import { modal } from './clawser-modal.js';

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
  try { localStorage.clear(); } catch { /* ignore */ }

  // sessionStorage
  try { sessionStorage.clear(); } catch { /* ignore */ }

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
  } catch { /* ignore */ }

  // Unregister service workers
  try {
    const regs = await navigator.serviceWorker?.getRegistrations();
    if (regs) for (const r of regs) await r.unregister();
  } catch { /* ignore */ }

  location.reload();
};

/**
 * Show confirmation dialog, then wipe everything.
 * @returns {Promise<void>}
 */
export const confirmAndReset = async () => {
  const ok = await modal.confirm(
    'This will permanently erase all stored data including API keys, conversations, memory, and files. This cannot be undone. Continue?',
    { title: 'Reset all data', okLabel: 'Reset', danger: true }
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
      await modal.alert('No vault data found to export.');
      return;
    }

    const backup = { version: 1, created: new Date().toISOString(), entries: {} };
    for await (const [name, handle] of vaultDir) {
      if (handle.kind === 'file') {
        const file = await handle.getFile();
        const buf = await file.arrayBuffer();
        backup.entries[name] = btoa(String.fromCharCode(...new Uint8Array(buf)));
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
    await modal.alert(`Export failed: ${err.message}`);
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

    await modal.alert(`Imported ${Object.keys(backup.entries).length} vault entries. Reload to use.`);
    location.reload();
  } catch (err) {
    await modal.alert(`Import failed: ${err.message}`);
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
