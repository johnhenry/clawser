/**
 * clawser-ui-config.js — Config/security settings panel
 *
 * Manages all configuration sections: security domain allowlist, autonomy & costs,
 * identity, model routing, auth profiles, OAuth, self-repair, cache, sandbox,
 * heartbeat, dashboard, and header badges (cost meter, autonomy, daemon, remote).
 */
import { $, esc, state, lsKey, DEFAULTS } from './clawser-state.js';
import { modal } from './clawser-modal.js';
import { addMsg, addErrorMsg } from './clawser-ui-chat.js';
import { OAUTH_PROVIDERS } from './clawser-oauth.js';
import { checkQuota } from './clawser-tools.js';

// ── Security settings ──────────────────────────────────────────
/** Apply domain allowlist and max file size from UI inputs to the browser tools and persist. */
export function applySecuritySettings() {
  const raw = $('cfgDomainAllowlist').value.trim();
  const domains = raw ? raw.split(',').map(d => d.trim()).filter(Boolean) : null;
  const maxMB = parseFloat($('cfgMaxFileSize').value) || 10;

  const fetchTool = state.browserTools.get('browser_fetch');
  if (fetchTool?.setDomainAllowlist) fetchTool.setDomainAllowlist(domains);

  const writeTool = state.browserTools.get('browser_fs_write');
  if (writeTool?.setMaxFileSize) writeTool.setMaxFileSize(maxMB * 1024 * 1024);

  if (state.agent) {
    const wsId = state.agent.getWorkspace();
    localStorage.setItem(lsKey.security(wsId), JSON.stringify({ domains: raw, maxFileSizeMB: maxMB }));
  }
}

// ── Config sections (Batch 1) ────────────────────────────────────

/** Render autonomy & costs section (Block 6). */
export function renderAutonomySection() {
  const wsId = state.agent?.getWorkspace() || 'default';
  const saved = JSON.parse(localStorage.getItem(lsKey.autonomy(wsId)) || '{}');
  if (saved.level) {
    const radio = document.querySelector(`input[name="autonomyLevel"][value="${saved.level}"]`);
    if (radio) radio.checked = true;
  }
  if (saved.maxActions) $('cfgMaxActions').value = saved.maxActions;
  if (saved.dailyCostLimit != null) $('cfgDailyCostLimit').value = saved.dailyCostLimit;
  // Apply saved config to agent's AutonomyController
  if (state.agent && saved.level) {
    state.agent.applyAutonomyConfig({
      level: saved.level || 'supervised',
      maxActionsPerHour: parseInt(saved.maxActions) || Infinity,
      maxCostPerDayCents: parseInt(saved.dailyCostLimit) || Infinity,
    });
  }
  updateCostMeter();
  updateAutonomyBadge();
}

/** Save autonomy settings to localStorage and apply live. */
export function saveAutonomySettings() {
  const wsId = state.agent?.getWorkspace() || 'default';
  const level = document.querySelector('input[name="autonomyLevel"]:checked')?.value || 'supervised';
  const maxActions = parseInt($('cfgMaxActions').value) || 100;
  const dailyCostLimit = parseFloat($('cfgDailyCostLimit').value) || 5;
  localStorage.setItem(lsKey.autonomy(wsId), JSON.stringify({ level, maxActions, dailyCostLimit }));
  // Apply live to agent's AutonomyController
  if (state.agent) {
    state.agent.applyAutonomyConfig({
      level,
      maxActionsPerHour: parseInt(maxActions) || Infinity,
      maxCostPerDayCents: parseInt(dailyCostLimit) || Infinity,
    });
  }
  updateCostMeter();
  updateAutonomyBadge();
}

/** Update cost meter bar and label. */
export function updateCostMeter() {
  const limit = parseFloat($('cfgDailyCostLimit')?.value) || 5;
  const spent = state.sessionCost || 0;
  const pct = Math.min((spent / limit) * 100, 100);
  const bar = $('costMeterBar');
  const label = $('costMeterLabel');
  if (bar) {
    bar.style.width = pct + '%';
    bar.className = 'cost-meter-bar' + (pct > 80 ? ' danger' : pct > 50 ? ' warn' : '');
  }
  if (label) label.textContent = `$${spent.toFixed(2)} / $${limit.toFixed(2)}`;
}

