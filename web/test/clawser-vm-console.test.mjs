// Run with: node --import ./web/test/_setup-globals.mjs --test web/test/clawser-vm-console.test.mjs
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

import { BrowserVmConsoleRegistry, DemoLinuxVmConsole } from '../clawser-vm-console.js'

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
})

describe('BrowserVmConsoleRegistry', () => {
  it('lists and describes registered runtimes', () => {
    const registry = new BrowserVmConsoleRegistry()
    registry.register('demo-linux', new DemoLinuxVmConsole())

    assert.deepEqual(registry.list().map((entry) => entry.id), ['demo-linux'])
    assert.equal(registry.describe('demo-linux').emulator, 'demo')
    assert.equal(registry.describe('demo-linux').distro, 'clawser-vm')
  })

  it('creates shells by runtime id', async () => {
    const registry = new BrowserVmConsoleRegistry()
    const vm = new DemoLinuxVmConsole()
    registry.register('demo-linux', vm)

    const shell = await registry.createShell('demo-linux')

    assert.equal(shell, vm)
  })
})
