/**
 * Browser-hosted VM console abstractions.
 */

import { ShellState } from './clawser-shell.js'

const textEncoder = new TextEncoder()
const textDecoder = new TextDecoder()

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

function distroFiles({
  name = 'Clawser VM',
  distroId = 'clawser-vm',
  prettyName = 'Clawser Demo Linux VM',
  readme = 'Welcome to the Clawser demo Linux VM.\n',
} = {}) {
  return new Map([
    ['/etc/os-release', `NAME="${name}"\nID=${distroId}\nPRETTY_NAME="${prettyName}"\n`],
    ['/home/clawser/README.txt', readme],
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

function fileToBytes(content) {
  if (content instanceof Uint8Array) return content
  return textEncoder.encode(String(content ?? ''))
}

function fileToText(content) {
  if (content instanceof Uint8Array) return textDecoder.decode(content)
  return String(content ?? '')
}

function fileSize(content) {
  return fileToBytes(content).byteLength
}

function serializeFiles(files) {
  return [...files.entries()].map(([path, content]) => ({
    path,
    encoding: content instanceof Uint8Array ? 'base64' : 'utf8',
    data: content instanceof Uint8Array
      ? btoa(String.fromCharCode(...content))
      : String(content ?? ''),
  }))
}

function restoreFiles(entries = []) {
  const files = new Map()
  for (const entry of entries) {
    if (Array.isArray(entry) && entry.length >= 2) {
      files.set(entry[0], entry[1])
      continue
    }
    if (!entry || typeof entry.path !== 'string') continue
    if (entry.encoding === 'base64') {
      const decoded = atob(entry.data || '')
      files.set(entry.path, Uint8Array.from(decoded, (char) => char.charCodeAt(0)))
      continue
    }
    files.set(entry.path, entry.data || '')
  }
  return files
}

export class DemoLinuxVmConsole {
  #id
  #label
  #emulator
  #distro
  #imageId
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
    id = 'demo-linux',
    label = 'Demo Linux VM',
    emulator = 'demo',
    distro = 'clawser-vm',
    imageId = null,
    hostname = 'clawser-vm',
    username = 'clawser',
    files = null,
    directories = null,
    running = true,
    persistenceKey = null,
    resourceBudget = null,
  } = {}) {
    this.#id = String(id || 'demo-linux')
    this.#label = String(label || 'Demo Linux VM')
    this.#emulator = String(emulator || 'demo')
    this.#distro = String(distro || 'clawser-vm')
    this.#imageId = String(imageId || this.#id)
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
      id: this.#id,
      label: this.#label,
      emulator: this.#emulator,
      distro: this.#distro,
      imageId: this.#imageId,
      capabilities: ['shell', 'fs'],
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
      files: serializeFiles(this.#files),
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
    this.#files = restoreFiles(Array.isArray(snapshot.files) ? snapshot.files : [])
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
      return { stdout: fileToText(this.#files.get('/etc/os-release') || ''), stderr: '', exitCode: 0 }
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
      return { stdout: fileToText(this.#files.get(target)), stderr: '', exitCode: 0 }
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

  async statFile(path) {
    this.#assertRunning()
    const target = normalizePath(this.#cwd, path)
    if (this.#files.has(target)) {
      return { path: target, kind: 'file', size: fileSize(this.#files.get(target)) }
    }
    if (this.#directories.has(target)) {
      return { path: target, kind: 'directory', size: 0 }
    }
    throw new Error(`No such file or directory: ${target}`)
  }

  async listFiles(path = this.#cwd) {
    this.#assertRunning()
    const target = normalizePath(this.#cwd, path)
    if (!this.#directories.has(target)) {
      throw new Error(`No such directory: ${target}`)
    }
    const entries = []
    const seen = new Set()
    for (const dir of this.#directories) {
      if (dir === target || parentDirectory(dir) !== target) continue
      const name = dir.split('/').filter(Boolean).at(-1)
      if (!name || seen.has(`dir:${name}`)) continue
      seen.add(`dir:${name}`)
      entries.push({ name, kind: 'directory', type: 'directory', size: 0 })
    }
    for (const [filePath, content] of this.#files.entries()) {
      if (parentDirectory(filePath) !== target) continue
      const name = filePath.split('/').filter(Boolean).at(-1)
      if (!name || seen.has(`file:${name}`)) continue
      seen.add(`file:${name}`)
      entries.push({ name, kind: 'file', type: 'file', size: fileSize(content) })
    }
    return entries.sort((left, right) => {
      if (left.kind !== right.kind) return left.kind === 'directory' ? -1 : 1
      return left.name.localeCompare(right.name)
    })
  }

  async readFile(path, { offset = 0, length = null } = {}) {
    this.#assertRunning()
    const target = normalizePath(this.#cwd, path)
    if (!this.#files.has(target)) {
      throw new Error(`No such file: ${target}`)
    }
    const bytes = fileToBytes(this.#files.get(target))
    const start = Math.max(0, Number(offset) || 0)
    const end = length == null ? bytes.byteLength : Math.min(bytes.byteLength, start + Math.max(0, Number(length) || 0))
    const slice = bytes.slice(start, end)
    return {
      path: target,
      data: slice,
      text: textDecoder.decode(slice),
      size: bytes.byteLength,
    }
  }

  async writeFile(path, data, { offset = null } = {}) {
    this.#assertRunning()
    const target = normalizePath(this.#cwd, path)
    const incoming = data instanceof Uint8Array ? data : fileToBytes(data)
    const current = this.#files.get(target)
    let next = incoming
    if (offset != null && this.#files.has(target)) {
      const start = Math.max(0, Number(offset) || 0)
      const existing = fileToBytes(current)
      const total = Math.max(existing.byteLength, start + incoming.byteLength)
      next = new Uint8Array(total)
      next.set(existing, 0)
      next.set(incoming, start)
    }
    this.#directories.add(parentDirectory(target))
    this.#files.set(target, next)
    await this.#persist()
    return { path: target, size: next.byteLength }
  }

  async mkdir(path) {
    this.#assertRunning()
    const target = normalizePath(this.#cwd, path)
    this.#directories.add(target)
    await this.#persist()
    return { path: target, kind: 'directory' }
  }

  async remove(path) {
    this.#assertRunning()
    const target = normalizePath(this.#cwd, path)
    if (this.#files.delete(target)) {
      await this.#persist()
      return { path: target, removed: true, kind: 'file' }
    }
    if (this.#directories.has(target)) {
      for (const child of this.#directories) {
        if (child !== target && child.startsWith(`${target}/`)) {
          throw new Error(`Directory is not empty: ${target}`)
        }
      }
      for (const filePath of this.#files.keys()) {
        if (filePath.startsWith(`${target}/`)) {
          throw new Error(`Directory is not empty: ${target}`)
        }
      }
      this.#directories.delete(target)
      await this.#persist()
      return { path: target, removed: true, kind: 'directory' }
    }
    throw new Error(`No such file or directory: ${target}`)
  }

  async download(path) {
    const result = await this.readFile(path)
    return result.data
  }

  async upload(data, path) {
    const result = await this.writeFile(path, data)
    return { ok: true, ...result }
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

  #assertRunning() {
    if (!this.#running) {
      throw new Error('vm is stopped')
    }
  }

  async #persist() {
    if (!this.#persistenceKey || typeof localStorage === 'undefined') return
    localStorage.setItem(this.#persistenceKey, JSON.stringify(this.exportSnapshot()))
  }
}

export class InMemoryVmConsole extends DemoLinuxVmConsole {}

function describeRuntime(id, runtime, metadata = null) {
  const runtimeMetadata = {
    ...(metadata || {}),
    ...((runtime?.metadata) || {}),
  }
  return {
    id,
    label: runtimeMetadata.label || id,
    emulator: runtimeMetadata.emulator || 'custom',
    distro: runtimeMetadata.distro || null,
    imageId: runtimeMetadata.imageId || null,
    capabilities: [...(runtimeMetadata.capabilities || ['shell'])],
    running: runtimeMetadata.running !== false,
    persistenceKey: runtimeMetadata.persistenceKey || null,
    resourceBudget: runtimeMetadata.resourceBudget || null,
    vmControl: [...(runtimeMetadata.vmControl || [])],
    description: runtimeMetadata.description || null,
    installedAt: runtimeMetadata.installedAt || null,
    defaultRuntime: runtimeMetadata.defaultRuntime === true,
  }
}

export class BrowserVmConsoleRegistry {
  #runtimes = new Map()
  #images = new Map()
  #listeners = new Map()
  #defaultRuntimeId = null

  register(id, runtime, metadata = null) {
    if (!id || !runtime) throw new Error('id and runtime are required')
    const runtimeId = String(id)
    this.#runtimes.set(runtimeId, {
      runtime,
      descriptor: describeRuntime(runtimeId, runtime, metadata),
    })
    this.#defaultRuntimeId ||= runtimeId
    this.#refreshDescriptor(runtimeId)
    this.#emit('changed', { type: 'runtime-registered', runtimeId })
  }

  on(event, listener) {
    if (!this.#listeners.has(event)) this.#listeners.set(event, new Set())
    this.#listeners.get(event).add(listener)
    return () => this.off(event, listener)
  }

  off(event, listener) {
    this.#listeners.get(event)?.delete(listener)
  }

  registerImage(image) {
    if (!image?.id) throw new Error('image.id is required')
    const imageId = String(image.id)
    this.#images.set(imageId, {
      id: imageId,
      label: image.label || imageId,
      emulator: image.emulator || 'custom',
      distro: image.distro || imageId,
      description: image.description || null,
      capabilities: [...(image.capabilities || ['shell', 'fs'])],
      resourceBudget: sanitizeBudget(image.resourceBudget || {}),
      createRuntime: image.createRuntime,
    })
    this.#emit('changed', { type: 'image-registered', imageId })
  }

  listImages() {
    return [...this.#images.values()]
      .map((image) => ({
        id: image.id,
        label: image.label,
        emulator: image.emulator,
        distro: image.distro,
        description: image.description,
        capabilities: [...image.capabilities],
        resourceBudget: { ...image.resourceBudget },
        installedRuntimeIds: this.list()
          .filter((runtime) => runtime.imageId === image.id)
          .map((runtime) => runtime.id),
      }))
      .sort((left, right) => left.label.localeCompare(right.label))
  }

  describeImage(id) {
    const image = this.#images.get(String(id))
    if (!image) return null
    return this.listImages().find((entry) => entry.id === image.id) || null
  }

  getDefaultRuntimeId() {
    return this.#resolveRuntimeId('default')
  }

  setDefault(id) {
    const runtimeId = this.#resolveRuntimeId(id)
    if (!runtimeId || !this.#runtimes.has(runtimeId)) {
      throw new Error(`Unknown VM runtime: ${id}`)
    }
    this.#defaultRuntimeId = runtimeId
    this.#refreshAllDescriptors()
    this.#emit('changed', { type: 'default-changed', runtimeId })
    return runtimeId
  }

  install(imageId, {
    runtimeId = null,
    persistenceKey = null,
    workspaceId = 'default',
  } = {}) {
    const image = this.#images.get(String(imageId))
    if (!image || typeof image.createRuntime !== 'function') {
      throw new Error(`Unknown VM image: ${imageId}`)
    }
    const targetRuntimeId = String(runtimeId || image.id)
    const runtime = image.createRuntime({
      runtimeId: targetRuntimeId,
      imageId: image.id,
      workspaceId,
      persistenceKey: persistenceKey || `clawser_v1_vm_${targetRuntimeId.replace(/[^a-z0-9_-]+/gi, '_')}_${workspaceId}`,
    })
    this.#runtimes.set(targetRuntimeId, {
      runtime,
      descriptor: describeRuntime(targetRuntimeId, runtime, {
        ...runtime.metadata,
        imageId: image.id,
        description: image.description,
        installedAt: Date.now(),
      }),
    })
    this.#defaultRuntimeId ||= targetRuntimeId
    this.#refreshDescriptor(targetRuntimeId)
    this.#emit('changed', { type: 'runtime-installed', runtimeId: targetRuntimeId, imageId: image.id })
    return this.describe(targetRuntimeId)
  }

  uninstall(id) {
    const runtimeId = this.#resolveRuntimeId(id)
    if (!runtimeId || !this.#runtimes.has(runtimeId)) {
      throw new Error(`Unknown VM runtime: ${id}`)
    }
    this.#runtimes.delete(runtimeId)
    if (this.#defaultRuntimeId === runtimeId) {
      this.#defaultRuntimeId = this.#runtimes.keys().next().value || null
    }
    this.#refreshAllDescriptors()
    this.#emit('changed', { type: 'runtime-uninstalled', runtimeId })
    return runtimeId
  }

  get(id = 'default') {
    const runtimeId = this.#resolveRuntimeId(id)
    return runtimeId ? this.#runtimes.get(runtimeId)?.runtime || null : null
  }

  describe(id = 'default') {
    const runtimeId = this.#resolveRuntimeId(id)
    return runtimeId ? this.#runtimes.get(runtimeId)?.descriptor || null : null
  }

  list() {
    return [...this.#runtimes.values()]
      .map((entry) => ({ ...entry.descriptor }))
      .sort((left, right) => left.id.localeCompare(right.id))
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
    entry.descriptor = {
      ...describeRuntime(id, entry.runtime, entry.descriptor),
      defaultRuntime: this.#defaultRuntimeId === id,
    }
    return { ...entry.descriptor }
  }

  #refreshAllDescriptors() {
    for (const id of this.#runtimes.keys()) {
      this.#refreshDescriptor(id)
    }
  }

  #resolveRuntimeId(id = 'default') {
    if (id == null || id === 'default') {
      return this.#defaultRuntimeId || this.#runtimes.keys().next().value || null
    }
    return String(id)
  }

  #emit(event, payload) {
    for (const listener of this.#listeners.get(event) || []) {
      listener(payload)
    }
  }
}

export function createBuiltinVmImages() {
  return [
    {
      id: 'demo-linux',
      label: 'Demo Linux',
      emulator: 'demo',
      distro: 'clawser-vm',
      description: 'Default browser-hosted Clawser VM with shell and filesystem support.',
      capabilities: ['shell', 'fs'],
      resourceBudget: { memoryMb: 256, cpuShares: 1, storageMb: 512 },
      createRuntime: ({ runtimeId, imageId, persistenceKey }) => new DemoLinuxVmConsole({
        id: runtimeId,
        imageId,
        label: 'Demo Linux VM',
        emulator: 'demo',
        distro: 'clawser-vm',
        persistenceKey,
      }),
    },
    {
      id: 'alpine-lab',
      label: 'Alpine Lab',
      emulator: 'demo',
      distro: 'alpine',
      description: 'Small browser VM image tuned for lightweight shell and filesystem experiments.',
      capabilities: ['shell', 'fs'],
      resourceBudget: { memoryMb: 192, cpuShares: 1, storageMb: 384 },
      createRuntime: ({ runtimeId, imageId, persistenceKey }) => new DemoLinuxVmConsole({
        id: runtimeId,
        imageId,
        label: 'Alpine Lab VM',
        emulator: 'demo',
        distro: 'alpine',
        hostname: 'alpine-lab',
        files: distroFiles({
          name: 'Alpine Linux',
          distroId: 'alpine',
          prettyName: 'Clawser Alpine Lab',
          readme: 'Lightweight Alpine-style browser VM.\nUse this for quick file and shell experiments.\n',
        }),
        persistenceKey,
        resourceBudget: { memoryMb: 192, cpuShares: 1, storageMb: 384 },
      }),
    },
    {
      id: 'debian-dev',
      label: 'Debian Dev',
      emulator: 'demo',
      distro: 'debian',
      description: 'Heavier browser VM image intended for service and deployment simulation.',
      capabilities: ['shell', 'fs', 'tools'],
      resourceBudget: { memoryMb: 512, cpuShares: 2, storageMb: 1024 },
      createRuntime: ({ runtimeId, imageId, persistenceKey }) => new DemoLinuxVmConsole({
        id: runtimeId,
        imageId,
        label: 'Debian Dev VM',
        emulator: 'demo',
        distro: 'debian',
        hostname: 'debian-dev',
        files: distroFiles({
          name: 'Debian GNU/Linux',
          distroId: 'debian',
          prettyName: 'Clawser Debian Dev',
          readme: 'Developer-oriented browser VM image with a larger simulated budget.\n',
        }),
        persistenceKey,
        resourceBudget: { memoryMb: 512, cpuShares: 2, storageMb: 1024 },
      }),
    },
  ]
}
