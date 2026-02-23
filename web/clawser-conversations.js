// clawser-conversations.js — Pure localStorage CRUD for conversations

export const CONV_KEY_PREFIX = 'clawser_conversations_';

/** Load all conversations for a workspace from localStorage.
 * @param {string} wsId - Workspace ID
 * @returns {Array<Object>} Conversation list (empty array on parse failure)
 */
export function loadConversations(wsId) {
  try { return JSON.parse(localStorage.getItem(CONV_KEY_PREFIX + wsId)) || []; } catch (e) { console.debug('[clawser] conversations parse error', e); return []; }
}

/** Persist a conversation list to localStorage for a workspace.
 * @param {string} wsId - Workspace ID
 * @param {Array<Object>} list - Conversations to save
 */
export function saveConversations(wsId, list) {
  localStorage.setItem(CONV_KEY_PREFIX + wsId, JSON.stringify(list));
}

/** Generate a unique conversation ID using timestamp + random suffix. @returns {string} */
export function generateConvId() {
  return `conv_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
}
