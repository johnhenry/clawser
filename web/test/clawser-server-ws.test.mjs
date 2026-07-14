// Run with: node --import ./web/test/_setup-globals.mjs --test web/test/clawser-server-ws.test.mjs
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import {
  ServerWebSocket,
  ClientWebSocket,
  ServerWebSocketServer,
  WS_READY_STATE,
} from '../clawser-server-ws.js';

// ── Mock BroadcastChannel ────────────────────────────────────────

class MockBroadcastChannel {
  static _channels = new Map(); // name → Set<MockBroadcastChannel>

  constructor(name) {
    this.name = name;
    this._listeners = [];
    this._closed = false;
    if (!MockBroadcastChannel._channels.has(name)) {
      MockBroadcastChannel._channels.set(name, new Set());
    }
    MockBroadcastChannel._channels.get(name).add(this);
  }

  addEventListener(event, cb) {
    if (event === 'message') this._listeners.push(cb);
  }

  removeEventListener(event, cb) {
    if (event === 'message') {
      this._listeners = this._listeners.filter(f => f !== cb);
    }
  }

  postMessage(data) {
    if (this._closed) return;
    const peers = MockBroadcastChannel._channels.get(this.name) || new Set();
    for (const peer of peers) {
      if (peer === this || peer._closed) continue;
      // Simulate async delivery like real BroadcastChannel
      const event = { data: JSON.parse(JSON.stringify(data)) };
      for (const cb of peer._listeners) {
        queueMicrotask(() => cb(event));
      }
    }
  }

  close() {
    this._closed = true;
    const set = MockBroadcastChannel._channels.get(this.name);
    if (set) set.delete(this);
  }

  static reset() {
    for (const [, set] of MockBroadcastChannel._channels) {
      for (const ch of set) ch._closed = true;
    }
    MockBroadcastChannel._channels.clear();
  }
}

// ── Mock MessageChannel / MessagePort ────────────────────────────

class MockMessagePort {
  constructor() {
    this._listeners = [];
    this._peer = null;
  }

  addEventListener(event, cb) {
    if (event === 'message') this._listeners.push(cb);
  }

  removeEventListener(event, cb) {
    if (event === 'message') {
      this._listeners = this._listeners.filter(f => f !== cb);
    }
  }

  postMessage(data) {
    if (!this._peer) return;
    const event = { data: JSON.parse(JSON.stringify(data)) };
    for (const cb of this._peer._listeners) {
      queueMicrotask(() => cb(event));
    }
  }

  start() {}
  close() { this._peer = null; }
}

const createMockMessageChannel = () => {
  const port1 = new MockMessagePort();
  const port2 = new MockMessagePort();
  port1._peer = port2;
  port2._peer = port1;
  return { port1, port2 };
};

// ── Helpers ──────────────────────────────────────────────────────

const wait = (ms = 10) => new Promise(r => setTimeout(r, ms));

// ── Tests ────────────────────────────────────────────────────────

