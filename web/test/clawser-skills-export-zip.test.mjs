// Run with: node --import ./web/test/_setup-globals.mjs --test web/test/clawser-skills-export-zip.test.mjs
import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { SkillStorage } from '../clawser-skills.js';

// ── In-memory OPFS-like directory handle stubs ──────────────────

/** Minimal FileSystemFileHandle stub. */
function createFileHandle(content) {
  return {
    kind: 'file',
    getFile() {
      return { text: async () => content, arrayBuffer: async () => new TextEncoder().encode(content).buffer };
    },
  };
}

/** Minimal FileSystemDirectoryHandle stub with async iteration. */
function createDirHandle(entries = {}) {
  const dirs = {};
  const files = {};

  for (const [name, value] of Object.entries(entries)) {
    if (typeof value === 'string') {
      files[name] = createFileHandle(value);
    } else {
      dirs[name] = value;
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
        files[name] = {
          kind: 'file',
          getFile() { return { text: async () => content }; },
          async createWritable() {
            return {
              async write(data) { content = data; },
              async close() {},
            };
          },
        };
        return files[name];
      }
      throw new DOMException(`Not found: ${name}`, 'NotFoundError');
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

// ── SkillStorage.exportToZip ─────────────────────────────────────

describe('SkillStorage.exportToZip', () => {
  it('is a static method', () => {
    assert.equal(typeof SkillStorage.exportToZip, 'function');
  });

  it('returns a Blob with application/zip type', async () => {
    const dir = createDirHandle({
      'SKILL.md': '---\nname: test\n---\nBody',
    });

    const blob = await SkillStorage.exportToZip(dir);
    assert.ok(blob instanceof Blob, 'should return a Blob');
    assert.equal(blob.type, 'application/zip');
  });

  it('produces a zip that can be round-tripped through importFromZip', async () => {
    const dir = createDirHandle({
      'SKILL.md': '---\nname: roundtrip\ndescription: A roundtrip test\n---\nHello world',
    });

    const blob = await SkillStorage.exportToZip(dir);

    // Import the exported zip
    const files = await SkillStorage.importFromZip(blob);

    assert.ok(files.has('SKILL.md'), 'should contain SKILL.md');
    assert.ok(files.get('SKILL.md').includes('roundtrip'), 'SKILL.md content should contain skill name');
    assert.ok(files.get('SKILL.md').includes('Hello world'), 'SKILL.md content should contain body');
  });

  it('handles nested directories (scripts/)', async () => {
    const scriptsDir = createDirHandle({
      'validate.js': 'export function validate() { return true; }',
    });

    const dir = createDirHandle({
      'SKILL.md': '---\nname: nested\n---\nBody',
    });
    // Inject nested dir manually since createDirHandle takes flat entries
    Object.defineProperty(dir, Symbol.asyncIterator, {
      value: async function* () {
        yield ['SKILL.md', createFileHandle('---\nname: nested\n---\nBody')];
        yield ['scripts', scriptsDir];
      },
    });

    const blob = await SkillStorage.exportToZip(dir);
    const files = await SkillStorage.importFromZip(blob);

    assert.ok(files.has('SKILL.md'), 'should contain SKILL.md');
    assert.ok(files.has('scripts/validate.js'), 'should contain nested file');
    assert.ok(files.get('scripts/validate.js').includes('validate'), 'nested file content should be preserved');
  });

  it('handles empty directory', async () => {
    const dir = createDirHandle({});
    const blob = await SkillStorage.exportToZip(dir);
    assert.ok(blob instanceof Blob, 'should return a Blob even for empty dir');
  });
});

// ── SkillStorage.exportZip (high-level scope-based) ──────────────

describe('SkillStorage.exportZip', () => {
  it('is a static method', () => {
    assert.equal(typeof SkillStorage.exportZip, 'function');
  });

  it('returns a Blob for global scope', async () => {
    // Mock navigator.storage.getDirectory to return a stub
    const skillDir = createDirHandle({
      'SKILL.md': '---\nname: global-skill\n---\nGlobal body',
    });

    const clawserSkillsDir = createDirHandle();
    // Add skill subdir
    Object.defineProperty(clawserSkillsDir, Symbol.asyncIterator, {
      value: async function* () {
        yield ['global-skill', skillDir];
      },
    });

    const root = createDirHandle();
    root.getDirectoryHandle = async (name) => {
      if (name === 'clawser_skills') return clawserSkillsDir;
      throw new Error('unexpected');
    };

    const origGetDir = navigator.storage.getDirectory;
    navigator.storage.getDirectory = async () => root;

    try {
      const blob = await SkillStorage.exportZip('global');
      assert.ok(blob instanceof Blob, 'should return a Blob');
      assert.ok(blob.size > 0, 'blob should not be empty');
    } finally {
      navigator.storage.getDirectory = origGetDir;
    }
  });

  it('returns a Blob for workspace scope', async () => {
    const skillDir = createDirHandle({
      'SKILL.md': '---\nname: ws-skill\n---\nWorkspace body',
    });

    const wsSkillsDir = createDirHandle();
    Object.defineProperty(wsSkillsDir, Symbol.asyncIterator, {
      value: async function* () {
        yield ['ws-skill', skillDir];
      },
    });

    const wsDir = createDirHandle();
    wsDir.getDirectoryHandle = async (name) => {
      if (name === '.skills') return wsSkillsDir;
      throw new Error('unexpected');
    };

    const workspacesDir = createDirHandle();
    workspacesDir.getDirectoryHandle = async (name) => {
      if (name === 'test-ws') return wsDir;
      throw new Error('unexpected');
    };

    const root = createDirHandle();
    root.getDirectoryHandle = async (name) => {
      if (name === 'clawser_workspaces') return workspacesDir;
      throw new Error('unexpected');
    };

    const origGetDir = navigator.storage.getDirectory;
    navigator.storage.getDirectory = async () => root;

    try {
      const blob = await SkillStorage.exportZip('workspace', 'test-ws');
      assert.ok(blob instanceof Blob, 'should return a Blob');
      assert.ok(blob.size > 0, 'blob should not be empty');
    } finally {
      navigator.storage.getDirectory = origGetDir;
    }
  });

  it('round-trips: export then import preserves skill files', async () => {
    const skillContent = '---\nname: trip\ndescription: Round trip\n---\nTrip body';
    const skillDir = createDirHandle({
      'SKILL.md': skillContent,
    });

    const skillsContainer = createDirHandle();
    Object.defineProperty(skillsContainer, Symbol.asyncIterator, {
      value: async function* () {
        yield ['trip', skillDir];
      },
    });

    const root = createDirHandle();
    root.getDirectoryHandle = async (name) => {
      if (name === 'clawser_skills') return skillsContainer;
      throw new Error('unexpected');
    };

    const origGetDir = navigator.storage.getDirectory;
    navigator.storage.getDirectory = async () => root;

    try {
      const blob = await SkillStorage.exportZip('global');
      const files = await SkillStorage.importFromZip(blob);

      // The zip contains skill dirs, so the path should be trip/SKILL.md
      // After import normalization (strips common prefix), it may be just SKILL.md
      const hasSkillMd = files.has('SKILL.md') || files.has('trip/SKILL.md');
      assert.ok(hasSkillMd, 'should contain the SKILL.md file');
    } finally {
      navigator.storage.getDirectory = origGetDir;
    }
  });
});
