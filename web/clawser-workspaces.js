// clawser-workspaces.js — Workspace registry with OPFS-first persistence
//
// Per UFS §2.2, the canonical source of truth for the workspace registry is
// `/etc/clawser/workspaces.json` in OPFS, with `/etc/clawser/active-workspace`
// holding the active workspace ID. localStorage is a one-time migration
// source on first run and a read-only fallback for one release.
//
// Synchronous accessors (`loadWorkspaces`, `getActiveWorkspaceId`,
// `getWorkspaceName`, etc.) read from an in-memory cache. The cache must be
// primed by awaiting `initWorkspacesCache()` at app init. Writes update the
// cache synchronously and schedule an async OPFS write in the background.
//
// Disposable mode skips OPFS entirely and uses the existing sessionStorage
// adapter.

import { lsKey } from './clawser-state.js';
import { getStorage } from './clawser-disposable.js';

export const WS_KEY = 'clawser_workspaces';
export const WS_ACTIVE_KEY = 'clawser_active_workspace';

const OPFS_WORKSPACES_PATH = 'clawser/etc/clawser/workspaces.json';
const OPFS_ACTIVE_PATH = 'clawser/etc/clawser/active-workspace';

// ── In-memory cache ────────────────────────────────────────────────

let _workspaces = null; // Array<Workspace> or null until init
let _activeId = null;   // string or null until init
let _initialised = false;

const isDisposable = () => {
  try {
    if (typeof window === 'undefined') return false;
    const params = new URL(window.location.href).searchParams;
    return params.has('disposable') && params.get('disposable') !== 'false';
  } catch { return false; }
};

// ── OPFS helpers ───────────────────────────────────────────────────

const readOpfsFile = async (path) => {
  if (typeof navigator === 'undefined' || !navigator.storage?.getDirectory) return null;
  const root = await navigator.storage.getDirectory();
  const parts = path.split('/').filter(Boolean);
  let dir = root;
  for (let i = 0; i < parts.length - 1; i++) {
    try { dir = await dir.getDirectoryHandle(parts[i]); } catch { return null; }
  }
  try {
    const fh = await dir.getFileHandle(parts[parts.length - 1]);
    const file = await fh.getFile();
    return await file.text();
  } catch { return null; }
};

const writeOpfsFile = async (path, content) => {
  if (typeof navigator === 'undefined' || !navigator.storage?.getDirectory) return;
  const root = await navigator.storage.getDirectory();
  const parts = path.split('/').filter(Boolean);
  let dir = root;
  for (let i = 0; i < parts.length - 1; i++) {
    dir = await dir.getDirectoryHandle(parts[i], { create: true });
  }
  const fh = await dir.getFileHandle(parts[parts.length - 1], { create: true });
  const writable = await fh.createWritable();
  await writable.write(content);
  await writable.close();
};

// ── Initialisation ─────────────────────────────────────────────────

/**
 * Prime the in-memory cache from OPFS, falling back to a one-time migration
 * from localStorage if OPFS is empty. Idempotent.
 *
 * @returns {Promise<void>}
 *
 * @example
 *   await initWorkspacesCache();
 *   const list = loadWorkspaces();
 */
export async function initWorkspacesCache() {
  if (_initialised) return;
  _initialised = true;

  // Disposable mode never touches OPFS.
  if (isDisposable()) {
    try { _workspaces = JSON.parse(getStorage().getItem(WS_KEY)) || []; } catch { _workspaces = []; }
    _activeId = getStorage().getItem(WS_ACTIVE_KEY) || 'default';
    return;
  }

  // Try OPFS first.
  try {
    const opfsText = await readOpfsFile(OPFS_WORKSPACES_PATH);
    if (opfsText) {
      _workspaces = JSON.parse(opfsText);
      const activeText = await readOpfsFile(OPFS_ACTIVE_PATH);
      _activeId = (activeText || '').trim() || 'default';
      return;
    }
  } catch {
    // OPFS read failed — fall through to localStorage.
  }

  // OPFS empty: migrate from localStorage if present.
  let lsList = [];
  try { lsList = JSON.parse(localStorage.getItem(WS_KEY)) || []; } catch {}
  const lsActive = localStorage.getItem(WS_ACTIVE_KEY) || 'default';

  _workspaces = lsList;
  _activeId = lsActive;

  if (lsList.length > 0) {
    // One-time migration: write to OPFS so subsequent runs read from there.
    persistAsync();
  }
}

const persistAsync = () => {
  if (isDisposable()) {
    try { getStorage().setItem(WS_KEY, JSON.stringify(_workspaces || [])); } catch {}
    try { getStorage().setItem(WS_ACTIVE_KEY, _activeId || 'default'); } catch {}
    return;
  }
  // Background OPFS write — never throw.
  Promise.resolve().then(async () => {
    try {
      await writeOpfsFile(OPFS_WORKSPACES_PATH, JSON.stringify(_workspaces || []));
      await writeOpfsFile(OPFS_ACTIVE_PATH, _activeId || 'default');
    } catch (e) {
      console.warn('[clawser] workspaces OPFS write failed:', e?.message || e);
    }
  });
};

/** Reset internal state — for tests only. @internal */
export const __resetForTests = () => {
  _workspaces = null;
  _activeId = null;
  _initialised = false;
};

// ── Synchronous accessors (cache-backed) ───────────────────────────

