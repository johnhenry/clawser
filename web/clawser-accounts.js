// clawser-accounts.js — Account/provider management + config persistence
import { $, esc, state, lsKey } from './clawser-state.js';
import { modal } from './clawser-modal.js';

export const SERVICES = {
  openai: { name: 'OpenAI', defaultModel: 'gpt-4o-mini', models: ['gpt-4o-mini', 'gpt-4o', 'gpt-4.1-mini', 'gpt-4.1', 'gpt-4.1-nano', 'o3-mini'] },
  anthropic: { name: 'Anthropic', defaultModel: 'claude-sonnet-4-6', models: ['claude-sonnet-4-6', 'claude-haiku-4-5-20251001', 'claude-opus-4-6'] },
  groq: { name: 'Groq', defaultModel: 'llama-3.3-70b-versatile', models: ['llama-3.3-70b-versatile', 'llama-3.1-8b-instant', 'mixtral-8x7b-32768'] },
  openrouter: { name: 'OpenRouter', defaultModel: 'meta-llama/llama-3.3-70b-instruct', models: ['meta-llama/llama-3.3-70b-instruct', 'anthropic/claude-sonnet-4-6', 'openai/gpt-4o'] },
  together: { name: 'Together AI', defaultModel: 'meta-llama/Meta-Llama-3.1-70B-Instruct-Turbo', models: ['meta-llama/Meta-Llama-3.1-70B-Instruct-Turbo', 'meta-llama/Meta-Llama-3.1-8B-Instruct-Turbo'] },
  fireworks: { name: 'Fireworks AI', defaultModel: 'accounts/fireworks/models/llama-v3p1-70b-instruct', models: ['accounts/fireworks/models/llama-v3p1-70b-instruct'] },
  mistral: { name: 'Mistral AI', defaultModel: 'mistral-small-latest', models: ['mistral-small-latest', 'mistral-large-latest'] },
  deepseek: { name: 'DeepSeek', defaultModel: 'deepseek-chat', models: ['deepseek-chat', 'deepseek-reasoner'] },
  xai: { name: 'xAI (Grok)', defaultModel: 'grok-2-latest', models: ['grok-2-latest'] },
  perplexity: { name: 'Perplexity', defaultModel: 'sonar', models: ['sonar', 'sonar-pro'] },
  ollama: { name: 'Ollama (local)', defaultModel: 'llama3.2', models: ['llama3.2', 'mistral', 'codellama', 'phi3'] },
  lmstudio: { name: 'LM Studio (local)', defaultModel: 'default', models: ['default'] },
};

export const ACCT_KEY = 'clawser_accounts';

/** Load all provider accounts from localStorage. @returns {Array<Object>} */
export function loadAccounts() {
  try { return JSON.parse(localStorage.getItem(ACCT_KEY)) || []; } catch { return []; }
}

/** Persist the account list to localStorage. @param {Array<Object>} list */
export function saveAccounts(list) {
  localStorage.setItem(ACCT_KEY, JSON.stringify(list));
}

/** Create a new provider account, persist it, and return the generated ID.
 * @param {{name: string, service: string, apiKey: string, model: string}} opts
 * @returns {string} Account ID
 */
