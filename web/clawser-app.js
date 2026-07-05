/**
 * clawser-app.js — Application orchestrator
 *
 * State machine lifecycle:
 *   1. Module-level singleton creation (providers, tools, skills, MCP)
 *   2. startup() → initListeners + ensureDefaultWorkspace + handleRoute
 *   3. handleRoute() reads the URL hash:
 *      - #home → showView('viewHome'), render workspace/account lists
 *      - #workspace/:id → initWorkspace (first load) or switchWorkspace (subsequent)
 *   4. initWorkspace() bootstraps a fresh agent, registers tools, restores state
 *   5. switchWorkspace() saves current, reinits agent, restores target workspace
 *
 * All cross-module coordination flows through the event bus (on/emit).
 */
import { $, state, lsKey, on, emit, migrateLocalStorageKeys, configCache } from './clawser-state.js';
import { ensureDefaultWorkspace, initWorkspacesCache } from './clawser-workspaces.js';
import { bootstrapFilesystem } from './clawser-fs-bootstrap.mjs';
import { initAccountListeners } from './clawser-accounts.js';
import { initRouterListeners } from './clawser-router.js';
import { initChatListeners } from './clawser-ui-chat.js';
import { refreshFiles, renderGoals, renderSkills, initPanelListeners, updateCostMeter, updateDaemonBadge, updateRemoteBadge, refreshDashboard } from './clawser-ui-panels.js';
import { initCmdPaletteListeners } from './clawser-cmd-palette.js';
import { initKeyboardShortcuts } from './clawser-keys.js';
import { saveConfig } from './clawser-accounts.js';

import { createDefaultRegistry } from './clawser-tools.js';
import { registerChromeAITools } from './clawser-chrome-ai-tools.js';
import { createDefaultProviders, ResponseCache } from './clawser-providers.js';
import { McpManager } from './clawser-mcp.js';
import { SkillRegistry, SkillRegistryClient } from './clawser-skills.js';
import { MountableFs } from './clawser-mount.js';
import { SecretVault, OPFSVaultStorage, MemoryVaultStorage } from './clawser-vault.js';
import { NullCheckpointIDB } from './clawser-disposable.js';
import { IdentityManager } from './clawser-identity.js';
import { IntentRouter } from './clawser-intent.js';
import { InputSanitizer, ToolCallValidator, SafetyPipeline } from './clawser-safety.js';
import { ProviderHealth, ModelRouter } from './clawser-fallback.js';
import { StuckDetector, SelfRepairEngine } from './clawser-self-repair.js';
import { UndoManager } from './clawser-undo.js';
import { HeartbeatRunner } from './clawser-heartbeat.js';
import { AuthProfileManager } from './clawser-auth-profiles.js';
import { MetricsCollector, RingBufferLog } from './clawser-metrics.js';
import { DaemonController, CheckpointManager, AwaySummaryBuilder, DaemonState } from './clawser-daemon.js';
import { RoutineEngine } from './clawser-routines.js';
import { CheckpointIndexedDB } from './clawser-checkpoint-idb.js';
import { OAuthManager } from './clawser-oauth.js';
import { ToolBuilder } from './clawser-tool-builder.js';
import { ChannelManager } from './clawser-channels.js';
import { DelegateManager } from './clawser-delegate.js';
import { GitBehavior, GitEpisodicMemory } from './clawser-git.js';
import { AutomationManager } from './clawser-browser-auto.js';
import { SandboxManager } from './clawser-sandbox.js';
import { PeripheralManager } from './clawser-hardware.js';
import { TunnelManager, CloudflareTunnel, NgrokTunnel } from './clawser-tunnel.js';
import { initPwaInstall } from './clawser-pwa-install.js';
import { PairingManager } from './clawser-remote.js';
import { GoalManager } from './clawser-goals.js';
import { addEvent } from './clawser-ui-chat.js';
import { executeRoutineAction } from './clawser-routine-runtime.js';

// Extracted modules
import { createShellSession, setKernelIntegration } from './clawser-workspace-lifecycle.js';
import { handleRoute } from './clawser-route-handler.js';
import { initHomeListeners } from './clawser-home-views.js';
import { initVaultSettings, updatePasskeyUnlockButton } from './clawser-vault-settings.js';

