/**
 * clawser-ui-files.js — OPFS file browser panel
 *
 * Renders the OPFS file browser for the active workspace with click-to-preview,
 * mount/unmount local directories, and mount list rendering.
 */
import { $, esc, state } from './clawser-state.js';
import { modal } from './clawser-modal.js';
import { addMsg, addErrorMsg } from './clawser-ui-chat.js';

// ── OPFS file browser ──────────────────────────────────────────
const HIDDEN_DIRS = new Set(['.checkpoints', '.skills', '.conversations']);

/** Render the OPFS file browser for the active workspace, with click-to-preview.
 * @param {string} [path='/'] - Directory path relative to workspace root
 * @param {HTMLElement} [el] - Container element (defaults to #fileList)
 */
export async function refreshFiles(path = '/', el = null) {
  if (!el) el = $('fileList');
  try {
    const root = await navigator.storage.getDirectory();

    let wsDir;
    try {
      const base = await root.getDirectoryHandle('clawser_workspaces');
      const wsId = state.agent?.getWorkspace() || 'default';
      wsDir = await base.getDirectoryHandle(wsId);
    } catch {
      el.textContent = '(empty — files created by the agent will appear here)';
      return;
    }

    let dir = wsDir;
    if (path !== '/') {
      for (const part of path.replace(/^\//, '').split('/').filter(Boolean)) {
        dir = await dir.getDirectoryHandle(part);
      }
    }
    el.innerHTML = '';
    if (path !== '/') {
      const back = document.createElement('div');
      back.className = 'file-back';
      back.textContent = '.. (back)';
      const parentPath = path.replace(/[^/]+\/$/, '') || '/';
      back.addEventListener('click', () => refreshFiles(parentPath, el));
      el.appendChild(back);
    }
    let count = 0;
    for await (const [name, handle] of dir) {
      if (path === '/' && HIDDEN_DIRS.has(name)) continue;
      count++;
      const d = document.createElement('div');
      d.className = 'file-item';
      const icon = handle.kind === 'directory' ? '\u{1F4C1}' : '\u{1F4C4}';
      d.textContent = `${icon} ${name}`;
      d.addEventListener('click', async () => {
        if (handle.kind === 'directory') {
          await refreshFiles(`${path}${name}/`, el);
        } else {
          try {
            const file = await handle.getFile();
            if (file.name.endsWith('.bin') || file.name.endsWith('.wasm') || file.size > 100000) {
              el.insertAdjacentHTML('afterbegin',
                `<div class="file-binary-info">${esc(name)}: ${(file.size / 1024).toFixed(1)} KB (binary)</div>`);
            } else {
              const text = await file.text();
              el.insertAdjacentHTML('afterbegin',
                `<div class="file-preview"><div class="file-preview-name">${esc(name)}</div>${esc(text.slice(0, 2000))}</div>`);
            }
          } catch (e) { console.debug('[clawser] file preview error', e); }
        }
      });
      el.appendChild(d);
    }
    if (count === 0) el.textContent = '(empty — files created by the agent will appear here)';
  } catch (e) {
    el.textContent = `Error: ${e.message}`;
  }
}

// ── Mount local folder (Block 2) ─────────────────────────────────
/** Prompt user to pick a local directory and mount it into the workspace FS. */
export async function mountLocalFolder() {
  if (!window.showDirectoryPicker) {
    addErrorMsg('showDirectoryPicker not supported in this browser.');
    return;
  }
  try {
    const handle = await window.showDirectoryPicker({ mode: 'readwrite' });
    const mountPoint = await modal.prompt('Mount point (under /mnt/):', `/mnt/${handle.name}`);
    if (!mountPoint) return;
    state.workspaceFs.mount(mountPoint, handle);
    renderMountList();
    refreshFiles();
    addMsg('system', `Mounted "${handle.name}" at ${mountPoint}`);
  } catch (e) {
    if (e.name !== 'AbortError') addErrorMsg(`Mount failed: ${e.message}`);
  }
}

/** Render the list of active mounts with unmount buttons. */
export function renderMountList() {
  const el = $('mountList');
  if (!el) return;
  el.innerHTML = '';
  if (!state.workspaceFs?.mountTable) return;
  const mounts = state.workspaceFs.mountTable;
  if (mounts.length === 0) return;
  for (const m of mounts) {
    const d = document.createElement('div');
    d.className = 'mount-item';
    d.innerHTML = `<span class="mount-point">${esc(m.path)}</span><span style="color:var(--dim);font-size:10px;">${esc(m.name)}${m.readOnly ? ' (ro)' : ''}</span>`;
    const btn = document.createElement('button');
    btn.className = 'mount-unmount';
    btn.textContent = '\u2715';
    btn.title = 'Unmount';
    btn.addEventListener('click', () => {
      state.workspaceFs.unmount(m.path);
      renderMountList();
      refreshFiles();
      addMsg('system', `Unmounted ${m.path}`);
    });
    d.appendChild(btn);
    el.appendChild(d);
  }
}
