// Run with: node --import ./web/test/_setup-globals.mjs --test web/test/clawser-skills.test.mjs
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

// ── Stubs ────────────────────────────────────────────────────────

globalThis.BrowserTool = class { constructor() {} };

// Minimal lsKey stub — the module imports { lsKey } from clawser-state.js
// We need to intercept that import. Since clawser-skills.js uses lsKey.skillsEnabled(wsId),
// we stub it via the module's own import chain.

// Stub clawser-state.js lsKey before importing
const store = {};
globalThis.localStorage = globalThis.localStorage || {
  getItem: (k) => store[k] ?? null,
  setItem: (k, v) => { store[k] = String(v); },
  removeItem: (k) => { delete store[k]; },
  clear: () => { for (const k of Object.keys(store)) delete store[k]; },
};

// ── Import module under test ─────────────────────────────────────

import {
  SkillParser,
  SkillStorage,
  SkillRegistry,
  ActivateSkillTool,
  DeactivateSkillTool,
  semverCompare,
  semverGt,
  validateRequirements,
  computeSkillHash,
  verifySkillIntegrity,
  resolveDependencies,
} from '../clawser-skills.js';

// ── OPFS stub helpers ────────────────────────────────────────────

function createFileHandle(content) {
  let stored = content;
  return {
    kind: 'file',
    getFile() {
      return { text: async () => stored, arrayBuffer: async () => new TextEncoder().encode(stored).buffer };
    },
    async createWritable() {
      return {
        async write(data) { stored = data; },
        async close() {},
      };
    },
  };
}

function createDirHandle(entries = {}) {
  const dirs = {};
  const files = {};

  for (const [name, value] of Object.entries(entries)) {
    if (typeof value === 'string') {
      files[name] = createFileHandle(value);
    } else if (value && value.kind === 'directory') {
      dirs[name] = value;
    } else if (value && typeof value === 'object' && !value.kind) {
      // Nested plain object → treat as subdirectory
      dirs[name] = createDirHandle(value);
    }
  }

  const handle = {
    kind: 'directory',
    async getDirectoryHandle(name, opts) {
      if (dirs[name]) return dirs[name];
      if (opts?.create) {
        dirs[name] = createDirHandle();
        return dirs[name];
      }
      throw new DOMException(`Not found: ${name}`, 'NotFoundError');
    },
    async getFileHandle(name, opts) {
      if (files[name]) return files[name];
      if (opts?.create) {
        let content = '';
        const fh = createFileHandle(content);
        files[name] = fh;
        return fh;
      }
      throw new DOMException(`Not found: ${name}`, 'NotFoundError');
    },
    async removeEntry(name) {
      delete dirs[name];
      delete files[name];
    },
    async *[Symbol.asyncIterator]() {
      for (const [name, dir] of Object.entries(dirs)) {
        yield [name, dir];
      }
      for (const [name, file] of Object.entries(files)) {
        yield [name, file];
      }
    },
  };
  return handle;
}

/** Build a mock OPFS root that supports the skill directory structure. */
function mockOPFS(globalSkills = {}, workspaceSkills = {}) {
  // globalSkills: { skillName: { 'SKILL.md': '...', 'scripts/foo.js': '...' } }
  // workspaceSkills: { wsId: { skillName: { 'SKILL.md': '...' } } }

  const clawserSkills = createDirHandle({});
  for (const [skillName, fileMap] of Object.entries(globalSkills)) {
    // Build nested structure from flat paths
    const skillDir = buildSkillDir(fileMap);
    // Inject into clawserSkills
    clawserSkills.getDirectoryHandle(skillName, { create: true }).then(d => {
      // Copy entries — we need to replace the created empty dir
    });
  }

  // Simpler approach: build the full tree
  const globalDirs = {};
  for (const [skillName, fileMap] of Object.entries(globalSkills)) {
    globalDirs[skillName] = buildSkillDir(fileMap);
  }

  const wsDirs = {};
  for (const [wsId, skills] of Object.entries(workspaceSkills)) {
    const skillDirs = {};
    for (const [skillName, fileMap] of Object.entries(skills)) {
      skillDirs[skillName] = buildSkillDir(fileMap);
    }
    wsDirs[wsId] = createDirHandle({ '.skills': createDirHandle(skillDirs) });
  }

  const root = createDirHandle({
    clawser_skills: createDirHandle(globalDirs),
    clawser_workspaces: createDirHandle(wsDirs),
  });

  return root;
}

