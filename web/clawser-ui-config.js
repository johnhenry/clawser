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
import { getCostTracker, recordCostEvent } from './clawser-cost-events.js';
import { renderBarChart, renderTimeSeriesChart, renderCostBreakdown } from './clawser-ui-charts.js';
import { renderIdentityEditor } from './clawser-ui-identity-editor.js';
import { loadAccounts, resolveAccountKey, SERVICES } from './clawser-accounts.js';
import { FallbackChain, FallbackExecutor } from './clawser-fallback.js';
import { AutonomyPresetManager } from './clawser-autonomy-presets.js';

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
  if (saved.monthlyCostLimit != null && $('cfgMonthlyCostLimit')) $('cfgMonthlyCostLimit').value = saved.monthlyCostLimit;
  if (saved.idleTimeoutMin != null && $('cfgIdleTimeout')) $('cfgIdleTimeout').value = saved.idleTimeoutMin;
  // Restore allowed hours
  if ($('cfgAllowedHoursStart') && saved.allowedHoursStart != null) $('cfgAllowedHoursStart').value = saved.allowedHoursStart;
  if ($('cfgAllowedHoursEnd') && saved.allowedHoursEnd != null) $('cfgAllowedHoursEnd').value = saved.allowedHoursEnd;
  // Apply saved config to agent's AutonomyController
  if (state.agent && saved.level) {
    const allowedHours = parseAllowedHoursFromUI(saved);
    state.agent.applyAutonomyConfig({
      level: saved.level || 'supervised',
      maxActionsPerHour: parseInt(saved.maxActions) || Infinity,
      maxCostPerDayCents: saved.dailyCostLimit ? Math.round(parseFloat(saved.dailyCostLimit) * 100) : Infinity,
      maxCostPerMonthCents: saved.monthlyCostLimit ? Math.round(parseFloat(saved.monthlyCostLimit) * 100) : Infinity,
      allowedHours,
    });
    // Apply idle timeout
    if (saved.idleTimeoutMin != null) {
      state.agent.init({ idleTimeoutMs: parseFloat(saved.idleTimeoutMin) * 60000 || 0 });
    }
  }
  // Render preset dropdown
  renderAutonomyPresets(wsId);
  updateCostMeter();
  updateAutonomyBadge();
}

/** Parse allowed hours from saved config or UI into [{start, end}] array. */
function parseAllowedHoursFromUI(saved) {
  const start = parseInt(saved?.allowedHoursStart ?? ($('cfgAllowedHoursStart')?.value || ''));
  const end = parseInt(saved?.allowedHoursEnd ?? ($('cfgAllowedHoursEnd')?.value || ''));
  if (isNaN(start) || isNaN(end)) return [];
  if (start === 0 && end === 0) return []; // 0-0 means "no restriction"
  return [{ start, end }];
}

/** Save autonomy settings to localStorage and apply live. */
export function saveAutonomySettings() {
  const wsId = state.agent?.getWorkspace() || 'default';
  const level = document.querySelector('input[name="autonomyLevel"]:checked')?.value || 'supervised';
  const maxActions = parseInt($('cfgMaxActions').value) || 100;
  const dailyCostLimit = parseFloat($('cfgDailyCostLimit').value) || 5;
  const monthlyCostLimit = parseFloat($('cfgMonthlyCostLimit')?.value || '') || 0;
  const idleTimeoutMin = parseFloat($('cfgIdleTimeout')?.value || '') || 0;
  const allowedHoursStart = $('cfgAllowedHoursStart')?.value || '';
  const allowedHoursEnd = $('cfgAllowedHoursEnd')?.value || '';
  const allowedHours = parseAllowedHoursFromUI({ allowedHoursStart, allowedHoursEnd });
  localStorage.setItem(lsKey.autonomy(wsId), JSON.stringify({ level, maxActions, dailyCostLimit, monthlyCostLimit, idleTimeoutMin, allowedHoursStart, allowedHoursEnd }));
  // Apply live to agent's AutonomyController
  if (state.agent) {
    state.agent.applyAutonomyConfig({
      level,
      maxActionsPerHour: parseInt(maxActions) || Infinity,
      maxCostPerDayCents: dailyCostLimit ? Math.round(parseFloat(dailyCostLimit) * 100) : Infinity,
      maxCostPerMonthCents: monthlyCostLimit ? Math.round(parseFloat(monthlyCostLimit) * 100) : Infinity,
      allowedHours,
    });
    // Apply idle timeout
    if (idleTimeoutMin > 0) {
      state.agent.init({ idleTimeoutMs: idleTimeoutMin * 60000 });
    }
  }
  updateCostMeter();
  updateAutonomyBadge();
}

