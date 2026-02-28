export interface ItemBarConfig {
  containerId: string;
  label: string;
  newLabel: string;
  emptyMessage: string;
  defaultName: string;
  getActiveName: () => string | null;
  getActiveId: () => string | null;
  listItems: () => Array<{ id: string; name: string; lastUsed?: number; [key: string]: unknown }> | Promise<Array<{ id: string; name: string; lastUsed?: number; [key: string]: unknown }>>;
  onNew: () => Promise<void>;
  onSwitch: (id: string) => Promise<void>;
  onRename: (id: string, newName: string) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
  onFork?: (() => Promise<void>) | null;
  exportFormats?: Array<{ label: string; fn: () => string; filename: string; mime: string }> | null;
  renderMeta: (item: Record<string, unknown>) => string;
}

export interface ItemBarHandle {
  refresh: () => void;
  destroy: () => void;
}

export function _relativeTime(ts: number | null | undefined): string;
export function _downloadText(content: string, filename: string, mime: string): void;
export function createItemBar(config: ItemBarConfig): ItemBarHandle;