// Kernel integration (Phase 12 — Steps 23-30)
import { Kernel } from './packages-kernel.js';
import { KernelIntegration } from './clawser-kernel-integration.js';
import { silentCatch } from './clawser-silent-catch.mjs'

// ── Migrate localStorage keys to versioned format (Gap 13.3) ────
migrateLocalStorageKeys();

// ── Create service singletons ───────────────────────────────────
state.workspaceFs = new MountableFs();
state.browserTools = createDefaultRegistry(state.workspaceFs, () => state.shell?.state, () => {
  const wsId = state.workspaceFs.getWorkspace();
  return localStorage.getItem(lsKey.showDotfiles(wsId)) === 'true';
});
registerChromeAITools(state.browserTools);
state.providers = createDefaultProviders();
state.mcpManager = new McpManager({
  onLog: (level, msg) => console.log(`[mcp] ${msg}`),
});

state.responseCache = new ResponseCache();
state.vault = new SecretVault(state.disposableMode ? new MemoryVaultStorage() : new OPFSVaultStorage('clawser_vault', {
  guard: async (sizeBytes, op) => {
    const { guardBeforeWrite } = await import('./clawser-quota-guard.mjs');
    return guardBeforeWrite(sizeBytes, op, {
      onWarning: async () => {
        const { addMsg } = await import('./clawser-ui-chat.js');
        addMsg('system', 'Storage is running low — consider clearing old snapshots or conversations in Settings.');
      },
    });
  },
}));

// ── Create advanced module singletons (Batch 6-8) ───────────────
state.identityManager = new IdentityManager();
state.intentRouter = new IntentRouter();
state.inputSanitizer = new InputSanitizer();
state.toolCallValidator = new ToolCallValidator();
state.safetyPipeline = new SafetyPipeline({ sanitizer: state.inputSanitizer, validator: state.toolCallValidator });
state.providerHealth = new ProviderHealth();
state.modelRouter = new ModelRouter();
state.stuckDetector = new StuckDetector();
state.selfRepairEngine = new SelfRepairEngine({ detector: state.stuckDetector });
// OPFS path helper — delegates to shared utility (clawser-opfs.js)
async function opfsGetFile(path, create = false) {
  const { opfsWalk } = await import('./clawser-opfs.js');
  const resolved = state.workspaceFs ? state.workspaceFs.resolve(path) : path;
  return opfsWalk(resolved, { create });
}

async function opfsWriteFile(path, content) {
  const { dir, name } = await opfsGetFile(path, true);
  const handle = await dir.getFileHandle(name, { create: true });
  const writable = await handle.createWritable();
  await writable.write(content);
  await writable.close();
}

async function opfsRemoveFile(path) {
  const { dir, name } = await opfsGetFile(path, false);
  await dir.removeEntry(name);
}