/** Update autonomy badge in header. */
export function updateAutonomyBadge() {
  const badge = $('autonomyBadge');
  if (!badge) return;
  const level = document.querySelector('input[name="autonomyLevel"]:checked')?.value || 'supervised';
  const labels = { readonly: '\u{1F534} ReadOnly', supervised: '\u{1F7E1} Supervised', full: '\u{1F7E2} Full' };
  badge.textContent = labels[level] || '';
  badge.className = `autonomy-badge visible ${level}`;
}

/** Render identity section (Block 7). */
export function renderIdentitySection() {
  const wsId = state.agent?.getWorkspace() || 'default';
  const saved = JSON.parse(localStorage.getItem(lsKey.identity(wsId)) || '{}');
  if (saved.format) $('identityFormat').value = saved.format;
  if (saved.plain) $('identityPlain').value = saved.plain;
  if (saved.name) $('identityName').value = saved.name;
  if (saved.role) $('identityRole').value = saved.role;
  if (saved.personality) $('identityPersonality').value = saved.personality;
  toggleIdentityFormat();
  // Apply saved identity to system prompt on init
  applyIdentityToAgent(saved);
}

function toggleIdentityFormat() {
  const format = $('identityFormat').value;
  $('identityPlainWrap').style.display = format === 'plain' ? '' : 'none';
  const aieosWrap = $('identityAieosWrap');
  if (format === 'aieos') aieosWrap.classList.add('visible');
  else aieosWrap.classList.remove('visible');
}

/** Apply identity config to agent's system prompt. */
function applyIdentityToAgent(saved) {
  if (!state.agent || !state.identityManager || !saved?.format) return;
  try {
    if (saved.format === 'plain') {
      state.identityManager.load(saved.plain || '');
    } else {
      state.identityManager.load({
        version: '1.1',
        names: { display: saved.name || '' },
        bio: saved.role || '',
        linguistics: { tone: saved.personality || '' },
      });
    }
    const compiled = state.identityManager.compile();
    if (compiled) state.agent.setSystemPrompt(compiled);
  } catch (e) { console.warn('[clawser] identity compile failed', e); }
}

export function saveIdentitySettings() {
  const wsId = state.agent?.getWorkspace() || 'default';
  const format = $('identityFormat').value;
  const saved = {
    format,
    plain: $('identityPlain').value,
    name: $('identityName').value,
    role: $('identityRole').value,
    personality: $('identityPersonality').value,
  };
  localStorage.setItem(lsKey.identity(wsId), JSON.stringify(saved));
  // Toggle format visibility (plain vs aieos) when format changes
  toggleIdentityFormat();
  // Apply live to agent's system prompt
  applyIdentityToAgent(saved);
}

/** Render model routing section (Block 11). */
export async function renderRoutingSection() {
  const list = $('routingChainList');
  const badges = $('routingHealthBadges');
  if (!list || !badges) return;
  list.innerHTML = '';
  badges.innerHTML = '';

  // Show registered providers as chain entries
  if (state.providers) {
    let idx = 1;
    const providerList = await state.providers.listWithAvailability().catch(() => []);
    for (const { name } of providerList) {
      const d = document.createElement('div');
      d.className = 'routing-chain-item';
      d.innerHTML = `<span class="chain-idx">${idx++}.</span><span class="chain-name">${esc(name)}</span>`;
      list.appendChild(d);

      const badge = document.createElement('span');
      badge.className = 'health-badge healthy';
      badge.textContent = name;
      badges.appendChild(badge);
    }
  }
  if (list.children.length === 0) list.textContent = '(no providers configured)';
}

