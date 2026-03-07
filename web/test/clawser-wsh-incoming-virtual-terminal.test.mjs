import { afterEach, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { getWshConnections } from '../clawser-wsh-tools.js';
import {
  getIncomingSession,
  handleReverseConnect,
  listIncomingSessions,
  setKernelBridge,
  setMcpClient,
  setToolRegistry,
  setVirtualTerminalManager,
} from '../clawser-wsh-incoming.js';
import {
  VirtualTerminalManager,
  buildReverseParticipantKey,
} from '../clawser-wsh-virtual-terminal-manager.js';
import {
  MSG,
} from '../packages-wsh.js';

function createShell() {
  return {
    state: {
      cwd: '/',
      env: new Map(),
      aliases: new Map(),
      history: [],
      lastExitCode: 0,
      pipefail: true,
    },
    async exec(command) {
      this.state.history.push(command);
      return { stdout: `ran:${command}\n`, stderr: '', exitCode: 0 };
    },
  };
}

function createClient(fingerprint, capabilities = { shell: true, tools: true, fs: true }) {
  return {
    state: 'authenticated',
    fingerprint,
    __clawserExposeCapabilities: { ...capabilities },
    sent: [],
    onRelayMessage: null,
    async sendRelayControl(msg) {
      this.sent.push(msg);
    },
  };
}

beforeEach(() => {
  getWshConnections().clear();
  setKernelBridge(null);
  setToolRegistry({
    allSpecs: () => [{ name: 'browser_echo', description: 'echo', parameters: { type: 'object', properties: {} } }],
    get: (name) => ({ permission: name.startsWith('fs_') ? 'read' : 'auto' }),
    execute: async (name, args) => ({ success: true, output: JSON.stringify({ name, args }) }),
  });
  setMcpClient({
    async callTool(tool, args) {
      return { tool, args };
    },
  });
  setVirtualTerminalManager(new VirtualTerminalManager({
    shellFactory: async () => createShell(),
  }));
});

afterEach(async () => {
  for (const session of listIncomingSessions()) {
    await getIncomingSession(session.participantKey)?.close({ notifyRemote: false });
  }
  getWshConnections().clear();
  setVirtualTerminalManager(null);
  setToolRegistry(null);
  setMcpClient(null);
  setKernelBridge(null);
});

describe('incoming virtual terminal router', () => {
  it('sends ReverseReject when the virtual terminal manager is unavailable', async () => {
    const client = createClient('SHA256:reject');
    getWshConnections().set('relay', client);
    setVirtualTerminalManager(null);

    await handleReverseConnect({
      username: 'rejector',
      target_fingerprint: 'SHA256:reject',
    });

    assert.equal(client.sent[0].type, MSG.REVERSE_REJECT);
  });

  it('keeps peer contexts distinct when usernames collide across fingerprints', async () => {
    const clientA = createClient('SHA256:peer-a');
    const clientB = createClient('SHA256:peer-b');
    getWshConnections().set('relay-a', clientA);
    getWshConnections().set('relay-b', clientB);

    await handleReverseConnect({
      username: 'shared-user',
      target_fingerprint: 'SHA256:peer-a',
    });
    await handleReverseConnect({
      username: 'shared-user',
      target_fingerprint: 'SHA256:peer-b',
    });

    const sessions = listIncomingSessions();
    assert.equal(sessions.length, 2);
    assert.notEqual(sessions[0].participantKey, sessions[1].participantKey);
  });

  it('supports multiple concurrent channels from one reverse peer', async () => {
    const client = createClient('SHA256:multi');
    getWshConnections().set('relay', client);

    await handleReverseConnect({
      username: 'alice',
      target_fingerprint: 'SHA256:multi',
    });

    await client.onRelayMessage({ type: MSG.OPEN, kind: 'pty', cols: 80, rows: 24 });
    await client.onRelayMessage({ type: MSG.OPEN, kind: 'pty', cols: 100, rows: 30 });

    const openReplies = client.sent.filter((msg) => msg.type === MSG.OPEN_OK);
    assert.equal(openReplies.length, 2);
    assert.notEqual(openReplies[0].channel_id, openReplies[1].channel_id);

    const participantKey = buildReverseParticipantKey({
      username: 'alice',
      targetFingerprint: 'SHA256:multi',
    });
    const context = getIncomingSession(participantKey);
    assert.equal(context.state, 'active');
  });

  it('keeps reverse MCP, file, and policy flows working with browser capability checks', async () => {
    const client = createClient('SHA256:services');
    getWshConnections().set('relay', client);

    await handleReverseConnect({
      username: 'alice',
      target_fingerprint: 'SHA256:services',
    });

    await client.onRelayMessage({ type: MSG.MCP_DISCOVER });
    await client.onRelayMessage({ type: MSG.MCP_CALL, tool: 'browser_echo', arguments: { value: 1 } });
    await client.onRelayMessage({ type: MSG.FILE_OP, channel_id: 9, op: 'stat', path: '/tmp' });
    await client.onRelayMessage({
      type: MSG.POLICY_EVAL,
      request_id: 'req-1',
      action: 'browser_echo',
      principal: 'user',
    });

    assert.ok(client.sent.some((msg) => msg.type === MSG.MCP_TOOLS && msg.tools.length === 1));
    assert.ok(client.sent.some((msg) => msg.type === MSG.MCP_RESULT && msg.result.success === true));
    assert.ok(client.sent.some((msg) => msg.type === MSG.FILE_RESULT && msg.success === true));
    assert.ok(client.sent.some((msg) => msg.type === MSG.POLICY_RESULT && msg.allowed === true));

    const blocked = createClient('SHA256:blocked', { shell: true, tools: false, fs: false });
    getWshConnections().set('relay-blocked', blocked);

    await handleReverseConnect({
      username: 'bob',
      target_fingerprint: 'SHA256:blocked',
    });

    await blocked.onRelayMessage({ type: MSG.MCP_DISCOVER });
    await blocked.onRelayMessage({ type: MSG.MCP_CALL, tool: 'browser_echo', arguments: {} });
    await blocked.onRelayMessage({ type: MSG.FILE_OP, channel_id: 10, op: 'stat', path: '/tmp' });
    await blocked.onRelayMessage({
      type: MSG.POLICY_EVAL,
      request_id: 'req-2',
      action: 'fs_stat',
      principal: 'user',
    });

    assert.ok(blocked.sent.some((msg) => msg.type === MSG.MCP_TOOLS && msg.tools.length === 0));
    assert.ok(blocked.sent.some((msg) => msg.type === MSG.MCP_RESULT && /did not expose tool access/i.test(msg.result.error)));
    assert.ok(blocked.sent.some((msg) => msg.type === MSG.FILE_RESULT && msg.success === false));
    assert.ok(blocked.sent.some((msg) => msg.type === MSG.POLICY_RESULT && msg.allowed === false));
  });
});
