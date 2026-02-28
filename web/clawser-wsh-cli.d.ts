/**
 * Type definitions for clawser-wsh-cli.js
 * — Browser shell commands for remote access.
 */

/**
 * Flag specification for the `wsh` CLI command.
 * Maps short flags to long names and long names to value types.
 */
export declare const FLAG_SPEC: {
  p: 'port';
  i: 'identity';
  t: 'transport';
  v: 'verbose';
  port: 'value';
  identity: 'value';
  transport: 'value';
  verbose: true;
};

/**
 * Help text for the `wsh` CLI command.
 */
export declare const HELP_TEXT: string;

export interface WshSubcommandMeta {
  name: string;
  description: string;
  usage: string;
}

/**
 * Subcommand metadata array for the `wsh` CLI.
 */
export declare const WSH_SUBCOMMAND_META: WshSubcommandMeta[];

/**
 * Register the `wsh` command with the shell registry.
 *
 * @param registry - Shell command registry
 * @param getAgent - Lazy getter for the ClawserAgent
 * @param getShell - Lazy getter for the ClawserShell
 */
export declare function registerWshCli(
  registry: unknown,
  getAgent: () => unknown,
  getShell: () => unknown,
): void;
