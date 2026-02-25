/**
 * Clawser Browser Tools
 *
 * Standardized tool implementations that execute in the browser runtime.
 * Each tool follows the ToolSpec / ToolResult protocol so it can be
 * registered with the WASM agent and invoked from the agent loop.
 *
 * Tool layers:
 *   1. BrowserTool — base class with spec + execute
 *   2. BrowserToolRegistry — manages registration and lookup
 *   3. Individual tools — fetch, DOM, OPFS, storage, clipboard, etc.
 */

// ── WorkspaceFs — scopes OPFS paths to workspace home ────────────

export class WorkspaceFs {
  #wsId = 'default';

  setWorkspace(id) { this.#wsId = id; }
  getWorkspace() { return this.#wsId; }

  /** Absolute OPFS path to the workspace home directory */
  get homePath() { return `clawser_workspaces/${this.#wsId}`; }

  /**
   * Resolve a user-facing path to an absolute OPFS path under workspace home.
   * Strips leading slashes and ".." segments for safety.
   */
  resolve(userPath) {
    const clean = userPath.replace(/^\//, '').split('/').filter(p => p && p !== '..').join('/');
    return clean ? `${this.homePath}/${clean}` : this.homePath;
  }
}

// ── Base classes ──────────────────────────────────────────────────

export class BrowserTool {
  /** @returns {object} ToolSpec-compatible object */
  get spec() {
    return {
      name: this.name,
      description: this.description,
      parameters: this.parameters,
      required_permission: this.permission,
    };
  }

  get name() { throw new Error('implement name'); }
  get description() { throw new Error('implement description'); }
  get parameters() { return { type: 'object', properties: {} }; }
  get permission() { return 'internal'; }

  /**
   * Execute the tool.
   * @param {object} params - Parsed JSON parameters
   * @returns {Promise<{success: boolean, output: string, error?: string}>}
   */
  async execute(params) {
    throw new Error('implement execute');
  }
}

/**
 * Tool permission levels:
 *   'auto'     — always allowed (default for 'internal' and 'read' permissions)
 *   'approve'  — requires user approval before execution
 *   'denied'   — blocked entirely
 */
export const TOOL_PERMISSION_LEVELS = ['auto', 'approve', 'denied'];

export class BrowserToolRegistry {
  /** @type {Map<string, BrowserTool>} */
  #tools = new Map();

  /** @type {Map<string, 'auto'|'approve'|'denied'>} */
  #permissions = new Map();

  /** @type {Function|null} */
  #onApprovalRequest = null;

  register(tool) {
    this.#tools.set(tool.name, tool);
  }

  get(name) {
    return this.#tools.get(name) || null;
  }

  has(name) {
    return this.#tools.has(name);
  }

  unregister(name) {
    return this.#tools.delete(name);
  }

  /** Set a callback for approval requests. Callback receives (name, params) → Promise<boolean>. */
  setApprovalHandler(handler) {
    this.#onApprovalRequest = handler;
  }

  /**
   * Set permission level for a tool.
   * @param {string} name
   * @param {'auto'|'approve'|'denied'} level
   */
  setPermission(name, level) {
    this.#permissions.set(name, level);
  }

  /**
   * Get permission level for a tool.
   * @param {string} name
   * @returns {'auto'|'approve'|'denied'}
   */
  getPermission(name) {
    if (this.#permissions.has(name)) return this.#permissions.get(name);
    // Default: auto for internal/read tools, approve for network/browser/write
    const tool = this.#tools.get(name);
    if (!tool) return 'auto';
    const perm = tool.permission;
    if (perm === 'internal' || perm === 'read') return 'auto';
    return 'approve';
  }

  /**
   * Get all permission overrides.
   * @returns {Object<string, string>}
   */
  getAllPermissions() {
    const result = {};
    for (const [name, level] of this.#permissions) {
      result[name] = level;
    }
    return result;
  }

  /**
   * Load permissions from a plain object.
   * @param {Object<string, string>} perms
   */
  loadPermissions(perms) {
    this.#permissions.clear();
    for (const [name, level] of Object.entries(perms || {})) {
      if (TOOL_PERMISSION_LEVELS.includes(level)) {
        this.#permissions.set(name, level);
      }
    }
  }

  /** Reset all permission overrides back to defaults. */
  resetAllPermissions() {
    this.#permissions.clear();
  }

  /** Get a single tool spec by name. */
  getSpec(name) {
    const tool = this.#tools.get(name);
    return tool ? tool.spec : null;
  }

  /** @returns {object[]} All tool specs for registration with WASM */
  allSpecs() {
    return [...this.#tools.values()].map(t => t.spec);
  }

  /** @returns {string[]} All tool names */
  names() {
    return [...this.#tools.keys()];
  }

  async execute(name, params) {
    const tool = this.#tools.get(name);
    if (!tool) {
      return { success: false, output: '', error: `Tool not found: ${name}` };
    }

    // Check permission
    const level = this.getPermission(name);
    if (level === 'denied') {
      return { success: false, output: '', error: `Tool "${name}" is blocked by permission settings` };
    }
    if (level === 'approve') {
      if (!this.#onApprovalRequest) {
        // No approval handler registered — deny by default for safety
        return { success: false, output: '', error: `Tool "${name}" requires approval but no approval handler is configured` };
      }
      const approved = await this.#onApprovalRequest(name, params);
      if (!approved) {
        return { success: false, output: '', error: `Tool "${name}" was denied by user` };
      }
    }

    try {
      return await tool.execute(params);
    } catch (e) {
      return { success: false, output: '', error: e.message };
    }
  }
}

// ── browser_fetch ─────────────────────────────────────────────────

export class FetchTool extends BrowserTool {
  /** @type {Set<string>|null} */
  #domainAllowlist = null;

  get name() { return 'browser_fetch'; }
  get description() {
    return 'Fetch a URL via HTTP. Returns status, headers, and body text. Supports GET, POST, PUT, DELETE.';
  }
  get parameters() {
    return {
      type: 'object',
      properties: {
        url: { type: 'string', description: 'The URL to fetch' },
        method: { type: 'string', enum: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'], description: 'HTTP method (default: GET)' },
        headers: { type: 'object', description: 'Request headers as key-value pairs' },
        body: { type: 'string', description: 'Request body (for POST/PUT/PATCH)' },
      },
      required: ['url'],
    };
  }
  get permission() { return 'network'; }

  /**
   * Set a domain allowlist. If set, only URLs matching these domains will be fetched.
   * Pass null to disable the allowlist.
   * @param {string[]|null} domains
   */
  setDomainAllowlist(domains) {
    this.#domainAllowlist = domains ? new Set(domains.map(d => d.toLowerCase())) : null;
  }

  async execute({ url, method = 'GET', headers = {}, body }) {
    // Domain allowlist check
    if (this.#domainAllowlist) {
      try {
        const hostname = new URL(url).hostname.toLowerCase();
        const allowed = [...this.#domainAllowlist].some(d =>
          hostname === d || hostname.endsWith('.' + d)
        );
        if (!allowed) {
          return { success: false, output: '', error: `Domain "${hostname}" is not in the allowlist` };
        }
      } catch (e) {
        return { success: false, output: '', error: `Invalid URL: ${url}` };
      }
    }

    const opts = { method, headers };
    if (body && method !== 'GET') opts.body = body;

    let resp;
    try {
      resp = await fetch(url, opts);
    } catch (e) {
      return { success: false, output: '', error: `Network error: ${e.message}` };
    }
    const text = await resp.text();
    const respHeaders = {};
    resp.headers.forEach((v, k) => { respHeaders[k] = v; });

    const output = JSON.stringify({
      status: resp.status,
      statusText: resp.statusText,
      headers: respHeaders,
      body: text.length > 50000 ? text.slice(0, 50000) + '\n... (truncated)' : text,
    });

    return { success: resp.ok, output, error: resp.ok ? undefined : `HTTP ${resp.status}` };
  }
}

// ── browser_dom_query ─────────────────────────────────────────────

export class DomQueryTool extends BrowserTool {
  get name() { return 'browser_dom_query'; }
  get description() {
    return 'Query DOM elements on the current page using CSS selectors. Returns text content, attributes, and structure.';
  }
  get parameters() {
    return {
      type: 'object',
      properties: {
        selector: { type: 'string', description: 'CSS selector to query' },
        limit: { type: 'number', description: 'Max elements to return (default: 10)' },
        include_html: { type: 'boolean', description: 'Include outerHTML (default: false)' },
      },
      required: ['selector'],
    };
  }
  get permission() { return 'browser'; }

  async execute({ selector, limit = 10, include_html = false }) {
    const elements = document.querySelectorAll(selector);
    const results = [];

    for (let i = 0; i < Math.min(elements.length, limit); i++) {
      const el = elements[i];
      const entry = {
        tag: el.tagName.toLowerCase(),
        id: el.id || undefined,
        classes: el.className || undefined,
        text: el.textContent?.trim().slice(0, 500) || '',
        attributes: {},
      };
      for (const attr of el.attributes) {
        entry.attributes[attr.name] = attr.value;
      }
      if (include_html) {
        entry.html = el.outerHTML.slice(0, 2000);
      }
      results.push(entry);
    }

    return {
      success: true,
      output: JSON.stringify({ count: elements.length, results }),
    };
  }
}

// ── browser_dom_modify ────────────────────────────────────────────

export class DomModifyTool extends BrowserTool {
  get name() { return 'browser_dom_modify'; }
  get description() {
    return 'Modify DOM elements. Set text content, attributes, styles, or innerHTML.';
  }
  get parameters() {
    return {
      type: 'object',
      properties: {
        selector: { type: 'string', description: 'CSS selector for target element(s)' },
        action: { type: 'string', enum: ['setText', 'setHTML', 'setAttribute', 'setStyle', 'addClass', 'removeClass', 'remove', 'insertHTML'], description: 'Modification action' },
        value: { type: 'string', description: 'Value to set' },
        attribute: { type: 'string', description: 'Attribute name (for setAttribute)' },
      },
      required: ['selector', 'action'],
    };
  }
  get permission() { return 'browser'; }

  async execute({ selector, action, value = '', attribute }) {
    const elements = document.querySelectorAll(selector);
    if (elements.length === 0) {
      return { success: false, output: '', error: `No elements match: ${selector}` };
    }

    let modified = 0;
    for (const el of elements) {
      switch (action) {
        case 'setText': el.textContent = value; break;
        case 'setHTML':
          // Use Sanitizer API if available, otherwise strip dangerous elements + on* attributes
          if (el.setHTML) { el.setHTML(value); }
          else {
            const t = document.createElement('template');
            t.innerHTML = value;
            t.content.querySelectorAll('script,iframe,object,embed,base,meta,link,form,svg').forEach(s => s.remove());
            // Strip on* event handlers and javascript:/data:text/html URLs from all surviving elements
            for (const node of t.content.querySelectorAll('*')) {
              for (const attr of [...node.attributes]) {
                if (/^on/i.test(attr.name)) node.removeAttribute(attr.name);
                if (/^(href|src|action|formaction)$/i.test(attr.name) && /^\s*(javascript:|data:text\/html)/i.test(attr.value)) node.removeAttribute(attr.name);
              }
            }
            el.innerHTML = t.innerHTML;
          }
          break;
        case 'setAttribute':
          if (!attribute) return { success: false, output: '', error: 'setAttribute requires "attribute" parameter' };
          // Block event handler attributes (XSS vector)
          if (/^on/i.test(attribute)) return { success: false, output: '', error: `Blocked: setting event handler attribute "${attribute}" is not allowed` };
          // Block javascript: and data:text/html in href/src/action attributes
          if (/^(href|src|action|formaction)$/i.test(attribute) && /^\s*(javascript:|data:text\/html)/i.test(value)) {
            return { success: false, output: '', error: `Blocked: javascript: and data:text/html URLs in "${attribute}" are not allowed` };
          }
          el.setAttribute(attribute, value); break;
        case 'setStyle': el.style.cssText += value; break;
        case 'addClass': el.classList.add(value); break;
        case 'removeClass': el.classList.remove(value); break;
        case 'remove': el.remove(); break;
        case 'insertHTML':
          if (el.setHTML) { const wrapper = document.createElement('div'); wrapper.setHTML(value); el.append(...wrapper.childNodes); }
          else {
            const t = document.createElement('template');
            t.innerHTML = value;
            t.content.querySelectorAll('script,iframe,object,embed,base,meta,link,form,svg').forEach(s => s.remove());
            for (const node of t.content.querySelectorAll('*')) {
              for (const attr of [...node.attributes]) {
                if (/^on/i.test(attr.name)) node.removeAttribute(attr.name);
                if (/^(href|src|action|formaction)$/i.test(attr.name) && /^\s*(javascript:|data:text\/html)/i.test(attr.value)) node.removeAttribute(attr.name);
              }
            }
            el.insertAdjacentHTML('beforeend', t.innerHTML);
          }
          break;
        default:
          return { success: false, output: '', error: `Unknown action: "${action}". Valid actions: setText, setHTML, setAttribute, setStyle, addClass, removeClass, remove, insertHTML` };
      }
      modified++;
    }

    return { success: true, output: `Modified ${modified} element(s)` };
  }
}

// ── browser_fs_read / browser_fs_write (OPFS) ────────────────────

export class FsReadTool extends BrowserTool {
  /** @type {WorkspaceFs} */
  #ws;
  constructor(ws) { super(); this.#ws = ws; }

  get name() { return 'browser_fs_read'; }
  get description() {
    return 'Read a file from the Origin Private File System (OPFS). Returns file contents as text.';
  }
  get parameters() {
    return {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'File path within OPFS (e.g., "/notes/todo.md")' },
      },
      required: ['path'],
    };
  }
  get permission() { return 'read'; }

  async execute({ path }) {
    const resolved = this.#ws.resolve(path);
    const root = await navigator.storage.getDirectory();
    const parts = resolved.split('/').filter(Boolean);
    let dir = root;
    for (const part of parts.slice(0, -1)) {
      dir = await dir.getDirectoryHandle(part);
    }
    const fileHandle = await dir.getFileHandle(parts[parts.length - 1]);
    const file = await fileHandle.getFile();
    // Limit read size to prevent memory issues (50MB)
    const MAX_READ = 50 * 1024 * 1024;
    if (file.size > MAX_READ) {
      return { success: false, output: '', error: `File too large to read (${(file.size / (1024 * 1024)).toFixed(1)}MB exceeds 50MB limit)` };
    }
    const text = await file.text();
    return { success: true, output: text };
  }
}

export class FsWriteTool extends BrowserTool {
  /** @type {WorkspaceFs} */
  #ws;
  /** @type {number} Max file size in bytes (default: 10MB) */
  #maxFileSize = 10 * 1024 * 1024;

  constructor(ws) { super(); this.#ws = ws; }

  get name() { return 'browser_fs_write'; }
  get description() {
    return 'Write a file to the Origin Private File System (OPFS). Creates parent directories as needed.';
  }
  get parameters() {
    return {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'File path within OPFS' },
        content: { type: 'string', description: 'File content to write' },
      },
      required: ['path', 'content'],
    };
  }
  get permission() { return 'write'; }

  /**
   * Set the maximum file size in bytes.
   * @param {number} bytes
   */
  setMaxFileSize(bytes) { this.#maxFileSize = bytes; }

  async execute({ path, content }) {
    // File size check (use actual byte size, not JS string length)
    const byteSize = new TextEncoder().encode(content).byteLength;
    if (byteSize > this.#maxFileSize) {
      const maxMB = (this.#maxFileSize / (1024 * 1024)).toFixed(1);
      return { success: false, output: '', error: `File exceeds ${maxMB}MB limit (${byteSize} bytes)` };
    }

    // Storage quota check before write
    const quota = await checkQuota();
    if (quota.critical) {
      return { success: false, output: '', error: `Storage quota critically low (${quota.percent.toFixed(1)}% used). Free space before writing.` };
    }

    const resolved = this.#ws.resolve(path);
    const root = await navigator.storage.getDirectory();
    const parts = resolved.split('/');
    let dir = root;
    for (const part of parts.slice(0, -1)) {
      dir = await dir.getDirectoryHandle(part, { create: true });
    }
    const fileHandle = await dir.getFileHandle(parts[parts.length - 1], { create: true });
    const writable = await fileHandle.createWritable();
    try {
      await writable.write(content);
      await writable.close();
    } catch (writeErr) {
      try { await writable.abort(); } catch { /* abort() may fail if stream already closed — benign */ }
      throw writeErr;
    }
    return { success: true, output: `Wrote ${content.length} bytes to ${path}` };
  }
}

export class FsListTool extends BrowserTool {
  /** @type {WorkspaceFs} */
  #ws;
  constructor(ws) { super(); this.#ws = ws; }

  get name() { return 'browser_fs_list'; }
  get description() {
    return 'List files and directories in the Origin Private File System (OPFS).';
  }
  get parameters() {
    return {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Directory path within OPFS (default: "/")' },
      },
    };
  }
  get permission() { return 'read'; }

  async execute({ path = '/' }) {
    const resolved = this.#ws.resolve(path);
    const root = await navigator.storage.getDirectory();
    const parts = resolved.split('/').filter(Boolean);
    let dir = root;
    for (const part of parts) {
      dir = await dir.getDirectoryHandle(part);
    }
    const isRoot = (path === '/' || path === '');
    const entries = [];
    for await (const [name, handle] of dir) {
      // Hide .checkpoints at workspace root
      if (isRoot && name === '.checkpoints') continue;
      entries.push({
        name,
        kind: handle.kind,
      });
    }
    return { success: true, output: JSON.stringify(entries) };
  }
}

export class FsDeleteTool extends BrowserTool {
  /** @type {WorkspaceFs} */
  #ws;
  constructor(ws) { super(); this.#ws = ws; }

  get name() { return 'browser_fs_delete'; }
  get description() {
    return 'Delete a file or directory from OPFS.';
  }
  get parameters() {
    return {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Path to delete' },
        recursive: { type: 'boolean', description: 'Delete directories recursively (default: false)' },
      },
      required: ['path'],
    };
  }
  get permission() { return 'write'; }

  async execute({ path, recursive = false }) {
    const resolved = this.#ws.resolve(path);
    const parts = resolved.split('/').filter(Boolean);
    // Prevent deleting workspace root or OPFS root
    if (parts.length === 0) {
      return { success: false, output: '', error: 'Cannot delete workspace root directory' };
    }
    // Prevent deleting the workspace home itself (e.g., "clawser_workspaces/default")
    if (parts.length <= 2 && parts[0] === 'clawser_workspaces') {
      return { success: false, output: '', error: 'Cannot delete workspace home directory' };
    }
    const root = await navigator.storage.getDirectory();
    let dir = root;
    for (const part of parts.slice(0, -1)) {
      dir = await dir.getDirectoryHandle(part);
    }
    await dir.removeEntry(parts[parts.length - 1], { recursive });
    return { success: true, output: `Deleted ${path}` };
  }
}

// ── browser_storage_get / browser_storage_set ─────────────────────

export class StorageGetTool extends BrowserTool {
  get name() { return 'browser_storage_get'; }
  get description() {
    return 'Read a value from localStorage by key. Returns the stored string value.';
  }
  get parameters() {
    return {
      type: 'object',
      properties: {
        key: { type: 'string', description: 'Storage key' },
      },
      required: ['key'],
    };
  }
  get permission() { return 'read'; }

  async execute({ key }) {
    // Protect internal Clawser keys (may contain API keys/config) from being read by the agent
    if (key.startsWith('clawser_')) {
      return { success: false, output: '', error: `Cannot read reserved key: "${key}" (clawser_ prefix is reserved)` };
    }
    const value = localStorage.getItem(key);
    if (value === null) {
      return { success: false, output: '', error: `Key not found: ${key}` };
    }
    return { success: true, output: value };
  }
}

export class StorageSetTool extends BrowserTool {
  get name() { return 'browser_storage_set'; }
  get description() {
    return 'Write a value to localStorage. Stores key-value string pairs.';
  }
  get parameters() {
    return {
      type: 'object',
      properties: {
        key: { type: 'string', description: 'Storage key' },
        value: { type: 'string', description: 'Value to store' },
      },
      required: ['key', 'value'],
    };
  }
  get permission() { return 'write'; }

  async execute({ key, value }) {
    // Protect internal Clawser keys from being overwritten by the agent
    if (key.startsWith('clawser_')) {
      return { success: false, output: '', error: `Cannot write to reserved key: "${key}" (clawser_ prefix is reserved)` };
    }
    localStorage.setItem(key, value);
    return { success: true, output: `Stored ${value.length} chars at "${key}"` };
  }
}

export class StorageListTool extends BrowserTool {
  get name() { return 'browser_storage_list'; }
  get description() {
    return 'List all keys in localStorage with their value lengths.';
  }
  get parameters() { return { type: 'object', properties: {} }; }
  get permission() { return 'read'; }

  async execute() {
    const keys = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      // Hide internal Clawser keys (may contain API keys/config)
      if (key.startsWith('clawser_')) continue;
      keys.push({ key, length: localStorage.getItem(key)?.length || 0 });
    }
    return { success: true, output: JSON.stringify(keys) };
  }
}

// ── browser_clipboard_read / browser_clipboard_write ──────────────

export class ClipboardReadTool extends BrowserTool {
  get name() { return 'browser_clipboard_read'; }
  get description() {
    return 'Read text content from the system clipboard (requires user permission).';
  }
  get parameters() { return { type: 'object', properties: {} }; }
  get permission() { return 'browser'; }

  async execute() {
    const text = await navigator.clipboard.readText();
    return { success: true, output: text };
  }
}

export class ClipboardWriteTool extends BrowserTool {
  get name() { return 'browser_clipboard_write'; }
  get description() {
    return 'Write text content to the system clipboard.';
  }
  get parameters() {
    return {
      type: 'object',
      properties: {
        text: { type: 'string', description: 'Text to copy to clipboard' },
      },
      required: ['text'],
    };
  }
  get permission() { return 'browser'; }

  async execute({ text }) {
    await navigator.clipboard.writeText(text);
    return { success: true, output: `Copied ${text.length} chars to clipboard` };
  }
}

// ── browser_navigate ──────────────────────────────────────────────

export class NavigateTool extends BrowserTool {
  get name() { return 'browser_navigate'; }
  get description() {
    return 'Open a URL in a new browser tab or the current page.';
  }
  get parameters() {
    return {
      type: 'object',
      properties: {
        url: { type: 'string', description: 'URL to navigate to' },
        new_tab: { type: 'boolean', description: 'Open in new tab (default: true)' },
      },
      required: ['url'],
    };
  }
  get permission() { return 'browser'; }

  async execute({ url, new_tab = true }) {
    // Validate URL scheme to prevent javascript: and data: injection
    let safeUrl;
    try {
      const parsed = new URL(url, window.location.href);
      if (!['http:', 'https:'].includes(parsed.protocol)) {
        return { success: false, output: '', error: `Blocked navigation to ${parsed.protocol} URL — only http/https allowed` };
      }
      safeUrl = parsed.href; // Use normalized URL to prevent encoding tricks
    } catch {
      return { success: false, output: '', error: `Invalid URL: ${url}` };
    }
    if (new_tab) {
      window.open(safeUrl, '_blank');
    } else {
      window.location.href = safeUrl;
    }
    return { success: true, output: `Navigated to ${safeUrl}` };
  }
}

// ── browser_notify ────────────────────────────────────────────────

export class NotifyTool extends BrowserTool {
  get name() { return 'browser_notify'; }
  get description() {
    return 'Show a browser notification. Requests permission if needed.';
  }
  get parameters() {
    return {
      type: 'object',
      properties: {
        title: { type: 'string', description: 'Notification title' },
        body: { type: 'string', description: 'Notification body text' },
        icon: { type: 'string', description: 'Icon URL (optional)' },
      },
      required: ['title'],
    };
  }
  get permission() { return 'browser'; }

  async execute({ title, body = '', icon }) {
    if (typeof Notification === 'undefined') {
      return { success: false, output: '', error: 'Notifications not supported' };
    }
    if (Notification.permission === 'denied') {
      return { success: false, output: '', error: 'Notification permission denied' };
    }
    if (Notification.permission !== 'granted') {
      await Notification.requestPermission();
    }
    if (Notification.permission === 'granted') {
      new Notification(title, { body, icon });
      return { success: true, output: `Notification shown: ${title}` };
    }
    return { success: false, output: '', error: 'Notification permission not granted' };
  }
}

// ── browser_eval_js ───────────────────────────────────────────────

export class EvalJsTool extends BrowserTool {
  get name() { return 'browser_eval_js'; }
  get description() {
    return 'Evaluate JavaScript code in the page global scope. WARNING: Runs with full page access — use for trusted code only. Returns the result as a string.';
  }
  get parameters() {
    return {
      type: 'object',
      properties: {
        code: { type: 'string', description: 'JavaScript code to evaluate' },
      },
      required: ['code'],
    };
  }
  get permission() { return 'approve'; }

  async execute({ code }) {
    try {
      // Use indirect eval for global scope
      const result = (0, eval)(code);
      let output;
      try {
        output = result === undefined ? 'undefined' : JSON.stringify(result, null, 2) ?? String(result);
      } catch {
        output = String(result);
      }
      return { success: true, output };
    } catch (e) {
      return { success: false, output: '', error: `Eval error: ${e.message}` };
    }
  }
}

// ── browser_screen_info ───────────────────────────────────────────

export class ScreenInfoTool extends BrowserTool {
  get name() { return 'browser_screen_info'; }
  get description() {
    return 'Get information about the current page: URL, title, viewport size, scroll position, and visible text summary.';
  }
  get parameters() { return { type: 'object', properties: {} }; }
  get permission() { return 'read'; }

  async execute() {
    const info = {
      url: window.location.href,
      title: document.title,
      viewport: {
        width: window.innerWidth,
        height: window.innerHeight,
      },
      scroll: {
        x: window.scrollX,
        y: window.scrollY,
      },
      documentHeight: document.documentElement.scrollHeight,
      elementCount: document.querySelectorAll('*').length,
      forms: document.forms.length,
      links: document.links.length,
      images: document.images.length,
    };
    return { success: true, output: JSON.stringify(info) };
  }
}

// ── Agent tools ───────────────────────────────────────────────

export class AgentTool extends BrowserTool {
  constructor(agent) { super(); this._agent = agent; }
  get permission() { return 'internal'; }
}

export class AgentMemoryStoreTool extends AgentTool {
  get name() { return 'agent_memory_store'; }
  get description() {
    return 'Store a memory for later recall. Use for facts, preferences, or learned information worth persisting.';
  }
  get parameters() {
    return {
      type: 'object',
      properties: {
        key: { type: 'string', description: 'Short label/topic for this memory' },
        content: { type: 'string', description: 'The information to remember' },
        category: { type: 'string', enum: ['core', 'learned', 'user', 'context'], description: 'Category (default: learned)' },
      },
      required: ['key', 'content'],
    };
  }
  async execute(params) {
    const id = this._agent.memoryStore({ key: params.key, content: params.content, category: params.category || 'learned' });
    this._agent.persistMemories();
    return { success: true, output: `Stored memory ${id}` };
  }
}

export class AgentMemoryRecallTool extends AgentTool {
  get name() { return 'agent_memory_recall'; }
  get description() {
    return 'Search stored memories by keyword query. Returns matching memories ranked by relevance.';
  }
  get parameters() {
    return {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Search query (keywords or phrase)' },
      },
      required: ['query'],
    };
  }
  async execute(params) {
    const results = this._agent.memoryRecall(params.query);
    return { success: true, output: JSON.stringify(results.slice(0, 10)) };
  }
}

export class AgentMemoryForgetTool extends AgentTool {
  get name() { return 'agent_memory_forget'; }
  get description() {
    return 'Delete a stored memory by its ID.';
  }
  get parameters() {
    return {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'Memory ID to delete (e.g. "mem_1")' },
      },
      required: ['id'],
    };
  }
  async execute(params) {
    const deleted = this._agent.memoryForget(params.id);
    if (deleted) {
      this._agent.persistMemories();
      return { success: true, output: `Deleted memory ${params.id}` };
    }
    return { success: false, output: '', error: `Memory not found: ${params.id}` };
  }
}

export class AgentGoalAddTool extends AgentTool {
  get name() { return 'agent_goal_add'; }
  get description() {
    return 'Add a new goal to track. Goals appear in the sidebar and are included in your context.';
  }
  get parameters() {
    return {
      type: 'object',
      properties: {
        description: { type: 'string', description: 'What the goal is' },
      },
      required: ['description'],
    };
  }
  async execute(params) {
    const id = this._agent.addGoal(params.description);
    return { success: true, output: `Created goal ${id}: ${params.description}` };
  }
}

export class AgentGoalUpdateTool extends AgentTool {
  get name() { return 'agent_goal_update'; }
  get description() {
    return 'Update the status of an existing goal. Use to mark goals as completed or failed.';
  }
  get parameters() {
    return {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'Goal ID (e.g. "goal_1")' },
        status: { type: 'string', enum: ['active', 'completed', 'failed'], description: 'New status' },
      },
      required: ['id', 'status'],
    };
  }
  async execute(params) {
    const ok = this._agent.updateGoal(params.id, params.status);
    if (ok) return { success: true, output: `Goal ${params.id} → ${params.status}` };
    return { success: false, output: '', error: `Goal not found: ${params.id}` };
  }
}

// ── Scheduler tools ─────────────────────────────────────────────

export class AgentScheduleAddTool extends AgentTool {
  get name() { return 'agent_schedule_add'; }
  get description() {
    return 'Add a scheduled job. Types: "once" (fire at a specific time or after a delay), "interval" (fire repeatedly), "cron" (fire on a cron schedule like "0 9 * * 1-5").';
  }
  get parameters() {
    return {
      type: 'object',
      properties: {
        schedule_type: { type: 'string', enum: ['once', 'interval', 'cron'], description: 'Type of schedule' },
        prompt: { type: 'string', description: 'The message to inject when the job fires' },
        delay_ms: { type: 'number', description: 'Delay in milliseconds for "once" type (default: 60000)' },
        interval_ms: { type: 'number', description: 'Interval in milliseconds for "interval" type (default: 60000)' },
        cron_expr: { type: 'string', description: '5-field cron expression for "cron" type (e.g., "0 9 * * 1-5")' },
      },
      required: ['schedule_type', 'prompt'],
    };
  }
  async execute(params) {
    try {
      const id = this._agent.addSchedulerJob(params);
      return { success: true, output: `Scheduled job ${id} (${params.schedule_type})` };
    } catch (e) {
      return { success: false, output: '', error: e.message };
    }
  }
}

export class AgentScheduleListTool extends AgentTool {
  get name() { return 'agent_schedule_list'; }
  get description() {
    return 'List all scheduled jobs with their status.';
  }
  get parameters() { return { type: 'object', properties: {} }; }
  async execute() {
    const jobs = this._agent.listSchedulerJobs();
    return { success: true, output: JSON.stringify(jobs) };
  }
}

export class AgentScheduleRemoveTool extends AgentTool {
  get name() { return 'agent_schedule_remove'; }
  get description() {
    return 'Remove a scheduled job by its ID.';
  }
  get parameters() {
    return {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'Job ID to remove (e.g., "job_1")' },
      },
      required: ['id'],
    };
  }
  async execute(params) {
    const ok = this._agent.removeSchedulerJob(params.id);
    if (ok) return { success: true, output: `Removed job ${params.id}` };
    return { success: false, output: '', error: `Job not found: ${params.id}` };
  }
}

