// tools/test/wsh-rust-server.test.mjs — real client-server round trips against
// the ACTUAL Rust `wsh-server` binary (crates/wsh-server), driven by the real
// `wsh-upon-star` npm package (not mocks), mirroring the pattern used in
// tools/test/wsh-server.test.mjs for the Node reimplementation of the server.
//
// Prerequisite: the Rust binary must already be built before running this file:
//   cargo build --release -p wsh-server
// (this suite spawns target/release/wsh-server as a real subprocess). If the
// binary is missing, `before()` will build it automatically (debug build is
// NOT used here — release, to keep PTY/session-teardown timing realistic and
// the suite fast across many subprocess spawns).
//
// Run with:
//   node --test tools/test/wsh-rust-server.test.mjs
//
// ── Why this file exists ────────────────────────────────────────────
//
// wsh-server (Rust) was restored from git history months after the JS client
// (wsh-upon-star) had been written/tested against an *assumed*-compatible
// wire protocol (mostly validated against the Node reimplementation in
// tools/wsh-server.mjs). This suite is the actual cross-implementation check:
// does the real Rust server speak the same WebSocket framing, CBOR envelope
// shape, and auth handshake the JS client expects?
//
// It found and required fixing one real, non-cosmetic protocol gap: the Rust
// server was declaring `data_mode: "stream"` for exec/pty channels opened
// over WebSocket, which tells wsh-upon-star's WshClient to open a second
// multiplexed data stream (a FRAME_OPEN_STREAM 0x03 frame) for session I/O.
// But neither the Rust server's WebSocket transport (crates/wsh-server/src/
// transport/websocket.rs — `ws_recv_control` only ever accepts FRAME_CONTROL
// 0x01 frames and hard-errors on anything else) nor its WebTransport
// transport (crates/wsh-server/src/server.rs `handle_webtransport` only ever
// accepts a single bidirectional stream, used for control) ever implemented
// a second data stream. There was also no PTY-output-to-client pump at all
// in crates/wsh-server/src/server.rs — direct-host WS sessions never
// delivered PTY output before this. Fixed on the Rust side (this repo's
// crates/wsh-server/src/server.rs + crates/wsh-server/src/session/pty.rs) by:
//   1. Setting `data_mode: SessionDataMode::Virtual` for newly opened
//      exec/pty channels (both WS and WebTransport share this code path via
//      `dispatch_message`), which tells the JS client to send/receive session
//      I/O as SessionData control-channel envelopes instead of opening a
//      stream.
//   2. Adding `WshServer::spawn_pty_output_pump`, a background task that
//      reads PTY output (via `PtyHandle::reader()`, already present but
//      previously unused/dead code) and forwards it to the client as
//      SessionData envelopes through the existing `ctx.peer_tx` channel
//      (already drained by both `session_loop_ws` and `session_loop_quic`
//      for other message types, e.g. relay-forwarded traffic), then sends
//      Exit + Close once the child process terminates
//      (`PtyHandle::child_handle()`, newly added, mirrors the existing
//      `reader()`/`writer()` accessors).
//   3. Adding a `(MsgType::SessionData, Payload::SessionData(p))` arm to
//      `dispatch_message` that writes client stdin straight to the PTY via
//      the existing `PtyHandle::write_blocking`.
// No changes were made to wsh-upon-star (node_modules) — it is treated as the
// fixed, currently-shipping standard this suite verifies the Rust server
// against.
//
// ── WebTransport (QUIC) coverage ─────────────────────────────────────
//
// wsh-upon-star's `WebTransportTransport` calls the bare global
// `new WebTransport(url)`, which doesn't exist in plain Node — but
// `@fails-components/webtransport` (already a dependency of
// tools/wsh-server.mjs) ships a real Node *client* too, so assigning it to
// `globalThis.WebTransport` (subclassed only to inject
// `serverCertificateHashes` for pinning the server's self-signed dev cert —
// the real client calls the constructor with no options) lets
// wsh-upon-star's own transport code run completely unmodified over a real
// QUIC connection to this Rust server. Full end-to-end WebTransport
// interop — auth handshake through a real exec session — is verified this
// way below.
//
// Getting here took two real, non-obvious fixes on the Rust side, both
// found by a careful, from-scratch investigation (see
// docs/WSH-INTO-CLAWSER.md for the full account, including a false-positive
// detour that initially looked like the interop gap was unfixable):
//
//   1. The WebTransport spec's certificate-hash-pinning algorithm
//      (`serverCertificateHashes`) requires the pinned certificate's
//      validity period to be **at most 14 days** — confirmed independently
//      via the W3C spec and Firefox's own bugzilla history for this exact
//      feature (bugzilla.mozilla.org/1873263). rcgen's default validity
//      window (1975-01-01..4096-01-01) obviously fails this; so does any
//      "just make it not absurd" window longer than 14 days (365 days was
//      tried and confirmed to still fail). `generate_self_signed_cert()` in
//      crates/wsh-server/src/main.rs now uses a 13-day window with a day of
//      `not_before` slack for clock skew.
//   2. `handle_webtransport()` in crates/wsh-server/src/server.rs was
//      sending SERVER_HELLO then CHALLENGE back-to-back on one QUIC stream.
//      Unlike discrete WebSocket frames, a QUIC stream has no
//      message-boundary framing at that layer, so both writes can arrive in
//      a single client-side `read()` — and wsh-upon-star's WshClient
//      dispatches both messages synchronously from that one read, but only
//      registers its *next* waiter (for CHALLENGE) in a microtask after the
//      first `await` (for SERVER_HELLO) resolves. The synchronously-
//      dispatched CHALLENGE has no waiter yet and is silently dropped,
//      hanging until timeout — the exact same race already found and fixed
//      on the Node reimplementation's WebSocket path in
//      tools/wsh-server.mjs. Fixed the same way: skip SERVER_HELLO, send
//      only CHALLENGE, and use the client's documented "pending" literal
//      session-id fallback for transcript verification.

