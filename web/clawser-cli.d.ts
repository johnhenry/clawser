export interface SubcommandMeta {
  name: string;
  description: string;
  usage?: string;
}

export function parseFlags(
  args: string[],
  spec: Record<string, string | boolean>,
): { flags: Record<string, string | boolean>; positional: string[] };

export const CLAWSER_SUBCOMMAND_META: SubcommandMeta[];
export function registerClawserCli(registry: unknown, getAgent: () => unknown, getShell: () => unknown): void;
