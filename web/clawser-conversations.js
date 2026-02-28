/**
 * clawser-conversations.js — Conversation index via OPFS
 *
 * Scans clawser_workspaces/{wsId}/.conversations/ for meta.json files.
 * No localStorage index — the OPFS directory listing IS the index.
 */

/**
 * Load all conversations for a workspace by scanning OPFS meta.json files.
 * @param {string} wsId - Workspace ID
 * @returns {Promise<Array<Object>>} Conversation list sorted by lastUsed desc
 */
export async function loadConversations(wsId) {
  try {
    const root = await navigator.storage.getDirectory();
    const base = await root.getDirectoryHandle('clawser_workspaces');
    const wsDir = await base.getDirectoryHandle(wsId);
    const convDir = await wsDir.getDirectoryHandle('.conversations');

    const conversations = [];
    for await (const [name, handle] of convDir) {
      if (handle.kind !== 'directory') continue;
      try {
        const metaFh = await handle.getFileHandle('meta.json');
        const metaFile = await metaFh.getFile();
        const meta = JSON.parse(await metaFile.text());
        if (meta.id) {
          conversations.push(meta);
        }
      } catch (_) {
        // No meta.json or bad JSON — skip
      }
    }

    return conversations.sort((a, b) => (b.lastUsed || 0) - (a.lastUsed || 0));
  } catch (_) {
    // Workspace or .conversations dir doesn't exist yet
    return [];
  }
}

/**
 * Update just the metadata for a single conversation (name, lastUsed, etc.)
 * without rewriting events.jsonl.
 * @param {string} wsId
 * @param {string} convId
 * @param {Object} updates - Fields to merge into existing meta
 */
export async function updateConversationMeta(wsId, convId, updates) {
  try {
    const root = await navigator.storage.getDirectory();
    const base = await root.getDirectoryHandle('clawser_workspaces', { create: true });
    const wsDir = await base.getDirectoryHandle(wsId, { create: true });
    const convDir = await wsDir.getDirectoryHandle('.conversations', { create: true });
    const convIdDir = await convDir.getDirectoryHandle(convId, { create: true });

    // Read existing meta
    let meta = { id: convId };
    try {
      const fh = await convIdDir.getFileHandle('meta.json');
      const file = await fh.getFile();
      meta = JSON.parse(await file.text());
    } catch (_) { /* no existing meta */ }

    // Merge updates
    Object.assign(meta, updates);

    // Write back
    const fh = await convIdDir.getFileHandle('meta.json', { create: true });
    const w = await fh.createWritable();
    await w.write(JSON.stringify(meta));
    await w.close();
  } catch (e) {
    console.warn('[conversations] updateConversationMeta failed:', e);
  }
}

/** Generate a unique conversation ID using timestamp + random suffix. @returns {string} */
export function generateConvId() {
  return `conv_${Date.now().toString(36)}_${crypto.randomUUID().slice(0, 4)}`;
}