// ── Web search tool ───────────────────────────────────────────────

export class WebSearchTool extends BrowserTool {
  get name() { return 'browser_web_search'; }
  get description() {
    return 'Search the web using DuckDuckGo. Returns search result titles, URLs, and snippets.';
  }
  get parameters() {
    return {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Search query' },
        limit: { type: 'number', description: 'Max results to return (default: 5)' },
      },
      required: ['query'],
    };
  }
  get permission() { return 'network'; }

  async execute({ query, limit = 5 }) {
    // Use DuckDuckGo HTML lite — works without API key
    const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
    const resp = await fetch(url);
    if (!resp.ok) return { success: false, output: '', error: `Search failed: HTTP ${resp.status}` };

    const html = await resp.text();
    const results = [];
    // Parse results from DDG HTML
    const resultRegex = /<a[^>]*class="result__a"[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>[\s\S]*?<a[^>]*class="result__snippet"[^>]*>([\s\S]*?)<\/a>/g;
    let match;
    while ((match = resultRegex.exec(html)) !== null && results.length < limit) {
      const href = match[1];
      const title = match[2].replace(/<[^>]*>/g, '').trim();
      const snippet = match[3].replace(/<[^>]*>/g, '').trim();
      // DDG wraps real URLs in a redirect; extract from uddg param
      const uddgMatch = href.match(/uddg=([^&]*)/);
      const realUrl = uddgMatch ? decodeURIComponent(uddgMatch[1]) : href;
      results.push({ title, url: realUrl, snippet });
    }

    return { success: true, output: JSON.stringify(results) };
  }
}

