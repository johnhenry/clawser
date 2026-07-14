#!/usr/bin/env node
/**
 * tools/wsh-operator-cli.mjs — a thin Node.js "operator" CLI for wsh-v1,
 * built directly on the real `wsh-upon-star` client library (works in
 * Node 24+ per its own README — Web Crypto's Ed25519 support is what it
 * actually needs, and Node has that built in).
 *
 * Replaces the vanished Rust `wsh` CLI's operator-side commands used in
 * docs/WSH-INTO-CLAWSER.md: `keygen`, `keys`, `peers`, `reverse-connect`,
 * plus a `exec` command for the direct-host path. Everything here talks
 * to `tools/wsh-server.mjs` (or any wsh-v1-compatible server).
 *
 * Not replicated from the original doc (documented as gaps, not silently
 * dropped): `wsh check relay` (relay self-diagnosis), `wsh agent install`
 * (systemd/launchd startup unit), `wsh copy-id` (password-bootstrapped
 * key install). None of these exist in wsh-upon-star either.
 *
 * Usage:
 *   node tools/wsh-operator-cli.mjs keygen <name>
 *   node tools/wsh-operator-cli.mjs keys
 *   node tools/wsh-operator-cli.mjs peers <host> [-p port] [-i identity]
 *   node tools/wsh-operator-cli.mjs exec <host> <command...> [-p port] [-i identity]
 *   node tools/wsh-operator-cli.mjs reverse-connect <target> <host> [-p port] [-i identity] [-- command...]
 *
 * Run tests:
 *   node --test tools/test/wsh-operator-cli.test.mjs
 */

import { mkdir, writeFile, readFile, readdir, chmod } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';

import {
  WshClient,
  generateKeyPair, exportPublicKeySSH, exportPrivateKeyPKCS8, importPrivateKeyPKCS8,
  MSG,
} from 'wsh-upon-star';

const DEFAULT_PORT = 4422;
export const DEFAULT_KEYS_DIR = path.join(homedir(), '.wsh', 'keys');

// ---------------------------------------------------------------------------
// Argument parsing (minimal — this CLI has a small, fixed flag set)
// ---------------------------------------------------------------------------

/**
 * @param {string[]} argv - e.g. process.argv.slice(2)
 * @returns {{command: string|null, positional: string[], port: number, identity: string, rest: string[]}}
 */
export function parseArgs(argv) {
  const [command, ...args] = argv;
  const positional = [];
  const rest = [];
  let port = DEFAULT_PORT;
  let identity = 'default';
  let inRest = false;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (inRest) { rest.push(arg); continue; }
    if (arg === '--') { inRest = true; continue; }
    if (arg === '-p' || arg === '--port') { port = parseInt(args[++i], 10); continue; }
    if (arg === '-i' || arg === '--identity') { identity = args[++i]; continue; }
    positional.push(arg);
  }

  return { command: command || null, positional, port, identity, rest };
}

// ---------------------------------------------------------------------------
// Key storage — ~/.wsh/keys/<name> (PKCS8 private key) + <name>.pub (SSH format)
// ---------------------------------------------------------------------------

/**
 * Generate and save a new Ed25519 key pair.
 * @param {string} name
 * @param {string} [keysDir]
 * @returns {Promise<{publicKeySSH: string, privatePath: string, publicPath: string}>}
 */
export async function keygen(name, keysDir = DEFAULT_KEYS_DIR) {
  await mkdir(keysDir, { recursive: true, mode: 0o700 });
  const { publicKey, privateKey } = await generateKeyPair(true);
  const pkcs8 = await exportPrivateKeyPKCS8(privateKey);
  const publicKeySSH = await exportPublicKeySSH(publicKey);

  const privatePath = path.join(keysDir, name);
  const publicPath = path.join(keysDir, `${name}.pub`);
  await writeFile(privatePath, pkcs8);
  await chmod(privatePath, 0o600);
  await writeFile(publicPath, `${publicKeySSH} ${name}\n`);

  return { publicKeySSH, privatePath, publicPath };
}

