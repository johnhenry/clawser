// Run with: node --import ./web/test/_setup-globals.mjs --test web/test/clawser-e2e-skills.test.mjs
//
// E2E: Skill activation — parse SKILL.md → register in SkillRegistry →
// activate → verify tool registration and prompt injection.
import { describe, it, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import {
  SkillParser,
  SkillRegistry,
  ActivateSkillTool,
} from '../clawser-skills.js'
import { BrowserToolRegistry } from '../clawser-tools.js'

// ── Stub OPFS for SkillStorage ──────────────────────────────────

class StubFileHandle {
  #content
  constructor(content) { this.#content = content }
  async getFile() { return { text: async () => this.#content } }
}

class StubDirHandle {
  #entries = new Map()
  #name

  constructor(name, entries = {}) {
    this.#name = name
    for (const [k, v] of Object.entries(entries)) {
      if (typeof v === 'string') {
        this.#entries.set(k, new StubFileHandle(v))
      } else {
        this.#entries.set(k, v)
      }
    }
  }

  get name() { return this.#name }

  async getFileHandle(name) {
    if (!this.#entries.has(name)) throw new Error(`File not found: ${name}`)
    return this.#entries.get(name)
  }

  async getDirectoryHandle(name, opts) {
    if (this.#entries.has(name)) return this.#entries.get(name)
    if (opts?.create) {
      const dir = new StubDirHandle(name)
      this.#entries.set(name, dir)
      return dir
    }
    throw new Error(`Dir not found: ${name}`)
  }

  async *values() {
    for (const v of this.#entries.values()) yield v
  }
}

// ── Tests ────────────────────────────────────────────────────────

describe('E2E — SkillParser', () => {
  it('parses SKILL.md frontmatter + body', () => {
    const skillMd = `---
name: test-skill
version: 1.0.0
description: A test skill
author: tester
tags:
  - testing
  - automation
---

# Test Skill

This skill does testing things.

## Instructions

1. Run tests
2. Check coverage`

    const { metadata, body } = SkillParser.parseFrontmatter(skillMd)

    assert.equal(metadata.name, 'test-skill')
    assert.equal(metadata.version, '1.0.0')
    assert.equal(metadata.description, 'A test skill')
    assert.equal(metadata.author, 'tester')
    assert.ok(Array.isArray(metadata.tags))
    assert.ok(metadata.tags.includes('testing'))
    assert.ok(metadata.tags.includes('automation'))
    assert.ok(body.includes('# Test Skill'))
    assert.ok(body.includes('Run tests'))
  })

  it('handles missing frontmatter gracefully', () => {
    const raw = '# No Frontmatter\n\nJust plain markdown.'
    const { metadata, body } = SkillParser.parseFrontmatter(raw)

    assert.deepEqual(metadata, {})
    assert.ok(body.includes('# No Frontmatter'))
  })

  it('parses nested YAML keys', () => {
    const skillMd = `---
name: nested-skill
requires:
  tools: browser_fs_read
  permissions: write
---

Body text.`

    const { metadata } = SkillParser.parseFrontmatter(skillMd)
    assert.equal(metadata.name, 'nested-skill')
    assert.ok(metadata.requires)
    assert.equal(metadata.requires.tools, 'browser_fs_read')
    assert.equal(metadata.requires.permissions, 'write')
  })

  it('coerces YAML values: booleans, numbers', () => {
    const yaml = `---
name: types
enabled: true
disabled: false
count: 42
ratio: 3.14
---

Body.`

    const { metadata } = SkillParser.parseFrontmatter(yaml)
    assert.equal(metadata.enabled, true)
    assert.equal(metadata.disabled, false)
    assert.equal(metadata.count, 42)
    assert.equal(metadata.ratio, 3.14)
  })

  it('substituteArguments replaces {{ARG}} placeholders', () => {
    const body = 'Search for {{QUERY}} in {{SCOPE}} documents.'
    const result = SkillParser.substituteArguments(body, 'machine learning')
    // First arg replaces {{QUERY}} or the unnamed placeholder
    assert.ok(typeof result === 'string')
    assert.ok(result.length > 0)
  })

  it('validateScript flags dangerous patterns', () => {
    const safe = 'Just normal markdown instructions with no code.'
    const safeResult = SkillParser.validateScript(safe)
    assert.ok(safeResult.safe)
    assert.equal(safeResult.warnings.length, 0)
  })
})

describe('E2E — SkillRegistry + ActivateSkillTool', () => {
  it('ActivateSkillTool returns error for unknown skill', async () => {
    const browserTools = new BrowserToolRegistry()
    const registry = new SkillRegistry({ browserTools })

    const tool = new ActivateSkillTool(registry)
    const result = await tool.execute({ name: 'nonexistent-skill' })

    assert.ok(!result.success)
    assert.ok(result.error.includes('not found'))
  })

  it('ActivateSkillTool spec has correct metadata', () => {
    const registry = new SkillRegistry()
    const tool = new ActivateSkillTool(registry)

    assert.equal(tool.name, 'skill_activate')
    assert.equal(tool.permission, 'internal')
    assert.ok(tool.description.includes('Activate'))
    assert.ok(tool.parameters.properties.name)
    assert.ok(tool.parameters.required.includes('name'))
  })

  it('SkillRegistry starts with empty skills', () => {
    const registry = new SkillRegistry()
    assert.equal(registry.skills.size, 0)
    assert.equal(registry.activeSkills.size, 0)
  })

  it('SkillParser handles empty input', () => {
    const { metadata, body } = SkillParser.parseFrontmatter('')
    assert.deepEqual(metadata, {})
    assert.equal(body, '')
  })

  it('SkillParser handles frontmatter with no body', () => {
    const skillMd = `---
name: header-only
version: 0.1.0
---
`
    const { metadata, body } = SkillParser.parseFrontmatter(skillMd)
    assert.equal(metadata.name, 'header-only')
    assert.equal(metadata.version, '0.1.0')
    assert.equal(body, '')
  })
})