/** Render preset save/load/delete controls for autonomy section. */
function renderAutonomyPresets(wsId) {
  const container = $('autonomyPresets');
  if (!container) return;
  const mgr = new AutonomyPresetManager(wsId);
  const presets = mgr.list();
  const options = presets.map(p => `<option value="${esc(p.name)}">${esc(p.name)}</option>`).join('');
  container.innerHTML = `
    <select id="presetSelect"><option value="">-- Presets --</option>${options}</select>
    <button id="presetLoadBtn" title="Load preset">Load</button>
    <button id="presetSaveBtn" title="Save current as preset">Save</button>
    <button id="presetDeleteBtn" title="Delete selected preset">Del</button>
  `;
  $('presetLoadBtn')?.addEventListener('click', () => {
    const name = $('presetSelect')?.value;
    if (!name || !state.agent) return;
    if (mgr.apply(name, state.agent)) {
      // Sync UI from agent stats
      const s = state.agent.autonomy.stats;
      const radio = document.querySelector(`input[name="autonomyLevel"][value="${s.level}"]`);
      if (radio) radio.checked = true;
      if ($('cfgMaxActions')) $('cfgMaxActions').value = s.maxActionsPerHour === Infinity ? '' : s.maxActionsPerHour;
      if ($('cfgDailyCostLimit')) $('cfgDailyCostLimit').value = s.maxCostPerDayCents === Infinity ? '' : (s.maxCostPerDayCents / 100);
      if ($('cfgMonthlyCostLimit')) $('cfgMonthlyCostLimit').value = s.maxCostPerMonthCents === Infinity ? '' : (s.maxCostPerMonthCents / 100);
      if (s.allowedHours?.[0]) {
        if ($('cfgAllowedHoursStart')) $('cfgAllowedHoursStart').value = s.allowedHours[0].start;
        if ($('cfgAllowedHoursEnd')) $('cfgAllowedHoursEnd').value = s.allowedHours[0].end;
      }
      saveAutonomySettings();
    }
  });
  $('presetSaveBtn')?.addEventListener('click', () => {
    const name = prompt('Preset name:');
    if (!name) return;
    const level = document.querySelector('input[name="autonomyLevel"]:checked')?.value || 'supervised';
    const maxActionsPerHour = parseInt($('cfgMaxActions')?.value) || Infinity;
    const costDollars = parseFloat($('cfgDailyCostLimit')?.value);
    const maxCostPerDayCents = costDollars ? Math.round(costDollars * 100) : Infinity;
    const allowedHours = parseAllowedHoursFromUI({
      allowedHoursStart: $('cfgAllowedHoursStart')?.value,
      allowedHoursEnd: $('cfgAllowedHoursEnd')?.value,
    });
    mgr.save({ name, level, maxActionsPerHour, maxCostPerDayCents, allowedHours });
    renderAutonomyPresets(wsId);
  });
  $('presetDeleteBtn')?.addEventListener('click', () => {
    const name = $('presetSelect')?.value;
    if (!name) return;
    mgr.delete(name);
    renderAutonomyPresets(wsId);
  });
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
          const clientId = await modal.prompt(`${prov.name} OAuth Client ID:`);
          if (!clientId) return;
          const clientSecret = await modal.prompt(`${prov.name} Client Secret (leave empty for public clients):`);
          state.oauthManager.setClientConfig(key, clientId, clientSecret || undefined);
          await state.oauthManager.connect(key);
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

// getCostTracker and recordCostEvent imported from clawser-cost-events.js
export { getCostTracker, recordCostEvent } from './clawser-cost-events.js';

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

  // Cost & token charts (Phase 1)
  const days = parseInt($('dashPeriodSelect')?.value) || 7;
  const tracker = getCostTracker();

  const costChartEl = $('dashCostChart');
  if (costChartEl) {
    const dailyTotals = tracker.getDailyTotals(days);
    renderBarChart(costChartEl, dailyTotals.map(d => ({
      label: d.date.slice(5),
      value: +(d.costCents / 100).toFixed(4),
    })), { title: 'Cost Over Time ($)', color: 'var(--green)', unit: '' });
  }

  const tokenChartEl = $('dashTokenChart');
  if (tokenChartEl) {
    const dailyTotals = tracker.getDailyTotals(days);
    renderBarChart(tokenChartEl, dailyTotals.map(d => ({
      label: d.date.slice(5),
      value: d.tokens,
    })), { title: 'Tokens Over Time', color: 'var(--accent)' });
  }

  const breakdownEl = $('dashCostBreakdown');
  if (breakdownEl) {
    const perModel = tracker.getPerModelBreakdown(days);
    renderCostBreakdown(breakdownEl, perModel);
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

  // Scheduler section
  renderSchedulerDashboard();
}

/** Render scheduler table in the Dashboard panel. */
export function renderSchedulerDashboard() {
  const el = $('dashScheduler');
  if (!el || !state.routineEngine) return;

  const { RoutineEngine } = /** @type {any} */ (globalThis.__clawser_routines_ref || {});
  const routines = state.routineEngine.listRoutines();
  if (routines.length === 0) {
    el.innerHTML = '<p class="dim">No routines configured.</p>';
    return;
  }

  const fmtTime = ts => ts ? new Date(ts).toLocaleTimeString() : '—';
  const rows = routines.map(r => {
    const trigger = r.trigger?.cron ? esc(r.trigger.cron)
      : r.meta?.scheduleType === 'interval' ? `every ${Math.round((r.meta.intervalMs || 0) / 1000)}s`
      : r.meta?.scheduleType === 'once' ? 'once'
      : r.trigger?.type === 'event' ? `event(${esc(r.trigger.event || '')})`
      : 'unknown';
    const status = r.enabled ? 'active' : 'paused';
    const statusClass = r.enabled ? 'badge-green' : 'badge-amber';
    const lastRun = fmtTime(r.state?.lastRun);
    const runs = r.state?.runCount || 0;
    const name = esc((r.name || '').slice(0, 30));
    return `<tr>
      <td title="${esc(r.id)}">${name}</td>
      <td><code>${trigger}</code></td>
      <td><span class="badge ${statusClass}">${status}</span></td>
      <td>${lastRun}</td>
      <td>${runs}</td>
      <td>
        <button class="btn-sm" data-sched-toggle="${esc(r.id)}" title="${r.enabled ? 'Pause' : 'Resume'}">${r.enabled ? '⏸' : '▶'}</button>
        <button class="btn-sm" data-sched-run="${esc(r.id)}" title="Run now">⚡</button>
        <button class="btn-sm btn-danger" data-sched-del="${esc(r.id)}" title="Delete">✕</button>
      </td>
    </tr>`;
  });

  el.innerHTML = `<table class="dash-table">
    <thead><tr><th>Name</th><th>Trigger</th><th>Status</th><th>Last Run</th><th>Runs</th><th>Actions</th></tr></thead>
    <tbody>${rows.join('')}</tbody>
  </table>`;

  // Wire action buttons
  el.querySelectorAll('[data-sched-toggle]').forEach(btn => {
    btn.addEventListener('click', () => {
      const id = btn.dataset.schedToggle;
      const r = state.routineEngine.getRoutine(id);
      if (r) state.routineEngine.setEnabled(id, !r.enabled);
      renderSchedulerDashboard();
    });
  });
  el.querySelectorAll('[data-sched-run]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const id = btn.dataset.schedRun;
      try { await state.routineEngine.triggerManual(id); } catch {}
      renderSchedulerDashboard();
    });
  });
  el.querySelectorAll('[data-sched-del]').forEach(btn => {
    btn.addEventListener('click', () => {
      const id = btn.dataset.schedDel;
      state.routineEngine.removeRoutine(id);
      renderSchedulerDashboard();
    });
  });
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