/** Build a skill directory from a flat { path: content } map. */
function buildSkillDir(fileMap) {
  // Convert flat paths like 'scripts/foo.js' into nested dir structure
  const tree = {};
  for (const [path, content] of Object.entries(fileMap)) {
    const parts = path.split('/');
    if (parts.length === 1) {
      tree[parts[0]] = content;
    } else {
      // Nested: build subdirectory
      if (!tree[parts[0]]) tree[parts[0]] = {};
      tree[parts[0]][parts.slice(1).join('/')] = content;
    }
  }

  // Recursively build
  const entries = {};
  for (const [name, value] of Object.entries(tree)) {
    if (typeof value === 'string') {
      entries[name] = value;
    } else {
      // It's a subdirectory map
      entries[name] = buildSkillDir(value);
    }
  }
  return createDirHandle(entries);
}

let origGetDirectory;

function installMockOPFS(root) {
  origGetDirectory = navigator.storage.getDirectory;
  navigator.storage.getDirectory = async () => root;
}

function restoreOPFS() {
  if (origGetDirectory) {
    navigator.storage.getDirectory = origGetDirectory;
    origGetDirectory = null;
  }
}

// ═══════════════════════════════════════════════════════════════════
// 1. SkillParser
// ═══════════════════════════════════════════════════════════════════

describe('SkillParser.parseFrontmatter', () => {
  it('parses valid SKILL.md with name, description, version', () => {
    const text = `---
name: code-review
description: Automated code review helper
version: 1.2.3
---
# Code Review
Review the code carefully.`;

    const { metadata, body } = SkillParser.parseFrontmatter(text);
    assert.equal(metadata.name, 'code-review');
    assert.equal(metadata.description, 'Automated code review helper');
    assert.equal(metadata.version, '1.2.3');
    assert.ok(body.includes('Review the code carefully'));
  });

  it('extracts body text after frontmatter', () => {
    const text = `---
name: my-skill
---
Line one.

Line two.`;

    const { body } = SkillParser.parseFrontmatter(text);
    assert.ok(body.includes('Line one.'));
    assert.ok(body.includes('Line two.'));
  });

  it('returns empty metadata when no frontmatter delimiters', () => {
    const text = 'Just a plain markdown file without frontmatter.';
    const { metadata, body } = SkillParser.parseFrontmatter(text);
    assert.deepStrictEqual(metadata, {});
    assert.equal(body, text);
  });

  it('handles missing optional fields gracefully', () => {
    const text = `---
name: minimal
---
Body`;

    const { metadata } = SkillParser.parseFrontmatter(text);
    assert.equal(metadata.name, 'minimal');
    assert.equal(metadata.description, undefined);
    assert.equal(metadata.version, undefined);
  });

  it('parses boolean values', () => {
    const text = `---
name: bools
active: true
disabled: false
---
Body`;

    const { metadata } = SkillParser.parseFrontmatter(text);
    assert.strictEqual(metadata.active, true);
    assert.strictEqual(metadata.disabled, false);
  });

  it('parses numeric values', () => {
    const text = `---
name: nums
priority: 42
weight: 3.14
---
Body`;

    const { metadata } = SkillParser.parseFrontmatter(text);
    assert.strictEqual(metadata.priority, 42);
    assert.strictEqual(metadata.weight, 3.14);
  });

  it('parses inline arrays', () => {
    const text = `---
name: arrays
tags: [alpha, beta, gamma]
---
Body`;

    const { metadata } = SkillParser.parseFrontmatter(text);
    assert.ok(Array.isArray(metadata.tags));
    assert.deepStrictEqual(metadata.tags, ['alpha', 'beta', 'gamma']);
  });

  it('parses YAML list arrays (- item)', () => {
    const text = `---
name: list-array
triggers:
  - /review
  - /check
---
Body`;

    const { metadata } = SkillParser.parseFrontmatter(text);
    assert.ok(Array.isArray(metadata.triggers));
    assert.deepStrictEqual(metadata.triggers, ['/review', '/check']);
  });

  it('parses nested objects', () => {
    const text = `---
name: nested
requires:
  tools: [fetch, fs_read]
  permissions: [network]
---
Body`;

    const { metadata } = SkillParser.parseFrontmatter(text);
    assert.ok(metadata.requires);
    assert.deepStrictEqual(metadata.requires.tools, ['fetch', 'fs_read']);
    assert.deepStrictEqual(metadata.requires.permissions, ['network']);
  });

  it('handles quoted strings', () => {
    const text = `---
name: quotes
description: "A skill with: colons and stuff"
---
Body`;

    const { metadata } = SkillParser.parseFrontmatter(text);
    assert.equal(metadata.description, 'A skill with: colons and stuff');
  });

  it('handles null/tilde values', () => {
    const text = `---
name: nulls
extra: null
other: ~
---
Body`;

    const { metadata } = SkillParser.parseFrontmatter(text);
    assert.strictEqual(metadata.extra, null);
    assert.strictEqual(metadata.other, null);
  });

  it('returns trimmed body', () => {
    const text = `---
name: trimmed
---

   Lots of whitespace

`;

    const { body } = SkillParser.parseFrontmatter(text);
    assert.equal(body, 'Lots of whitespace');
  });

  it('handles empty body', () => {
    const text = `---
name: empty-body
---
`;

    const { metadata, body } = SkillParser.parseFrontmatter(text);
    assert.equal(metadata.name, 'empty-body');
    assert.equal(body, '');
  });
});

