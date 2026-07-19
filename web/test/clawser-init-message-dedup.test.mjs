// Run with: node --import ./web/test/_setup-globals.mjs --test web/test/clawser-init-message-dedup.test.mjs
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

const indexHtmlPath = fileURLToPath(new URL('../index.html', import.meta.url))
const lifecyclePath = fileURLToPath(new URL('../clawser-workspace-lifecycle.js', import.meta.url))

describe('"Initializing agent..." message (regression: used to render twice)', () => {
  it('index.html still seeds #messages with exactly one static placeholder', async () => {
    // This static placeholder is intentional — it's what's visible before any
    // JS has run. If this assumption changes (placeholder removed, or moved
    // out of #messages), the fix in initWorkspace() may need to change too.
    const html = await readFile(indexHtmlPath, 'utf8')
    const matches = html.match(/Initializing agent\.\.\./g) || []
    assert.equal(matches.length, 1,
      'expected exactly one "Initializing agent..." placeholder in index.html')
  })

  it('initWorkspace() clears the chat pane before appending its own "Initializing agent..." message', async () => {
    const src = await readFile(lifecyclePath, 'utf8')

    const fnStart = src.indexOf('export async function initWorkspace')
    assert.ok(fnStart >= 0, 'initWorkspace() not found')
    const nextFnStart = src.indexOf('\nexport async function', fnStart + 1)
    const fnBody = src.slice(fnStart, nextFnStart > -1 ? nextFnStart : undefined)

    const resetIdx = fnBody.indexOf('resetChatUI()')
    const addMsgIdx = fnBody.indexOf("addMsg('system', 'Initializing agent...')")

    assert.ok(resetIdx >= 0, 'initWorkspace() must call resetChatUI() to clear the static index.html placeholder')
    assert.ok(addMsgIdx >= 0, 'initWorkspace() must still append its own "Initializing agent..." message')
    assert.ok(resetIdx < addMsgIdx,
      'resetChatUI() must run BEFORE addMsg(\'system\', \'Initializing agent...\') — otherwise the ' +
      'dynamic message is appended after the static HTML placeholder instead of replacing it, and the ' +
      'line renders twice')
  })
})