// ── Hook Management UI (Phase 2d) ────────────────────────────────

/** Render the hooks section in the config panel. */
export function renderHooksSection() {
  const list = $('hookList');
  if (!list) return;
  list.innerHTML = '';

  if (!state.agent?.listHooks) {
    list.innerHTML = '<div style="color:var(--dim);font-size:10px;padding:4px 0;">Hook pipeline not available.</div>';
    return;
  }

  const hooks = state.agent.listHooks();
  for (const hook of hooks) {
    const d = document.createElement('div');
    d.className = 'hook-item';
    d.innerHTML = `
      <input type="checkbox" class="hook-toggle" ${hook.enabled !== false ? 'checked' : ''} title="Enabled" />
      <span class="hook-name">${esc(hook.name || 'unnamed')}</span>
      <span class="hook-point">${esc(hook.point || '')}</span>
      <span class="hook-priority">P${hook.priority ?? 10}</span>
      <button class="hook-remove" title="Remove">\u2715</button>
    `;
    d.querySelector('.hook-toggle').addEventListener('change', (e) => {
      if (state.agent.enableHook) state.agent.enableHook(hook.id || hook.name, e.target.checked);
    });
    d.querySelector('.hook-remove').addEventListener('click', () => {
      if (state.agent.removeHook) state.agent.removeHook(hook.id || hook.name);
      renderHooksSection();
    });
    list.appendChild(d);
  }
  if (hooks.length === 0) {
    list.innerHTML = '<div style="color:var(--dim);font-size:10px;padding:4px 0;">No hooks registered.</div>';
  }

  // Wire add form
  const addToggle = $('hookAddToggle');
  const addForm = $('hookAddForm');
  if (addToggle && addForm) {
    addToggle.onclick = () => { addForm.style.display = addForm.style.display === 'none' ? '' : 'none'; };
  }
  const saveBtn = $('hookSave');
  const cancelBtn = $('hookCancel');
  if (saveBtn) {
    saveBtn.onclick = () => {
      const point = $('hookPoint')?.value;
      const name = $('hookName')?.value?.trim();
      const priority = parseInt($('hookPriority')?.value) || 10;
      const body = $('hookBody')?.value?.trim();
      if (!name || !body) { addMsg('error', 'Hook name and body required.'); return; }
      try {
        const fn = new Function('return ' + body)();
        if (state.agent.addHook) {
          state.agent.addHook({ name, point, priority, handler: fn, enabled: true });
          addMsg('system', `Hook "${name}" added.`);
          if (addForm) addForm.style.display = 'none';
          renderHooksSection();
        }
      } catch (e) { addMsg('error', `Hook parse error: ${e.message}`); }
    };
  }
  if (cancelBtn && addForm) {
    cancelBtn.onclick = () => { addForm.style.display = 'none'; };
  }
}