/** Render auth profiles section (Block 19). */
export function renderAuthProfilesSection() {
  const list = $('authProfileList');
  if (!list) return;
  list.innerHTML = '';

  if (state.authProfileManager) {
    const profiles = state.authProfileManager.listProfiles();
    for (const p of profiles) {
      const d = document.createElement('div');
      d.className = 'auth-profile-item';
      const active = state.authProfileManager.isActive(p.id);
      d.innerHTML = `
        <span class="profile-active ${active ? 'on' : 'off'}"></span>
        <span class="profile-name">${esc(p.name)}</span>
        <span class="profile-provider">${esc(p.provider || '')}</span>
        <span class="profile-actions">
          <button class="profile-switch" title="Switch">${active ? '\u25CF' : '\u25CB'}</button>
          <button class="profile-del" title="Delete">\u2715</button>
        </span>
      `;
      list.appendChild(d);
    }
  }
  if (!list.children.length) list.innerHTML = '<div style="color:var(--dim);font-size:10px;padding:4px 0;">No profiles. Add one to manage multiple auth credentials.</div>';
}

/** Save self-repair slider settings and apply to StuckDetector. */
export function saveSelfRepairSettings() {
  const wsId = state.agent?.getWorkspace() || 'default';
  const cfg = {
    toolTimeout: parseInt($('cfgToolTimeout')?.value) || 60,
    noProgress: parseInt($('cfgNoProgress')?.value) || 120,
    loopDetection: parseInt($('cfgLoopDetection')?.value) || 3,
    consecErrors: parseInt($('cfgConsecErrors')?.value) || 5,
    costRunaway: parseFloat($('cfgCostRunaway')?.value) || 2.0,
  };
  localStorage.setItem(lsKey.selfRepair(wsId), JSON.stringify(cfg));
  // Apply live to StuckDetector
  if (state.stuckDetector) {
    state.stuckDetector.setThresholds({
      toolTimeout: cfg.toolTimeout * 1000,
      noProgress: cfg.noProgress * 1000,
      loopDetection: cfg.loopDetection,
      consecutiveErrors: cfg.consecErrors,
      costRunaway: cfg.costRunaway,
    });
  }
}

/** Render self-repair section (Block 22). */
export function renderSelfRepairSection() {
  const wsId = state.agent?.getWorkspace() || 'default';
  const saved = JSON.parse(localStorage.getItem(lsKey.selfRepair(wsId)) || 'null');

  const sliders = [
    ['cfgToolTimeout', 'cfgToolTimeoutVal'],
    ['cfgNoProgress', 'cfgNoProgressVal'],
    ['cfgLoopDetection', 'cfgLoopDetectionVal'],
    ['cfgConsecErrors', 'cfgConsecErrorsVal'],
    ['cfgCostRunaway', 'cfgCostRunawayVal'],
  ];
  const keys = ['toolTimeout', 'noProgress', 'loopDetection', 'consecErrors', 'costRunaway'];

  for (let i = 0; i < sliders.length; i++) {
    const [sliderId, valId] = sliders[i];
    const slider = $(sliderId);
    const val = $(valId);
    if (slider && val) {
      // Restore saved value
      if (saved && saved[keys[i]] != null) slider.value = saved[keys[i]];
      val.textContent = slider.value;
      slider.addEventListener('input', () => {
        val.textContent = slider.value;
        saveSelfRepairSettings();
      });
    }
  }

  // Apply saved thresholds on init
  if (saved && state.stuckDetector) {
    state.stuckDetector.setThresholds({
      toolTimeout: (saved.toolTimeout || 60) * 1000,
      noProgress: (saved.noProgress || 120) * 1000,
      loopDetection: saved.loopDetection || 3,
      consecutiveErrors: saved.consecErrors || 5,
      costRunaway: saved.costRunaway || 2.0,
    });
  }
}

/** Update cache stats display (Block 26). */
export function updateCacheStats() {
  const el = $('cacheStats');
  if (!el || !state.responseCache) return;
  const stats = state.responseCache.stats;
  el.textContent = `Hits: ${stats.totalHits || 0} \u00b7 Misses: ${stats.totalMisses || 0} \u00b7 Entries: ${stats.entries || 0}`;
}