state.undoManager = new UndoManager({
  handlers: {
    revertHistory: (historyLength) => {
      if (state.agent && typeof state.agent.truncateHistory === 'function') {
        return state.agent.truncateHistory(historyLength || 0);
      }
      return [];
    },
    restoreHistory: (messages) => {
      if (state.agent && typeof state.agent.restoreHistory === 'function') {
        state.agent.restoreHistory(messages);
      }
    },
    revertMemory: async (op) => {
      const agent = state.agent;
      if (!agent) return;
      if (op.action === 'store' && op.id && typeof agent.memoryForget === 'function') {
        agent.memoryForget(op.id);
      } else if (op.action === 'forget' && op.content && typeof agent.memoryStore === 'function') {
        agent.memoryStore({ key: op.key, content: op.content, category: op.category || 'learned' });
      }
    },
    revertFile: async (op) => {
      try {
        if (op.action === 'write' && !op.previousContent) {
          await opfsRemoveFile(op.path);
        } else if (op.action === 'write' && op.previousContent) {
          await opfsWriteFile(op.path, op.previousContent);
        } else if (op.action === 'delete' && op.previousContent) {
          await opfsWriteFile(op.path, op.previousContent);
        }
      } catch (e) {
        console.warn('revertFile failed:', e);
      }
    },
    revertGoal: async (op) => {
      const agent = state.agent;
      if (!agent) return;
      if (op.action === 'add' && typeof agent.updateGoal === 'function') {
        agent.updateGoal(op.goalId, 'failed');
      } else if (op.action === 'update' && op.previousStatus && typeof agent.updateGoal === 'function') {
        agent.updateGoal(op.goalId, op.previousStatus);
      }
    },
    applyMemory: async (op) => {
      const agent = state.agent;
      if (!agent) return;
      if (op.action === 'store' && typeof agent.memoryStore === 'function') {
        agent.memoryStore({ key: op.key, content: op.content, category: op.category || 'learned' });
      } else if (op.action === 'forget' && typeof agent.memoryForget === 'function') {
        agent.memoryForget(op.id);
      }
    },
    applyFile: async (op) => {
      try {
        if (op.action === 'write') {
          await opfsWriteFile(op.path, op.content || '');
        } else if (op.action === 'delete') {
          await opfsRemoveFile(op.path);
        }
      } catch (e) {
        console.warn('applyFile failed:', e);
      }
    },
    applyGoal: async (op) => {
      const agent = state.agent;
      if (!agent) return;
      if (op.action === 'update' && typeof agent.updateGoal === 'function') {
        agent.updateGoal(op.goalId, op.status);
      }
    },
  },
});
state.heartbeatRunner = new HeartbeatRunner({
  onAlert: (msg) => addEvent('heartbeat_alert', msg),
});
state.authProfileManager = new AuthProfileManager({ vault: state.vault });
state.metricsCollector = new MetricsCollector();
state.ringBufferLog = new RingBufferLog(1000);

// Catch unhandled promise rejections globally (early, after ringBufferLog is ready)
globalThis.addEventListener('unhandledrejection', (event) => {
  const msg = event.reason?.message || String(event.reason)
  console.error('[clawser] Unhandled rejection:', msg)
  // Log to ring buffer if available
  if (state?.ringBufferLog) {
    state.ringBufferLog.push({ level: 'error', type: 'unhandled_rejection', message: msg, timestamp: Date.now() })
  }
});

// ── Kernel boot (Phase 12 — activates Steps 23-30) ─────────────
// The Kernel provides: tenant isolation, service registry, tracing,
// ByteStream pipes, IPC MessagePorts, Clock/RNG, and SignalController.
// KernelIntegration is the adapter that wires these into Clawser subsystems.
state.kernel = new Kernel();
const _kernelIntegration = new KernelIntegration(state.kernel);
setKernelIntegration(_kernelIntegration);
// Wire kernel to MCP manager so MCP servers register as svc:// services (Step 25)
state.mcpManager._kernelIntegration = _kernelIntegration;
console.log('[clawser] Kernel initialized — integration active');

state.checkpointIDB = state.disposableMode ? new NullCheckpointIDB() : new CheckpointIndexedDB();
// DaemonState with onChange wired to the header badge so phase
// transitions (RUNNING → PAUSED → ERROR → STOPPED) update the UI
// reactively. Previously the badge only refreshed at workspace
// switch, so mid-session phase changes left it stale.
state.daemonController = new DaemonController({
  state: new DaemonState({
    onChange: (newPhase) => emit('updateDaemon', newPhase),
  }),
  getStateFn: () => state.agent?.getState(),
  checkpoints: new CheckpointManager({
    writeFn: (key, data) => state.checkpointIDB.write(key, data),
    readFn: (key) => state.checkpointIDB.read(key),
  }),
});
// Routine execution routes through ChannelGateway so scheduled tasks get
// channel badges, per-channel serialized queuing, and event recording.
// Each routine gets a virtual channel key 'scheduler:{routineId}' — same
// routine serializes, different routines run concurrently. Falls back to
// direct agent.run() if the gateway is unavailable or ingest throws.
state.routineEngine = new RoutineEngine({
  executeFn: async (routine, _triggerEvent) => {
    return executeRoutineAction({
      routine,
      triggerEvent: _triggerEvent,
      orchestrator: state.orchestrator,
      remoteSessionBroker: state.remoteSessionBroker,
      remoteRuntimeRegistry: state.remoteRuntimeRegistry,
      gateway: state.gateway,
      agent: state.agent,
    });
  },
  onNotify: (routine, message) => addEvent('routine', message),
  onChange: () => {
    // Sync routine state to IndexedDB for background runners
    import('./clawser-workspace-lifecycle.js').then(m => m.syncRoutinesToIDB()).catch(e => console.warn('[clawser] Routine sync:', e.message));
  },
});