import { describe, it, before, after, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  WshClient,
  generateKeyPair,
  exportPublicKeySSH,
  reverseAccept,
  MSG,
} from 'wsh-upon-star';
import { WebTransport as RealWebTransport, quicheLoaded } from '@fails-components/webtransport';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..', '..');
const SERVER_BIN = path.join(REPO_ROOT, 'target', 'release', 'wsh-server');

const STARTUP_GRACE_MS = 1200;
const PORT_BASE = 19400; // arbitrary high range unlikely to collide

let nextPort = PORT_BASE;
function allocPort() {
  return nextPort++;
}

// Preserve/restore NODE_TLS_REJECT_UNAUTHORIZED — the Rust server always
// wraps its WebSocket listener in TLS (self-signed cert via --generate-cert),
// unlike the Node reference server which supports plain ws://. Node's global
// WebSocket (used internally by wsh-upon-star's WebSocketTransport) has no
// per-connection custom-CA option, so the standard escape hatch is used here,
// scoped to this test file only.
const ORIGINAL_TLS_REJECT = process.env.NODE_TLS_REJECT_UNAUTHORIZED;

before(() => {
  if (!existsSync(SERVER_BIN)) {
    execFileSync('cargo', ['build', '--release', '-p', 'wsh-server'], {
      cwd: REPO_ROOT,
      stdio: 'inherit',
    });
  }
  assert.ok(existsSync(SERVER_BIN), `expected built binary at ${SERVER_BIN}`);
  process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
});

after(() => {
  if (ORIGINAL_TLS_REJECT === undefined) {
    delete process.env.NODE_TLS_REJECT_UNAUTHORIZED;
  } else {
    process.env.NODE_TLS_REJECT_UNAUTHORIZED = ORIGINAL_TLS_REJECT;
  }
});

/** @typedef {{ proc: import('node:child_process').ChildProcess, url: string, homeDir: string, logs: string[] }} RunningServer */

/**
 * Start a real `wsh-server` subprocess with a scratch $HOME (so
 * ~/.wsh/authorized_keys and the --generate-cert self-signed cert are
 * isolated per test), pre-populated with the given SSH-format public keys.
 *
 * The binary has no --authorized-keys / --port-scoped config flag for keys:
 * per crates/wsh-server/src/server.rs (`WshServer::new`) it unconditionally
 * loads `$HOME/.wsh/authorized_keys` (falling back to `$HOME/.ssh/authorized_keys`)
 * at startup via `dirs::home_dir()`, so isolation is done via a per-test
 * `$HOME` override rather than a CLI flag (there isn't one — see
 * crates/wsh-server/src/main.rs's `Cli` struct, which has no such option).
 *
 * @param {string[]} sshLines - authorized_keys lines (ssh-ed25519 ...)
 * @param {string[]} [extraArgs] - additional CLI flags, e.g. ['--enable-relay']
 * @returns {Promise<RunningServer>}
 */
