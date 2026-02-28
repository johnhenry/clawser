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
import { $, state, on, emit, migrateLocalStorageKeys } from './clawser-state.js';
import { ensureDefaultWorkspace } from './clawser-workspaces.js';
import { initAccountListeners } from './clawser-accounts.js';
import { initRouterListeners } from './clawser-router.js';
import { initChatListeners } from './clawser-ui-chat.js';
import { refreshFiles, renderGoals, renderSkills, initPanelListeners, updateCostMeter, updateDaemonBadge, updateRemoteBadge, refreshDashboard } from './clawser-ui-panels.js';
import { initCmdPaletteListeners } from './clawser-cmd-palette.js';
import { initKeyboardShortcuts } from './clawser-keys.js';
import { saveConfig } from './clawser-accounts.js';

import { createDefaultRegistry } from './clawser-tools.js';
import { createDefaultProviders, ResponseCache } from './clawser-providers.js';
import { McpManager } from './clawser-mcp.js';
import { SkillRegistry, SkillRegistryClient } from './clawser-skills.js';
import { MountableFs } from './clawser-mount.js';
import { SecretVault, OPFSVaultStorage } from './clawser-vault.js';
import { IdentityManager } from './clawser-identity.js';
import { IntentRouter } from './clawser-intent.js';
import { InputSanitizer, ToolCallValidator, SafetyPipeline } from './clawser-safety.js';
import { ProviderHealth, ModelRouter } from './clawser-fallback.js';
import { StuckDetector, SelfRepairEngine } from './clawser-self-repair.js';
import { UndoManager } from './clawser-undo.js';
import { HeartbeatRunner } from './clawser-heartbeat.js';
import { AuthProfileManager } from './clawser-auth-profiles.js';
import { MetricsCollector, RingBufferLog } from './clawser-metrics.js';
import { DaemonController } from './clawser-daemon.js';
import { RoutineEngine } from './clawser-routines.js';
import { OAuthManager } from './clawser-oauth.js';
import { ToolBuilder } from './clawser-tool-builder.js';
import { ChannelManager } from './clawser-channels.js';
import { DelegateManager } from './clawser-delegate.js';
import { GitBehavior, GitEpisodicMemory } from './clawser-git.js';
import { AutomationManager } from './clawser-browser-auto.js';
import { SandboxManager } from './clawser-sandbox.js';
import { PeripheralManager } from './clawser-hardware.js';
import { PairingManager } from './clawser-remote.js';
import { BridgeManager } from './clawser-bridge.js';
import { GoalManager } from './clawser-goals.js';
import { addEvent } from './clawser-ui-chat.js';

// Extracted modules
import { createShellSession } from './clawser-workspace-lifecycle.js';
import { handleRoute } from './clawser-route-handler.js';
import { initHomeListeners } from './clawser-home-views.js';

// ── Migrate localStorage keys to versioned format (Gap 13.3) ────
migrateLocalStorageKeys();

// ── Create service singletons ───────────────────────────────────
state.workspaceFs = new MountableFs();
state.browserTools = createDefaultRegistry(state.workspaceFs);
state.providers = createDefaultProviders();
state.mcpManager = new McpManager({
  onLog: (level, msg) => console.log(`[mcp] ${msg}`),
});

