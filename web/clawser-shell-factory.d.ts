import type { ClawserShell } from './clawser-shell.js';
import type { WorkspaceFs } from './clawser-tools.js';

export interface CreateConfiguredShellOptions {
  workspaceFs?: WorkspaceFs;
  fs?: object;
  sourceRc?: boolean;
  getAgent?: () => unknown;
  getRoutineEngine?: () => unknown;
  getModelManager?: () => unknown;
}

export declare function createConfiguredShell(
  opts?: CreateConfiguredShellOptions
): Promise<ClawserShell>;
