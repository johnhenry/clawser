/**
 * Clawser wsh CLI — Browser shell commands for remote access.
 *
 * Registers the `wsh` command with clawser's shell CommandRegistry,
 * providing SSH-like remote access from the browser terminal.
 *
 * Usage:
 *   import { registerWshCli } from './clawser-wsh-cli.js';
 *   registerWshCli(registry, getAgent, getShell);
 */

import {
  WshClient, WshKeyStore, WshFileTransfer, WshMcpBridge,
  generateKeyPair, exportPublicKeySSH, fingerprint, exportPublicKeyRaw,
  shortFingerprint,
} from './packages-wsh.js';
import { parseFlags } from './clawser-cli.js';
import { getWshConnections } from './clawser-wsh-tools.js';

// ── Flag Spec ─────────────────────────────────────────────────────

const FLAG_SPEC = {
  p: 'port',
  i: 'identity',
  t: 'transport',
  v: 'verbose',
  port: 'value',
  identity: 'value',
  transport: 'value',
  verbose: true,
};

// ── Help Text ─────────────────────────────────────────────────────

const HELP_TEXT = `wsh — Web Shell

Usage:
  wsh user@host                    Interactive PTY (like ssh)
  wsh user@host command            One-off exec (like ssh user@host cmd)
  wsh connect user@host            Connect and keep session
  wsh list                         List active sessions
  wsh attach <session>             Attach to named session
  wsh detach                       Detach from current session
  wsh keygen [name]                Generate Ed25519 key pair
  wsh keys                         List stored keys (with short fingerprints)
  wsh copy-id user@host            Copy public key to remote authorized_keys
  wsh scp local remote             Upload file
  wsh scp remote local             Download file
  wsh tools [host]                 List MCP tools on connected host
  wsh reverse relay --expose-shell Register as reverse-connectable peer
  wsh peers relay                  List reverse-connected peers on relay

Options:
  -p, --port <PORT>                Server port [default: 4422]
  -i, --identity <KEY>             Key name [default: default]
  -t, --transport <ws|wt>          Force transport type
  -v, --verbose                    Verbose output
`;

// ── Subcommand Metadata ───────────────────────────────────────────

export const WSH_SUBCOMMAND_META = [
  { name: 'wsh', description: 'Web Shell — remote access over WebTransport/WebSocket', usage: 'wsh user@host [command]' },
  { name: 'wsh connect', description: 'Connect to remote host', usage: 'wsh connect user@host' },
  { name: 'wsh keygen', description: 'Generate Ed25519 key pair', usage: 'wsh keygen [name]' },
  { name: 'wsh keys', description: 'List stored SSH keys', usage: 'wsh keys' },
  { name: 'wsh list', description: 'List active sessions', usage: 'wsh list' },
  { name: 'wsh scp', description: 'File transfer', usage: 'wsh scp <src> <dst>' },
  { name: 'wsh tools', description: 'List remote MCP tools', usage: 'wsh tools [host]' },
];

// ── Registration ──────────────────────────────────────────────────

/**
 * Register the `wsh` command with the shell registry.
 * @param {import('./clawser-shell.js').CommandRegistry} registry
 * @param {() => import('./clawser-agent.js').ClawserAgent} getAgent
 * @param {() => import('./clawser-shell.js').ClawserShell} getShell
 */
