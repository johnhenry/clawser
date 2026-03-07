import { afterEach, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { getWshConnections } from '../clawser-wsh-tools.js';
import {
  getIncomingSession,
  handleReverseConnect,
  listIncomingSessions,
  setKernelBridge,
  setToolRegistry,
  setVirtualTerminalManager,
} from '../clawser-wsh-incoming.js';
import {
  VirtualTerminalManager,
  buildReverseParticipantKey,
} from '../clawser-wsh-virtual-terminal-manager.js';
import { MSG } from '../packages-wsh.js';

const decoder = new TextDecoder();

function createFakeShell() {
  const state = {
    cwd: '/',
    env: new Map(),
    aliases: new Map(),
    history: [],
    lastExitCode: 0,
    pipefail: true,
  };

  return {
    state,
    async exec(command) {
      state.history.push(command);
      if (command === 'pwd') {
        return { stdout: '/\n', stderr: '', exitCode: 0 };
      }
      return { stdout: `ran:${command}\n`, stderr: '', exitCode: 0 };
    },
  };
}

function createFakeClient(capabilities = { shell: true, tools: true, fs: true }) {
  return {
    state: 'authenticated',
    fingerprint: 'SHA256:target',
    __clawserExposeCapabilities: { ...capabilities },
    sent: [],
    onRelayMessage: null,
    async sendRelayControl(msg) {
      this.sent.push(msg);
    },
  };
}

function decodeSessionTraffic(messages) {
  return messages
    .filter((msg) => msg.type === MSG.SESSION_DATA)
    .map((msg) => decoder.decode(msg.data))
    .join('');
}

beforeEach(() => {
  getWshConnections().clear();
  setKernelBridge(null);
  setToolRegistry({
    allSpecs: () => [{ name: 'browser_echo', description: 'echo', parameters: { type: 'object', properties: {} } }],
    get: () => ({ permission: 'auto' }),
    execute: async (name, args) => ({ success: true, output: JSON.stringify({ name, args }) }),
  });
  setVirtualTerminalManager(new VirtualTerminalManager({
    shellFactory: async () => createFakeShell(),
  }));
});

afterEach(async () => {
  for (const session of listIncomingSessions()) {
    await getIncomingSession(session.participantKey)?.close({ notifyRemote: false });
  }
  getWshConnections().clear();
  setVirtualTerminalManager(null);
  setToolRegistry(null);
  setKernelBridge(null);
});

describe('clawser-wsh-incoming', () => {
  it('accepts reverse peers and routes PTY traffic through the virtual terminal manager', async () => {
    const client = createFakeClient();
    getWshConnections().set('relay.example', client);

    await handleReverseConnect({
      username: 'alice',
      target_fingerprint: 'SHA256:target',
    });

    const participantKey = buildReverseParticipantKey({
      username: 'alice',
      targetFingerprint: 'SHA256:target',
    });

    assert.equal(listIncomingSessions().length, 1);
    assert.ok(getIncomingSession(participantKey));
    assert.equal(client.sent[0].type, MSG.REVERSE_ACCEPT);
    assert.deepEqual(client.sent[0].capabilities, ['shell', 'tools', 'fs']);

    await client.onRelayMessage({
      type: MSG.OPEN,
      kind: 'pty',
      cols: 120,
      rows: 40,
    });

    const openReply = client.sent.find((msg) => msg.type === MSG.OPEN_OK);
    assert.ok(openReply);
    assert.equal(openReply.data_mode, 'virtual');
    assert.deepEqual(openReply.capabilities, ['resize', 'signal']);

    await client.onRelayMessage({
      type: MSG.SESSION_DATA,
      channel_id: openReply.channel_id,
      data: new TextEncoder().encode('pwd\r'),
    });

    const traffic = decodeSessionTraffic(client.sent);
    assert.ok(traffic.includes('/$ '));
    assert.ok(traffic.includes('/\n'));
  });

  it('rejects PTY opens when shell access was not exposed', async () => {
    const client = createFakeClient({ shell: false, tools: true, fs: false });
    getWshConnections().set('relay.example', client);

    await handleReverseConnect({
      username: 'bob',
      target_fingerprint: 'SHA256:target',
    });

    await client.onRelayMessage({
      type: MSG.OPEN,
      kind: 'pty',
      cols: 80,
      rows: 24,
    });

    const failure = client.sent.find((msg) => msg.type === MSG.OPEN_FAIL);
    assert.ok(failure);
    assert.match(failure.reason, /did not expose shell access/i);
  });

  it('reattaches an existing reverse PTY instead of discarding browser state', async () => {
    const clientA = createFakeClient();
    getWshConnections().set('relay.example', clientA);

    await handleReverseConnect({
      username: 'alice',
      target_fingerprint: 'SHA256:target',
    });

    await clientA.onRelayMessage({
      type: MSG.OPEN,
      kind: 'pty',
      cols: 120,
      rows: 40,
    });

    const firstOpen = clientA.sent.find((msg) => msg.type === MSG.OPEN_OK);
    await clientA.onRelayMessage({
      type: MSG.SESSION_DATA,
      channel_id: firstOpen.channel_id,
      data: new TextEncoder().encode('pwd\r'),
    });

    const clientB = createFakeClient();
    getWshConnections().set('relay.example', clientB);

    await handleReverseConnect({
      username: 'alice',
      target_fingerprint: 'SHA256:target',
    });

    const participantKey = buildReverseParticipantKey({
      username: 'alice',
      targetFingerprint: 'SHA256:target',
    });
    const rebound = getIncomingSession(participantKey);
    assert.ok(rebound);
    assert.equal(rebound.client, clientB);
    assert.equal(listIncomingSessions().length, 1);

    await clientB.onRelayMessage({
      type: MSG.OPEN,
      kind: 'pty',
      cols: 90,
      rows: 30,
    });

    const resumedOpen = clientB.sent.find((msg) => msg.type === MSG.OPEN_OK);
    assert.ok(resumedOpen);
    assert.equal(resumedOpen.channel_id, firstOpen.channel_id);

    const replay = decodeSessionTraffic(clientB.sent);
    assert.ok(replay.includes('/$ '));
    assert.ok(replay.includes('/\n'));
  });
});
