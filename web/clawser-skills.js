/**
 * Clawser Skills System
 *
 * Implements the Agent Skills open standard (agentskills.io) for portable,
 * reusable agent capabilities. Skills are stored in OPFS as directories
 * containing a SKILL.md (YAML frontmatter + markdown body) and optional
 * supporting files (scripts/, references/, assets/).
 *
 * Architecture:
 *   SkillParser    — static utility for frontmatter parsing, validation, argument substitution
 *   SkillStorage   — OPFS operations for skill directories
 *   SkillRegistry  — discovery, activation state, prompt building
 *   ActivateSkillTool / DeactivateSkillTool — LLM-callable tools
 */

import { lsKey } from './clawser-state.js';
import { BrowserTool } from './clawser-tools.js';

// ── SkillParser ──────────────────────────────────────────────────

export class SkillParser {
  /**
   * Parse YAML frontmatter from a SKILL.md file.
   * Extracts the --- delimited block and returns metadata + body.
   * @param {string} text - Full SKILL.md content
   * @returns {{ metadata: object, body: string }}
   */
  static parseFrontmatter(text) {
    const match = text.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
    if (!match) {
      return { metadata: {}, body: text.trim() };
    }

    const yamlBlock = match[1];
    const body = match[2].trim();
    const metadata = SkillParser.#parseYaml(yamlBlock);

    return { metadata, body };
  }

  /**
   * Minimal YAML parser for flat key-value pairs and one level of nesting.
   * Handles strings, numbers, booleans, arrays (- item), and nested maps.
   * @param {string} yaml
   * @returns {object}
   */
  static #parseYaml(yaml) {
    const result = {};
    const lines = yaml.split('\n');
    let currentKey = null;
    let currentIndent = 0;
    let nestedObj = null;
    let arrayKey = null;
    let arrayItems = null;

    for (const line of lines) {
      // Skip blank lines and comments
      if (!line.trim() || line.trim().startsWith('#')) {
        continue;
      }

      const indent = line.search(/\S/);

      // Array item (- value)
      if (line.trim().startsWith('- ')) {
        const val = line.trim().slice(2).trim();
        if (arrayKey) {
          arrayItems.push(SkillParser.#coerceValue(val));
        } else if (currentKey) {
          // First array item under a key that was initially assumed to be nested —
          // switch to array mode and discard the empty nestedObj.
          if (nestedObj && Object.keys(nestedObj).length === 0) {
            nestedObj = null;
            arrayKey = currentKey;
            arrayItems = [SkillParser.#coerceValue(val)];
          } else {
            if (!Array.isArray(result[currentKey])) {
              result[currentKey] = [];
            }
            result[currentKey].push(SkillParser.#coerceValue(val));
          }
        }
        continue;
      }

      // Flush pending array
      if (arrayKey && arrayItems) {
        result[arrayKey] = arrayItems;
        arrayKey = null;
        arrayItems = null;
      }

      // Flush pending nested object
      if (nestedObj && indent <= currentIndent) {
        result[currentKey] = nestedObj;
        nestedObj = null;
      }

      // Key-value pair
      const kvMatch = line.match(/^(\s*)([a-zA-Z_][\w-]*):\s*(.*)/);
      if (!kvMatch) continue;

      const [, spaces, key, rawVal] = kvMatch;
      const val = rawVal.trim();

      if (nestedObj && spaces.length > currentIndent) {
        // Nested key-value
        nestedObj[key] = SkillParser.#coerceValue(val);
        continue;
      }

      // Flush nested if at same level
      if (nestedObj) {
        result[currentKey] = nestedObj;
        nestedObj = null;
      }

      currentKey = key;
      currentIndent = spaces.length;

      if (val === '') {
        // Could be a nested object or array — wait for next line
        // Don't set both nestedObj and arrayKey; we'll determine which
        // based on what follows. Default to nested object mode;
        // if the first child is `- item`, switch to array mode.
        nestedObj = {};
        arrayKey = null;
        arrayItems = null;
      } else {
        result[key] = SkillParser.#coerceValue(val);
        arrayKey = null;
        arrayItems = null;
      }
    }

    // Flush any remaining
    if (arrayKey && arrayItems && arrayItems.length > 0) {
      result[arrayKey] = arrayItems;
    } else if (nestedObj && currentKey) {
      if (Object.keys(nestedObj).length > 0) {
        result[currentKey] = nestedObj;
      }
    }

    return result;
  }

  /**
   * Coerce a YAML string value to the appropriate JS type.
   * Supports booleans, null, quoted strings, numbers, inline arrays, inline objects.
   */
  static #coerceValue(val) {
    if (val === 'true') return true;
    if (val === 'false') return false;
    if (val === 'null' || val === '~') return null;
    // Quoted string
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      return val.slice(1, -1);
    }
    // Inline array: [a, b, c]
    if (val.startsWith('[') && val.endsWith(']')) {
      const inner = val.slice(1, -1).trim();
      if (inner === '') return [];
      return SkillParser.#splitRespectingQuotes(inner).map(item => SkillParser.#coerceValue(item.trim()));
    }
    // Inline object: {k: v, k2: v2}
    if (val.startsWith('{') && val.endsWith('}')) {
      const inner = val.slice(1, -1).trim();
      if (inner === '') return {};
      const obj = {};
      for (const pair of SkillParser.#splitRespectingQuotes(inner)) {
        const colonIdx = pair.indexOf(':');
        if (colonIdx > 0) {
          const k = pair.slice(0, colonIdx).trim();
          const v = pair.slice(colonIdx + 1).trim();
          obj[k] = SkillParser.#coerceValue(v);
        }
      }
      return obj;
    }
    // Number
    if (/^-?\d+(\.\d+)?$/.test(val)) return Number(val);
    return val;
  }