async function startServer(sshLines, extraArgs = []) {
  const homeDir = mkdtempSync(path.join(tmpdir(), 'wsh-rust-server-test-'));
  const wshDir = path.join(homeDir, '.wsh');
  execFileSync('mkdir', ['-p', wshDir]);
  writeFileSync(path.join(wshDir, 'authorized_keys'), sshLines.join('\n') + '\n');

  const port = allocPort();
  const logs = [];
  const proc = spawn(
    SERVER_BIN,
    ['--port', String(port), '--generate-cert', '--config', '/dev/null/does-not-exist', ...extraArgs],
    {
      env: { ...process.env, HOME: homeDir },
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );
  proc.stdout.on('data', (d) => logs.push(d.toString()));
  proc.stderr.on('data', (d) => logs.push(d.toString()));

  // Wait for the actual "WebSocket TLS listener started" log line rather than
  // a fixed timer: cert generation (rcgen) + TLS listener bind time varies
  // with machine load, and a fixed STARTUP_GRACE_MS was observed to
  // occasionally race the real readiness signal (intermittent "WebSocket
  // connection failed" in the very first test of a run, ~1-in-6 under load).
  // STARTUP_GRACE_MS is kept as an upper-bound safety net only.
  await new Promise((resolve, reject) => {
    const deadline = setTimeout(() => {
      cleanup();
      reject(new Error(
        `wsh-server did not log readiness within ${STARTUP_GRACE_MS}ms: ${logs.join('')}`,
      ));
    }, STARTUP_GRACE_MS);

    function checkReady() {
      if (logs.some((l) => l.includes('WebSocket TLS listener started'))) {
        cleanup();
        resolve();
      }
    }

    function onExit(code) {
      cleanup();
      reject(new Error(`wsh-server exited early (code ${code}): ${logs.join('')}`));
    }

    function cleanup() {
      clearTimeout(deadline);
      proc.stdout.off('data', checkReady);
      proc.stderr.off('data', checkReady);
      proc.off('exit', onExit);
    }

    proc.stdout.on('data', checkReady);
    proc.stderr.on('data', checkReady);
    proc.once('exit', onExit);
    // In case the listener log line arrived in the same tick data was
    // pushed above (before these listeners were attached).
    checkReady();
  });

  return { proc, url: `wss://127.0.0.1:${port}`, homeDir, logs };
}

async function stopServer(server) {
  if (!server) return;
  server.proc.kill();
  await new Promise((resolve) => {
    if (server.proc.exitCode !== null) return resolve();
    server.proc.once('exit', resolve);
    setTimeout(resolve, 2000); // don't hang the suite if it's slow to die
  });
  rmSync(server.homeDir, { recursive: true, force: true });
}

async function makeKeyPair() {
  const kp = await generateKeyPair(true);
  const publicKeySSH = await exportPublicKeySSH(kp.publicKey);
  return { kp, publicKeySSH };
}

/** SHA-256 fingerprint bytes of a running server's self-signed cert, for WebTransport's serverCertificateHashes pinning. */
function certFingerprintBytes(server) {
  const certPath = path.join(server.homeDir, '.wsh', 'cert.pem');
  const fpOutput = execFileSync('openssl', ['x509', '-in', certPath, '-noout', '-fingerprint', '-sha256']).toString();
  const fpHex = fpOutput.split('=')[1].trim();
  return Uint8Array.from(fpHex.split(':').map((h) => parseInt(h, 16)));
}

/**
 * Install a WebTransport global that pins the given server's self-signed
 * dev cert (wsh-upon-star's WebTransportTransport calls `new
 * WebTransport(url)` with no options, so pinning has to be injected this
 * way). Returns a restore function — always call it in a `finally`.
 */
async function installPinnedWebTransport(server) {
  await quicheLoaded;
  const fingerprintBytes = certFingerprintBytes(server);
  const original = globalThis.WebTransport;
  globalThis.WebTransport = class extends RealWebTransport {
    constructor(url) {
      super(url, { serverCertificateHashes: [{ algorithm: 'sha-256', value: fingerprintBytes }] });
    }
  };
  return () => {
    if (original === undefined) delete globalThis.WebTransport;
    else globalThis.WebTransport = original;
  };
}

const servers = [];
const clients = [];
afterEach(async () => {
  for (const c of clients.splice(0)) await c.disconnect().catch(() => {});
  for (const s of servers.splice(0)) await stopServer(s).catch(() => {});
});

// ── Auth handshake ──────────────────────────────────────────────────

describe('Rust wsh-server auth handshake', () => {
  it('accepts a client whose key is in authorized_keys, over real TLS WebSocket', async () => {
    const { kp, publicKeySSH } = await makeKeyPair();
    const server = await startServer([publicKeySSH]);
    servers.push(server);

    const client = new WshClient();
    clients.push(client);
    const sessionId = await client.connect(server.url, { username: 'alice', keyPair: kp });
    assert.equal(typeof sessionId, 'string');
    assert.ok(sessionId.length > 0);
  });

  it('rejects a client whose key is not in authorized_keys', async () => {
    const { kp } = await makeKeyPair();
    const other = await makeKeyPair();
    const server = await startServer([other.publicKeySSH]);
    servers.push(server);

    const client = new WshClient();
    clients.push(client);
    await assert.rejects(
      () => client.connect(server.url, { username: 'mallory', keyPair: kp }),
      /Authentication failed/,
    );
  });

  it('completes the full HELLO -> SERVER_HELLO -> CHALLENGE -> AUTH -> AUTH_OK sequence', async () => {
    // The Rust server (crates/wsh-server/src/handshake.rs::handle_hello) always
    // sends SERVER_HELLO before CHALLENGE (never skips it), and wsh-upon-star's
    // WshClient.connect() explicitly branches on receiving SERVER_HELLO first
    // (see node_modules/wsh-upon-star/src/client.mjs). A successful connect()
    // resolving to a real (non-"pending") session ID is proof this exact path
    // — rather than the "server skipped SERVER_HELLO" fallback — was taken.
    const { kp, publicKeySSH } = await makeKeyPair();
    const server = await startServer([publicKeySSH]);
    servers.push(server);

    const client = new WshClient();
    clients.push(client);
    const sessionId = await client.connect(server.url, { username: 'alice', keyPair: kp });
    assert.notEqual(sessionId, 'pending');
    assert.match(sessionId, /^[0-9a-f]{32}$/);
  });
});

// ── Direct-host exec sessions ───────────────────────────────────────

describe('Rust wsh-server direct-host exec sessions', () => {
  it('runs a command and streams stdout back, then exits 0', async () => {
    const { kp, publicKeySSH } = await makeKeyPair();
    const server = await startServer([publicKeySSH]);
    servers.push(server);

    const client = new WshClient();
    clients.push(client);
    await client.connect(server.url, { username: 'alice', keyPair: kp });

    const session = await client.openSession({ type: 'exec', command: 'echo hello-wsh-rust' });
    const chunks = [];
    let exitCode = null;
    await new Promise((resolve) => {
      session.onData = (d) => chunks.push(d);
      session.onExit = (c) => { exitCode = c; };
      session.onClose = resolve;
    });

    const text = Buffer.concat(chunks.map((c) => Buffer.from(c))).toString('utf8');
    assert.match(text, /hello-wsh-rust/);
    assert.equal(exitCode, 0);
  });

  it('reports a non-zero exit code for a failing command', async () => {
    const { kp, publicKeySSH } = await makeKeyPair();
    const server = await startServer([publicKeySSH]);
    servers.push(server);

    const client = new WshClient();
    clients.push(client);
    await client.connect(server.url, { username: 'alice', keyPair: kp });

    const session = await client.openSession({ type: 'exec', command: 'exit 7' });
    let exitCode = null;
    await new Promise((resolve) => {
      session.onExit = (c) => { exitCode = c; };
      session.onClose = resolve;
    });
    assert.equal(exitCode, 7);
  });

  it('runs multiple sequential exec sessions on one authenticated connection', async () => {
    const { kp, publicKeySSH } = await makeKeyPair();
    const server = await startServer([publicKeySSH]);
    servers.push(server);

    const client = new WshClient();
    clients.push(client);
    await client.connect(server.url, { username: 'alice', keyPair: kp });

    for (const [command, expected] of [['echo one', /one/], ['echo two', /two/]]) {
      const session = await client.openSession({ type: 'exec', command });
      const chunks = [];
      await new Promise((resolve) => {
        session.onData = (d) => chunks.push(d);
        session.onClose = resolve;
      });
      const text = Buffer.concat(chunks.map((c) => Buffer.from(c))).toString('utf8');
      assert.match(text, expected);
    }
  });
});

// ── Real PTY sessions ────────────────────────────────────────────────
//
// This is the capability gap the Node reimplementation (tools/wsh-server.mjs)
// explicitly cannot fill — it has no real PTY backend and rejects `type:
// 'pty'` outright (see tools/test/wsh-server.test.mjs's "rejects kind 'pty'"
// test). The Rust server uses `portable-pty` for real PTYs
// (crates/wsh-server/src/session/pty.rs).

describe('Rust wsh-server real PTY sessions', () => {
  it('opens a pty session, runs a command, and closes with the right exit code', async () => {
    const { kp, publicKeySSH } = await makeKeyPair();
    const server = await startServer([publicKeySSH]);
    servers.push(server);

    const client = new WshClient();
    clients.push(client);
    await client.connect(server.url, { username: 'alice', keyPair: kp });

    const session = await client.openSession({ type: 'pty', command: 'echo pty-hello; exit 3' });
    const chunks = [];
    let exitCode = null;
    await new Promise((resolve) => {
      session.onData = (d) => chunks.push(d);
      session.onExit = (c) => { exitCode = c; };
      session.onClose = resolve;
    });

    const text = Buffer.concat(chunks.map((c) => Buffer.from(c))).toString('utf8');
    // A real PTY converts bare \n to \r\n (line discipline), unlike a plain
    // pipe — this is PTY-specific behavior a non-PTY exec backend wouldn't
    // produce, and is direct evidence the command ran under an actual PTY.
    assert.match(text, /pty-hello\r\n/);
    assert.equal(exitCode, 3);
  });

  it('accepts stdin written after open (interactive PTY) and echoes it back', async () => {
    const { kp, publicKeySSH } = await makeKeyPair();
    const server = await startServer([publicKeySSH]);
    servers.push(server);

    const client = new WshClient();
    clients.push(client);
    await client.connect(server.url, { username: 'alice', keyPair: kp });

    // `cat` with no args echoes each line of stdin back to stdout verbatim —
    // a simple, deterministic way to prove SessionData flows both
    // client->server (stdin, handled by the new dispatch_message SessionData
    // arm writing to PtyHandle::write_blocking) and server->client (stdout,
    // handled by the new spawn_pty_output_pump).
    const session = await client.openSession({ type: 'pty', command: 'cat' });
    const chunks = [];
    session.onData = (d) => chunks.push(d);

    // Give the PTY a moment to start reading before writing stdin.
    await new Promise((r) => setTimeout(r, 200));
    await session.write(new TextEncoder().encode('echo-back-marker\n'));

    // Poll briefly for the echoed line to show up in stdout.
    const deadline = Date.now() + 5000;
    let text = '';
    while (Date.now() < deadline) {
      text = Buffer.concat(chunks.map((c) => Buffer.from(c))).toString('utf8');
      if (text.includes('echo-back-marker')) break;
      await new Promise((r) => setTimeout(r, 50));
    }
    assert.match(text, /echo-back-marker/);

    // Send EOF (Ctrl-D) to make `cat` exit cleanly.
    await session.write(new Uint8Array([0x04]));
    await new Promise((resolve) => {
      session.onClose = resolve;
      session.onExit = () => {};
    });
  });
});

// ── WebTransport (QUIC) — listener-level check only ─────────────────
//
// See the file header comment for exactly why this cannot be a full
// end-to-end interop test in plain Node (no global `WebTransport` in Node,
// and wsh-upon-star's WebTransportTransport requires one).

describe('Rust wsh-server WebTransport/QUIC listener', () => {
  it('binds the WebTransport (QUIC/UDP) listener and stays healthy at startup', async () => {
    const { publicKeySSH } = await makeKeyPair();
    const server = await startServer([publicKeySSH]);
    servers.push(server);

    assert.ok(
      server.logs.some((l) => l.includes('WebTransport listener started')),
      `expected a "WebTransport listener started" log line, got:\n${server.logs.join('')}`,
    );
    assert.ok(
      !server.logs.some((l) => /panic|WebTransport bind failed/i.test(l)),
      `expected no WebTransport startup errors, got:\n${server.logs.join('')}`,
    );
    assert.equal(server.proc.exitCode, null, 'server process should still be running');
  });

  it('authenticates and runs a direct-host exec session over real WebTransport (QUIC)', async () => {
    const { kp, publicKeySSH } = await makeKeyPair();
    const server = await startServer([publicKeySSH]);
    servers.push(server);

    const restoreWebTransport = await installPinnedWebTransport(server);

    try {
      const wtUrl = server.url.replace(/^wss:\/\//, 'https://');
      const client = new WshClient();
      clients.push(client);
      const sessionId = await client.connect(wtUrl, { username: 'alice', keyPair: kp, transport: 'wt' });
      assert.equal(typeof sessionId, 'string');
      assert.equal(client._transport.constructor.name, 'WebTransportTransport');

      const session = await client.openSession({ type: 'exec', command: 'echo rust-wt-exec-works' });
      const chunks = [];
      let exitCode = null;
      await new Promise((resolve) => {
        session.onData = (d) => chunks.push(d);
        session.onExit = (c) => { exitCode = c; };
        session.onClose = resolve;
      });
      const stdout = Buffer.concat(chunks.map((c) => Buffer.from(c))).toString('utf8');
      assert.match(stdout, /rust-wt-exec-works/);
      assert.equal(exitCode, 0);
    } finally {
      restoreWebTransport();
    }
  });
});

// ── Relay (reverse-connect) across mixed transports ──────────────────
//
// Mirrors tools/test/wsh-webtransport.test.mjs's "relay reverse-connect
// works across mixed transports" test, but against the real Rust binary
// with --enable-relay instead of the Node reimplementation — the actual
// cross-implementation check for whether the Rust relay (crates/wsh-server/
// src/relay/{broker,registry}.rs, dispatched from server.rs's
// ReverseRegister/ReverseList/ReverseConnect/ReverseAccept arms) speaks the
// same wire protocol wsh-upon-star expects, and whether a WebSocket peer and
// a WebTransport operator can be bridged through it.

describe('Rust wsh-server relay — mixed transports', () => {
  it('relay reverse-connect works: WebSocket peer, WebTransport operator', async () => {
    const { kp: operatorKp, publicKeySSH: opPub } = await makeKeyPair();
    const { publicKeySSH: peerPub, kp: peerKp } = await makeKeyPair();

    const server = await startServer([opPub, peerPub], ['--enable-relay']);
    servers.push(server);

    // Peer registers over WebSocket (wss://, self-signed dev cert).
    const peerClient = new WshClient();
    clients.push(peerClient);
    await peerClient.connectReverse(server.url, {
      username: 'browser-tab', keyPair: peerKp, expose: { exec: true }, transport: 'ws',
    });
    peerClient.onReverseConnect = (msg) => {
      peerClient.sendRelayControl(reverseAccept({ targetFingerprint: msg.target_fingerprint, username: 'browser-tab' }));
    };

    // Operator connects over WebTransport and reverse-connects to that peer.
    const restoreWebTransport = await installPinnedWebTransport(server);
    try {
      const wtUrl = server.url.replace(/^wss:\/\//, 'https://');
      const operatorClient = new WshClient();
      clients.push(operatorClient);
      await operatorClient.connect(wtUrl, { username: 'operator', keyPair: operatorKp, transport: 'wt' });
      assert.equal(operatorClient._transport.constructor.name, 'WebTransportTransport');

      const [peerInfo] = await operatorClient.listPeers();
      assert.ok(peerInfo, 'expected the WebSocket peer to be visible to the WebTransport operator via ReverseList/ReversePeers');
      const acceptResponse = await operatorClient.reverseConnect(peerInfo.fingerprint);
      assert.equal(acceptResponse.type, MSG.REVERSE_ACCEPT);
    } finally {
      restoreWebTransport();
    }
  });
});