// ── Identity Editor UI (Phase 2b) ───────────────────────────────

/** Initialize the full identity editor in the config panel. */
export function initIdentityEditor() {
  const section = $('identityEditorSection');
  if (!section) return;
  renderIdentityEditor(section);
}

// ── Checkpoint Rollback UI (Phase 3a) ───────────────────────────

/** Render checkpoints section in config panel. */
export function renderCheckpointSection() {
  const el = $('checkpointList');
  if (!el) return;
  el.innerHTML = '';

  const mgr = state.daemonController?.checkpointManager;
  if (!mgr || !mgr.list) {
    el.innerHTML = '<div style="color:var(--dim);font-size:10px;padding:4px 0;">Checkpoint manager not available.</div>';
    return;
  }

  const checkpoints = mgr.list();
  if (checkpoints.length === 0) {
    el.innerHTML = '<div style="color:var(--dim);font-size:10px;padding:4px 0;">No checkpoints saved.</div>';
    return;
  }

  for (const cp of checkpoints) {
    const d = document.createElement('div');
    d.className = 'checkpoint-item';
    const time = cp.timestamp ? new Date(cp.timestamp).toLocaleString() : 'unknown';
    const size = cp.size ? formatBytes(cp.size) : '';
    d.innerHTML = `
      <span class="cp-time">${esc(time)}</span>
      <span class="cp-size">${size}</span>
      <button class="btn-sm cp-restore" title="Restore">Restore</button>
      <button class="btn-sm btn-danger cp-delete" title="Delete">\u2715</button>
    `;
    d.querySelector('.cp-restore').addEventListener('click', async () => {
      const confirmed = await modal.confirm(`Restore checkpoint from ${time}? This will replace current state.`, { danger: true });
      if (!confirmed) return;
      try {
        await mgr.restore(cp.id);
        addMsg('system', `Checkpoint restored from ${time}.`);
      } catch (e) { addErrorMsg(`Restore failed: ${e.message}`); }
    });
    d.querySelector('.cp-delete').addEventListener('click', async () => {
      const confirmed = await modal.confirm(`Delete checkpoint from ${time}?`, { danger: true });
      if (!confirmed) return;
      try {
        await mgr.delete(cp.id);
        renderCheckpointSection();
        addMsg('system', 'Checkpoint deleted.');
      } catch (e) { addErrorMsg(`Delete failed: ${e.message}`); }
    });
    el.appendChild(d);
  }
}

