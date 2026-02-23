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
   * Split a string by commas, but respect quoted substrings.
   * "foo, \"bar, baz\", qux" → ["foo", "\"bar, baz\"", "qux"]
   */
  static #splitRespectingQuotes(str) {
    const parts = [];
    let current = '';
    let inQuote = null; // null, '"', or "'"
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
      } else if (ch === ',') {
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
    const { unzipSync, strFromU8 } = await import('https://cdn.jsdelivr.net/npm/fflate@0.8.2/+esm');
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
            normalized.set(p.slice(prefix.length), content);
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
    const fflate = await import('https://cdn.jsdelivr.net/npm/fflate@0.8.2/+esm');

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
   * @param {Function} [opts.onLog]
   * @param {Function} [opts.onActivationChange]
   */
  constructor(opts = {}) {
    this.#browserTools = opts.browserTools || null;
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
   * @returns {Promise<SkillActivation|null>}
   */
  async activate(name, args = '') {
    const pending = this.#activationLocks.get(name);
    if (pending) await pending;
    const promise = this.#doActivate(name, args);
    this.#activationLocks.set(name, promise);
    try { return await promise; }
    finally { this.#activationLocks.delete(name); }
  }

  async #doActivate(name, args = '') {
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

      // Load scripts
      const scriptNames = await SkillStorage.listSubdir(dir, 'scripts');
      const scripts = [];
      for (const sn of scriptNames) {
        const content = await SkillStorage.readFile(dir, `scripts/${sn}`);
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
    return `\n<available-skills>\n${lines.join('\n')}\n</available-skills>\nYou can activate a skill by calling the activate_skill tool with the skill name.`;
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

  // ── Private helpers ──────────────────────────────────────────

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
}

// ── SkillScriptTool ──────────────────────────────────────────────

/** Lazily cached vimble import */
let _vimblePromise = null;
function getVimble() {
  if (!_vimblePromise) {
    _vimblePromise = import('https://ga.jspm.io/npm:vimble@0.0.1/src/index.mjs');
  }
  return _vimblePromise;
}

/**
 * A BrowserTool that executes a skill's JS script in a vimble sandbox.
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
  get permission() { return 'internal'; }

  async execute({ input = '' }) {
    try {
      const { run } = await getVimble();
      // Wrap script to expose `input` variable and capture return value
      const wrapper = `const input = ${JSON.stringify(input)};\n${this.#scriptContent}`;
      const result = await run(wrapper);
      return {
        success: true,
        output: result == null ? '' : (typeof result === 'string' ? result : JSON.stringify(result)),
      };
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

  get name() { return 'activate_skill'; }
  get description() {
    return 'Activate an available skill to get its detailed instructions and tools. Check <available-skills> in your context for skill names.';
  }
  get parameters() {
    return {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Skill name to activate' },
        arguments: { type: 'string', description: 'Optional arguments to pass to the skill' },
      },
      required: ['name'],
    };
  }
  get permission() { return 'internal'; }

  async execute({ name, arguments: args = '' }) {
    const activation = await this.#registry.activate(name, args);
    if (!activation) {
      const available = [...this.#registry.skills.keys()].join(', ');
      return {
        success: false,
        output: '',
        error: `Skill "${name}" not found. Available: ${available || 'none'}`,
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

  get name() { return 'deactivate_skill'; }
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