state.oauthManager = new OAuthManager({
  vault: state.vault,
  redirectUri: `${location.origin}/oauth-callback.html`,
  onLog: (msg) => console.log('[oauth]', msg),

  // Popup handler: open auth URL in a popup, wait for callback message
  openPopupFn: (url) => new Promise((resolve, reject) => {
    const popup = window.open(url, 'clawser_oauth', 'width=600,height=700,popup=yes');
    if (!popup) { reject(new Error('Popup blocked — allow popups for this site.')); return; }

    const timeout = setTimeout(() => {
      window.removeEventListener('message', handler);
      reject(new Error('OAuth timeout — popup was closed or took too long.'));
    }, 120_000);

    function handler(event) {
      // Origin/source filter: only accept messages from the popup we
      // opened, AND only from our own origin (the oauth-callback.html
      // page that posts back to us). Without this, any page that can
      // get a reference to our window (e.g., via iframing us) could
      // forge a fake OAuth callback by sending the magic message
      // type — letting an attacker substitute their own auth `code`.
      if (event.source !== popup) return;
      if (event.origin !== location.origin) return;
      if (event.data?.type !== '__clawser_oauth_callback__') return;
      clearTimeout(timeout);
      window.removeEventListener('message', handler);
      if (event.data.error) { reject(new Error(`OAuth error: ${event.data.error}`)); return; }
      resolve({ code: event.data.code, state: event.data.state });
    }
    window.addEventListener('message', handler);

    // Also poll in case postMessage fails (popup on different origin)
    const pollInterval = setInterval(() => {
      try { if (popup.closed) { clearInterval(pollInterval); clearTimeout(timeout); window.removeEventListener('message', handler); reject(new Error('OAuth popup closed by user.')); } } catch (e) { silentCatch('clawser-app', 'cross-origin-ignore', e) }
    }, 500);
  }),

  // Token exchange: POST code to provider's token endpoint
  exchangeCodeFn: async (provider, code, clientConfig) => {
    const { OAUTH_PROVIDERS } = await import('./clawser-oauth.js');
    const config = OAUTH_PROVIDERS[provider];
    if (!config) throw new Error(`Unknown provider: ${provider}`);

    const body = new URLSearchParams({
      client_id: clientConfig.clientId,
      client_secret: clientConfig.clientSecret || '',
      code,
      grant_type: 'authorization_code',
      redirect_uri: `${location.origin}/oauth-callback.html`,
    });

    // Try direct fetch first
    try {
      const resp = await fetch(config.tokenUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
        body,
      });
      if (resp.ok) {
        const tokens = await resp.json();
        if (tokens.expires_in) tokens.expires_at = Date.now() + tokens.expires_in * 1000;
        return tokens;
      }
    } catch { /* CORS blocked — try extension fallback */ }

    // Fallback: use Chrome extension CORS-free fetch if available
    try {
      const { getExtensionClient } = await import('./clawser-extension-tools.js');
      const client = getExtensionClient();
      if (client.connected) {
        const resp = await client.call('ext_fetch', {
          url: config.tokenUrl,
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
          body: body.toString(),
        });
        if (resp?.success) {
          const tokens = JSON.parse(resp.output);
          if (tokens.expires_in) tokens.expires_at = Date.now() + tokens.expires_in * 1000;
          return tokens;
        }
      }
    } catch { /* extension not available */ }

    throw new Error(`Token exchange failed for ${provider}. Some providers block browser CORS — install the Clawser extension for CORS-free requests.`);
  },

  // Token refresh
  refreshTokenFn: async (provider, refreshToken, clientConfig) => {
    const { OAUTH_PROVIDERS } = await import('./clawser-oauth.js');
    const config = OAUTH_PROVIDERS[provider];
    if (!config) throw new Error(`Unknown provider: ${provider}`);

    const body = new URLSearchParams({
      client_id: clientConfig.clientId,
      client_secret: clientConfig.clientSecret || '',
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
    });

    const resp = await fetch(config.tokenUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
      body,
    });
    if (!resp.ok) throw new Error(`Token refresh failed: ${resp.status}`);
    const tokens = await resp.json();
    if (tokens.expires_in) tokens.expires_at = Date.now() + tokens.expires_in * 1000;
    tokens.refresh_token = tokens.refresh_token || refreshToken;
    return tokens;
  },
});