/**
 * Load all workspaces from the cache. Falls back to a synchronous
 * localStorage read if the cache has never been touched — legacy
 * behaviour preserved for early-boot callers.
 *
 * @returns {Array<Object>}
 */
export function loadWorkspaces() {
  if (_workspaces !== null) return [..._workspaces];
  try { return JSON.parse(getStorage().getItem(WS_KEY)) || []; } catch { return []; }
}

/**
 * Persist the workspace list. Updates the cache synchronously and schedules
 * an async OPFS write.
 * @param {Array<Object>} list
 */
export function saveWorkspaces(list) {
  _workspaces = [...list];
  persistAsync();
}

export function getActiveWorkspaceId() {
  if (_activeId !== null) return _activeId;
  return getStorage().getItem(WS_ACTIVE_KEY) || 'default';
}

export function setActiveWorkspaceId(id) {
  _activeId = id;
  persistAsync();
}

/** Ensure a 'default' workspace exists, migrating legacy data if needed. @returns {Array<Object>} */
export function ensureDefaultWorkspace() {
  let list = loadWorkspaces();
  if (!list.find(w => w.id === 'default')) {
    list.unshift({ id: 'default', name: 'workspace', created: Date.now(), lastUsed: Date.now() });
    saveWorkspaces(list);
    // Migrate old non-namespaced data to default workspace
    const s = getStorage();
    const oldMem = s.getItem('clawser_memories');
    if (oldMem) { s.setItem(lsKey.memories('default'), oldMem); s.removeItem('clawser_memories'); }
    const oldCfg = s.getItem('clawser_config');
    if (oldCfg) { s.setItem(lsKey.config('default'), oldCfg); s.removeItem('clawser_config'); }
  }
  return list;
}

/** Create a new workspace and persist it. @param {string} [name] @returns {string} New workspace ID */
export function createWorkspace(name) {
  const id = `ws_${Date.now().toString(36)}_${crypto.randomUUID().slice(0, 4)}`;
  const list = loadWorkspaces();
  list.push({ id, name: name || `workspace ${list.length + 1}`, created: Date.now(), lastUsed: Date.now() });
  saveWorkspaces(list);
  return id;
}

/** Rename a workspace. @param {string} id @param {string} newName */
export function renameWorkspace(id, newName) {
  const list = loadWorkspaces();
  const ws = list.find(w => w.id === id);
  if (ws) { ws.name = newName; saveWorkspaces(list); }
}

/** Delete a workspace and clean up all persisted data (localStorage + OPFS). No-op for 'default'. @param {string} id */
export async function deleteWorkspace(id) {
  if (id === 'default') return; // can't delete default
  let list = loadWorkspaces();
  list = list.filter(w => w.id !== id);
  saveWorkspaces(list);
  // Clean up persisted data — versioned keys via lsKey
  const s = getStorage();
  s.removeItem(lsKey.memories(id));
  s.removeItem(lsKey.config(id));
  s.removeItem(lsKey.toolPerms(id));
  s.removeItem(lsKey.security(id));
  s.removeItem(lsKey.skillsEnabled(id));
  s.removeItem(lsKey.autonomy(id));
  s.removeItem(lsKey.identity(id));
  s.removeItem(lsKey.selfRepair(id));
  s.removeItem(lsKey.sandbox(id));
  s.removeItem(lsKey.heartbeat(id));
  s.removeItem(lsKey.routines(id));
  s.removeItem(lsKey.termSessions(id));
  s.removeItem(lsKey.hooks(id));
  s.removeItem(lsKey.peripherals(id));
  s.removeItem(lsKey.showDotfiles(id));
  // Clean up legacy unversioned keys
  s.removeItem(`clawser_conversations_${id}`);
  s.removeItem(`clawser_tool_perms_${id}`);
  s.removeItem(`clawser_skills_enabled_${id}`);
  s.removeItem(`clawser_active_conversation_${id}`);
  s.removeItem(`clawser_goals_${id}`);
  s.removeItem(`clawser_log_${id}`);
  try {
    const root = await navigator.storage.getDirectory();
    // New slash-based namespace
    try {
      const clawserRoot = await root.getDirectoryHandle('clawser');
      const wsRoot = await clawserRoot.getDirectoryHandle('workspaces');
      await wsRoot.removeEntry(id, { recursive: true });
    } catch (e) { console.debug('[clawser] OPFS workspace cleanup:', e); }
    // Legacy underscore-separated namespace (migration compat)
    try {
      const base = await root.getDirectoryHandle('clawser_workspaces');
      await base.removeEntry(id, { recursive: true });
    } catch (e) { /* old structure may not exist */ }
    try {
      const dir = await root.getDirectoryHandle('clawser_checkpoints');
      await dir.removeEntry(id, { recursive: true });
    } catch (e) { console.debug('[clawser] OPFS checkpoint cleanup:', e); }
  } catch (e) { console.debug('[clawser] OPFS cleanup root error:', e); }
}

/** Get the display name of a workspace by ID. @param {string} id @returns {string} */
export function getWorkspaceName(id) {
  const list = loadWorkspaces();
  return list.find(w => w.id === id)?.name || 'workspace';
}

/** Update the lastUsed timestamp of a workspace to now. @param {string} id */
export function touchWorkspace(id) {
  const list = loadWorkspaces();
  const ws = list.find(w => w.id === id);
  if (ws) { ws.lastUsed = Date.now(); saveWorkspaces(list); }
}
