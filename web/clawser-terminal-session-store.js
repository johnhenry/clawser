import { ShellState } from './clawser-shell.js';

const DEFAULT_STDOUT_CAP = 10_000;
const DEFAULT_STDERR_CAP = 5_000;

function cap(str, max) {
  if (typeof str !== 'string') return '';
  if (str.length <= max) return str;
  return str.slice(0, max) + '\n... (truncated)';
}

export function serializeTerminalSessionEvents(events) {
  return events.map((event) => JSON.stringify(event)).join('\n');
}

export function parseTerminalSessionEvents(raw) {
  if (!raw || !raw.trim()) return [];
  return raw.trim().split('\n').map((line) => {
    try {
      return JSON.parse(line);
    } catch (_) {
      return null;
    }
  }).filter(Boolean);
}

export class TerminalSessionStore {
  #shell;
  #events = [];
  #dirty = false;
  #stdoutCap;
  #stderrCap;

  constructor({ shell, stdoutCap = DEFAULT_STDOUT_CAP, stderrCap = DEFAULT_STDERR_CAP } = {}) {
    this.#shell = shell || null;
    this.#stdoutCap = stdoutCap;
    this.#stderrCap = stderrCap;
  }

  setShell(shell) {
    this.#shell = shell || null;
  }

  clear() {
    this.#events = [];
    this.#dirty = false;
  }

  markClean() {
    this.#dirty = false;
  }

  setEvents(events, { dirty = false } = {}) {
    this.#events = Array.isArray(events) ? [...events] : [];
    this.#dirty = dirty;
    this.rebuildHistoryFromEvents();
  }

