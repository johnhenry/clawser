/**
 * clawser-ui-channels.js — Channel configuration panel UI
 *
 * Renders a sidebar panel for creating, configuring, starting/stopping
 * channel plugins. Each channel type has specific required fields.
 */
import { $, esc, state, lsKey } from './clawser-state.js';
import { CHANNEL_TYPES } from './clawser-channels.js';
import { getActiveWorkspaceId } from './clawser-workspaces.js';
import { TabWatcherPlugin, SITE_PROFILES } from './clawser-channel-tabwatch.js';
import { DiscordPlugin } from './clawser-channel-discord.js';
import { SlackPlugin } from './clawser-channel-slack.js';
import { TelegramPlugin } from './clawser-channel-telegram.js';
import { IrcPlugin } from './clawser-channel-irc.js';
import { MatrixPlugin } from './clawser-channel-matrix.js';
import { EmailPlugin } from './clawser-channel-email.js';
import { ChannelRelay } from './clawser-channel-relay.js';

// ── Channel type → required fields ─────────────────────────────
//
// Field keys here feed createChannelPlugin()'s opts, not necessarily the
// plugin constructor's own option names 1:1 — see the per-type mapping in
// createChannelPlugin() for where a UI field is renamed or reshaped
// (e.g. irc's single `channel`, matrix's `homeserver`, email's flat
// username/password combined into a `credentials` object, webhook's
// `path`/`bcName` matching ChannelRelay's actual config).

const CHANNEL_FIELDS = {
  telegram:  [{ key: 'botToken', label: 'Bot Token', type: 'password' }, { key: 'chatId', label: 'Chat ID', type: 'text' }],
  discord:   [{ key: 'botToken', label: 'Bot Token', type: 'password' }, { key: 'guildId', label: 'Guild ID', type: 'text' }],
  slack:     [{ key: 'botToken', label: 'Bot Token', type: 'password' }, { key: 'channel', label: 'Channel', type: 'text' }, { key: 'appToken', label: 'App Token (Socket Mode)', type: 'password' }, { key: 'signingSecret', label: 'Signing Secret (webhook only)', type: 'password' }],
  matrix:    [{ key: 'homeserver', label: 'Homeserver URL', type: 'text' }, { key: 'accessToken', label: 'Access Token', type: 'password' }, { key: 'roomId', label: 'Room ID', type: 'text' }],
  email:     [{ key: 'imapHost', label: 'IMAP Host', type: 'text' }, { key: 'smtpHost', label: 'SMTP Host', type: 'text' }, { key: 'username', label: 'Username', type: 'text' }, { key: 'password', label: 'Password', type: 'password' }],
  irc:       [{ key: 'server', label: 'Server', type: 'text' }, { key: 'nick', label: 'Nick', type: 'text' }, { key: 'channel', label: 'Channel (e.g. #general)', type: 'text' }],
  webhook:   [{ key: 'path', label: 'Webhook Path', type: 'text' }, { key: 'bcName', label: 'Relay Channel Name', type: 'text' }],
};

const CHANNEL_ICONS = {
  telegram: '📱', discord: '💬', slack: '💼', matrix: '🔗',
  email: '📧', irc: '🖥', webhook: '🔔',
};

// ── Channel type → plugin class ─────────────────────────────────

const PLUGIN_CLASSES = {
  telegram: TelegramPlugin,
  discord: DiscordPlugin,
  slack: SlackPlugin,
  matrix: MatrixPlugin,
  email: EmailPlugin,
  irc: IrcPlugin,
  webhook: ChannelRelay,
};

/**
 * Construct a real channel plugin instance from a saved channel entry's
 * config, reshaping UI field names to what each plugin constructor expects.
 * @param {string} type
 * @param {object} config - raw config as collected by the channel form
 * @returns {object|null} plugin instance, or null for an unknown type
 */
export function createChannelPlugin(type, config = {}) {
  const PluginClass = PLUGIN_CLASSES[type];
  if (!PluginClass) return null;

  switch (type) {
    case 'matrix':
      return new MatrixPlugin({ ...config, homeserver: config.homeserver || config.homeserverUrl });
    case 'email':
      return new EmailPlugin({
        ...config,
        credentials: config.credentials || { user: config.username, pass: config.password },
      });
    default:
      return new PluginClass(config);
  }
}

/** Build a stable, unique gateway channel ID for a saved channel entry. */
function gatewayChannelId(ch) {
  return `${ch.type}:${ch.name}`;
}

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

