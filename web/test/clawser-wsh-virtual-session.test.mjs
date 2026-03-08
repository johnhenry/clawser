import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  MSG,
  WshClient,
  WshTransport,
  authOk,
  echoAck,
  echoState,
  openOk,
  reverseAccept,
  serverHello,
  sessionData,
  termDiff,
  termSync,
} from '../packages/wsh/src/index.mjs';

class MockTransport extends WshTransport {
  sent = [];
  openStreamCalls = 0;
  #openResponses = [];

  #defer(msg) {
    setTimeout(() => {
      this._emitControl(msg);
    }, 0);
  }

  queueOpenResponse(msg) {
    this.#openResponses.push(msg);
  }

  deliver(msg) {
    this._emitControl(msg);
  }

  async _doConnect(_url) {}

  async _doClose() {}

  async _doSendControl(msg) {
    this.sent.push(msg);

    if (msg.type === MSG.HELLO) {
      this.#defer(serverHello({ sessionId: 'srv-1', features: ['reverse'] }));
      return;
    }

    if (msg.type === MSG.AUTH) {
      this.#defer(authOk({ sessionId: 'sess-1', token: 'resume-token' }));
      return;
    }

    if (msg.type === MSG.OPEN) {
      const response = this.#openResponses.shift()
        ?? openOk({ channelId: 7, streamIds: { stdin: 1, stdout: 2 } });
      this.#defer(response);
    }
  }

  async _doOpenStream() {
    this.openStreamCalls += 1;
    return {
      readable: new ReadableStream(),
      writable: new WritableStream(),
      id: this.openStreamCalls,
    };
  }
}

class TrackingTransport extends MockTransport {
  constructor(kind, attempts, connectError = null) {
    super();
    this.kind = kind;
    this.attempts = attempts;
    this.connectError = connectError;
    this.closeCalls = 0;
  }

  async _doConnect(url) {
    this.attempts.push([this.kind, url]);
    if (this.connectError) {
      throw new Error(this.connectError);
    }
  }

  async _doClose() {
    this.closeCalls += 1;
  }
}

async function createAuthenticatedClient(transport = new MockTransport()) {
  const client = new WshClient();
  await client.connectWithTransport(transport, 'https://relay.example', {
    username: 'alice',
    password: 'secret',
  });
  return { client, transport };
}

