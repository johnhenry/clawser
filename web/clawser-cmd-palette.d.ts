import type { ToolSpec } from './types.d.ts';

export function openCommandPalette(): void;
export function closeCommandPalette(): void;
export function renderCmdToolList(filter: string): void;
export function selectCmdTool(spec: ToolSpec): void;
export function runCmdTool(): Promise<void>;
export function initCmdPaletteListeners(): void;
