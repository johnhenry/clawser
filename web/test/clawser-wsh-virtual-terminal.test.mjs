import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { MSG } from '../packages-wsh.js';
import { VirtualTerminalSession } from '../clawser-wsh-virtual-terminal-session.js';

const decoder = new TextDecoder();

function createShell() {
  const state = {
    cwd: '/',
    env: new Map(),
    aliases: new Map(),
    history: [],
    lastExitCode: 0,
    pipefail: true,
  };

  let resolveSlow = null;
  return {
    state,
    async exec(command) {
      state.history.push(command);
      if (command === 'slow') {
        return new Promise((resolve) => {
          resolveSlow = resolve;
        });
      }
      return { stdout: `ran:${command}\n`, stderr: '', exitCode: 0 };
    },
    resolveSlow(result = { stdout: '', stderr: '', exitCode: 0 }) {
      resolveSlow?.(result);
      resolveSlow = null;
    },
  };
}

function sessionTraffic(messages) {
  return messages
    .filter((msg) => msg.type === MSG.SESSION_DATA)
    .map((msg) => decoder.decode(msg.data))
    .join('');
}

describe('browser virtual terminal', () => {
  it('redraws edited input after resize without losing the current line', async () => {
    const sent = [];
    const shell = createShell();
    const session = new VirtualTerminalSession({
      participantKey: 'reverse:test:resize',
      channelId: 1,
      shellFactory: async () => shell,
      sendControl: async (msg) => sent.push(msg),
    });

    await session.start();
    await session.write('hello');
    sent.length = 0;

    await session.resize(120, 40);

    const traffic = sessionTraffic(sent);
    assert.match(traffic, /\r\/\$ hello\x1b\[K/);
  });

  it('supports in-line editing with cursor movement and backspace', async () => {
    const sent = [];
    const shell = createShell();
    const session = new VirtualTerminalSession({
      participantKey: 'reverse:test:editing',
      channelId: 2,
      shellFactory: async () => shell,
      sendControl: async (msg) => sent.push(msg),
    });

    await session.start();
    await session.write('ab');
    await session.write('\x1b[D');
    await session.write('\u007f');
    await session.write('c\r');

    assert.deepEqual(shell.state.history, ['cb']);
    assert.ok(sessionTraffic(sent).includes('ran:cb\n'));
  });

  it('prints ^C and redraws the prompt when interrupting a running command', async () => {
    const sent = [];
    const shell = createShell();
    const session = new VirtualTerminalSession({
      participantKey: 'reverse:test:interrupt',
      channelId: 3,
      shellFactory: async () => shell,
      sendControl: async (msg) => sent.push(msg),
    });

    await session.start();
    const pendingCommand = session.write('slow\r');
    await Promise.resolve();
    sent.length = 0;

    await session.write('\u0003');

    const traffic = sessionTraffic(sent);
    assert.ok(traffic.includes('^C\r\n'));
    assert.ok(traffic.includes('/$ '));

    shell.resolveSlow();
    await pendingCommand;
  });
});
