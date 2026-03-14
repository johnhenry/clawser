/**
 * clawser-workspace-init-tools.js — Tool registration extracted from workspace-lifecycle
 *
 * Provides registerAllTools() which registers ~120+ tools into the BrowserTool registry.
 * Called by initWorkspace() after the agent is created.
 */
import { $, state } from './clawser-state.js';
import { getActiveWorkspaceId } from './clawser-workspaces.js';
import { SwitchAgentTool, ConsultAgentTool } from './clawser-tools.js';
import { registerAgentTools, AskUserQuestionTool } from './clawser-tools.js';
import { ShellTool } from './clawser-shell.js';
import { AgentStorage } from './clawser-agent-storage.js';
import { ClawserAgent } from './clawser-agent.js';

import { ActivateSkillTool, DeactivateSkillTool, SkillInstallTool, SkillUpdateTool, SkillRemoveTool, SkillListTool, SkillSearchTool } from './clawser-skills.js';
import { MountListTool, MountResolveTool } from './clawser-mount.js';
import { ToolBuildTool, ToolTestTool, ToolListCustomTool, ToolEditTool, ToolRemoveTool } from './clawser-tool-builder.js';
import { ChannelListTool, ChannelSendTool, ChannelHistoryTool } from './clawser-channels.js';
import { DelegateTool } from './clawser-delegate.js';
import { GitStatusTool, GitDiffTool, GitLogTool, GitCommitTool, GitBranchTool, GitRecallTool } from './clawser-git.js';
import { BrowserOpenTool, BrowserReadPageTool, BrowserClickTool, BrowserFillTool, BrowserWaitTool, BrowserEvaluateTool, BrowserListTabsTool, BrowserCloseTabTool } from './clawser-browser-auto.js';
import { SandboxRunTool, SandboxStatusTool } from './clawser-sandbox.js';
import { registerWshTools } from './clawser-wsh-tools.js';
import { registerNetwayTools } from './clawser-netway-tools.js';
import { HwListTool, HwConnectTool, HwSendTool, HwReadTool, HwDisconnectTool, HwInfoTool } from './clawser-hardware.js';
import { RemoteStatusTool, RemotePairTool, RemoteRevokeTool } from './clawser-remote.js';
import { GoalAddTool, GoalUpdateTool, GoalAddArtifactTool, GoalListTool } from './clawser-goals.js';
import { DaemonStatusTool, DaemonCheckpointTool } from './clawser-daemon.js';
import { OAuthListTool, OAuthConnectTool, OAuthDisconnectTool, OAuthApiTool } from './clawser-oauth.js';
import { AuthListProfilesTool, AuthSwitchProfileTool, AuthStatusTool } from './clawser-auth-profiles.js';
import { RoutineCreateTool, RoutineListTool, RoutineDeleteTool, RoutineRunTool, RoutineHistoryTool, RoutineToggleTool, RoutineUpdateTool } from './clawser-routines.js';
import { SelfRepairStatusTool, SelfRepairConfigureTool } from './clawser-self-repair.js';
import { UndoTool, UndoStatusTool, RedoTool } from './clawser-undo.js';
import { IntentClassifyTool, IntentOverrideTool } from './clawser-intent.js';
import { HeartbeatStatusTool, HeartbeatRunTool } from './clawser-heartbeat.js';
import { registerExtensionTools, initExtensionBadge } from './clawser-extension-tools.js';
import { initServerManager, getServerManager, setServerRuntimeServiceResolver } from './clawser-server.js';
import { registerServerTools } from './clawser-server-tools.js';
import { GatewayServer } from './clawser-gateway-server.js';
import { ModelManager } from './clawser-models.js';
import { ModelListTool, ModelPullTool, ModelRemoveTool, ModelStatusTool, TranscribeTool, SpeakTool, CaptionTool, OcrTool, DetectObjectsTool, ClassifyImageTool, ClassifyTextTool } from './clawser-model-tools.js';

