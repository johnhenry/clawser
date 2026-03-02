// clawser-ui-drop.js — Drag-and-drop folder mounting
//
// Handles dragover/drop events to mount local directories via
// DataTransferItem.getAsFileSystemHandle() (Chrome 86+).
// Mounts under /mnt/{name}.

// ── Handle extraction ───────────────────────────────────────────

/**
 * Extract FileSystem handles from DataTransferItem list.
 * Filters for items that support getAsFileSystemHandle().
 * @param {DataTransferItemList|Array} items
 * @returns {Promise<Array<FileSystemHandle>>}
 */
export async function extractHandles(items) {
  const handles = [];
  for (const item of items) {
    if (typeof item.getAsFileSystemHandle !== 'function') continue;
    try {
      const handle = await item.getAsFileSystemHandle();
      if (handle) handles.push(handle);
    } catch {
      // Permission denied or unsupported — skip
    }
  }
  return handles;
}

/**
 * Generate a mount path for a FileSystem handle.
 * Sanitizes the name to remove spaces and special characters.
 * @param {FileSystemHandle} handle
 * @returns {string} Mount path e.g. '/mnt/my-app'
 */
export function mountPathForHandle(handle) {
  const sanitized = (handle.name || 'unnamed')
    .replace(/\s+/g, '-')
    .replace(/[^a-zA-Z0-9._-]/g, '')
    .toLowerCase();
  return `/mnt/${sanitized}`;
}

// ── DropHandler ─────────────────────────────────────────────────

/**
 * Handles drag-and-drop events for mounting local filesystem handles.
 * Attach to a DOM element's dragover and drop events.
 */
export class DropHandler {
  /** @type {Function} */
  #onMount;

  /**
   * @param {object} [opts]
   * @param {Function} [opts.onMount] - (path: string, handle: FileSystemHandle) => void
   */
  constructor(opts = {}) {
    this.#onMount = opts.onMount || (() => {});
  }

  /**
   * Handle dragover event. Prevents default to allow drop.
   * @param {DragEvent} event
   */
  handleDragOver(event) {
    event.preventDefault();
    if (event.dataTransfer) {
      event.dataTransfer.dropEffect = 'copy';
    }
  }

  /**
   * Handle drop event. Extracts handles and calls onMount for each.
   * @param {DragEvent} event
   */
  async handleDrop(event) {
    event.preventDefault();
    const items = event.dataTransfer?.items;
    if (!items || items.length === 0) return;

    const handles = await extractHandles(items);
    for (const handle of handles) {
      const path = mountPathForHandle(handle);
      this.#onMount(path, handle);
    }
  }

  /**
   * Bind dragover and drop handlers to a DOM element.
   * @param {HTMLElement} element
   */
  bind(element) {
    element.addEventListener('dragover', (e) => this.handleDragOver(e));
    element.addEventListener('drop', (e) => this.handleDrop(e));
  }
}
