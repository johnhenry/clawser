/**
 * Tests for clawser-fs-devices.mjs — Device file system layer (/dev/clawser/).
 *
 * Covers:
 *   - DeviceFileHandler registration, read, write, listing, state
 *   - Provider device files with mock LLM
 *   - Channel device files with mock ChannelManager
 *   - Hardware device files with mock adapter
 *   - Special devices (null, random, zero)
 *   - VirtualFs integration (read/write dispatch to device handler)
 *   - Shell integration (redirects to/from device files)
 */
// Run with: node --import ./web/test/_setup-globals.mjs --test web/test/clawser-fs-devices.test.mjs
import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import {
  DeviceFileHandler,
  registerProviderDevice,
  registerChannelDevice,
  registerHardwareDevice,
  registerSpecialDevices,
} from '../clawser-fs-devices.mjs';

import { ProcFileHandler, VirtualFs } from '../clawser-proc.js';

// ── Mock helpers ──────────────────────────────────────────────────

/** Mock provider that echoes input. */
class MockProvider {
  get name() { return 'mock'; }
  async chat(request) {
    const lastUser = [...(request.messages || [])].reverse().find(m => m.role === 'user');
    const content = lastUser ? `Mock response to: ${lastUser.content}` : 'No prompt';
    return { content, tool_calls: [], usage: { input_tokens: 0, output_tokens: 0 }, model: 'mock' };
  }
}

/** Mock provider that fails. */
class ErrorProvider {
  get name() { return 'error-provider'; }
  async chat() { throw new Error('Provider unavailable'); }
}