  /**
   * Split a string by commas, respecting quoted substrings and brace-delimited blocks.
   * "foo, \"bar, baz\", {a: 1, b: 2}" → ["foo", "\"bar, baz\"", "{a: 1, b: 2}"]
   */
  static #splitRespectingQuotes(str) {
    const parts = [];
    let current = '';
    let inQuote = null; // null, '"', or "'"
    let braceDepth = 0;
    let escaped = false;
    for (let i = 0; i < str.length; i++) {
      const ch = str[i];
      if (escaped) {
        current += ch;
        escaped = false;
      } else if (ch === '\\') {
        escaped = true;
        current += ch;
      } else if (inQuote) {
        current += ch;
        if (ch === inQuote) inQuote = null;
      } else if (ch === '"' || ch === "'") {
        inQuote = ch;
        current += ch;
      } else if (ch === '{') {
        braceDepth++;
        current += ch;
      } else if (ch === '}') {
        braceDepth = Math.max(0, braceDepth - 1);
        current += ch;
      } else if (ch === ',' && braceDepth === 0) {
        parts.push(current);
        current = '';
      } else {
        current += ch;
      }
    }
    if (current) parts.push(current);
    return parts;
  }

  /**
   * Validate skill metadata for required fields and format.
   * @param {object} meta
   * @returns {{ valid: boolean, errors: string[] }}
   */
  static validateMetadata(meta) {
    const errors = [];

    if (!meta.name || typeof meta.name !== 'string') {
      errors.push('Missing or invalid "name" field');
    } else if (!/^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/.test(meta.name)) {
      errors.push('Name must be lowercase alphanumeric with hyphens (e.g., "code-review")');
    }

    if (!meta.description || typeof meta.description !== 'string') {
      errors.push('Missing or invalid "description" field');
    } else if (meta.description.length > 500) {
      errors.push('Description exceeds 500 characters');
    }

    return { valid: errors.length === 0, errors };
  }

  /**
   * Validate skill script content for dangerous patterns.
   * Scans for eval, dynamic Function creation, cookie access,
   * storage access, direct XHR, and dynamic imports.
   * @param {string} content - Script source text
   * @returns {{ safe: boolean, warnings: string[] }}
   */
  static validateScript(content) {
    const warnings = [];
    const patterns = [
      { regex: /\beval\s*\(/,           label: 'eval() — dynamic code execution' },
      { regex: /\bFunction\s*\(/,       label: 'Function() — dynamic function creation' },
      { regex: /\bdocument\.cookie\b/,  label: 'document.cookie — cookie access' },
      { regex: /\blocalStorage[\.\[]/,  label: 'localStorage — storage access' },
      { regex: /\bXMLHttpRequest\b/,    label: 'XMLHttpRequest — direct XHR' },
      { regex: /(?<!\w)import\s*\(/,    label: 'import() — dynamic import' },
    ];

    for (const { regex, label } of patterns) {
      if (regex.test(content)) {
        warnings.push(label);
      }
    }

    return { safe: warnings.length === 0, warnings };
  }

  /** Valid hook points for skill hook registration. */
  static VALID_HOOK_POINTS = [
    'beforeInbound', 'beforeOutbound', 'transformResponse',
    'onSessionStart', 'onSessionEnd', 'onError',
  ];

  /**
   * Validate and normalize hook entries from skill frontmatter.
   * @param {Array<{point: string, handler: string, priority?: number, enabled?: boolean}>} hooks
   * @returns {{ valid: boolean, errors: string[], normalized: object[] }}
   */
  static validateHooks(hooks) {
    if (!hooks || !Array.isArray(hooks)) {
      return { valid: true, errors: [], normalized: [] };
    }

    const errors = [];
    const normalized = [];

    for (let i = 0; i < hooks.length; i++) {
      const hook = hooks[i];
      const prefix = `Hook[${i}]`;

      if (!hook.point || typeof hook.point !== 'string') {
        errors.push(`${prefix}: missing or invalid "point" field`);
        continue;
      }

      if (!SkillParser.VALID_HOOK_POINTS.includes(hook.point)) {
        errors.push(`${prefix}: invalid hook point "${hook.point}". Valid: ${SkillParser.VALID_HOOK_POINTS.join(', ')}`);
        continue;
      }

      if (!hook.handler || typeof hook.handler !== 'string') {
        errors.push(`${prefix}: missing or invalid "handler" field`);
        continue;
      }

      normalized.push({
        point: hook.point,
        handler: hook.handler,
        priority: typeof hook.priority === 'number' ? hook.priority : 10,
        enabled: hook.enabled !== false,
      });
    }

    return { valid: errors.length === 0, errors, normalized };
  }

  /**
   * Escape a string for use in an XML/HTML attribute.
   */
  static escAttr(str) {
    return str.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  /**
   * Substitute argument placeholders in a skill body.
   * Supports: $ARGUMENTS (full string), $ARGUMENTS[N] (split by space), $N (shorthand)
   * @param {string} body
   * @param {string} args - Raw argument string
   * @returns {string}
   */
  static substituteArguments(body, args = '') {
    let result = body;

    const argParts = args.split(/\s+/).filter(Boolean);

    // Only substitute placeholders when arguments were actually provided,
    // to avoid blanking out $ARGUMENTS or mangling $5 in skill body text.
    if (args) {
      // $ARGUMENTS — full argument string (word boundary prevents matching $ARGUMENTS_EXTRA)
      result = result.replace(/\$ARGUMENTS(?!\[|\w)/g, args);

      // $ARGUMENTS[N] — indexed
      result = result.replace(/\$ARGUMENTS\[(\d+)\]/g, (_, n) => argParts[Number(n)] || '');

      // $N — shorthand for $ARGUMENTS[N] (1-based)
      if (argParts.length > 0) {
        result = result.replace(/\$(\d+)(?!\w)/g, (_, n) => {
          const idx = Number(n) - 1;
          return idx >= 0 && idx < argParts.length ? argParts[idx] : '';
        });
      }
    }

    return result;
  }
}

// ── SkillStorage ─────────────────────────────────────────────────

export class SkillStorage {
  /**
   * Get the global skills directory handle.
   * @param {boolean} create - Create if not exists
   * @returns {Promise<FileSystemDirectoryHandle>}
   */
  static async getGlobalSkillsDir(create = false) {
    const root = await navigator.storage.getDirectory();
    return root.getDirectoryHandle('clawser_skills', { create });
  }

  /**
   * Get the per-workspace skills directory handle.
   * @param {string} wsId
   * @param {boolean} create
   * @returns {Promise<FileSystemDirectoryHandle>}
   */
  static async getWorkspaceSkillsDir(wsId, create = false) {
    const root = await navigator.storage.getDirectory();
    const base = await root.getDirectoryHandle('clawser_workspaces', { create });
    const wsDir = await base.getDirectoryHandle(wsId, { create });
    return wsDir.getDirectoryHandle('.skills', { create });
  }

  /**
   * List skill directory names under a scope.
   * @param {'global'|'workspace'} scope
   * @param {string} [wsId]
   * @returns {Promise<string[]>}
   */
  static async listSkillDirs(scope, wsId) {
    try {
      const dir = scope === 'global'
        ? await SkillStorage.getGlobalSkillsDir()
        : await SkillStorage.getWorkspaceSkillsDir(wsId);
      const names = [];
      for await (const [name, handle] of dir) {
        if (handle.kind === 'directory') names.push(name);
      }
      return names;
    } catch {
      return [];
    }
  }

  /**
   * Read a file from a directory handle (supports nested paths).
   * @param {FileSystemDirectoryHandle} dirHandle
   * @param {string} path - e.g., "SKILL.md" or "scripts/validate.js"
   * @returns {Promise<string>}
   */
  static async readFile(dirHandle, path) {
    const parts = path.split('/').filter(Boolean);
    let current = dirHandle;
    for (const part of parts.slice(0, -1)) {
      current = await current.getDirectoryHandle(part);
    }
    const fileHandle = await current.getFileHandle(parts[parts.length - 1]);
    const file = await fileHandle.getFile();
    return file.text();
  }

  /**
   * List files in a subdirectory.
   * @param {FileSystemDirectoryHandle} dirHandle
   * @param {string} subdir - e.g., "scripts"
   * @returns {Promise<string[]>}
   */
  static async listSubdir(dirHandle, subdir) {
    try {
      const sub = await dirHandle.getDirectoryHandle(subdir);
      const names = [];
      for await (const [name, handle] of sub) {
        if (handle.kind === 'file') names.push(name);
      }
      return names;
    } catch {
      return [];
    }
  }

  /**
   * Write a skill to OPFS from a Map of path → content.
   * @param {'global'|'workspace'} scope
   * @param {string|null} wsId
   * @param {string} name - Skill directory name
   * @param {Map<string,string>} files - Map of relative path → content
   */
  static async writeSkill(scope, wsId, name, files) {
    const parentDir = scope === 'global'
      ? await SkillStorage.getGlobalSkillsDir(true)
      : await SkillStorage.getWorkspaceSkillsDir(wsId, true);

    const skillDir = await parentDir.getDirectoryHandle(name, { create: true });

    for (const [path, content] of files) {
      const parts = path.split('/').filter(Boolean);
      let dir = skillDir;
      for (const part of parts.slice(0, -1)) {
        dir = await dir.getDirectoryHandle(part, { create: true });
      }
      const fileHandle = await dir.getFileHandle(parts[parts.length - 1], { create: true });
      const writable = await fileHandle.createWritable();
      await writable.write(content);
      await writable.close();
    }
  }

  /**
   * Delete a skill directory.
   * @param {'global'|'workspace'} scope
   * @param {string|null} wsId
   * @param {string} name
   */
  static async deleteSkill(scope, wsId, name) {
    try {
      const parentDir = scope === 'global'
        ? await SkillStorage.getGlobalSkillsDir()
        : await SkillStorage.getWorkspaceSkillsDir(wsId);
      await parentDir.removeEntry(name, { recursive: true });
    } catch {
      // Already deleted or doesn't exist
    }
  }

  /**
   * Import a skill from a ZIP blob using fflate.
   * @param {Blob} blob
   * @returns {Promise<Map<string,string>>} Map of path → content
   */
  static async importFromZip(blob) {
    const { unzipSync, strFromU8 } = await import('fflate');
    const buffer = new Uint8Array(await blob.arrayBuffer());
    const unzipped = unzipSync(buffer);

    const files = new Map();
    for (const [path, data] of Object.entries(unzipped)) {
      // Skip directories (empty entries) and hidden files
      if (path.endsWith('/') || path.startsWith('.') || path.includes('/__MACOSX/')) continue;
      files.set(path, strFromU8(data));
    }

    // Normalize: if all files are under a single subdirectory, strip that prefix
    const paths = [...files.keys()];
    if (paths.length > 0) {
      const firstSlash = paths[0].indexOf('/');
      if (firstSlash > 0) {
        const prefix = paths[0].slice(0, firstSlash + 1);
        const allUnderPrefix = paths.every(p => p.startsWith(prefix));
        if (allUnderPrefix) {
          const normalized = new Map();
          for (const [p, content] of files) {
            const rel = p.slice(prefix.length);
            if (rel) normalized.set(rel, content);
          }
          return normalized;
        }
      }
    }

    return files;
  }

  /**
   * Export a skill directory as a ZIP blob.
   * @param {FileSystemDirectoryHandle} dirHandle
   * @returns {Promise<Blob>}
   */
  static async exportToZip(dirHandle) {
    const fflate = await import('fflate');

    const entries = {};
    await SkillStorage.#collectFiles(dirHandle, '', entries, fflate.strToU8);

    const zipped = fflate.zipSync(entries, { level: 6 });
    return new Blob([zipped], { type: 'application/zip' });
  }

  /**
   * Recursively collect files from a directory handle.
   * @param {FileSystemDirectoryHandle} dirHandle
   * @param {string} prefix
   * @param {Object} entries
   * @param {Function} strToU8 - fflate's strToU8, passed once to avoid re-importing
   */
  static async #collectFiles(dirHandle, prefix, entries, strToU8) {
    for await (const [name, handle] of dirHandle) {
      const path = prefix ? `${prefix}/${name}` : name;
      if (handle.kind === 'file') {
        const file = await handle.getFile();
        const text = await file.text();
        entries[path] = strToU8(text);
      } else {
        await SkillStorage.#collectFiles(handle, path, entries, strToU8);
      }
    }
  }

  /**
   * Export all skills under a scope as a single ZIP blob.
   * Each skill directory becomes a top-level folder in the archive.
   * @param {'global'|'workspace'} scope
   * @param {string} [wsId] - Required when scope is 'workspace'
   * @returns {Promise<Blob>}
   */
  static async exportZip(scope, wsId) {
    const fflate = await import('fflate');

    const parentDir = scope === 'global'
      ? await SkillStorage.getGlobalSkillsDir()
      : await SkillStorage.getWorkspaceSkillsDir(wsId);

    const entries = {};
    for await (const [name, handle] of parentDir) {
      if (handle.kind === 'directory') {
        await SkillStorage.#collectFiles(handle, name, entries, fflate.strToU8);
      }
    }

    const zipped = fflate.zipSync(entries, { level: 6 });
    return new Blob([zipped], { type: 'application/zip' });
  }
}

// ── SkillEntry / SkillActivation types ───────────────────────────

/**
 * @typedef {Object} SkillEntry
 * @property {string} name - Skill name (from metadata or directory name)
 * @property {string} dirName - Actual directory name in OPFS
 * @property {string} description - From metadata
 * @property {object} metadata - Full parsed frontmatter
 * @property {'global'|'workspace'} scope
 * @property {boolean} enabled - Whether included in system prompt metadata
 * @property {number} bodyLength - Character length of the skill body (for token estimation)
 */

/**
 * @typedef {Object} SkillActivation
 * @property {string} name
 * @property {string} body - Full markdown body with substitutions applied
 * @property {string[]} scripts - Script file contents
 * @property {string[]} references - Reference file contents
 * @property {string[]} registeredTools - Names of tools registered for this skill
 */

// ── SkillRegistry ────────────────────────────────────────────────

export class SkillRegistry {
  /** @type {Map<string, SkillEntry>} */
  #skills = new Map();

  /** @type {Map<string, SkillActivation>} */
  #activeSkills = new Map();

  /** @type {Map<string, boolean>} */
  #enabledState = new Map();

  /** @type {import('./clawser-tools.js').BrowserToolRegistry|null} */
  #browserTools = null;

  /** @type {object|null} MCP manager for requirements context */
  #mcpManager = null;

  /** @type {string} */
  #wsId = 'default';

  /** @type {Function} */
  #onLog = () => {};

  /** @type {Function} callback when a skill is activated/deactivated */
  #onActivationChange = () => {};

  /** @type {Map<string, Promise<SkillActivation|null>>} */
  #activationLocks = new Map();

  /**
   * @param {object} opts
   * @param {import('./clawser-tools.js').BrowserToolRegistry} [opts.browserTools]
   * @param {object} [opts.mcpManager] - MCP manager for tool discovery
   * @param {Function} [opts.onLog]
   * @param {Function} [opts.onActivationChange]
   */
  constructor(opts = {}) {
    this.#browserTools = opts.browserTools || null;
    this.#mcpManager = opts.mcpManager || null;
    this.#onLog = opts.onLog || (() => {});
    this.#onActivationChange = opts.onActivationChange || (() => {});
  }

  /** Get all discovered skills */
  get skills() { return this.#skills; }

  /** Get currently active skills */
  get activeSkills() { return this.#activeSkills; }

  /**
   * Discover skills from global and workspace OPFS directories.
   * Workspace skills override global skills with the same name.
   * @param {string} wsId
   */
  async discover(wsId) {
    this.#skills.clear();
    this.#wsId = wsId;
    this.#loadEnabledState(wsId);

    // Global skills first
    const globalNames = await SkillStorage.listSkillDirs('global');
    if (globalNames.length > 0) {
      const globalParent = await SkillStorage.getGlobalSkillsDir();
      for (const dirName of globalNames) {
        try {
          const dir = await globalParent.getDirectoryHandle(dirName);
          const skillMd = await SkillStorage.readFile(dir, 'SKILL.md');
          const { metadata, body } = SkillParser.parseFrontmatter(skillMd);
          const skillName = metadata.name || dirName;

          this.#skills.set(skillName, {
            name: skillName,
            dirName,
            description: metadata.description || '',
            metadata,
            scope: 'global',
            enabled: this.#enabledState.get(skillName) ?? true,
            bodyLength: body.length,
          });
        } catch (e) {
          this.#onLog(3, `Failed to load global skill "${dirName}": ${e.message}`);
        }
      }
    }

    // Workspace skills (override global)
    const wsNames = await SkillStorage.listSkillDirs('workspace', wsId);
    if (wsNames.length > 0) {
      const wsParent = await SkillStorage.getWorkspaceSkillsDir(wsId);
      for (const dirName of wsNames) {
        try {
          const dir = await wsParent.getDirectoryHandle(dirName);
          const skillMd = await SkillStorage.readFile(dir, 'SKILL.md');
          const { metadata, body } = SkillParser.parseFrontmatter(skillMd);
          const skillName = metadata.name || dirName;

          this.#skills.set(skillName, {
            name: skillName,
            dirName,
            description: metadata.description || '',
            metadata,
            scope: 'workspace',
            enabled: this.#enabledState.get(skillName) ?? true,
            bodyLength: body.length,
          });
        } catch (e) {
          this.#onLog(3, `Failed to load workspace skill "${dirName}": ${e.message}`);
        }
      }
    }

    // Clean up orphaned active skills (no longer discovered).
    // Suppress callbacks during cleanup to avoid redundant renders.
    const orphans = [...this.#activeSkills.keys()].filter(n => !this.#skills.has(n));
    if (orphans.length > 0) {
      const savedCb = this.#onActivationChange;
      this.#onActivationChange = () => {};
      for (const name of orphans) {
        this.deactivate(name);
      }
      this.#onActivationChange = savedCb;
    }

    this.#onLog(2, `Discovered ${this.#skills.size} skills (${globalNames.length} global, ${wsNames.length} workspace)`);
  }

  /**
   * Activate a skill: load full body, scripts, references, register tools.
   * Serializes concurrent activations of the same skill to prevent TOCTOU races.
   * @param {string} name
   * @param {string} [args] - Arguments for $ARGUMENTS substitution
   * @param {object} [opts]
   * @param {boolean} [opts.force=false] - Skip dependency requirement checks
   * @returns {Promise<SkillActivation|null>}
   */
  async activate(name, args = '', opts = {}) {
    const pending = this.#activationLocks.get(name);
    if (pending) await pending;
    const promise = this.#doActivate(name, args, opts);
    this.#activationLocks.set(name, promise);
    try { return await promise; }
    finally { this.#activationLocks.delete(name); }
  }

  async #doActivate(name, args = '', opts = {}) {
    const entry = this.#skills.get(name);
    if (!entry) {
      this.#onLog(3, `Skill not found: ${name}`);
      return null;
    }

    // Already active? Just update args — skip redundant tool re-registration
    if (this.#activeSkills.has(name)) {
      const existing = this.#activeSkills.get(name);
      // Re-read and re-substitute
      const dir = await this.#getSkillDir(entry);
      const skillMd = await SkillStorage.readFile(dir, 'SKILL.md');
      const { body } = SkillParser.parseFrontmatter(skillMd);
      existing.body = SkillParser.substituteArguments(body, args);
      // Pass empty toolNames — tools are already registered, no need to re-register
      this.#onActivationChange(name, true, []);
      return existing;
    }

    try {
      const dir = await this.#getSkillDir(entry);
      const skillMd = await SkillStorage.readFile(dir, 'SKILL.md');
      const { metadata, body } = SkillParser.parseFrontmatter(skillMd);

      // Dependency requirement enforcement
      if (!opts.force && metadata.requires) {
        const ctx = this.#buildRequirementsContext();
        const reqCheck = validateRequirements(metadata, ctx);
        if (!reqCheck.satisfied) {
          const missingParts = [];
          if (reqCheck.missing.tools.length > 0) missingParts.push(`tools: ${reqCheck.missing.tools.join(', ')}`);
          if (reqCheck.missing.permissions.length > 0) missingParts.push(`permissions: ${reqCheck.missing.permissions.join(', ')}`);
          this.#onLog(3, `Skill "${name}" has unmet dependencies: ${missingParts.join('; ')}`);
          return null;
        }
      }

      // Validate skill body for dangerous patterns
      const bodyCheck = SkillParser.validateScript(body);
      if (!bodyCheck.safe) {
        this.#onLog(3, `Skill "${name}" body contains unsafe patterns: ${bodyCheck.warnings.join(', ')}`);
        return null;
      }

      // Load scripts
      const scriptNames = await SkillStorage.listSubdir(dir, 'scripts');
      const scripts = [];
      for (const sn of scriptNames) {
        const content = await SkillStorage.readFile(dir, `scripts/${sn}`);
        // Validate each script for dangerous patterns
        const scriptCheck = SkillParser.validateScript(content);
        if (!scriptCheck.safe) {
          this.#onLog(3, `Skill "${name}" script "${sn}" blocked: ${scriptCheck.warnings.join(', ')}`);
          return null;
        }
        scripts.push({ name: sn, content });
      }

      // Load references
      const refNames = await SkillStorage.listSubdir(dir, 'references');
      const references = [];
      for (const rn of refNames) {
        const content = await SkillStorage.readFile(dir, `references/${rn}`);
        references.push(content);
      }

      const activation = {
        name,
        body: SkillParser.substituteArguments(body, args),
        scripts,
        references,
        registeredTools: [],
      };

      // Register script tools
      if (this.#browserTools && scripts.length > 0) {
        for (const script of scripts) {
          const toolName = `skill_${name}_${script.name.replace(/\.js$/, '')}`;
          const tool = new SkillScriptTool(toolName, name, script.name, script.content);
          this.#browserTools.register(tool);
          activation.registeredTools.push(toolName);
        }
      }

      this.#activeSkills.set(name, activation);
      this.#onActivationChange(name, true, [...activation.registeredTools]);
      this.#onLog(2, `Skill "${name}" activated (${scripts.length} scripts, ${references.length} references)`);
      return activation;
    } catch (e) {
      this.#onLog(4, `Failed to activate skill "${name}": ${e.message}`);
      return null;
    }
  }

  /**
   * Deactivate a skill: remove from active, unregister custom tools.
   * @param {string} name
   */
  deactivate(name) {
    const activation = this.#activeSkills.get(name);
    if (!activation) return;

    // Capture tool names before removing from map
    const toolNames = [...activation.registeredTools];

    // Unregister custom tools from browserTools
    if (this.#browserTools) {
      for (const toolName of toolNames) {
        this.#browserTools.unregister(toolName);
      }
    }

    this.#activeSkills.delete(name);
    this.#onActivationChange(name, false, toolNames);
    this.#onLog(2, `Skill "${name}" deactivated`);
  }

  /**
   * Set enabled/disabled state for a skill.
   */
  setEnabled(name, enabled) {
    const entry = this.#skills.get(name);
    if (entry) {
      entry.enabled = enabled;
      this.#enabledState.set(name, enabled);
    }
  }

  /**
   * Persist enabled state to localStorage.
   * @param {string} wsId
   */
  persistEnabledState(wsId) {
    const obj = {};
    for (const [name, enabled] of this.#enabledState) {
      obj[name] = enabled;
    }
    localStorage.setItem(lsKey.skillsEnabled(wsId), JSON.stringify(obj));
  }

  /**
   * Build the metadata prompt block for all enabled skills.
   * This goes in the system prompt so the model knows what skills are available.
   * @returns {string}
   */
  buildMetadataPrompt() {
    const enabled = [...this.#skills.values()].filter(s => s.enabled);
    if (enabled.length === 0) return '';

    const lines = enabled.map(s => `<skill name="${SkillParser.escAttr(s.name)}" description="${SkillParser.escAttr(s.description)}" />`);
    return `\n<available-skills>\n${lines.join('\n')}\n</available-skills>\nYou can activate a skill by calling the skill_activate tool with the skill name.`;
  }

  /**
   * Build the full activation prompt for an active skill.
   * @param {string} name
   * @returns {string}
   */
  buildActivationPrompt(name) {
    const activation = this.#activeSkills.get(name);
    if (!activation) return '';

    // Use a stable per-skill delimiter to prevent skill body from prematurely closing the tag
    const sentinel = `__skill_end_${name}__`;
    let prompt = `\n<active-skill name="${SkillParser.escAttr(name)}" end="${sentinel}">\n${activation.body}\n`;

    // Include references inline
    if (activation.references.length > 0) {
      prompt += '\n<skill-references>\n';
      for (const ref of activation.references) {
        prompt += ref + '\n---\n';
      }
      prompt += '</skill-references>\n';
    }

    prompt += `</${sentinel}>`;
    return prompt;
  }

  /**
   * Install a skill from a Map of files.
   * @param {'global'|'workspace'} scope
   * @param {string|null} wsId
   * @param {Map<string,string>} files
   * @returns {Promise<{name: string, metadata: object}>}
   */
  async install(scope, wsId, files) {
    // Find SKILL.md
    const skillMdPath = [...files.keys()].find(p => p === 'SKILL.md' || p.endsWith('/SKILL.md'));
    if (!skillMdPath) {
      throw new Error('No SKILL.md found in files');
    }

    const skillMd = files.get(skillMdPath);
    const { metadata } = SkillParser.parseFrontmatter(skillMd);
    const validation = SkillParser.validateMetadata(metadata);
    if (!validation.valid) {
      throw new Error(`Invalid skill metadata: ${validation.errors.join(', ')}`);
    }

    const name = metadata.name;

    // Normalize paths relative to SKILL.md
    const prefix = skillMdPath === 'SKILL.md' ? '' : skillMdPath.replace('SKILL.md', '');
    const normalized = new Map();
    for (const [path, content] of files) {
      const rel = prefix ? path.slice(prefix.length) : path;
      if (rel) normalized.set(rel, content);
    }

    await SkillStorage.writeSkill(scope, wsId, name, normalized);
    this.#onLog(2, `Skill "${name}" installed (${scope}, ${normalized.size} files)`);
    return { name, metadata };
  }

  /**
   * Install a skill from a ZIP blob.
   * @param {'global'|'workspace'} scope
   * @param {string|null} wsId
   * @param {Blob} blob
   * @returns {Promise<{name: string, metadata: object}>}
   */
  async installFromZip(scope, wsId, blob) {
    const files = await SkillStorage.importFromZip(blob);
    return this.install(scope, wsId, files);
  }

  /**
   * Uninstall a skill.
   * @param {string} name
   * @param {string} wsId
   */
  async uninstall(name, wsId) {
    const entry = this.#skills.get(name);
    if (!entry) return;

    // Deactivate first if active
    this.deactivate(name);

    await SkillStorage.deleteSkill(entry.scope, wsId, entry.dirName || name);
    this.#skills.delete(name);
    this.#enabledState.delete(name);
    this.persistEnabledState(wsId);
    this.#onLog(2, `Skill "${name}" uninstalled`);
  }

  /**
   * Get the skill names that can be invoked via slash commands.
   * @returns {string[]}
   */
  getSlashCommandNames() {
    return [...this.#skills.values()]
      .filter(s => s.enabled)
      .map(s => s.name);
  }

  /**
   * Build requirements context from available browser tools and MCP tools.
   * Public API for UI components to validate requirements consistently.
   * @returns {{ tools: string[], permissions: string[] }}
   */
  buildRequirementsContext() {
    return this.#buildRequirementsContext();
  }

  // ── Private helpers ──────────────────────────────────────────

  /**
   * Build requirements context from available browser tools and MCP tools.
   * @returns {{ tools: string[], permissions: string[] }}
   */
  #buildRequirementsContext() {
    const toolNames = [];
    const permLevels = new Set();

    if (this.#browserTools) {
      for (const spec of this.#browserTools.allSpecs()) {
        toolNames.push(spec.name);
        const perm = this.#browserTools.getPermission(spec.name);
        if (perm) permLevels.add(perm);
      }
    }

    if (this.#mcpManager?.allToolSpecs) {
      for (const spec of this.#mcpManager.allToolSpecs()) {
        toolNames.push(spec.name || spec);
      }
    }

    return { tools: toolNames, permissions: [...permLevels] };
  }

  #loadEnabledState(wsId) {
    this.#enabledState.clear();
    try {
      const raw = localStorage.getItem(lsKey.skillsEnabled(wsId));
      if (raw) {
        const obj = JSON.parse(raw);
        for (const [name, enabled] of Object.entries(obj)) {
          this.#enabledState.set(name, enabled);
        }
      }
    } catch (e) { console.debug('[clawser] failed to load skill enabled state', e); }
  }

  async #getSkillDir(entry) {
    const dirName = entry.dirName || entry.name;
    if (entry.scope === 'global') {
      const parent = await SkillStorage.getGlobalSkillsDir();
      return parent.getDirectoryHandle(dirName);
    } else {
      const parent = await SkillStorage.getWorkspaceSkillsDir(this.#wsId);
      return parent.getDirectoryHandle(dirName);
    }
  }

  // ── Skills → CLI Registration ───────────────────────────────────

  /** @type {Set<string>} Names of commands registered by skills */
  #registeredCommands = new Set();

  /**
   * Register enabled skills as shell CLI commands in a CommandRegistry.
   * Uses skill metadata.commands if specified, otherwise uses the skill name.
   * @param {object} cmdRegistry - CommandRegistry with register(name, handler, meta)
   */
  registerCLI(cmdRegistry) {
    if (!cmdRegistry) return;

    for (const [name, skill] of this.#skills) {
      if (!skill.enabled) continue;

      const commandNames = skill.metadata?.commands && Array.isArray(skill.metadata.commands)
        ? skill.metadata.commands
        : [name];

      for (const cmdName of commandNames) {
        if (cmdRegistry.has(cmdName)) continue; // Don't override built-in commands

        const handler = async ({ args, stdin, state }) => {
          // Invoke the skill through the activation system
          const active = this.#activeSkills.get(name);
          if (active?.scriptTool) {
            const result = await active.scriptTool.execute({ input: args.join(' '), stdin });
            return {
              stdout: result.output || '',
              stderr: result.error || '',
              exitCode: result.success ? 0 : 1,
            };
          }
          // Skill not activated — return its description
          return {
            stdout: `Skill '${name}': ${skill.description || 'No description'}. Activate it first.`,
            stderr: '',
            exitCode: 0,
          };
        };

        cmdRegistry.register(cmdName, handler, {
          description: skill.description || `Skill: ${name}`,
          category: 'skills',
          usage: `${cmdName} [args...]`,
        });
        this.#registeredCommands.add(cmdName);
      }
    }
  }

  /**
   * Unregister all skill-added CLI commands from a CommandRegistry.
   * @param {object} cmdRegistry - CommandRegistry with unregister(name) method
   */
  unregisterCLI(cmdRegistry) {
    if (!cmdRegistry || typeof cmdRegistry.unregister !== 'function') return;

    for (const cmdName of this.#registeredCommands) {
      cmdRegistry.unregister(cmdName);
    }
    this.#registeredCommands.clear();
  }
}

// ── SkillScriptTool ──────────────────────────────────────────────

/**
 * A BrowserTool that executes a skill's JS script in an andbox sandbox.
 */
class SkillScriptTool extends BrowserTool {
  #toolName;
  #skillName;
  #scriptName;
  #scriptContent;

  constructor(toolName, skillName, scriptName, scriptContent) {
    super();
    this.#toolName = toolName;
    this.#skillName = skillName;
    this.#scriptName = scriptName;
    this.#scriptContent = scriptContent;
  }

  get name() { return this.#toolName; }
  get description() { return `Skill script: ${this.#skillName}/${this.#scriptName}`; }
  get parameters() {
    return {
      type: 'object',
      properties: {
        input: { type: 'string', description: 'Input to pass to the script' },
      },
    };
  }
  get permission() { return 'approve'; }

  async execute({ input = '' }) {
    try {
      const { createSandbox } = await import('./packages-andbox.js');
      const sandbox = await createSandbox();
      try {
        // Wrap script to expose `input` variable and capture return value
        const wrapper = `const input = ${JSON.stringify(input)};\n${this.#scriptContent}`;
        const result = await sandbox.evaluate(wrapper);
        return {
          success: true,
          output: result == null ? '' : (typeof result === 'string' ? result : JSON.stringify(result)),
        };
      } finally {
        sandbox.dispose?.();
      }
    } catch (e) {
      return { success: false, output: '', error: e.message };
    }
  }
}

// ── ActivateSkillTool ────────────────────────────────────────────

export class ActivateSkillTool extends BrowserTool {
  /** @type {SkillRegistry} */
  #registry;
  /** @type {Function} */
  #onActivate;

  /**
   * @param {SkillRegistry} registry
   * @param {Function} onActivate - Callback(name, activation) when skill is activated
   */
  constructor(registry, onActivate = () => {}) {
    super();
    this.#registry = registry;
    this.#onActivate = onActivate;
  }

  get name() { return 'skill_activate'; }
  get description() {
    return 'Activate an available skill to get its detailed instructions and tools. Check <available-skills> in your context for skill names.';
  }
  get parameters() {
    return {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Skill name to activate' },
        arguments: { type: 'string', description: 'Optional arguments to pass to the skill' },
        force: { type: 'boolean', description: 'Skip dependency checks (default: false)' },
      },
      required: ['name'],
    };
  }
  get permission() { return 'internal'; }

  async execute({ name, arguments: args = '', force = false }) {
    if (!this.#registry.skills.has(name)) {
      const available = [...this.#registry.skills.keys()].join(', ');
      return {
        success: false,
        output: '',
        error: `Skill "${name}" not found. Available: ${available || 'none'}`,
      };
    }
    const activation = await this.#registry.activate(name, args, { force });
    if (!activation) {
      return {
        success: false,
        output: '',
        error: `Skill "${name}" could not be activated (unmet dependencies or unsafe patterns). Use force: true to bypass.`,
      };
    }

    this.#onActivate(name, activation);

    const toolList = activation.registeredTools.length > 0
      ? ` Custom tools: ${activation.registeredTools.join(', ')}.`
      : '';
    return {
      success: true,
      output: `Skill "${name}" activated. Instructions have been added to your context.${toolList}`,
    };
  }
}

// ── DeactivateSkillTool ──────────────────────────────────────────

export class DeactivateSkillTool extends BrowserTool {
  /** @type {SkillRegistry} */
  #registry;
  /** @type {Function} */
  #onDeactivate;

  /**
   * @param {SkillRegistry} registry
   * @param {Function} onDeactivate - Callback(name) when skill is deactivated
   */
  constructor(registry, onDeactivate = () => {}) {
    super();
    this.#registry = registry;
    this.#onDeactivate = onDeactivate;
  }

  get name() { return 'skill_deactivate'; }
  get description() {
    return 'Deactivate a currently active skill, removing its instructions and tools from your context.';
  }
  get parameters() {
    return {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Skill name to deactivate' },
      },
      required: ['name'],
    };
  }
  get permission() { return 'internal'; }

  async execute({ name }) {
    if (!this.#registry.activeSkills.has(name)) {
      return {
        success: false,
        output: '',
        error: `Skill "${name}" is not currently active.`,
      };
    }

    this.#registry.deactivate(name);
    this.#onDeactivate(name);

    return {
      success: true,
      output: `Skill "${name}" deactivated. Its instructions and tools have been removed.`,
    };
  }
}

// ── Semver Lite ──────────────────────────────────────────────────

/**
 * Compare two semver strings. Returns -1, 0, or 1.
 * Handles partial versions (e.g. "1.0" treated as "1.0.0").
 * @param {string} a
 * @param {string} b
 * @returns {-1|0|1}
 */
export function semverCompare(a, b) {
  const pa = (a || '0.0.0').split('.').map(Number);
  const pb = (b || '0.0.0').split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    const va = pa[i] || 0;
    const vb = pb[i] || 0;
    if (va > vb) return 1;
    if (va < vb) return -1;
  }
  return 0;
}

/**
 * Check if version a is greater than version b.
 * @param {string} a
 * @param {string} b
 * @returns {boolean}
 */
export function semverGt(a, b) { return semverCompare(a, b) === 1; }

// ── Requirements Validation ─────────────────────────────────────

/**
 * Validate skill requirements against available tools and permissions.
 * @param {object} metadata - Skill metadata with optional `requires` field
 * @param {object} [context] - Available context
 * @param {string[]} [context.tools] - Available tool names
 * @param {string[]} [context.permissions] - Available permission categories
 * @returns {{ satisfied: boolean, missing: { tools: string[], permissions: string[] } }}
 */
export function validateRequirements(metadata, context = {}) {
  const requires = metadata.requires || {};
  const missingTools = [];
  const missingPerms = [];

  if (Array.isArray(requires.tools)) {
    const available = new Set(context.tools || []);
    for (const tool of requires.tools) {
      if (!available.has(tool)) missingTools.push(tool);
    }
  }

  if (Array.isArray(requires.permissions)) {
    const available = new Set(context.permissions || []);
    for (const perm of requires.permissions) {
      if (!available.has(perm)) missingPerms.push(perm);
    }
  }

  return {
    satisfied: missingTools.length === 0 && missingPerms.length === 0,
    missing: { tools: missingTools, permissions: missingPerms },
  };
}

// ── Skill Verification ──────────────────────────────────────

/**
 * Compute a hash of skill content for integrity verification.
 * Uses FNV-1a hash (no Web Crypto needed, synchronous).
 * @param {string} content - Skill file content
 * @returns {string} Hex hash string
 */
export function computeSkillHash(content) {
  let hash = 0x811c9dc5; // FNV offset basis
  for (let i = 0; i < content.length; i++) {
    hash ^= content.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193); // FNV prime
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

/**
 * Verify skill content matches an expected hash.
 * @param {string} content - Skill content
 * @param {string} expectedHash - Expected hex hash
 * @returns {boolean}
 */
export function verifySkillIntegrity(content, expectedHash) {
  return computeSkillHash(content) === expectedHash;
}

// ── Dependency Resolution ───────────────────────────────────

/**
 * Resolve skill dependencies against available skills and tools.
 * @param {object} metadata - Skill metadata with optional `requires` field
 * @param {object} available - Available resources
 * @param {string[]} [available.skills] - Available skill names
 * @param {string[]} [available.tools] - Available tool names
 * @returns {{ resolved: boolean, missing: string[] }}
 */
export function resolveDependencies(metadata, available = {}) {
  const requires = metadata.requires || {};
  const missing = [];

  if (Array.isArray(requires.skills)) {
    const avail = new Set(available.skills || []);
    for (const skill of requires.skills) {
      if (!avail.has(skill)) missing.push(skill);
    }
  }

  if (Array.isArray(requires.tools)) {
    const avail = new Set(available.tools || []);
    for (const tool of requires.tools) {
      if (!avail.has(tool)) missing.push(tool);
    }
  }

  return {
    resolved: missing.length === 0,
    missing,
  };
}

// ── SkillRegistryClient ─────────────────────────────────────────

const DEFAULT_REGISTRY_URL = 'https://raw.githubusercontent.com/clawser/skills-registry/main';

/**
 * Client for browsing and installing skills from a remote registry.
 * The registry is a GitHub repo with an index.json and skills/ subdirectory.
 */
export class SkillRegistryClient {
  #registryUrl;
  #indexCache = null;
  #indexCacheTime = 0;
  #cacheTTL;

  /**
   * @param {object} [opts]
   * @param {string} [opts.registryUrl] - Base URL of the registry repo (raw content)
   * @param {number} [opts.cacheTTL=300000] - Index cache TTL in ms (default 5 min)
   */
  constructor(opts = {}) {
    this.#registryUrl = (opts.registryUrl || DEFAULT_REGISTRY_URL).replace(/\/$/, '');
    this.#cacheTTL = opts.cacheTTL ?? 300_000;
  }

  /** Get the registry base URL */
  get registryUrl() { return this.#registryUrl; }

  /** Set a new registry URL */
  set registryUrl(url) {
    this.#registryUrl = (url || DEFAULT_REGISTRY_URL).replace(/\/$/, '');
    this.#indexCache = null;
  }

  /**
   * Fetch the registry index (cached).
   * @returns {Promise<Array<{name: string, version: string, description: string, author: string, tags: string[], path: string}>>}
   */
  async fetchIndex() {
    if (this.#indexCache && (Date.now() - this.#indexCacheTime) < this.#cacheTTL) {
      return this.#indexCache;
    }
    const resp = await fetch(`${this.#registryUrl}/index.json`);
    if (!resp.ok) throw new Error(`Registry fetch failed: ${resp.status} ${resp.statusText}`);
    const data = await resp.json();
    this.#indexCache = data.skills || [];
    this.#indexCacheTime = Date.now();
    return this.#indexCache;
  }

  /**
   * Search the registry for skills matching a query.
   * @param {string} query - Search string (matched against name, description, tags)
   * @param {object} [opts]
   * @param {string[]} [opts.tags] - Filter by tags
   * @param {number} [opts.limit=20] - Max results
   * @returns {Promise<Array<object>>}
   */
  async search(query, opts = {}) {
    const index = await this.fetchIndex();
    const limit = opts.limit || 20;
    const queryLower = (query || '').toLowerCase();
    const filterTags = opts.tags ? new Set(opts.tags.map(t => t.toLowerCase())) : null;

    let results = index;

    // Tag filter
    if (filterTags) {
      results = results.filter(s =>
        Array.isArray(s.tags) && s.tags.some(t => filterTags.has(t.toLowerCase()))
      );
    }

    // Text search
    if (queryLower) {
      results = results.map(s => {
        const text = `${s.name} ${s.description} ${(s.tags || []).join(' ')} ${s.author || ''}`.toLowerCase();
        const score = queryLower.split(/\s+/).reduce((sum, term) => sum + (text.includes(term) ? 1 : 0), 0);
        return { ...s, _score: score };
      }).filter(s => s._score > 0)
        .sort((a, b) => b._score - a._score);
    }

    return results.slice(0, limit);
  }

  /**
   * Fetch a SKILL.md from the registry by name.
   * @param {string} name
   * @returns {Promise<{content: string, metadata: object, body: string}>}
   */
  async getSkill(name) {
    const index = await this.fetchIndex();
    const entry = index.find(s => s.name === name);
    if (!entry) throw new Error(`Skill "${name}" not found in registry`);

    const url = `${this.#registryUrl}/${entry.path}`;
    const resp = await fetch(url);
    if (!resp.ok) throw new Error(`Failed to fetch skill: ${resp.status}`);
    const content = await resp.text();
    const { metadata, body } = SkillParser.parseFrontmatter(content);
    return { content, metadata, body };
  }

  /**
   * Install a skill from a URL (any raw SKILL.md URL).
   * @param {string} url - URL to a SKILL.md file
   * @param {SkillRegistry} registry
   * @param {'global'|'workspace'} [scope='global']
   * @param {string|null} [wsId]
   * @returns {Promise<{name: string, metadata: object}>}
   */
  async installFromUrl(url, registry, scope = 'global', wsId = null) {
    const resp = await fetch(url);
    if (!resp.ok) throw new Error(`Failed to fetch: ${resp.status}`);
    const content = await resp.text();

    const { metadata } = SkillParser.parseFrontmatter(content);
    const validation = SkillParser.validateMetadata(metadata);
    if (!validation.valid) {
      throw new Error(`Invalid skill: ${validation.errors.join(', ')}`);
    }

    const files = new Map([['SKILL.md', content]]);
    return registry.install(scope, wsId, files);
  }

  /**
   * Install a skill from the registry by name.
   * @param {string} name
   * @param {SkillRegistry} registry
   * @param {'global'|'workspace'} [scope='global']
   * @param {string|null} [wsId]
   * @param {object} [context] - For requirements validation {tools, permissions}
   * @returns {Promise<{name: string, metadata: object, warnings: string[]}>}
   */
  async installFromRegistry(name, registry, scope = 'global', wsId = null, context = {}) {
    const { content, metadata } = await this.getSkill(name);
    const warnings = [];

    // Check requirements
    const reqCheck = validateRequirements(metadata, context);
    if (!reqCheck.satisfied) {
      if (reqCheck.missing.tools.length > 0) {
        warnings.push(`Missing tools: ${reqCheck.missing.tools.join(', ')}`);
      }
      if (reqCheck.missing.permissions.length > 0) {
        warnings.push(`Missing permissions: ${reqCheck.missing.permissions.join(', ')}`);
      }
    }

    const files = new Map([['SKILL.md', content]]);
    const result = await registry.install(scope, wsId, files);
    return { ...result, warnings };
  }

  /**
   * Check if an installed skill has an update available.
   * @param {string} name
   * @param {string} currentVersion
   * @returns {Promise<{available: boolean, latest: string|null}>}
   */
  async checkUpdate(name, currentVersion) {
    try {
      const index = await this.fetchIndex();
      const entry = index.find(s => s.name === name);
      if (!entry) return { available: false, latest: null, error: null };
      return {
        available: semverGt(entry.version, currentVersion),
        latest: entry.version,
        error: null,
      };
    } catch (e) {
      return { available: false, latest: null, error: e.message || 'Registry unreachable' };
    }
  }

  /** Clear the cached index */
  clearCache() {
    this.#indexCache = null;
    this.#indexCacheTime = 0;
  }
}

// ── Skill Templates ─────────────────────────────────────────────

/**
 * Built-in skill templates for the "New Skill" flow.
 * Each template returns a Map<path, content> compatible with SkillRegistry.install().
 */
export const SKILL_TEMPLATES = [
  {
    id: 'basic-prompt',
    name: 'Basic Prompt',
    description: 'A simple skill with prompt instructions and argument substitution.',
    files() {
      return new Map([
        ['SKILL.md', `---
name: my-skill
version: 1.0.0
description: A custom prompt skill
invoke: true
---

# My Skill

You are a helpful assistant for this task.

User input: $ARGUMENTS
`],
      ]);
    },
  },
  {
    id: 'tool-script',
    name: 'Tool Script',
    description: 'A skill with a JavaScript helper tool executed in a sandbox.',
    files() {
      return new Map([
        ['SKILL.md', `---
name: my-tool-skill
version: 1.0.0
description: A skill with a custom tool script
invoke: true
---

# My Tool Skill

This skill provides a custom tool. Use the tool to process input.
`],
        ['scripts/helper.js', `// Skill script — receives \`input\` variable, return value becomes tool output
const result = input ? input.toUpperCase() : 'No input provided';
result;
`],
      ]);
    },
  },
  {
    id: 'multi-reference',
    name: 'Multi-Reference',
    description: 'A skill with reference documents loaded into context.',
    files() {
      return new Map([
        ['SKILL.md', `---
name: my-reference-skill
version: 1.0.0
description: A skill with reference materials
invoke: true
---

# My Reference Skill

Use the reference materials below to answer questions accurately.
`],
        ['references/guide.md', `# Reference Guide

Add your reference content here. This will be included in the skill's context
when activated.

## Section 1

Details go here.

## Section 2

More details.
`],
      ]);
    },
  },
];

// ── Simple Diff (LCS-based) ────────────────────────────────────

/**
 * Compute a line-level diff between two texts using LCS.
 * @param {string} oldText
 * @param {string} newText
 * @returns {Array<{type: 'same'|'add'|'remove', line: string}>}
 */
export function simpleDiff(oldText, newText) {
  const oldLines = (oldText || '').split('\n');
  const newLines = (newText || '').split('\n');

  // Build LCS table
  const m = oldLines.length;
  const n = newLines.length;
  const dp = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (oldLines[i - 1] === newLines[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1] + 1;
      } else {
        dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1]);
      }
    }
  }

  // Backtrack to produce diff
  const result = [];
  let i = m, j = n;
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && oldLines[i - 1] === newLines[j - 1]) {
      result.push({ type: 'same', line: oldLines[i - 1] });
      i--; j--;
    } else if (j > 0 && (i === 0 || dp[i][j - 1] > dp[i - 1][j])) {
      result.push({ type: 'add', line: newLines[j - 1] });
      j--;
    } else {
      result.push({ type: 'remove', line: oldLines[i - 1] });
      i--;
    }
  }

  return result.reverse();
}