// ── Feature module singletons ────────────────────────────────────
const _onLog = (level, msg) => console.log(`[clawser] ${msg}`);
state.toolBuilder = new ToolBuilder(state.browserTools, async (code) => {
  const { createSandbox } = await import('./packages-andbox.js');
  const sb = await createSandbox();
  try { return await sb.evaluate(code); } finally { sb.dispose?.(); }
});
state.channelManager = new ChannelManager({ onLog: _onLog });
state.delegateManager = new DelegateManager({ maxConcurrency: 3 });
state.gitBehavior = new GitBehavior({
  ops: {
    exec: async (cmd) => {
      if (!state.shell) return { code: 1, stdout: '', stderr: 'No shell available' };
      return state.shell.exec(cmd);
    },
  },
});
state.gitMemory = new GitEpisodicMemory(state.gitBehavior);
state.automationManager = new AutomationManager({ onLog: _onLog });
state.sandboxManager = new SandboxManager({ onLog: _onLog });
state.peripheralManager = new PeripheralManager({ onLog: _onLog });

// Tunnel Manager — Cloudflare quick tunnels + ngrok via the wsh_exec tool.
// Providers are registered eagerly; activation only happens when the user
// invokes a tunnel start. The exec callback resolves lazily so the wsh tool
// has time to register itself before any tunnel is actually started.
state.tunnelManager = new TunnelManager();
const tunnelExec = async (cmd, args) => {
  const tool = state.browserTools?.get?.('wsh_exec');
  if (!tool || typeof tool.execute !== 'function') {
    throw new Error('wsh_exec tool not available — connect to a wsh server first');
  }
  return tool.execute({ cmd, args });
};
state.tunnelManager.registerProvider('cloudflare', new CloudflareTunnel({ exec: tunnelExec }));
state.tunnelManager.registerProvider('ngrok', new NgrokTunnel({ exec: tunnelExec }));
state.pairingManager = new PairingManager({ onLog: _onLog });
state.goalManager = new GoalManager();
state.skillRegistryClient = new SkillRegistryClient();

// Freeze service singleton slots to prevent accidental reassignment
Object.defineProperty(state, 'workspaceFs', { value: state.workspaceFs, writable: false, configurable: false });
Object.defineProperty(state, 'browserTools', { value: state.browserTools, writable: false, configurable: false });
Object.defineProperty(state, 'providers', { value: state.providers, writable: false, configurable: false });
Object.defineProperty(state, 'mcpManager', { value: state.mcpManager, writable: false, configurable: false });
Object.defineProperty(state, 'responseCache', { value: state.responseCache, writable: false, configurable: false });
Object.defineProperty(state, 'vault', { value: state.vault, writable: false, configurable: false });

// ── Skills ──────────────────────────────────────────────────────
state.skillRegistry = new SkillRegistry({
  browserTools: state.browserTools,
  mcpManager: state.mcpManager,
  onLog: (level, msg) => console.log(`[skills] ${msg}`),
  onActivationChange: (name, active, toolNames) => {
    if (active) {
      state.activeSkillPrompts.set(name, state.skillRegistry.buildActivationPrompt(name));
      if (state.agent && toolNames?.length > 0) {
        for (const tn of toolNames) {
          const spec = state.browserTools.allSpecs().find(s => s.name === tn);
          if (spec) state.agent.registerToolSpec(spec);
        }
      }
    } else {
      state.activeSkillPrompts.delete(name);
      if (state.agent && toolNames?.length > 0) {
        for (const tn of toolNames) {
          state.agent.unregisterToolSpec(tn);
        }
      }
    }
  },
});

// ── Cross-module event bus ──────────────────────────────────────
on('refreshFiles', () => refreshFiles());
on('renderGoals', () => renderGoals());
on('renderSkills', () => renderSkills());
on('saveConfig', () => saveConfig());
on('newShellSession', () => createShellSession());
on('updateCostMeter', () => updateCostMeter());
on('updateDaemon', (phase) => updateDaemonBadge(phase));
on('updateRemote', (count) => updateRemoteBadge(count));
on('refreshDashboard', () => refreshDashboard());

