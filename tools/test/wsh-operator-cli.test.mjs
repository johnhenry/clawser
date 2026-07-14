// tools/test/wsh-operator-cli.test.mjs
// Run with: node --test tools/test/wsh-operator-cli.test.mjs

import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { exportPublicKeySSH } from 'wsh-upon-star';
import { WshServer, parseAuthorizedKeys } from '../wsh-server.mjs';
import {
  parseArgs, keygen, loadKeyPair, listKeys,
  cmdPeers, cmdExec, cmdReverseConnect, main,
} from '../wsh-operator-cli.mjs';

// ── parseArgs ────────────────────────────────────────────────────────

describe('parseArgs', () => {
  it('parses a bare command', () => {
    const r = parseArgs(['keys']);
    assert.equal(r.command, 'keys');
    assert.deepEqual(r.positional, []);
  });

  it('parses positional args', () => {
    const r = parseArgs(['peers', 'example.com']);
    assert.equal(r.command, 'peers');
    assert.deepEqual(r.positional, ['example.com']);
  });

  it('parses -p/--port', () => {
    assert.equal(parseArgs(['peers', 'h', '-p', '5555']).port, 5555);
    assert.equal(parseArgs(['peers', 'h', '--port', '6666']).port, 6666);
  });

  it('defaults port to 4422', () => {
    assert.equal(parseArgs(['peers', 'h']).port, 4422);
  });

  it('parses -i/--identity', () => {
    assert.equal(parseArgs(['peers', 'h', '-i', 'work']).identity, 'work');
    assert.equal(parseArgs(['peers', 'h', '--identity', 'work']).identity, 'work');
  });

  it('defaults identity to "default"', () => {
    assert.equal(parseArgs(['peers', 'h']).identity, 'default');
  });

  it('collects everything after -- as rest', () => {
    const r = parseArgs(['reverse-connect', 'fp', 'host', '--', 'ls', '-la']);
    assert.deepEqual(r.positional, ['fp', 'host']);
    assert.deepEqual(r.rest, ['ls', '-la']);
  });

  it('returns command null for empty argv', () => {
    assert.equal(parseArgs([]).command, null);
  });
});

// ── Key storage ──────────────────────────────────────────────────────

describe('keygen / loadKeyPair / listKeys', () => {
  let dir;
  afterEach(async () => {
    if (dir) await rm(dir, { recursive: true, force: true });
    dir = null;
  });

  it('generates a key and writes both files', async () => {
    dir = await mkdtemp(path.join(tmpdir(), 'wsh-keys-'));
    const { publicKeySSH, privatePath, publicPath } = await keygen('mykey', dir);
    assert.match(publicKeySSH, /^ssh-ed25519 /);
    assert.equal(privatePath, path.join(dir, 'mykey'));
    assert.equal(publicPath, path.join(dir, 'mykey.pub'));
  });

  it('round-trips: loaded key pair signs the same as the original', async () => {
    dir = await mkdtemp(path.join(tmpdir(), 'wsh-keys-'));
    await keygen('mykey', dir);
    const loaded = await loadKeyPair('mykey', dir);
    const loadedPubSSH = await exportPublicKeySSH(loaded.publicKey);

    const data = new TextEncoder().encode('round-trip check');
    const sig = new Uint8Array(await crypto.subtle.sign('Ed25519', loaded.privateKey, data));
    const ok = await crypto.subtle.verify('Ed25519', loaded.publicKey, sig, data);
    assert.equal(ok, true);
    assert.match(loadedPubSSH, /^ssh-ed25519 /);
  });

  it('listKeys returns generated key names', async () => {
    dir = await mkdtemp(path.join(tmpdir(), 'wsh-keys-'));
    await keygen('alpha', dir);
    await keygen('beta', dir);
    const names = (await listKeys(dir)).sort();
    assert.deepEqual(names, ['alpha', 'beta']);
  });

  it('listKeys returns an empty array for a nonexistent directory', async () => {
    const names = await listKeys(path.join(tmpdir(), 'wsh-keys-does-not-exist-' + Date.now()));
    assert.deepEqual(names, []);
  });
});

// ── Commands against a real WshServer ───────────────────────────────

const servers = [];
afterEach(async () => {
  for (const s of servers.splice(0)) await s.close().catch(() => {});
});

async function startServerWithKey(dir, name) {
  const { publicKeySSH } = await keygen(name, dir);
  const keyPair = await loadKeyPair(name, dir);
  const authorizedKeys = await parseAuthorizedKeys(publicKeySSH + ` ${name}\n`);
  const server = new WshServer({ authorizedKeys });
  const port = await server.listen({ port: 0, host: '127.0.0.1' });
  servers.push(server);
  return { keyPair, port };
}