// ── Screenshot tool ───────────────────────────────────────────────

let _html2canvas = null;

export class ScreenshotTool extends BrowserTool {
  get name() { return 'browser_screenshot'; }
  get description() {
    return 'Capture a screenshot of the current page or a specific element as a data URL (PNG). Loads html2canvas from CDN on first use.';
  }
  get parameters() {
    return {
      type: 'object',
      properties: {
        selector: { type: 'string', description: 'CSS selector of element to capture (default: document body)' },
      },
    };
  }
  get permission() { return 'browser'; }

  async execute({ selector }) {
    const el = selector ? document.querySelector(selector) : document.body;
    if (!el) return { success: false, output: '', error: `Element not found: ${selector}` };

    // Lazy-load html2canvas from CDN
    if (!_html2canvas) {
      try {
        const mod = await import('https://esm.sh/html2canvas@1.4.1');
        _html2canvas = mod.default || mod;
      } catch (e) {
        // Fallback: return page metadata instead of a real screenshot
        const rect = el.getBoundingClientRect();
        return {
          success: true,
          output: JSON.stringify({
            note: 'html2canvas unavailable — returning page metadata instead',
            url: window.location.href,
            title: document.title,
            selector: selector || 'body',
            elementSize: { width: Math.round(rect.width), height: Math.round(rect.height) },
            elementCount: el.querySelectorAll('*').length,
            visibleText: el.textContent?.trim().slice(0, 1000) || '',
          }),
        };
      }
    }

    try {
      const canvas = await _html2canvas(el, {
        useCORS: true,
        scale: 1,
        width: Math.min(el.scrollWidth || window.innerWidth, 1920),
        height: Math.min(el.scrollHeight || window.innerHeight, 1080),
      });
      const dataUrl = canvas.toDataURL('image/png');

      return {
        success: true,
        output: JSON.stringify({
          width: canvas.width,
          height: canvas.height,
          dataUrl,
          note: 'Image available at dataUrl — use in an <img> tag',
        }),
      };
    } catch (e) {
      return { success: false, output: '', error: `Screenshot failed: ${e.message}` };
    }
  }
}

