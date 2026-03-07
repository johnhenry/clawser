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

import {
  TerminalSessionStore,
  parseTerminalSessionEvents,
  serializeTerminalSessionEvents,
} from './clawser-terminal-session-store.js';

// ── Helpers ─────────────────────────────────────────────────────

/**
 * Generate a unique terminal session ID.
 * @returns {string}
 */
export function createTerminalSessionId() {
  return 'term_' + Date.now().toString(36) + '_' + crypto.randomUUID().slice(0, 4);
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
  /** @type {TerminalSessionStore} */
  #store;

  /**
   * @param {Object} opts
   * @param {string} opts.wsId — workspace ID
   * @param {Object} opts.shell — current ClawserShell instance
   */
  constructor({ wsId, shell }) {
    this.#wsId = wsId;
    this.#activeSessionId = null;
    this.#sessions = [];
    this.#store = new TerminalSessionStore({ shell });
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
    this.#store.setShell(shell);
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

    this.#store.resetShellState();
    this.#store.clear();
    this.#activeSessionId = id;
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
      const eventsContent = serializeTerminalSessionEvents(this.#store.events);
      await atomicWrite(dir, 'events.jsonl', eventsContent);

      // Write shell state snapshot
      const stateSnapshot = this.#store.serializeShellState();
      await atomicWrite(dir, 'state.json', JSON.stringify(stateSnapshot));

      this.#store.markClean();
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
        this.#store.applyShellState(JSON.parse(stateRaw));
      } catch (_) { /* bad JSON */ }
    } else {
      this.#store.resetShellState();
    }

    // Restore events
    const eventsRaw = await readText(dir, 'events.jsonl');
    const events = parseTerminalSessionEvents(eventsRaw);
    this.#store.setEvents(events);

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
      this.#store.clear();
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

    const originalEvents = this.#store.cloneEvents();
    const originalState = this.#store.serializeShellState();

    const meta = await this.create(newName || `Fork of ${this.activeName || this.#activeSessionId}`);

    this.#store.setEvents(originalEvents, { dirty: true });
    this.#store.applyShellState(originalState);

    const newMeta = this.#sessions.find(s => s.id === meta.id);
    if (newMeta) {
      newMeta.commandCount = originalEvents.filter(e => e.type === 'shell_command').length;
    }

    await this.persist();

    return { ...meta, commandCount: newMeta?.commandCount || 0 };
  }

  /**
   * Fork from a specific event index.
   */
  async forkFromEvent(eventIndex, newName) {
    if (!this.#activeSessionId) throw new Error('No active session to fork');
    if (eventIndex < 0 || eventIndex >= this.#store.events.length) {
      throw new Error(`Event index out of range: ${eventIndex}`);
    }

    await this.persist();

    let endIndex = eventIndex;
    const targetEvent = this.#store.events[eventIndex];
    if (targetEvent.type === 'shell_command' && eventIndex + 1 < this.#store.events.length) {
      if (this.#store.events[eventIndex + 1].type === 'shell_result') {
        endIndex = eventIndex + 1;
      }
    }

    const slicedEvents = this.#store.events.slice(0, endIndex + 1);

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

    this.#store.setEvents(slicedEvents, { dirty: true });

    if (snapshot) {
      this.#store.applyShellState(snapshot);
    }

    const newMeta = this.#sessions.find(s => s.id === meta.id);
    if (newMeta) {
      newMeta.commandCount = slicedEvents.filter(e => e.type === 'shell_command').length;
    }

    await this.persist();

    return { ...meta, commandCount: newMeta?.commandCount || 0 };
  }

  // ── Event Recording ─────────────────────────────────────────

  recordCommand(command) {
    const event = this.#store.recordCommand(command);

    const meta = this.#sessions.find(s => s.id === this.#activeSessionId);
    if (meta) {
      meta.commandCount = (meta.commandCount || 0) + 1;
      meta.lastUsed = event.timestamp;
    }
  }

  recordResult(stdout, stderr, exitCode) {
    this.#store.recordResult(stdout, stderr, exitCode);

    const meta = this.#sessions.find(s => s.id === this.#activeSessionId);
    if (meta) {
      const previewSource = stdout || stderr || '';
      meta.preview = (previewSource.split('\n')[0] || '').slice(0, 80);
    }

    // Auto-persist after each result so sessions survive page refresh
    this.persist().catch(() => {});
  }

  recordAgentPrompt(content) {
    this.#store.recordAgentPrompt(content);
  }

  recordAgentResponse(content) {
    this.#store.recordAgentResponse(content);
  }

  recordStateSnapshot() {
    this.#store.recordStateSnapshot();
  }

  // ── Queries ─────────────────────────────────────────────────

  list() { return this.#sessions.map(s => ({ ...s })); }
  get activeId() { return this.#activeSessionId; }
  get activeName() {
    if (!this.#activeSessionId) return null;
    return this.#sessions.find(s => s.id === this.#activeSessionId)?.name || null;
  }
  get events() { return this.#store.events; }
  get dirty() { return this.#store.dirty; }

  // ── Export ───────────────────────────────────────────────────

  exportAsScript() {
    return this.#store.exportAsScript();
  }

  exportAsLog(format) {
    return this.#store.exportAsLog(format);
  }

  exportAsMarkdown() {
    const meta = this.#sessions.find(s => s.id === this.#activeSessionId);
    return this.#store.exportAsMarkdown(meta || {
      id: this.#activeSessionId || 'terminal-session',
    });
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
}
