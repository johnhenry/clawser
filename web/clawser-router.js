// clawser-router.js — Routing + panel activation
import { $, state } from './clawser-state.js';

/** Single source of truth for all panels. Derive everything from this. */
export const PANELS = Object.freeze({
  chat:      { id: 'panelChat',      btn: 'btnChat',      label: 'Chat' },
  tools:     { id: 'panelTools',     btn: 'btnTools',     label: 'Tools' },
  files:     { id: 'panelFiles',     btn: 'btnFiles',     label: 'Files' },
  memory:    { id: 'panelMemory',    btn: 'btnMemory',    label: 'Memory' },
  goals:     { id: 'panelGoals',     btn: 'btnGoals',     label: 'Goals' },
  events:    { id: 'panelEvents',    btn: 'btnEvents',    label: 'Events' },
  skills:    { id: 'panelSkills',    btn: 'btnSkills',    label: 'Skills' },
  terminal:  { id: 'panelTerminal',  btn: 'btnTerminal',  label: 'Terminal' },
  dashboard: { id: 'panelDashboard', btn: 'btnDashboard', label: 'Dashboard' },
  toolMgmt:  { id: 'panelToolMgmt',  btn: 'btnToolMgmt',  label: 'Tool Mgmt' },
  agents:    { id: 'panelAgents',    btn: 'btnAgents',    label: 'Agents' },
  config:    { id: 'panelConfig',    btn: 'btnConfig',    label: 'Config' },
});

export const PANEL_NAMES = new Set(Object.keys(PANELS));
const allPanels = Object.values(PANELS).map(p => p.id);
const panelMap = Object.fromEntries(Object.entries(PANELS).map(([k, v]) => [k, v.id]));

// ── Lazy Panel Rendering (Gap 10.2) ─────────────────────────────
/** Track which panels have been rendered at least once. */
const renderedPanels = new Set();

/**
 * Check whether a panel has been rendered (activated at least once).
 * @param {string} panelName
 * @returns {boolean}
 */
export function isPanelRendered(panelName) {
  return renderedPanels.has(panelName);
}

/**
 * Reset the rendered panels tracking (e.g. on workspace switch).
 * Chat is always considered rendered since it's the default active panel.
 */
export function resetRenderedPanels() {
  renderedPanels.clear();
  renderedPanels.add('chat'); // Chat is always active by default
}

// Initialize with chat as rendered
renderedPanels.add('chat');

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

  // Lazy panel rendering: dispatch event on first activation (Gap 10.2)
  if (!renderedPanels.has(panelName)) {
    renderedPanels.add(panelName);
    const panelEl = $(target);
    if (panelEl) {
      panelEl.dispatchEvent(new CustomEvent('panel:firstrender', {
        detail: { panel: panelName },
        bubbles: true,
      }));
    }
  }
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
