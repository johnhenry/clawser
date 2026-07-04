import { registerClawserCli } from './clawser-cli.js';
import { registerAndboxCli } from './clawser-andbox-cli.js';
import { registerWshCli } from './clawser-wsh-cli.js';
import { registerSchedulerCli } from './clawser-scheduler-cli.js';
import { registerModelCli } from './clawser-model-cli.js';
import { registerSnapshotCli } from './clawser-snapshot-cli.js';
import { ClawserShell } from './clawser-shell.js';
import { registerChmodBuiltin } from './clawser-permissions.js';
import { injectEnvIntoShell } from './clawser-fs-env.mjs';
import { activeSanitizedName } from './clawser-workspace-name.mjs';
import { loadWorkspaces } from './clawser-workspaces.js';

/**
 * Create a shell configured with Clawser's workspace CLI commands.
 *
 * This keeps shell construction consistent across the visible terminal and
 * any future headless or remote shells.
 *
 * @param {object} [opts]
 * @param {import('./clawser-tools.js').WorkspaceFs} [opts.workspaceFs]
 * @param {object} [opts.fs]
 * @param {string} [opts.wsId] - Workspace ID for system path resolution
 * @param {boolean} [opts.sourceRc=true]
 * @param {import('./clawser-proc.js').ProcFileHandler} [opts.procHandler] - /proc virtual file handler
 * @param {import('./clawser-fs-devices.mjs').DeviceFileHandler} [opts.deviceHandler] - /dev device handler
 * @param {import('./clawser-permissions.js').PermissionManager} [opts.permissions] - Permission manager
 * @param {() => unknown} [opts.getAgent]
 * @param {() => unknown} [opts.getRoutineEngine]
 * @param {() => unknown} [opts.getModelManager]
 * @param {() => unknown} [opts.getSkillRegistry]
 * @returns {Promise<ClawserShell>}
 */
export async function createConfiguredShell({
  workspaceFs,
  fs,
  wsId,
  sourceRc = true,
  procHandler,
  deviceHandler,
  permissions,
  getAgent = () => null,
  getRoutineEngine = () => null,
  getModelManager = () => null,
  getSkillRegistry = () => null,
} = {}) {
  const shell = new ClawserShell({ workspaceFs, fs, wsId, procHandler, deviceHandler, permissions });

  // Set clsh environment variables
  shell.state.env.set('SHELL', 'clsh');
  shell.state.env.set('CLSH_VERSION', '1.0');

  // Resolve the sanitized workspace name → set HOME = /home/<name> and
  // teach the shell's fs about the alias. When no workspace list is
  // available (early boot, headless tests), fall back to legacy HOME=/.
  let homeName = null;
  if (wsId) {
    try { homeName = activeSanitizedName(loadWorkspaces(), wsId); }
    catch { homeName = null; }
  }
  shell.setActiveHomeName(homeName);

  // Register chmod builtin if permissions manager is available
  if (permissions) {
    registerChmodBuiltin(shell.registry, permissions);
  }

  if (sourceRc) {
    await shell.source('/.clawserrc');
  }

  // Source system and user profiles
  await shell.sourceProfiles();

  // Phase 6: load ~/.config/clawser/.env into the shell environment.
  // Best-effort — a missing or malformed file is a no-op.
  if (wsId) {
    try {
      await injectEnvIntoShell(wsId, shell.state);
    } catch (e) {
      console.warn(`[clawser] .env load failed: ${e?.message || e}`);
    }
  }

  const getShell = () => shell;
  registerClawserCli(shell.registry, getAgent, getShell);
  registerAndboxCli(shell.registry, getAgent, getShell);
  registerWshCli(shell.registry, getAgent, getShell);
  registerSchedulerCli(shell.registry, getRoutineEngine, getAgent);
  registerModelCli(shell.registry, getModelManager);
  registerSnapshotCli(shell.registry, getAgent, getShell, getRoutineEngine, getSkillRegistry);

  return shell;
}
