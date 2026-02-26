/**
 * clawser-home-views.js — Home screen rendering and event listeners
 *
 * Extracted from clawser-app.js. Contains:
 *   - renderHomeWorkspaceList()  — workspace card list on home screen
 *   - renderHomeAccountList()    — account list on home screen
 *   - initHomeListeners()        — bind home view event handlers
 */
import { $, esc, state } from './clawser-state.js';
import { modal } from './clawser-modal.js';
import { loadWorkspaces, createWorkspace, renameWorkspace, deleteWorkspace } from './clawser-workspaces.js';
import { loadConversations } from './clawser-conversations.js';
import { SERVICES, loadAccounts, createAccount, deleteAccount } from './clawser-accounts.js';
import { navigate } from './clawser-router.js';

// ── Home view rendering ─────────────────────────────────────────
/** Render the workspace card list on the home screen with rename/delete actions and click-to-open. */
export async function renderHomeWorkspaceList() {
  const list = loadWorkspaces();
  const el = $('homeWsList');
  el.innerHTML = '';
  for (const ws of list) {
    const card = document.createElement('div');
    card.className = 'ws-card';
    const convs = await loadConversations(ws.id);
    const lastUsed = ws.lastUsed ? new Date(ws.lastUsed).toLocaleDateString() : 'never';
    card.innerHTML = `
      <span class="ws-card-name">${esc(ws.name)}</span>
      <span class="ws-card-meta">${convs.length} conversations · ${lastUsed}</span>
      <span class="ws-card-actions">
        <button class="ws-rename" title="Rename">&#x270E;</button>
        ${ws.id !== 'default' ? '<button class="ws-delete danger" title="Delete">&#x2715;</button>' : ''}
      </span>
    `;
    card.querySelector('.ws-rename').addEventListener('click', async (e) => {
      e.stopPropagation();
      const newName = await modal.prompt('Rename workspace:', ws.name);
      if (newName?.trim()) { renameWorkspace(ws.id, newName.trim()); await renderHomeWorkspaceList(); }
    });
    const delBtn = card.querySelector('.ws-delete');
    if (delBtn) {
      delBtn.addEventListener('click', async (e) => {
        e.stopPropagation();
        if (await modal.confirm(`Delete workspace "${ws.name}"?`, { danger: true })) {
          await deleteWorkspace(ws.id);
          await renderHomeWorkspaceList();
        }
      });
    }
    card.addEventListener('click', (e) => {
      if (e.target.closest('.ws-card-actions')) return;
      navigate('workspace', ws.id);
    });
    el.appendChild(card);
  }
  if (list.length === 0) {
    el.innerHTML = '<div style="color:var(--muted);font-size:12px;">No workspaces yet.</div>';
  }
}

/** Render the account list on the home screen with delete actions. */
export function renderHomeAccountList() {
  const list = loadAccounts();
  const el = $('homeAcctList');
  el.innerHTML = '';
  for (const acct of list) {
    const d = document.createElement('div');
    d.className = 'acct-item';
    const svcName = SERVICES[acct.service]?.name || acct.service;
    d.innerHTML = `
      <span class="acct-name">${esc(acct.name)}</span>
      <span class="acct-detail">${esc(svcName)} · ${esc(acct.model)}</span>
      <span class="acct-actions">
        <button class="acct-del" title="Delete">&#x2715;</button>
      </span>
    `;
    d.querySelector('.acct-del').addEventListener('click', async () => {
      if (!await modal.confirm(`Delete account "${acct.name}"?`, { danger: true })) return;
      deleteAccount(acct.id);
      renderHomeAccountList();
    });
    el.appendChild(d);
  }
}

// ── Home view event listeners ───────────────────────────────────
/** Bind event listeners for the home view: workspace create, account CRUD, service selector. */
export function initHomeListeners() {
  $('homeWsCreate').addEventListener('click', () => {
    const name = $('homeWsNewName').value.trim();
    if (!name) return;
    const id = createWorkspace(name);
    $('homeWsNewName').value = '';
    navigate('workspace', id);
  });

  $('homeWsNewName').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') $('homeWsCreate').click();
  });

  $('homeAcctAddToggle').addEventListener('click', () => {
    const form = $('homeAcctAddForm');
    form.classList.toggle('visible');
    if (form.classList.contains('visible')) {
      $('homeAcctName').value = '';
      $('homeAcctKey').value = '';
      const svc = SERVICES[$('homeAcctService').value];
      $('homeAcctModel').value = svc?.defaultModel || '';
      const dl = $('homeModelSuggestions');
      dl.innerHTML = '';
      if (svc) { for (const m of svc.models) { const opt = document.createElement('option'); opt.value = m; dl.appendChild(opt); } }
      $('homeAcctName').focus();
    }
  });

  $('homeAcctService').addEventListener('change', () => {
    const svc = SERVICES[$('homeAcctService').value];
    $('homeAcctModel').value = svc?.defaultModel || '';
    const dl = $('homeModelSuggestions');
    dl.innerHTML = '';
    if (svc) { for (const m of svc.models) { const opt = document.createElement('option'); opt.value = m; dl.appendChild(opt); } }
  });

  $('homeAcctSave').addEventListener('click', async () => {
    const name = $('homeAcctName').value.trim();
    const service = $('homeAcctService').value;
    const apiKey = $('homeAcctKey').value.trim();
    const model = $('homeAcctModel').value.trim();
    if (!name || !apiKey || !model) return;
    await createAccount({ name, service, apiKey, model });
    $('homeAcctAddForm').classList.remove('visible');
    renderHomeAccountList();
  });

  $('homeAcctCancel').addEventListener('click', () => {
    $('homeAcctAddForm').classList.remove('visible');
  });
}
