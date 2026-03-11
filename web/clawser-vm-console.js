/**
 * Browser-hosted VM console abstractions.
 */

import { ShellState } from './clawser-shell.js'

function normalizePath(cwd, input = '.') {
  const raw = String(input || '.').trim() || '.'
  const absolute = raw.startsWith('/')
    ? raw
    : `${cwd.replace(/\/$/, '') || '/'}${cwd === '/' ? '' : '/'}${raw}`
  const parts = []
  for (const part of absolute.split('/')) {
    if (!part || part === '.') continue
    if (part === '..') {
      parts.pop()
      continue
    }
    parts.push(part)
  }
  return `/${parts.join('/')}` || '/'
}

function parentDirectory(path) {
  const normalized = normalizePath('/', path)
  if (normalized === '/') return '/'
  const segments = normalized.split('/').filter(Boolean)
  segments.pop()
  return segments.length ? `/${segments.join('/')}` : '/'
}

function defaultDemoFiles() {
  return new Map([
    ['/etc/os-release', 'NAME="Clawser VM"\nID=clawser-vm\nPRETTY_NAME="Clawser Demo Linux VM"\n'],
    ['/home/clawser/README.txt', 'Welcome to the Clawser demo Linux VM.\n'],
  ])
}

function defaultDemoDirectories() {
  return new Set([
    '/',
    '/bin',
    '/dev',
    '/etc',
    '/home',
    '/home/clawser',
    '/proc',
    '/root',
    '/tmp',
    '/usr',
    '/var',
  ])
}

export class DemoLinuxVmConsole {
  #cwd = '/home/clawser'
  #history = []
  #hostname
  #username
  #files
  #directories

  constructor({
    hostname = 'clawser-vm',
    username = 'clawser',
    files = null,
    directories = null,
  } = {}) {
    this.#hostname = hostname
    this.#username = username
    this.#files = files ? new Map(files) : defaultDemoFiles()
    this.#directories = directories ? new Set(directories) : defaultDemoDirectories()
    for (const path of this.#files.keys()) {
      this.#directories.add(parentDirectory(path))
    }
  }

  get metadata() {
    return {
      id: 'demo-linux',
      label: 'Demo Linux VM',
      emulator: 'demo',
      distro: 'clawser-vm',
      capabilities: ['shell'],
    }
  }

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
    if (input === 'whoami') return { stdout: `${this.#username}\n`, stderr: '', exitCode: 0 }
    if (input === 'hostname') return { stdout: `${this.#hostname}\n`, stderr: '', exitCode: 0 }
    if (input === 'uname' || input === 'uname -a') {
      return { stdout: `Linux ${this.#hostname} 6.6.0-clawser #1 PREEMPT browser x86_64 GNU/Linux\n`, stderr: '', exitCode: 0 }
    }
    if (input === 'cat /etc/os-release') {
      return { stdout: this.#files.get('/etc/os-release') || '', stderr: '', exitCode: 0 }
    }
    if (input === 'ls' || input.startsWith('ls ')) {
      const target = normalizePath(this.#cwd, input === 'ls' ? this.#cwd : input.slice(3))
      return {
        stdout: this.#listDirectory(target),
        stderr: '',
        exitCode: 0,
      }
    }
    if (input.startsWith('cd ')) {
      const target = normalizePath(this.#cwd, input.slice(3))
      if (!this.#directories.has(target)) {
        return { stdout: '', stderr: `cd: no such file or directory: ${target}\n`, exitCode: 1 }
      }
      this.#cwd = target
      return { stdout: '', stderr: '', exitCode: 0 }
    }
    if (input.startsWith('cat ')) {
      const target = normalizePath(this.#cwd, input.slice(4))
      if (!this.#files.has(target)) {
        return { stdout: '', stderr: `cat: ${target}: No such file\n`, exitCode: 1 }
      }
      return { stdout: this.#files.get(target), stderr: '', exitCode: 0 }
    }
    if (input.startsWith('mkdir -p ')) {
      const target = normalizePath(this.#cwd, input.slice('mkdir -p '.length))
      this.#directories.add(target)
      return { stdout: '', stderr: '', exitCode: 0 }
    }
    if (input.startsWith('touch ')) {
      const target = normalizePath(this.#cwd, input.slice(6))
      this.#directories.add(parentDirectory(target))
      this.#files.set(target, this.#files.get(target) || '')
      return { stdout: '', stderr: '', exitCode: 0 }
    }
    const echoMatch = input.match(/^echo\s+["']?(.+?)["']?\s*>\s*(.+)$/)
    if (echoMatch) {
      const [, value, rawPath] = echoMatch
      const target = normalizePath(this.#cwd, rawPath)
      this.#directories.add(parentDirectory(target))
      this.#files.set(target, `${value}\n`)
      return { stdout: '', stderr: '', exitCode: 0 }
    }

    return { stdout: `vm:${this.#cwd}$ ${input}\n`, stderr: '', exitCode: 0 }
  }

  #listDirectory(target) {
    if (!this.#directories.has(target)) {
      return ''
    }
    const entries = new Set()
    for (const dir of this.#directories) {
      if (dir === target) continue
      if (parentDirectory(dir) === target) {
        entries.add(dir.split('/').filter(Boolean).at(-1))
      }
    }
    for (const file of this.#files.keys()) {
      if (parentDirectory(file) === target) {
        entries.add(file.split('/').filter(Boolean).at(-1))
      }
    }
    return [...entries].sort().join('\n') + ([...entries].length ? '\n' : '')
  }
}

export class InMemoryVmConsole extends DemoLinuxVmConsole {}

function describeRuntime(id, runtime, metadata = null) {
  const runtimeMetadata = metadata || runtime?.metadata || {}
  return {
    id,
    label: runtimeMetadata.label || id,
    emulator: runtimeMetadata.emulator || 'custom',
    distro: runtimeMetadata.distro || null,
    capabilities: [...(runtimeMetadata.capabilities || ['shell'])],
  }
}

export class BrowserVmConsoleRegistry {
  #runtimes = new Map()

  register(id, runtime, metadata = null) {
    if (!id || !runtime) throw new Error('id and runtime are required')
    this.#runtimes.set(id, {
      runtime,
      descriptor: describeRuntime(id, runtime, metadata),
    })
  }

  get(id = 'default') {
    return this.#runtimes.get(id)?.runtime || null
  }

  describe(id = 'default') {
    return this.#runtimes.get(id)?.descriptor || null
  }

  list() {
    return [...this.#runtimes.values()].map((entry) => ({ ...entry.descriptor }))
  }

  async createShell(id = 'default') {
    const runtime = this.get(id)
    if (!runtime || typeof runtime.execute !== 'function') {
      throw new Error(`Unknown VM runtime: ${id}`)
    }
    return runtime
  }
}
