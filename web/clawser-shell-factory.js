import { registerClawserCli } from './clawser-cli.js';
import { registerAndboxCli } from './clawser-andbox-cli.js';
import { registerWshCli } from './clawser-wsh-cli.js';
import { registerSchedulerCli } from './clawser-scheduler-cli.js';
import { registerModelCli } from './clawser-model-cli.js';
import { ClawserShell } from './clawser-shell.js';

/**
 * Create a shell configured with Clawser's workspace CLI commands.
 *
 * This keeps shell construction consistent across the visible terminal and
 * any future headless or remote shells.
 *
 * @param {object} [opts]
 * @param {import('./clawser-tools.js').WorkspaceFs} [opts.workspaceFs]
 * @param {object} [opts.fs]
 * @param {boolean} [opts.sourceRc=true]
 * @param {() => unknown} [opts.getAgent]
 * @param {() => unknown} [opts.getRoutineEngine]
 * @param {() => unknown} [opts.getModelManager]
 * @returns {Promise<ClawserShell>}
 */
export async function createConfiguredShell({
  workspaceFs,
  fs,
  sourceRc = true,
  getAgent = () => null,
  getRoutineEngine = () => null,
  getModelManager = () => null,
} = {}) {
  const shell = new ClawserShell({ workspaceFs, fs });

  if (sourceRc) {
    await shell.source('/.clawserrc');
  }

  const getShell = () => shell;
  registerClawserCli(shell.registry, getAgent, getShell);
  registerAndboxCli(shell.registry, getAgent, getShell);
  registerWshCli(shell.registry, getAgent, getShell);
  registerSchedulerCli(shell.registry, getRoutineEngine, getAgent);
  registerModelCli(shell.registry, getModelManager);

  return shell;
}
