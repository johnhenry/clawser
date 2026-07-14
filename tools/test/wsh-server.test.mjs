// tools/test/wsh-server.test.mjs — real client-server round trips against
// the actual `wsh-upon-star` npm package (not mocks). Run with:
//   node --test tools/test/wsh-server.test.mjs

import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import WebSocket from 'ws';

import {
  WshClient,
  generateKeyPair, exportPublicKeySSH, exportPublicKeyRaw,
  hello, auth, reverseRegister, reverseAccept,
  signChallenge,
  FrameDecoder,
  MSG,
} from 'wsh-upon-star';

import { WshServer, parseAuthorizedKeys, sendFrame, parseControlFrame } from '../wsh-server.mjs';

async function makeKeyPair() {
  const kp = await generateKeyPair(true);
  const publicKeySSH = await exportPublicKeySSH(kp.publicKey);
  return { kp, publicKeySSH };
}

/** Start a server with the given authorized keys already trusted. */
async function startServer(sshLines, opts = {}) {
  const authorizedKeys = await parseAuthorizedKeys(sshLines.join('\n'));
  const server = new WshServer({ authorizedKeys, ...opts });
  const port = await server.listen({ port: 0, host: '127.0.0.1' });
  return { server, url: `ws://127.0.0.1:${port}` };
}

const servers = [];
afterEach(async () => {
  for (const s of servers.splice(0)) await s.close().catch(() => {});
});

// ── Auth handshake ──────────────────────────────────────────────────

describe('WshServer auth handshake', () => {
  it('accepts a client whose key is in authorizedKeys', async () => {
    const { kp, publicKeySSH } = await makeKeyPair();
    const { server, url } = await startServer([publicKeySSH]);
    servers.push(server);

    const client = new WshClient();
    const sessionId = await client.connect(url, { username: 'alice', keyPair: kp });
    assert.equal(typeof sessionId, 'string');
    await client.disconnect();
  });

  it('rejects a client whose key is not in authorizedKeys', async () => {
    const { kp } = await makeKeyPair();
    const other = await makeKeyPair(); // a DIFFERENT key is the one actually authorized
    const { server, url } = await startServer([other.publicKeySSH]);
    servers.push(server);

    const client = new WshClient();
    await assert.rejects(
      () => client.connect(url, { username: 'mallory', keyPair: kp }),
      /Authentication failed/,
    );
  });

  it('parseAuthorizedKeys skips malformed lines without throwing', async () => {
    const { publicKeySSH } = await makeKeyPair();
    const map = await parseAuthorizedKeys(['not a real key line', '', '# a comment', publicKeySSH].join('\n'));
    assert.equal(map.size, 1);
  });
});

// ── Direct-host exec sessions ───────────────────────────────────────

describe('WshServer direct-host exec sessions', () => {
  it('runs a command and streams stdout back, then exits 0', async () => {
    const { kp, publicKeySSH } = await makeKeyPair();
    const { server, url } = await startServer([publicKeySSH]);
    servers.push(server);

    const client = new WshClient();
    await client.connect(url, { username: 'alice', keyPair: kp });

    const session = await client.openSession({ type: 'exec', command: 'echo hello-wsh' });
    const chunks = [];
    let exitCode = null;
    await new Promise((resolve) => {
      session.onData = (d) => chunks.push(d);
      session.onExit = (c) => { exitCode = c; };
      session.onClose = resolve;
    });

    const text = Buffer.concat(chunks.map(c => Buffer.from(c))).toString('utf8');
    assert.match(text, /hello-wsh/);
    assert.equal(exitCode, 0);

    await client.disconnect();
  });

  it('reports a non-zero exit code for a failing command', async () => {
    const { kp, publicKeySSH } = await makeKeyPair();
    const { server, url } = await startServer([publicKeySSH]);
    servers.push(server);

    const client = new WshClient();
    await client.connect(url, { username: 'alice', keyPair: kp });

    const session = await client.openSession({ type: 'exec', command: 'exit 7' });
    let exitCode = null;
    await new Promise((resolve) => {
      session.onExit = (c) => { exitCode = c; };
      session.onClose = resolve;
    });
    assert.equal(exitCode, 7);

    await client.disconnect();
  });

  it('rejects kind "pty" with a clear reason (no PTY backend)', async () => {
    const { kp, publicKeySSH } = await makeKeyPair();
    const { server, url } = await startServer([publicKeySSH]);
    servers.push(server);

    const client = new WshClient();
    await client.connect(url, { username: 'alice', keyPair: kp });

    await assert.rejects(
      () => client.openSession({ type: 'pty', command: '/bin/sh' }),
      /not supported.*only "exec"/,
    );

    await client.disconnect();
  });
});

// ── Relay: peer registration + discovery ────────────────────────────