// ── SkillParser.validateMetadata ─────────────────────────────────

describe('SkillParser.validateMetadata', () => {
  it('passes for valid metadata', () => {
    const result = SkillParser.validateMetadata({ name: 'my-skill', description: 'A good skill' });
    assert.ok(result.valid);
    assert.equal(result.errors.length, 0);
  });

  it('fails when name is missing', () => {
    const result = SkillParser.validateMetadata({ description: 'No name' });
    assert.equal(result.valid, false);
    assert.ok(result.errors.some(e => e.includes('name')));
  });

  it('fails when description is missing', () => {
    const result = SkillParser.validateMetadata({ name: 'no-desc' });
    assert.equal(result.valid, false);
    assert.ok(result.errors.some(e => e.includes('description')));
  });

  it('fails for invalid name format (uppercase)', () => {
    const result = SkillParser.validateMetadata({ name: 'MySkill', description: 'desc' });
    assert.equal(result.valid, false);
    assert.ok(result.errors.some(e => e.includes('lowercase')));
  });

  it('fails for name with spaces', () => {
    const result = SkillParser.validateMetadata({ name: 'my skill', description: 'desc' });
    assert.equal(result.valid, false);
  });

  it('fails for description exceeding 500 chars', () => {
    const result = SkillParser.validateMetadata({ name: 'long-desc', description: 'x'.repeat(501) });
    assert.equal(result.valid, false);
    assert.ok(result.errors.some(e => e.includes('500')));
  });

  it('accepts description at exactly 500 chars', () => {
    const result = SkillParser.validateMetadata({ name: 'ok-desc', description: 'x'.repeat(500) });
    assert.ok(result.valid);
  });

  it('reports multiple errors simultaneously', () => {
    const result = SkillParser.validateMetadata({});
    assert.equal(result.valid, false);
    assert.ok(result.errors.length >= 2);
  });
});

// ── SkillParser.validateScript ───────────────────────────────────

describe('SkillParser.validateScript', () => {
  it('marks safe script as safe', () => {
    const result = SkillParser.validateScript('const x = 42; export default x;');
    assert.ok(result.safe);
    assert.equal(result.warnings.length, 0);
  });

  it('detects eval()', () => {
    const result = SkillParser.validateScript('eval("alert(1)")');
    assert.equal(result.safe, false);
    assert.ok(result.warnings.some(w => w.includes('eval')));
  });

  it('detects Function()', () => {
    const result = SkillParser.validateScript('new Function("return 1")');
    assert.equal(result.safe, false);
    assert.ok(result.warnings.some(w => w.includes('Function')));
  });

  it('detects document.cookie', () => {
    const result = SkillParser.validateScript('const c = document.cookie;');
    assert.equal(result.safe, false);
  });

  it('detects localStorage access', () => {
    const result = SkillParser.validateScript('localStorage.getItem("key")');
    assert.equal(result.safe, false);
  });

  it('detects dynamic import()', () => {
    const result = SkillParser.validateScript('import("evil-module")');
    assert.equal(result.safe, false);
  });

  it('detects XMLHttpRequest', () => {
    const result = SkillParser.validateScript('new XMLHttpRequest()');
    assert.equal(result.safe, false);
  });

  it('reports multiple warnings', () => {
    const result = SkillParser.validateScript('eval("x"); new Function("y"); document.cookie;');
    assert.equal(result.safe, false);
    assert.ok(result.warnings.length >= 3);
  });
});

// ── SkillParser.substituteArguments ──────────────────────────────