// ── Vault Passphrase Modal ───────────────────────────────────
/**
 * Show the vault passphrase modal and wait for the user to unlock or create the vault.
 * @param {import('./clawser-vault.js').SecretVault} vault
 * @returns {Promise<void>}
 */
async function showVaultModal(vault) {
  const modal = document.getElementById('vaultModal');
  if (!modal) return;

  const isNew = !(await vault.exists());
  const title = document.getElementById('vaultModalTitle');
  const desc = document.getElementById('vaultModalDesc');
  const confirm = document.getElementById('vaultPassphraseConfirm');
  const submit = document.getElementById('vaultSubmit');
  const error = document.getElementById('vaultError');
  const input = document.getElementById('vaultPassphrase');

  const recoverBtn = document.getElementById('vaultRecoverBtn');
  const destroyBtn = document.getElementById('vaultDestroyBtn');
  if (destroyBtn) destroyBtn.style.display = 'none'; // revealed after a failed unlock

  if (isNew) {
    title.textContent = 'Create Vault';
    desc.textContent = 'Choose a passphrase to protect your API keys.';
    confirm.style.display = '';
    submit.textContent = 'Create';
    if (recoverBtn) recoverBtn.style.display = 'none';
  } else {
    title.textContent = 'Unlock Vault';
    desc.textContent = 'Enter your passphrase to unlock the vault.';
    confirm.style.display = 'none';
    submit.textContent = 'Unlock';
    if (recoverBtn) recoverBtn.style.display = (await vault.hasRecovery()) ? '' : 'none';
  }

  // Show "Unlock with passkey" if any passkey wraps exist for this vault.
  await updatePasskeyUnlockButton(vault);

  return new Promise((resolve) => {
    const ac = new AbortController();
    const form = modal.querySelector('form');
    // Clean up any previous onsubmit handler to prevent listener accumulation
    form.onsubmit = null;
    modal.showModal();
    input.focus();
    modal.addEventListener('cancel', (e) => {
      e.preventDefault(); // prevent Escape from closing — user must submit
    }, { signal: ac.signal });
    // If the modal is closed via passkey unlock (which calls modal.close()
    // directly from outside the form-submit path), resolve the boot
    // Promise once we observe the vault is unlocked.
    modal.addEventListener('close', () => {
      if (!vault.isLocked) {
        ac.abort();
        input.value = '';
        confirm.value = '';
        resolve();
      }
    }, { signal: ac.signal });
    recoverBtn?.addEventListener('click', async () => {
      error.style.display = 'none';
      try {
        const { modal: dialogs } = await import('./clawser-modal.js');
        const code = await dialogs.prompt('Enter your vault recovery code:', '', { title: 'Vault Recovery' });
        if (!code) return;
        const newPass = await dialogs.prompt('Choose a new passphrase:', '', { title: 'Vault Recovery' });
        if (!newPass) return;
        const result = await vault.recoverWithCode(code, newPass);
        if (!result.success) {
          error.textContent = result.error || 'Recovery failed';
          error.style.display = '';
          return;
        }
        await dialogs.alert(
          `Vault recovered. Your NEW recovery code:\n\n${result.recoveryCode}\n\nSave it now — the old code no longer works and this one will not be shown again.`,
          { title: 'Save your new recovery code' },
        );
        vault.resetIdleTimer();
        modal.close();
        ac.abort();
        input.value = '';
        confirm.value = '';
        resolve();
      } catch (err) {
        error.textContent = err.message || 'Recovery failed';
        error.style.display = '';
      }
    }, { signal: ac.signal });
    // Last-resort escape hatch for a corrupted or fully inaccessible vault:
    // destroys all secrets and restarts the flow in create mode.
    destroyBtn?.addEventListener('click', async () => {
      try {
        const { modal: dialogs } = await import('./clawser-modal.js');
        const sure = await dialogs.confirm(
          'Reset the vault? ALL stored secrets (API keys, credentials) will be permanently deleted. This cannot be undone.',
          { title: 'Reset Vault', danger: true, okLabel: 'Delete everything' },
        );
        if (!sure) return;
        await vault.destroy();
        modal.close();
        ac.abort();
        input.value = '';
        confirm.value = '';
        // Restart the flow — vault no longer exists, so this runs create mode
        resolve(showVaultModal(vault));
      } catch (err) {
        error.textContent = err.message || 'Vault reset failed';
        error.style.display = '';
      }
    }, { signal: ac.signal });
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      error.style.display = 'none';
      const pass = input.value;

      if (!pass) {
        error.textContent = 'Passphrase is required';
        error.style.display = '';
        return;
      }

      if (isNew && pass !== confirm.value) {
        error.textContent = 'Passphrases do not match';
        error.style.display = '';
        return;
      }

      try {
        const ok = await vault.verify(pass);
        if (!ok) {
          error.textContent = 'Invalid passphrase';
          error.style.display = '';
          // Reveal the destructive escape hatch after a failed unlock
          if (!isNew && destroyBtn) destroyBtn.style.display = '';
          return;
        }
        // verify() leaves the vault unlocked with the correct key
        vault.resetIdleTimer();
        modal.close();
        ac.abort(); // removes both cancel and submit listeners
        input.value = '';
        confirm.value = '';

        // First-time setup: issue a recovery code and show it exactly once
        if (isNew) {
          try {
            const { modal: dialogs } = await import('./clawser-modal.js');
            const code = await vault.setupRecovery();
            await dialogs.alert(
              `Vault recovery code:\n\n${code}\n\nSave this somewhere safe NOW — it is the only way to regain access if you forget your passphrase, and it will not be shown again.`,
              { title: 'Save your recovery code' },
            );
          } catch (err) {
            console.warn('[clawser] vault recovery setup failed:', err.message);
          }
        }
        resolve();
      } catch (err) {
        input.value = '';
        confirm.value = '';
        error.textContent = err.message || 'Invalid passphrase';
        error.style.display = '';
        // Decrypt errors on an existing vault may mean corruption — offer reset
        if (!isNew && destroyBtn) destroyBtn.style.display = '';
      }
    }, { signal: ac.signal });
  });
}