// ── Fallback Chain Editor UI (Phase 4a) ──────────────────────────

/** Render the fallback chain editor with drag-reorderable account-based entries. */
export function renderFallbackChainEditor() {
  const list = $('routingChainList');
  if (!list) return;
  list.innerHTML = '';

  const chain = state.fallbackChain || [];
  const accts = loadAccounts();
  for (let i = 0; i < chain.length; i++) {
    const entry = chain[i];
    const d = document.createElement('div');
    d.className = 'chain-entry';
    d.draggable = true;
    d.dataset.idx = i;
    // Resolve display name: account name if accountId, else raw provider
    const acct = entry.accountId ? accts.find(a => a.id === entry.accountId) : null;
    const displayName = acct ? acct.name : (entry.providerId || entry.provider || 'unknown');
    const displayModel = acct ? acct.model : (entry.model || '');
    d.innerHTML = `
      <span class="chain-drag-handle">\u2630</span>
      <span class="chain-idx">${i + 1}.</span>
      <span class="chain-name">${esc(displayName)}</span>
      <span class="chain-model">${esc(displayModel)}</span>
      <input type="checkbox" class="chain-enabled" ${entry.enabled !== false ? 'checked' : ''} title="Enabled" />
      <button class="chain-remove" title="Remove">\u2715</button>
    `;
    d.querySelector('.chain-enabled').addEventListener('change', (e) => {
      entry.enabled = e.target.checked;
      _saveFallbackChain();
    });
    d.querySelector('.chain-remove').addEventListener('click', () => {
      chain.splice(i, 1);
      _saveFallbackChain();
      renderFallbackChainEditor();
    });
    // Drag-reorder
    d.addEventListener('dragstart', (e) => { e.dataTransfer.setData('text/plain', String(i)); });
    d.addEventListener('dragover', (e) => { e.preventDefault(); d.classList.add('drag-over'); });
    d.addEventListener('dragleave', () => { d.classList.remove('drag-over'); });
    d.addEventListener('drop', (e) => {
      e.preventDefault();
      d.classList.remove('drag-over');
      const fromIdx = parseInt(e.dataTransfer.getData('text/plain'));
      const toIdx = i;
      if (fromIdx !== toIdx) {
        const [moved] = chain.splice(fromIdx, 1);
        chain.splice(toIdx, 0, moved);
        _saveFallbackChain();
        renderFallbackChainEditor();
      }
    });
    list.appendChild(d);
  }

  // Add entry form — account selector dropdown
  const addRow = document.createElement('div');
  addRow.className = 'chain-add-row';
  let acctOptions = '<option value="">-- Select account --</option>';
  for (const a of accts) {
    const svcName = SERVICES[a.service]?.name || a.service;
    acctOptions += `<option value="${esc(a.id)}">${esc(a.name)} (${esc(svcName)} · ${esc(a.model)})</option>`;
  }
  addRow.innerHTML = `
    <select class="chain-add-account">${acctOptions}</select>
    <button class="btn-sm chain-add-btn">+ Add</button>
  `;
  addRow.querySelector('.chain-add-btn').addEventListener('click', () => {
    const acctId = addRow.querySelector('.chain-add-account').value;
    if (!acctId) return;
    const selected = accts.find(a => a.id === acctId);
    if (!selected) return;
    chain.push({
      accountId: acctId,
      providerId: selected.service,
      model: selected.model,
      priority: chain.length,
      enabled: true,
    });
    _saveFallbackChain();
    renderFallbackChainEditor();
  });
  list.appendChild(addRow);
}

