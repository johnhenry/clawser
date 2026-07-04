// clawser-cli-max-tokens.test.mjs — `clawser config set max_tokens` actually wires the value

import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

import { registerClawserCli } from '../clawser-cli.js'

class Reg {
  constructor() { this.cmds = new Map() }
  register(name, fn) { this.cmds.set(name, fn) }
  get(name) { return this.cmds.get(name) }
}

function makeAgent() {
  let mt = null
  const persistCalls = []
  return {
    setDefaultMaxTokens(n) { if (n == null || n === 0) mt = null; else mt = Math.floor(n) },
    getDefaultMaxTokens() { return mt },
    persistConfig() { persistCalls.push(mt) },
    setModel() {}, getModel() { return null }, setSystemPrompt() {},
    getState() { return {} },
    _persistCalls: persistCalls,
  }
}

const exec = (reg, args) => reg.get('clawser')({ args, state: { aliases: new Map() }, fs: null, env: new Map(), stdin: '' })

describe('clawser config set max_tokens — actually wires the value', () => {
  it('valid integer is set on the agent and persisted', async () => {
    const reg = new Reg()
    const agent = makeAgent()
    registerClawserCli(reg, () => agent, () => null)
    const r = await exec(reg, ['config', 'set', 'max_tokens', '4096'])
    assert.equal(r.exitCode, 0)
    assert.match(r.stdout, /max_tokens set to: 4096/)
    assert.equal(agent.getDefaultMaxTokens(), 4096)
    assert.deepEqual(agent._persistCalls, [4096])
  })

  it('alias --max-tokens (with dash) is accepted', async () => {
    const reg = new Reg()
    const agent = makeAgent()
    registerClawserCli(reg, () => agent, () => null)
    const r = await exec(reg, ['config', 'set', 'max-tokens', '2048'])
    assert.equal(r.exitCode, 0)
    assert.equal(agent.getDefaultMaxTokens(), 2048)
  })

  it('zero or negative is rejected with exit 1', async () => {
    const reg = new Reg()
    const agent = makeAgent()
    registerClawserCli(reg, () => agent, () => null)
    const r = await exec(reg, ['config', 'set', 'max_tokens', '0'])
    assert.equal(r.exitCode, 1)
    assert.match(r.stderr, /Invalid/)
    assert.equal(agent.getDefaultMaxTokens(), null)
  })

  it('non-integer is rejected', async () => {
    const reg = new Reg()
    const agent = makeAgent()
    registerClawserCli(reg, () => agent, () => null)
    const r = await exec(reg, ['config', 'set', 'max_tokens', 'lots'])
    assert.equal(r.exitCode, 1)
  })

  it('legacy agent without setDefaultMaxTokens still echoes successfully', async () => {
    const reg = new Reg()
    const agent = { setModel() {}, setSystemPrompt() {}, getModel() { return null }, getState() { return {} } }
    registerClawserCli(reg, () => agent, () => null)
    const r = await exec(reg, ['config', 'set', 'max_tokens', '1024'])
    // Agent doesn't support it — exit 0 still (matches the old "echo only" semantic for legacy)
    assert.equal(r.exitCode, 0)
  })
})