describe('ServerWebSocket', () => {
  it('starts in OPEN state', () => {
    const sent = [];
    const ws = new ServerWebSocket('c1', (msg) => sent.push(msg));
    assert.equal(ws.readyState, WS_READY_STATE.OPEN);
    assert.equal(ws.connId, 'c1');
  });

  it('sends text messages', () => {
    const sent = [];
    const ws = new ServerWebSocket('c1', (msg) => sent.push(msg));
    ws.send('hello');
    assert.equal(sent.length, 1);
    assert.equal(sent[0].type, 'ws:message');
    assert.equal(sent[0].data, 'hello');
    assert.equal(sent[0].binary, false);
  });

  it('sends binary messages', () => {
    const sent = [];
    const ws = new ServerWebSocket('c1', (msg) => sent.push(msg));
    const buf = new Uint8Array([1, 2, 3]).buffer;
    ws.send(buf);
    assert.equal(sent.length, 1);
    assert.equal(sent[0].binary, true);
    assert.deepEqual(sent[0].data, [1, 2, 3]);
  });

  it('throws when sending on closed socket', () => {
    const ws = new ServerWebSocket('c1', () => {});
    ws.close();
    assert.throws(() => ws.send('nope'), /not open/i);
  });

  it('fires close event on close()', () => {
    const events = [];
    const ws = new ServerWebSocket('c1', () => {});
    ws.onclose = (e) => events.push(e);
    ws.close(1000, 'bye');
    assert.equal(ws.readyState, WS_READY_STATE.CLOSED);
    assert.equal(events.length, 1);
    assert.equal(events[0].code, 1000);
    assert.equal(events[0].reason, 'bye');
  });

  it('fires message events on _receiveMessage', () => {
    const msgs = [];
    const ws = new ServerWebSocket('c1', () => {});
    ws.onmessage = (e) => msgs.push(e.data);
    ws._receiveMessage({ data: 'hi', binary: false });
    assert.equal(msgs.length, 1);
    assert.equal(msgs[0], 'hi');
  });

  it('handles addEventListener / removeEventListener', () => {
    const ws = new ServerWebSocket('c1', () => {});
    const msgs = [];
    const handler = (e) => msgs.push(e.data);
    ws.addEventListener('message', handler);
    ws._receiveMessage({ data: 'a', binary: false });
    assert.equal(msgs.length, 1);
    ws.removeEventListener('message', handler);
    ws._receiveMessage({ data: 'b', binary: false });
    assert.equal(msgs.length, 1); // not incremented
  });

  it('auto-replies pong on ping', () => {
    const sent = [];
    const ws = new ServerWebSocket('c1', (msg) => sent.push(msg));
    ws._receivePing();
    assert.equal(sent.length, 1);
    assert.equal(sent[0].type, 'ws:pong');
  });

  it('reports protocol', () => {
    const ws = new ServerWebSocket('c1', () => {}, 'graphql-ws');
    assert.equal(ws.protocol, 'graphql-ws');
  });

  it('_terminate sends close and fires event', () => {
    const sent = [];
    const events = [];
    const ws = new ServerWebSocket('c1', (msg) => sent.push(msg));
    ws.onclose = (e) => events.push(e);
    ws._terminate(1001, 'going away');
    assert.equal(ws.readyState, WS_READY_STATE.CLOSED);
    assert.equal(sent.length, 1);
    assert.equal(sent[0].type, 'ws:close');
    assert.equal(events[0].wasClean, false);
  });

  it('ignores messages after close', () => {
    const msgs = [];
    const ws = new ServerWebSocket('c1', () => {});
    ws.onmessage = (e) => msgs.push(e);
    ws.close();
    ws._receiveMessage({ data: 'late', binary: false });
    assert.equal(msgs.length, 0);
  });
});

