/**
 * Clawser Terminal Sessions — Manage terminal sessions as first-class objects
 *
 * Each terminal session captures a full event log (commands, results, agent
 * interactions, state snapshots) and persists both the event stream and a
 * fast-restore state snapshot to OPFS.
 *
 * Storage layout:
 *   OPFS (workspace-scoped):
 *     /.terminal-sessions/{termId}/events.jsonl
 *     /.terminal-sessions/{termId}/state.json
 *   localStorage:
 *     clawser_terminal_sessions_{wsId} — JSON array of session metadata
 *
 * Session metadata shape:
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
 * @param {string} str
 * @param {number} max
 * @returns {string}
 */
function cap(str, max) {
  if (typeof str !== 'string') return '';
  if (str.length <= max) return str;
  return str.slice(0, max) + '\n... (truncated)';
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
  /** @type {Object} */
  #fs;
  /** @type {boolean} */
  #dirty;

  /**
   * @param {Object} opts
   * @param {string} opts.wsId — workspace ID
   * @param {Object} opts.shell — current ClawserShell instance
   * @param {Object} opts.fs — WorkspaceFs instance (readFile, writeFile, listDir, mkdir, delete, stat)
   */
  constructor({ wsId, shell, fs }) {
    this.#wsId = wsId;
    this.#shell = shell;
    this.#fs = fs;
    this.#activeSessionId = null;
    this.#events = [];
    this.#dirty = false;
    this.#sessions = this.#loadIndex();
  }

  // ── Lifecycle ───────────────────────────────────────────────

  /**
   * Update the shell reference (needed when shell is recreated).
   * @param {Object} shell
   */
  setShell(shell) {
    this.#shell = shell;
  }

  // ── Session CRUD ────────────────────────────────────────────

  /**
   * Create a new terminal session.
   * Persists the current session if one is active, resets shell state,
   * clears events, and adds the new session to the index.
   * @param {string} [name] — optional name; auto-generated if omitted
   * @returns {Promise<Object>} session metadata
   */
  async create(name) {
    // Persist current session if active
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

    // Reset shell to a fresh state
    const freshState = new ShellState();
    if (this.#shell && this.#shell.state) {
      Object.assign(this.#shell.state, {
        cwd: freshState.cwd,
        env: freshState.env,
        aliases: freshState.aliases,
        history: freshState.history,
        lastExitCode: freshState.lastExitCode,
        pipefail: freshState.pipefail,
      });
    }

    // Clear events and set active
    this.#events = [];
    this.#activeSessionId = id;
    this.#dirty = false;

    // Add to index and save
    this.#sessions.push(meta);
    this.#saveIndex();

    return { ...meta };
  }

  /**
   * Switch to an existing session by ID.
   * Persists the current session, restores target session state and events.
   * @param {string} sessionId
   * @returns {Promise<Object>} restored session metadata
   */
  async switchTo(sessionId) {
    const meta = this.#sessions.find(s => s.id === sessionId);
    if (!meta) {
      throw new Error(`Terminal session not found: ${sessionId}`);
    }

    // Persist current session if active
    if (this.#activeSessionId) {
      await this.persist();
    }

    // Restore target session
    const restored = await this.restore(sessionId);

    this.#activeSessionId = sessionId;
    this.#dirty = false;

    // Update lastUsed
    meta.lastUsed = Date.now();
    this.#saveIndex();

    return { ...meta };
  }

  /**
   * Persist current session's events and state snapshot to OPFS.
   * Updates the localStorage index with current metadata.
   */
  async persist() {
    if (!this.#activeSessionId) return;

    const termId = this.#activeSessionId;
    const dirPath = `/.terminal-sessions/${termId}`;

    // Ensure directory exists
    try {
      await this.#fs.mkdir(dirPath);
    } catch (_) {
      // Directory may already exist
    }

    // Write events as JSONL
    const eventsContent = this.#events.map(e => JSON.stringify(e)).join('\n');
    try {
      await this.#fs.writeFile(`${dirPath}/events.jsonl`, eventsContent);
    } catch (err) {
      console.warn('[TerminalSessions] Failed to write events.jsonl:', err);
    }

    // Write state snapshot
    const stateSnapshot = this.#serializeShellState();
    try {
      await this.#fs.writeFile(`${dirPath}/state.json`, JSON.stringify(stateSnapshot));
    } catch (err) {
      console.warn('[TerminalSessions] Failed to write state.json:', err);
    }

    // Update index metadata
    const meta = this.#sessions.find(s => s.id === termId);
    if (meta) {
      meta.lastUsed = Date.now();
    }
    this.#saveIndex();
    this.#dirty = false;
  }

  /**
   * Restore a session from OPFS. Reads state.json for fast shell state restore,
   * reads events.jsonl, rebuilds history from recorded commands.
   * @param {string} sessionId
   * @returns {Promise<{id: string, events: Array<Object>}>}
   */
  async restore(sessionId) {
    const dirPath = `/.terminal-sessions/${sessionId}`;

    // Restore shell state from snapshot
    try {
      const stateRaw = await this.#fs.readFile(`${dirPath}/state.json`);
      const stateObj = JSON.parse(stateRaw);
      this.#applyShellState(stateObj);
    } catch (_) {
      // No state snapshot — reset to defaults
      const freshState = new ShellState();
      if (this.#shell && this.#shell.state) {
        Object.assign(this.#shell.state, {
          cwd: freshState.cwd,
          env: freshState.env,
          aliases: freshState.aliases,
          history: freshState.history,
          lastExitCode: freshState.lastExitCode,
          pipefail: freshState.pipefail,
        });
      }
    }

    // Restore events from JSONL
    let events = [];
    try {
      const eventsRaw = await this.#fs.readFile(`${dirPath}/events.jsonl`);
      if (eventsRaw && eventsRaw.trim()) {
        events = eventsRaw.trim().split('\n').map(line => {
          try {
            return JSON.parse(line);
          } catch (_) {
            return null;
          }
        }).filter(Boolean);
      }
    } catch (_) {
      // No events file — start with empty
    }

    this.#events = events;

    // Rebuild shell history from command events
    if (this.#shell && this.#shell.state) {
      const commands = events
        .filter(e => e.type === 'shell_command')
        .map(e => e.data?.command)
        .filter(Boolean);
      this.#shell.state.history = commands;
    }

    return { id: sessionId, events };
  }

  /**
   * Delete a session. Removes OPFS files and index entry.
   * If the deleted session is active, resets to no active session.
   * @param {string} sessionId
   */
  async delete(sessionId) {
    const dirPath = `/.terminal-sessions/${sessionId}`;

    // Remove OPFS files
    try {
      await this.#fs.delete(`${dirPath}/events.jsonl`);
    } catch (_) { /* may not exist */ }
    try {
      await this.#fs.delete(`${dirPath}/state.json`);
    } catch (_) { /* may not exist */ }
    try {
      await this.#fs.delete(dirPath);
    } catch (_) { /* directory removal may fail if not empty or not supported */ }

    // Remove from index
    this.#sessions = this.#sessions.filter(s => s.id !== sessionId);
    this.#saveIndex();

    // Reset if it was the active session
    if (this.#activeSessionId === sessionId) {
      this.#activeSessionId = null;
      this.#events = [];
      this.#dirty = false;
    }
  }

  /**
   * Rename a session.
   * @param {string} sessionId
   * @param {string} newName
   */
  rename(sessionId, newName) {
    const meta = this.#sessions.find(s => s.id === sessionId);
    if (!meta) {
      throw new Error(`Terminal session not found: ${sessionId}`);
    }
    meta.name = newName;
    this.#saveIndex();
  }

  /**
   * Fork the current session into a new one with copied events and state.
   * @param {string} [newName] — name for the fork; auto-generated if omitted
   * @returns {Promise<Object>} new session metadata
   */
  async fork(newName) {
    if (!this.#activeSessionId) {
      throw new Error('No active session to fork');
    }

    // Persist current state first
    await this.persist();

    const originalId = this.#activeSessionId;
    const originalEvents = [...this.#events];
    const originalStateSerialized = this.#serializeShellState();

    // Create new session (this will persist current and reset)
    const meta = await this.create(newName || `Fork of ${this.activeName || originalId}`);

    // Copy events from original
    this.#events = originalEvents;

    // Restore state from original
    this.#applyShellState(originalStateSerialized);

    // Update metadata
    const newMeta = this.#sessions.find(s => s.id === meta.id);
    if (newMeta) {
      newMeta.commandCount = originalEvents.filter(e => e.type === 'shell_command').length;
    }

    this.#dirty = true;

    // Persist the forked copy
    await this.persist();

    return { ...meta, commandCount: newMeta?.commandCount || 0 };
  }

  /**
   * Fork the current session from a specific event index.
   * Creates a new session containing only events [0..eventIndex], including
   * the matching result event if the target is a shell_command.
   * Restores shell state from the most recent state_snapshot at or before that point.
   * @param {number} eventIndex - Index into the events array to fork from
   * @param {string} [newName] - Name for the fork; auto-generated if omitted
   * @returns {Promise<Object>} new session metadata
   */
  async forkFromEvent(eventIndex, newName) {
    if (!this.#activeSessionId) {
      throw new Error('No active session to fork');
    }
    if (eventIndex < 0 || eventIndex >= this.#events.length) {
      throw new Error(`Event index out of range: ${eventIndex}`);
    }

    // Persist current state first
    await this.persist();

    // Determine the end index: if target is a shell_command, include its shell_result
    let endIndex = eventIndex;
    const targetEvent = this.#events[eventIndex];
    if (targetEvent.type === 'shell_command' && eventIndex + 1 < this.#events.length) {
      const next = this.#events[eventIndex + 1];
      if (next.type === 'shell_result') {
        endIndex = eventIndex + 1;
      }
    }

    // Slice events up to endIndex (inclusive)
    const slicedEvents = this.#events.slice(0, endIndex + 1);

    // Find the most recent state_snapshot at or before endIndex
    let snapshot = null;
    for (let i = endIndex; i >= 0; i--) {
      if (slicedEvents[i]?.type === 'state_snapshot') {
        snapshot = slicedEvents[i].data;
        break;
      }
    }

    const originalName = this.activeName || this.#activeSessionId;

    // Create new session (this persists current and resets)
    const meta = await this.create(
      newName || `${originalName} (fork@cmd ${slicedEvents.filter(e => e.type === 'shell_command').length})`
    );

    // Set the sliced events
    this.#events = slicedEvents;

    // Restore shell state from snapshot, or reconstruct from command history
    if (snapshot) {
      this.#applyShellState(snapshot);
    } else if (this.#shell?.state) {
      // Reconstruct history from command events
      this.#shell.state.history = slicedEvents
        .filter(e => e.type === 'shell_command')
        .map(e => e.data?.command)
        .filter(Boolean);
    }

    // Update metadata
    const newMeta = this.#sessions.find(s => s.id === meta.id);
    if (newMeta) {
      newMeta.commandCount = slicedEvents.filter(e => e.type === 'shell_command').length;
    }

    this.#dirty = true;
    await this.persist();

    return { ...meta, commandCount: newMeta?.commandCount || 0 };
  }

  // ── Event Recording ─────────────────────────────────────────

  /**
   * Record a user-issued shell command.
   * @param {string} command
   */
  recordCommand(command) {
    const cwd = this.#shell?.state?.cwd || '/';
    const event = this.#makeEvent('shell_command', { command, cwd }, 'user');
    this.#events.push(event);
    this.#dirty = true;

    // Update metadata
    const meta = this.#sessions.find(s => s.id === this.#activeSessionId);
    if (meta) {
      meta.commandCount = (meta.commandCount || 0) + 1;
      meta.lastUsed = event.timestamp;
    }
  }

  /**
   * Record the result of a shell command.
   * @param {string} stdout
   * @param {string} stderr
   * @param {number} exitCode
   */
  recordResult(stdout, stderr, exitCode) {
    const event = this.#makeEvent('shell_result', {
      stdout: cap(stdout, STDOUT_CAP),
      stderr: cap(stderr, STDERR_CAP),
      exitCode,
    }, 'system');
    this.#events.push(event);
    this.#dirty = true;

    // Update preview in metadata — use first line of stdout or stderr
    const meta = this.#sessions.find(s => s.id === this.#activeSessionId);
    if (meta) {
      const previewSource = stdout || stderr || '';
      const firstLine = previewSource.split('\n')[0] || '';
      meta.preview = firstLine.slice(0, 80);
    }
  }

  /**
   * Record an agent prompt sent to the LLM.
   * @param {string} content
   */
  recordAgentPrompt(content) {
    const event = this.#makeEvent('agent_prompt', { content }, 'user');
    this.#events.push(event);
    this.#dirty = true;
  }

  /**
   * Record an agent response from the LLM.
   * @param {string} content
   */
  recordAgentResponse(content) {
    const event = this.#makeEvent('agent_response', { content }, 'system');
    this.#events.push(event);
    this.#dirty = true;
  }

  /**
   * Record a snapshot of the current shell state.
   */
  recordStateSnapshot() {
    const state = this.#shell?.state;
    if (!state) return;
    const data = {
      cwd: state.cwd,
      env: Object.fromEntries(state.env),
      aliases: Object.fromEntries(state.aliases),
      lastExitCode: state.lastExitCode,
    };
    const event = this.#makeEvent('state_snapshot', data, 'system');
    this.#events.push(event);
    this.#dirty = true;
  }

  // ── Queries ─────────────────────────────────────────────────

  /**
   * List all sessions for this workspace.
   * @returns {Array<Object>} copy of sessions metadata array
   */
  list() {
    return this.#sessions.map(s => ({ ...s }));
  }

  /**
   * Get the active session ID.
   * @returns {string|null}
   */
  get activeId() {
    return this.#activeSessionId;
  }

  /**
   * Get the name of the active session.
   * @returns {string|null}
   */
  get activeName() {
    if (!this.#activeSessionId) return null;
    const meta = this.#sessions.find(s => s.id === this.#activeSessionId);
    return meta?.name || null;
  }

  /**
   * Get the events for the current session.
   * @returns {Array<Object>}
   */
  get events() {
    return this.#events;
  }

  /**
   * Whether the current session has unsaved changes.
   * @returns {boolean}
   */
  get dirty() {
    return this.#dirty;
  }

  // ── Export ───────────────────────────────────────────────────

  /**
   * Export recorded commands as a shell script.
   * @returns {string}
   */
  exportAsScript() {
    const commands = this.#events
      .filter(e => e.type === 'shell_command')
      .map(e => e.data?.command)
      .filter(Boolean);

    const lines = ['#!/bin/sh', ''];
    for (const cmd of commands) {
      lines.push(cmd);
    }
    lines.push('');
    return lines.join('\n');
  }

  /**
   * Export events in the specified format.
   * @param {'text'|'json'|'jsonl'} format
   * @returns {string}
   */
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

  /**
   * Export events as a markdown document with code blocks.
   * @returns {string}
   */
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
          lines.push('```sh');
          lines.push(`$ ${event.data?.command || ''}`);
          lines.push('```');
          lines.push('');
          break;

        case 'shell_result':
          if (event.data?.stdout) {
            lines.push('```');
            lines.push(event.data.stdout);
            lines.push('```');
            lines.push('');
          }
          if (event.data?.stderr) {
            lines.push('**stderr:**');
            lines.push('```');
            lines.push(event.data.stderr);
            lines.push('```');
            lines.push('');
          }
          if (event.data?.exitCode !== undefined && event.data.exitCode !== 0) {
            lines.push(`> Exit code: ${event.data.exitCode}`);
            lines.push('');
          }
          break;

        case 'agent_prompt':
          lines.push('**Agent Prompt:**');
          lines.push('');
          lines.push(event.data?.content || '');
          lines.push('');
          break;

        case 'agent_response':
          lines.push('**Agent Response:**');
          lines.push('');
          lines.push(event.data?.content || '');
          lines.push('');
          break;

        case 'state_snapshot':
          lines.push(`> State snapshot: cwd=\`${event.data?.cwd || '/'}\``);
          lines.push('');
          break;

        default:
          break;
      }
    }

    return lines.join('\n');
  }

  // ── Private ─────────────────────────────────────────────────

  /**
   * Load the session index from localStorage.
   * @returns {Array<Object>}
   */
  #loadIndex() {
    try {
      const raw = localStorage.getItem(`clawser_terminal_sessions_${this.#wsId}`);
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch (_) {
      return [];
    }
  }

  /**
   * Save the session index to localStorage.
   */
  #saveIndex() {
    try {
      localStorage.setItem(
        `clawser_terminal_sessions_${this.#wsId}`,
        JSON.stringify(this.#sessions),
      );
    } catch (err) {
      console.warn('[TerminalSessions] Failed to save index:', err);
    }
  }

  /**
   * Auto-generate a session name like "Terminal 1", "Terminal 2", etc.
   * @returns {string}
   */
  #autoName() {
    const existing = this.#sessions
      .map(s => s.name)
      .filter(n => /^Terminal \d+$/.test(n))
      .map(n => parseInt(n.replace('Terminal ', ''), 10))
      .filter(n => !isNaN(n));

    const next = existing.length > 0 ? Math.max(...existing) + 1 : 1;
    return `Terminal ${next}`;
  }

  /**
   * Create an event object with a timestamp.
   * @param {string} type
   * @param {Object} data
   * @param {string} source — 'user' | 'system'
   * @returns {Object}
   */
  #makeEvent(type, data, source) {
    return {
      type,
      data,
      source,
      timestamp: Date.now(),
    };
  }

  /**
   * Serialize the current shell state into a plain object.
   * @returns {Object}
   */
  #serializeShellState() {
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

  /**
   * Apply a serialized state object back onto the shell's state.
   * @param {Object} stateObj
   */
  #applyShellState(stateObj) {
    if (!this.#shell?.state || !stateObj) return;

    const s = this.#shell.state;
    s.cwd = stateObj.cwd || '/';
    s.env = stateObj.env instanceof Map
      ? stateObj.env
      : new Map(Object.entries(stateObj.env || {}));
    s.aliases = stateObj.aliases instanceof Map
      ? stateObj.aliases
      : new Map(Object.entries(stateObj.aliases || {}));
    s.history = Array.isArray(stateObj.history) ? [...stateObj.history] : [];
    s.lastExitCode = stateObj.lastExitCode ?? 0;
    s.pipefail = stateObj.pipefail ?? true;
  }
}