// ── Skill Registry Agent Tools ──────────────────────────────────

/**
 * Tool for searching the remote skill registry.
 */
export class SkillSearchTool extends BrowserTool {
  #client;

  constructor(client) {
    super();
    this.#client = client;
  }

  get name() { return 'skill_search'; }
  get description() { return 'Search the skill registry for installable skills.'; }
  get parameters() {
    return {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Search query (matches name, description, tags)' },
        tags: { type: 'string', description: 'Comma-separated tags to filter by (optional)' },
      },
      required: ['query'],
    };
  }
  get permission() { return 'network'; }

  async execute({ query, tags }) {
    try {
      const opts = {};
      if (tags) opts.tags = tags.split(',').map(t => t.trim());
      const results = await this.#client.search(query, opts);
      if (results.length === 0) {
        return { success: true, output: 'No skills found matching your query.' };
      }
      const lines = results.map(s =>
        `${s.name} v${s.version || '?'} — ${s.description || 'No description'}` +
        (s.author ? ` (by ${s.author})` : '') +
        (s.tags?.length ? ` [${s.tags.join(', ')}]` : '')
      );
      return { success: true, output: lines.join('\n') };
    } catch (e) {
      return { success: false, output: '', error: e.message };
    }
  }
}

/**
 * Tool for installing skills from URL or registry.
 */
