/**
 * clawser-ui-servers.js — UI logic for the Virtual Servers panel (Phase 7)
 */

import { getServerManager } from './clawser-server.js';
import { getActiveWorkspaceId } from './clawser-workspaces.js';
import { $, esc } from './clawser-state.js';

/** Render the server list in the Servers panel. */
export async function renderServerList() {
  const mgr = getServerManager();
  const list = $('srvList');
  if (!list) return;

  let routes;
  try { routes = await mgr.listRoutes(); } catch { routes = []; }

  if (routes.length === 0) {
    list.innerHTML = '<div class="srv-empty">No servers registered.<br>Use the + Add button or <code>server_add</code> tool.</div>';
    return;
  }

  list.innerHTML = routes.map(r => {
    const portStr = r.port !== 80 ? `:${r.port}` : '';
    const statusCls = r.enabled ? 'on' : 'off';
    const scopeLabel = r.scope === '_global' ? 'global' : 'ws';
    const safeId = esc(r.id);
    const safeHost = esc(r.hostname);
    const safeType = esc(r.handler?.type || '?');
    return `<div class="srv-item" data-id="${safeId}">
      <span class="srv-status ${statusCls}" title="${r.enabled ? 'Running' : 'Stopped'}"></span>
      <span class="srv-host">${safeHost}${portStr}</span>
      <span class="srv-type">${safeType}</span>
      <span class="srv-type">${scopeLabel}</span>
      <span class="srv-actions">
        <button class="btn-sm srv-toggle" data-id="${safeId}" title="${r.enabled ? 'Stop' : 'Start'}">${r.enabled ? '⏸' : '▶'}</button>
        <button class="btn-sm srv-logs-btn" data-id="${safeId}" title="View logs">📋</button>
        <button class="btn-sm srv-remove" data-id="${safeId}" title="Remove">✕</button>
      </span>
    </div>`;
  }).join('');
}

let _serverPanelInited = false;

/** Initialize server panel event handlers. */
export function initServerPanel() {
  if (_serverPanelInited) return;
  _serverPanelInited = true;
  const addToggle = $('srvAddToggle');
  const addForm = $('srvAddForm');
  const typeSelect = $('srvType');

  if (addToggle && addForm) {
    addToggle.addEventListener('click', () => {
      addForm.style.display = addForm.style.display === 'none' ? '' : 'none';
    });
  }

  $('srvCancel')?.addEventListener('click', () => {
    if (addForm) addForm.style.display = 'none';
  });

  // Toggle visibility of type-specific fields
  if (typeSelect) {
    typeSelect.addEventListener('change', () => {
      const type = typeSelect.value;
      document.querySelectorAll('.srv-fn-group').forEach(el => el.style.display = type === 'function' ? '' : 'none');
      document.querySelectorAll('.srv-static-group').forEach(el => el.style.display = type === 'static' ? '' : 'none');
      document.querySelectorAll('.srv-proxy-group').forEach(el => el.style.display = type === 'proxy' ? '' : 'none');
    });
  }

  // Save button
  $('srvSave')?.addEventListener('click', async () => {
    const hostname = $('srvHostname')?.value?.trim();
    if (!hostname) return;

    const port = parseInt($('srvPort')?.value, 10) || 80;
    const type = $('srvType')?.value || 'function';
    const execution = $('srvExecution')?.value || 'page';
    const scope = $('srvScope')?.value === '_global' ? '_global' : getActiveWorkspaceId();

    const handler = { type, execution };
    if (type === 'function') {
      handler.source = 'inline';
      handler.code = $('srvCode')?.value || '';
    } else if (type === 'static') {
      handler.staticSource = 'opfs';
      handler.staticRoot = $('srvStaticRoot')?.value || '';
      handler.indexFile = 'index.html';
    } else if (type === 'proxy') {
      handler.proxyTarget = $('srvProxyTarget')?.value || '';
      handler.proxyRewrite = $('srvProxyRewrite')?.value || '';
      handler.proxyHeaders = {};
    }

    // Parse env vars
    const envText = $('srvEnv')?.value || '';
    const env = {};
    for (const line of envText.split('\n')) {
      const eq = line.indexOf('=');
      if (eq > 0) env[line.slice(0, eq).trim()] = line.slice(eq + 1).trim();
    }

    const mgr = getServerManager();
    await mgr.addRoute({ hostname, port, scope, handler, env, enabled: true });

    // Reset form
    if ($('srvHostname')) $('srvHostname').value = '';
    if ($('srvCode')) $('srvCode').value = '';
    if (addForm) addForm.style.display = 'none';
    renderServerList();
  });

  // Refresh
  $('srvRefresh')?.addEventListener('click', () => renderServerList());

  // Delegate clicks on the server list
  $('srvList')?.addEventListener('click', async (e) => {
    const target = e.target.closest('button');
    if (!target) return;
    const id = target.dataset.id;
    if (!id) return;

    const mgr = getServerManager();

    if (target.classList.contains('srv-toggle')) {
      const route = await mgr.getRouteById(id);
      if (route) {
        if (route.enabled) await mgr.stopServer(id);
        else await mgr.startServer(id);
        renderServerList();
      }
    } else if (target.classList.contains('srv-remove')) {
      await mgr.removeRoute(id);
      renderServerList();
    } else if (target.classList.contains('srv-logs-btn')) {
      showServerLogs(id);
    }
  });

  // Close detail view
  $('srvDetailClose')?.addEventListener('click', () => {
    if ($('srvDetail')) $('srvDetail').style.display = 'none';
  });
}

async function showServerLogs(routeId) {
  const mgr = getServerManager();
  const route = await mgr.getRouteById(routeId);
  const detail = $('srvDetail');
  if (!detail) return;

  detail.style.display = '';
  $('srvDetailName').textContent = route ? `${route.hostname}:${route.port}` : routeId;

  const logs = mgr.getLogs(routeId, 50);
  const viewer = $('srvLogViewer');
  if (!viewer) return;

  if (logs.length === 0) {
    viewer.innerHTML = '<div class="srv-empty">No requests logged yet.</div>';
    return;
  }

  viewer.innerHTML = logs.map(l => {
    const ts = new Date(l.ts).toISOString().slice(11, 23);
    const sCls = l.status < 300 ? 's2xx' : l.status < 500 ? 's4xx' : 's5xx';
    return `<div class="srv-log-entry"><span class="log-time">${ts}</span> <span class="log-status ${sCls}">${l.status}</span> ${esc(l.method)} ${esc(l.path)} <span style="color:var(--dim)">${l.ms}ms</span></div>`;
  }).join('');
}
