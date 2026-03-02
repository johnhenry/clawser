/**
 * clawser-ui-channels.js — Channel configuration panel UI
 *
 * Renders a sidebar panel for creating, configuring, starting/stopping
 * channel plugins. Each channel type has specific required fields.
 */
import { $, esc, state, lsKey } from './clawser-state.js';
import { CHANNEL_TYPES } from './clawser-channels.js';
import { getActiveWorkspaceId } from './clawser-workspaces.js';

// ── Channel type → required fields ─────────────────────────────

const CHANNEL_FIELDS = {
  telegram:  [{ key: 'botToken', label: 'Bot Token', type: 'password' }, { key: 'chatId', label: 'Chat ID', type: 'text' }],
  discord:   [{ key: 'botToken', label: 'Bot Token', type: 'password' }, { key: 'guildId', label: 'Guild ID', type: 'text' }],
  slack:     [{ key: 'botToken', label: 'Bot Token', type: 'password' }, { key: 'channel', label: 'Channel', type: 'text' }, { key: 'signingSecret', label: 'Signing Secret', type: 'password' }],
  matrix:    [{ key: 'homeserverUrl', label: 'Homeserver URL', type: 'text' }, { key: 'accessToken', label: 'Access Token', type: 'password' }, { key: 'roomId', label: 'Room ID', type: 'text' }],
  email:     [{ key: 'imapHost', label: 'IMAP Host', type: 'text' }, { key: 'smtpHost', label: 'SMTP Host', type: 'text' }, { key: 'username', label: 'Username', type: 'text' }, { key: 'password', label: 'Password', type: 'password' }],
  irc:       [{ key: 'server', label: 'Server', type: 'text' }, { key: 'nick', label: 'Nick', type: 'text' }, { key: 'channels', label: 'Channels (comma-sep)', type: 'text' }],
  webhook:   [{ key: 'webhookUrl', label: 'Webhook URL', type: 'text' }],
};

const CHANNEL_ICONS = {
  telegram: '📱', discord: '💬', slack: '💼', matrix: '🔗',
  email: '📧', irc: '🖥', webhook: '🔔',
};

// ── Persistence helpers ─────────────────────────────────────────

function channelStorageKey() {
  const wsId = getActiveWorkspaceId();
  return `clawser_channels_${wsId}`;
}

/** Load saved channel configs from localStorage. @returns {object[]} */
export function loadSavedChannels() {
  try {
    return JSON.parse(localStorage.getItem(channelStorageKey()) || '[]');
  } catch { return []; }
}

/** Save channel configs to localStorage. @param {object[]} channels */
export function saveChannels(channels) {
  localStorage.setItem(channelStorageKey(), JSON.stringify(channels));
}

// ── Restore channels on workspace init ──────────────────────────

/**
 * Restore saved channels into the ChannelManager on workspace init.
 * @param {import('./clawser-channels.js').ChannelManager} channelManager
 */
export function restoreSavedChannels(channelManager) {
  const saved = loadSavedChannels();
  for (const ch of saved) {
    channelManager.addChannel(ch);
  }
  return saved.length;
}

// ── Panel render ────────────────────────────────────────────────

/**
 * Render the Channels panel into panelChannels.
 * Called lazily on first panel activation.
 */
export function renderChannelPanel() {
  const panel = $('channelListContainer');
  if (!panel) return;

  const channels = loadSavedChannels();
  panel.innerHTML = '';

  if (channels.length === 0) {
    panel.innerHTML = '<div class="channel-empty">No channels configured. Click "+ New" to add one.</div>';
    return;
  }

  for (const ch of channels) {
    const icon = CHANNEL_ICONS[ch.type] || '📨';
    const card = document.createElement('div');
    card.className = 'channel-card';
    card.innerHTML = `
      <div class="channel-card-header">
        <span class="channel-icon">${icon}</span>
        <span class="channel-name">${esc(ch.name)}</span>
        <span class="channel-type-badge">${esc(ch.type)}</span>
        <span class="channel-status ${ch.enabled !== false ? 'channel-status-on' : 'channel-status-off'}">${ch.enabled !== false ? 'enabled' : 'disabled'}</span>
      </div>
      <div class="channel-card-actions">
        <button class="btn-sm channel-toggle-btn" data-name="${esc(ch.name)}">${ch.enabled !== false ? 'Disable' : 'Enable'}</button>
        <button class="btn-sm channel-edit-btn" data-name="${esc(ch.name)}">Edit</button>
        <button class="btn-sm btn-danger channel-delete-btn" data-name="${esc(ch.name)}">Delete</button>
      </div>
    `;
    panel.appendChild(card);
  }

  // Bind card actions
  panel.querySelectorAll('.channel-toggle-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const name = btn.dataset.name;
      const saved = loadSavedChannels();
      const ch = saved.find(c => c.name === name);
      if (ch) {
        ch.enabled = ch.enabled === false ? true : false;
        saveChannels(saved);
        if (state.channelManager) {
          if (ch.enabled) {
            state.channelManager.addChannel(ch);
          } else {
            state.channelManager.removeChannel(name);
          }
        }
        renderChannelPanel();
      }
    });
  });

  panel.querySelectorAll('.channel-delete-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const name = btn.dataset.name;
      const saved = loadSavedChannels().filter(c => c.name !== name);
      saveChannels(saved);
      if (state.channelManager) state.channelManager.removeChannel(name);
      renderChannelPanel();
      updateChannelBadge();
    });
  });

  panel.querySelectorAll('.channel-edit-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const name = btn.dataset.name;
      const saved = loadSavedChannels();
      const ch = saved.find(c => c.name === name);
      if (ch) showChannelForm(ch);
    });
  });
}