export class SkillInstallTool extends BrowserTool {
  #client;
  #registry;
  #wsId;

  /**
   * @param {object} client
   * @param {object} registry
   * @param {string|Function} wsId - Workspace ID or getter function for lazy evaluation
   */
  constructor(client, registry, wsId = 'default') {
    super();
    this.#client = client;
    this.#registry = registry;
    this.#wsId = wsId;
  }

  get #activeWsId() { return typeof this.#wsId === 'function' ? this.#wsId() : this.#wsId; }

  get name() { return 'skill_install'; }
  get description() { return 'Install a skill from the registry by name or from a URL.'; }
  get parameters() {
    return {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Skill name from registry, or full URL to a SKILL.md' },
        scope: { type: 'string', description: 'Install scope: "global" or "workspace" (default: global)' },
      },
      required: ['name'],
    };
  }
  get permission() { return 'network'; }

  async execute({ name, scope = 'global' }) {
    try {
      let result;
      if (name.startsWith('http://') || name.startsWith('https://')) {
        result = await this.#client.installFromUrl(name, this.#registry, scope, this.#activeWsId);
      } else {
        result = await this.#client.installFromRegistry(name, this.#registry, scope, this.#activeWsId);
      }
      let msg = `Skill "${result.name}" installed (${scope}).`;
      if (result.warnings?.length) {
        msg += ` Warnings: ${result.warnings.join('; ')}`;
      }
      return { success: true, output: msg };
    } catch (e) {
      return { success: false, output: '', error: e.message };
    }
  }
}

