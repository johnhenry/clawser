// clawser-workspace-name.test.mjs

import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

import {
  sanitizeWorkspaceName,
  buildSanitizedNameMap,
  activeSanitizedName,
  wsIdForSanitizedName,
} from '../clawser-workspace-name.mjs'

describe('sanitizeWorkspaceName', () => {
  it('lowercases and replaces spaces with dashes', () => {
    assert.equal(sanitizeWorkspaceName('My Workspace'), 'my-workspace')
  })
  it('strips accents via NFKD', () => {
    assert.equal(sanitizeWorkspaceName('Café'), 'cafe')
    assert.equal(sanitizeWorkspaceName('Crème Brûlée'), 'creme-brulee')
  })
  it('drops non-ASCII', () => {
    assert.equal(sanitizeWorkspaceName('hello 你好 world'), 'hello-world')
  })
  it('collapses runs of separators', () => {
    assert.equal(sanitizeWorkspaceName('foo   bar___baz'), 'foo-bar_baz')
  })
  it('trims leading/trailing punctuation', () => {
    assert.equal(sanitizeWorkspaceName('  --foo--  '), 'foo')
  })
  it('falls back when result is empty', () => {
    assert.equal(sanitizeWorkspaceName('!!!'), 'workspace')
    assert.equal(sanitizeWorkspaceName(''), 'workspace')
  })
  it('rejects reserved names', () => {
    for (const r of ['proc', 'etc', 'dev', 'tmp', 'home', 'sys']) {
      assert.equal(sanitizeWorkspaceName(r), 'workspace', `${r} must be rejected`)
    }
  })
  it('rejects . and ..', () => {
    assert.equal(sanitizeWorkspaceName('.'), 'workspace')
    assert.equal(sanitizeWorkspaceName('..'), 'workspace')
  })
  it('caps at 64 chars', () => {
    const s = sanitizeWorkspaceName('a'.repeat(200))
    assert.ok(s.length <= 64)
  })
  it('returns workspace fallback on non-string input', () => {
    assert.equal(sanitizeWorkspaceName(null), 'workspace')
    assert.equal(sanitizeWorkspaceName(undefined), 'workspace')
    assert.equal(sanitizeWorkspaceName(42), 'workspace')
  })
})

describe('buildSanitizedNameMap', () => {
  it('default workspace claims the bare "default" name', () => {
    const map = buildSanitizedNameMap([
      { id: 'ws_a', name: 'Project A' },
      { id: 'default', name: 'workspace' },
    ])
    assert.equal(map.get('default'), 'default')
    assert.equal(map.get('ws_a'), 'project-a')
  })

  it('non-default workspaces named "default" get a suffix', () => {
    const map = buildSanitizedNameMap([
      { id: 'default', name: 'workspace' },
      { id: 'ws_a', name: 'default' },
    ])
    assert.equal(map.get('default'), 'default')
    assert.equal(map.get('ws_a'), 'default-2')
  })

  it('collisions get numeric suffixes in declaration order', () => {
    const map = buildSanitizedNameMap([
      { id: 'default', name: 'workspace' },
      { id: 'ws_a', name: 'My Project' },
      { id: 'ws_b', name: 'my project' },     // sanitizes the same
      { id: 'ws_c', name: 'My  Project ' },   // also sanitizes the same
    ])
    assert.equal(map.get('ws_a'), 'my-project')
    assert.equal(map.get('ws_b'), 'my-project-2')
    assert.equal(map.get('ws_c'), 'my-project-3')
  })

  it('handles empty input', () => {
    assert.equal(buildSanitizedNameMap([]).size, 0)
    assert.equal(buildSanitizedNameMap(null).size, 0)
  })

  it('reserved names normalize to fallback then collide deterministically', () => {
    const map = buildSanitizedNameMap([
      { id: 'default', name: 'workspace' },
      { id: 'ws_a', name: 'proc' },
      { id: 'ws_b', name: 'etc' },
    ])
    // Both ws_a and ws_b sanitize to 'workspace'; with `default` not
    // claiming workspace, they get the bare and -2 suffixes.
    assert.equal(map.get('ws_a'), 'workspace')
    assert.equal(map.get('ws_b'), 'workspace-2')
  })
})

describe('activeSanitizedName', () => {
  it('returns the sanitized name for the active id', () => {
    const wsList = [
      { id: 'default', name: 'workspace' },
      { id: 'ws_a', name: 'Side Project' },
    ]
    assert.equal(activeSanitizedName(wsList, 'default'), 'default')
    assert.equal(activeSanitizedName(wsList, 'ws_a'), 'side-project')
  })
  it('returns null for unknown ids', () => {
    assert.equal(activeSanitizedName([], 'ws_nope'), null)
  })
})

describe('wsIdForSanitizedName', () => {
  it('resolves a sanitized name back to its wsId', () => {
    const list = [
      { id: 'default', name: 'workspace' },
      { id: 'ws_a', name: 'My Project' },
    ]
    assert.equal(wsIdForSanitizedName('default', list), 'default')
    assert.equal(wsIdForSanitizedName('my-project', list), 'ws_a')
    assert.equal(wsIdForSanitizedName('does-not-exist', list), null)
  })
})
