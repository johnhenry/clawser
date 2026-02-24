/**
 * clawser-route-handler.js — Hash-based route handling
 *
 * Extracted from clawser-app.js. Contains:
 *   - handleRoute()            — read URL hash and init/switch workspace or show home
 *   - hashchange listener      — auto-invoked on navigation
 */
import { $, state } from './clawser-state.js';
import { loadWorkspaces, ensureDefaultWorkspace } from './clawser-workspaces.js';
import { saveConfig } from './clawser-accounts.js';
import { parseHash, navigate, showView, activatePanel } from './clawser-router.js';
import { persistActiveConversation, switchConversation } from './clawser-ui-chat.js';
import { initWorkspace, switchWorkspace } from './clawser-workspace-lifecycle.js';
import { renderHomeWorkspaceList, renderHomeAccountList } from './clawser-home-views.js';

// ── Route handler ───────────────────────────────────────────────
/** Handle hash-based routing: show home view or init/switch workspace based on URL fragment. */
export async function handleRoute() {
  if (state.switchingViaRouter) return;
  const parsed = parseHash();

  if (parsed.route === 'home') {
    if (state.currentRoute === 'workspace' && state.agent && state.agentInitialized) {
      await persistActiveConversation();
      state.agent.persistMemories();
      await state.agent.persistCheckpoint();
      saveConfig();
    }
    state.currentRoute = 'home';
    showView('viewHome');
    ensureDefaultWorkspace();
    renderHomeWorkspaceList();
    renderHomeAccountList();
    return;
  }

  if (parsed.route === 'workspace') {
    ensureDefaultWorkspace();
    const list = loadWorkspaces();
    if (!list.find(w => w.id === parsed.wsId)) {
      navigate('home');
      return;
    }

    showView('viewWorkspace');
    state.currentRoute = 'workspace';

    state.switchingViaRouter = true;
    try {
      if (!state.agentInitialized) {
        await initWorkspace(parsed.wsId, parsed.convId);
      } else {
        const currentWsId = state.agent.getWorkspace();
        if (currentWsId !== parsed.wsId) {
          await switchWorkspace(parsed.wsId, parsed.convId);
        } else if (parsed.convId && parsed.convId !== state.activeConversationId) {
          await switchConversation(parsed.convId);
        }
      }
    } finally {
      state.switchingViaRouter = false;
    }

    activatePanel(parsed.panel || 'chat');
  }
}

window.addEventListener('hashchange', () => handleRoute());