/**
 * Load a previously generated key pair by name.
 * @param {string} name
 * @param {string} [keysDir]
 * @returns {Promise<CryptoKeyPair>}
 */
export async function loadKeyPair(name, keysDir = DEFAULT_KEYS_DIR) {
  const privatePath = path.join(keysDir, name);
  const pkcs8 = await readFile(privatePath);
  const privateKey = await importPrivateKeyPKCS8(new Uint8Array(pkcs8), true);
  const pubText = await readFile(path.join(keysDir, `${name}.pub`), 'utf8');
  const [, base64] = pubText.trim().split(' ');
  const raw = Buffer.from(base64, 'base64');
  // SSH wire format: [4-byte len]["ssh-ed25519"][4-byte len][32-byte raw key]
  const keyStart = 4 + raw.readUInt32BE(0) + 4;
  const rawKey = new Uint8Array(raw.subarray(keyStart, keyStart + 32));
  const { importPublicKeyRaw } = await import('wsh-upon-star');
  const publicKey = await importPublicKeyRaw(rawKey);
  return { publicKey, privateKey };
}

/**
 * List stored key names (based on `<name>.pub` files present).
 * @param {string} [keysDir]
 * @returns {Promise<string[]>}
 */
export async function listKeys(keysDir = DEFAULT_KEYS_DIR) {
  let entries;
  try {
    entries = await readdir(keysDir);
  } catch {
    return [];
  }
  return entries.filter((f) => f.endsWith('.pub')).map((f) => f.slice(0, -4));
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

/**
 * List peers registered on a relay.
 * @param {string} host
 * @param {object} opts
 * @param {number} [opts.port]
 * @param {CryptoKeyPair} opts.keyPair
 * @param {string} [opts.username='operator']
 * @returns {Promise<Array<object>>}
 */
export async function cmdPeers(host, { port = DEFAULT_PORT, keyPair, username = 'operator' }) {
  const client = new WshClient();
  try {
    await client.connect(`ws://${host}:${port}`, { username, keyPair });
    return await client.listPeers();
  } finally {
    await client.disconnect().catch(() => {});
  }
}

/**
 * Run one command directly against a `wsh-server` host and collect its
 * output + exit code.
 * @param {string} host
 * @param {string} command
 * @param {object} opts
 * @param {number} [opts.port]
 * @param {CryptoKeyPair} opts.keyPair
 * @param {string} [opts.username='operator']
 * @returns {Promise<{stdout: string, exitCode: number}>}
 */
export async function cmdExec(host, command, { port = DEFAULT_PORT, keyPair, username = 'operator' }) {
  const client = new WshClient();
  try {
    await client.connect(`ws://${host}:${port}`, { username, keyPair });
    return await runExecSession(client, command);
  } finally {
    await client.disconnect().catch(() => {});
  }
}

/**
 * Reverse-connect to a registered peer through a relay and run one
 * command against it.
 * @param {string} targetFingerprint
 * @param {string} relayHost
 * @param {string} command
 * @param {object} opts
 * @param {number} [opts.port]
 * @param {CryptoKeyPair} opts.keyPair
 * @param {string} [opts.username='operator']
 * @returns {Promise<{stdout: string, exitCode: number}>}
 */
export async function cmdReverseConnect(targetFingerprint, relayHost, command, { port = DEFAULT_PORT, keyPair, username = 'operator' }) {
  const client = new WshClient();
  try {
    await client.connect(`ws://${relayHost}:${port}`, { username, keyPair });
    const response = await client.reverseConnect(targetFingerprint);
    if (response.type === MSG.REVERSE_REJECT) {
      throw new Error(`Peer rejected the connection: ${response.reason || 'no reason given'}`);
    }
    return await runExecSession(client, command);
  } finally {
    await client.disconnect().catch(() => {});
  }
}

/** @returns {Promise<{stdout: string, exitCode: number}>} */
async function runExecSession(client, command) {
  const session = await client.openSession({ type: 'exec', command });
  const chunks = [];
  let exitCode = 0;
  await new Promise((resolve) => {
    session.onData = (d) => chunks.push(d);
    session.onExit = (c) => { exitCode = Number.isFinite(c) ? c : 0; };
    session.onClose = resolve;
  });
  await session.close().catch(() => {});
  const stdout = Buffer.concat(chunks.map((c) => Buffer.from(c))).toString('utf8');
  return { stdout, exitCode };
}

// ---------------------------------------------------------------------------
// CLI entry point
// ---------------------------------------------------------------------------

const HELP_TEXT = `wsh-operator-cli — connect to a wsh-server or relay from Node.js

Usage:
  wsh-operator-cli keygen <name>
  wsh-operator-cli keys
  wsh-operator-cli peers <host> [-p port] [-i identity]
  wsh-operator-cli exec <host> <command...> [-p port] [-i identity]
  wsh-operator-cli reverse-connect <target> <host> [-p port] [-i identity] -- <command...>

Options:
  -p, --port <n>       Relay/server port (default: ${DEFAULT_PORT})
  -i, --identity <name> Key name under ~/.wsh/keys/ (default: "default")
`;

export async function main(argv) {
  const { command, positional, port, identity, rest } = parseArgs(argv);

  if (!command || command === 'help' || command === '--help') {
    process.stdout.write(HELP_TEXT);
    return 0;
  }

  if (command === 'keygen') {
    const name = positional[0] || 'default';
    const { publicKeySSH, privatePath } = await keygen(name);
    process.stdout.write(`Generated ${privatePath}\n${publicKeySSH} ${name}\n`);
    return 0;
  }

  if (command === 'keys') {
    const names = await listKeys();
    if (names.length === 0) process.stdout.write('No keys found. Run: wsh-operator-cli keygen <name>\n');
    else process.stdout.write(names.map((n) => `${n}\n`).join(''));
    return 0;
  }

  const KNOWN_COMMANDS = new Set(['peers', 'exec', 'reverse-connect']);
  if (!KNOWN_COMMANDS.has(command)) {
    process.stderr.write(`Unknown command: ${command}\n\n${HELP_TEXT}`);
    return 1;
  }

  const keyPair = await loadKeyPair(identity).catch(() => null);
  if (!keyPair) {
    process.stderr.write(`Key "${identity}" not found. Run: wsh-operator-cli keygen ${identity}\n`);
    return 1;
  }

  if (command === 'peers') {
    const host = positional[0];
    if (!host) { process.stderr.write('Usage: wsh-operator-cli peers <host> [-p port] [-i identity]\n'); return 1; }
    const peers = await cmdPeers(host, { port, keyPair });
    if (peers.length === 0) process.stdout.write('No peers registered.\n');
    for (const p of peers) {
      process.stdout.write(`${p.fingerprint_short}  ${p.username}  [${(p.capabilities || []).join(',')}]\n`);
    }
    return 0;
  }

  if (command === 'exec') {
    const [host, ...cmdParts] = positional;
    const commandStr = cmdParts.join(' ') || rest.join(' ');
    if (!host || !commandStr) { process.stderr.write('Usage: wsh-operator-cli exec <host> <command...> [-p port] [-i identity]\n'); return 1; }
    const { stdout, exitCode } = await cmdExec(host, commandStr, { port, keyPair });
    process.stdout.write(stdout);
    return exitCode;
  }

  if (command === 'reverse-connect') {
    const [target, host] = positional;
    const commandStr = rest.join(' ');
    if (!target || !host || !commandStr) {
      process.stderr.write('Usage: wsh-operator-cli reverse-connect <target> <host> [-p port] [-i identity] -- <command...>\n');
      return 1;
    }
    const { stdout, exitCode } = await cmdReverseConnect(target, host, commandStr, { port, keyPair });
    process.stdout.write(stdout);
    return exitCode;
  }

  // Unreachable: KNOWN_COMMANDS above already filtered to exactly these three.
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main(process.argv.slice(2)).then((code) => process.exit(code));
}
