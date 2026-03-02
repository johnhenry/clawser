// Run with: node --import ./web/test/_setup-globals.mjs --test web/test/clawser-shared-worker.test.mjs
import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

// ── Stub MessagePort / MessageChannel for Node ─────────────────

class MockPort {
  #handlers = {};
  #otherPort = null;
  #started = false;

  set onmessage(fn) { this.#handlers.message = fn; }
  get onmessage() { return this.#handlers.message || null; }
  set onerror(fn) { this.#handlers.error = fn; }

  start() { this.#started = true; }
  close() { this.#started = false; }

  postMessage(data) {
    if (this.#otherPort?.onmessage) {
      queueMicrotask(() => this.#otherPort.onmessage({ data }));
    }
  }

  addEventListener(type, fn) { this.#handlers[type] = fn; }
  removeEventListener(type) { delete this.#handlers[type]; }

  _link(other) { this.#otherPort = other; }
  _receive(data) {
    if (this.#handlers.message) this.#handlers.message({ data });
  }
}

globalThis.MessageChannel = class {
  constructor() {
    this.port1 = new MockPort();
    this.port2 = new MockPort();
    this.port1._link(this.port2);
    this.port2._link(this.port1);
  }
};

// ── Import modules under test ──────────────────────────────────

import {
  SharedWorkerHost,
  MSG_TYPES,
} from '../shared-worker.js';

import {
  SharedWorkerClient,
} from '../clawser-shared-worker-client.js';

// ── MSG_TYPES ──────────────────────────────────────────────────

describe('MSG_TYPES', () => {
  it('has expected message type constants', () => {
    assert.equal(MSG_TYPES.USER_MESSAGE, 'user_message');
    assert.equal(MSG_TYPES.STREAM_CHUNK, 'stream_chunk');
    assert.equal(MSG_TYPES.STATE, 'state');
    assert.equal(MSG_TYPES.SHELL_EXEC, 'shell_exec');
    assert.equal(MSG_TYPES.RESPONSE, 'response');
    assert.equal(MSG_TYPES.ERROR, 'error');
  });

  it('is frozen', () => {
    assert.ok(Object.isFrozen(MSG_TYPES));
  });
});

// ── SharedWorkerHost ────────────────────────────────────────────

describe('SharedWorkerHost', () => {
  let host;

  beforeEach(() => {
    host = new SharedWorkerHost();
  });

  it('constructor initializes with zero ports', () => {
    assert.equal(host.portCount, 0);
  });

  it('addPort registers a message port', () => {
    const port = new MockPort();
    host.addPort(port);
    assert.equal(host.portCount, 1);
  });

  it('addPort starts the port', () => {
    const port = new MockPort();
    let started = false;
    port.start = () => { started = true; };
    host.addPort(port);
    assert.equal(started, true);
  });

  it('removePort unregisters a port', () => {
    const port = new MockPort();
    host.addPort(port);
    assert.equal(host.portCount, 1);
    host.removePort(port);
    assert.equal(host.portCount, 0);
  });

  it('broadcast sends message to all connected ports', () => {
    const received = [];
    const port1 = new MockPort();
    const port2 = new MockPort();
    port1.postMessage = (d) => received.push({ port: 1, data: d });
    port2.postMessage = (d) => received.push({ port: 2, data: d });

    host.addPort(port1);
    host.addPort(port2);
    host.broadcast({ type: MSG_TYPES.STATE, payload: { status: 'idle' } });

    assert.equal(received.length, 2);
    assert.equal(received[0].data.type, MSG_TYPES.STATE);
    assert.equal(received[1].data.type, MSG_TYPES.STATE);
  });

  it('broadcast excludes specified port', () => {
    const received = [];
    const port1 = new MockPort();
    const port2 = new MockPort();
    port1.postMessage = (d) => received.push({ port: 1, data: d });
    port2.postMessage = (d) => received.push({ port: 2, data: d });

    host.addPort(port1);
    host.addPort(port2);
    host.broadcast({ type: MSG_TYPES.STATE, payload: {} }, port1);

    assert.equal(received.length, 1);
    assert.equal(received[0].port, 2);
  });

  it('sendTo sends message to a specific port', () => {
    let received = null;
    const port = new MockPort();
    port.postMessage = (d) => { received = d; };

    host.addPort(port);
    host.sendTo(port, { type: MSG_TYPES.RESPONSE, payload: { text: 'hello' } });

    assert.ok(received);
    assert.equal(received.type, MSG_TYPES.RESPONSE);
    assert.equal(received.payload.text, 'hello');
  });

  it('onMessage handler is called for incoming messages', async () => {
    const messages = [];
    host.onMessage = (port, msg) => messages.push({ port, msg });

    const port = new MockPort();
    host.addPort(port);

    // Simulate incoming message
    host._handleMessage(port, { type: MSG_TYPES.USER_MESSAGE, payload: { text: 'hi' } });

    assert.equal(messages.length, 1);
    assert.equal(messages[0].msg.type, MSG_TYPES.USER_MESSAGE);
  });

  it('getState returns current host state', () => {
    const state = host.getState();
    assert.equal(typeof state.portCount, 'number');
    assert.equal(typeof state.uptime, 'number');
    assert.ok(Array.isArray(state.portIds));
  });

  it('destroy closes all ports', () => {
    const closed = [];
    const port1 = new MockPort();
    const port2 = new MockPort();
    port1.close = () => closed.push(1);
    port2.close = () => closed.push(2);

    host.addPort(port1);
    host.addPort(port2);
    host.destroy();

    assert.equal(closed.length, 2);
    assert.equal(host.portCount, 0);
  });
});

// ── SharedWorkerClient ──────────────────────────────────────────

describe('SharedWorkerClient', () => {
  let client;
  let mockPort;

  beforeEach(() => {
    mockPort = new MockPort();
    client = new SharedWorkerClient(mockPort);
  });

  it('constructs with a port', () => {
    assert.ok(client);
    assert.equal(client.connected, true);
  });

  it('sendMessage posts a user_message to the port', () => {
    let sent = null;
    mockPort.postMessage = (d) => { sent = d; };
    client.sendMessage('hello world');
    assert.ok(sent);
    assert.equal(sent.type, MSG_TYPES.USER_MESSAGE);
    assert.equal(sent.payload.text, 'hello world');
  });

  it('requestState posts a state request', () => {
    let sent = null;
    mockPort.postMessage = (d) => { sent = d; };
    client.requestState();
    assert.ok(sent);
    assert.equal(sent.type, MSG_TYPES.STATE);
  });

  it('execShell posts a shell_exec request', () => {
    let sent = null;
    mockPort.postMessage = (d) => { sent = d; };
    client.execShell('ls -la');
    assert.ok(sent);
    assert.equal(sent.type, MSG_TYPES.SHELL_EXEC);
    assert.equal(sent.payload.command, 'ls -la');
  });

  it('on/off registers and removes event listeners', () => {
    let received = null;
    const handler = (data) => { received = data; };
    client.on(MSG_TYPES.RESPONSE, handler);
    client._handleIncoming({ type: MSG_TYPES.RESPONSE, payload: { text: 'test' } });
    assert.ok(received);
    assert.equal(received.text, 'test');

    received = null;
    client.off(MSG_TYPES.RESPONSE, handler);
    client._handleIncoming({ type: MSG_TYPES.RESPONSE, payload: { text: 'test2' } });
    assert.equal(received, null);
  });

  it('onStream callback receives stream chunks', () => {
    const chunks = [];
    client.onStream = (chunk) => chunks.push(chunk);
    client._handleIncoming({ type: MSG_TYPES.STREAM_CHUNK, payload: { delta: 'Hello' } });
    client._handleIncoming({ type: MSG_TYPES.STREAM_CHUNK, payload: { delta: ' world' } });
    assert.equal(chunks.length, 2);
    assert.equal(chunks[0].delta, 'Hello');
  });

  it('disconnect sets connected to false', () => {
    client.disconnect();
    assert.equal(client.connected, false);
  });

  it('sendMessage after disconnect throws', () => {
    client.disconnect();
    assert.throws(() => client.sendMessage('should not send'), /not connected/);
  });
});