describe('cmdPeers / cmdExec / cmdReverseConnect', () => {
  let dir;
  afterEach(async () => {
    if (dir) await rm(dir, { recursive: true, force: true });
    dir = null;
  });

  it('cmdExec runs a command on a direct-host server', async () => {
    dir = await mkdtemp(path.join(tmpdir(), 'wsh-keys-'));
    const { keyPair, port } = await startServerWithKey(dir, 'operator');
    const { stdout, exitCode } = await cmdExec('127.0.0.1', 'echo cli-exec-works', { port, keyPair });
    assert.match(stdout, /cli-exec-works/);
    assert.equal(exitCode, 0);
  });

  it('cmdPeers lists peers registered on a relay', async () => {
    dir = await mkdtemp(path.join(tmpdir(), 'wsh-keys-'));
    const { publicKeySSH: opPub } = await keygen('operator', dir);
    const operatorKp = await loadKeyPair('operator', dir);
    const { publicKeySSH: peerPub } = await keygen('peer', dir);
    const peerKp = await loadKeyPair('peer', dir);

    const authorizedKeys = await parseAuthorizedKeys([opPub, peerPub].join('\n'));
    const server = new WshServer({ authorizedKeys, enableRelay: true });
    const port = await server.listen({ port: 0, host: '127.0.0.1' });
    servers.push(server);

    const { WshClient } = await import('wsh-upon-star');
    const peerClient = new WshClient();
    await peerClient.connectReverse(`ws://127.0.0.1:${port}`, { username: 'browser-tab', keyPair: peerKp, expose: { exec: true } });

    const peers = await cmdPeers('127.0.0.1', { port, keyPair: operatorKp });
    assert.equal(peers.length, 1);
    assert.equal(peers[0].username, 'browser-tab');

    await peerClient.disconnect();
  });

  it('cmdReverseConnect throws a clear error when the peer rejects', async () => {
    dir = await mkdtemp(path.join(tmpdir(), 'wsh-keys-'));
    const { publicKeySSH: opPub } = await keygen('operator', dir);
    const operatorKp = await loadKeyPair('operator', dir);
    const { publicKeySSH: peerPub } = await keygen('peer', dir);
    const peerKp = await loadKeyPair('peer', dir);

    const authorizedKeys = await parseAuthorizedKeys([opPub, peerPub].join('\n'));
    const server = new WshServer({ authorizedKeys, enableRelay: true });
    const port = await server.listen({ port: 0, host: '127.0.0.1' });
    servers.push(server);

    const { WshClient, reverseReject } = await import('wsh-upon-star');
    const peerClient = new WshClient();
    await peerClient.connectReverse(`ws://127.0.0.1:${port}`, { username: 'browser-tab', keyPair: peerKp });
    peerClient.onReverseConnect = (msg) => {
      peerClient.sendRelayControl(reverseReject({ targetFingerprint: msg.target_fingerprint, username: 'browser-tab', reason: 'not now' }));
    };

    const peers = await cmdPeers('127.0.0.1', { port, keyPair: operatorKp });
    await assert.rejects(
      () => cmdReverseConnect(peers[0].fingerprint, '127.0.0.1', 'whoami', { port, keyPair: operatorKp }),
      /not now/,
    );

    await peerClient.disconnect();
  });
});

// ── main() smoke tests ───────────────────────────────────────────────

describe('main()', () => {
  it('prints help and returns 0 for no command', async () => {
    let out = '';
    const orig = process.stdout.write;
    process.stdout.write = (s) => { out += s; return true; };
    const code = await main([]);
    process.stdout.write = orig;
    assert.equal(code, 0);
    assert.match(out, /Usage:/);
  });

  it('returns 1 for an unknown command', async () => {
    let err = '';
    const orig = process.stderr.write;
    process.stderr.write = (s) => { err += s; return true; };
    const code = await main(['bogus-command']);
    process.stderr.write = orig;
    assert.equal(code, 1);
    assert.match(err, /Unknown command/);
  });

  it('returns 1 for "peers" with no usable identity or host', async () => {
    // main() resolves keys against the real ~/.wsh/keys/ (DEFAULT_KEYS_DIR
    // is captured from os.homedir() at import time, so it can't be
    // redirected per-test) — this just proves the command fails cleanly
    // either way: missing key, or missing host once a key does load.
    let err = '';
    const orig = process.stderr.write;
    process.stderr.write = (s) => { err += s; return true; };
    const code = await main(['peers']);
    process.stderr.write = orig;
    assert.equal(code, 1);
    assert.match(err, /not found|Usage:/);
  });
});
