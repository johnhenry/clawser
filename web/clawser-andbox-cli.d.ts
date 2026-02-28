export interface SubcommandMeta {
  name: string;
  description: string;
  usage?: string;
}

export const ANDBOX_SUBCOMMAND_META: SubcommandMeta[];
export function registerAndboxCli(registry: unknown, getAgent: () => unknown, getShell: () => unknown): void;