export function registerWshCli(registry, getAgent, getShell) {
  const connections = getWshConnections();
  let keyStore = null;

  async function ensureKeyStore() {
    if (!keyStore) {
      keyStore = new WshKeyStore();
      await keyStore.open();
    }
    return keyStore;
  }

  function parseUserHost(str, defaultPort = 4422) {
    // user@host:port or user@host
    const match = str.match(/^(?:([^@]+)@)?([^:]+)(?::(\d+))?$/);
    if (!match) return null;
    return {
      user: match[1] || '',
      host: match[2],
      port: match[3] ? parseInt(match[3]) : defaultPort,
    };
  }

  function buildUrl(host, port, transport) {
    const scheme = transport === 'ws' ? 'wss' : 'https';
    return `${scheme}://${host}:${port}`;
  }

  // ── Subcommand: keygen ─────────────────────────────────────────

  async function cmdKeygen(args) {
    const name = args[0] || 'default';
    const ks = await ensureKeyStore();

    try {
      const result = await ks.generateKey(name);
      return {
        stdout: `Generated Ed25519 key pair "${name}"\nFingerprint: ${result.fingerprint}\nPublic key: ${result.publicKeySSH}\n`,
        stderr: '', exitCode: 0,
      };
    } catch (err) {
      if (err.message?.includes('already exists')) {
        return { stdout: '', stderr: `Key "${name}" already exists.\n`, exitCode: 1 };
      }
      return { stdout: '', stderr: `keygen failed: ${err.message}\n`, exitCode: 1 };
    }
  }

  // ── Subcommand: keys ───────────────────────────────────────────

  async function cmdKeys() {
    const ks = await ensureKeyStore();
    const keys = await ks.listKeys();

    if (keys.length === 0) {
      return { stdout: 'No keys stored. Run: wsh keygen\n', stderr: '', exitCode: 0 };
    }

    const fps = keys.map(k => k.fingerprint);
    const lines = ['NAME          FINGERPRINT       CREATED'];
    for (const k of keys) {
      const short = shortFingerprint(k.fingerprint, fps, 8);
      const date = new Date(k.createdAt).toLocaleDateString();
      lines.push(`${k.name.padEnd(14)}${short.padEnd(18)}${date}`);
    }
    return { stdout: lines.join('\n') + '\n', stderr: '', exitCode: 0 };
  }

  // ── Subcommand: connect ────────────────────────────────────────

  async function cmdConnect(positional, flags) {
    const target = positional[0];
    if (!target) {
      return { stdout: '', stderr: 'Usage: wsh connect user@host\n', exitCode: 1 };
    }

    const parsed = parseUserHost(target, parseInt(flags.port) || 4422);
    if (!parsed || !parsed.user) {
      return { stdout: '', stderr: 'Invalid target. Use: user@host[:port]\n', exitCode: 1 };
    }

    const keyName = flags.identity || 'default';
    const transport = flags.transport || 'auto';

    try {
      const ks = await ensureKeyStore();
      const keyPair = await ks.getKeyPair(keyName);
      if (!keyPair) {
        return { stdout: '', stderr: `Key "${keyName}" not found. Run: wsh keygen\n`, exitCode: 1 };
      }

      const url = buildUrl(parsed.host, parsed.port, transport);
      const client = new WshClient();
      const sessionId = await client.connect(url, {
        username: parsed.user,
        keyPair,
        transport: transport !== 'auto' ? transport : undefined,
      });

      connections.set(parsed.host, client);
      return {
        stdout: `Connected to ${parsed.host} as ${parsed.user} (session: ${sessionId})\n`,
        stderr: '', exitCode: 0,
      };
    } catch (err) {
      return { stdout: '', stderr: `Connection failed: ${err.message}\n`, exitCode: 1 };
    }
  }

  // ── Subcommand: exec (user@host command) ───────────────────────

  async function cmdExec(userHost, command, flags) {
    const parsed = parseUserHost(userHost, parseInt(flags.port) || 4422);
    if (!parsed || !parsed.user) {
      return { stdout: '', stderr: 'Invalid target. Use: user@host[:port]\n', exitCode: 1 };
    }

    const keyName = flags.identity || 'default';
    const transport = flags.transport || 'auto';

    try {
      const ks = await ensureKeyStore();
      const keyPair = await ks.getKeyPair(keyName);
      if (!keyPair) {
        return { stdout: '', stderr: `Key "${keyName}" not found.\n`, exitCode: 1 };
      }

      const url = buildUrl(parsed.host, parsed.port, transport);
      const result = await WshClient.exec(url, command, {
        username: parsed.user,
        keyPair,
      });

      const decoder = new TextDecoder();
      const output = result.stdout instanceof Uint8Array
        ? decoder.decode(result.stdout)
        : String(result.stdout || '');

      return {
        stdout: output,
        stderr: result.exitCode !== 0 ? `(exit code: ${result.exitCode})\n` : '',
        exitCode: result.exitCode,
      };
    } catch (err) {
      return { stdout: '', stderr: `Exec failed: ${err.message}\n`, exitCode: 1 };
    }
  }

  // ── Subcommand: list ───────────────────────────────────────────

  async function cmdList() {
    const results = [];
    for (const [host, client] of connections) {
      if (client.state !== 'authenticated') continue;
      for (const s of client.listSessions()) {
        results.push({ host, ...s });
      }
    }

    if (results.length === 0) {
      return { stdout: 'No active sessions.\n', stderr: '', exitCode: 0 };
    }

    const lines = ['HOST             ID    KIND   STATE'];
    for (const s of results) {
      lines.push(`${s.host.padEnd(17)}${String(s.channelId).padEnd(6)}${s.kind.padEnd(7)}${s.state}`);
    }
    return { stdout: lines.join('\n') + '\n', stderr: '', exitCode: 0 };
  }

  // ── Subcommand: scp ────────────────────────────────────────────

  async function cmdScp(positional, flags) {
    if (positional.length < 2) {
      return { stdout: '', stderr: 'Usage: wsh scp <source> <destination>\n  Use user@host:path for remote paths\n', exitCode: 1 };
    }

    const [src, dst] = positional;
    const isRemoteSrc = src.includes(':');
    const isRemoteDst = dst.includes(':');

    if (isRemoteSrc === isRemoteDst) {
      return { stdout: '', stderr: 'One of source/destination must be remote (user@host:path)\n', exitCode: 1 };
    }

    // TODO: Implement file transfer using WshFileTransfer
    return { stdout: '', stderr: 'scp: not yet implemented in browser shell\n', exitCode: 1 };
  }

  // ── Subcommand: tools ──────────────────────────────────────────

  async function cmdTools(positional) {
    const host = positional[0] || [...connections.keys()].pop();
    if (!host) {
      return { stdout: '', stderr: 'No active connection. Specify a host or connect first.\n', exitCode: 1 };
    }

    const client = connections.get(host);
    if (!client || client.state !== 'authenticated') {
      return { stdout: '', stderr: `Not connected to ${host}\n`, exitCode: 1 };
    }

    try {
      const bridge = new WshMcpBridge(client);
      const tools = await bridge.discover();

      if (tools.length === 0) {
        return { stdout: 'No remote MCP tools available.\n', stderr: '', exitCode: 0 };
      }

      const lines = ['NAME                 DESCRIPTION'];
      for (const t of tools) {
        lines.push(`${t.name.padEnd(21)}${t.description || ''}`);
      }
      return { stdout: lines.join('\n') + '\n', stderr: '', exitCode: 0 };
    } catch (err) {
      return { stdout: '', stderr: `Failed to discover tools: ${err.message}\n`, exitCode: 1 };
    }
  }

  // ── Main command handler ───────────────────────────────────────

  registry.register('wsh', async ({ args }) => {
    const { flags, positional } = parseFlags(args, FLAG_SPEC);

    if (positional.length === 0 || positional[0] === 'help' || flags.help) {
      return { stdout: HELP_TEXT, stderr: '', exitCode: 0 };
    }

    const sub = positional[0];

    // Subcommands
    switch (sub) {
      case 'keygen':
        return cmdKeygen(positional.slice(1));
      case 'keys':
        return cmdKeys();
      case 'connect':
        return cmdConnect(positional.slice(1), flags);
      case 'list':
      case 'sessions':
        return cmdList();
      case 'attach':
        return { stdout: '', stderr: 'attach: use interactive PTY mode\n', exitCode: 1 };
      case 'detach':
        return { stdout: '', stderr: 'detach: use Ctrl+D or close session\n', exitCode: 1 };
      case 'copy-id':
        return { stdout: '', stderr: 'copy-id: not yet implemented in browser shell\n', exitCode: 1 };
      case 'scp':
        return cmdScp(positional.slice(1), flags);
      case 'tools':
        return cmdTools(positional.slice(1));
      case 'reverse':
        return { stdout: '', stderr: 'reverse: not yet implemented in browser shell\n', exitCode: 1 };
      case 'peers':
        return { stdout: '', stderr: 'peers: not yet implemented in browser shell\n', exitCode: 1 };
      default:
        break;
    }

    // Default: user@host [command...] — shorthand for connect/exec
    if (sub.includes('@')) {
      if (positional.length > 1) {
        // wsh user@host command...
        const command = positional.slice(1).join(' ');
        return cmdExec(sub, command, flags);
      }
      // wsh user@host → interactive connect
      return cmdConnect([sub], flags);
    }

    return { stdout: '', stderr: `Unknown subcommand: ${sub}\nRun: wsh help\n`, exitCode: 1 };
  }, {
    description: 'Web Shell — remote access over WebTransport/WebSocket',
    category: 'Network',
    usage: 'wsh [user@host] [command] | wsh <subcommand>',
  });
}