state.responseCache = new ResponseCache();
state.vault = new SecretVault(new OPFSVaultStorage());

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
// OPFS path helper — walks directory segments like FsWriteTool/FsDeleteTool
async function opfsGetFile(path, create = false) {
  const resolved = state.workspaceFs ? state.workspaceFs.resolve(path) : path;
  const parts = resolved.split('/').filter(Boolean);
  const root = await navigator.storage.getDirectory();
  let dir = root;
  for (const part of parts.slice(0, -1)) {
    dir = await dir.getDirectoryHandle(part, { create });
  }
  return { dir, name: parts[parts.length - 1] };
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
state.daemonController = new DaemonController({
  getStateFn: () => state.agent?.getState(),
});
state.routineEngine = new RoutineEngine({
  executeFn: async (routine, triggerEvent) => {
    if (state.agent) {
      const prompt = routine.action?.prompt || routine.name;
      state.agent.sendMessage(prompt);
      return state.agent.run();
    }
  },
  onNotify: (routine, message) => addEvent('routine', message),
});

state.oauthManager = new OAuthManager({ vault: state.vault });

// ── Feature module singletons ────────────────────────────────────
const _onLog = (level, msg) => console.log(`[clawser] ${msg}`);
state.toolBuilder = new ToolBuilder(state.browserTools, (code) => new Function(code)());
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
state.pairingManager = new PairingManager({ onLog: _onLog });
state.bridgeManager = new BridgeManager({});
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

  if (isNew) {
    title.textContent = 'Create Vault';
    desc.textContent = 'Choose a passphrase to protect your API keys.';
    confirm.style.display = '';
    submit.textContent = 'Create';
  } else {
    title.textContent = 'Unlock Vault';
    desc.textContent = 'Enter your passphrase to unlock the vault.';
    confirm.style.display = 'none';
    submit.textContent = 'Unlock';
  }

  return new Promise((resolve) => {
    modal.showModal();
    input.focus();
    modal.addEventListener('cancel', (e) => {
      e.preventDefault(); // prevent Escape from closing — user must submit
    });
    modal.querySelector('form').onsubmit = async (e) => {
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
          return;
        }
        // verify() leaves the vault unlocked with the correct key
        vault.resetIdleTimer();
        modal.close();
        input.value = '';
        confirm.value = '';
        resolve();
      } catch (err) {
        error.textContent = err.message || 'Invalid passphrase';
        error.style.display = '';
      }
    };
  });
}

// ── App-level shutdown (C5) ──────────────────────────────────────
export async function shutdown() {
  if (state.shuttingDown) return;
  state.shuttingDown = true;

  const quiet = async (fn) => { try { await fn(); } catch { /* best-effort */ } };

  // Stop daemon
  if (state.daemonController) await quiet(() => state.daemonController.stop());
  // Stop routine engine
  if (state.routineEngine) await quiet(() => state.routineEngine.stop());
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
  // Disconnect bridge
  if (state.bridgeManager) await quiet(() => state.bridgeManager.disconnect());
  // Close kernel integration
  const { getKernelIntegration } = await import('./clawser-workspace-lifecycle.js');
  const ki = getKernelIntegration();
  if (ki) await quiet(() => ki.close());

  emit('shutdown');
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
  if (state.vault && state.vault.isLocked && !state.demoMode) {
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

  ensureDefaultWorkspace();
  handleRoute();
})();

// Auto-save on page unload.
// beforeunload cannot await async shutdown(), so we do sync-safe work only.
// The visibilitychange handler (below) is the primary async save trigger.
window.addEventListener('beforeunload', () => {
  if (state.shuttingDown) return;
  state.shuttingDown = true;
  // Sync-safe: persistMemories writes to localStorage (synchronous)
  try { state.agent?.persistMemories(); } catch { /* best-effort */ }
  // Sync-safe: vault lock clears in-memory key (no I/O)
  try { state.vault?.lock(); } catch { /* best-effort */ }
  // Sync-safe: persistConfig writes to localStorage (synchronous)
  try { state.agent?.persistConfig?.(); } catch { /* best-effort */ }
});

// Primary save trigger — visibilitychange fires reliably and supports async.
document.addEventListener('visibilitychange', () => {
  if (state.shuttingDown) return;
  if (document.visibilityState === 'hidden' && state.agent) {
    try { state.agent.persistMemories(); } catch { /* ignore */ }
    state.agent.persistCheckpoint().catch(() => { /* ignore */ });
    try { state.agent.persistConfig?.(); } catch { /* ignore */ }
  }
});