// ── Cache & Limits (Gap 11.2 / 11.3) ──────────────────────────────

/**
 * Save cache TTL, max entries, and max tool iterations to workspace config
 * and apply them live to the ResponseCache instance and agent config.
 */
export function saveLimitsSettings() {
  const wsId = state.agent?.getWorkspace() || 'default';
  const cacheTtlMin = parseInt($('cfgCacheTTL')?.value) || 30;
  const cacheMaxEntries = parseInt($('cfgCacheMaxEntries')?.value) || DEFAULTS.cacheMaxEntries;
  const maxToolIter = parseInt($('cfgMaxToolIter')?.value) || DEFAULTS.maxToolIterations;

  // Persist to workspace config
  try {
    const raw = localStorage.getItem(lsKey.config(wsId));
    const config = raw ? JSON.parse(raw) : {};
    config.cacheTtlMs = cacheTtlMin * 60_000;
    config.cacheMaxEntries = cacheMaxEntries;
    config.maxToolIterations = maxToolIter;
    localStorage.setItem(lsKey.config(wsId), JSON.stringify(config));
  } catch (e) { console.warn('[clawser] saveLimitsSettings failed', e); }

  // Apply live to ResponseCache
  if (state.responseCache) {
    state.responseCache.ttl = cacheTtlMin * 60_000;
    state.responseCache.maxEntries = cacheMaxEntries;
  }

  // Apply live to agent config
  if (state.agent) {
    state.agent.setMaxToolIterations(maxToolIter);
  }
}

/**
 * Render/restore cached limits section values from workspace config.
 * Called when the "Cache & Limits" config section is opened or on workspace init.
 */
export function renderLimitsSection() {
  const wsId = state.agent?.getWorkspace() || 'default';
  let saved = null;
  try {
    saved = JSON.parse(localStorage.getItem(lsKey.config(wsId)) || 'null');
  } catch { /* ignore */ }

  // Restore input values from saved config (or use DEFAULTS)
  const ttlMin = saved?.cacheTtlMs != null ? Math.round(saved.cacheTtlMs / 60_000) : 30;
  const maxEntries = saved?.cacheMaxEntries ?? DEFAULTS.cacheMaxEntries;
  const maxToolIter = saved?.maxToolIterations ?? DEFAULTS.maxToolIterations;

  if ($('cfgCacheTTL')) $('cfgCacheTTL').value = ttlMin;
  if ($('cfgCacheMaxEntries')) $('cfgCacheMaxEntries').value = maxEntries;
  if ($('cfgMaxToolIter')) $('cfgMaxToolIter').value = maxToolIter;

  // Apply to runtime objects
  if (state.responseCache) {
    state.responseCache.ttl = ttlMin * 60_000;
    state.responseCache.maxEntries = maxEntries;
  }
  if (state.agent) {
    state.agent.setMaxToolIterations(maxToolIter);
  }
}

/** Save sandbox capability gates and apply to tool permissions. */
export function saveSandboxSettings() {
  const wsId = state.agent?.getWorkspace() || 'default';
  const caps = {};
  for (const cb of document.querySelectorAll('#sandboxCapabilities input[type=checkbox]')) {
    caps[cb.value] = cb.checked;
  }
  localStorage.setItem(lsKey.sandbox(wsId), JSON.stringify(caps));
  // Apply: update tool permissions based on capability gates
  const toolMap = { net_fetch: 'fetch', fs_write: 'fs_write', fs_read: 'fs_read', dom_access: 'dom_query', eval: 'code_eval' };
  if (state.browserTools) {
    for (const [cap, toolName] of Object.entries(toolMap)) {
      if (caps[cap] === false) state.browserTools.setPermission(toolName, 'denied');
      else state.browserTools.setPermission(toolName, 'auto');
    }
  }
}

