/**
 * browser-node.mjs — Typed wrapper around the `agent-browser` CLI
 * for launching and controlling browser instances in E2E tests.
 */

import { exec as execCb } from 'node:child_process'
import { promisify } from 'node:util'

const exec = promisify(execCb)

function stripAnsi(str) {
  return str.replace(/\x1B\[[0-9;]*m/g, '')
}

export class BrowserNode {
  #session
  #appUrl
  #abOpts

  /**
   * @param {object} opts
   * @param {string} opts.session - agent-browser session name
   * @param {string} opts.appUrl - URL of the Clawser app
   * @param {string} [opts.abOpts='--ignore-https-errors'] - Extra agent-browser flags
   */
  constructor(opts) {
    this.#session = opts.session
    this.#appUrl = opts.appUrl
    this.#abOpts = opts.abOpts ?? '--ignore-https-errors'
  }

  get session() { return this.#session }

  /** Run an agent-browser command. */
  async run(args, { timeout = 30000 } = {}) {
    const cmd = `agent-browser ${this.#abOpts} --session ${this.#session} ${args}`
    const { stdout } = await exec(cmd, { encoding: 'utf-8', timeout })
    return stripAnsi(stdout).trim()
  }

  /** Evaluate JavaScript in the browser. */
  async eval(js, { timeout = 30000 } = {}) {
    const escaped = js.replace(/'/g, "'\\''")
    return this.run(`eval '${escaped}'`, { timeout })
  }

  /** Evaluate JS and parse result as JSON. */
  async evalJSON(js, { timeout = 30000 } = {}) {
    const raw = await this.eval(js, { timeout })
    try { return JSON.parse(JSON.parse(raw)) } catch {
      try { return JSON.parse(raw) } catch { return raw }
    }
  }

  /** Navigate to the app URL. */
  async navigate(path = '') {
    return this.run(`navigate "${this.#appUrl}${path}"`)
  }
}