// ── Live plugin instances ────────────────────────────────────────
//
// ChannelManager (clawser-channels.js) only ever stored config — no
// platform connection was ever made from it. This map tracks the real,
// connected plugin instances registered with ChannelGateway, keyed by
// channel name (the same key ChannelManager/localStorage entries use).
// Storing {plugin, channelId} (not just the plugin) means stop/stopAll
// never need to re-derive the gateway channel ID from current storage,
// which could have drifted (renamed/deleted) since the plugin started.

const _activePlugins = new Map();

/** Get active channel plugin instances (for testing/diagnostics). */
export function getActiveChannelPlugins() { return _activePlugins; }

/**
 * Construct, start, and register a channel's real plugin with the
 * gateway. No-ops if the type has no plugin mapping (shouldn't happen
 * for anything in CHANNEL_FIELDS) or a plugin is already active for
 * this channel name.
 * @param {object} ch - saved channel entry {name, type, config}
 * @param {import('./clawser-gateway.js').ChannelGateway} gateway
 */
async function startChannelPlugin(ch, gateway) {
  if (!gateway || _activePlugins.has(ch.name)) return;

  const plugin = createChannelPlugin(ch.type, ch.config || {});
  if (!plugin) return;

  try {
    await plugin.start();
  } catch (err) {
    console.error(`[channels] ${ch.name} (${ch.type}) failed to start:`, err);
    return;
  }

  const channelId = gatewayChannelId(ch);
  _activePlugins.set(ch.name, { plugin, channelId });
  gateway.register(channelId, plugin, { scope: 'shared' });
  gateway.start(channelId);
}

/**
 * Stop and unregister a channel's active plugin, if any.
 * @param {string} name - saved channel entry's name
 * @param {import('./clawser-gateway.js').ChannelGateway} gateway
 */
async function stopChannelPlugin(name, gateway) {
  const entry = _activePlugins.get(name);
  if (!entry) return;

  try {
    await entry.plugin.stop();
  } catch (err) {
    console.error(`[channels] ${name} failed to stop:`, err);
  }

  _activePlugins.delete(name);
  gateway?.unregister(entry.channelId);
}

/**
 * Stop and unregister every active channel plugin. Call on workspace
 * cleanup/switch — the gateway instance itself gets replaced on the next
 * workspace init, but real network connections (Discord/Slack/etc.
 * sockets) don't close themselves just because the gateway reference
 * changed, and _activePlugins is module-level so it outlives any one
 * workspace's gateway.
 * @param {import('./clawser-gateway.js').ChannelGateway} [gateway]
 */
export async function stopAllChannelPlugins(gateway) {
  for (const name of [..._activePlugins.keys()]) {
    await stopChannelPlugin(name, gateway);
  }
}

// ── Restore channels on workspace init ──────────────────────────

/**
 * Restore saved channels into the ChannelManager on workspace init, and
 * start a real plugin (registered with the gateway) for each enabled one.
 * @param {import('./clawser-channels.js').ChannelManager} channelManager
 * @param {import('./clawser-gateway.js').ChannelGateway} [gateway]
 */
export function restoreSavedChannels(channelManager, gateway) {
  const saved = loadSavedChannels();
  for (const ch of saved) {
    channelManager.addChannel(ch);
    if (ch.enabled !== false) {
      startChannelPlugin(ch, gateway).catch((err) =>
        console.error(`[channels] ${ch.name} restore-start failed:`, err));
    }
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
    btn.addEventListener('click', async () => {
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
        if (ch.enabled) {
          await startChannelPlugin(ch, state.gateway);
        } else {
          await stopChannelPlugin(name, state.gateway);
        }
        renderChannelPanel();
      }
    });
  });

  panel.querySelectorAll('.channel-delete-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      const name = btn.dataset.name;
      const saved = loadSavedChannels().filter(c => c.name !== name);
      saveChannels(saved);
      if (state.channelManager) state.channelManager.removeChannel(name);
      await stopChannelPlugin(name, state.gateway);
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

  $('channelFormSave').addEventListener('click', async () => {
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

    // Editing an active channel: restart with the new config rather than
    // leaving the old (possibly now-stale, e.g. rotated bot token) plugin
    // instance running under the same name.
    await stopChannelPlugin(name, state.gateway);
    await startChannelPlugin(entry, state.gateway);

    form.classList.remove('visible');
    form.innerHTML = '';
    renderChannelPanel();
    updateChannelBadge();
  });
}

// ── Tab Watcher UI ──────────────────────────────────────────────

/** @type {Map<number, TabWatcherPlugin>} Active tab watchers by tab ID */
const _activeWatchers = new Map();

/**
 * Render the Watch Tab section into the channels panel.
 * Shows active watchers and a button to start watching a new tab.
 */
