import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

globalThis.BrowserTool = class { constructor() {} };

if (!globalThis.crypto?.randomUUID) {
  globalThis.crypto = globalThis.crypto || {};
  globalThis.crypto.randomUUID = () =>
    `${Math.random().toString(36).slice(2)}-${Date.now().toString(36)}`;
}

const { ShellState } = await import('../clawser-shell.js');
const {
  TerminalSessionStore,
  parseTerminalSessionEvents,
  serializeTerminalSessionEvents,
} = await import('../clawser-terminal-session-store.js');

function makeShell() {
  return { state: new ShellState() };
}

describe('TerminalSessionStore', () => {
  it('serializes and reapplies shell state', () => {
    const shell = makeShell();
    shell.state.cwd = '/docs';
    shell.state.env.set('FOO', 'bar');
    shell.state.aliases.set('ll', 'ls -la');
    shell.state.history.push('pwd');
    shell.state.lastExitCode = 7;
    shell.state.pipefail = false;

    const store = new TerminalSessionStore({ shell });
    const snapshot = store.serializeShellState();

    const restoredShell = makeShell();
    const restoredStore = new TerminalSessionStore({ shell: restoredShell });
    restoredStore.applyShellState(snapshot);

    assert.equal(restoredShell.state.cwd, '/docs');
    assert.equal(restoredShell.state.env.get('FOO'), 'bar');
    assert.equal(restoredShell.state.aliases.get('ll'), 'ls -la');
    assert.deepEqual(restoredShell.state.history, ['pwd']);
    assert.equal(restoredShell.state.lastExitCode, 7);
    assert.equal(restoredShell.state.pipefail, false);
  });

  it('rebuilds shell history from loaded events', () => {
    const shell = makeShell();
    const store = new TerminalSessionStore({ shell });

    store.setEvents([
      { type: 'shell_command', data: { command: 'pwd' }, source: 'user', timestamp: 1 },
      { type: 'shell_result', data: { stdout: '/', stderr: '', exitCode: 0 }, source: 'system', timestamp: 2 },
      { type: 'shell_command', data: { command: 'ls' }, source: 'user', timestamp: 3 },
    ]);

    assert.deepEqual(shell.state.history, ['pwd', 'ls']);
    assert.equal(store.dirty, false);
  });

  it('round-trips JSONL event serialization', () => {
    const shell = makeShell();
    const store = new TerminalSessionStore({ shell });

    store.recordCommand('pwd');
    store.recordResult('/workspace', '', 0);
    const raw = serializeTerminalSessionEvents(store.events);
    const parsed = parseTerminalSessionEvents(raw);

    assert.equal(parsed.length, 2);
    assert.equal(parsed[0].type, 'shell_command');
    assert.equal(parsed[1].type, 'shell_result');
  });
});