/** Render sandbox capabilities (Block 28). */
export function renderSandboxSection() {
  const el = $('sandboxCapabilities');
  if (!el) return;
  el.innerHTML = '';

  const wsId = state.agent?.getWorkspace() || 'default';
  const saved = JSON.parse(localStorage.getItem(lsKey.sandbox(wsId)) || 'null');

  const caps = ['net_fetch', 'fs_read', 'fs_write', 'dom_access', 'eval', 'crypto'];
  for (const cap of caps) {
    const label = document.createElement('label');
    label.className = 'sandbox-cap';
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.value = cap;
    cb.dataset.cap = cap;
    // Restore saved state (default: checked/enabled)
    cb.checked = saved ? (saved[cap] !== false) : true;
    cb.addEventListener('change', () => saveSandboxSettings());
    label.appendChild(cb);
    label.appendChild(document.createTextNode(` ${cap}`));
    el.appendChild(label);
  }

  // Apply saved capability gates on init
  if (saved) saveSandboxSettings();
}

/** Save heartbeat check list to localStorage. */
export function saveHeartbeatSettings() {
  const wsId = state.agent?.getWorkspace() || 'default';
  const items = [];
  for (const el of document.querySelectorAll('#heartbeatChecks .heartbeat-check-item')) {
    const nameEl = el.querySelector('.hb-name');
    if (nameEl) items.push({ description: nameEl.textContent, interval: 300000 });
  }
  localStorage.setItem(lsKey.heartbeat(wsId), JSON.stringify(items));
}

/** Render heartbeat checks (Block 29). */
export function renderHeartbeatSection() {
  const el = $('heartbeatChecks');
  if (!el) return;
  el.innerHTML = '';

  const wsId = state.agent?.getWorkspace() || 'default';
  const saved = JSON.parse(localStorage.getItem(lsKey.heartbeat(wsId)) || 'null');
  const defaultChecks = [
    { description: 'Memory health', interval: 300000 },
    { description: 'Provider connectivity', interval: 300000 },
    { description: 'OPFS accessible', interval: 300000 },
    { description: 'Event bus responsive', interval: 300000 },
  ];
  const checks = saved || defaultChecks;

  for (const check of checks) {
    const d = document.createElement('div');
    d.className = 'heartbeat-check-item';
    d.innerHTML = `
      <span class="hb-status"></span>
      <span class="hb-name">${esc(check.description || check)}</span>
      <button class="hb-remove" title="Remove">\u2715</button>
    `;
    d.querySelector('.hb-remove').addEventListener('click', () => {
      d.remove();
      saveHeartbeatSettings();
    });
    el.appendChild(d);
  }
}

/** Render OAuth connected apps section (Block 16). */
export function renderOAuthSection() {
  const el = $('oauthProviderList');
  if (!el) return;
  el.innerHTML = '';

  for (const [key, prov] of Object.entries(OAUTH_PROVIDERS)) {
    const connected = state.oauthManager?.isConnected(key);
    const d = document.createElement('div');
    d.className = 'oauth-provider-card';
    d.innerHTML = `
      <span class="oauth-name">${esc(prov.name)}</span>
      <span class="oauth-status ${connected ? 'connected' : ''}">${connected ? 'Connected' : 'Not connected'}</span>
    `;
    const btn = document.createElement('button');
    btn.className = `btn-sm ${connected ? 'btn-surface2' : ''}`;
    btn.textContent = connected ? 'Disconnect' : 'Connect';
    btn.addEventListener('click', async () => {
      if (!state.oauthManager) { addErrorMsg('OAuth manager not initialized.'); return; }
      try {
        if (connected) {
          await state.oauthManager.disconnect(key);
          addMsg('system', `Disconnected from ${prov.name}.`);
        } else {
          const clientId = await modal.prompt(`${prov.name} Client ID:`);
          if (!clientId) return;
          await state.oauthManager.authenticate(key, clientId);
          addMsg('system', `Connected to ${prov.name}.`);
        }
        renderOAuthSection();
      } catch (e) {
        addErrorMsg(`OAuth error: ${e.message}`);
      }
    });
    d.appendChild(btn);
    el.appendChild(d);
  }
}