describe('SkillParser.substituteArguments', () => {
  it('replaces $ARGUMENTS with full argument string', () => {
    const result = SkillParser.substituteArguments('Review $ARGUMENTS', 'main.js utils.js');
    assert.equal(result, 'Review main.js utils.js');
  });

  it('replaces $ARGUMENTS[N] with indexed args', () => {
    const result = SkillParser.substituteArguments('File: $ARGUMENTS[0], Target: $ARGUMENTS[1]', 'src.js dest.js');
    assert.equal(result, 'File: src.js, Target: dest.js');
  });

  it('replaces $N shorthand (1-based)', () => {
    const result = SkillParser.substituteArguments('First: $1, Second: $2', 'alpha beta');
    assert.equal(result, 'First: alpha, Second: beta');
  });

  it('returns empty string for out-of-range index', () => {
    const result = SkillParser.substituteArguments('Missing: $ARGUMENTS[5]', 'only one');
    assert.equal(result, 'Missing: ');
  });

  it('does not substitute when no args provided', () => {
    const body = 'Keep $ARGUMENTS and $1 intact';
    const result = SkillParser.substituteArguments(body, '');
    assert.equal(result, body);
  });

  it('handles multiple occurrences of same placeholder', () => {
    const result = SkillParser.substituteArguments('$ARGUMENTS and $ARGUMENTS', 'hello');
    assert.equal(result, 'hello and hello');
  });
});

// ═══════════════════════════════════════════════════════════════════
// 2. SkillRegistry
// ═══════════════════════════════════════════════════════════════════