/**
 * Register all agent tools (memory + goals + scheduler) with an existing registry.
 * Called after agent creation so tools have a reference to the agent.
 * @param {BrowserToolRegistry} registry
 * @param {import('./clawser-agent.js').ClawserAgent} agent
 */
export function registerAgentTools(registry, agent) {
  registry.register(new AgentMemoryStoreTool(agent));
  registry.register(new AgentMemoryRecallTool(agent));
  registry.register(new AgentMemoryForgetTool(agent));
  registry.register(new AgentGoalAddTool(agent));
  registry.register(new AgentGoalUpdateTool(agent));
  registry.register(new AgentScheduleAddTool(agent));
  registry.register(new AgentScheduleListTool(agent));
  registry.register(new AgentScheduleRemoveTool(agent));
}

// ── createDefaultRegistry ─────────────────────────────────────────

/**
 * Create a BrowserToolRegistry with all default browser tools registered.
 * @param {WorkspaceFs} workspaceFs - Workspace filesystem scope for FS tools
 * @returns {BrowserToolRegistry}
 */
// ── AskUserQuestion Tool ─────────────────────────────────────────

/**
 * Tool that allows the agent to ask the user questions with structured options.
 * The onAskUser callback handles the UI interaction and returns answers.
 */
export class AskUserQuestionTool extends BrowserTool {
  #onAskUser;

