/**
 * Type definitions for clawser-workspace-lifecycle.js
 * — Workspace creation, switching, and initialization.
 */

import type { KernelIntegration } from './clawser-kernel-integration.d.ts';

/**
 * Set the kernel integration adapter for workspace lifecycle hooks.
 */
export declare function setKernelIntegration(ki: KernelIntegration | null): void;

/**
 * Get the current kernel integration adapter.
 */
export declare function getKernelIntegration(): KernelIntegration | null;

/**
 * Create a fresh shell session for the current workspace.
 * Sources .clawserrc and registers CLI commands.
 */
export declare function createShellSession(): Promise<void>;

/**
 * Save current workspace state, switch to a new workspace,
 * and restore its agent/UI/conversation state.
 *
 * @param newId - Target workspace ID
 * @param convId - Optional conversation ID to open after switching
 */
export declare function switchWorkspace(newId: string, convId?: string): Promise<void>;

/**
 * Bootstrap a workspace from scratch: create agent, register tools,
 * restore state, discover skills.
 *
 * @param wsId - Workspace ID to initialize
 * @param convId - Optional conversation ID to restore
 */
export declare function initWorkspace(wsId: string, convId?: string): Promise<void>;
