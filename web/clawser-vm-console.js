/**
 * Browser-hosted VM console abstractions.
 */

import { ShellState } from './clawser-shell.js'

function cloneFileMap(files) {
  return new Map(files ? [...files.entries()] : [])
}

function cloneDirectorySet(directories) {
  return new Set(directories ? [...directories.values()] : [])
}

function sanitizeBudget(budget = {}) {
  const safeBudget = budget || {}
  return {
    memoryMb: Number.isFinite(Number(safeBudget.memoryMb)) ? Number(safeBudget.memoryMb) : 256,
    cpuShares: Number.isFinite(Number(safeBudget.cpuShares)) ? Number(safeBudget.cpuShares) : 1,
    storageMb: Number.isFinite(Number(safeBudget.storageMb)) ? Number(safeBudget.storageMb) : 512,
  }
}

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
  #defaultFiles
  #defaultDirectories
  #running
  #persistenceKey
  #resourceBudget

  constructor({
    hostname = 'clawser-vm',
    username = 'clawser',
    files = null,
    directories = null,
    running = true,
    persistenceKey = null,
    resourceBudget = null,
  } = {}) {
    this.#hostname = hostname
    this.#username = username
    this.#defaultFiles = files ? new Map(files) : defaultDemoFiles()
    this.#defaultDirectories = directories ? new Set(directories) : defaultDemoDirectories()
    this.#files = cloneFileMap(this.#defaultFiles)
    this.#directories = cloneDirectorySet(this.#defaultDirectories)
    for (const path of this.#files.keys()) {
      this.#directories.add(parentDirectory(path))
    }
    this.#running = running !== false
    this.#persistenceKey = persistenceKey || null
    this.#resourceBudget = sanitizeBudget(resourceBudget)
  }

  get metadata() {
    return {
      id: 'demo-linux',
      label: 'Demo Linux VM',
      emulator: 'demo',
      distro: 'clawser-vm',
      capabilities: ['shell'],
      running: this.#running,
      persistenceKey: this.#persistenceKey,
      resourceBudget: { ...this.#resourceBudget },
      vmControl: ['start', 'stop', 'reset', 'snapshot:export', 'snapshot:import'],
    }
  }

  get state() {
    const state = new ShellState()
    state.cwd = this.#cwd
    state.history = [...this.#history]
    return state
  }

  get running() {
    return this.#running
  }

  get resourceBudget() {
    return { ...this.#resourceBudget }
  }

  get persistenceKey() {
    return this.#persistenceKey
  }

  async start() {
    this.#running = true
    await this.#persist()
    return this.metadata
  }

  async stop() {
    this.#running = false
    await this.#persist()
    return this.metadata
  }

  async reset() {
    this.#cwd = '/home/clawser'
    this.#history = []
    this.#files = cloneFileMap(this.#defaultFiles)
    this.#directories = cloneDirectorySet(this.#defaultDirectories)
    for (const path of this.#files.keys()) {
      this.#directories.add(parentDirectory(path))
    }
    this.#running = true
    await this.#persist()
    return this.metadata
  }

  async updateResourceBudget(updates = {}) {
    this.#resourceBudget = sanitizeBudget({
      ...this.#resourceBudget,
      ...updates,
    })
    await this.#persist()
    return this.resourceBudget
  }

  exportSnapshot() {
    return {
      version: 1,
      cwd: this.#cwd,
      history: [...this.#history],
      running: this.#running,
      files: [...this.#files.entries()],
      directories: [...this.#directories.values()],
      resourceBudget: { ...this.#resourceBudget },
    }
  }

  async importSnapshot(snapshot = {}) {
    if (!snapshot || snapshot.version !== 1) {
      throw new Error('unsupported VM snapshot format')
    }
    this.#cwd = normalizePath('/', snapshot.cwd || '/home/clawser')
    this.#history = Array.isArray(snapshot.history) ? [...snapshot.history] : []
    this.#running = snapshot.running !== false
    this.#files = new Map(Array.isArray(snapshot.files) ? snapshot.files : [])
    this.#directories = new Set(Array.isArray(snapshot.directories) ? snapshot.directories : [])
    for (const path of this.#files.keys()) {
      this.#directories.add(parentDirectory(path))
    }
    this.#directories.add('/')
    this.#resourceBudget = sanitizeBudget(snapshot.resourceBudget || this.#resourceBudget)
    await this.#persist()
    return this.metadata
  }

  async restorePersistedState() {
    if (!this.#persistenceKey || typeof localStorage === 'undefined') {
      return this.metadata
    }
    const raw = localStorage.getItem(this.#persistenceKey)
    if (!raw) return this.metadata
    try {
      const snapshot = JSON.parse(raw)
      await this.importSnapshot(snapshot)
    } catch {
      await this.reset()
    }
    return this.metadata
  }

  async execute(command) {
    if (!this.#running) {
      return { stdout: '', stderr: 'vm is stopped\n', exitCode: 1 }
    }
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
      await this.#persist()
      return { stdout: '', stderr: '', exitCode: 0 }
    }
    if (input.startsWith('touch ')) {
      const target = normalizePath(this.#cwd, input.slice(6))
      this.#directories.add(parentDirectory(target))
      this.#files.set(target, this.#files.get(target) || '')
      await this.#persist()
      return { stdout: '', stderr: '', exitCode: 0 }
    }
    const echoMatch = input.match(/^echo\s+["']?(.+?)["']?\s*>\s*(.+)$/)
    if (echoMatch) {
      const [, value, rawPath] = echoMatch
      const target = normalizePath(this.#cwd, rawPath)
      this.#directories.add(parentDirectory(target))
      this.#files.set(target, `${value}\n`)
      await this.#persist()
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

  async #persist() {
    if (!this.#persistenceKey || typeof localStorage === 'undefined') return
    localStorage.setItem(this.#persistenceKey, JSON.stringify(this.exportSnapshot()))
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
    running: runtimeMetadata.running !== false,
    persistenceKey: runtimeMetadata.persistenceKey || null,
    resourceBudget: runtimeMetadata.resourceBudget || null,
    vmControl: [...(runtimeMetadata.vmControl || [])],
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
    await runtime.start?.()
    return runtime
  }

  async start(id = 'default') {
    const runtime = this.get(id)
    if (!runtime?.start) throw new Error(`Unknown VM runtime: ${id}`)
    await runtime.start()
    return this.#refreshDescriptor(id)
  }

  async stop(id = 'default') {
    const runtime = this.get(id)
    if (!runtime?.stop) throw new Error(`Unknown VM runtime: ${id}`)
    await runtime.stop()
    return this.#refreshDescriptor(id)
  }

  async reset(id = 'default') {
    const runtime = this.get(id)
    if (!runtime?.reset) throw new Error(`Unknown VM runtime: ${id}`)
    await runtime.reset()
    return this.#refreshDescriptor(id)
  }

  async exportSnapshot(id = 'default') {
    const runtime = this.get(id)
    if (!runtime?.exportSnapshot) throw new Error(`Unknown VM runtime: ${id}`)
    return runtime.exportSnapshot()
  }

  async importSnapshot(id = 'default', snapshot = {}) {
    const runtime = this.get(id)
    if (!runtime?.importSnapshot) throw new Error(`Unknown VM runtime: ${id}`)
    await runtime.importSnapshot(snapshot)
    return this.#refreshDescriptor(id)
  }

  async updateBudget(id = 'default', updates = {}) {
    const runtime = this.get(id)
    if (!runtime?.updateResourceBudget) throw new Error(`Unknown VM runtime: ${id}`)
    await runtime.updateResourceBudget(updates)
    return this.#refreshDescriptor(id).resourceBudget
  }

  #refreshDescriptor(id) {
    const entry = this.#runtimes.get(id)
    if (!entry) {
      throw new Error(`Unknown VM runtime: ${id}`)
    }
    entry.descriptor = describeRuntime(id, entry.runtime)
    return { ...entry.descriptor }
  }
}