describe('ClientWebSocket', () => {
  it('starts in CONNECTING state and sends connect', () => {
    const sent = [];
    const client = new ClientWebSocket({
      url: 'ws://test/',
      protocols: ['proto1'],
      postMessage: (msg) => sent.push(msg),
      onWire: () => () => {},
    });
    assert.equal(client.readyState, WS_READY_STATE.CONNECTING);
    assert.equal(sent.length, 1);
    assert.equal(sent[0].type, 'ws:connect');
    assert.deepEqual(sent[0].protocols, ['proto1']);
  });

  it('transitions to OPEN on ws:accept', async () => {
    let wireHandler;
    const client = new ClientWebSocket({
      url: 'ws://test/',
      postMessage: () => {},
      onWire: (handler) => { wireHandler = handler; return () => {}; },
    });
    wireHandler({ type: 'ws:accept', connId: client.connId, protocol: 'p1' });
    await wait();
    assert.equal(client.readyState, WS_READY_STATE.OPEN);
    assert.equal(client.protocol, 'p1');
  });

  it('fires error and close on ws:reject', async () => {
    let wireHandler;
    const errors = [];
    const closes = [];
    const client = new ClientWebSocket({
      postMessage: () => {},
      onWire: (handler) => { wireHandler = handler; return () => {}; },
    });
    client.onerror = (e) => errors.push(e);
    client.onclose = (e) => closes.push(e);
    wireHandler({ type: 'ws:reject', connId: client.connId, code: 403, reason: 'forbidden' });
    await wait();
    assert.equal(client.readyState, WS_READY_STATE.CLOSED);
    assert.equal(errors.length, 1);
    assert.equal(closes.length, 1);
    assert.equal(closes[0].wasClean, false);
  });

  it('sends and receives messages', async () => {
    let wireHandler;
    const sent = [];
    const received = [];
    const client = new ClientWebSocket({
      postMessage: (msg) => sent.push(msg),
      onWire: (handler) => { wireHandler = handler; return () => {}; },
    });
    // Accept connection
    wireHandler({ type: 'ws:accept', connId: client.connId });
    await wait();

    client.onmessage = (e) => received.push(e.data);

    // Client sends
    client.send('ping');
    assert.equal(sent.length, 2); // connect + message
    assert.equal(sent[1].type, 'ws:message');

    // Client receives
    wireHandler({ type: 'ws:message', connId: client.connId, data: 'pong', binary: false });
    await wait();
    assert.equal(received.length, 1);
    assert.equal(received[0], 'pong');
  });

  it('throws when sending before OPEN', () => {
    const client = new ClientWebSocket({
      postMessage: () => {},
      onWire: () => () => {},
    });
    assert.throws(() => client.send('nope'), /not open/i);
  });

  it('has static state constants', () => {
    assert.equal(ClientWebSocket.CONNECTING, 0);
    assert.equal(ClientWebSocket.OPEN, 1);
    assert.equal(ClientWebSocket.CLOSING, 2);
    assert.equal(ClientWebSocket.CLOSED, 3);
  });

  it('auto-replies pong on ping', async () => {
    let wireHandler;
    const sent = [];
    const client = new ClientWebSocket({
      postMessage: (msg) => sent.push(msg),
      onWire: (handler) => { wireHandler = handler; return () => {}; },
    });
    wireHandler({ type: 'ws:accept', connId: client.connId });
    await wait();
    wireHandler({ type: 'ws:ping', connId: client.connId });
    await wait();
    const pongs = sent.filter(m => m.type === 'ws:pong');
    assert.equal(pongs.length, 1);
  });
});