describe('SkillRegistry', () => {
  let registry;

  beforeEach(() => {
    localStorage.clear();
    registry = new SkillRegistry();
  });

  afterEach(() => {
    restoreOPFS();
  });

  it('constructs with default options', () => {
    assert.ok(registry);
    assert.equal(registry.skills.size, 0);
    assert.equal(registry.activeSkills.size, 0);
  });

  describe('discover', () => {
    it('discovers global skills', async () => {
      const root = mockOPFS({
        'my-skill': {
          'SKILL.md': '---\nname: my-skill\ndescription: A test skill\n---\nBody text',
        },
      });
      installMockOPFS(root);

      await registry.discover('ws-1');
      assert.equal(registry.skills.size, 1);
      assert.ok(registry.skills.has('my-skill'));
      assert.equal(registry.skills.get('my-skill').scope, 'global');
    });

    it('discovers workspace skills', async () => {
      const root = mockOPFS({}, {
        'ws-1': {
          'ws-skill': {
            'SKILL.md': '---\nname: ws-skill\ndescription: Workspace skill\n---\nBody',
          },
        },
      });
      installMockOPFS(root);

      await registry.discover('ws-1');
      assert.equal(registry.skills.size, 1);
      assert.ok(registry.skills.has('ws-skill'));
      assert.equal(registry.skills.get('ws-skill').scope, 'workspace');
    });

    it('workspace skills override global skills with same name', async () => {
      const root = mockOPFS(
        {
          'shared': {
            'SKILL.md': '---\nname: shared\ndescription: Global version\n---\nGlobal body',
          },
        },
        {
          'ws-1': {
            'shared': {
              'SKILL.md': '---\nname: shared\ndescription: Workspace version\n---\nWorkspace body',
            },
          },
        },
      );
      installMockOPFS(root);

      await registry.discover('ws-1');
      assert.equal(registry.skills.size, 1);
      const skill = registry.skills.get('shared');
      assert.equal(skill.scope, 'workspace');
      assert.equal(skill.description, 'Workspace version');
    });

    it('uses directory name when metadata name is missing', async () => {
      const root = mockOPFS({
        'dir-name-skill': {
          'SKILL.md': '---\ndescription: No name field\n---\nBody',
        },
      });
      installMockOPFS(root);

      await registry.discover('ws-1');
      assert.ok(registry.skills.has('dir-name-skill'));
    });

    it('handles empty skill directories gracefully', async () => {
      const root = mockOPFS({});
      installMockOPFS(root);

      await registry.discover('ws-1');
      assert.equal(registry.skills.size, 0);
    });
  });

  describe('activate / deactivate', () => {
    it('activates a discovered skill', async () => {
      const root = mockOPFS({
        'my-skill': {
          'SKILL.md': '---\nname: my-skill\ndescription: Test\n---\nDo the thing.',
        },
      });
      installMockOPFS(root);
      await registry.discover('ws-1');

      const activation = await registry.activate('my-skill');
      assert.ok(activation);
      assert.equal(activation.name, 'my-skill');
      assert.ok(activation.body.includes('Do the thing.'));
      assert.ok(registry.activeSkills.has('my-skill'));
    });

    it('returns null for unknown skill', async () => {
      const root = mockOPFS({});
      installMockOPFS(root);
      await registry.discover('ws-1');

      const result = await registry.activate('nonexistent');
      assert.equal(result, null);
    });

    it('re-activating with new args updates body', async () => {
      const root = mockOPFS({
        'arg-skill': {
          'SKILL.md': '---\nname: arg-skill\ndescription: Test\n---\nReview $ARGUMENTS',
        },
      });
      installMockOPFS(root);
      await registry.discover('ws-1');

      const first = await registry.activate('arg-skill', 'file1.js');
      assert.ok(first.body.includes('file1.js'));

      const second = await registry.activate('arg-skill', 'file2.js');
      assert.ok(second.body.includes('file2.js'));
    });

    it('deactivates an active skill', async () => {
      const root = mockOPFS({
        'my-skill': {
          'SKILL.md': '---\nname: my-skill\ndescription: Test\n---\nBody',
        },
      });
      installMockOPFS(root);
      await registry.discover('ws-1');
      await registry.activate('my-skill');

      registry.deactivate('my-skill');
      assert.equal(registry.activeSkills.has('my-skill'), false);
    });

    it('deactivating a non-active skill is a no-op', () => {
      // Should not throw
      registry.deactivate('not-active');
      assert.equal(registry.activeSkills.size, 0);
    });

    it('blocks activation of skills with unsafe body', async () => {
      const root = mockOPFS({
        'evil': {
          'SKILL.md': '---\nname: evil\ndescription: Bad skill\n---\neval("hack")',
        },
      });
      installMockOPFS(root);
      await registry.discover('ws-1');

      const result = await registry.activate('evil');
      assert.equal(result, null);
      assert.equal(registry.activeSkills.has('evil'), false);
    });
  });

  describe('setEnabled / isEnabled', () => {
    it('defaults to enabled', async () => {
      const root = mockOPFS({
        'my-skill': {
          'SKILL.md': '---\nname: my-skill\ndescription: Test\n---\nBody',
        },
      });
      installMockOPFS(root);
      await registry.discover('ws-1');

      assert.equal(registry.isEnabled('my-skill'), true);
    });

    it('can disable a skill', async () => {
      const root = mockOPFS({
        'my-skill': {
          'SKILL.md': '---\nname: my-skill\ndescription: Test\n---\nBody',
        },
      });
      installMockOPFS(root);
      await registry.discover('ws-1');

      registry.setEnabled('my-skill', false);
      assert.equal(registry.isEnabled('my-skill'), false);
    });

    it('returns undefined for unknown skill', () => {
      assert.equal(registry.isEnabled('unknown'), undefined);
    });
  });

  describe('persistEnabledState', () => {
    it('persists and is available after reload', async () => {
      const root = mockOPFS({
        's1': { 'SKILL.md': '---\nname: s1\ndescription: Skill 1\n---\nBody' },
      });
      installMockOPFS(root);
      await registry.discover('ws-1');

      registry.setEnabled('s1', false);
      registry.persistEnabledState('ws-1');

      // Create new registry and discover — should load persisted state
      const registry2 = new SkillRegistry();
      await registry2.discover('ws-1');
      assert.equal(registry2.isEnabled('s1'), false);
    });
  });

  describe('buildMetadataPrompt', () => {
    it('returns empty string when no skills', () => {
      assert.equal(registry.buildMetadataPrompt(), '');
    });

    it('includes enabled skill names and descriptions', async () => {
      const root = mockOPFS({
        'code-review': {
          'SKILL.md': '---\nname: code-review\ndescription: Review code\n---\nBody',
        },
      });
      installMockOPFS(root);
      await registry.discover('ws-1');

      const prompt = registry.buildMetadataPrompt();
      assert.ok(prompt.includes('code-review'));
      assert.ok(prompt.includes('Review code'));
      assert.ok(prompt.includes('<available-skills>'));
    });

    it('excludes disabled skills', async () => {
      const root = mockOPFS({
        'enabled-skill': {
          'SKILL.md': '---\nname: enabled-skill\ndescription: On\n---\nBody',
        },
        'disabled-skill': {
          'SKILL.md': '---\nname: disabled-skill\ndescription: Off\n---\nBody',
        },
      });
      installMockOPFS(root);
      await registry.discover('ws-1');
      registry.setEnabled('disabled-skill', false);

      const prompt = registry.buildMetadataPrompt();
      assert.ok(prompt.includes('enabled-skill'));
      assert.ok(!prompt.includes('disabled-skill'));
    });
  });

  describe('buildActivationPrompt', () => {
    it('returns empty string for non-active skill', () => {
      assert.equal(registry.buildActivationPrompt('not-active'), '');
    });

    it('returns prompt with skill body for active skill', async () => {
      const root = mockOPFS({
        'my-skill': {
          'SKILL.md': '---\nname: my-skill\ndescription: Test\n---\nDo the thing carefully.',
        },
      });
      installMockOPFS(root);
      await registry.discover('ws-1');
      await registry.activate('my-skill');

      const prompt = registry.buildActivationPrompt('my-skill');
      assert.ok(prompt.includes('Do the thing carefully.'));
      assert.ok(prompt.includes('<active-skill'));
      assert.ok(prompt.includes('my-skill'));
    });
  });

  describe('getSlashCommandNames', () => {
    it('returns names of enabled skills', async () => {
      const root = mockOPFS({
        'skill-a': { 'SKILL.md': '---\nname: skill-a\ndescription: A\n---\nBody' },
        'skill-b': { 'SKILL.md': '---\nname: skill-b\ndescription: B\n---\nBody' },
      });
      installMockOPFS(root);
      await registry.discover('ws-1');
      registry.setEnabled('skill-b', false);

      const names = registry.getSlashCommandNames();
      assert.ok(names.includes('skill-a'));
      assert.ok(!names.includes('skill-b'));
    });
  });
});