// Phase 8: OAuth + Integration tools
import { GoogleCalendarListTool, GoogleCalendarCreateTool, GoogleGmailSearchTool, GoogleGmailSendTool, GoogleDriveListTool, GoogleDriveReadTool, GoogleDriveCreateTool } from './clawser-google-tools.js';
import { NotionSearchTool, NotionCreatePageTool, NotionUpdatePageTool, NotionQueryDatabaseTool } from './clawser-notion-tools.js';
import { SlackChannelsTool, SlackPostTool, SlackHistoryTool } from './clawser-slack-tools.js';
import { LinearIssuesTool, LinearCreateIssueTool, LinearUpdateIssueTool } from './clawser-linear-tools.js';
import { GitHubPrReviewTool, GitHubIssueCreateTool, GitHubCodeSearchTool } from './clawser-integration-github.js';
import { CalendarAwarenessTool, CalendarFreeBusyTool, CalendarQuickAddTool } from './clawser-integration-calendar.js';
import { EmailDraftTool, EmailSummarizeTool, EmailTriageTool } from './clawser-integration-email.js';
import { SlackMonitorTool, SlackDraftResponseTool } from './clawser-integration-slack.js';

// Phase 9: CORS fetch proxy
import { ExtCorsFetchTool, setCorsFetchClient } from './clawser-cors-fetch.js';
import { getExtensionClient } from './clawser-extension-tools.js';

// Phase 5: Browser infrastructure
import { FsObserver } from './clawser-fs-observer.js';
import { TabViewManager } from './clawser-tab-views.js';

import { renderSkills, terminalAskUser, updateAgentLabel } from './clawser-ui-panels.js';
import { renderServerList, initServerPanel } from './clawser-ui-servers.js';

/**
 * Register all tools into the BrowserTool registry.
 * Called once during initWorkspace() after the agent is created.
 *
 * @param {Object} opts
 * @param {string} opts.activeWsId - Current workspace ID
 * @param {Function} opts.configureServerRuntimeResolver - Callback to configure server runtime resolver
 */
