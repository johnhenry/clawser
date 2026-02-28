/**
 * Type definitions for clawser-mount.js
 * — Local Filesystem Mounting (File System Access API).
 */

import type { ToolResult } from './types.d.ts';

// ── Handle Persistence (IndexedDB) ──────────────────────────

/**
 * Persist a FileSystemHandle in IndexedDB for cross-session re-mount.
 */
export declare function persistHandle(
  mountPoint: string,
  handle: FileSystemDirectoryHandle | FileSystemFileHandle,
  meta?: Record<string, unknown>,
): Promise<void>;

/**
 * Retrieve a persisted handle and verify permission.
 */
export declare function restoreHandle(
  mountPoint: string,
  mode?: 'read' | 'readwrite',
): Promise<{
  handle: FileSystemHandle;
  meta: Record<string, unknown>;
} | null>;

/**
 * Remove a persisted handle.
 */
export declare function removePersistedHandle(mountPoint: string): Promise<void>;

/**
 * List all persisted mount points.
 */
export declare function listPersistedMounts(): Promise<string[]>;

// ── Directory Picker Wrapper ────────────────────────────────

/**
 * Check if the File System Access API is available.
 */
export declare function isFileSystemAccessSupported(): boolean;

/**
 * Show directory picker and return handle.
 */
export declare function pickDirectory(opts?: {
  mode?: 'read' | 'readwrite';
}): Promise<FileSystemDirectoryHandle>;

/**
 * Show file picker and return handle.
 */
export declare function pickFile(
  opts?: Record<string, unknown>,
): Promise<FileSystemFileHandle>;

// ── MountableFs ──────────────────────────────────────────────

export interface MountEntry {
  path: string;
  name: string;
  kind: 'directory' | 'file';
  readOnly: boolean;
}

export interface MountResolveResult {
  type: 'mount' | 'opfs';
  mountPoint?: string;
  handle?: FileSystemDirectoryHandle | FileSystemFileHandle;
  relative: string;
  readOnly?: boolean;
  kind?: 'directory' | 'file';
  opfsPath?: string;
}

/**
 * Filesystem abstraction with virtual mount table.
 * Routes paths through mounts before falling back to OPFS.
 */
export declare class MountableFs {
  /**
   * Mount a local directory or file at a path.
   */
  mount(
    mountPoint: string,
    handle: FileSystemDirectoryHandle | FileSystemFileHandle,
    opts?: { readOnly?: boolean },
  ): void;

  /**
   * Unmount a path.
   */
  unmount(mountPoint: string): boolean;

  /**
   * Check if a mount point exists.
   */
  isMounted(mountPoint: string): boolean;

  /**
   * Resolve a user path to the correct handle + relative path.
   */
  resolveMount(userPath: string): MountResolveResult;

  /**
   * Get the mount table for display/system prompt.
   */
  get mountTable(): MountEntry[];

  /** Number of active mounts. */
  get mountCount(): number;

  /** Clear all mounts. */
  unmountAll(): void;

  /**
   * Serialize mount metadata (handle names, not the handles themselves).
   */
  exportMounts(): MountEntry[];
}

// ── Agent Tools ──────────────────────────────────────────────

export declare class MountListTool {
  constructor(fs: MountableFs);
  get name(): 'mount_list';
  get description(): string;
  get parameters(): object;
  get permission(): 'read';
  execute(): Promise<ToolResult>;
}

export declare class MountResolveTool {
  constructor(fs: MountableFs);
  get name(): 'mount_resolve';
  get description(): string;
  get parameters(): object;
  get permission(): 'read';
  execute(params: { path: string }): Promise<ToolResult>;
}