// ═══════════════════════════════════════════════════════════════════
// 3. ActivateSkillTool
// ═══════════════════════════════════════════════════════════════════

describe('ActivateSkillTool', () => {
  let registry;

  afterEach(() => {
    restoreOPFS();
  });

  it('has correct tool metadata', () => {
    registry = new SkillRegistry();
    const tool = new ActivateSkillTool(registry);
    assert.equal(tool.name, 'skill_activate');
    assert.equal(tool.permission, 'internal');
    assert.ok(tool.parameters.properties.name);
  });

  it('returns error for nonexistent skill', async () => {
    registry = new SkillRegistry();
    const root = mockOPFS({});
    installMockOPFS(root);
    await registry.discover('ws-1');

    const tool = new ActivateSkillTool(registry);
    const result = await tool.execute({ name: 'nonexistent' });
    assert.equal(result.success, false);
    assert.ok(result.error.includes('not found'));
  });

  it('activates a valid skill', async () => {
    registry = new SkillRegistry();
    const root = mockOPFS({
      'my-skill': {
        'SKILL.md': '---\nname: my-skill\ndescription: Test\n---\nBody text here.',
      },
    });
    installMockOPFS(root);
    await registry.discover('ws-1');

    let activatedName = null;
    const tool = new ActivateSkillTool(registry, (name) => { activatedName = name; });
    const result = await tool.execute({ name: 'my-skill' });
    assert.ok(result.success);
    assert.ok(result.output.includes('activated'));
    assert.equal(activatedName, 'my-skill');
  });

  it('lists available skills in error when not found', async () => {
    registry = new SkillRegistry();
    const root = mockOPFS({
      'real-skill': {
        'SKILL.md': '---\nname: real-skill\ndescription: Exists\n---\nBody',
      },
    });
    installMockOPFS(root);
    await registry.discover('ws-1');

    const tool = new ActivateSkillTool(registry);
    const result = await tool.execute({ name: 'fake' });
    assert.equal(result.success, false);
    assert.ok(result.error.includes('real-skill'));
  });

  it('returns error when skill has unsafe content', async () => {
    registry = new SkillRegistry();
    const root = mockOPFS({
      'bad-skill': {
        'SKILL.md': '---\nname: bad-skill\ndescription: Unsafe\n---\neval("pwned")',
      },
    });
    installMockOPFS(root);
    await registry.discover('ws-1');

    const tool = new ActivateSkillTool(registry);
    const result = await tool.execute({ name: 'bad-skill' });
    assert.equal(result.success, false);
    assert.ok(result.error.includes('could not be activated'));
  });
});

// ═══════════════════════════════════════════════════════════════════
// 4. DeactivateSkillTool
// ═══════════════════════════════════════════════════════════════════

