/**
 * clawser-ui-config.js — Config/security settings panel
 *
 * Manages all configuration sections: security domain allowlist, autonomy & costs,
 * identity, model routing, auth profiles, OAuth, self-repair, cache, sandbox,
 * heartbeat, dashboard, and header badges (cost meter, autonomy, daemon, remote).
 */
import { $, esc, state, lsKey } from './clawser-state.js';
import { modal } from './clawser-modal.js';
import { addMsg, addErrorMsg } from './clawser-ui-chat.js';
import { OAUTH_PROVIDERS } from './clawser-oauth.js';

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

