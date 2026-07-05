// tools/test/wsh-webtransport.test.mjs — real client-server round trips over
// WebTransport (QUIC/HTTP3), against the actual `wsh-upon-star` npm package
// and the actual `@fails-components/webtransport` native binding (not
// mocks). Run with:
//   node --test tools/test/wsh-webtransport.test.mjs
//
// wsh-upon-star's `WebTransportTransport` calls the bare global
// `new WebTransport(url)` with no options — it has no way to pass
// `serverCertificateHashes` for pinning a self-signed dev certificate.
// Real deployments would use a CA-trusted cert (as the doc recommends) and
// never need pinning; for this test, `globalThis.WebTransport` is set to a
// thin subclass of the real client class that injects
// `serverCertificateHashes` for our ephemeral test certificate — the real
// `WshClient`/`WebTransportTransport` code path from wsh-upon-star runs
// completely unmodified on top of it.

import { describe, it, before, after, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { WebTransport as RealWebTransport, quicheLoaded } from '@fails-components/webtransport';
import {
  WshClient,
  generateKeyPair, exportPublicKeySSH,
  reverseAccept,
  MSG,
} from 'wsh-upon-star';

import { WshServer, parseAuthorizedKeys } from '../wsh-server.mjs';

async function makeKeyPair() {
  const kp = await generateKeyPair(true);
  const publicKeySSH = await exportPublicKeySSH(kp.publicKey);
  return { kp, publicKeySSH };
}

let certDir, cert, key, fingerprintBytes;
let originalTlsRejectUnauthorized;

before(async () => {
  await quicheLoaded;
  // wss:// against our ephemeral self-signed cert: wsh-upon-star's
  // WebSocketTransport calls the bare global `new WebSocket(url)` with no
  // options (browser-style API — no `rejectUnauthorized` to pass), so TLS
  // trust has to be relaxed process-wide for the test's wss:// connections.
  // A real deployment uses a CA-trusted cert and never needs this.
  originalTlsRejectUnauthorized = process.env.NODE_TLS_REJECT_UNAUTHORIZED;
  process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
  certDir = await mkdtemp(path.join(tmpdir(), 'wsh-wt-cert-'));
  const keyPath = path.join(certDir, 'key.pem');
  const certPath = path.join(certDir, 'cert.pem');

  let result = spawnSync('openssl', ['ecparam', '-name', 'prime256v1', '-genkey', '-noout', '-out', keyPath]);
  if (result.status !== 0) throw new Error(`openssl ecparam failed: ${result.stderr}`);
  result = spawnSync('openssl', ['req', '-new', '-x509', '-key', keyPath, '-out', certPath, '-days', '13', '-subj', '/CN=127.0.0.1']);
  if (result.status !== 0) throw new Error(`openssl req failed: ${result.stderr}`);

  cert = await readFile(certPath, 'utf8');
  key = await readFile(keyPath, 'utf8');

  const fpResult = spawnSync('openssl', ['x509', '-in', certPath, '-noout', '-fingerprint', '-sha256']);
  const fpHex = fpResult.stdout.toString().split('=')[1].trim();
  fingerprintBytes = Uint8Array.from(fpHex.split(':').map((h) => parseInt(h, 16)));

  // Test-only polyfill: inject serverCertificateHashes so the real,
  // unmodified WebTransportTransport (which calls `new WebTransport(url)`
  // with no options) can validate our self-signed dev cert.
  globalThis.WebTransport = class extends RealWebTransport {
    constructor(url) {
      super(url, { serverCertificateHashes: [{ algorithm: 'sha-256', value: fingerprintBytes }] });
    }
  };
});

after(async () => {
  delete globalThis.WebTransport;
  if (originalTlsRejectUnauthorized === undefined) delete process.env.NODE_TLS_REJECT_UNAUTHORIZED;
  else process.env.NODE_TLS_REJECT_UNAUTHORIZED = originalTlsRejectUnauthorized;
  if (certDir) await rm(certDir, { recursive: true, force: true });
});

/** Start a server with WebTransport enabled (requires cert/key) and the given authorized keys trusted. */
async function startWtServer(sshLines, opts = {}) {
  const authorizedKeys = await parseAuthorizedKeys(sshLines.join('\n'));
  const server = new WshServer({ authorizedKeys, ...opts });
  const port = await server.listen({ port: 0, host: '127.0.0.1', cert, key });
  return { server, url: `https://127.0.0.1:${port}` };
}

const servers = [];
afterEach(async () => {
  for (const s of servers.splice(0)) await s.close().catch(() => {});
});

describe('WshServer WebTransport transport', () => {
  it('authenticates and runs a direct-host exec session over WebTransport specifically', async () => {
    const { kp, publicKeySSH } = await makeKeyPair();
    const { server, url } = await startWtServer([publicKeySSH]);
    servers.push(server);

    const client = new WshClient();
    const sessionId = await client.connect(url, { username: 'alice', keyPair: kp, transport: 'wt' });
    assert.equal(typeof sessionId, 'string');

    const session = await client.openSession({ type: 'exec', command: 'echo wt-exec-works' });
    const chunks = [];
    let exitCode = null;
    await new Promise((resolve) => {
      session.onData = (d) => chunks.push(d);
      session.onExit = (c) => { exitCode = c; };
      session.onClose = resolve;
    });
    const stdout = Buffer.concat(chunks.map((c) => Buffer.from(c))).toString('utf8');
    assert.match(stdout, /wt-exec-works/);
    assert.equal(exitCode, 0);

    await client.disconnect();
  });

  it('auto transport selection picks WebTransport first for an https:// URL (no WebSocket fallback needed)', async () => {
    const { kp, publicKeySSH } = await makeKeyPair();
    const { server, url } = await startWtServer([publicKeySSH]);
    servers.push(server);

    const client = new WshClient();
    await client.connect(url, { username: 'alice', keyPair: kp, transport: 'auto' });
    assert.equal(client._transport.constructor.name, 'WebTransportTransport');
    await client.disconnect();
  });

  it('relay reverse-connect works across mixed transports: WebSocket peer, WebTransport operator', async () => {
    const { kp: operatorKp, publicKeySSH: opPub } = await makeKeyPair();
    const { publicKeySSH: peerPub, kp: peerKp } = await makeKeyPair();

    const authorizedKeys = await parseAuthorizedKeys([opPub, peerPub].join('\n'));
    const server = new WshServer({ authorizedKeys, enableRelay: true });
    const port = await server.listen({ port: 0, host: '127.0.0.1', cert, key });
    servers.push(server);

    // Peer registers over WebSocket (this server has a cert, so it's wss://).
    const peerClient = new WshClient();
    await peerClient.connectReverse(`wss://127.0.0.1:${port}`, {
      username: 'browser-tab', keyPair: peerKp, expose: { exec: true }, transport: 'ws',
    });
    peerClient.onReverseConnect = (msg) => {
      peerClient.sendRelayControl(reverseAccept({ targetFingerprint: msg.target_fingerprint, username: 'browser-tab' }));
    };

    // Operator connects over WebTransport and reverse-connects to that peer.
    const operatorClient = new WshClient();
    await operatorClient.connect(`https://127.0.0.1:${port}`, { username: 'operator', keyPair: operatorKp, transport: 'wt' });
    const [peerInfo] = await operatorClient.listPeers();
    const acceptResponse = await operatorClient.reverseConnect(peerInfo.fingerprint);
    assert.equal(acceptResponse.type, MSG.REVERSE_ACCEPT);

    await operatorClient.disconnect();
    await peerClient.disconnect();
  });
});
