import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { GatewayBackend } from '../src/gateway-backend.mjs';
import { MockWshClient } from './mock-wsh-transport.mjs';

/** Flush microtask queue to let async operations settle. */
const tick = () => new Promise(r => setTimeout(r, 0));

describe('GatewayBackend', () => {
  it('connect → sends OpenTcp → mock GatewayOk → returns StreamSocket', async () => {
    const client = new MockWshClient({ connected: true });
    const backend = new GatewayBackend({ wshClient: client });

    const connectPromise = backend.connect('example.com', 80);
    await tick();

    // Verify OpenTcp was sent
    assert.equal(client.sent.length, 1);
    const openMsg = client.lastSent;
    assert.equal(openMsg.type, 0x70);
    assert.equal(openMsg.host, 'example.com');
    assert.equal(openMsg.port, 80);

    // Inject GatewayOk response
    client.inject({ type: 0x73, gateway_id: openMsg.gateway_id, resolved_addr: '93.184.216.34' });

    const socket = await connectPromise;
    assert.ok(socket);
    assert.equal(socket.closed, false);
    await socket.close();
    await backend.close();
  });

  it('connect → mock GatewayFail → throws ConnectionRefusedError', async () => {
    const client = new MockWshClient({ connected: true });
    const backend = new GatewayBackend({ wshClient: client });

    const connectPromise = backend.connect('unreachable.host', 80);
    await tick();
    const openMsg = client.lastSent;

    client.inject({ type: 0x74, gateway_id: openMsg.gateway_id, code: 111, message: 'Connection refused' });

    await assert.rejects(() => connectPromise, { name: 'ConnectionRefusedError' });
    await backend.close();
  });

  it('listen → sends ListenRequest → mock ListenOk → returns Listener', async () => {
    const client = new MockWshClient({ connected: true });
    const backend = new GatewayBackend({ wshClient: client });

    const listenPromise = backend.listen(8080);
    await tick();

    assert.equal(client.sent.length, 1);
    const listenMsg = client.lastSent;
    assert.equal(listenMsg.type, 0x7a);
    assert.equal(listenMsg.port, 8080);

    client.inject({ type: 0x7b, listener_id: listenMsg.listener_id, actual_port: 8080 });

    const listener = await listenPromise;
    assert.ok(listener);
    assert.equal(listener.localPort, 8080);
    listener.close();
    await backend.close();
  });

  it('listen → mock ListenFail → throws', async () => {
    const client = new MockWshClient({ connected: true });
    const backend = new GatewayBackend({ wshClient: client });

    const listenPromise = backend.listen(80);
    await tick();
    const listenMsg = client.lastSent;

    client.inject({ type: 0x7c, listener_id: listenMsg.listener_id, reason: 'address in use' });

    await assert.rejects(() => listenPromise, { message: 'address in use' });
    await backend.close();
  });

  it('InboundOpen → accept → returns StreamSocket', async () => {
    const client = new MockWshClient({ connected: true });
    const backend = new GatewayBackend({ wshClient: client });

    const listenPromise = backend.listen(9090);
    await tick();
    const listenMsg = client.lastSent;
    client.inject({ type: 0x7b, listener_id: listenMsg.listener_id, actual_port: 9090 });
    const listener = await listenPromise;

    // Simulate inbound connection
    client.inject({
      type: 0x76,
      listener_id: listenMsg.listener_id,
      channel_id: 42,
      peer_addr: '10.0.0.1',
      peer_port: 54321,
    });

    const socket = await listener.accept();
    assert.ok(socket);
    assert.equal(socket.closed, false);

    // Verify InboundAccept was sent
    const acceptMsg = client.findSent(0x77);
    assert.equal(acceptMsg.length, 1);
    assert.equal(acceptMsg[0].channel_id, 42);

    await socket.close();
    listener.close();
    await backend.close();
  });

  it('resolve → sends ResolveDns → mock DnsResult', async () => {
    const client = new MockWshClient({ connected: true });
    const backend = new GatewayBackend({ wshClient: client });

    const resolvePromise = backend.resolve('example.com', 'A');
    await tick();

    assert.equal(client.sent.length, 1);
    const dnsMsg = client.lastSent;
    assert.equal(dnsMsg.type, 0x72);
    assert.equal(dnsMsg.name, 'example.com');

    client.inject({
      type: 0x79,
      gateway_id: dnsMsg.gateway_id,
      addresses: ['93.184.216.34', '2606:2800:220:1::'],
      ttl: 300,
    });

    const addresses = await resolvePromise;
    assert.deepEqual(addresses, ['93.184.216.34', '2606:2800:220:1::']);
    await backend.close();
  });

  it('offline queue: enqueue when disconnected, drain on reconnect', async () => {
    const client = new MockWshClient({ connected: false });
    const backend = new GatewayBackend({ wshClient: client });

    // These should queue, not send
    const connectPromise = backend.connect('example.com', 80);
    await tick();
    assert.equal(client.sent.length, 0);

    // Reconnect and drain
    client.setConnected(true);
    const drainPromise = backend.drain();
    await tick();

    // Now the OpenTcp should be sent
    assert.equal(client.sent.length, 1);
    const openMsg = client.lastSent;
    assert.equal(openMsg.type, 0x70);

    // Inject response to complete
    client.inject({ type: 0x73, gateway_id: openMsg.gateway_id });

    const socket = await connectPromise;
    assert.ok(socket);
    await drainPromise;
    await socket.close();
    await backend.close();
  });

  it('GatewayClose closes active relay socket', async () => {
    const client = new MockWshClient({ connected: true });
    const backend = new GatewayBackend({ wshClient: client });

    const connectPromise = backend.connect('example.com', 80);
    await tick();
    const openMsg = client.lastSent;

    client.inject({ type: 0x73, gateway_id: openMsg.gateway_id });
    const socket = await connectPromise;

    // Server closes the gateway channel
    client.inject({ type: 0x75, gateway_id: openMsg.gateway_id, reason: 'peer reset' });

    // Socket should still be usable on our side (internal relay closed)
    assert.equal(socket.closed, false);
    await socket.close();
    await backend.close();
  });

  it('ListenClose closes active listener', async () => {
    const client = new MockWshClient({ connected: true });
    const backend = new GatewayBackend({ wshClient: client });

    const listenPromise = backend.listen(7070);
    await tick();
    const listenMsg = client.lastSent;
    client.inject({ type: 0x7b, listener_id: listenMsg.listener_id, actual_port: 7070 });
    const listener = await listenPromise;

    assert.equal(listener.closed, false);
    client.inject({ type: 0x7d, listener_id: listenMsg.listener_id });
    assert.equal(listener.closed, true);

    await backend.close();
  });

  it('backend.close() rejects pending operations', async () => {
    const client = new MockWshClient({ connected: true });
    const backend = new GatewayBackend({ wshClient: client });

    const connectPromise = backend.connect('example.com', 80);
    await tick();
    await backend.close();

    await assert.rejects(() => connectPromise, { code: 'ECLOSED' });
  });

  it('InboundOpen without listener sends InboundReject', async () => {
    const client = new MockWshClient({ connected: true });
    const backend = new GatewayBackend({ wshClient: client });

    // No listener exists for listener_id 999
    client.inject({
      type: 0x76,
      listener_id: 999,
      channel_id: 50,
      peer_addr: '10.0.0.1',
      peer_port: 12345,
    });

    await tick();

    // Should have sent InboundReject
    const rejectMsgs = client.findSent(0x78);
    assert.equal(rejectMsgs.length, 1);
    assert.equal(rejectMsgs[0].channel_id, 50);
    assert.equal(rejectMsgs[0].reason, 'no listener');

    await backend.close();
  });

  // ── Data relay tests ────────────────────────────────────────────────

  it('outbound: write to userSocket → GatewayData (0x7e) sent', async () => {
    const client = new MockWshClient({ connected: true });
    const backend = new GatewayBackend({ wshClient: client });

    const connectPromise = backend.connect('example.com', 80);
    await tick();
    const openMsg = client.lastSent;

    // Inject GatewayOk to complete connection
    client.inject({ type: 0x73, gateway_id: openMsg.gateway_id });
    const socket = await connectPromise;

    // Write data to user socket
    const payload = new Uint8Array([0x48, 0x45, 0x4c, 0x4c, 0x4f]); // "HELLO"
    await socket.write(payload);
    await tick();

    // Verify GatewayData was sent to server
    const dataMsgs = client.findSent(0x7e);
    assert.equal(dataMsgs.length, 1);
    assert.equal(dataMsgs[0].gateway_id, openMsg.gateway_id);
    assert.deepEqual(dataMsgs[0].data, payload);

    await socket.close();
    await backend.close();
  });

  it('inbound: inject GatewayData (0x7e) → data arrives on userSocket.read()', async () => {
    const client = new MockWshClient({ connected: true });
    const backend = new GatewayBackend({ wshClient: client });

    const connectPromise = backend.connect('example.com', 80);
    await tick();
    const openMsg = client.lastSent;

    client.inject({ type: 0x73, gateway_id: openMsg.gateway_id });
    const socket = await connectPromise;

    // Inject data from server
    const payload = new Uint8Array([0x48, 0x54, 0x54, 0x50]); // "HTTP"
    client.inject({ type: 0x7e, gateway_id: openMsg.gateway_id, data: payload });

    const received = await socket.read();
    assert.deepEqual(received, payload);

    await socket.close();
    await backend.close();
  });

  it('remote close → GatewayClose sent → userSocket.read() returns null', async () => {
    const client = new MockWshClient({ connected: true });
    const backend = new GatewayBackend({ wshClient: client });

    const connectPromise = backend.connect('example.com', 80);
    await tick();
    const openMsg = client.lastSent;

    client.inject({ type: 0x73, gateway_id: openMsg.gateway_id });
    const socket = await connectPromise;

    // Start a read that will block until data or close
    const readPromise = socket.read();

    // Server sends GatewayClose
    client.inject({ type: 0x75, gateway_id: openMsg.gateway_id });

    // The read should resolve with null (EOF)
    const result = await readPromise;
    assert.equal(result, null);

    await backend.close();
  });

  it('inbound connection: data relay works bidirectionally', async () => {
    const client = new MockWshClient({ connected: true });
    const backend = new GatewayBackend({ wshClient: client });

    // Set up listener
    const listenPromise = backend.listen(9090);
    await tick();
    const listenMsg = client.lastSent;
    client.inject({ type: 0x7b, listener_id: listenMsg.listener_id, actual_port: 9090 });
    const listener = await listenPromise;

    // Simulate inbound connection
    client.inject({
      type: 0x76,
      listener_id: listenMsg.listener_id,
      channel_id: 42,
      peer_addr: '10.0.0.1',
      peer_port: 54321,
    });

    const socket = await listener.accept();

    // Verify InboundAccept includes gateway_id
    const acceptMsgs = client.findSent(0x77);
    assert.equal(acceptMsgs.length, 1);
    assert.equal(acceptMsgs[0].channel_id, 42);
    assert.ok(acceptMsgs[0].gateway_id != null, 'gateway_id should be set');

    const gatewayId = acceptMsgs[0].gateway_id;

    // Inject data from remote peer via server
    const inPayload = new Uint8Array([1, 2, 3]);
    client.inject({ type: 0x7e, gateway_id: gatewayId, data: inPayload });
    const received = await socket.read();
    assert.deepEqual(received, inPayload);

    // Write data from user to remote peer
    const outPayload = new Uint8Array([4, 5, 6]);
    await socket.write(outPayload);
    await tick();

    const dataMsgs = client.findSent(0x7e);
    assert.equal(dataMsgs.length, 1);
    assert.equal(dataMsgs[0].gateway_id, gatewayId);
    assert.deepEqual(dataMsgs[0].data, outPayload);

    await socket.close();
    listener.close();
    await backend.close();
  });
});