export function renderTabWatcherSection() {
  const container = $('tabWatcherContainer');
  if (!container) return;

  let html = '';

  // Active watchers
  if (_activeWatchers.size > 0) {
    html += '<div class="channel-section-label">Active Watchers</div>';
    for (const [tabId, watcher] of _activeWatchers) {
      const profile = watcher.siteProfile || 'custom';
      html += `
        <div class="channel-card">
          <div class="channel-card-header">
            <span class="channel-icon">👁</span>
            <span class="channel-name">Tab ${tabId}</span>
            <span class="channel-type-badge">${esc(profile)}</span>
            <span class="channel-status channel-status-on">watching</span>
          </div>
          <div class="channel-card-actions">
            <button class="btn-sm btn-danger tab-watch-stop-btn" data-tab-id="${tabId}">Stop</button>
          </div>
        </div>
      `;
    }
  }

  // Start watcher form
  html += `
    <div class="channel-section-label">Watch a Tab</div>
    <div class="config-group">
      <label>Tab ID</label>
      <input type="number" id="tabWatchTabId" placeholder="Tab ID from ext_tabs_list" />
    </div>
    <div class="config-group">
      <label>Site Profile</label>
      <select id="tabWatchProfile">
        <option value="">Custom</option>
        ${Object.keys(SITE_PROFILES).map(k => `<option value="${k}">${SITE_PROFILES[k].name}</option>`).join('')}
      </select>
    </div>
    <div id="tabWatchCustomField" class="config-group">
      <label>Container Selector</label>
      <input type="text" id="tabWatchSelector" placeholder="CSS selector for message container" />
    </div>
    <button class="btn-sm" id="tabWatchStartBtn">Start Watching</button>
  `;

  container.innerHTML = html;

  // Profile change hides/shows custom selector field
  const profileSelect = $('tabWatchProfile');
  const customField = $('tabWatchCustomField');
  if (profileSelect && customField) {
    const toggle = () => {
      customField.style.display = profileSelect.value ? 'none' : '';
    };
    profileSelect.addEventListener('change', toggle);
    toggle();
  }

  // Start button
  $('tabWatchStartBtn')?.addEventListener('click', async () => {
    const tabIdInput = $('tabWatchTabId');
    const tabId = parseInt(tabIdInput?.value, 10);
    if (!tabId || isNaN(tabId)) return;

    const profile = profileSelect?.value || null;
    const selector = !profile ? $('tabWatchSelector')?.value?.trim() : null;

    if (!profile && !selector) return;

    try {
      const { getExtensionClient } = await import('./clawser-extension-tools.js');
      const rpc = getExtensionClient();

      const watcher = new TabWatcherPlugin({
        tabId,
        rpc,
        siteProfile: profile || undefined,
        selector: selector || undefined,
      });

      await watcher.start();
      _activeWatchers.set(tabId, watcher);

      // Register with gateway
      if (state.gateway) {
        const channelId = `ext:${tabId}`;
        state.gateway.register(channelId, watcher, { scope: 'shared' });
        state.gateway.start(channelId);
      }

      renderTabWatcherSection();
    } catch (err) {
      console.error('[tab-watcher] start failed:', err);
    }
  });

  // Stop buttons
  container.querySelectorAll('.tab-watch-stop-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      const tabId = parseInt(btn.dataset.tabId, 10);
      const watcher = _activeWatchers.get(tabId);
      if (watcher) {
        await watcher.stop();
        _activeWatchers.delete(tabId);

        if (state.gateway) {
          state.gateway.unregister(`ext:${tabId}`);
        }

        renderTabWatcherSection();
      }
    });
  });
}

/** Get active tab watchers (for testing/diagnostics). */
export function getActiveWatchers() { return _activeWatchers; }

// Hold the active channelManager subscription so successive panel
// inits don't pile up listeners.
let _channelSubUnsub = null;

/**
 * Initialize the Channels panel event listeners.
 * Called from initPanelListeners.
 */
export function initChannelPanelListeners() {
  $('channelNewBtn')?.addEventListener('click', () => showChannelForm(null));
  renderTabWatcherSection();

  // Subscribe to channelManager mutations so out-of-panel writes
  // (slash commands, scheduled tasks, MCP tools) re-render the list.
  if (state.channelManager?.subscribe && !_channelSubUnsub) {
    _channelSubUnsub = state.channelManager.subscribe(() => {
      renderChannelPanel();
      updateChannelBadge();
    });
  }
}

/**
 * Tear down the channel-manager subscription. Idempotent. Called on
 * workspace switch via `cleanupWorkspace`.
 */
export function uninstallChannelPanelListeners() {
  if (_channelSubUnsub) { try { _channelSubUnsub(); } catch { /* ignore */ } _channelSubUnsub = null; }
}