export async function registerAllTools({ activeWsId, configureServerRuntimeResolver }) {
  const agent = state.agent;
  const browserTools = state.browserTools;

  registerAgentTools(browserTools, agent);

  browserTools.register(new ActivateSkillTool(state.skillRegistry, () => {
    renderSkills();
  }));
  browserTools.register(new DeactivateSkillTool(state.skillRegistry, () => {
    renderSkills();
  }));

  // Register shell tool (reads current shell from state.shell)
  browserTools.register(new ShellTool(() => state.shell));

  // ── Feature module tools (36 tools) ──────────────────────────

  // Mount (2)
  browserTools.register(new MountListTool(state.workspaceFs));
  browserTools.register(new MountResolveTool(state.workspaceFs));

  // Local AI Models (11)
  if (!state.modelManager) {
    state.modelManager = new ModelManager();
  }
  browserTools.register(new ModelListTool(state.modelManager));
  browserTools.register(new ModelPullTool(state.modelManager));
  browserTools.register(new ModelRemoveTool(state.modelManager));
  browserTools.register(new ModelStatusTool(state.modelManager));
  browserTools.register(new TranscribeTool(state.modelManager));
  browserTools.register(new SpeakTool(state.modelManager));
  browserTools.register(new CaptionTool(state.modelManager));
  browserTools.register(new OcrTool(state.modelManager));
  browserTools.register(new DetectObjectsTool(state.modelManager));
  browserTools.register(new ClassifyImageTool(state.modelManager));
  browserTools.register(new ClassifyTextTool(state.modelManager));

  // Tool Builder (5)
  browserTools.register(new ToolBuildTool(state.toolBuilder));
  browserTools.register(new ToolTestTool(state.toolBuilder));
  browserTools.register(new ToolListCustomTool(state.toolBuilder));
  browserTools.register(new ToolEditTool(state.toolBuilder));
  browserTools.register(new ToolRemoveTool(state.toolBuilder));

  // Channels (3)
  browserTools.register(new ChannelListTool(state.channelManager));
  browserTools.register(new ChannelSendTool(state.channelManager));
  browserTools.register(new ChannelHistoryTool(state.channelManager));

  // Delegate (1) — uses lazy closures for provider/tool access
  browserTools.register(new DelegateTool({
    manager: state.delegateManager,
    chatFn: async (messages, tools) => {
      const providerSelect = $('providerSelect');
      const provId = providerSelect?.value || 'echo';
      const provider = state.providers?.get(provId);
      if (!provider) return { content: 'No provider available', tool_calls: [] };
      return provider.chat(messages, { tools });
    },
    executeFn: async (name, params) => browserTools.execute(name, params),
    toolSpecs: () => browserTools.allSpecs(),
  }));

  // Git (6)
  browserTools.register(new GitStatusTool(state.gitBehavior));
  browserTools.register(new GitDiffTool(state.gitBehavior));
  browserTools.register(new GitLogTool(state.gitBehavior));
  browserTools.register(new GitCommitTool(state.gitBehavior));
  browserTools.register(new GitBranchTool(state.gitBehavior));
  browserTools.register(new GitRecallTool(state.gitMemory));

  // Browser Automation (8)
  browserTools.register(new BrowserOpenTool(state.automationManager));
  browserTools.register(new BrowserReadPageTool(state.automationManager));
  browserTools.register(new BrowserClickTool(state.automationManager));
  browserTools.register(new BrowserFillTool(state.automationManager));
  browserTools.register(new BrowserWaitTool(state.automationManager));
  browserTools.register(new BrowserEvaluateTool(state.automationManager));
  browserTools.register(new BrowserListTabsTool(state.automationManager));
  browserTools.register(new BrowserCloseTabTool(state.automationManager));

  // Sandbox (2)
  browserTools.register(new SandboxRunTool(state.sandboxManager));
  browserTools.register(new SandboxStatusTool(state.sandboxManager));

  // wsh — Web Shell (10 tools)
  registerWshTools(browserTools);

  // netway — Virtual Networking (8 tools)
  registerNetwayTools(browserTools);

  // Hardware (6)
  browserTools.register(new HwListTool(state.peripheralManager));
  browserTools.register(new HwConnectTool(state.peripheralManager));
  browserTools.register(new HwSendTool(state.peripheralManager));
  browserTools.register(new HwReadTool(state.peripheralManager));
  browserTools.register(new HwDisconnectTool(state.peripheralManager));
  browserTools.register(new HwInfoTool(state.peripheralManager));

  // Remote (3)
  browserTools.register(new RemoteStatusTool(state.pairingManager));
  browserTools.register(new RemotePairTool(state.pairingManager));
  browserTools.register(new RemoteRevokeTool(state.pairingManager));

  // ── Gap-fill tools (31 tools from blocks 0-29) ─────────────

  // Goals (4)
  browserTools.register(new GoalAddTool(state.goalManager));
  browserTools.register(new GoalUpdateTool(state.goalManager));
  browserTools.register(new GoalAddArtifactTool(state.goalManager));
  browserTools.register(new GoalListTool(state.goalManager));

  // Daemon (2)
  browserTools.register(new DaemonStatusTool(state.daemonController));
  browserTools.register(new DaemonCheckpointTool(state.daemonController));

  // OAuth (4)
  browserTools.register(new OAuthListTool(state.oauthManager));
  browserTools.register(new OAuthConnectTool(state.oauthManager));
  browserTools.register(new OAuthDisconnectTool(state.oauthManager));
  browserTools.register(new OAuthApiTool(state.oauthManager));

  // Auth Profiles (3)
  browserTools.register(new AuthListProfilesTool(state.authProfileManager));
  browserTools.register(new AuthSwitchProfileTool(state.authProfileManager));
  browserTools.register(new AuthStatusTool(state.authProfileManager));

  // Routines (7)
  browserTools.register(new RoutineCreateTool(state.routineEngine));
  browserTools.register(new RoutineListTool(state.routineEngine));
  browserTools.register(new RoutineDeleteTool(state.routineEngine));
  browserTools.register(new RoutineRunTool(state.routineEngine));
  browserTools.register(new RoutineHistoryTool(state.routineEngine));
  browserTools.register(new RoutineToggleTool(state.routineEngine));
  browserTools.register(new RoutineUpdateTool(state.routineEngine));

  // Self-Repair (2)
  browserTools.register(new SelfRepairStatusTool(state.selfRepairEngine));
  browserTools.register(new SelfRepairConfigureTool(state.selfRepairEngine));

  // Undo/Redo (3)
  browserTools.register(new UndoTool(state.undoManager));
  browserTools.register(new UndoStatusTool(state.undoManager));
  browserTools.register(new RedoTool(state.undoManager));

  // Intent (2)
  browserTools.register(new IntentClassifyTool(state.intentRouter));
  browserTools.register(new IntentOverrideTool(state.intentRouter));

  // Heartbeat (2)
  browserTools.register(new HeartbeatStatusTool(state.heartbeatRunner));
  browserTools.register(new HeartbeatRunTool(state.heartbeatRunner));

  // Skills Registry (5)
  browserTools.register(new SkillSearchTool(state.skillRegistryClient));
  browserTools.register(new SkillInstallTool(state.skillRegistryClient, state.skillRegistry, () => getActiveWorkspaceId()));
  browserTools.register(new SkillUpdateTool(state.skillRegistryClient, state.skillRegistry, () => getActiveWorkspaceId()));
  browserTools.register(new SkillRemoveTool(state.skillRegistry, () => getActiveWorkspaceId()));
  browserTools.register(new SkillListTool(state.skillRegistry));

  // AskUserQuestion (1)
  browserTools.register(new AskUserQuestionTool(async (questions) => {
    return terminalAskUser(questions);
  }));

  // Agents (Block 37) — storage + tools
  try {
    const opfsRoot = await navigator.storage.getDirectory();
    let globalAgentDir;
    try { globalAgentDir = await opfsRoot.getDirectoryHandle('clawser_agents', { create: true }); } catch { globalAgentDir = null; }
    let wsAgentDir;
    try {
      const wsBase = await opfsRoot.getDirectoryHandle('clawser_workspaces', { create: true });
      const wsHandle = await wsBase.getDirectoryHandle(activeWsId, { create: true });
      wsAgentDir = await wsHandle.getDirectoryHandle('.agents', { create: true });
    } catch { wsAgentDir = null; }
    state.agentStorage = new AgentStorage({ globalDir: globalAgentDir, wsDir: wsAgentDir, wsId: activeWsId });
    await state.agentStorage.seedBuiltins();

    // Seed built-in accounts (echo, chrome-ai) and migrate unlinked agents
    try {
      const { seedBuiltinAccounts, loadAccounts } = await import('./clawser-accounts.js');
      const { migrateAgentAccounts } = await import('./clawser-agent-storage.js');
      seedBuiltinAccounts();
      if (!localStorage.getItem('clawser_agent_acct_migrated')) {
        const migrated = await migrateAgentAccounts(loadAccounts(), state.agentStorage);
        if (migrated > 0) console.log(`[clawser] Migrated ${migrated} agents to accounts`);
        localStorage.setItem('clawser_agent_acct_migrated', '1');
      }
    } catch (e) { console.warn('[clawser] Agent account seeding/migration failed:', e); }

    // Register agent tools
    browserTools.register(new SwitchAgentTool(state.agentStorage, agent));
    browserTools.register(new ConsultAgentTool(state.agentStorage, {
      providers: state.providers,
      browserTools: browserTools,
      mcpManager: state.mcpManager,
      onLog: (level, msg) => console.log(`[consult] ${msg}`),
      createEngine: async (engineOpts) => {
        const sub = await ClawserAgent.create(engineOpts);
        sub.init({});
        return sub;
      },
    }));

    // Restore active agent
    const activeAgent = await state.agentStorage.getActive();
    if (activeAgent) {
      await agent.applyAgent(activeAgent);
      updateAgentLabel(activeAgent);
    }
  } catch (e) {
    console.warn('[clawser] Agent storage init failed:', e);
  }

  // Chrome Extension — real browser control (34 tools)
  registerExtensionTools(browserTools);
  initExtensionBadge();

  // Virtual Server subsystem (Phase 7) — 8 tools
  try {
    await initServerManager();
    configureServerRuntimeResolver();
    registerServerTools(browserTools, () => getActiveWorkspaceId());
  } catch (e) { console.warn('[clawser] Server manager init failed:', e); }

  // Phase 7: Remote Gateway Server
  try {
    const gw = new GatewayServer({
      pairing: state.pairingManager,
      agent: agent,
      serverManager: getServerManager(),
    });
    state.gatewayServer = gw;
  } catch (e) { console.warn('[clawser] Gateway server init failed:', e); }

  // Phase 8: OAuth integration tools (7 Google + 4 Notion + 3 Slack + 3 Linear = 17)
  const oauth = state.oauthManager;
  browserTools.register(new GoogleCalendarListTool(oauth));
  browserTools.register(new GoogleCalendarCreateTool(oauth));
  browserTools.register(new GoogleGmailSearchTool(oauth));
  browserTools.register(new GoogleGmailSendTool(oauth));
  browserTools.register(new GoogleDriveListTool(oauth));
  browserTools.register(new GoogleDriveReadTool(oauth));
  browserTools.register(new GoogleDriveCreateTool(oauth));
  browserTools.register(new NotionSearchTool(oauth));
  browserTools.register(new NotionCreatePageTool(oauth));
  browserTools.register(new NotionUpdatePageTool(oauth));
  browserTools.register(new NotionQueryDatabaseTool(oauth));
  browserTools.register(new SlackChannelsTool(oauth));
  browserTools.register(new SlackPostTool(oauth));
  browserTools.register(new SlackHistoryTool(oauth));
  browserTools.register(new LinearIssuesTool(oauth));
  browserTools.register(new LinearCreateIssueTool(oauth));
  browserTools.register(new LinearUpdateIssueTool(oauth));

  // Phase 8: Integration wrappers (3 GitHub + 3 Calendar + 3 Email + 2 Slack = 11)
  browserTools.register(new GitHubPrReviewTool(oauth));
  browserTools.register(new GitHubIssueCreateTool(oauth));
  browserTools.register(new GitHubCodeSearchTool(oauth));
  browserTools.register(new CalendarAwarenessTool(oauth));
  browserTools.register(new CalendarFreeBusyTool(oauth));
  browserTools.register(new CalendarQuickAddTool(oauth));
  browserTools.register(new EmailDraftTool(oauth));
  browserTools.register(new EmailSummarizeTool(oauth));
  browserTools.register(new EmailTriageTool(oauth));
  browserTools.register(new SlackMonitorTool(oauth));
  browserTools.register(new SlackDraftResponseTool(oauth));

  // Phase 9: CORS fetch proxy (1)
  browserTools.register(new ExtCorsFetchTool(getExtensionClient()));
  setCorsFetchClient(getExtensionClient());

  // Phase 5: FileSystemObserver (optional, Chrome 129+)
  try {
    state.fsObserver = new FsObserver();
  } catch (e) { /* FsObserver unavailable in this browser */ }

  // Phase 5: TabViewManager
  try {
    state.tabViewManager = new TabViewManager();
  } catch (e) { /* Tab views unavailable */ }

  agent.refreshToolSpecs();
}