// ── Clean Old Conversations (Gap 12.2) ───────────────────────────

/**
 * Render the "Clean old conversations" section in the config panel.
 * Adds UI to find and delete conversations older than a threshold.
 * @param {HTMLElement} [container] - Container element (defaults to 'cleanConvSection')
 */
export function renderCleanConversationsSection() {
  const el = $('cleanConvSection');
  if (!el) return;
  el.innerHTML = '';

  const wsId = state.agent?.getWorkspace() || 'default';

  // Threshold input row
  const thresholdRow = document.createElement('div');
  thresholdRow.className = 'config-group';
  thresholdRow.innerHTML = `
    <label>Max Age (days)</label>
    <div style="display:flex;gap:6px;align-items:center;">
      <input type="number" id="cleanConvThreshold" class="cfg-narrow" min="1" max="3650" value="90" />
      <button class="btn-sm" id="cleanConvScan">Scan</button>
    </div>
  `;
  el.appendChild(thresholdRow);

  // Results container
  const resultsEl = document.createElement('div');
  resultsEl.id = 'cleanConvResults';
  resultsEl.className = 'clean-conv-results';
  el.appendChild(resultsEl);

  // Bind scan button
  thresholdRow.querySelector('#cleanConvScan').addEventListener('click', () => {
    _scanOldConversations(wsId, resultsEl);
  });
}

/**
 * Scan for old conversations and display them for deletion.
 * @param {string} wsId - Workspace ID
 * @param {HTMLElement} resultsEl - Container for results
 */
function _scanOldConversations(wsId, resultsEl) {
  resultsEl.innerHTML = '';
  const thresholdDays = parseInt($('cleanConvThreshold')?.value) || 90;
  const cutoffMs = Date.now() - (thresholdDays * 24 * 60 * 60 * 1000);

  // Find conversation keys in localStorage
  const convPrefix = `clawser_conv_${wsId}_`;
  const convListKey = `clawser_conversations_${wsId}`;
  const convListRaw = localStorage.getItem(convListKey);

  let conversations = [];
  if (convListRaw) {
    try {
      conversations = JSON.parse(convListRaw);
    } catch { /* corrupt data */ }
  }

  // If no conversation list found, scan by key prefix
  if (conversations.length === 0) {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && key.startsWith(convPrefix)) {
        try {
          const data = JSON.parse(localStorage.getItem(key));
          if (data) {
            conversations.push({
              id: key.replace(convPrefix, ''),
              name: data.name || 'Unnamed',
              lastUsed: data.lastUsed || data.created || 0,
              _storageKey: key,
            });
          }
        } catch { /* skip corrupt entries */ }
      }
    }
  }

  const oldConversations = conversations.filter(c => {
    const ts = c.lastUsed || c.created || 0;
    return ts > 0 && ts < cutoffMs;
  });

  if (oldConversations.length === 0) {
    resultsEl.innerHTML = `<div class="clean-conv-empty">No conversations older than ${thresholdDays} days found.</div>`;
    return;
  }

  // Header
  const header = document.createElement('div');
  header.className = 'clean-conv-header';
  header.innerHTML = `<span>${oldConversations.length} conversation(s) older than ${thresholdDays} days</span>`;
  resultsEl.appendChild(header);

  // Checkboxes for each conversation
  const selectedIds = new Set();
  for (const conv of oldConversations) {
    const row = document.createElement('div');
    row.className = 'clean-conv-item';
    const age = Math.floor((Date.now() - (conv.lastUsed || 0)) / 86400000);
    row.innerHTML = `
      <label class="clean-conv-label">
        <input type="checkbox" class="clean-conv-cb" data-id="${esc(conv.id)}" checked />
        <span class="clean-conv-name">${esc(conv.name || conv.id)}</span>
        <span class="clean-conv-age">${age}d ago</span>
      </label>
    `;
    const cb = row.querySelector('.clean-conv-cb');
    cb.addEventListener('change', () => {
      if (cb.checked) selectedIds.add(conv.id);
      else selectedIds.delete(conv.id);
    });
    selectedIds.add(conv.id); // Start all selected
    resultsEl.appendChild(row);
  }

  // Select all / none toggles + delete button
  const actionRow = document.createElement('div');
  actionRow.className = 'clean-conv-actions';
  actionRow.innerHTML = `
    <button class="btn-sm btn-surface2" id="cleanConvSelectAll">Select All</button>
    <button class="btn-sm btn-surface2" id="cleanConvSelectNone">Select None</button>
    <span class="spacer"></span>
    <button class="btn-sm btn-danger" id="cleanConvDelete">Delete Selected</button>
  `;
  resultsEl.appendChild(actionRow);

  actionRow.querySelector('#cleanConvSelectAll').addEventListener('click', () => {
    resultsEl.querySelectorAll('.clean-conv-cb').forEach(cb => { cb.checked = true; selectedIds.add(cb.dataset.id); });
  });
  actionRow.querySelector('#cleanConvSelectNone').addEventListener('click', () => {
    resultsEl.querySelectorAll('.clean-conv-cb').forEach(cb => { cb.checked = false; });
    selectedIds.clear();
  });
  actionRow.querySelector('#cleanConvDelete').addEventListener('click', () => {
    if (selectedIds.size === 0) return;

    // Remove selected conversations from localStorage
    const convList = JSON.parse(localStorage.getItem(convListKey) || '[]');
    const remaining = convList.filter(c => !selectedIds.has(c.id));
    localStorage.setItem(convListKey, JSON.stringify(remaining));

    // Remove individual conversation data
    for (const id of selectedIds) {
      localStorage.removeItem(`${convPrefix}${id}`);
      // Also try removing event log data
      localStorage.removeItem(`clawser_events_${wsId}_${id}`);
    }

    const count = selectedIds.size;
    addMsg('system', `Deleted ${count} old conversation(s).`);
    _scanOldConversations(wsId, resultsEl);
  });
}