/**
 * Tool for updating installed skills.
 */
export class SkillUpdateTool extends BrowserTool {
  #client;
  #registry;
  #wsId;

  constructor(client, registry, wsId = 'default') {
    super();
    this.#client = client;
    this.#registry = registry;
    this.#wsId = wsId;
  }

  get #activeWsId() { return typeof this.#wsId === 'function' ? this.#wsId() : this.#wsId; }

  get name() { return 'skill_update'; }
  get description() { return 'Check for and install updates for an installed skill.'; }
  get parameters() {
    return {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Skill name to update' },
      },
      required: ['name'],
    };
  }
  get permission() { return 'network'; }

  async execute({ name }) {
    try {
      const entry = this.#registry.skills.get(name);
      if (!entry) return { success: false, output: '', error: `Skill "${name}" is not installed.` };

      const currentVersion = entry.metadata?.version || '0.0.0';
      const check = await this.#client.checkUpdate(name, currentVersion);
      if (!check.available) {
        return { success: true, output: `Skill "${name}" is already at the latest version (${currentVersion}).` };
      }

      const result = await this.#client.installFromRegistry(name, this.#registry, entry.scope, this.#activeWsId);
      return { success: true, output: `Skill "${name}" updated from ${currentVersion} to ${check.latest}.` };
    } catch (e) {
      return { success: false, output: '', error: e.message };
    }
  }
}

