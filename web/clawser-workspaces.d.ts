export const WS_KEY: string;
export const WS_ACTIVE_KEY: string;

export interface WorkspaceEntry {
  id: string;
  name: string;
  created: number;
  lastUsed: number;
}

export function loadWorkspaces(): WorkspaceEntry[];
export function saveWorkspaces(list: WorkspaceEntry[]): void;
export function getActiveWorkspaceId(): string;
export function setActiveWorkspaceId(id: string): void;
export function ensureDefaultWorkspace(): WorkspaceEntry[];
export function createWorkspace(name?: string): string;
export function renameWorkspace(id: string, newName: string): void;
export function deleteWorkspace(id: string): Promise<void>;
export function getWorkspaceName(id: string): string;
export function touchWorkspace(id: string): void;