describe('ServerWebSocketServer', () => {
  afterEach(() => MockBroadcastChannel.reset());

  it('requires channelName', () => {
    assert.throws(() => new ServerWebSocketServer({}), /channelName/);
  });

  it('starts not listening', () => {
    const wss = new ServerWebSocketServer({
      channelName: 'test',
      _BroadcastChannel: MockBroadcastChannel,
    });
    assert.equal(wss.listening, false);
    assert.equal(wss.connectionCount, 0);
  });

  it('listen() sets listening = true', () => {
    const wss = new ServerWebSocketServer({
      channelName: 'test',
      pingIntervalMs: 0,
      _BroadcastChannel: MockBroadcastChannel,
    });
    wss.listen();
    assert.equal(wss.listening, true);
    wss.close();
  });

  it('accepts connections over BroadcastChannel', async () => {
    const wss = new ServerWebSocketServer({
      channelName: 'test-accept',
      pingIntervalMs: 0,
      _BroadcastChannel: MockBroadcastChannel,
    });

    const connections = [];
    wss.on('connection', (socket) => connections.push(socket));
    wss.listen();

    // Simulate a client connecting
    const clientBC = new MockBroadcastChannel('test-accept');
    const clientMsgs = [];
    clientBC.addEventListener('message', (e) => clientMsgs.push(e.data));

    clientBC.postMessage({ type: 'ws:connect', connId: 'client1', protocols: [] });
    await wait();

    assert.equal(connections.length, 1);
    assert.equal(connections[0].readyState, WS_READY_STATE.OPEN);
    assert.equal(wss.connectionCount, 1);

    // Client should have received ws:accept
    assert.equal(clientMsgs.length, 1);
    assert.equal(clientMsgs[0].type, 'ws:accept');
    assert.equal(clientMsgs[0].connId, 'client1');

    wss.close();
    clientBC.close();
  });

  it('negotiates sub-protocol', async () => {
    const wss = new ServerWebSocketServer({
      channelName: 'test-proto',
      protocols: ['graphql-ws', 'json-rpc'],
      pingIntervalMs: 0,
      _BroadcastChannel: MockBroadcastChannel,
    });

    const sockets = [];
    wss.on('connection', (s) => sockets.push(s));
    wss.listen();

    const clientBC = new MockBroadcastChannel('test-proto');
    const replies = [];
    clientBC.addEventListener('message', (e) => replies.push(e.data));
    clientBC.postMessage({ type: 'ws:connect', connId: 'p1', protocols: ['json-rpc', 'mqtt'] });
    await wait();

    assert.equal(sockets[0].protocol, 'json-rpc');
    assert.equal(replies[0].protocol, 'json-rpc');

    wss.close();
    clientBC.close();
  });

  it('relays messages between server and client', async () => {
    const wss = new ServerWebSocketServer({
      channelName: 'test-relay',
      pingIntervalMs: 0,
      _BroadcastChannel: MockBroadcastChannel,
    });

    wss.on('connection', (socket) => {
      socket.onmessage = (e) => socket.send(`echo: ${e.data}`);
    });
    wss.listen();

    const clientBC = new MockBroadcastChannel('test-relay');
    const replies = [];
    clientBC.addEventListener('message', (e) => replies.push(e.data));

    // Connect
    clientBC.postMessage({ type: 'ws:connect', connId: 'r1', protocols: [] });
    await wait();

    // Send message from client
    clientBC.postMessage({ type: 'ws:message', connId: 'r1', data: 'hello', binary: false });
    await wait();

    const msgs = replies.filter(r => r.type === 'ws:message');
    assert.equal(msgs.length, 1);
    assert.equal(msgs[0].data, 'echo: hello');

    wss.close();
    clientBC.close();
  });

  it('handles client disconnect', async () => {
    const wss = new ServerWebSocketServer({
      channelName: 'test-disconnect',
      pingIntervalMs: 0,
      _BroadcastChannel: MockBroadcastChannel,
    });

    const closeEvents = [];
    wss.on('connection', (socket) => {
      socket.onclose = (e) => closeEvents.push(e);
    });
    wss.listen();

    const clientBC = new MockBroadcastChannel('test-disconnect');
    clientBC.postMessage({ type: 'ws:connect', connId: 'd1', protocols: [] });
    await wait();
    assert.equal(wss.connectionCount, 1);

    clientBC.postMessage({ type: 'ws:close', connId: 'd1', code: 1000, reason: 'bye' });
    await wait();

    assert.equal(wss.connectionCount, 0);
    assert.equal(closeEvents.length, 1);
    assert.equal(closeEvents[0].code, 1000);

    wss.close();
    clientBC.close();
  });

  it('broadcast() sends to all connections', async () => {
    const wss = new ServerWebSocketServer({
      channelName: 'test-broadcast',
      pingIntervalMs: 0,
      _BroadcastChannel: MockBroadcastChannel,
    });
    wss.listen();

    const clientBC = new MockBroadcastChannel('test-broadcast');
    const msgs = [];
    clientBC.addEventListener('message', (e) => msgs.push(e.data));

    // Two connections
    clientBC.postMessage({ type: 'ws:connect', connId: 'b1', protocols: [] });
    clientBC.postMessage({ type: 'ws:connect', connId: 'b2', protocols: [] });
    await wait();
    assert.equal(wss.connectionCount, 2);

    wss.broadcast('to all');
    await wait(20);
    const broadcastMsgs = msgs.filter(m => m.type === 'ws:message' && m.data === 'to all');
    assert.equal(broadcastMsgs.length, 2);

    wss.close();
    clientBC.close();
  });

  it('broadcast() respects exclude set', async () => {
    const wss = new ServerWebSocketServer({
      channelName: 'test-exclude',
      pingIntervalMs: 0,
      _BroadcastChannel: MockBroadcastChannel,
    });
    wss.listen();

    const clientBC = new MockBroadcastChannel('test-exclude');
    const msgs = [];
    clientBC.addEventListener('message', (e) => msgs.push(e.data));

    clientBC.postMessage({ type: 'ws:connect', connId: 'e1', protocols: [] });
    clientBC.postMessage({ type: 'ws:connect', connId: 'e2', protocols: [] });
    await wait();

    wss.broadcast('selective', { exclude: new Set(['e1']) });
    await wait(20);
    const broadcastMsgs = msgs.filter(m => m.type === 'ws:message' && m.data === 'selective');
    assert.equal(broadcastMsgs.length, 1);
    assert.equal(broadcastMsgs[0].connId, 'e2');

    wss.close();
    clientBC.close();
  });

  it('close() terminates all connections', async () => {
    const wss = new ServerWebSocketServer({
      channelName: 'test-server-close',
      pingIntervalMs: 0,
      _BroadcastChannel: MockBroadcastChannel,
    });

    const closeEvents = [];
    wss.on('connection', (socket) => {
      socket.onclose = (e) => closeEvents.push(e);
    });
    wss.listen();

    const clientBC = new MockBroadcastChannel('test-server-close');
    clientBC.postMessage({ type: 'ws:connect', connId: 'sc1', protocols: [] });
    clientBC.postMessage({ type: 'ws:connect', connId: 'sc2', protocols: [] });
    await wait();

    wss.close(1001, 'shutting down');
    assert.equal(wss.connectionCount, 0);
    assert.equal(wss.listening, false);
    assert.equal(closeEvents.length, 2);

    clientBC.close();
  });

  it('getConnection() retrieves by ID', async () => {
    const wss = new ServerWebSocketServer({
      channelName: 'test-get',
      pingIntervalMs: 0,
      _BroadcastChannel: MockBroadcastChannel,
    });
    wss.listen();

    const clientBC = new MockBroadcastChannel('test-get');
    clientBC.postMessage({ type: 'ws:connect', connId: 'g1', protocols: [] });
    await wait();

    const socket = wss.getConnection('g1');
    assert.ok(socket);
    assert.equal(socket.connId, 'g1');
    assert.equal(wss.getConnection('nonexistent'), undefined);

    wss.close();
    clientBC.close();
  });

  it('addPort() accepts MessagePort connections', async () => {
    const wss = new ServerWebSocketServer({
      channelName: 'test-port',
      pingIntervalMs: 0,
      _BroadcastChannel: MockBroadcastChannel,
    });
    wss.listen();

    const { port1, port2 } = createMockMessageChannel();
    wss.addPort(port2);

    const replies = [];
    port1.addEventListener('message', (e) => replies.push(e.data));

    port1.postMessage({ type: 'ws:connect', connId: 'mp1', protocols: [] });
    await wait();

    assert.equal(wss.connectionCount, 1);
    const acceptMsgs = replies.filter(r => r.type === 'ws:accept');
    assert.equal(acceptMsgs.length, 1);

    // Send a message through the port
    port1.postMessage({ type: 'ws:message', connId: 'mp1', data: 'via port', binary: false });
    await wait();

    wss.close();
  });
});