export function createAccount({ name, service, apiKey, model }) {
  const id = `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
  const list = loadAccounts();
  list.push({ id, name, service, apiKey, model });
  saveAccounts(list);
  return id;
}

/** Update fields on an existing account. @param {string} id @param {Object} updates */
export function updateAccount(id, updates) {
  const list = loadAccounts();
  const acct = list.find(a => a.id === id);
  if (acct) { Object.assign(acct, updates); saveAccounts(list); }
}

/** Remove an account by ID. @param {string} id */
export function deleteAccount(id) {
  let list = loadAccounts();
  list = list.filter(a => a.id !== id);
  saveAccounts(list);
}

/** Render the account list in the config panel with edit/delete controls. */
export function renderAccountList() {
  const list = loadAccounts();
  const el = $('acctList');
  el.innerHTML = '';
  for (const acct of list) {
    const d = document.createElement('div');
    d.className = 'acct-item';
    const svcName = SERVICES[acct.service]?.name || acct.service;
    d.innerHTML = `
      <span class="acct-name">${esc(acct.name)}</span>
      <span class="acct-detail">${esc(svcName)} · ${esc(acct.model)}</span>
      <span class="acct-actions">
        <button class="acct-edit" title="Edit">&#x270E;</button>
        <button class="acct-del" title="Delete">&#x2715;</button>
      </span>
    `;
    d.querySelector('.acct-edit').addEventListener('click', () => showAccountEditForm(acct, d));
    d.querySelector('.acct-del').addEventListener('click', async () => {
      if (!await modal.confirm(`Delete account "${acct.name}"?`, { danger: true })) return;
      deleteAccount(acct.id);
      const providerSelect = $('providerSelect');
      if (providerSelect.value === `acct_${acct.id}`) {
        providerSelect.value = providerSelect.options[0]?.value || 'echo';
        onProviderChange();
      }
      rebuildProviderDropdown();
      renderAccountList();
    });
    el.appendChild(d);
  }
}

/** Show an inline edit form for an account below its list item.
 * @param {Object} acct - Account object
 * @param {HTMLElement} parentEl - Element to insert the form after
 */
export function showAccountEditForm(acct, parentEl) {
  document.querySelectorAll('.acct-edit-form').forEach(f => f.remove());
  const form = document.createElement('div');
  form.className = 'acct-edit-form';
  const svc = SERVICES[acct.service];
  const modelOptions = svc ? svc.models.map(m => `<option value="${m}">`).join('') : '';
  form.innerHTML = `
    <input type="text" class="edit-name" value="${esc(acct.name)}" placeholder="Account name" />
    <input type="password" class="edit-key" value="${esc(acct.apiKey)}" placeholder="API key" />
    <input type="text" class="edit-model" value="${esc(acct.model)}" list="editModelList" placeholder="Model" />
    <datalist id="editModelList">${modelOptions}</datalist>
    <div class="acct-form-row">
      <button class="btn-sm edit-save">Save</button>
      <button class="btn-sm edit-cancel" style="background:var(--surface2);border:1px solid var(--border);">Cancel</button>
    </div>
  `;
  form.querySelector('.edit-cancel').addEventListener('click', () => form.remove());
  form.querySelector('.edit-save').addEventListener('click', () => {
    const newName = form.querySelector('.edit-name').value.trim();
    const newKey = form.querySelector('.edit-key').value.trim();
    const newModel = form.querySelector('.edit-model').value.trim();
    if (!newName || !newKey || !newModel) return;
    updateAccount(acct.id, { name: newName, apiKey: newKey, model: newModel });
    form.remove();
    rebuildProviderDropdown();
    renderAccountList();
    const providerSelect = $('providerSelect');
    if (providerSelect.value === `acct_${acct.id}`) onProviderChange();
    saveConfig();
  });
  parentEl.after(form);
}

/** Handle provider dropdown change: configure agent with selected account/provider. */
export function onProviderChange() {
  const providerSelect = $('providerSelect');
  const val = providerSelect.value;
  if (!state.agent) return;

  if (val.startsWith('acct_')) {
    const acctId = val.slice(5);
    const accts = loadAccounts();
    const acct = accts.find(a => a.id === acctId);
    if (acct) {
      state.agent.setProvider(acct.service);
      state.agent.setApiKey(acct.apiKey);
      state.agent.setModel(acct.model);
      $('providerLabel').textContent = acct.name;
    }
  } else {
    state.agent.setProvider(val);
    state.agent.setApiKey('');
    state.agent.setModel(null);
    $('providerLabel').textContent = val;
  }
}

/** Persist agent config + UI state (selected provider, active conversation) to localStorage. */
export function saveConfig() {
  if (!state.agent) return;
  state.agent.persistConfig();
  const wsId = state.agent.getWorkspace();
  try {
    const raw = localStorage.getItem(lsKey.config(wsId));
    const config = raw ? JSON.parse(raw) : {};
    config.selectedProvider = $('providerSelect').value;
    config.activeConversationId = state.activeConversationId;
    config.activeConversationName = state.activeConversationName;
    localStorage.setItem(lsKey.config(wsId), JSON.stringify(config));
  } catch (e) { console.warn('[clawser] failed to save config', e); }
}

/** Restore provider selection from saved config, handling legacy formats and account migration.
 * @param {Object|null} savedConfig
 */
export async function applyRestoredConfig(savedConfig) {
  const providerSelect = $('providerSelect');
  if (!savedConfig) {
    onProviderChange();
    return;
  }

  if (savedConfig.selectedProvider) {
    const validValues = [...providerSelect.options].map(o => o.value);
    if (validValues.includes(savedConfig.selectedProvider)) {
      providerSelect.value = savedConfig.selectedProvider;
      onProviderChange();
      return;
    }
  }

  // Legacy format: provider + apiKey (no accounts)
  if (savedConfig.provider && ['openai', 'anthropic'].includes(savedConfig.provider) && savedConfig.apiKey) {
    const accts = loadAccounts();
    const existing = accts.find(a => a.service === savedConfig.provider && a.apiKey === savedConfig.apiKey);
    if (existing) {
      providerSelect.value = `acct_${existing.id}`;
    } else {
      const svc = SERVICES[savedConfig.provider];
      const id = createAccount({
        name: svc?.name || savedConfig.provider,
        service: savedConfig.provider,
        apiKey: savedConfig.apiKey,
        model: savedConfig.model || svc?.defaultModel || '',
      });
      await rebuildProviderDropdown();
      renderAccountList();
      providerSelect.value = `acct_${id}`;
    }
    onProviderChange();
    return;
  }

  // Legacy built-in provider
  if (savedConfig.provider) {
    const validValues = [...providerSelect.options].map(o => o.value);
    if (validValues.includes(savedConfig.provider)) {
      providerSelect.value = savedConfig.provider;
    }
  }
  onProviderChange();
}

/** Rebuild the provider <select> with built-in providers and user accounts, preserving selection. */
export async function rebuildProviderDropdown() {
  const providerSelect = $('providerSelect');
  const currentValue = providerSelect.value;
  const available = await state.providers.listWithAvailability();
  const accts = loadAccounts();
  providerSelect.innerHTML = '';

  // Built-in providers (non-API-key ones)
  for (const p of available) {
    if (p.requiresApiKey) continue;
    const opt = document.createElement('option');
    opt.value = p.name;
    opt.textContent = `${p.displayName}${p.available ? '' : ' (unavailable)'}`;
    opt.disabled = !p.available;
    providerSelect.appendChild(opt);
  }

  // User accounts
  if (accts.length > 0) {
    const optgroup = document.createElement('optgroup');
    optgroup.label = 'Accounts';
    for (const acct of accts) {
      const opt = document.createElement('option');
      opt.value = `acct_${acct.id}`;
      opt.textContent = `${acct.name} (${acct.model})`;
      optgroup.appendChild(opt);
    }
    providerSelect.appendChild(optgroup);
  }

  // Restore previous selection if still valid
  const validValues = [...providerSelect.options].map(o => o.value);
  if (validValues.includes(currentValue)) {
    providerSelect.value = currentValue;
  }
}

/** Initialize provider dropdown and account list, auto-selecting Chrome AI if available. */
export async function setupProviders() {
  await rebuildProviderDropdown();
  renderAccountList();

  // Auto-select Chrome AI if available
  const available = await state.providers.listWithAvailability();
  const chromeAi = available.find(p => p.name === 'chrome-ai' && p.available);
  if (chromeAi) {
    $('providerSelect').value = 'chrome-ai';
  }
}

/** Bind event listeners for account management UI (add, edit, delete, service change). */
export function initAccountListeners() {
  const providerSelect = $('providerSelect');

  // Provider change
  providerSelect.addEventListener('change', () => { onProviderChange(); saveConfig(); });

  // Account service change → update model suggestions
  $('acctService').addEventListener('change', () => {
    const svc = SERVICES[$('acctService').value];
    $('acctModel').value = svc?.defaultModel || '';
    const dl = $('modelSuggestions');
    dl.innerHTML = '';
    if (svc) {
      for (const m of svc.models) {
        const opt = document.createElement('option');
        opt.value = m;
        dl.appendChild(opt);
      }
    }
  });

  // Initialize model suggestions for default service
  {
    const svc = SERVICES[$('acctService').value];
    $('acctModel').value = svc?.defaultModel || '';
    const dl = $('modelSuggestions');
    if (svc) { for (const m of svc.models) { const opt = document.createElement('option'); opt.value = m; dl.appendChild(opt); } }
  }

  // Add account toggle
  $('acctAddToggle').addEventListener('click', () => {
    const form = $('acctAddForm');
    form.classList.toggle('visible');
    if (form.classList.contains('visible')) {
      $('acctName').value = '';
      $('acctKey').value = '';
      $('acctService').dispatchEvent(new Event('change'));
      $('acctName').focus();
    }
  });

  // Save account
  $('acctSave').addEventListener('click', async () => {
    const name = $('acctName').value.trim();
    const service = $('acctService').value;
    const apiKey = $('acctKey').value.trim();
    const model = $('acctModel').value.trim();
    if (!name || !apiKey || !model) return;
    const id = createAccount({ name, service, apiKey, model });
    $('acctAddForm').classList.remove('visible');
    await rebuildProviderDropdown();
    renderAccountList();
    providerSelect.value = `acct_${id}`;
    onProviderChange();
    saveConfig();
  });

  // Cancel account add
  $('acctCancel').addEventListener('click', () => {
    $('acctAddForm').classList.remove('visible');
  });
}
