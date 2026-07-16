// Run with: node --import ./web/test/_setup-globals.mjs --test web/test/clawser-theme-css.test.mjs
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

const cssPath = fileURLToPath(new URL('../clawser.css', import.meta.url))

describe('theme CSS', () => {
  it('defines --msg-user-bg and --msg-agent-bg in the default (dark) :root', async () => {
    const css = await readFile(cssPath, 'utf8')
    const rootBlock = css.match(/^:root\s*\{[^}]*\}/m)?.[0] ?? ''
    assert.match(rootBlock, /--msg-user-bg:\s*#[0-9a-fA-F]{3,6}/)
    assert.match(rootBlock, /--msg-agent-bg:\s*#[0-9a-fA-F]{3,6}/)
  })

  it('overrides --msg-user-bg and --msg-agent-bg in both light-theme contexts', async () => {
    const css = await readFile(cssPath, 'utf8')

    const mediaBlock = css.match(/@media \(prefers-color-scheme: light\)\s*\{[\s\S]*?\n\}/)?.[0] ?? ''
    assert.match(mediaBlock, /--msg-user-bg:\s*#[0-9a-fA-F]{3,6}/,
      'prefers-color-scheme:light block must override --msg-user-bg')
    assert.match(mediaBlock, /--msg-agent-bg:\s*#[0-9a-fA-F]{3,6}/,
      'prefers-color-scheme:light block must override --msg-agent-bg')

    const classBlock = css.match(/:root\.theme-light\s*\{[^}]*\}/)?.[0] ?? ''
    assert.match(classBlock, /--msg-user-bg:\s*#[0-9a-fA-F]{3,6}/,
      ':root.theme-light block must override --msg-user-bg')
    assert.match(classBlock, /--msg-agent-bg:\s*#[0-9a-fA-F]{3,6}/,
      ':root.theme-light block must override --msg-agent-bg')
  })

  it('.msg.user and .msg.agent use theme variables, not hardcoded hex colors', async () => {
    const css = await readFile(cssPath, 'utf8')
    const userRule = css.match(/\.msg\.user\s*\{[^}]*\}/)?.[0] ?? ''
    const agentRule = css.match(/\.msg\.agent\s*\{[^}]*\}/)?.[0] ?? ''

    assert.match(userRule, /background:\s*var\(--msg-user-bg\)/,
      '.msg.user must use var(--msg-user-bg) so it responds to the light theme')
    assert.match(agentRule, /background:\s*var\(--msg-agent-bg\)/,
      '.msg.agent must use var(--msg-agent-bg) so it responds to the light theme')

    assert.doesNotMatch(userRule, /background:\s*#[0-9a-fA-F]{3,6}/,
      '.msg.user must not hardcode a background color')
    assert.doesNotMatch(agentRule, /background:\s*#[0-9a-fA-F]{3,6}/,
      '.msg.agent must not hardcode a background color')
  })
})