describe('WshServer relay — registration and discovery', () => {
  it('lists a registered peer via listPeers', async () => {
    const peerKeys = await makeKeyPair();
    const operatorKeys = await makeKeyPair();
    const { server, url } = await startServer(
      [peerKeys.publicKeySSH, operatorKeys.publicKeySSH],
      { enableRelay: true },
    );
    servers.push(server);

    const peerClient = new WshClient();
    await peerClient.connectReverse(url, {
      username: 'browser-tab',
      keyPair: peerKeys.kp,
      expose: { shell: true, exec: true },
    });

    const operatorClient = new WshClient();
    await operatorClient.connect(url, { username: 'operator', keyPair: operatorKeys.kp });
    const peers = await operatorClient.listPeers();

    assert.equal(peers.length, 1);
    assert.equal(peers[0].username, 'browser-tab');
    assert.ok(peers[0].capabilities.includes('shell'));
    assert.ok(peers[0].capabilities.includes('exec'));

    await peerClient.disconnect();
    await operatorClient.disconnect();
  });

  it('reflects disconnect: peer disappears from listPeers after closing', async () => {
    const peerKeys = await makeKeyPair();
    const operatorKeys = await makeKeyPair();
    const { server, url } = await startServer(
      [peerKeys.publicKeySSH, operatorKeys.publicKeySSH],
      { enableRelay: true },
    );
    servers.push(server);

    const peerClient = new WshClient();
    await peerClient.connectReverse(url, { username: 'browser-tab', keyPair: peerKeys.kp });
    await peerClient.disconnect();
    await new Promise((r) => setTimeout(r, 50)); // let the server process the close

    const operatorClient = new WshClient();
    await operatorClient.connect(url, { username: 'operator', keyPair: operatorKeys.kp });
    const peers = await operatorClient.listPeers();
    assert.equal(peers.length, 0);

    await operatorClient.disconnect();
  });
});

// ── Relay: reverse-connect accept/reject correlation ────────────────

describe('WshServer relay — reverse-connect handshake', () => {
  it('forwards ReverseConnect to the target peer and ReverseAccept back to the operator', async () => {
    const peerKeys = await makeKeyPair();
    const operatorKeys = await makeKeyPair();
    const { server, url } = await startServer(
      [peerKeys.publicKeySSH, operatorKeys.publicKeySSH],
      { enableRelay: true },
    );
    servers.push(server);

    const peerClient = new WshClient();
    await peerClient.connectReverse(url, { username: 'browser-tab', keyPair: peerKeys.kp });
    peerClient.onReverseConnect = (msg) => {
      peerClient.sendRelayControl(reverseAccept({ targetFingerprint: msg.target_fingerprint, username: 'browser-tab' }));
    };

    const operatorClient = new WshClient();
    await operatorClient.connect(url, { username: 'operator', keyPair: operatorKeys.kp });
    const [peerInfo] = await operatorClient.listPeers();

    const response = await operatorClient.reverseConnect(peerInfo.fingerprint);
    assert.equal(response.type, MSG.REVERSE_ACCEPT);

    await peerClient.disconnect();
    await operatorClient.disconnect();
  });

  it('forwards ReverseReject when the peer declines', async () => {
    const peerKeys = await makeKeyPair();
    const operatorKeys = await makeKeyPair();
    const { server, url } = await startServer(
      [peerKeys.publicKeySSH, operatorKeys.publicKeySSH],
      { enableRelay: true },
    );
    servers.push(server);

    const peerClient = new WshClient();
    await peerClient.connectReverse(url, { username: 'browser-tab', keyPair: peerKeys.kp });
    peerClient.onReverseConnect = (msg) => {
      peerClient.sendRelayControl({ type: MSG.REVERSE_REJECT, target_fingerprint: msg.target_fingerprint, username: 'browser-tab', reason: 'declined by user' });
    };

    const operatorClient = new WshClient();
    await operatorClient.connect(url, { username: 'operator', keyPair: operatorKeys.kp });
    const [peerInfo] = await operatorClient.listPeers();

    const response = await operatorClient.reverseConnect(peerInfo.fingerprint);
    assert.equal(response.type, MSG.REVERSE_REJECT);
    assert.equal(response.reason, 'declined by user');

    await peerClient.disconnect();
    await operatorClient.disconnect();
  });

  it('rejects reverse-connect to an unregistered fingerprint', async () => {
    const operatorKeys = await makeKeyPair();
    const { server, url } = await startServer([operatorKeys.publicKeySSH], { enableRelay: true });
    servers.push(server);

    const operatorClient = new WshClient();
    await operatorClient.connect(url, { username: 'operator', keyPair: operatorKeys.kp });
    const response = await operatorClient.reverseConnect('deadbeef'.repeat(8));
    assert.equal(response.type, MSG.REVERSE_REJECT);
    assert.match(response.reason, /no such peer/);

    await operatorClient.disconnect();
  });
});