// ── Header badges (Batch 2) ─────────────────────────────────────

/** Update daemon badge in header. */
export function updateDaemonBadge(phase) {
  const badge = $('daemonBadge');
  if (!badge) return;
  if (!phase || phase === 'STOPPED') {
    badge.classList.remove('visible');
    return;
  }
  const labels = { PAUSED: '\u23F8 Paused', RUNNING: '\u25B6 Running', STOPPED: '\u23F9 Stopped' };
  const classes = { PAUSED: 'paused', RUNNING: 'running', STOPPED: 'stopped' };
  badge.textContent = labels[phase] || phase;
  badge.className = `daemon-badge visible ${classes[phase] || 'stopped'}`;
}

/** Update remote sessions badge. */
export function updateRemoteBadge(count) {
  const badge = $('remoteBadge');
  if (!badge) return;
  if (!count || count <= 0) {
    badge.classList.remove('visible');
    return;
  }
  badge.textContent = `\u{1F4E1} ${count} remote`;
  badge.classList.add('visible');
}

// ── Dashboard panel (Batch 4) ────────────────────────────────────

/** Refresh dashboard metrics display. */
export function refreshDashboard() {
  if (state.metricsCollector) {
    const snap = state.metricsCollector.snapshot();
    $('dashRequests').textContent = snap.counters?.requests ?? 0;
    $('dashTokens').textContent = snap.counters?.tokens ?? 0;
    $('dashErrors').textContent = snap.counters?.errors ?? 0;
    const hist = snap.histograms?.latency;
    $('dashLatency').textContent = hist?.avg ? `${Math.round(hist.avg)}ms` : '0ms';
  }
  if (state.ringBufferLog) {
    const el = $('dashLogViewer');
    if (!el) return;
    el.innerHTML = '';
    const entries = state.ringBufferLog.query({ limit: 50 });
    for (const entry of entries) {
      const d = document.createElement('div');
      const levelNames = ['debug', 'info', 'warn', 'error'];
      d.className = `dash-log-entry ${levelNames[entry.level] ?? ''}`;
      const time = entry.timestamp ? new Date(entry.timestamp).toLocaleTimeString() : '';
      d.innerHTML = `<span class="log-time">${time}</span>${esc(entry.message || JSON.stringify(entry))}`;
      el.appendChild(d);
    }
  }
}