// ── App-level shutdown (C5) ──────────────────────────────────────
export async function shutdown() {
  if (state.shuttingDown) return;
  state.shuttingDown = true;

  const quiet = async (fn) => { try { await fn(); } catch (e) { silentCatch('clawser-app', 'fn', e) } };

  // Stop daemon
  if (state.daemonController) await quiet(() => state.daemonController.stop());
  // Sync final routine state to IndexedDB before stopping
  if (state.routineEngine && state.checkpointIDB) {
    await quiet(async () => {
      const { syncRoutinesToIDB } = await import('./clawser-workspace-lifecycle.js');
      await syncRoutinesToIDB();
    });
  }
  // Stop routine engine
  if (state.routineEngine) await quiet(() => state.routineEngine.stop());
  // Flush any debounced config writes
  await quiet(() => configCache.flush());
  // Persist agent state
  if (state.agent) {
    await quiet(() => state.agent.persistMemories());
    await quiet(() => state.agent.persistCheckpoint());
    await quiet(() => state.agent.persistConfig());
  }
  // Persist terminal
  if (state.terminalSessions) await quiet(() => state.terminalSessions.persist());
  // Lock vault
  if (state.vault) await quiet(() => state.vault.lock());
  // Disconnect MCP clients
  if (state.mcpManager) {
    for (const name of state.mcpManager.serverNames || []) {
      await quiet(() => state.mcpManager.removeServer(name));
    }
  }
  // Close kernel integration, then kernel itself
  const { getKernelIntegration } = await import('./clawser-workspace-lifecycle.js');
  const ki = getKernelIntegration();
  if (ki) await quiet(() => ki.close());
  if (state.kernel) await quiet(() => state.kernel.close());

  emit('shutdown'); // emitted for future extension hooks
}

// ── Startup ─────────────────────────────────────────────────────
initRouterListeners();
initAccountListeners();
initPanelListeners();
initCmdPaletteListeners();
initChatListeners();
initKeyboardShortcuts();
initHomeListeners();

