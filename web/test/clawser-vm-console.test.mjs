// Run with: node --import ./web/test/_setup-globals.mjs --test web/test/clawser-vm-console.test.mjs
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

import { BrowserVmConsoleRegistry, DemoLinuxVmConsole, createBuiltinVmImages } from '../clawser-vm-console.js'

describe('DemoLinuxVmConsole', () => {
  it('provides a Linux-like command surface with persistent files', async () => {
    const vm = new DemoLinuxVmConsole()

    const uname = await vm.execute('uname -a')
    const pwd = await vm.execute('pwd')
    const write = await vm.execute('echo "hello" > /tmp/hello.txt')
    const read = await vm.execute('cat /tmp/hello.txt')

    assert.match(uname.stdout, /Linux clawser-vm/)
    assert.equal(pwd.stdout, '/home/clawser\n')
    assert.equal(write.exitCode, 0)
    assert.equal(read.stdout, 'hello\n')
  })

  it('supports directory changes and listing', async () => {
    const vm = new DemoLinuxVmConsole()

    await vm.execute('mkdir -p /workspace')
    await vm.execute('touch /workspace/app.js')
    await vm.execute('cd /workspace')
    const pwd = await vm.execute('pwd')
    const ls = await vm.execute('ls')

    assert.equal(pwd.stdout, '/workspace\n')
    assert.match(ls.stdout, /app\.js/)
  })

  it('supports lifecycle transitions and snapshots', async () => {
    localStorage.removeItem('test-vm-console')
    const vm = new DemoLinuxVmConsole({ persistenceKey: 'test-vm-console' })

    await vm.execute('echo "hello" > /tmp/hello.txt')
    const snapshot = vm.exportSnapshot()
    await vm.stop()

    const stopped = await vm.execute('pwd')
    assert.equal(stopped.exitCode, 1)
    assert.match(stopped.stderr, /vm is stopped/)

    await vm.importSnapshot(snapshot)
    const restored = await vm.execute('cat /tmp/hello.txt')
    assert.equal(restored.stdout, 'hello\n')
    assert.equal(vm.resourceBudget.memoryMb, 256)
    localStorage.removeItem('test-vm-console')
  })

  it('updates resource budgets and resets state', async () => {
    const vm = new DemoLinuxVmConsole()

    await vm.updateResourceBudget({ memoryMb: 768, cpuShares: 4, storageMb: 2048 })
    await vm.execute('echo "temp" > /tmp/temp.txt')
    await vm.reset()
    const read = await vm.execute('cat /tmp/temp.txt')

    assert.equal(vm.resourceBudget.memoryMb, 768)
    assert.equal(vm.resourceBudget.cpuShares, 4)
    assert.equal(vm.resourceBudget.storageMb, 2048)
    assert.equal(read.exitCode, 1)
  })

  it('bridges guest filesystem operations and binary-style upload/download', async () => {
    const vm = new DemoLinuxVmConsole()

    await vm.mkdir('/workspace')
    await vm.upload(new Uint8Array([65, 66, 67]), '/workspace/blob.bin')
    const listed = await vm.listFiles('/workspace')
    const stat = await vm.statFile('/workspace/blob.bin')
    const read = await vm.readFile('/workspace/blob.bin')
    const downloaded = await vm.download('/workspace/blob.bin')

    assert.deepEqual(listed, [{ name: 'blob.bin', kind: 'file', type: 'file', size: 3 }])
    assert.equal(stat.kind, 'file')
    assert.equal(stat.size, 3)
    assert.equal(read.text, 'ABC')
    assert.deepEqual(Array.from(downloaded), [65, 66, 67])
  })

  it('advertises guest exec as an explicit execution API', () => {
    const vm = new DemoLinuxVmConsole()

    assert.deepEqual(vm.metadata.capabilities, ['shell', 'exec', 'fs'])
    assert.deepEqual(vm.metadata.executionApis, ['guest-exec'])
  })
})

describe('BrowserVmConsoleRegistry', () => {
  it('lists and describes registered runtimes', () => {
    const registry = new BrowserVmConsoleRegistry()
    registry.register('demo-linux', new DemoLinuxVmConsole())

    assert.deepEqual(registry.list().map((entry) => entry.id), ['demo-linux'])
    assert.equal(registry.describe('demo-linux').emulator, 'demo')
    assert.equal(registry.describe('demo-linux').distro, 'clawser-vm')
  })

  it('manages image catalogs, installs runtimes, and switches defaults', async () => {
    const registry = new BrowserVmConsoleRegistry()
    for (const image of createBuiltinVmImages()) {
      registry.registerImage(image)
    }

    const images = registry.listImages()
    assert.deepEqual(images.map((entry) => entry.id), ['alpine-lab', 'debian-dev', 'demo-linux'])
    assert.ok(images.every((entry) => entry.capabilities.includes('exec')))

    const installed = registry.install('alpine-lab', { runtimeId: 'lab' })
    assert.equal(installed.id, 'lab')
    assert.equal(installed.imageId, 'alpine-lab')
    assert.equal(registry.getDefaultRuntimeId(), 'lab')

    registry.install('debian-dev')
    registry.setDefault('debian-dev')
    assert.equal(registry.getDefaultRuntimeId(), 'debian-dev')
    assert.equal(registry.describe('default').id, 'debian-dev')

    registry.uninstall('lab')
    assert.equal(registry.describe('lab'), null)
  })

  it('creates shells by runtime id', async () => {
    const registry = new BrowserVmConsoleRegistry()
    const vm = new DemoLinuxVmConsole()
    registry.register('demo-linux', vm)

    const shell = await registry.createShell('demo-linux')

    assert.equal(shell, vm)
  })

  it('manages runtime lifecycle and snapshots through the registry', async () => {
    const registry = new BrowserVmConsoleRegistry()
    const vm = new DemoLinuxVmConsole()
    registry.register('demo-linux', vm)

    await registry.stop('demo-linux')
    assert.equal(registry.describe('demo-linux').running, false)

    await registry.start('demo-linux')
    assert.equal(registry.describe('demo-linux').running, true)

    await vm.execute('echo "persisted" > /tmp/persisted.txt')
    const snapshot = await registry.exportSnapshot('demo-linux')
    await registry.reset('demo-linux')
    await registry.importSnapshot('demo-linux', snapshot)
    const restored = await vm.execute('cat /tmp/persisted.txt')

    assert.equal(restored.stdout, 'persisted\n')
  })
})