  /**
   * @param {Function} onAskUser - async (questions) => {answers}
   *   questions: Array<{question, header, options: [{label, description}], multiSelect?}>
   *   answers: Object<string, string> — keyed by question text
   */
  constructor(onAskUser) {
    super();
    this.#onAskUser = onAskUser;
  }

  get name() { return 'ask_user_question'; }
  get description() {
    return 'Ask the user one or more questions with predefined options. Use this when you need user input to proceed. Each question can have 2-4 options. Users can also provide free-text via "Other".';
  }
  get parameters() {
    return {
      type: 'object',
      properties: {
        questions: {
          type: 'array',
          description: 'Array of questions (1-4)',
          items: {
            type: 'object',
            properties: {
              question: { type: 'string', description: 'The question to ask' },
              header: { type: 'string', description: 'Short label (max 12 chars)' },
              options: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    label: { type: 'string', description: 'Option display text (1-5 words)' },
                    description: { type: 'string', description: 'What this option means' },
                  },
                  required: ['label', 'description'],
                },
                minItems: 2,
                maxItems: 4,
              },
              multiSelect: { type: 'boolean', description: 'Allow multiple selections', default: false },
            },
            required: ['question', 'header', 'options'],
          },
          minItems: 1,
          maxItems: 4,
        },
      },
      required: ['questions'],
    };
  }
  get permission() { return 'auto'; }

  async execute({ questions }) {
    if (!questions || !Array.isArray(questions) || questions.length === 0) {
      return { success: false, output: '', error: 'questions must be a non-empty array' };
    }
    if (questions.length > 4) {
      return { success: false, output: '', error: 'Maximum 4 questions allowed' };
    }
    for (const q of questions) {
      if (!q.question || !q.header || !Array.isArray(q.options)) {
        return { success: false, output: '', error: 'Each question needs question, header, and options fields' };
      }
      if (q.options.length < 2 || q.options.length > 4) {
        return { success: false, output: '', error: 'Each question must have 2-4 options' };
      }
      for (const opt of q.options) {
        if (!opt.label || !opt.description) {
          return { success: false, output: '', error: 'Each option needs label and description' };
        }
      }
    }

    try {
      const answers = await this.#onAskUser(questions);
      const lines = [];
      for (const q of questions) {
        const answer = answers?.[q.question] ?? '(no answer)';
        lines.push(`[${q.header}] ${q.question}\n  → ${answer}`);
      }
      return { success: true, output: lines.join('\n\n') };
    } catch (e) {
      return { success: false, output: '', error: `Ask user failed: ${e.message}` };
    }
  }
}

