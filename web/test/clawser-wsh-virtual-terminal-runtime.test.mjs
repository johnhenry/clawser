import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { MSG } from '../packages-wsh.js';
import { VirtualTerminalSession } from '../clawser-wsh-virtual-terminal-session.js';
import {
  VirtualTerminalManager,
  buildReverseParticipantKey,
} from '../clawser-wsh-virtual-terminal-manager.js';

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

function decodeSessionTraffic(messages) {
  return messages
    .filter((msg) => msg.type === MSG.SESSION_DATA)
    .map((msg) => decoder.decode(msg.data))
    .join('');
}

describe('VirtualTerminalSession', () => {
  it('starts with a prompt and executes commands through the shell runtime', async () => {
    const sent = [];
    const session = new VirtualTerminalSession({
      participantKey: 'reverse:test:alice',
      channelId: 5,
      shellFactory: async () => createFakeShell(),
      sendControl: async (msg) => sent.push(msg),
    });

    await session.start();
    await session.write('pwd\r');

    assert.equal(session.closed, false);
    assert.ok(session.replay.includes('/$ '));
    assert.ok(session.replay.includes('/\r\n'));
    assert.deepEqual(session.shell.state.history, ['pwd']);
  });

  it('supports history recall for interactive editing', async () => {
    const sent = [];
    const session = new VirtualTerminalSession({
      participantKey: 'reverse:test:bob',
      channelId: 6,
      shellFactory: async () => createFakeShell(),
      sendControl: async (msg) => sent.push(msg),
    });

    await session.start();
    await session.write('first\r');
    sent.length = 0;

    await session.write('\x1b[A');

    const frame = decodeSessionTraffic(sent);
    assert.ok(frame.includes('first'));
  });

  it('emits echo and terminal sync control frames while the terminal state changes', async () => {
    const sent = [];
    const session = new VirtualTerminalSession({
      participantKey: 'reverse:test:echo',
      channelId: 8,
      shellFactory: async () => createFakeShell(),
      sendControl: async (msg) => sent.push(msg),
    });

    await session.start();
    sent.length = 0;

    await session.write('pwd\r');

    assert.ok(sent.some((msg) => msg.type === MSG.ECHO_ACK));
    assert.ok(sent.some((msg) => msg.type === MSG.ECHO_STATE));
    assert.ok(sent.some((msg) => msg.type === MSG.TERM_DIFF));
    assert.ok(sent.some((msg) => msg.type === MSG.TERM_SYNC));
  });

  it('closes on ctrl-d when the input buffer is empty', async () => {
    const sent = [];
    const session = new VirtualTerminalSession({
      participantKey: 'reverse:test:carol',
      channelId: 7,
      shellFactory: async () => createFakeShell(),
      sendControl: async (msg) => sent.push(msg),
    });

    await session.start();
    await session.write('\u0004');

    assert.equal(session.closed, true);
    assert.deepEqual(
      sent.slice(-2).map((msg) => msg.type),
      [MSG.EXIT, MSG.CLOSE],
    );
  });
});

describe('VirtualTerminalManager', () => {
  it('builds a stable participant key', () => {
    assert.equal(
      buildReverseParticipantKey({
        username: 'alice',
        targetFingerprint: 'SHA256:target',
      }),
      'reverse:SHA256:target:alice',
    );
  });

  it('opens exec channels and removes them after exit', async () => {
    const client = {
      sent: [],
      async sendRelayControl(msg) {
        this.sent.push(msg);
      },
    };
    const manager = new VirtualTerminalManager({
      shellFactory: async () => createFakeShell(),
    });
    const participantKey = buildReverseParticipantKey({
      username: 'dave',
      targetFingerprint: 'SHA256:target',
    });

    await manager.registerPeerContext({
      participantKey,
      username: 'dave',
      targetFingerprint: 'SHA256:target',
      client,
      capabilities: { shell: true, tools: false, fs: false },
    });

    await manager.openChannel(participantKey, {
      channelId: 11,
      kind: 'exec',
      command: 'pwd',
    });

    const traffic = decodeSessionTraffic(client.sent);
    assert.ok(traffic.includes('/\r\n'));
    assert.equal(manager.getChannel(participantKey, 11), null);
    assert.ok(client.sent.some((msg) => msg.type === MSG.EXIT));
    assert.ok(client.sent.some((msg) => msg.type === MSG.CLOSE));

    await manager.close();
  });

  it('replays an existing PTY channel after the peer context is rebound', async () => {
    const clientA = {
      sent: [],
      async sendRelayControl(msg) {
        this.sent.push(msg);
      },
    };
    const clientB = {
      sent: [],
      async sendRelayControl(msg) {
        this.sent.push(msg);
      },
    };
    const manager = new VirtualTerminalManager({
      shellFactory: async () => createFakeShell(),
    });
    const participantKey = buildReverseParticipantKey({
      username: 'erin',
      targetFingerprint: 'SHA256:target',
    });

    await manager.registerPeerContext({
      participantKey,
      username: 'erin',
      targetFingerprint: 'SHA256:target',
      client: clientA,
      capabilities: { shell: true, tools: false, fs: false },
    });

    const session = await manager.openChannel(participantKey, {
      channelId: 12,
      kind: 'pty',
    });
    await session.write('pwd\r');

    await manager.registerPeerContext({
      participantKey,
      username: 'erin',
      targetFingerprint: 'SHA256:target',
      client: clientB,
      capabilities: { shell: true, tools: false, fs: false },
    });

    const resumed = await manager.tryReattachChannel(participantKey, {
      kind: 'pty',
      cols: 120,
      rows: 40,
    });

    assert.equal(resumed, session);
    assert.equal(resumed.cols, 120);
    assert.equal(resumed.rows, 40);
    assert.ok(decodeSessionTraffic(clientB.sent).includes('/\r\n'));

    await manager.close();
  });
});