/**
 * Tool for removing installed skills.
 */
export class SkillRemoveTool extends BrowserTool {
  #registry;
  #wsId;

  constructor(registry, wsId = 'default') {
    super();
    this.#registry = registry;
    this.#wsId = wsId;
  }

  get #activeWsId() { return typeof this.#wsId === 'function' ? this.#wsId() : this.#wsId; }

  get name() { return 'skill_remove'; }
  get description() { return 'Uninstall a skill.'; }
  get parameters() {
    return {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Skill name to remove' },
      },
      required: ['name'],
    };
  }
  get permission() { return 'write'; }

  async execute({ name }) {
    try {
      if (!this.#registry.skills.has(name)) {
        return { success: false, output: '', error: `Skill "${name}" is not installed.` };
      }
      await this.#registry.uninstall(name, this.#activeWsId);
      return { success: true, output: `Skill "${name}" removed.` };
    } catch (e) {
      return { success: false, output: '', error: e.message };
    }
  }
}

/**
 * Tool for listing installed skills.
 */
export class SkillListTool extends BrowserTool {
  #registry;

  constructor(registry) {
    super();
    this.#registry = registry;
  }

  get name() { return 'skill_list'; }
  get description() { return 'List all installed skills with their status.'; }
  get parameters() {
    return { type: 'object', properties: {} };
  }
  get permission() { return 'read'; }

  async execute() {
    const skills = [...this.#registry.skills.values()];
    if (skills.length === 0) {
      return { success: true, output: 'No skills installed.' };
    }
    const activeNames = new Set(this.#registry.activeSkills.keys());
    const lines = skills.map(s => {
      const version = s.metadata?.version ? ` v${s.metadata.version}` : '';
      const status = activeNames.has(s.name) ? ' [active]' : s.enabled ? '' : ' [disabled]';
      const scope = s.scope === 'workspace' ? ' (ws)' : ' (global)';
      return `${s.name}${version}${scope}${status} — ${s.description || 'No description'}`;
    });
    return { success: true, output: lines.join('\n') };
  }
}
