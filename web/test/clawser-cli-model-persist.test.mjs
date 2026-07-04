// clawser-cli-model-persist.test.mjs
// Regression for the 2026-05-04 issue: `clawser model X` and
// `clawser config set model X` were calling agent.setModel() but
// never persistConfig(), so the change vanished on reload.

import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

// We test cmdModel / cmdConfig indirectly via registerClawserCli:
import { registerClawserCli } from '../clawser-cli.js'

class CommandRegistry {
  constructor() { this.cmds = new Map() }
  register(name, fn, _meta) { this.cmds.set(name, fn) }
  get(name) { return this.cmds.get(name) }
}

function makeAgent() {
  let model = null
  const persistCalls = []
  return {
    setModel(m) { model = m },
    getModel() { return model },
    persistConfig() { persistCalls.push(model) },
    getState() { return { tool_count: 0 } },
    _persistCalls: persistCalls,
  }
}

async function exec(reg, args) {
  const fn = reg.get('clawser')
  return fn({ args, state: { aliases: new Map() }, fs: null, env: new Map(), stdin: '' })
}

describe('clawser CLI — model persists on set', () => {
  it('clawser model X calls persistConfig()', async () => {
    const reg = new CommandRegistry()
    const agent = makeAgent()
    registerClawserCli(reg, () => agent, () => null)
    const r = await exec(reg, ['model', 'gpt-5'])
    assert.equal(r.exitCode, 0)
    assert.equal(agent.getModel(), 'gpt-5')
    assert.deepEqual(agent._persistCalls, ['gpt-5'],
      'persistConfig() must be called so the change survives reload')
  })

  it('clawser config set model X calls persistConfig()', async () => {
    const reg = new CommandRegistry()
    const agent = makeAgent()
    registerClawserCli(reg, () => agent, () => null)
    const r = await exec(reg, ['config', 'set', 'model', 'claude-3-5-sonnet-20241022'])
    assert.equal(r.exitCode, 0)
    assert.equal(agent.getModel(), 'claude-3-5-sonnet-20241022')
    assert.deepEqual(agent._persistCalls, ['claude-3-5-sonnet-20241022'])
  })

  it('clawser model (no args) does NOT call persistConfig (it just reads)', async () => {
    const reg = new CommandRegistry()
    const agent = makeAgent()
    agent.setModel('preset')
    registerClawserCli(reg, () => agent, () => null)
    const r = await exec(reg, ['model'])
    assert.equal(r.exitCode, 0)
    assert.match(r.stdout, /preset/)
    assert.deepEqual(agent._persistCalls, [],
      'reading the model must not trigger a persist')
  })

  it('an agent without persistConfig (legacy) is tolerated', async () => {
    const reg = new CommandRegistry()
    const agent = { setModel(m) { this._m = m }, getModel() { return this._m }, getState() { return {} } }
    registerClawserCli(reg, () => agent, () => null)
    const r = await exec(reg, ['model', 'x'])
    assert.equal(r.exitCode, 0)
    assert.equal(agent._m, 'x')
  })
})
