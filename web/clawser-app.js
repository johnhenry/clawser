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
import { $, state, on, migrateLocalStorageKeys } from './clawser-state.js';
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
state.undoManager = new UndoManager({
  handlers: {
    revertHistory: (historyLength) => { /* agent #history is private; undo relies on event log replay */ },
    revertMemory: (op) => { /* memory revert handled by agent */ },
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

// ── Startup ─────────────────────────────────────────────────────
initRouterListeners();
initAccountListeners();
initPanelListeners();
initCmdPaletteListeners();
initChatListeners();
initKeyboardShortcuts();
initHomeListeners();

ensureDefaultWorkspace();
handleRoute();

// Auto-save terminal session on page unload
window.addEventListener('beforeunload', () => {
  if (state.terminalSessions?.dirty) {
    state.terminalSessions.persist().catch(() => {});
  }
});