describe('wsh virtual sessions', () => {
  it('falls back from WebTransport to WebSocket for auto transport on HTTPS URLs', async () => {
    const attempts = [];
    const client = new WshClient({
      transportFactories: {
        wt: () => new TrackingTransport('wt', attempts, 'Opening handshake failed'),
        ws: () => new TrackingTransport('ws', attempts),
      },
    });

    const sessionId = await client.connect('https://relay.example:4422', {
      username: 'alice',
      password: 'secret',
    });

    assert.equal(sessionId, 'sess-1');
    assert.deepEqual(attempts, [
      ['wt', 'https://relay.example:4422'],
      ['ws', 'https://relay.example:4422'],
    ]);

    await client.disconnect();
  });

  it('uses WebSocket immediately when transport is forced to ws', async () => {
    const attempts = [];
    const client = new WshClient({
      transportFactories: {
        wt: () => new TrackingTransport('wt', attempts),
        ws: () => new TrackingTransport('ws', attempts),
      },
    });

    const sessionId = await client.connect('https://relay.example:4422', {
      username: 'alice',
      password: 'secret',
      transport: 'ws',
    });

    assert.equal(sessionId, 'sess-1');
    assert.deepEqual(attempts, [['ws', 'https://relay.example:4422']]);

    await client.disconnect();
  });

  it('does not fall back when transport is forced to wt', async () => {
    const attempts = [];
    const client = new WshClient({
      transportFactories: {
        wt: () => new TrackingTransport('wt', attempts, 'Opening handshake failed'),
        ws: () => new TrackingTransport('ws', attempts),
      },
    });

    await assert.rejects(
      () => client.connect('https://relay.example:4422', {
        username: 'alice',
        password: 'secret',
        transport: 'wt',
      }),
      /Connection failed across transports \(wt: Opening handshake failed\)/
    );
    assert.deepEqual(attempts, [['wt', 'https://relay.example:4422']]);
    assert.equal(client.state, 'closed');
  });

  it('uses WebSocket immediately for wss URLs in auto mode', async () => {
    const attempts = [];
    const client = new WshClient({
      transportFactories: {
        wt: () => new TrackingTransport('wt', attempts),
        ws: () => new TrackingTransport('ws', attempts),
      },
    });

    const sessionId = await client.connect('wss://relay.example:4422', {
      username: 'alice',
      password: 'secret',
    });

    assert.equal(sessionId, 'sess-1');
    assert.deepEqual(attempts, [['ws', 'wss://relay.example:4422']]);

    await client.disconnect();
  });

  it('surfaces a combined error when all transport attempts fail', async () => {
    const attempts = [];
    const client = new WshClient({
      transportFactories: {
        wt: () => new TrackingTransport('wt', attempts, 'Opening handshake failed'),
        ws: () => new TrackingTransport('ws', attempts, 'WebSocket connection failed'),
      },
    });

    await assert.rejects(
      () => client.connect('https://relay.example:4422', {
        username: 'alice',
        password: 'secret',
      }),
      /Connection failed across transports \(wt: Opening handshake failed; ws: WebSocket connection failed\)/
    );
    assert.deepEqual(attempts, [
      ['wt', 'https://relay.example:4422'],
      ['ws', 'https://relay.example:4422'],
    ]);
    assert.equal(client.state, 'closed');
  });

  it('does not fire onClose for a failed WebTransport fallback attempt', async () => {
    const attempts = [];
    let failedWtTransport = null;
    const client = new WshClient({
      transportFactories: {
        wt: () => {
          failedWtTransport = new TrackingTransport('wt', attempts, 'Opening handshake failed');
          return failedWtTransport;
        },
        ws: () => new TrackingTransport('ws', attempts),
      },
    });
    let closeEvents = 0;
    client.onClose = () => {
      closeEvents += 1;
    };

    const sessionId = await client.connect('https://relay.example:4422', {
      username: 'alice',
      password: 'secret',
    });

    assert.equal(sessionId, 'sess-1');
    assert.equal(client.state, 'authenticated');
    assert.equal(closeEvents, 0);
    assert.equal(failedWtTransport.closeCalls, 0);

    await client.disconnect();
    assert.equal(closeEvents, 0);
  });

  it('opens a virtual session without opening a transport stream', async () => {
    const { client, transport } = await createAuthenticatedClient();
    transport.queueOpenResponse(
      openOk({
        channelId: 42,
        dataMode: 'virtual',
        capabilities: ['resize', 'signal'],
      })
    );

    const session = await client.openSession({ type: 'pty' });

    assert.equal(session.dataMode, 'virtual');
    assert.deepEqual(session.capabilities, ['resize', 'signal']);
    assert.equal(session.state, 'active');
    assert.equal(transport.openStreamCalls, 0);

    await client.disconnect();
  });

  it('writes virtual session bytes through SESSION_DATA frames', async () => {
    const { client, transport } = await createAuthenticatedClient();
    transport.queueOpenResponse(
      openOk({
        channelId: 43,
        dataMode: 'virtual',
      })
    );

    const session = await client.openSession({ type: 'pty' });
    await session.write('pwd\n');

    const msg = transport.sent.at(-1);
    assert.equal(msg.type, MSG.SESSION_DATA);
    assert.equal(msg.channel_id, 43);
    assert.deepEqual(Array.from(msg.data), Array.from(new TextEncoder().encode('pwd\n')));

    await client.disconnect();
  });

  it('routes session-bound relay frames to the active session before onRelayMessage', async () => {
    const { client, transport } = await createAuthenticatedClient();
    transport.queueOpenResponse(
      openOk({
        channelId: 44,
        dataMode: 'virtual',
      })
    );

    const session = await client.openSession({ type: 'pty' });
    const chunks = [];
    const relayMessages = [];

    session.onData = (data) => {
      chunks.push(Array.from(data));
    };
    client.onRelayMessage = (msg) => {
      relayMessages.push(msg.type);
    };

    transport.deliver(sessionData({ channelId: 44, data: new Uint8Array([1, 2, 3]) }));

    assert.deepEqual(chunks, [[1, 2, 3]]);
    assert.deepEqual(relayMessages, []);

    await client.disconnect();
  });

  it('exposes sendRelayControl without reaching into the transport internals', async () => {
    const { client, transport } = await createAuthenticatedClient();

    await client.sendRelayControl(
      reverseAccept({
        targetFingerprint: 'SHA256:peer',
        username: 'alice',
        capabilities: ['shell'],
      })
    );

    const msg = transport.sent.at(-1);
    assert.equal(msg.type, MSG.REVERSE_ACCEPT);
    assert.deepEqual(msg.capabilities, ['shell']);

    await client.disconnect();
  });

  it('retains and emits echo and terminal sync metadata for virtual sessions', async () => {
    const { client, transport } = await createAuthenticatedClient();
    transport.queueOpenResponse(
      openOk({
        channelId: 45,
        dataMode: 'virtual',
      })
    );

    const session = await client.openSession({ type: 'pty' });
    const seen = [];

    session.onEchoAck = (msg) => seen.push(['ack', msg.echo_seq]);
    session.onEchoState = (msg) => seen.push(['state', msg.cursor_x, msg.cursor_y]);
    session.onTermDiff = (msg) => seen.push(['diff', msg.frame_seq, msg.base_seq]);
    session.onTermSync = (msg) => seen.push(['sync', msg.frame_seq]);

    transport.deliver(echoAck({ channelId: 45, echoSeq: 4 }));
    transport.deliver(echoState({ channelId: 45, echoSeq: 4, cursorX: 2, cursorY: 1, pending: 0 }));
    transport.deliver(termDiff({ channelId: 45, frameSeq: 8, baseSeq: 7, patch: new Uint8Array([9]) }));
    transport.deliver(termSync({ channelId: 45, frameSeq: 8, stateHash: new Uint8Array([1, 2, 3]) }));

    assert.deepEqual(seen, [
      ['ack', 4],
      ['state', 2, 1],
      ['diff', 8, 7],
      ['sync', 8],
    ]);
    assert.equal(session.lastEchoAck.echo_seq, 4);
    assert.equal(session.lastEchoState.cursor_y, 1);
    assert.equal(session.lastTermDiff.base_seq, 7);
    assert.deepEqual(Array.from(session.lastTermSync.state_hash), [1, 2, 3]);

    await client.disconnect();
  });
});