// ── API Key Warning Banner (Gap 7.3) ──────────────────────────────

/**
 * Render a warning banner in the security section of the config panel
 * explaining that API keys are stored in localStorage (not encrypted),
 * with a "Clear all API keys" button.
 *
 * Call this when the config panel renders (e.g. when securitySection opens).
 */
export function renderApiKeyWarning() {
  const section = $('securitySection');
  if (!section) return;

  // Avoid duplicating the banner if already rendered
  if (section.querySelector('.api-key-warning-banner')) return;

  const banner = document.createElement('div');
  banner.className = 'api-key-warning-banner';
  banner.innerHTML = `
    <div class="api-key-warning-text">
      <strong>Warning:</strong> API keys are stored in localStorage and are <em>not encrypted</em>.
      Any script running on this origin can read them. Avoid storing keys on shared devices.
    </div>
    <button class="btn-sm btn-danger api-key-clear-btn" id="btnClearApiKeys">Clear all API keys</button>
  `;

  // Insert at the top of the security section
  section.prepend(banner);

  // Bind the clear button
  banner.querySelector('#btnClearApiKeys').addEventListener('click', async () => {
    const keysToRemove = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && key.startsWith('clawser_config_')) {
        keysToRemove.push(key);
      }
    }
    if (keysToRemove.length === 0) {
      addMsg('system', 'No API key configurations found in localStorage.');
      return;
    }
    const confirmed = await modal.confirm(
      `This will remove ${keysToRemove.length} config entries (clawser_config_*) from localStorage, including all stored API keys. Continue?`,
      { danger: true }
    );
    if (!confirmed) return;
    for (const key of keysToRemove) {
      localStorage.removeItem(key);
    }
    addMsg('system', `Cleared ${keysToRemove.length} API key configuration(s) from localStorage.`);
  });
}

// ── Storage Quota Bar (Gap 7.6 + 12.1) ───────────────────────────

/**
 * Format bytes into a human-readable string (KB, MB, GB).
 */
function formatBytes(bytes) {
  if (bytes === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return `${(bytes / Math.pow(1024, i)).toFixed(1)} ${units[i]}`;
}

/**
 * Render a storage quota usage bar in the security section of the config panel.
 * Shows current OPFS/storage usage as a visual bar with percentage.
 *
 * Call this when the config panel renders (e.g. when securitySection opens).
 */
export async function renderQuotaBar() {
  const section = $('securitySection');
  if (!section) return;

  // Avoid duplicating
  let wrap = section.querySelector('.quota-bar-wrap');
  if (!wrap) {
    wrap = document.createElement('div');
    wrap.className = 'quota-bar-wrap';
    section.appendChild(wrap);
  }

  const quota = await checkQuota();

  const barClass = quota.critical ? 'danger' : quota.warning ? 'warn' : '';
  const statusText = quota.critical
    ? 'Critical: storage nearly full!'
    : quota.warning
      ? 'Warning: storage usage is high.'
      : '';

  wrap.innerHTML = `
    <div class="config-group">
      <label>Storage Usage</label>
      <div class="quota-meter-wrap">
        <div class="quota-meter-bar ${barClass}" style="width:${Math.min(quota.percent, 100).toFixed(1)}%"></div>
        <span class="quota-meter-label">${formatBytes(quota.usage)} / ${formatBytes(quota.quota)} (${quota.percent.toFixed(1)}%)</span>
      </div>
      ${statusText ? `<div class="quota-status-text ${barClass}">${statusText}</div>` : ''}
    </div>
  `;
}

