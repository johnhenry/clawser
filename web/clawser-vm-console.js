/**
 * Browser-hosted VM console abstractions.
 */

import { ShellState } from './clawser-shell.js'

export class InMemoryVmConsole {
  #cwd = '/'
  #history = []

  get state() {
    const state = new ShellState()
    state.cwd = this.#cwd
    state.history = [...this.#history]
    return state
  }

  async execute(command) {
    const input = String(command || '').trim()
    this.#history.push(input)
    if (!input) return { stdout: '', stderr: '', exitCode: 0 }
    if (input === 'pwd') return { stdout: `${this.#cwd}\n`, stderr: '', exitCode: 0 }
    if (input === 'ls') {
      return { stdout: 'bin\ndev\netc\nhome\nproc\nroot\ntmp\nusr\nvar\n', stderr: '', exitCode: 0 }
    }
    if (input === 'uname' || input === 'uname -a') {
      return { stdout: 'Linux clawser-vm 6.6.0-clawser #1 PREEMPT browser x86_64 GNU/Linux\n', stderr: '', exitCode: 0 }
    }
    if (input === 'cat /etc/os-release') {
      return {
        stdout: 'NAME="Clawser VM"\nID=clawser-vm\nPRETTY_NAME="Clawser VM Console"\n',
        stderr: '',
        exitCode: 0,
      }
    }
    if (input.startsWith('cd ')) {
      const next = input.slice(3).trim() || '/'
      this.#cwd = next.startsWith('/') ? next : `${this.#cwd.replace(/\/$/, '')}/${next}` || '/'
      return { stdout: '', stderr: '', exitCode: 0 }
    }
    return { stdout: `vm:${this.#cwd}$ ${input}\n`, stderr: '', exitCode: 0 }
  }
}

export class BrowserVmConsoleRegistry {
  #runtimes = new Map()

  register(id, runtime) {
    if (!id || !runtime) throw new Error('id and runtime are required')
    this.#runtimes.set(id, runtime)
  }

  get(id = 'default') {
    return this.#runtimes.get(id) || null
  }

  async createShell(id = 'default') {
    const runtime = this.get(id)
    if (!runtime || typeof runtime.execute !== 'function') {
      throw new Error(`Unknown VM runtime: ${id}`)
    }
    return runtime
  }
}