  cloneEvents() {
    return [...this.#events];
  }

  serializeShellState() {
    const state = this.#shell?.state;
    if (!state) {
      return {
        cwd: '/',
        env: {},
        aliases: {},
        history: [],
        lastExitCode: 0,
        pipefail: true,
      };
    }
    return {
      cwd: state.cwd,
      env: state.env instanceof Map ? Object.fromEntries(state.env) : (state.env || {}),
      aliases: state.aliases instanceof Map ? Object.fromEntries(state.aliases) : (state.aliases || {}),
      history: Array.isArray(state.history) ? [...state.history] : [],
      lastExitCode: state.lastExitCode ?? 0,
      pipefail: state.pipefail ?? true,
    };
  }

  applyShellState(stateObj) {
    if (!this.#shell?.state || !stateObj) return;
    const state = this.#shell.state;
    state.cwd = stateObj.cwd || '/';
    state.env = stateObj.env instanceof Map ? stateObj.env : new Map(Object.entries(stateObj.env || {}));
    state.aliases = stateObj.aliases instanceof Map ? stateObj.aliases : new Map(Object.entries(stateObj.aliases || {}));
    state.history = Array.isArray(stateObj.history) ? [...stateObj.history] : [];
    state.lastExitCode = stateObj.lastExitCode ?? 0;
    state.pipefail = stateObj.pipefail ?? true;
  }

  resetShellState() {
    if (!this.#shell?.state) return;
    const freshState = new ShellState();
    Object.assign(this.#shell.state, {
      cwd: freshState.cwd,
      env: freshState.env,
      aliases: freshState.aliases,
      history: freshState.history,
      lastExitCode: freshState.lastExitCode,
      pipefail: freshState.pipefail,
    });
  }

  rebuildHistoryFromEvents(events = this.#events) {
    if (!this.#shell?.state) return;
    this.#shell.state.history = events
      .filter((event) => event?.type === 'shell_command')
      .map((event) => event.data?.command)
      .filter(Boolean);
  }

  recordCommand(command) {
    const cwd = this.#shell?.state?.cwd || '/';
    return this.#recordEvent('shell_command', { command, cwd }, 'user');
  }

  recordResult(stdout, stderr, exitCode) {
    return this.#recordEvent('shell_result', {
      stdout: cap(stdout, this.#stdoutCap),
      stderr: cap(stderr, this.#stderrCap),
      exitCode,
    }, 'system');
  }

  recordAgentPrompt(content) {
    return this.#recordEvent('agent_prompt', { content }, 'user');
  }

  recordAgentResponse(content) {
    return this.#recordEvent('agent_response', { content }, 'system');
  }

  recordStateSnapshot() {
    const state = this.#shell?.state;
    if (!state) return null;
    return this.#recordEvent('state_snapshot', {
      cwd: state.cwd,
      env: Object.fromEntries(state.env),
      aliases: Object.fromEntries(state.aliases),
      lastExitCode: state.lastExitCode,
    }, 'system');
  }

  exportAsScript() {
    const commands = this.#events
      .filter((event) => event.type === 'shell_command')
      .map((event) => event.data?.command)
      .filter(Boolean);
    return ['#!/bin/sh', '', ...commands, ''].join('\n');
  }

  exportAsLog(format = 'text') {
    switch (format) {
      case 'json':
        return JSON.stringify(this.#events, null, 2);
      case 'jsonl':
        return serializeTerminalSessionEvents(this.#events);
      case 'text':
      default:
        return this.#events.map((event) => {
          const ts = new Date(event.timestamp).toISOString();
          switch (event.type) {
            case 'shell_command':
              return `[${ts}] $ ${event.data?.command || ''}`;
            case 'shell_result': {
              const parts = [];
              if (event.data?.stdout) parts.push(event.data.stdout);
              if (event.data?.stderr) parts.push(`[stderr] ${event.data.stderr}`);
              parts.push(`[exit ${event.data?.exitCode ?? '?'}]`);
              return parts.join('\n');
            }
            case 'agent_prompt':
              return `[${ts}] [agent-prompt] ${event.data?.content || ''}`;
            case 'agent_response':
              return `[${ts}] [agent-response] ${event.data?.content || ''}`;
            case 'state_snapshot':
              return `[${ts}] [snapshot] cwd=${event.data?.cwd || '/'}`;
            default:
              return `[${ts}] [${event.type}] ${JSON.stringify(event.data)}`;
          }
        }).join('\n');
    }
  }

  exportAsMarkdown(meta = null) {
    const title = meta?.name || meta?.id || 'Terminal Session';
    const lines = [`# ${title}`, ''];

    if (meta) {
      lines.push(`- **Created:** ${new Date(meta.created).toISOString()}`);
      lines.push(`- **Last Used:** ${new Date(meta.lastUsed).toISOString()}`);
      lines.push(`- **Commands:** ${meta.commandCount}`);
      lines.push('');
    }

    for (const event of this.#events) {
      switch (event.type) {
        case 'shell_command':
          lines.push('```sh', `$ ${event.data?.command || ''}`, '```', '');
          break;
        case 'shell_result':
          if (event.data?.stdout) lines.push('```', event.data.stdout, '```', '');
          if (event.data?.stderr) lines.push('**stderr:**', '```', event.data.stderr, '```', '');
          if (event.data?.exitCode !== undefined && event.data.exitCode !== 0) {
            lines.push(`> Exit code: ${event.data.exitCode}`, '');
          }
          break;
        case 'agent_prompt':
          lines.push('**Agent Prompt:**', '', event.data?.content || '', '');
          break;
        case 'agent_response':
          lines.push('**Agent Response:**', '', event.data?.content || '', '');
          break;
        case 'state_snapshot':
          lines.push(`> State snapshot: cwd=\`${event.data?.cwd || '/'}\``, '');
          break;
      }
    }

    return lines.join('\n');
  }

  get events() {
    return this.#events;
  }

  get dirty() {
    return this.#dirty;
  }

  #recordEvent(type, data, source) {
    const event = { type, data, source, timestamp: Date.now() };
    this.#events.push(event);
    this.#dirty = true;
    return event;
  }
}