/** Mock provider that delays. */
class SlowProvider {
  get name() { return 'slow'; }
  #delay;
  constructor(delay = 50) { this.#delay = delay; }
  async chat(request) {
    await new Promise(r => setTimeout(r, this.#delay));
    const lastUser = [...(request.messages || [])].reverse().find(m => m.role === 'user');
    return { content: `Slow: ${lastUser?.content}`, tool_calls: [], usage: { input_tokens: 0, output_tokens: 0 }, model: 'slow' };
  }
}

/** Mock ProviderRegistry. */
class MockProviderRegistry {
  #providers = new Map();
  register(provider) { this.#providers.set(provider.name, provider); }
  get(name) { return this.#providers.get(name) || null; }
  has(name) { return this.#providers.has(name); }
  names() { return [...this.#providers.keys()]; }
}

/** Mock ChannelManager. */
class MockChannelManager {
  sent = [];
  history = [];
  send(channel, channelId, message) {
    this.sent.push({ channel, channelId, message });
    return true;
  }
  /** Mirrors the real ChannelManager.getHistory shape. */
  getHistory({ channel, limit = 20 } = {}) {
    const filtered = channel ? this.history.filter(m => m.channel === channel) : this.history;
    return filtered.slice(-limit);
  }
  /** Test helper to push a fake inbound message. */
  pushInbound(msg) { this.history.push(msg); }
}

/** Mock hardware adapter. */
const createMockHardwareAdapter = () => {
  const buffer = [];
  return {
    write: async (data) => { buffer.push(data); return ''; },
    read: async () => buffer.length > 0 ? buffer.shift() : '',
    _buffer: buffer,
  };
};

/** Simple in-memory FS for VirtualFs wrapping. */
class SimpleMemoryFs {
  #files = new Map();
  #dirs = new Set(['/']);

  async readFile(path) {
    if (!this.#files.has(path)) throw new Error(`ENOENT: ${path}`);
    return this.#files.get(path);
  }

  async writeFile(path, content) { this.#files.set(path, content); }
  async listDir() { return []; }
  async mkdir(path) { this.#dirs.add(path); }
  async delete(path) { this.#files.delete(path); }
  async stat(path) {
    if (this.#files.has(path)) return { kind: 'file' };
    if (this.#dirs.has(path)) return { kind: 'directory' };
    return null;
  }
  async move(src, dst) {
    const content = await this.readFile(src);
    await this.writeFile(dst, content);
    await this.delete(src);
  }
}

// ── DeviceFileHandler ─────────────────────────────────────────────

describe('DeviceFileHandler', () => {
  let handler;

  beforeEach(() => {
    handler = new DeviceFileHandler();
  });

  it('registers and reads a device', async () => {
    handler.register('/dev/clawser/test', {
      write: async () => '',
      read: async () => 'hello from device',
    });
    const result = await handler.handleRead('/dev/clawser/test');
    assert.equal(result, 'hello from device');
  });

  it('registers and writes to a device', async () => {
    let captured = null;
    handler.register('/dev/clawser/test', {
      write: async (content) => { captured = content; return ''; },
      read: async () => '',
    });
    await handler.handleWrite('/dev/clawser/test', 'data');
    assert.equal(captured, 'data');
  });

  it('isDevice returns true for registered paths', () => {
    handler.register('/dev/clawser/foo', { write: async () => '', read: async () => '' });
    assert.ok(handler.isDevice('/dev/clawser/foo'));
    assert.ok(!handler.isDevice('/dev/clawser/bar'));
  });

  it('isDevice returns true for parent directories of registered paths', () => {
    handler.register('/dev/clawser/providers/openai', { write: async () => '', read: async () => '' });
    assert.ok(handler.isDevice('/dev/clawser/providers'));
    assert.ok(handler.isDevice('/dev/clawser/providers/openai'));
  });

  it('throws on read from unregistered path', async () => {
    await assert.rejects(
      () => handler.handleRead('/dev/clawser/nope'),
      /No device at/,
    );
  });

  it('throws on write to unregistered path', async () => {
    await assert.rejects(
      () => handler.handleWrite('/dev/clawser/nope', 'data'),
      /No device at/,
    );
  });

  it('unregister removes a device', () => {
    handler.register('/dev/clawser/tmp', { write: async () => '', read: async () => '' });
    assert.ok(handler.isDevice('/dev/clawser/tmp'));
    handler.unregister('/dev/clawser/tmp');
    assert.ok(!handler.isDevice('/dev/clawser/tmp'));
  });

  it('getState returns device state', () => {
    handler.register('/dev/clawser/s', {
      write: async () => '',
      read: async () => '',
      state: { counter: 42 },
    });
    assert.deepEqual(handler.getState('/dev/clawser/s'), { counter: 42 });
  });

  it('getState returns undefined for unregistered path', () => {
    assert.equal(handler.getState('/dev/clawser/nope'), undefined);
  });

  it('listDir returns directory entries', () => {
    handler.register('/dev/clawser/providers/openai', { write: async () => '', read: async () => '' });
    handler.register('/dev/clawser/providers/anthropic', { write: async () => '', read: async () => '' });
    handler.register('/dev/clawser/null', { write: async () => '', read: async () => '' });

    const providers = handler.listDir('/dev/clawser/providers');
    assert.equal(providers.length, 2);
    assert.ok(providers.some(e => e.name === 'openai' && e.kind === 'file'));
    assert.ok(providers.some(e => e.name === 'anthropic' && e.kind === 'file'));

    const root = handler.listDir('/dev/clawser');
    assert.ok(root.some(e => e.name === 'providers' && e.kind === 'directory'));
    assert.ok(root.some(e => e.name === 'null' && e.kind === 'file'));
  });

  it('paths returns all registered paths', () => {
    handler.register('/dev/clawser/a', { write: async () => '', read: async () => '' });
    handler.register('/dev/clawser/b', { write: async () => '', read: async () => '' });
    const p = handler.paths;
    assert.ok(p.includes('/dev/clawser/a'));
    assert.ok(p.includes('/dev/clawser/b'));
  });

  it('normalizes trailing slashes', async () => {
    handler.register('/dev/clawser/test/', {
      write: async () => '',
      read: async () => 'normalized',
    });
    const result = await handler.handleRead('/dev/clawser/test');
    assert.equal(result, 'normalized');
  });

  it('state is mutable across read/write calls', async () => {
    handler.register('/dev/clawser/counter', {
      state: { count: 0 },
      write: async (content, state) => { state.count += parseInt(content, 10); return ''; },
      read: async (state) => `count=${state.count}`,
    });
    await handler.handleWrite('/dev/clawser/counter', '5');
    await handler.handleWrite('/dev/clawser/counter', '3');
    const result = await handler.handleRead('/dev/clawser/counter');
    assert.equal(result, 'count=8');
  });
});

// ── Provider Device Files ─────────────────────────────────────────

describe('registerProviderDevice', () => {
  let handler;
  let registry;

  beforeEach(() => {
    handler = new DeviceFileHandler();
    registry = new MockProviderRegistry();
    registry.register(new MockProvider());
  });

  it('registers a device at /dev/clawser/providers/{name}', () => {
    registerProviderDevice(handler, 'mock', registry);
    assert.ok(handler.isDevice('/dev/clawser/providers/mock'));
  });

  it('write sends prompt, read returns response', async () => {
    registerProviderDevice(handler, 'mock', registry);

    await handler.handleWrite('/dev/clawser/providers/mock', 'What is 2+2?');
    const response = await handler.handleRead('/dev/clawser/providers/mock');
    assert.ok(response.includes('Mock response to: What is 2+2?'));
  });

  it('state tracks lastPrompt and lastResponse', async () => {
    registerProviderDevice(handler, 'mock', registry);

    await handler.handleWrite('/dev/clawser/providers/mock', 'hello');
    const state = handler.getState('/dev/clawser/providers/mock');
    assert.equal(state.lastPrompt, 'hello');
    assert.ok(state.lastResponse.includes('hello'));
    assert.equal(state.status, 'idle');
  });

  it('handles provider errors gracefully', async () => {
    registry.register(new ErrorProvider());
    registerProviderDevice(handler, 'error-provider', registry);

    await assert.rejects(
      () => handler.handleWrite('/dev/clawser/providers/error-provider', 'test'),
      /Provider unavailable/,
    );

    const state = handler.getState('/dev/clawser/providers/error-provider');
    assert.equal(state.status, 'error');
    assert.ok(state.lastResponse.includes('Error:'));
  });

  it('handles missing provider', async () => {
    registerProviderDevice(handler, 'nonexistent', registry);

    await assert.rejects(
      () => handler.handleWrite('/dev/clawser/providers/nonexistent', 'test'),
      /not configured/,
    );
  });

  it('read returns empty string when no request has been made', async () => {
    registerProviderDevice(handler, 'mock', registry);

    const result = await handler.handleRead('/dev/clawser/providers/mock');
    assert.equal(result, '');
  });

  it('read returns last response when idle', async () => {
    registerProviderDevice(handler, 'mock', registry);

    await handler.handleWrite('/dev/clawser/providers/mock', 'first');
    const r1 = await handler.handleRead('/dev/clawser/providers/mock');
    // Read again — still returns last response
    const r2 = await handler.handleRead('/dev/clawser/providers/mock');
    assert.equal(r1, r2);
  });

  it('read blocks while provider is thinking', async () => {
    registry.register(new SlowProvider(100));
    registerProviderDevice(handler, 'slow', registry);

    // Start write (don't await)
    const writePromise = handler.handleWrite('/dev/clawser/providers/slow', 'test');

    // Read should block until write completes
    // Give it a tiny tick to ensure write has started
    await new Promise(r => setTimeout(r, 10));
    const readPromise = handler.handleRead('/dev/clawser/providers/slow');

    const [, readResult] = await Promise.all([writePromise, readPromise]);
    assert.ok(readResult.includes('Slow: test'));
  });

  it('trims whitespace from prompt', async () => {
    registerProviderDevice(handler, 'mock', registry);

    await handler.handleWrite('/dev/clawser/providers/mock', '  hello world  \n');
    const state = handler.getState('/dev/clawser/providers/mock');
    assert.equal(state.lastPrompt, 'hello world');
  });
});

// ── Channel Device Files ──────────────────────────────────────────

describe('registerChannelDevice', () => {
  let handler;
  let channelManager;

  beforeEach(() => {
    handler = new DeviceFileHandler();
    channelManager = new MockChannelManager();
  });

  it('registers a device at /dev/clawser/channels/{name}', () => {
    registerChannelDevice(handler, 'slack', channelManager);
    assert.ok(handler.isDevice('/dev/clawser/channels/slack'));
  });

  it('write sends message to channel', async () => {
    registerChannelDevice(handler, 'slack', channelManager);

    await handler.handleWrite('/dev/clawser/channels/slack', 'Deploy complete!');
    assert.equal(channelManager.sent.length, 1);
    assert.equal(channelManager.sent[0].channel, 'slack');
    assert.equal(channelManager.sent[0].message, 'Deploy complete!');
  });

  it('read returns empty when no messages received', async () => {
    registerChannelDevice(handler, 'slack', channelManager);

    const result = await handler.handleRead('/dev/clawser/channels/slack');
    assert.equal(result, '');
  });

  it('read returns most-recent inbound from channel manager history', async () => {
    registerChannelDevice(handler, 'slack', channelManager);

    // Simulate inbound — the device pulls from manager.getHistory
    channelManager.pushInbound({ channel: 'slack', sender: { name: 'alice' }, text: 'incoming' });

    const result = await handler.handleRead('/dev/clawser/channels/slack');
    assert.equal(result, 'alice\tincoming\n');

    // A newer message wins
    channelManager.pushInbound({ channel: 'slack', sender: { name: 'bob' }, text: 'newer' });
    const result2 = await handler.handleRead('/dev/clawser/channels/slack');
    assert.equal(result2, 'bob\tnewer\n');

    // Other channels are filtered out
    channelManager.pushInbound({ channel: 'discord', sender: { name: 'eve' }, text: 'wrong' });
    const result3 = await handler.handleRead('/dev/clawser/channels/slack');
    assert.equal(result3, 'bob\tnewer\n');
  });

  it('tracks lastSent in state', async () => {
    registerChannelDevice(handler, 'discord', channelManager);

    await handler.handleWrite('/dev/clawser/channels/discord', 'hello');
    const state = handler.getState('/dev/clawser/channels/discord');
    assert.equal(state.lastSent, 'hello');
  });

  it('deliverToChannel makes an inbound message readable', async () => {
    registerChannelDevice(handler, 'slack', channelManager);

    const delivered = handler.deliverToChannel('slack', 'incoming from slack');
    assert.equal(delivered, true);

    const result = await handler.handleRead('/dev/clawser/channels/slack');
    assert.equal(result, 'incoming from slack');
  });

  it('deliverToChannel returns false for an unregistered channel', () => {
    assert.equal(handler.deliverToChannel('nope', 'msg'), false);
  });

  it('deliverToChannel overwrites the previous message', async () => {
    registerChannelDevice(handler, 'slack', channelManager);

    handler.deliverToChannel('slack', 'first');
    handler.deliverToChannel('slack', 'second');

    const result = await handler.handleRead('/dev/clawser/channels/slack');
    assert.equal(result, 'second');
  });
});

// ── Hardware Device Files ─────────────────────────────────────────

describe('registerHardwareDevice', () => {
  let handler;

  beforeEach(() => {
    handler = new DeviceFileHandler();
  });

  it('registers a device at /dev/clawser/hardware/{name}', () => {
    const adapter = createMockHardwareAdapter();
    registerHardwareDevice(handler, 'serial0', adapter);
    assert.ok(handler.isDevice('/dev/clawser/hardware/serial0'));
  });

  it('write sends data to hardware', async () => {
    const adapter = createMockHardwareAdapter();
    registerHardwareDevice(handler, 'serial0', adapter);

    await handler.handleWrite('/dev/clawser/hardware/serial0', 'AT+RST');
    assert.deepEqual(adapter._buffer, ['AT+RST']);
  });

  it('read returns data from hardware', async () => {
    const adapter = createMockHardwareAdapter();
    adapter._buffer.push('OK');
    registerHardwareDevice(handler, 'serial0', adapter);

    const result = await handler.handleRead('/dev/clawser/hardware/serial0');
    assert.equal(result, 'OK');
  });

  it('read returns empty when no data', async () => {
    const adapter = createMockHardwareAdapter();
    registerHardwareDevice(handler, 'serial0', adapter);

    const result = await handler.handleRead('/dev/clawser/hardware/serial0');
    assert.equal(result, '');
  });
});

// ── Special Devices ───────────────────────────────────────────────

describe('registerSpecialDevices', () => {
  let handler;

  beforeEach(() => {
    handler = new DeviceFileHandler();
    registerSpecialDevices(handler);
  });

  it('registers /dev/clawser/null', () => {
    assert.ok(handler.isDevice('/dev/clawser/null'));
  });

  it('/dev/clawser/null discards writes', async () => {
    const result = await handler.handleWrite('/dev/clawser/null', 'noise');
    assert.equal(result, '');
  });

  it('/dev/clawser/null reads empty', async () => {
    const result = await handler.handleRead('/dev/clawser/null');
    assert.equal(result, '');
  });

  it('registers /dev/clawser/random', () => {
    assert.ok(handler.isDevice('/dev/clawser/random'));
  });

  it('/dev/clawser/random returns hex string', async () => {
    const result = await handler.handleRead('/dev/clawser/random');
    assert.ok(result.length === 64); // 32 bytes × 2 hex chars
    assert.ok(/^[0-9a-f]+$/.test(result));
  });

  it('/dev/clawser/random returns different values', async () => {
    const a = await handler.handleRead('/dev/clawser/random');
    const b = await handler.handleRead('/dev/clawser/random');
    // Astronomically unlikely to be equal
    assert.notEqual(a, b);
  });

  it('registers /dev/clawser/zero', () => {
    assert.ok(handler.isDevice('/dev/clawser/zero'));
  });

  it('/dev/clawser/zero returns null bytes', async () => {
    const result = await handler.handleRead('/dev/clawser/zero');
    assert.equal(result.length, 256);
    assert.ok(result.split('').every(c => c === '\0'));
  });
});

// ── VirtualFs Integration ─────────────────────────────────────────

describe('VirtualFs with DeviceFileHandler', () => {
  let realFs;
  let proc;
  let devices;
  let vfs;

  beforeEach(() => {
    realFs = new SimpleMemoryFs();
    proc = new ProcFileHandler();
    devices = new DeviceFileHandler();
    registerSpecialDevices(devices);

    // Register a simple test device
    devices.register('/dev/clawser/echo', {
      state: { last: '' },
      write: async (content, state) => { state.last = content; return ''; },
      read: async (state) => state.last,
    });

    vfs = new VirtualFs(realFs, proc, devices);
  });

  it('readFile dispatches to device handler', async () => {
    devices.register('/dev/clawser/echo', {
      state: { last: 'test-data' },
      write: async () => '',
      read: async (state) => state.last,
    });
    // Need to recreate VFS since we re-registered
    vfs = new VirtualFs(realFs, proc, devices);

    const result = await vfs.readFile('/dev/clawser/echo');
    assert.equal(result, 'test-data');
  });

  it('writeFile dispatches to device handler', async () => {
    await vfs.writeFile('/dev/clawser/echo', 'written-data');
    const state = devices.getState('/dev/clawser/echo');
    assert.equal(state.last, 'written-data');
  });

  it('writeFile to /dev/clawser/null works (no error)', async () => {
    await vfs.writeFile('/dev/clawser/null', 'discarded');
    const result = await vfs.readFile('/dev/clawser/null');
    assert.equal(result, '');
  });

  it('readFile from /dev/clawser/random returns hex', async () => {
    const result = await vfs.readFile('/dev/clawser/random');
    assert.ok(/^[0-9a-f]{64}$/.test(result));
  });

  it('writeFile to non-device paths goes to real FS', async () => {
    await vfs.writeFile('/home/test.txt', 'hello');
    const result = await vfs.readFile('/home/test.txt');
    assert.equal(result, 'hello');
  });

  it('writeFile to /proc paths still throws read-only', async () => {
    proc.register('/proc/clawser/version', () => '1.0');
    await assert.rejects(
      () => vfs.writeFile('/proc/clawser/version', 'overwrite'),
      /Read-only/,
    );
  });

  it('readFile falls through proc → device → realFs', async () => {
    proc.register('/proc/clawser/test', () => 'from-proc');
    await realFs.writeFile('/some/file.txt', 'from-real');

    assert.equal(await vfs.readFile('/proc/clawser/test'), 'from-proc');
    assert.equal(await vfs.readFile('/some/file.txt'), 'from-real');
  });

  it('listDir shows device entries', () => {
    const entries = vfs.listDir('/dev/clawser');
    // Should resolve (async listDir)
    return entries.then(result => {
      assert.ok(result.some(e => e.name === 'null'));
      assert.ok(result.some(e => e.name === 'random'));
      assert.ok(result.some(e => e.name === 'zero'));
      assert.ok(result.some(e => e.name === 'echo'));
    });
  });

  it('stat returns file for registered device', async () => {
    const s = await vfs.stat('/dev/clawser/null');
    assert.equal(s.kind, 'file');
  });

  it('stat returns directory for device directory', async () => {
    devices.register('/dev/clawser/providers/mock', {
      write: async () => '',
      read: async () => '',
    });
    vfs = new VirtualFs(realFs, proc, devices);

    const s = await vfs.stat('/dev/clawser/providers');
    assert.equal(s.kind, 'directory');
  });

  it('mkdir on device path throws', async () => {
    await assert.rejects(
      () => vfs.mkdir('/dev/clawser/newdir'),
      /Cannot mkdir in device filesystem/,
    );
  });

  it('delete on device path throws', async () => {
    await assert.rejects(
      () => vfs.delete('/dev/clawser/null'),
      /Cannot delete device file/,
    );
  });

  it('move from device path throws', async () => {
    await assert.rejects(
      () => vfs.move('/dev/clawser/null', '/tmp/moved'),
      /Cannot move device file/,
    );
  });

  it('copy from device to real FS works', async () => {
    // Write data to echo device
    await vfs.writeFile('/dev/clawser/echo', 'copy-me');
    // Copy device content to real FS
    await vfs.copy('/dev/clawser/echo', '/tmp/copied.txt');
    const result = await vfs.readFile('/tmp/copied.txt');
    assert.equal(result, 'copy-me');
  });

  it('copy from real FS to device works (write dispatch)', async () => {
    await realFs.writeFile('/tmp/source.txt', 'source-data');
    await vfs.copy('/tmp/source.txt', '/dev/clawser/echo');
    const state = devices.getState('/dev/clawser/echo');
    assert.equal(state.last, 'source-data');
  });

  it('devices getter exposes device handler', () => {
    assert.equal(vfs.devices, devices);
  });
});

// ── Shell Integration ─────────────────────────────────────────────

describe('Shell integration with device files', () => {
  // These tests verify that the shell redirect mechanism works with
  // device files via VirtualFs. We test the redirect handling by
  // constructing the same flow the shell executor uses.

  let realFs;
  let proc;
  let devices;
  let vfs;
  let registry;

  beforeEach(() => {
    realFs = new SimpleMemoryFs();
    proc = new ProcFileHandler();
    devices = new DeviceFileHandler();
    registerSpecialDevices(devices);

    registry = new MockProviderRegistry();
    registry.register(new MockProvider());
    registerProviderDevice(devices, 'mock', registry);

    vfs = new VirtualFs(realFs, proc, devices);
  });

  it('echo > /dev/clawser/providers/mock then cat works', async () => {
    // Simulate: echo "What is 2+2?" > /dev/clawser/providers/mock
    await vfs.writeFile('/dev/clawser/providers/mock', 'What is 2+2?');

    // Simulate: cat /dev/clawser/providers/mock
    const response = await vfs.readFile('/dev/clawser/providers/mock');
    assert.ok(response.includes('Mock response to: What is 2+2?'));
  });

  it('redirect to /dev/clawser/null discards output', async () => {
    await vfs.writeFile('/dev/clawser/null', 'should be discarded');
    const result = await vfs.readFile('/dev/clawser/null');
    assert.equal(result, '');
  });

  it('provider chaining: output of one → input of another', async () => {
    registry.register({ name: 'echo2', async chat(req) {
      const lastUser = [...(req.messages || [])].reverse().find(m => m.role === 'user');
      return { content: `echo2: ${lastUser?.content}`, tool_calls: [], usage: { input_tokens: 0, output_tokens: 0 }, model: 'echo2' };
    }});
    registerProviderDevice(devices, 'echo2', registry);
    vfs = new VirtualFs(realFs, proc, devices);

    // echo "hello" > /dev/clawser/providers/mock
    await vfs.writeFile('/dev/clawser/providers/mock', 'hello');
    // cat /dev/clawser/providers/mock > /dev/clawser/providers/echo2
    const intermediate = await vfs.readFile('/dev/clawser/providers/mock');
    await vfs.writeFile('/dev/clawser/providers/echo2', intermediate);
    // cat /dev/clawser/providers/echo2
    const final = await vfs.readFile('/dev/clawser/providers/echo2');
    assert.ok(final.includes('echo2:'));
    assert.ok(final.includes('Mock response'));
  });

  it('cat /dev/clawser/random produces output for piping', async () => {
    const hex = await vfs.readFile('/dev/clawser/random');
    // Could pipe to a file
    await vfs.writeFile('/tmp/random.txt', hex);
    const saved = await vfs.readFile('/tmp/random.txt');
    assert.equal(saved, hex);
  });
});

// ── initDeviceFs ──────────────────────────────────────────────────

describe('initDeviceFs (from clawser-runtime)', async () => {
  // Dynamic import to test the runtime integration
  const { initDeviceFs, addProviderDevice, addChannelDevice } = await import('../clawser-runtime.js');

  it('returns a DeviceFileHandler with special devices', () => {
    const handler = initDeviceFs();
    assert.ok(handler.isDevice('/dev/clawser/null'));
    assert.ok(handler.isDevice('/dev/clawser/random'));
    assert.ok(handler.isDevice('/dev/clawser/zero'));
  });

  it('registers provider devices from registry', () => {
    const registry = new MockProviderRegistry();
    registry.register(new MockProvider());
    const handler = initDeviceFs({ providerRegistry: registry });
    assert.ok(handler.isDevice('/dev/clawser/providers/mock'));
  });

  it('registers channel devices from channelManager', () => {
    const channelManager = new MockChannelManager();
    const handler = initDeviceFs({ channelManager });
    assert.ok(handler.isDevice('/dev/clawser/channels/slack'));
    assert.ok(handler.isDevice('/dev/clawser/channels/discord'));
    assert.ok(handler.isDevice('/dev/clawser/channels/telegram'));
  });

  it('registers hardware devices from adapters map', () => {
    const adapters = new Map([['serial0', createMockHardwareAdapter()]]);
    const handler = initDeviceFs({ hardwareAdapters: adapters });
    assert.ok(handler.isDevice('/dev/clawser/hardware/serial0'));
  });

  it('addProviderDevice registers a new device dynamically', () => {
    const registry = new MockProviderRegistry();
    registry.register(new MockProvider());
    const handler = initDeviceFs();
    assert.ok(!handler.isDevice('/dev/clawser/providers/mock'));

    addProviderDevice(handler, 'mock', registry);
    assert.ok(handler.isDevice('/dev/clawser/providers/mock'));
  });

  it('addChannelDevice registers a new channel dynamically', () => {
    const channelManager = new MockChannelManager();
    const handler = initDeviceFs();
    assert.ok(!handler.isDevice('/dev/clawser/channels/custom'));

    addChannelDevice(handler, 'custom', channelManager);
    assert.ok(handler.isDevice('/dev/clawser/channels/custom'));
  });

  it('full round-trip: provider device through initDeviceFs', async () => {
    const registry = new MockProviderRegistry();
    registry.register(new MockProvider());
    const handler = initDeviceFs({ providerRegistry: registry });

    await handler.handleWrite('/dev/clawser/providers/mock', 'test prompt');
    const response = await handler.handleRead('/dev/clawser/providers/mock');
    assert.ok(response.includes('Mock response to: test prompt'));
  });
});