// Unlock vault before any workspace/account initialization
(async () => {
  // Wire up vault settings gear icon
  initVaultSettings();

  if (state.vault && state.vault.isLocked && !state.demoMode && !state.disposableMode) {
    await showVaultModal(state.vault);
    // After unlock, migrate any plaintext account keys to vault
    const { migrateKeysToVault } = await import('./clawser-accounts.js');
    const migrated = await migrateKeysToVault();
    if (migrated > 0) console.log(`[clawser] Migrated ${migrated} API key(s) to vault`);
  }

  // Demo mode banner
  if (state.demoMode) {
    const banner = document.getElementById('demoBanner');
    if (banner) banner.style.display = '';
  }

  // Disposable mode banner
  if (state.disposableMode) {
    const banner = document.getElementById('disposableBanner');
    if (banner) banner.style.display = '';
    console.log('[clawser] Disposable mode — nothing will persist after tab close');
  }

  // Phase 0: bootstrap OPFS directory structure + default configs.
  // Must run BEFORE initWorkspacesCache so /etc/clawser/ exists for writes.
  try {
    await bootstrapFilesystem();
  } catch (e) {
    console.warn('[clawser] filesystem bootstrap failed (OPFS may be unavailable):', e);
  }

  // Prime the workspace cache from OPFS (with one-time migration from
  // localStorage if OPFS is empty). After this, synchronous workspace
  // accessors hit the in-memory cache.
  try {
    await initWorkspacesCache();
  } catch (e) {
    console.warn('[clawser] workspaces cache init failed:', e);
  }

  ensureDefaultWorkspace();

  handleRoute();

  // ── Background execution: register periodicSync (Tier 3 fallback) ──
  try {
    const reg = await navigator.serviceWorker?.ready;
    if (reg?.periodicSync) {
      await reg.periodicSync.register('clawser-scheduler', { minInterval: 60 * 60 * 1000 });
    }
  } catch { /* periodicSync not available or permission denied — Tiers 1/2 still work */ }

  // ── PWA install flow: capture beforeinstallprompt for later trigger ──
  try { initPwaInstall(); } catch (e) { silentCatch('clawser-app', 'initPwaInstall', e) }

  // ── "While you were away" summary from background execution log ──
  try {
    const log = await state.checkpointIDB.read('background_execution_log');
    if (Array.isArray(log) && log.length > 0) {
      const builder = new AwaySummaryBuilder();
      for (const entry of log) {
        for (const r of (entry.results || [])) {
          builder.addEvent({ type: r.result || 'background_run', timestamp: entry.timestamp, routineId: r.routineId });
        }
      }
      const summary = builder.build();
      if (summary.events.length > 0) {
        const { addMsg } = await import('./clawser-ui-chat.js');
        addMsg('system', summary.text);
      }
      // Clear the log after presenting it
      await state.checkpointIDB.delete('background_execution_log');
    }
  } catch (e) { silentCatch('clawser-app', 'idb-not-available-or-empty-ignore', e) }
})();

// Auto-save on page unload.
// beforeunload cannot await async shutdown(), so we do sync-safe work only.
// The visibilitychange handler (below) is the primary async save trigger.
window.addEventListener('beforeunload', () => {
  if (state.shuttingDown) return;
  state.shuttingDown = true;
  if (state.disposableMode) return; // nothing to persist
  // Sync-safe: persistMemories writes to localStorage (synchronous)
  try { state.agent?.persistMemories(); } catch (e) { silentCatch('clawser-app', 'state.agent', e) }
  // Sync-safe: vault lock clears in-memory key (no I/O)
  try { state.vault?.lock(); } catch (e) { silentCatch('clawser-app', 'state.vault', e) }
  // Sync-safe: persistConfig writes to localStorage (synchronous)
  try { state.agent?.persistConfig?.(); } catch (e) { silentCatch('clawser-app', 'state.agent', e) }
});

// Primary save trigger — visibilitychange fires reliably and supports async.
document.addEventListener('visibilitychange', () => {
  if (state.shuttingDown || state.disposableMode) return;
  if (document.visibilityState === 'hidden' && state.agent) {
    try { state.agent.persistMemories(); } catch (e) { silentCatch('clawser-app', 'state.agent.persistMemories', e) }
    state.agent.persistCheckpoint().catch(e => console.warn('[clawser] Checkpoint save:', e.message));
    try { state.agent.persistConfig?.(); } catch (e) { silentCatch('clawser-app', 'state.agent.persistConfig', e) }
  }
});