describe('DeactivateSkillTool', () => {
  let registry;

  afterEach(() => {
    restoreOPFS();
  });

  it('has correct tool metadata', () => {
    registry = new SkillRegistry();
    const tool = new DeactivateSkillTool(registry);
    assert.equal(tool.name, 'skill_deactivate');
    assert.equal(tool.permission, 'internal');
    assert.ok(tool.parameters.properties.name);
  });

  it('deactivates an active skill', async () => {
    registry = new SkillRegistry();
    const root = mockOPFS({
      'my-skill': {
        'SKILL.md': '---\nname: my-skill\ndescription: Test\n---\nBody',
      },
    });
    installMockOPFS(root);
    await registry.discover('ws-1');
    await registry.activate('my-skill');

    let deactivatedName = null;
    const tool = new DeactivateSkillTool(registry, (name) => { deactivatedName = name; });
    const result = await tool.execute({ name: 'my-skill' });
    assert.ok(result.success);
    assert.ok(result.output.includes('deactivated'));
    assert.equal(deactivatedName, 'my-skill');
    assert.equal(registry.activeSkills.has('my-skill'), false);
  });

  it('returns error for non-active skill', async () => {
    registry = new SkillRegistry();
    const tool = new DeactivateSkillTool(registry);
    const result = await tool.execute({ name: 'not-active' });
    assert.equal(result.success, false);
    assert.ok(result.error.includes('not currently active'));
  });
});

// ═══════════════════════════════════════════════════════════════════
// 5. SkillStorage (with mock OPFS)
// ═══════════════════════════════════════════════════════════════════

describe('SkillStorage', () => {
  afterEach(() => {
    restoreOPFS();
  });

  describe('listSkillDirs', () => {
    it('lists global skill directories', async () => {
      const root = mockOPFS({
        'skill-a': { 'SKILL.md': '---\nname: skill-a\n---\nBody' },
        'skill-b': { 'SKILL.md': '---\nname: skill-b\n---\nBody' },
      });
      installMockOPFS(root);

      const names = await SkillStorage.listSkillDirs('global');
      assert.ok(names.includes('skill-a'));
      assert.ok(names.includes('skill-b'));
      assert.equal(names.length, 2);
    });

    it('lists workspace skill directories', async () => {
      const root = mockOPFS({}, {
        'ws-1': {
          'ws-skill': { 'SKILL.md': '---\nname: ws-skill\n---\nBody' },
        },
      });
      installMockOPFS(root);

      const names = await SkillStorage.listSkillDirs('workspace', 'ws-1');
      assert.deepStrictEqual(names, ['ws-skill']);
    });

    it('returns empty array when directory does not exist', async () => {
      const root = createDirHandle({});
      installMockOPFS(root);

      const names = await SkillStorage.listSkillDirs('global');
      assert.deepStrictEqual(names, []);
    });
  });

  describe('readFile', () => {
    it('reads a top-level file', async () => {
      const dir = createDirHandle({ 'SKILL.md': 'Hello world' });
      const content = await SkillStorage.readFile(dir, 'SKILL.md');
      assert.equal(content, 'Hello world');
    });

    it('reads a nested file', async () => {
      const dir = createDirHandle({
        scripts: createDirHandle({ 'validate.js': 'export const ok = true;' }),
      });
      const content = await SkillStorage.readFile(dir, 'scripts/validate.js');
      assert.equal(content, 'export const ok = true;');
    });

    it('throws for missing file', async () => {
      const dir = createDirHandle({});
      await assert.rejects(() => SkillStorage.readFile(dir, 'missing.txt'));
    });
  });

  describe('listSubdir', () => {
    it('lists files in a subdirectory', async () => {
      const dir = createDirHandle({
        scripts: createDirHandle({
          'a.js': 'code a',
          'b.js': 'code b',
        }),
      });
      const names = await SkillStorage.listSubdir(dir, 'scripts');
      assert.ok(names.includes('a.js'));
      assert.ok(names.includes('b.js'));
    });

    it('returns empty array for missing subdirectory', async () => {
      const dir = createDirHandle({});
      const names = await SkillStorage.listSubdir(dir, 'scripts');
      assert.deepStrictEqual(names, []);
    });
  });

  describe('writeSkill', () => {
    it('writes files to global scope', async () => {
      const root = mockOPFS({});
      installMockOPFS(root);

      const files = new Map([
        ['SKILL.md', '---\nname: written\n---\nBody'],
      ]);
      await SkillStorage.writeSkill('global', null, 'written', files);

      // Verify we can list and read it back
      const names = await SkillStorage.listSkillDirs('global');
      assert.ok(names.includes('written'));
    });

    it('writes files to workspace scope', async () => {
      const root = mockOPFS({}, { 'ws-1': {} });
      installMockOPFS(root);

      const files = new Map([
        ['SKILL.md', '---\nname: ws-written\n---\nBody'],
      ]);
      await SkillStorage.writeSkill('workspace', 'ws-1', 'ws-written', files);

      const names = await SkillStorage.listSkillDirs('workspace', 'ws-1');
      assert.ok(names.includes('ws-written'));
    });
  });

  describe('deleteSkill', () => {
    it('removes a global skill', async () => {
      const root = mockOPFS({
        'to-delete': { 'SKILL.md': '---\nname: to-delete\n---\nBody' },
      });
      installMockOPFS(root);

      let names = await SkillStorage.listSkillDirs('global');
      assert.ok(names.includes('to-delete'));

      await SkillStorage.deleteSkill('global', null, 'to-delete');
      names = await SkillStorage.listSkillDirs('global');
      assert.ok(!names.includes('to-delete'));
    });

    it('does not throw when deleting nonexistent skill', async () => {
      const root = mockOPFS({});
      installMockOPFS(root);

      // Should not throw
      await SkillStorage.deleteSkill('global', null, 'nonexistent');
    });
  });
});