describe('ServerWebSocketServer.createClient (BroadcastChannel integration)', () => {
  afterEach(() => MockBroadcastChannel.reset());

  it('creates a client that connects to the server', async () => {
    const wss = new ServerWebSocketServer({
      channelName: 'int-test',
      pingIntervalMs: 0,
      _BroadcastChannel: MockBroadcastChannel,
    });

    const serverConns = [];
    wss.on('connection', (s) => serverConns.push(s));
    wss.listen();

    const client = ServerWebSocketServer.createClient({
      channelName: 'int-test',
      _BroadcastChannel: MockBroadcastChannel,
    });

    await wait(20);

    assert.equal(client.readyState, WS_READY_STATE.OPEN);
    assert.equal(serverConns.length, 1);

    client.close();
    wss.close();
  });

  it('full echo round-trip', async () => {
    const wss = new ServerWebSocketServer({
      channelName: 'echo-test',
      pingIntervalMs: 0,
      _BroadcastChannel: MockBroadcastChannel,
    });

    wss.on('connection', (socket) => {
      socket.onmessage = (e) => socket.send(`echo: ${e.data}`);
    });
    wss.listen();

    const client = ServerWebSocketServer.createClient({
      channelName: 'echo-test',
      _BroadcastChannel: MockBroadcastChannel,
    });

    await wait(20);

    const received = [];
    client.onmessage = (e) => received.push(e.data);
    client.send('hello');
    await wait(20);

    assert.equal(received.length, 1);
    assert.equal(received[0], 'echo: hello');

    client.close();
    wss.close();
  });

  it('binary round-trip', async () => {
    const wss = new ServerWebSocketServer({
      channelName: 'binary-test',
      pingIntervalMs: 0,
      _BroadcastChannel: MockBroadcastChannel,
    });

    wss.on('connection', (socket) => {
      socket.onmessage = (e) => {
        // Echo back the binary data
        socket.send(e.data);
      };
    });
    wss.listen();

    const client = ServerWebSocketServer.createClient({
      channelName: 'binary-test',
      _BroadcastChannel: MockBroadcastChannel,
    });

    await wait(20);

    const received = [];
    client.onmessage = (e) => received.push(e.data);

    const buf = new Uint8Array([10, 20, 30]).buffer;
    client.send(buf);
    await wait(20);

    assert.equal(received.length, 1);
    assert.ok(received[0] instanceof ArrayBuffer);
    assert.deepEqual(new Uint8Array(received[0]), new Uint8Array([10, 20, 30]));

    client.close();
    wss.close();
  });

  it('multiple clients', async () => {
    const wss = new ServerWebSocketServer({
      channelName: 'multi-test',
      pingIntervalMs: 0,
      _BroadcastChannel: MockBroadcastChannel,
    });

    const serverConns = [];
    wss.on('connection', (s) => serverConns.push(s));
    wss.listen();

    const c1 = ServerWebSocketServer.createClient({
      channelName: 'multi-test',
      _BroadcastChannel: MockBroadcastChannel,
    });
    const c2 = ServerWebSocketServer.createClient({
      channelName: 'multi-test',
      _BroadcastChannel: MockBroadcastChannel,
    });

    await wait(20);

    assert.equal(serverConns.length, 2);
    assert.equal(wss.connectionCount, 2);

    c1.close();
    c2.close();
    wss.close();
  });

  it('server broadcast reaches all clients', async () => {
    const wss = new ServerWebSocketServer({
      channelName: 'bcast-int',
      pingIntervalMs: 0,
      _BroadcastChannel: MockBroadcastChannel,
    });
    wss.listen();

    const c1 = ServerWebSocketServer.createClient({
      channelName: 'bcast-int',
      _BroadcastChannel: MockBroadcastChannel,
    });
    const c2 = ServerWebSocketServer.createClient({
      channelName: 'bcast-int',
      _BroadcastChannel: MockBroadcastChannel,
    });

    await wait(20);

    const r1 = [], r2 = [];
    c1.onmessage = (e) => r1.push(e.data);
    c2.onmessage = (e) => r2.push(e.data);

    wss.broadcast('news');
    await wait(20);

    assert.equal(r1.length, 1);
    assert.equal(r2.length, 1);
    assert.equal(r1[0], 'news');
    assert.equal(r2[0], 'news');

    c1.close();
    c2.close();
    wss.close();
  });
});

describe('WS_READY_STATE', () => {
  it('has correct values', () => {
    assert.equal(WS_READY_STATE.CONNECTING, 0);
    assert.equal(WS_READY_STATE.OPEN, 1);
    assert.equal(WS_READY_STATE.CLOSING, 2);
    assert.equal(WS_READY_STATE.CLOSED, 3);
  });

  it('is frozen', () => {
    assert.ok(Object.isFrozen(WS_READY_STATE));
  });
});
