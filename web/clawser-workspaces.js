// clawser-workspaces.js — Pure localStorage CRUD for workspaces (no DOM, no agent)
import { lsKey } from './clawser-state.js';
import { getStorage } from './clawser-disposable.js';

export const WS_KEY = 'clawser_workspaces';
export const WS_ACTIVE_KEY = 'clawser_active_workspace';

/** Load all workspaces from storage (sessionStorage in disposable mode). @returns {Array<Object>} */
export function loadWorkspaces() {
  try { return JSON.parse(getStorage().getItem(WS_KEY)) || []; } catch { return []; }
}

/** Persist the workspace list to storage. @param {Array<Object>} list */
export function saveWorkspaces(list) {
  getStorage().setItem(WS_KEY, JSON.stringify(list));
}

export function getActiveWorkspaceId() {
  return getStorage().getItem(WS_ACTIVE_KEY) || 'default';
}

export function setActiveWorkspaceId(id) {
  getStorage().setItem(WS_ACTIVE_KEY, id);
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