// ═══════════════════════════════════════════════════════════════════
// 6. Utility exports
// ═══════════════════════════════════════════════════════════════════

describe('semverCompare', () => {
  it('equal versions', () => assert.equal(semverCompare('1.2.3', '1.2.3'), 0));
  it('greater major', () => assert.equal(semverCompare('2.0.0', '1.9.9'), 1));
  it('lesser minor', () => assert.equal(semverCompare('1.0.0', '1.1.0'), -1));
  it('partial versions', () => assert.equal(semverCompare('1.0', '1.0.0'), 0));
  it('handles null/undefined', () => assert.equal(semverCompare(null, '0.0.0'), 0));
});

describe('semverGt', () => {
  it('returns true when a > b', () => assert.ok(semverGt('2.0.0', '1.0.0')));
  it('returns false when a == b', () => assert.equal(semverGt('1.0.0', '1.0.0'), false));
  it('returns false when a < b', () => assert.equal(semverGt('0.9.0', '1.0.0'), false));
});

describe('validateRequirements', () => {
  it('satisfied when no requirements', () => {
    const result = validateRequirements({});
    assert.ok(result.satisfied);
  });

  it('satisfied when all tools present', () => {
    const result = validateRequirements(
      { requires: { tools: ['fetch', 'fs_read'] } },
      { tools: ['fetch', 'fs_read', 'fs_write'] },
    );
    assert.ok(result.satisfied);
  });

  it('unsatisfied when tools are missing', () => {
    const result = validateRequirements(
      { requires: { tools: ['fetch', 'special_tool'] } },
      { tools: ['fetch'] },
    );
    assert.equal(result.satisfied, false);
    assert.deepStrictEqual(result.missing.tools, ['special_tool']);
  });

  it('checks permissions', () => {
    const result = validateRequirements(
      { requires: { permissions: ['network'] } },
      { permissions: [] },
    );
    assert.equal(result.satisfied, false);
    assert.deepStrictEqual(result.missing.permissions, ['network']);
  });
});

describe('computeSkillHash / verifySkillIntegrity', () => {
  it('produces consistent hash', () => {
    const hash1 = computeSkillHash('hello world');
    const hash2 = computeSkillHash('hello world');
    assert.equal(hash1, hash2);
  });

  it('produces different hashes for different content', () => {
    assert.notEqual(computeSkillHash('aaa'), computeSkillHash('bbb'));
  });

  it('returns 8-char hex string', () => {
    const hash = computeSkillHash('test');
    assert.match(hash, /^[0-9a-f]{8}$/);
  });

  it('verifySkillIntegrity returns true for matching hash', () => {
    const content = 'some skill content';
    const hash = computeSkillHash(content);
    assert.ok(verifySkillIntegrity(content, hash));
  });

  it('verifySkillIntegrity returns false for wrong hash', () => {
    assert.equal(verifySkillIntegrity('content', '00000000'), false);
  });
});

describe('resolveDependencies', () => {
  it('resolved when no requirements', () => {
    const result = resolveDependencies({});
    assert.ok(result.resolved);
    assert.deepStrictEqual(result.missing, []);
  });

  it('resolved when all skills and tools available', () => {
    const result = resolveDependencies(
      { requires: { skills: ['helper'], tools: ['fetch'] } },
      { skills: ['helper'], tools: ['fetch'] },
    );
    assert.ok(result.resolved);
  });

  it('unresolved when skill dependency missing', () => {
    const result = resolveDependencies(
      { requires: { skills: ['missing-skill'] } },
      { skills: [] },
    );
    assert.equal(result.resolved, false);
    assert.ok(result.missing.includes('missing-skill'));
  });

  it('unresolved when tool dependency missing', () => {
    const result = resolveDependencies(
      { requires: { tools: ['missing-tool'] } },
      { tools: [] },
    );
    assert.equal(result.resolved, false);
    assert.ok(result.missing.includes('missing-tool'));
  });
});
