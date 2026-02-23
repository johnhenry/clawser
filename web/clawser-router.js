// clawser-router.js — Routing + panel activation
import { $, state } from './clawser-state.js';

export const PANEL_NAMES = new Set(['chat', 'tools', 'files', 'memory', 'goals', 'events', 'skills', 'config']);

const allPanels = ['panelChat','panelTools','panelFiles','panelMemory','panelGoals','panelEvents','panelSkills','panelConfig'];
const panelMap = { chat:'panelChat', tools:'panelTools', files:'panelFiles', memory:'panelMemory', goals:'panelGoals', events:'panelEvents', skills:'panelSkills', config:'panelConfig' };

/** Parse location.hash into a route descriptor. @returns {{route: string, wsId?: string, convId?: string, panel?: string}} */
export function parseHash() {
  const hash = location.hash.replace(/^#\/?/, '');
  if (hash.startsWith('workspace/')) {
    const rest = hash.slice('workspace/'.length);
    const parts = rest.split('/');
    const wsId = parts[0];
    let convId = null;
    let panel = null;
    if (parts[1] === 'conversation' && parts[2]) {
      convId = parts[2];
      panel = 'chat';
    } else if (parts[1] && PANEL_NAMES.has(parts[1])) {
      panel = parts[1];
    }
    if (wsId) return { route: 'workspace', wsId, convId, panel };
  }
  return { route: 'home' };
}

/** Set location.hash to navigate to a route. @param {string} route @param {string} [wsId] @param {string} [convId] @param {string} [panel] */
export function navigate(route, wsId, convId, panel) {
  if (route === 'workspace' && wsId) {
    let hash = '#workspace/' + wsId;
    if (convId) {
      hash += '/conversation/' + convId;
    } else if (panel && panel !== 'chat') {
      hash += '/' + panel;
    }
    location.hash = hash;
  } else {
    location.hash = '';
  }
}

/** Toggle between home and workspace views. @param {'viewHome'|'viewWorkspace'} viewId */
export function showView(viewId) {
  $('viewHome').classList.toggle('active-view', viewId === 'viewHome');
  $('viewWorkspace').classList.toggle('active-view', viewId === 'viewWorkspace');
}

/** Get the currently active sidebar panel name. @returns {string} Panel name (defaults to 'chat') */
export function getActivePanel() {
  const btn = document.querySelector('.sidebar button.active');
  return btn?.dataset.panel || 'chat';
}

/** Sync the URL hash to reflect the current workspace, conversation, and panel without triggering navigation. */
export function updateRouteHash() {
  const wsId = state.agent?.getWorkspace();
  if (!wsId || state.currentRoute !== 'workspace') return;
  const panel = getActivePanel();
  let hash;
  if (state.activeConversationId && panel === 'chat') {
    hash = '#workspace/' + wsId + '/conversation/' + state.activeConversationId;
  } else if (panel && panel !== 'chat') {
    hash = '#workspace/' + wsId + '/' + panel;
  } else {
    hash = '#workspace/' + wsId;
  }
  history.replaceState(null, '', hash);
}

/** Switch the active sidebar panel and update button highlights. @param {string} panelName */
export function activatePanel(panelName) {
  const target = panelMap[panelName];
  if (!target) return;
  document.querySelectorAll('.sidebar button').forEach(b => b.classList.remove('active'));
  const btn = document.querySelector(`.sidebar button[data-panel="${panelName}"]`);
  if (btn) btn.classList.add('active');
  allPanels.forEach(id => $(id).classList.toggle('active-panel', id === target));
}

/** Bind click handlers to sidebar panel buttons for navigation. */
export function initRouterListeners() {
  document.querySelectorAll('.sidebar button').forEach(btn => {
    btn.addEventListener('click', () => {
      activatePanel(btn.dataset.panel);
      updateRouteHash();
    });
  });
}
