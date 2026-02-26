/**
 * Clawser Terminal Sessions — Manage terminal sessions as first-class objects
 *
 * Each terminal session captures a full event log (commands, results, agent
 * interactions, state snapshots) and persists both the event stream and a
 * fast-restore state snapshot to OPFS.
 *
 * Storage layout (OPFS, workspace-scoped — same pattern as conversations):
 *   clawser_workspaces/{wsId}/.terminal-sessions/{termId}/meta.json
 *   clawser_workspaces/{wsId}/.terminal-sessions/{termId}/events.jsonl
 *   clawser_workspaces/{wsId}/.terminal-sessions/{termId}/state.json
 *
 * Session metadata shape (meta.json):
 *   { id, name, created, lastUsed, commandCount, preview, version: 1, workspaceId }
 */

import { ShellState } from './clawser-shell.js';

// ── Helpers ─────────────────────────────────────────────────────

/**
 * Generate a unique terminal session ID.
 * @returns {string}
 */
export function createTerminalSessionId() {
  return 'term_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 6);
}

const STDOUT_CAP = 10_000;
const STDERR_CAP = 5_000;

/**
 * Truncate a string to a maximum length, appending an indicator if truncated.
 */
function cap(str, max) {
  if (typeof str !== 'string') return '';
  if (str.length <= max) return str;
  return str.slice(0, max) + '\n... (truncated)';
}

/**
 * Atomic write to OPFS: uses createWritable() swap file so the original is
 * only replaced on close(), matching the conversation persistence pattern.
 */
async function atomicWrite(dirHandle, filename, content) {
  const fh = await dirHandle.getFileHandle(filename, { create: true });
  const w = await fh.createWritable();
  await w.write(content);
  await w.close();
}

/**
 * Read text from an OPFS file handle. Returns null if not found.
 */
async function readText(dirHandle, filename) {
  try {
    const fh = await dirHandle.getFileHandle(filename);
    const file = await fh.getFile();
    return await file.text();
  } catch (_) {
    return null;
  }
}

// ── TerminalSessionManager ──────────────────────────────────────

export class TerminalSessionManager {
  /** @type {string} */
  #wsId;
  /** @type {string|null} */
  #activeSessionId;
  /** @type {Array<Object>} */
  #sessions;
  /** @type {Array<Object>} */
  #events;
  /** @type {Object} */
  #shell;
  /** @type {boolean} */
  #dirty;

  /**
   * @param {Object} opts
   * @param {string} opts.wsId — workspace ID
   * @param {Object} opts.shell — current ClawserShell instance
   */
  constructor({ wsId, shell }) {
    this.#wsId = wsId;
    this.#shell = shell;
    this.#activeSessionId = null;
    this.#events = [];
    this.#dirty = false;
    this.#sessions = [];
  }

  // ── OPFS directory helpers (mirrors agent's #getWorkspaceDir pattern) ──

