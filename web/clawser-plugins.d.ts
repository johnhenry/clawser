/**
 * Type definitions for clawser-plugins.js
 * Plugin API — third-party tool and hook registration
 */

export interface PluginDescriptor {
  name: string;
  version: string;
  tools: Array<Record<string, unknown>>;
  hooks: Record<string, Function>;
  metadata: Record<string, unknown>;
  enabled: boolean;
  registeredAt: number;
}

export interface PluginInput {
  name: string;
  version?: string;
  tools?: Array<Record<string, unknown>>;
  hooks?: Record<string, Function>;
  metadata?: Record<string, unknown>;
}

export declare class PluginLoader {
  register(plugin: PluginInput): void;
  unregister(name: string): boolean;
  list(): Array<{ name: string; version: string; toolCount: number }>;
  get(name: string): PluginDescriptor | null;
  getTools(): Array<Record<string, unknown> & { _plugin: string }>;
  getHooks(): Record<string, Function[]>;
  enable(name: string): boolean;
  disable(name: string): boolean;
  get size(): number;
}