function _saveFallbackChain() {
  const wsId = state.agent?.getWorkspace() || 'default';
  // Normalize legacy entries: migrate provider → providerId
  for (const entry of (state.fallbackChain || [])) {
    if (entry.provider && !entry.providerId) {
      entry.providerId = entry.provider;
      delete entry.provider;
    }
  }
  localStorage.setItem(`clawser_fallback_chain_${wsId}`, JSON.stringify(state.fallbackChain || []));
  // Update the live FallbackExecutor on the agent
  try {
    if (state.agent && state.fallbackChain?.length > 0) {
      const chain = new FallbackChain({ entries: state.fallbackChain });
      state.agent.setFallbackExecutor(new FallbackExecutor(chain, {
        onLog: (lvl, msg) => console.log(`[fallback] ${msg}`),
      }));
    } else if (state.agent) {
      state.agent.setFallbackExecutor(null);
    }
  } catch (e) { console.warn('[clawser] Failed to update FallbackExecutor:', e); }
}

// ── Discovered Tools Panel (Phase 4b) ────────────────────────────

/** Render discovered tools from extension and WebMCP sources. */
export function renderDiscoveredToolsSection() {
  const el = $('discoveredToolsList');
  if (!el) return;
  el.innerHTML = '';

  if (!state.browserTools) {
    el.innerHTML = '<div style="color:var(--dim);font-size:10px;">No tools available.</div>';
    return;
  }

  const tools = [...state.browserTools.entries()].filter(([, t]) =>
    t.source === 'extension' || t.source === 'webmcp'
  );

  if (tools.length === 0) {
    el.innerHTML = '<div style="color:var(--dim);font-size:10px;">No discovered tools. Install the Chrome extension or connect a WebMCP server.</div>';
    return;
  }

  for (const [name, tool] of tools) {
    const d = document.createElement('div');
    d.className = 'discovered-tool-item';
    const sourceBadge = tool.source === 'extension' ? 'ext' : 'mcp';
    d.innerHTML = `
      <span class="dt-name">${esc(name)}</span>
      <span class="dt-source-badge dt-${sourceBadge}">${sourceBadge}</span>
      <span class="dt-desc">${esc(tool.description || '')}</span>
    `;
    el.appendChild(d);
  }
}

// ── Connected Apps Panel (Phase 4c) ──────────────────────────────

/** Render OAuth connected apps with status, scopes, expiry. */
export function renderConnectedAppsSection() {
  const el = $('oauthProviderList');
  if (!el) return;
  // Enhanced version: delegate to existing renderOAuthSection but add status details
  renderOAuthSection();
}

// ── Auth Profile Management (Phase 4d) ───────────────────────────

/** Enhanced auth profiles section with per-provider profile selector. */
export function renderAuthProfilesEnhanced() {
  const list = $('authProfileList');
  if (!list) return;
  renderAuthProfilesSection();

  // Add "New Profile" button if not already present
  if (!list.parentElement?.querySelector('.auth-new-profile-btn')) {
    const btn = document.createElement('button');
    btn.className = 'btn-sm auth-new-profile-btn';
    btn.textContent = '+ New Profile';
    btn.style.marginTop = '6px';
    btn.addEventListener('click', async () => {
      const name = await modal.prompt('Profile name:');
      if (!name) return;
      const provider = await modal.prompt('Provider (e.g. openai, anthropic):');
      if (!provider) return;
      if (state.authProfileManager?.createProfile) {
        state.authProfileManager.createProfile({ name, provider });
        renderAuthProfilesEnhanced();
        addMsg('system', `Profile "${name}" created.`);
      }
    });
    list.parentElement?.appendChild(btn);
  }
}

// ── Sub-Agent UI (Phase 3b) ──────────────────────────────────────
// (Implemented in clawser-ui-chat.js as addSubAgentBlock/updateSubAgentBlock)