// ── Relay: channel-scoped session forwarding after accept ───────────
//
// WshClient has no built-in "act as a session server" role, so the peer
// side here is a minimal hand-rolled connection using the same
// low-level primitives clawser-side code (and this server) already use
// — proving the relay's Open/OpenOk/SessionData/Exit/Close forwarding
// works, without needing a second full client implementation.

describe('WshServer relay — session forwarding once accepted', () => {
  it('forwards a full exec session between the operator and a raw peer connection', async () => {
    const peerKeys = await makeKeyPair();
    const operatorKeys = await makeKeyPair();
    const { server, url } = await startServer(
      [peerKeys.publicKeySSH, operatorKeys.publicKeySSH],
      { enableRelay: true },
    );
    servers.push(server);

    // -- Raw peer connection: auth handshake by hand, then register + accept + serve one exec session.
    const peerWs = new WebSocket(url);
    const peerDecoder = new FrameDecoder();
    const peerInbox = [];
    let peerFingerprint = null;
    const peerReady = new Promise((resolve) => {
      peerWs.on('open', async () => {
        sendFrame(peerWs, hello({ username: 'browser-tab' }));
      });
      peerWs.on('message', async (data) => {
        const payload = parseControlFrame(new Uint8Array(data));
        if (!payload) return;
        const msgs = peerDecoder.feed(payload);
        for (const msg of msgs) {
          peerInbox.push(msg);
          if (msg.type === MSG.CHALLENGE) {
            // Server skips SERVER_HELLO and goes straight to CHALLENGE —
            // the transcript session-id is the literal string "pending"
            // in that case (matches WshClient's own fallback behavior;
            // see the comment in wsh-server.mjs's HELLO handler).
            const { signature, publicKeyRaw } = await signChallenge(
              peerKeys.kp.privateKey, peerKeys.kp.publicKey,
              'pending',
              msg.nonce,
            );
            sendFrame(peerWs, auth({ method: 'pubkey', signature, publicKey: publicKeyRaw }));
          } else if (msg.type === MSG.AUTH_OK) {
            peerFingerprint = null; // computed operator-side via listPeers; not needed here
            const publicKeyRaw = await exportPublicKeyRaw(peerKeys.kp.publicKey);
            sendFrame(peerWs, reverseRegister({ username: 'browser-tab', capabilities: ['exec'], publicKey: publicKeyRaw }));
            resolve();
          } else if (msg.type === MSG.REVERSE_CONNECT) {
            sendFrame(peerWs, reverseAccept({ targetFingerprint: msg.target_fingerprint, username: 'browser-tab' }));
          } else if (msg.type === MSG.OPEN) {
            sendFrame(peerWs, { type: MSG.OPEN_OK, channel_id: 1, stream_ids: [], data_mode: 'virtual', capabilities: [] });
            // WshSession.onData/onExit/onClose use plain optional-chaining
            // dispatch with no buffering (session.mjs) — if these arrive
            // before the operator's `await openSession()` continuation
            // assigns its handlers, they're silently dropped. Sending all
            // 4 messages synchronously reproduced that race in practice
            // (found while debugging this exact test). A real command
            // always takes at least a little time to produce output, so
            // a tiny delay here is realistic, not just a test workaround.
            await new Promise((r) => setTimeout(r, 10));
            sendFrame(peerWs, { type: MSG.SESSION_DATA, channel_id: 1, data: new TextEncoder().encode('forwarded output\n') });
            sendFrame(peerWs, { type: MSG.EXIT, channel_id: 1, code: 0 });
            sendFrame(peerWs, { type: MSG.CLOSE, channel_id: 1 });
          }
        }
      });
    });
    await peerReady;

    const operatorClient = new WshClient();
    await operatorClient.connect(url, { username: 'operator', keyPair: operatorKeys.kp });
    const [peerInfo] = await operatorClient.listPeers();
    const acceptResponse = await operatorClient.reverseConnect(peerInfo.fingerprint);
    assert.equal(acceptResponse.type, MSG.REVERSE_ACCEPT);

    const session = await operatorClient.openSession({ type: 'exec', command: 'irrelevant — the raw peer replies unconditionally' });
    const chunks = [];
    let exitCode = null;
    await new Promise((resolve) => {
      session.onData = (d) => chunks.push(d);
      session.onExit = (c) => { exitCode = c; };
      session.onClose = resolve;
    });

    const text = Buffer.concat(chunks.map(c => Buffer.from(c))).toString('utf8');
    assert.match(text, /forwarded output/);
    assert.equal(exitCode, 0);

    await operatorClient.disconnect();
    peerWs.close();
  });
});