// ── Agent tools (Block 37) ─────────────────────────────────────

/**
 * SwitchAgentTool — switch to a different agent configuration mid-conversation.
 * Lists available agents (no args) or switches to one by name or ID.
 */
export class SwitchAgentTool extends BrowserTool {
  #storage; #engine;
  constructor(storage, engine) { super(); this.#storage = storage; this.#engine = engine; }
  get name() { return 'switch_agent'; }
  get description() { return 'Switch to a different agent configuration. Omit agent param to list available agents.'; }
  get parameters() {
    return {
      type: 'object',
      properties: {
        agent: { type: 'string', description: 'Agent name or ID to switch to. Omit to list available agents.' },
        reason: { type: 'string', description: 'Brief reason for switching.' },
      },
    };
  }
  get permission() { return 'approve'; }

  async execute(params) {
    try {
      const all = await this.#storage.listAll();
      if (!params.agent) {
        const list = all.map(a => ({ name: a.name, id: a.id, provider: `${a.provider}:${a.model || 'default'}`, description: a.description }));
        return { success: true, output: JSON.stringify(list, null, 2) };
      }
      const agent = all.find(a =>
        a.name.toLowerCase() === params.agent.toLowerCase() || a.id === params.agent
      );
      if (!agent) return { success: false, output: '', error: `Agent "${params.agent}" not found.` };
      this.#engine.applyAgent(agent);
      this.#storage.setActive(agent.id);
      return { success: true, output: `Switched to agent "${agent.name}" (${agent.provider}:${agent.model})${params.reason ? `. Reason: ${params.reason}` : ''}` };
    } catch (e) {
      return { success: false, output: '', error: `Switch failed: ${e.message}` };
    }
  }
}

/**
 * ConsultAgentTool — send a message to another agent and get their response.
 * Used for second opinions, subtask delegation, or model escalation.
 */
export class ConsultAgentTool extends BrowserTool {
  #storage; #opts;
  constructor(storage, opts) { super(); this.#storage = storage; this.#opts = opts; }
  get name() { return 'consult_agent'; }
  get description() { return 'Send a message to another agent and get their response. Use for second opinions, subtask delegation, or escalation.'; }
  get parameters() {
    return {
      type: 'object',
      properties: {
        agent: { type: 'string', description: 'Name of the agent to consult.' },
        message: { type: 'string', description: 'The message/question to send to the agent.' },
      },
      required: ['agent', 'message'],
    };
  }
  get permission() { return 'auto'; }

  async execute(params) {
    try {
      const { executeAgentRef } = await import('./clawser-agent-ref.js');
      const all = await this.#storage.listAll();
      const agentDef = all.find(a =>
        a.name.toLowerCase().replace(/\s+/g, '-') === params.agent.toLowerCase().replace(/\s+/g, '-') ||
        a.name.toLowerCase() === params.agent.toLowerCase()
      );
      if (!agentDef) {
        const names = all.map(a => a.name).join(', ');
        return { success: false, output: '', error: `Agent "${params.agent}" not found. Available: ${names}` };
      }
      const { response } = await executeAgentRef(agentDef, params.message, this.#opts);
      return { success: true, output: `[Response from ${agentDef.name}]:\n${response}` };
    } catch (e) {
      return { success: false, output: '', error: `Agent error: ${e.message}` };
    }
  }
}

// ── Storage Quota Checking (Gap 7.6 + 12.1) ─────────────────────

/**
 * Check current storage quota using the StorageManager API.
 * Returns usage/quota info with warning and critical thresholds.
 * @returns {Promise<{usage: number, quota: number, percent: number, warning: boolean, critical: boolean}>}
 */
export async function checkQuota() {
  if (!navigator.storage?.estimate) {
    return { usage: 0, quota: 0, percent: 0, warning: false, critical: false };
  }
  try {
    const { usage = 0, quota = 0 } = await navigator.storage.estimate();
    const percent = quota > 0 ? (usage / quota) * 100 : 0;
    return {
      usage,
      quota,
      percent,
      warning: percent >= 80,
      critical: percent >= 95,
    };
  } catch (e) {
    console.warn('[clawser] storage estimate failed', e);
    return { usage: 0, quota: 0, percent: 0, warning: false, critical: false };
  }
}

export function createDefaultRegistry(workspaceFs) {
  const registry = new BrowserToolRegistry();

  registry.register(new FetchTool());
  registry.register(new DomQueryTool());
  registry.register(new DomModifyTool());
  registry.register(new FsReadTool(workspaceFs));
  registry.register(new FsWriteTool(workspaceFs));
  registry.register(new FsListTool(workspaceFs));
  registry.register(new FsDeleteTool(workspaceFs));
  registry.register(new StorageGetTool());
  registry.register(new StorageSetTool());
  registry.register(new StorageListTool());
  registry.register(new ClipboardReadTool());
  registry.register(new ClipboardWriteTool());
  registry.register(new NavigateTool());
  registry.register(new NotifyTool());
  registry.register(new EvalJsTool());
  registry.register(new ScreenInfoTool());
  registry.register(new WebSearchTool());
  registry.register(new ScreenshotTool());

  return registry;
}