/** Update the badge count in the Channels panel header. */
export function updateChannelBadge() {
  const badge = $('channelCount');
  if (badge) badge.textContent = String(loadSavedChannels().length);
}

// ── Channel form ────────────────────────────────────────────────

/**
 * Show the new/edit channel form.
 * @param {object|null} existing - Existing channel to edit, or null for new
 */
export function showChannelForm(existing = null) {
  const form = $('channelAddForm');
  if (!form) return;

  const isEdit = !!existing;
  form.classList.add('visible');

  // Build type options
  const typeOptions = Object.keys(CHANNEL_FIELDS)
    .map(t => `<option value="${t}" ${existing?.type === t ? 'selected' : ''}>${t}</option>`)
    .join('');

  form.innerHTML = `
    <div class="config-group">
      <label>Channel Name</label>
      <input type="text" id="channelFormName" value="${esc(existing?.name || '')}" ${isEdit ? 'readonly' : ''} placeholder="my-telegram" />
    </div>
    <div class="config-group">
      <label>Type</label>
      <select id="channelFormType">${typeOptions}</select>
    </div>
    <div id="channelFormFields"></div>
    <div class="btn-row">
      <button class="btn-sm" id="channelFormSave">${isEdit ? 'Update' : 'Save'}</button>
      <button class="btn-sm btn-surface2" id="channelFormCancel">Cancel</button>
    </div>
  `;

  const typeSelect = $('channelFormType');
  const fieldsContainer = $('channelFormFields');

  function renderFields() {
    const type = typeSelect.value;
    const fields = CHANNEL_FIELDS[type] || [];
    fieldsContainer.innerHTML = fields.map(f => `
      <div class="config-group">
        <label>${esc(f.label)}</label>
        <input type="${f.type}" id="channelField_${f.key}" value="${esc(existing?.config?.[f.key] || existing?.[f.key] || '')}" placeholder="${esc(f.label)}" />
      </div>
    `).join('');
  }

  renderFields();
  typeSelect.addEventListener('change', renderFields);

  $('channelFormCancel').addEventListener('click', () => {
    form.classList.remove('visible');
    form.innerHTML = '';
  });

  $('channelFormSave').addEventListener('click', () => {
    const name = $('channelFormName').value.trim();
    const type = typeSelect.value;
    if (!name) return;

    const fields = CHANNEL_FIELDS[type] || [];
    const config = {};
    for (const f of fields) {
      const el = document.getElementById(`channelField_${f.key}`);
      if (el) config[f.key] = el.value.trim();
    }

    const saved = loadSavedChannels();
    const idx = saved.findIndex(c => c.name === name);
    const entry = { name, type, config, enabled: true };

    if (idx >= 0) {
      saved[idx] = { ...saved[idx], ...entry };
    } else {
      saved.push(entry);
    }

    saveChannels(saved);

    // Register with ChannelManager
    if (state.channelManager) {
      state.channelManager.addChannel({ name, type, ...config, enabled: true });
    }

    form.classList.remove('visible');
    form.innerHTML = '';
    renderChannelPanel();
    updateChannelBadge();
  });
}

/**
 * Initialize the Channels panel event listeners.
 * Called from initPanelListeners.
 */
export function initChannelPanelListeners() {
  $('channelNewBtn')?.addEventListener('click', () => showChannelForm(null));
}
