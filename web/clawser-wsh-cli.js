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
import { supportHintsForRuntime } from './clawser-remote-runtime-types.js';
import { getWshConnections } from './clawser-wsh-tools.js';

// ── Flag Spec ─────────────────────────────────────────────────────

const FLAG_SPEC = {
  p: 'port',
  i: 'identity',
  t: 'transport',
  v: 'verbose',
  j: 'json',
  port: 'value',
  identity: 'value',
  transport: 'value',
  type: 'value',
  backend: 'value',
  'vm-runtime': 'value',
  preset: 'value',
  'require-approval': true,
  'memory-mb': 'value',
  'cpu-shares': 'value',
  'storage-mb': 'value',
  capability: 'value',
  verbose: true,
  json: true,
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
  wsh vm list                      List browser VM runtimes
  wsh vm images                    List available browser VM images
  wsh vm install <image> [name]    Install a browser VM image as a runtime
  wsh vm use <runtime>             Set the default browser VM runtime
  wsh vm remove <runtime>          Remove an installed browser VM runtime
  wsh vm start <runtime>           Start a browser VM runtime
  wsh vm stop <runtime>            Stop a browser VM runtime
  wsh vm reset <runtime>           Reset a browser VM runtime
  wsh vm snapshot export <runtime> Export a VM snapshot as JSON
  wsh vm snapshot import <runtime> <json>  Import a VM snapshot from JSON
  wsh vm budget <runtime>          Show or update VM resource budget
  wsh suspend <session_id>         Suspend a session
  wsh resume <session_id>          Resume a suspended session
  wsh restart <session_id>         Restart PTY in a session
  wsh metrics [host]               Request server metrics
  wsh guest invite|join|revoke     Guest session management
  wsh share <session_id>           Share a session for multi-attach
  wsh unshare <share_id>           Revoke a session share
  wsh compress <algorithm>         Negotiate compression
  wsh rate <session_id> <bps>      Set rate control
  wsh link <session> <host> <port> Link sessions across hosts
  wsh unlink <link_id>             Unlink sessions
  wsh copilot attach|detach        Copilot mode management
  wsh file <op> <path>             Structured file operations
  wsh policy eval|update           Policy engine operations

Options:
  -p, --port <PORT>                Server port [default: 4422]
  -i, --identity <KEY>             Key name [default: default]
  -t, --transport <ws|wt>          Force transport type
  -j, --json                       Emit JSON for machine consumption
      --type <TYPE>                Filter peers by type
      --backend <BACKEND>          Filter peers by shell backend
      --vm-runtime <ID>            VM runtime id when exposing a vm-console peer
      --preset <NAME>              Reverse exposure preset (full, shell-only, tools-only, files-only, vm-console)
      --require-approval           Require approval for each incoming reverse session
      --memory-mb <MB>             VM budget memory in MB (for wsh vm budget)
      --cpu-shares <N>             VM CPU shares (for wsh vm budget)
      --storage-mb <MB>            VM storage budget in MB (for wsh vm budget)
      --capability <CAP>           Filter peers by capability
  -v, --verbose                    Verbose output
`;

const REVERSE_EXPOSURE_PRESETS = Object.freeze({
  full: Object.freeze({
    expose: { shell: true, tools: true, fs: true },
    peerType: 'browser-shell',
    shellBackend: 'virtual-shell',
  }),
  'shell-only': Object.freeze({
    expose: { shell: true, tools: false, fs: false },
    peerType: 'browser-shell',
    shellBackend: 'virtual-shell',
  }),
  'tools-only': Object.freeze({
    expose: { shell: false, tools: true, fs: false },
    peerType: 'worker',
    shellBackend: 'exec-only',
  }),
  'files-only': Object.freeze({
    expose: { shell: false, tools: false, fs: true },
    peerType: 'worker',
    shellBackend: 'exec-only',
  }),
  'vm-console': Object.freeze({
    expose: { shell: true, tools: false, fs: true },
    peerType: 'vm-guest',
    shellBackend: 'vm-console',
    vmRuntimeId: 'demo-linux',
  }),
});
const REVERSE_PRESET_STORAGE_KEY = 'clawser_v1_wsh_reverse_presets';

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

  function reversePresetContext(identity, host, port) {
    return `${identity}@${host}:${port}`;
  }

  function loadSavedReversePreset(identity, host, port) {
    if (typeof localStorage === 'undefined') return null;
    try {
      const raw = localStorage.getItem(REVERSE_PRESET_STORAGE_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      return parsed?.[reversePresetContext(identity, host, port)] || null;
    } catch {
      return null;
    }
  }

  function saveReversePreset(identity, host, port, value) {
    if (typeof localStorage === 'undefined') return;
    const key = reversePresetContext(identity, host, port);
    const next = (() => {
      try {
        return JSON.parse(localStorage.getItem(REVERSE_PRESET_STORAGE_KEY) || '{}');
      } catch {
        return {};
      }
    })();
    next[key] = value;
    localStorage.setItem(REVERSE_PRESET_STORAGE_KEY, JSON.stringify(next));
  }

  function resolveReverseExposure(flags, savedPreset = null) {
    const presetName = flags.preset || null;
    const preset = presetName ? REVERSE_EXPOSURE_PRESETS[presetName] : null;
    if (presetName && !preset) {
      throw new Error(
        `Unknown reverse preset "${presetName}". Supported presets: ${Object.keys(REVERSE_EXPOSURE_PRESETS).join(', ')}`
      );
    }

    const hasExplicitPreset = Boolean(
      flags.preset
      || flags.type
      || flags.backend
      || flags['vm-runtime']
      || flags['require-approval']
      || flags['expose-shell']
      || flags['expose-tools']
      || flags['expose-fs']
    );
    const effectiveSavedPreset = !hasExplicitPreset ? savedPreset : null;
    const hasExposeFlags = flags['expose-shell'] || flags['expose-tools'] || flags['expose-fs'];
    const expose = {
      shell: hasExposeFlags
        ? !!flags['expose-shell']
        : preset?.expose?.shell ?? effectiveSavedPreset?.expose?.shell ?? true,
      tools: hasExposeFlags
        ? !!flags['expose-tools']
        : preset?.expose?.tools ?? effectiveSavedPreset?.expose?.tools ?? true,
      fs: hasExposeFlags
        ? !!flags['expose-fs']
        : preset?.expose?.fs ?? effectiveSavedPreset?.expose?.fs ?? true,
    };
    const peerType = flags.type || preset?.peerType || effectiveSavedPreset?.peerType || 'browser-shell';
    const shellBackend = flags.backend
      || preset?.shellBackend
      || effectiveSavedPreset?.shellBackend
      || (expose.shell ? 'virtual-shell' : 'exec-only');
    const vmRuntimeId = flags['vm-runtime']
      || preset?.vmRuntimeId
      || effectiveSavedPreset?.vmRuntimeId
      || (peerType === 'vm-guest' || shellBackend === 'vm-console' ? 'demo-linux' : null);

    return {
      presetName: presetName || effectiveSavedPreset?.presetName || 'custom',
      expose,
      peerType,
      shellBackend,
      vmRuntimeId,
      requireApproval: flags['require-approval'] != null
        ? !!flags['require-approval']
        : !!effectiveSavedPreset?.requireApproval,
    };
  }

  function getVmRegistry() {
    return globalThis.__clawserVmConsoleRegistry || null;
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

    try {
      if (isRemoteSrc) {
        // Download: user@host:remote_path → local_path
        const [userHost, remotePath] = src.split(':');
        const parsed = parseUserHost(userHost, parseInt(flags.port) || 4422);
        if (!parsed) return { stdout: '', stderr: 'Invalid remote host.\n', exitCode: 1 };

        let client = connections.get(parsed.host);
        if (!client || client.state !== 'authenticated') {
          const ks = await ensureKeyStore();
          const keyPair = await ks.getKeyPair(flags.identity || 'default');
          if (!keyPair) return { stdout: '', stderr: 'Key not found.\n', exitCode: 1 };
          const url = buildUrl(parsed.host, parsed.port, flags.transport || 'auto');
          client = new WshClient();
          await client.connect(url, { username: parsed.user || 'browser', keyPair });
          connections.set(parsed.host, client);
        }

        const data = await client.download(remotePath);
        // Store in OPFS
        const root = await navigator.storage.getDirectory();
        const file = await root.getFileHandle(dst, { create: true });
        const writable = await file.createWritable();
        await writable.write(data);
        await writable.close();

        return { stdout: `Downloaded ${remotePath} → ${dst} (${data.byteLength} bytes)\n`, stderr: '', exitCode: 0 };
      } else {
        // Upload: local_path → user@host:remote_path
        const [userHost, remotePath] = dst.split(':');
        const parsed = parseUserHost(userHost, parseInt(flags.port) || 4422);
        if (!parsed) return { stdout: '', stderr: 'Invalid remote host.\n', exitCode: 1 };

        let client = connections.get(parsed.host);
        if (!client || client.state !== 'authenticated') {
          const ks = await ensureKeyStore();
          const keyPair = await ks.getKeyPair(flags.identity || 'default');
          if (!keyPair) return { stdout: '', stderr: 'Key not found.\n', exitCode: 1 };
          const url = buildUrl(parsed.host, parsed.port, flags.transport || 'auto');
          client = new WshClient();
          await client.connect(url, { username: parsed.user || 'browser', keyPair });
          connections.set(parsed.host, client);
        }

        // Read from OPFS
        const root = await navigator.storage.getDirectory();
        const file = await root.getFileHandle(src);
        const blob = await (await file.getFile()).arrayBuffer();
        const data = new Uint8Array(blob);

        await client.upload(data, remotePath);
        return { stdout: `Uploaded ${src} → ${remotePath} (${data.byteLength} bytes)\n`, stderr: '', exitCode: 0 };
      }
    } catch (err) {
      return { stdout: '', stderr: `scp failed: ${err.message}\n`, exitCode: 1 };
    }
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

  // ── Subcommand: reverse ──────────────────────────────────────

  async function cmdReverse(positional, flags) {
    const relay = positional[0];
    if (!relay) {
      return { stdout: '', stderr: 'Usage: wsh reverse <relay> [--expose-shell]\n', exitCode: 1 };
    }

    const parsed = parseUserHost(relay, parseInt(flags.port) || 4422);
    if (!parsed) {
      return { stdout: '', stderr: 'Invalid relay host.\n', exitCode: 1 };
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

      const savedPreset = loadSavedReversePreset(keyName, parsed.host, parsed.port);
      const {
        presetName,
        expose,
        peerType,
        shellBackend,
        vmRuntimeId,
        requireApproval,
      } = resolveReverseExposure(flags, savedPreset);
      const supportHints = supportHintsForRuntime({ peerType, shellBackend });

      const sessionId = await client.connectReverse(url, {
        username: parsed.user || 'browser',
        keyPair,
        expose,
        peerType,
        shellBackend,
        supportsAttach: supportHints.supportsAttach,
        supportsReplay: supportHints.supportsReplay,
        supportsEcho: supportHints.supportsEcho,
        supportsTermSync: supportHints.supportsTermSync,
      });
      client.__clawserExposeCapabilities = { ...expose };
      client.__clawserPeerMetadata = {
        peerType,
        shellBackend,
        preset: presetName,
        requireApproval,
        replayMode: supportHints.replayMode,
        supportsAttach: supportHints.supportsAttach,
        supportsReplay: supportHints.supportsReplay,
        supportsEcho: supportHints.supportsEcho,
        supportsTermSync: supportHints.supportsTermSync,
        vmRuntimeId,
      };
      client.__clawserApprovalPolicy = {
        requireApproval,
      };
      client.__clawserReverseRegistration = {
        relayHost: parsed.host,
        relayPort: parsed.port,
        sessionId,
        startedAt: Date.now(),
        preset: presetName,
      };
      saveReversePreset(keyName, parsed.host, parsed.port, {
        presetName,
        expose,
        peerType,
        shellBackend,
        vmRuntimeId,
        requireApproval,
      });
      await globalThis.__clawserRemoteAuditRecorder?.record?.('remote_exposure_changed', {
        actor: 'operator',
        action: 'register',
        relayHost: parsed.host,
        relayPort: parsed.port,
        preset: presetName,
        approvalMode: requireApproval ? 'per-session' : 'auto',
        peerType,
        shellBackend,
        expose,
        vmRuntimeId,
      });
      globalThis.dispatchEvent?.(new CustomEvent('clawser:wsh-exposure-changed', {
        detail: { host: parsed.host, action: 'registered' },
      }));

      // Wire incoming handler, chaining with any existing handler
      if (typeof globalThis.__wshIncomingHandler === 'function') {
        const prevHandler = client.onReverseConnect;
        client.onReverseConnect = (msg) => {
          globalThis.__wshIncomingHandler(msg);
          if (prevHandler) prevHandler(msg);
        };
      }

      connections.set(parsed.host, client);

      const rawPub = await exportPublicKeyRaw(keyPair.publicKey);
      const fp = fingerprint(rawPub);
      const shortFp = shortFingerprint(fp, [], 8);

      const exposing = Object.entries(expose).filter(([,v]) => v).map(([k]) => k).join(', ');
      return {
        stdout: `Registered as reverse peer ${shortFp} on ${parsed.host}:${parsed.port}\n` +
                `Session: ${sessionId}\nPreset: ${presetName}\nExposing: ${exposing || 'none'}\nApproval: ${requireApproval ? 'per-session' : 'auto'}\n` +
                `Waiting for incoming connections...\n`,
        stderr: '', exitCode: 0,
      };
    } catch (err) {
      return { stdout: '', stderr: `Reverse registration failed: ${err.message}\n`, exitCode: 1 };
    }
  }

  async function cmdVm(positional, flags) {
    const registry = getVmRegistry();
    if (!registry) {
      return { stdout: '', stderr: 'VM runtime registry is not ready.\n', exitCode: 1 };
    }

    const action = positional[0] || 'list';
    const runtimeId = positional[1] || 'default';

    try {
      switch (action) {
        case 'list': {
          const runtimes = registry.list();
          if (flags.json) {
            return { stdout: `${JSON.stringify(runtimes, null, 2)}\n`, stderr: '', exitCode: 0 };
          }
          const lines = ['RUNTIME        STATE       IMAGE         MEMORY  CPU  STORAGE  DEFAULT'];
          for (const runtime of runtimes) {
            const budget = runtime.resourceBudget || {};
            lines.push(
              `${String(runtime.id || '').padEnd(14)}${String(runtime.running ? 'running' : 'stopped').padEnd(12)}${String(runtime.imageId || '--').padEnd(14)}${String((budget.memoryMb ?? '--') + 'MB').padEnd(8)}${String(budget.cpuShares ?? '--').padEnd(5)}${String((budget.storageMb ?? '--') + 'MB').padEnd(9)}${runtime.defaultRuntime ? 'yes' : '--'}`
            );
          }
          return { stdout: `${lines.join('\n')}\n`, stderr: '', exitCode: 0 };
        }
        case 'images': {
          const images = registry.listImages();
          if (flags.json) {
            return { stdout: `${JSON.stringify(images, null, 2)}\n`, stderr: '', exitCode: 0 };
          }
          const lines = ['IMAGE          DISTRO        INSTALLED  DESCRIPTION'];
          for (const image of images) {
            lines.push(
              `${String(image.id || '').padEnd(14)}${String(image.distro || '--').padEnd(14)}${String(image.installedRuntimeIds?.length || 0).toString().padEnd(11)}${image.description || '--'}`
            );
          }
          return { stdout: `${lines.join('\n')}\n`, stderr: '', exitCode: 0 };
        }
        case 'install': {
          const imageId = positional[1];
          const targetRuntimeId = positional[2] || null;
          if (!imageId) {
            return { stdout: '', stderr: 'Usage: wsh vm install <image> [runtime]\n', exitCode: 1 };
          }
          const runtime = registry.install(imageId, { runtimeId: targetRuntimeId || undefined });
          await registry.get(runtime.id)?.restorePersistedState?.();
          return { stdout: `Installed VM image ${imageId} as runtime ${runtime.id}\n`, stderr: '', exitCode: 0 };
        }
        case 'use': {
          const targetRuntimeId = positional[1];
          if (!targetRuntimeId) {
            return { stdout: '', stderr: 'Usage: wsh vm use <runtime>\n', exitCode: 1 };
          }
          registry.setDefault(targetRuntimeId);
          return { stdout: `Default VM runtime is now ${targetRuntimeId}\n`, stderr: '', exitCode: 0 };
        }
        case 'remove': {
          const targetRuntimeId = positional[1];
          if (!targetRuntimeId) {
            return { stdout: '', stderr: 'Usage: wsh vm remove <runtime>\n', exitCode: 1 };
          }
          registry.uninstall(targetRuntimeId);
          return { stdout: `Removed VM runtime ${targetRuntimeId}\n`, stderr: '', exitCode: 0 };
        }
        case 'start': {
          const runtime = await registry.start(runtimeId);
          return { stdout: `Started VM runtime ${runtime.id || runtimeId}\n`, stderr: '', exitCode: 0 };
        }
        case 'stop': {
          const runtime = await registry.stop(runtimeId);
          return { stdout: `Stopped VM runtime ${runtime.id || runtimeId}\n`, stderr: '', exitCode: 0 };
        }
        case 'reset': {
          const runtime = await registry.reset(runtimeId);
          return { stdout: `Reset VM runtime ${runtime.id || runtimeId}\n`, stderr: '', exitCode: 0 };
        }
        case 'snapshot': {
          const subAction = positional[1];
          const targetRuntime = positional[2] || 'default';
          if (subAction === 'export') {
            const snapshot = await registry.exportSnapshot(targetRuntime);
            return { stdout: `${JSON.stringify(snapshot, null, 2)}\n`, stderr: '', exitCode: 0 };
          }
          if (subAction === 'import') {
            const raw = positional.slice(3).join(' ');
            if (!raw) {
              return { stdout: '', stderr: 'Usage: wsh vm snapshot import <runtime> <json>\n', exitCode: 1 };
            }
            const snapshot = JSON.parse(raw);
            await registry.importSnapshot(targetRuntime, snapshot);
            return { stdout: `Imported snapshot into ${targetRuntime}\n`, stderr: '', exitCode: 0 };
          }
          return { stdout: '', stderr: 'Usage: wsh vm snapshot export|import <runtime> [json]\n', exitCode: 1 };
        }
        case 'budget': {
          const updates = {};
          if (flags['memory-mb']) updates.memoryMb = parseInt(flags['memory-mb'], 10);
          if (flags['cpu-shares']) updates.cpuShares = parseInt(flags['cpu-shares'], 10);
          if (flags['storage-mb']) updates.storageMb = parseInt(flags['storage-mb'], 10);
          const budget = Object.keys(updates).length
            ? await registry.updateBudget(runtimeId, updates)
            : registry.describe(runtimeId)?.resourceBudget || null;
          if (!budget) {
            return { stdout: '', stderr: `Unknown VM runtime: ${runtimeId}\n`, exitCode: 1 };
          }
          return {
            stdout: `${JSON.stringify(budget, null, 2)}\n`,
            stderr: '',
            exitCode: 0,
          };
        }
        default:
          return { stdout: '', stderr: 'Usage: wsh vm list|images|install|use|remove|start|stop|reset|snapshot|budget\n', exitCode: 1 };
      }
    } catch (err) {
      return { stdout: '', stderr: `VM command failed: ${err.message}\n`, exitCode: 1 };
    }
  }

  // ── Subcommand: peers ───────────────────────────────────────────

  async function cmdPeers(positional, flags) {
    const relay = positional[0];
    if (!relay) {
      return { stdout: '', stderr: 'Usage: wsh peers <relay>\n', exitCode: 1 };
    }

    const parsed = parseUserHost(relay, parseInt(flags.port) || 4422);
    if (!parsed) {
      return { stdout: '', stderr: 'Invalid relay host.\n', exitCode: 1 };
    }

    const keyName = flags.identity || 'default';
    const transport = flags.transport || 'auto';

    try {
      // Reuse existing connection or create a new one
      let client = connections.get(parsed.host);
      if (!client || client.state !== 'authenticated') {
        const ks = await ensureKeyStore();
        const keyPair = await ks.getKeyPair(keyName);
        if (!keyPair) {
          return { stdout: '', stderr: `Key "${keyName}" not found.\n`, exitCode: 1 };
        }

        const url = buildUrl(parsed.host, parsed.port, transport);
        client = new WshClient();
        await client.connect(url, {
          username: parsed.user || 'browser',
          keyPair,
        });
        connections.set(parsed.host, client);
      }

      // Send ReverseList and wait for ReversePeers
      let peers = await client.listPeers();
      if (flags.type) {
        peers = peers.filter((peer) => peer.peer_type === flags.type);
      }
      if (flags.backend) {
        peers = peers.filter((peer) => peer.shell_backend === flags.backend);
      }
      if (flags.capability) {
        peers = peers.filter((peer) => (peer.capabilities || []).includes(flags.capability));
      }

      if (flags.json) {
        return {
          stdout: `${JSON.stringify(peers, null, 2)}\n`,
          stderr: '',
          exitCode: 0,
        };
      }

      const lines = ['FINGERPRINT    USERNAME         TYPE           BACKEND         CAPABILITIES         LAST SEEN'];
      if (peers.length === 0) {
        lines.push('(no peers online)');
      } else {
        for (const p of peers) {
          const caps = (p.capabilities || []).join(', ');
          const lastSeen = p.last_seen != null ? `${p.last_seen}s ago` : '—';
          lines.push(
            `${(p.fingerprint_short || '').padEnd(15)}` +
            `${(p.username || '').padEnd(17)}` +
            `${(p.peer_type || 'host').padEnd(15)}` +
            `${(p.shell_backend || 'pty').padEnd(16)}` +
            `${caps.padEnd(21)}` +
            `${lastSeen}`
          );
        }
      }
      lines.push(`\n${peers.length} peer(s).`);

      return { stdout: lines.join('\n') + '\n', stderr: '', exitCode: 0 };
    } catch (err) {
      return { stdout: '', stderr: `Failed to list peers: ${err.message}\n`, exitCode: 1 };
    }
  }

  // ── Subcommand: copy-id ─────────────────────────────────────────

  async function cmdCopyId(positional, flags) {
    const target = positional[0];
    if (!target) {
      return { stdout: '', stderr: 'Usage: wsh copy-id user@host\n', exitCode: 1 };
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

      // Export the public key in SSH format
      const pubKeySSH = await exportPublicKeySSH(keyPair.publicKey, `${parsed.user}@clawser`);

      // Build the command that appends the key to authorized_keys
      const escapedKey = pubKeySSH.replace(/'/g, "'\\''");
      const remoteCmd = `mkdir -p ~/.wsh && echo '${escapedKey}' >> ~/.wsh/authorized_keys`;

      const url = buildUrl(parsed.host, parsed.port, transport);
      const result = await WshClient.exec(url, remoteCmd, {
        username: parsed.user,
        keyPair,
      });

      if (result.exitCode !== 0) {
        const decoder = new TextDecoder();
        const stderr = result.stdout instanceof Uint8Array
          ? decoder.decode(result.stdout) : String(result.stdout || '');
        return { stdout: '', stderr: `copy-id failed: ${stderr}\n`, exitCode: 1 };
      }

      return {
        stdout: `Public key "${keyName}" installed on ${parsed.host} for ${parsed.user}\n`,
        stderr: '', exitCode: 0,
      };
    } catch (err) {
      return { stdout: '', stderr: `copy-id failed: ${err.message}\n`, exitCode: 1 };
    }
  }

  // ── Subcommand: attach ──────────────────────────────────────────

  async function cmdAttach(positional, flags) {
    const sessionId = positional[0];
    if (!sessionId) {
      return { stdout: '', stderr: 'Usage: wsh attach <session_id>\n', exitCode: 1 };
    }

    const host = positional[1] || [...connections.keys()].pop();
    if (!host) {
      return { stdout: '', stderr: 'No active connection.\n', exitCode: 1 };
    }

    const client = connections.get(host);
    if (!client || client.state !== 'authenticated') {
      return { stdout: '', stderr: `Not connected to ${host}\n`, exitCode: 1 };
    }

    try {
      await client.attachSession(sessionId, { readOnly: false });
      return { stdout: `Attached to session ${sessionId}\n`, stderr: '', exitCode: 0 };
    } catch (err) {
      return { stdout: '', stderr: `Attach failed: ${err.message}\n`, exitCode: 1 };
    }
  }

  // ── Subcommand: connect peer (fingerprint) ─────────────────────

  async function cmdConnectPeer(fingerprint, relay, flags) {
    if (!relay) {
      return { stdout: '', stderr: 'Usage: wsh connect <fingerprint> <relay>\n', exitCode: 1 };
    }

    const parsed = parseUserHost(relay, parseInt(flags.port) || 4422);
    if (!parsed) {
      return { stdout: '', stderr: 'Invalid relay host.\n', exitCode: 1 };
    }

    const keyName = flags.identity || 'default';
    const transport = flags.transport || 'auto';

    try {
      let client = connections.get(parsed.host);
      if (!client || client.state !== 'authenticated') {
        const ks = await ensureKeyStore();
        const keyPair = await ks.getKeyPair(keyName);
        if (!keyPair) {
          return { stdout: '', stderr: `Key "${keyName}" not found.\n`, exitCode: 1 };
        }
        const url = buildUrl(parsed.host, parsed.port, transport);
        client = new WshClient();
        await client.connect(url, { username: parsed.user || 'browser', keyPair });
        connections.set(parsed.host, client);
      }

      await client.reverseConnectTo(fingerprint);
      return {
        stdout: `Reverse-connecting to peer ${fingerprint}...\n`,
        stderr: '', exitCode: 0,
      };
    } catch (err) {
      return { stdout: '', stderr: `Connect failed: ${err.message}\n`, exitCode: 1 };
    }
  }

  // ── Subcommand: suspend / resume / restart ──────────────────────

  async function cmdSuspend(positional) {
    const sessionId = positional[0];
    if (!sessionId) return { stdout: '', stderr: 'Usage: wsh suspend <session_id>\n', exitCode: 1 };
    const host = [...connections.keys()].pop();
    if (!host) return { stdout: '', stderr: 'No active connection.\n', exitCode: 1 };
    const client = connections.get(host);
    if (!client || client.state !== 'authenticated') return { stdout: '', stderr: 'Not connected.\n', exitCode: 1 };
    try {
      await client.suspendSession(sessionId, 'suspend');
      return { stdout: `Session ${sessionId} suspend requested\n`, stderr: '', exitCode: 0 };
    } catch (err) { return { stdout: '', stderr: `Suspend failed: ${err.message}\n`, exitCode: 1 }; }
  }

  async function cmdResume(positional) {
    const sessionId = positional[0];
    if (!sessionId) return { stdout: '', stderr: 'Usage: wsh resume <session_id>\n', exitCode: 1 };
    const host = [...connections.keys()].pop();
    if (!host) return { stdout: '', stderr: 'No active connection.\n', exitCode: 1 };
    const client = connections.get(host);
    if (!client || client.state !== 'authenticated') return { stdout: '', stderr: 'Not connected.\n', exitCode: 1 };
    try {
      await client.suspendSession(sessionId, 'resume');
      return { stdout: `Session ${sessionId} resume requested\n`, stderr: '', exitCode: 0 };
    } catch (err) { return { stdout: '', stderr: `Resume failed: ${err.message}\n`, exitCode: 1 }; }
  }

  async function cmdRestart(positional) {
    const sessionId = positional[0];
    if (!sessionId) return { stdout: '', stderr: 'Usage: wsh restart <session_id>\n', exitCode: 1 };
    const host = [...connections.keys()].pop();
    if (!host) return { stdout: '', stderr: 'No active connection.\n', exitCode: 1 };
    const client = connections.get(host);
    if (!client || client.state !== 'authenticated') return { stdout: '', stderr: 'Not connected.\n', exitCode: 1 };
    try {
      await client.restartPty(sessionId, positional[1]);
      return { stdout: `PTY restart requested for ${sessionId}\n`, stderr: '', exitCode: 0 };
    } catch (err) { return { stdout: '', stderr: `Restart failed: ${err.message}\n`, exitCode: 1 }; }
  }

  // ── Subcommand: metrics ─────────────────────────────────────────

  async function cmdMetrics(positional) {
    const host = positional[0] || [...connections.keys()].pop();
    if (!host) return { stdout: '', stderr: 'No active connection.\n', exitCode: 1 };
    const client = connections.get(host);
    if (!client || client.state !== 'authenticated') return { stdout: '', stderr: `Not connected to ${host}\n`, exitCode: 1 };
    try {
      const m = await client.requestMetrics();
      const lines = ['SERVER METRICS'];
      if (m.cpu !== undefined) lines.push(`CPU:      ${m.cpu}%`);
      if (m.memory !== undefined) lines.push(`Memory:   ${m.memory}%`);
      if (m.sessions !== undefined) lines.push(`Sessions: ${m.sessions}`);
      if (m.rtt !== undefined) lines.push(`RTT:      ${m.rtt}ms`);
      return { stdout: lines.join('\n') + '\n', stderr: '', exitCode: 0 };
    } catch (err) { return { stdout: '', stderr: `Metrics failed: ${err.message}\n`, exitCode: 1 }; }
  }

  // ── Subcommand: guest ───────────────────────────────────────────

  async function cmdGuest(positional, flags) {
    const action = positional[0];
    const host = [...connections.keys()].pop();
    if (!host) return { stdout: '', stderr: 'No active connection.\n', exitCode: 1 };
    const client = connections.get(host);
    if (!client || client.state !== 'authenticated') return { stdout: '', stderr: 'Not connected.\n', exitCode: 1 };

    switch (action) {
      case 'invite': {
        const sessionId = positional[1];
        const ttl = parseInt(positional[2]) || 3600;
        if (!sessionId) return { stdout: '', stderr: 'Usage: wsh guest invite <session_id> [ttl]\n', exitCode: 1 };
        try {
          const result = await client.inviteGuest(sessionId, ttl);
          return { stdout: `Guest invite created (TTL: ${ttl}s)\nToken: ${result.token || JSON.stringify(result)}\n`, stderr: '', exitCode: 0 };
        } catch (err) { return { stdout: '', stderr: `Invite failed: ${err.message}\n`, exitCode: 1 }; }
      }
      case 'join': {
        const token = positional[1];
        if (!token) return { stdout: '', stderr: 'Usage: wsh guest join <token>\n', exitCode: 1 };
        try {
          const result = await client.joinAsGuest(token);
          return { stdout: `Joined as guest\n`, stderr: '', exitCode: 0 };
        } catch (err) { return { stdout: '', stderr: `Join failed: ${err.message}\n`, exitCode: 1 }; }
      }
      case 'revoke': {
        const token = positional[1];
        if (!token) return { stdout: '', stderr: 'Usage: wsh guest revoke <token>\n', exitCode: 1 };
        try {
          await client.revokeGuest(token, positional[2]);
          return { stdout: `Guest token revoked\n`, stderr: '', exitCode: 0 };
        } catch (err) { return { stdout: '', stderr: `Revoke failed: ${err.message}\n`, exitCode: 1 }; }
      }
      default:
        return { stdout: '', stderr: 'Usage: wsh guest invite|join|revoke\n', exitCode: 1 };
    }
  }

  // ── Subcommand: share / unshare ─────────────────────────────────

  async function cmdShare(positional) {
    const sessionId = positional[0];
    if (!sessionId) return { stdout: '', stderr: 'Usage: wsh share <session_id> [mode] [ttl]\n', exitCode: 1 };
    const host = [...connections.keys()].pop();
    if (!host) return { stdout: '', stderr: 'No active connection.\n', exitCode: 1 };
    const client = connections.get(host);
    if (!client || client.state !== 'authenticated') return { stdout: '', stderr: 'Not connected.\n', exitCode: 1 };
    try {
      const mode = positional[1] || 'read';
      const ttl = positional[2] ? parseInt(positional[2]) : undefined;
      const result = await client.shareSession(sessionId, mode, ttl);
      return { stdout: `Session shared (share_id: ${result.share_id || JSON.stringify(result)})\n`, stderr: '', exitCode: 0 };
    } catch (err) { return { stdout: '', stderr: `Share failed: ${err.message}\n`, exitCode: 1 }; }
  }

  async function cmdUnshare(positional) {
    const shareId = positional[0];
    if (!shareId) return { stdout: '', stderr: 'Usage: wsh unshare <share_id>\n', exitCode: 1 };
    const host = [...connections.keys()].pop();
    if (!host) return { stdout: '', stderr: 'No active connection.\n', exitCode: 1 };
    const client = connections.get(host);
    if (!client || client.state !== 'authenticated') return { stdout: '', stderr: 'Not connected.\n', exitCode: 1 };
    try {
      await client.revokeShare(shareId, positional[1]);
      return { stdout: `Share ${shareId} revoked\n`, stderr: '', exitCode: 0 };
    } catch (err) { return { stdout: '', stderr: `Unshare failed: ${err.message}\n`, exitCode: 1 }; }
  }

  // ── Subcommand: compress ────────────────────────────────────────

  async function cmdCompress(positional) {
    const algorithm = positional[0];
    if (!algorithm) return { stdout: '', stderr: 'Usage: wsh compress <algorithm> [level]\n', exitCode: 1 };
    const host = [...connections.keys()].pop();
    if (!host) return { stdout: '', stderr: 'No active connection.\n', exitCode: 1 };
    const client = connections.get(host);
    if (!client || client.state !== 'authenticated') return { stdout: '', stderr: 'Not connected.\n', exitCode: 1 };
    try {
      const level = positional[1] ? parseInt(positional[1]) : 3;
      const result = await client.negotiateCompression(algorithm, level);
      const accepted = result.accepted ? 'accepted' : 'declined';
      return { stdout: `Compression ${algorithm} (level ${level}): ${accepted}\n`, stderr: '', exitCode: 0 };
    } catch (err) { return { stdout: '', stderr: `Compression failed: ${err.message}\n`, exitCode: 1 }; }
  }

  // ── Subcommand: rate ────────────────────────────────────────────

  async function cmdRate(positional) {
    const sessionId = positional[0];
    const bps = parseInt(positional[1]);
    if (!sessionId || isNaN(bps)) return { stdout: '', stderr: 'Usage: wsh rate <session_id> <bytes_per_sec> [policy]\n', exitCode: 1 };
    const host = [...connections.keys()].pop();
    if (!host) return { stdout: '', stderr: 'No active connection.\n', exitCode: 1 };
    const client = connections.get(host);
    if (!client || client.state !== 'authenticated') return { stdout: '', stderr: 'Not connected.\n', exitCode: 1 };
    try {
      await client.setRateControl(sessionId, bps, positional[2] || 'pause');
      return { stdout: `Rate control set: ${bps} B/s\n`, stderr: '', exitCode: 0 };
    } catch (err) { return { stdout: '', stderr: `Rate control failed: ${err.message}\n`, exitCode: 1 }; }
  }

  // ── Subcommand: link / unlink ───────────────────────────────────

  async function cmdLink(positional) {
    const [sessionId, targetHost, targetPortStr, targetUser] = positional;
    if (!sessionId || !targetHost || !targetPortStr) return { stdout: '', stderr: 'Usage: wsh link <session_id> <target_host> <target_port> [target_user]\n', exitCode: 1 };
    const host = [...connections.keys()].pop();
    if (!host) return { stdout: '', stderr: 'No active connection.\n', exitCode: 1 };
    const client = connections.get(host);
    if (!client || client.state !== 'authenticated') return { stdout: '', stderr: 'Not connected.\n', exitCode: 1 };
    try {
      await client.linkSession(sessionId, targetHost, parseInt(targetPortStr), targetUser);
      return { stdout: `Session link: ${sessionId} → ${targetHost}:${targetPortStr}\n`, stderr: '', exitCode: 0 };
    } catch (err) { return { stdout: '', stderr: `Link failed: ${err.message}\n`, exitCode: 1 }; }
  }

  async function cmdUnlink(positional) {
    const linkId = positional[0];
    if (!linkId) return { stdout: '', stderr: 'Usage: wsh unlink <link_id>\n', exitCode: 1 };
    const host = [...connections.keys()].pop();
    if (!host) return { stdout: '', stderr: 'No active connection.\n', exitCode: 1 };
    const client = connections.get(host);
    if (!client || client.state !== 'authenticated') return { stdout: '', stderr: 'Not connected.\n', exitCode: 1 };
    try {
      await client.unlinkSession(linkId, positional[1]);
      return { stdout: `Unlinked: ${linkId}\n`, stderr: '', exitCode: 0 };
    } catch (err) { return { stdout: '', stderr: `Unlink failed: ${err.message}\n`, exitCode: 1 }; }
  }

  // ── Subcommand: copilot ─────────────────────────────────────────

  async function cmdCopilot(positional) {
    const action = positional[0];
    const host = [...connections.keys()].pop();
    if (!host) return { stdout: '', stderr: 'No active connection.\n', exitCode: 1 };
    const client = connections.get(host);
    if (!client || client.state !== 'authenticated') return { stdout: '', stderr: 'Not connected.\n', exitCode: 1 };

    switch (action) {
      case 'attach': {
        const sessionId = positional[1];
        const model = positional[2];
        if (!sessionId || !model) return { stdout: '', stderr: 'Usage: wsh copilot attach <session_id> <model>\n', exitCode: 1 };
        try {
          await client.copilotAttach(sessionId, model, positional[3] ? parseInt(positional[3]) : undefined);
          return { stdout: `Copilot ${model} attached to ${sessionId}\n`, stderr: '', exitCode: 0 };
        } catch (err) { return { stdout: '', stderr: `Attach failed: ${err.message}\n`, exitCode: 1 }; }
      }
      case 'detach': {
        const sessionId = positional[1];
        if (!sessionId) return { stdout: '', stderr: 'Usage: wsh copilot detach <session_id>\n', exitCode: 1 };
        try {
          await client.copilotDetach(sessionId, positional[2]);
          return { stdout: `Copilot detached from ${sessionId}\n`, stderr: '', exitCode: 0 };
        } catch (err) { return { stdout: '', stderr: `Detach failed: ${err.message}\n`, exitCode: 1 }; }
      }
      default:
        return { stdout: '', stderr: 'Usage: wsh copilot attach|detach\n', exitCode: 1 };
    }
  }

  // ── Subcommand: file ────────────────────────────────────────────

  async function cmdFile(positional) {
    const op = positional[0];
    const path = positional[1];
    if (!op || !path) return { stdout: '', stderr: 'Usage: wsh file <op> <path> [offset] [length]\n  Ops: stat, list, read, write, mkdir, remove, rename\n', exitCode: 1 };
    const host = [...connections.keys()].pop();
    if (!host) return { stdout: '', stderr: 'No active connection.\n', exitCode: 1 };
    const client = connections.get(host);
    if (!client || client.state !== 'authenticated') return { stdout: '', stderr: 'Not connected.\n', exitCode: 1 };
    try {
      const opts = {};
      if (positional[2]) opts.offset = parseInt(positional[2]);
      if (positional[3]) opts.length = parseInt(positional[3]);
      const result = await client.fileOperation(op, path, opts);
      return { stdout: JSON.stringify(result, null, 2) + '\n', stderr: '', exitCode: 0 };
    } catch (err) { return { stdout: '', stderr: `File op failed: ${err.message}\n`, exitCode: 1 }; }
  }

  // ── Subcommand: policy ──────────────────────────────────────────

  async function cmdPolicy(positional) {
    const action = positional[0];
    const host = [...connections.keys()].pop();
    if (!host) return { stdout: '', stderr: 'No active connection.\n', exitCode: 1 };
    const client = connections.get(host);
    if (!client || client.state !== 'authenticated') return { stdout: '', stderr: 'Not connected.\n', exitCode: 1 };

    switch (action) {
      case 'eval': {
        const pAction = positional[1];
        const principal = positional[2];
        if (!pAction || !principal) return { stdout: '', stderr: 'Usage: wsh policy eval <action> <principal>\n', exitCode: 1 };
        try {
          const result = await client.evaluatePolicy(pAction, principal);
          return { stdout: JSON.stringify(result, null, 2) + '\n', stderr: '', exitCode: 0 };
        } catch (err) { return { stdout: '', stderr: `Policy eval failed: ${err.message}\n`, exitCode: 1 }; }
      }
      case 'update': {
        const policyId = positional[1];
        const rulesStr = positional[2];
        const version = parseInt(positional[3]);
        if (!policyId || !rulesStr || isNaN(version)) return { stdout: '', stderr: 'Usage: wsh policy update <policy_id> <rules_json> <version>\n', exitCode: 1 };
        try {
          const rules = JSON.parse(rulesStr);
          await client.updatePolicy(policyId, rules, version);
          return { stdout: `Policy ${policyId} updated to v${version}\n`, stderr: '', exitCode: 0 };
        } catch (err) { return { stdout: '', stderr: `Policy update failed: ${err.message}\n`, exitCode: 1 }; }
      }
      default:
        return { stdout: '', stderr: 'Usage: wsh policy eval|update\n', exitCode: 1 };
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
      case 'connect': {
        // If the argument looks like a hex fingerprint (no @), do reverse connect
        const target = positional[1];
        if (target && /^[0-9a-f]{8,}$/i.test(target) && !target.includes('@')) {
          return cmdConnectPeer(target, positional[2], flags);
        }
        return cmdConnect(positional.slice(1), flags);
      }
      case 'list':
      case 'sessions':
        return cmdList();
      case 'attach':
        return cmdAttach(positional.slice(1), flags);
      case 'detach':
        return { stdout: '', stderr: 'detach: use Ctrl+D or close session\n', exitCode: 1 };
      case 'copy-id':
        return cmdCopyId(positional.slice(1), flags);
      case 'scp':
        return cmdScp(positional.slice(1), flags);
      case 'tools':
        return cmdTools(positional.slice(1));
      case 'reverse':
        return cmdReverse(positional.slice(1), flags);
      case 'peers':
        return cmdPeers(positional.slice(1), flags);
      case 'vm':
        return cmdVm(positional.slice(1), flags);
      case 'suspend':
        return cmdSuspend(positional.slice(1));
      case 'resume':
        return cmdResume(positional.slice(1));
      case 'restart':
        return cmdRestart(positional.slice(1));
      case 'metrics':
        return cmdMetrics(positional.slice(1));
      case 'guest':
        return cmdGuest(positional.slice(1), flags);
      case 'share':
        return cmdShare(positional.slice(1));
      case 'unshare':
        return cmdUnshare(positional.slice(1));
      case 'compress':
        return cmdCompress(positional.slice(1));
      case 'rate':
        return cmdRate(positional.slice(1));
      case 'link':
        return cmdLink(positional.slice(1));
      case 'unlink':
        return cmdUnlink(positional.slice(1));
      case 'copilot':
        return cmdCopilot(positional.slice(1));
      case 'file':
        return cmdFile(positional.slice(1));
      case 'policy':
        return cmdPolicy(positional.slice(1));
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
