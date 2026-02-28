// Re-exports from extracted modules
export { refreshFiles, mountLocalFolder, renderMountList } from './clawser-ui-files.js';
export { renderMemoryResults, doMemorySearch } from './clawser-ui-memory.js';
export { renderGoals, toggleGoalExpand } from './clawser-ui-goals.js';
export {
  applySecuritySettings,
  renderAutonomySection,
  saveAutonomySettings,
  renderIdentitySection,
  saveIdentitySettings,
  renderRoutingSection,
  renderAuthProfilesSection,
  saveSelfRepairSettings,
  renderSelfRepairSection,
  updateCacheStats,
  saveLimitsSettings,
  renderLimitsSection,
  saveSandboxSettings,
  renderSandboxSection,
  saveHeartbeatSettings,
  renderHeartbeatSection,
  renderOAuthSection,
  updateCostMeter,
  updateAutonomyBadge,
  updateDaemonBadge,
  updateRemoteBadge,
  refreshDashboard,
  renderApiKeyWarning,
  renderQuotaBar,
  renderCleanConversationsSection,
} from './clawser-ui-config.js';

// Local exports
export function renderToolRegistry(): void;
export function renderMcpServers(): void;
export function renderSkills(): void;
export function renderWsDropdown(): void;
export function searchSkillRegistry(query: string): Promise<void>;
export function terminalAppend(html: string): void;
export function terminalExec(cmd: string): Promise<void>;
export function terminalAskUser(questions: Array<{ key: string; label: string; default?: string }>): Promise<Record<string, string>>;
export let termItemBar: { refresh: () => void; destroy: () => void } | null;
export function renderTerminalSessionBar(): void;
export function replayTerminalSession(events: Array<Record<string, unknown>>): void;
export function renderToolManagementPanel(): void;
export function renderShellCommandPanel(): void;
export function initAgentPicker(): void;
export function updateAgentLabel(agentDef: Record<string, unknown>): void;
export function renderAgentPanel(): Promise<void>;
export function initPanelListeners(): void;