  async #root() {
    return navigator.storage.getDirectory();
  }

  async #wsDir(create = false) {
    const root = await this.#root();
    const base = await root.getDirectoryHandle('clawser_workspaces', { create });
    return base.getDirectoryHandle(this.#wsId, { create });
  }

  async #sessionsDir(create = false) {
    const ws = await this.#wsDir(create);
    return ws.getDirectoryHandle('.terminal-sessions', { create });
  }

  async #sessionDir(termId, create = false) {
    const sessions = await this.#sessionsDir(create);
    return sessions.getDirectoryHandle(termId, { create });
  }

  // ── Lifecycle ───────────────────────────────────────────────

  /**
   * Initialize: scan OPFS for existing sessions, restore the most recent.
   * @returns {Promise<{restored: boolean, events?: Array<Object>}>}
   */
  async init() {
    this.#sessions = await this.#scanSessions();

    if (this.#sessions.length > 0) {
      const sorted = [...this.#sessions].sort((a, b) => (b.lastUsed || 0) - (a.lastUsed || 0));
      const last = sorted[0];
      try {
        const restored = await this.restore(last.id);
        this.#activeSessionId = last.id;
        this.#dirty = false;
        return { restored: true, events: restored.events };
      } catch (_) {
        // Restore failed — fall through
      }
    }

    await this.create('Terminal 1');
    return { restored: false };
  }

  /**
   * Update the shell reference (needed when shell is recreated).
   */
  setShell(shell) {
    this.#shell = shell;
  }

  // ── Session CRUD ────────────────────────────────────────────

  /**
   * Create a new terminal session.
   */
  async create(name) {
    if (this.#activeSessionId) {
      await this.persist();
    }

    const id = createTerminalSessionId();
    const now = Date.now();
    const meta = {
      id,
      name: name || this.#autoName(),
      created: now,
      lastUsed: now,
      commandCount: 0,
      preview: '',
      version: 1,
      workspaceId: this.#wsId,
    };

    // Reset shell to fresh state
    const freshState = new ShellState();
    if (this.#shell?.state) {
      Object.assign(this.#shell.state, {
        cwd: freshState.cwd,
        env: freshState.env,
        aliases: freshState.aliases,
        history: freshState.history,
        lastExitCode: freshState.lastExitCode,
        pipefail: freshState.pipefail,
      });
    }

    this.#events = [];
    this.#activeSessionId = id;
    this.#dirty = false;
    this.#sessions.push(meta);

    // Write meta.json to OPFS
    const dir = await this.#sessionDir(id, true);
    await atomicWrite(dir, 'meta.json', JSON.stringify(meta));

    return { ...meta };
  }

  /**
   * Switch to an existing session by ID.
   */
  async switchTo(sessionId) {
    const meta = this.#sessions.find(s => s.id === sessionId);
    if (!meta) throw new Error(`Terminal session not found: ${sessionId}`);

    if (this.#activeSessionId) {
      await this.persist();
    }

    const restored = await this.restore(sessionId);
    this.#activeSessionId = sessionId;
    this.#dirty = false;

    meta.lastUsed = Date.now();
    const dir = await this.#sessionDir(sessionId);
    await atomicWrite(dir, 'meta.json', JSON.stringify(meta));

    return { ...meta };
  }

  /**
   * Persist current session's events and state to OPFS.
   */
  async persist() {
    if (!this.#activeSessionId) return;

    const termId = this.#activeSessionId;

    try {
      const dir = await this.#sessionDir(termId, true);

      // Update meta
      const meta = this.#sessions.find(s => s.id === termId);
      if (meta) {
        meta.lastUsed = Date.now();
        await atomicWrite(dir, 'meta.json', JSON.stringify(meta));
      }

      // Write events as JSONL
      const eventsContent = this.#events.map(e => JSON.stringify(e)).join('\n');
      await atomicWrite(dir, 'events.jsonl', eventsContent);

      // Write shell state snapshot
      const stateSnapshot = this.#serializeShellState();
      await atomicWrite(dir, 'state.json', JSON.stringify(stateSnapshot));

      this.#dirty = false;
    } catch (e) {
      console.warn('[TerminalSessions] persist failed:', e);
    }
  }

  /**
   * Restore a session from OPFS.
   */
  async restore(sessionId) {
    const dir = await this.#sessionDir(sessionId);

    // Restore shell state
    const stateRaw = await readText(dir, 'state.json');
    if (stateRaw) {
      try {
        this.#applyShellState(JSON.parse(stateRaw));
      } catch (_) { /* bad JSON */ }
    } else {
      this.#resetShellState();
    }

    // Restore events
    let events = [];
    const eventsRaw = await readText(dir, 'events.jsonl');
    if (eventsRaw && eventsRaw.trim()) {
      events = eventsRaw.trim().split('\n').map(line => {
        try { return JSON.parse(line); } catch (_) { return null; }
      }).filter(Boolean);
    }

    this.#events = events;

    // Rebuild shell history from command events
    if (this.#shell?.state) {
      this.#shell.state.history = events
        .filter(e => e.type === 'shell_command')
        .map(e => e.data?.command)
        .filter(Boolean);
    }

    return { id: sessionId, events };
  }

  /**
   * Delete a session.
   */
  async delete(sessionId) {
    try {
      const sessions = await this.#sessionsDir();
      await sessions.removeEntry(sessionId, { recursive: true });
    } catch (_) { /* may not exist */ }

    this.#sessions = this.#sessions.filter(s => s.id !== sessionId);

    if (this.#activeSessionId === sessionId) {
      this.#activeSessionId = null;
      this.#events = [];
      this.#dirty = false;
    }
  }

  /**
   * Rename a session.
   */
  async rename(sessionId, newName) {
    const meta = this.#sessions.find(s => s.id === sessionId);
    if (!meta) throw new Error(`Terminal session not found: ${sessionId}`);
    meta.name = newName;
    const dir = await this.#sessionDir(sessionId);
    await atomicWrite(dir, 'meta.json', JSON.stringify(meta));
  }

  /**
   * Fork the current session.
   */
  async fork(newName) {
    if (!this.#activeSessionId) throw new Error('No active session to fork');

    await this.persist();

    const originalEvents = [...this.#events];
    const originalState = this.#serializeShellState();

    const meta = await this.create(newName || `Fork of ${this.activeName || this.#activeSessionId}`);

    this.#events = originalEvents;
    this.#applyShellState(originalState);

    const newMeta = this.#sessions.find(s => s.id === meta.id);
    if (newMeta) {
      newMeta.commandCount = originalEvents.filter(e => e.type === 'shell_command').length;
    }

    this.#dirty = true;
    await this.persist();

    return { ...meta, commandCount: newMeta?.commandCount || 0 };
  }

  /**
   * Fork from a specific event index.
   */
  async forkFromEvent(eventIndex, newName) {
    if (!this.#activeSessionId) throw new Error('No active session to fork');
    if (eventIndex < 0 || eventIndex >= this.#events.length) {
      throw new Error(`Event index out of range: ${eventIndex}`);
    }

    await this.persist();

    let endIndex = eventIndex;
    const targetEvent = this.#events[eventIndex];
    if (targetEvent.type === 'shell_command' && eventIndex + 1 < this.#events.length) {
      if (this.#events[eventIndex + 1].type === 'shell_result') {
        endIndex = eventIndex + 1;
      }
    }

    const slicedEvents = this.#events.slice(0, endIndex + 1);

    let snapshot = null;
    for (let i = endIndex; i >= 0; i--) {
      if (slicedEvents[i]?.type === 'state_snapshot') {
        snapshot = slicedEvents[i].data;
        break;
      }
    }

    const originalName = this.activeName || this.#activeSessionId;
    const meta = await this.create(
      newName || `${originalName} (fork@cmd ${slicedEvents.filter(e => e.type === 'shell_command').length})`
    );

    this.#events = slicedEvents;

    if (snapshot) {
      this.#applyShellState(snapshot);
    } else if (this.#shell?.state) {
      this.#shell.state.history = slicedEvents
        .filter(e => e.type === 'shell_command')
        .map(e => e.data?.command)
        .filter(Boolean);
    }

    const newMeta = this.#sessions.find(s => s.id === meta.id);
    if (newMeta) {
      newMeta.commandCount = slicedEvents.filter(e => e.type === 'shell_command').length;
    }

    this.#dirty = true;
    await this.persist();

    return { ...meta, commandCount: newMeta?.commandCount || 0 };
  }

  // ── Event Recording ─────────────────────────────────────────

  recordCommand(command) {
    const cwd = this.#shell?.state?.cwd || '/';
    const event = this.#makeEvent('shell_command', { command, cwd }, 'user');
    this.#events.push(event);
    this.#dirty = true;

    const meta = this.#sessions.find(s => s.id === this.#activeSessionId);
    if (meta) {
      meta.commandCount = (meta.commandCount || 0) + 1;
      meta.lastUsed = event.timestamp;
    }
  }

  recordResult(stdout, stderr, exitCode) {
    const event = this.#makeEvent('shell_result', {
      stdout: cap(stdout, STDOUT_CAP),
      stderr: cap(stderr, STDERR_CAP),
      exitCode,
    }, 'system');
    this.#events.push(event);
    this.#dirty = true;

    const meta = this.#sessions.find(s => s.id === this.#activeSessionId);
    if (meta) {
      const previewSource = stdout || stderr || '';
      meta.preview = (previewSource.split('\n')[0] || '').slice(0, 80);
    }

    // Auto-persist after each result so sessions survive page refresh
    this.persist().catch(() => {});
  }

  recordAgentPrompt(content) {
    this.#events.push(this.#makeEvent('agent_prompt', { content }, 'user'));
    this.#dirty = true;
  }

  recordAgentResponse(content) {
    this.#events.push(this.#makeEvent('agent_response', { content }, 'system'));
    this.#dirty = true;
  }

  recordStateSnapshot() {
    const s = this.#shell?.state;
    if (!s) return;
    this.#events.push(this.#makeEvent('state_snapshot', {
      cwd: s.cwd,
      env: Object.fromEntries(s.env),
      aliases: Object.fromEntries(s.aliases),
      lastExitCode: s.lastExitCode,
    }, 'system'));
    this.#dirty = true;
  }

  // ── Queries ─────────────────────────────────────────────────

  list() { return this.#sessions.map(s => ({ ...s })); }
  get activeId() { return this.#activeSessionId; }
  get activeName() {
    if (!this.#activeSessionId) return null;
    return this.#sessions.find(s => s.id === this.#activeSessionId)?.name || null;
  }
  get events() { return this.#events; }
  get dirty() { return this.#dirty; }

  // ── Export ───────────────────────────────────────────────────

  exportAsScript() {
    const commands = this.#events
      .filter(e => e.type === 'shell_command')
      .map(e => e.data?.command)
      .filter(Boolean);
    return ['#!/bin/sh', '', ...commands, ''].join('\n');
  }

  exportAsLog(format) {
    switch (format) {
      case 'json':
        return JSON.stringify(this.#events, null, 2);
      case 'jsonl':
        return this.#events.map(e => JSON.stringify(e)).join('\n');
      case 'text':
      default:
        return this.#events.map(e => {
          const ts = new Date(e.timestamp).toISOString();
          switch (e.type) {
            case 'shell_command':
              return `[${ts}] $ ${e.data?.command || ''}`;
            case 'shell_result': {
              const parts = [];
              if (e.data?.stdout) parts.push(e.data.stdout);
              if (e.data?.stderr) parts.push(`[stderr] ${e.data.stderr}`);
              parts.push(`[exit ${e.data?.exitCode ?? '?'}]`);
              return parts.join('\n');
            }
            case 'agent_prompt':
              return `[${ts}] [agent-prompt] ${e.data?.content || ''}`;
            case 'agent_response':
              return `[${ts}] [agent-response] ${e.data?.content || ''}`;
            case 'state_snapshot':
              return `[${ts}] [snapshot] cwd=${e.data?.cwd || '/'}`;
            default:
              return `[${ts}] [${e.type}] ${JSON.stringify(e.data)}`;
          }
        }).join('\n');
    }
  }

  exportAsMarkdown() {
    const meta = this.#sessions.find(s => s.id === this.#activeSessionId);
    const title = meta?.name || this.#activeSessionId || 'Terminal Session';
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

  // ── Private ─────────────────────────────────────────────────

  /**
   * Scan OPFS for existing session directories. Each session has a meta.json.
   * This replaces the old index file — the directory listing IS the index.
   */
  async #scanSessions() {
    const sessions = [];
    try {
      const dir = await this.#sessionsDir();
      for await (const [name, handle] of dir) {
        if (handle.kind !== 'directory') continue;
        const metaText = await readText(handle, 'meta.json');
        if (metaText) {
          try {
            const meta = JSON.parse(metaText);
            if (meta.id) sessions.push(meta);
          } catch (_) { /* bad JSON */ }
        }
      }
    } catch (_) {
      // .terminal-sessions dir doesn't exist yet
    }
    return sessions;
  }

  #autoName() {
    const existing = this.#sessions
      .map(s => s.name)
      .filter(n => /^Terminal \d+$/.test(n))
      .map(n => parseInt(n.replace('Terminal ', ''), 10))
      .filter(n => !isNaN(n));
    return `Terminal ${existing.length > 0 ? Math.max(...existing) + 1 : 1}`;
  }

  #makeEvent(type, data, source) {
    return { type, data, source, timestamp: Date.now() };
  }

  #serializeShellState() {
    const s = this.#shell?.state;
    if (!s) return { cwd: '/', env: {}, aliases: {}, history: [], lastExitCode: 0, pipefail: true };
    return {
      cwd: s.cwd,
      env: s.env instanceof Map ? Object.fromEntries(s.env) : (s.env || {}),
      aliases: s.aliases instanceof Map ? Object.fromEntries(s.aliases) : (s.aliases || {}),
      history: Array.isArray(s.history) ? [...s.history] : [],
      lastExitCode: s.lastExitCode ?? 0,
      pipefail: s.pipefail ?? true,
    };
  }

  #applyShellState(stateObj) {
    if (!this.#shell?.state || !stateObj) return;
    const s = this.#shell.state;
    s.cwd = stateObj.cwd || '/';
    s.env = stateObj.env instanceof Map ? stateObj.env : new Map(Object.entries(stateObj.env || {}));
    s.aliases = stateObj.aliases instanceof Map ? stateObj.aliases : new Map(Object.entries(stateObj.aliases || {}));
    s.history = Array.isArray(stateObj.history) ? [...stateObj.history] : [];
    s.lastExitCode = stateObj.lastExitCode ?? 0;
    s.pipefail = stateObj.pipefail ?? true;
  }

  #resetShellState() {
    const freshState = new ShellState();
    if (this.#shell?.state) {
      Object.assign(this.#shell.state, {
        cwd: freshState.cwd, env: freshState.env, aliases: freshState.aliases,
        history: freshState.history, lastExitCode: freshState.lastExitCode, pipefail: freshState.pipefail,
      });
    }
  }
}
