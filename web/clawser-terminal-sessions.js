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
 *   { id, name, created, lastUsed, commandCount, preview, version: 1, workspaceId,
 *     parentId?, branchPoint? }
 *
 * Branch fields (optional — absent on root sessions):
 *   parentId   — the session ID this was branched from
 *   branchPoint — the event sequence number (0-based index) in the parent
 *                 where this branch diverges
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
  async create(name, { parentId, branchPoint } = {}) {
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

    if (parentId) meta.parentId = parentId;
    if (branchPoint != null) meta.branchPoint = branchPoint;

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

    const parentId = this.#activeSessionId;
    const originalEvents = this.#store.cloneEvents();
    const branchPoint = originalEvents.length > 0 ? originalEvents.length - 1 : 0;
    const originalState = this.#store.serializeShellState();

    const meta = await this.create(
      newName || `Fork of ${this.activeName || this.#activeSessionId}`,
      { parentId, branchPoint },
    );

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

    const parentId = this.#activeSessionId;

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
      newName || `${originalName} (fork@cmd ${slicedEvents.filter(e => e.type === 'shell_command').length})`,
      { parentId, branchPoint: eventIndex },
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

  // ── Branching ──────────────────────────────────────────────

  /**
   * Create a new branch from a specific event sequence number in the current
   * session. This is the primary branching API — it copies events up to
   * `fromSeq` (inclusive) into a new session and records the parentage.
   *
   * @param {number} [fromSeq] — 0-based event index to branch from.
   *   Defaults to the last event (i.e. branch from current point).
   * @param {string} [name] — optional name for the new branch session.
   * @returns {Promise<Object>} the new session metadata.
   */
  async branch(fromSeq, name) {
    if (!this.#activeSessionId) throw new Error('No active session to branch');

    const events = this.#store.events;
    if (events.length === 0) throw new Error('Cannot branch an empty session');

    const seq = fromSeq != null ? fromSeq : events.length - 1;
    if (seq < 0 || seq >= events.length) {
      throw new Error(`Event sequence out of range: ${seq} (session has ${events.length} events)`);
    }

    await this.persist();

    const parentId = this.#activeSessionId;
    const parentName = this.activeName || parentId;

    // Determine a clean end index — if branching at a shell_command, include its result
    let endIndex = seq;
    if (events[seq]?.type === 'shell_command' && seq + 1 < events.length) {
      if (events[seq + 1]?.type === 'shell_result') {
        endIndex = seq + 1;
      }
    }

    const slicedEvents = events.slice(0, endIndex + 1);

    // Find closest state snapshot for shell restoration
    let snapshot = null;
    for (let i = endIndex; i >= 0; i--) {
      if (slicedEvents[i]?.type === 'state_snapshot') {
        snapshot = slicedEvents[i].data;
        break;
      }
    }

    const cmdCount = slicedEvents.filter(e => e.type === 'shell_command').length;
    const branchName = name || `${parentName} [branch@${seq}]`;

    const meta = await this.create(branchName, { parentId, branchPoint: seq });

    this.#store.setEvents(slicedEvents, { dirty: true });
    if (snapshot) {
      this.#store.applyShellState(snapshot);
    }

    const newMeta = this.#sessions.find(s => s.id === meta.id);
    if (newMeta) {
      newMeta.commandCount = cmdCount;
    }

    await this.persist();
    return { ...meta, commandCount: cmdCount };
  }

  /**
   * List all sessions that were branched directly from the given session.
   * @param {string} [sessionId] — defaults to the active session.
   * @returns {Array<Object>} array of branch session metadata.
   */
  listBranches(sessionId) {
    const targetId = sessionId || this.#activeSessionId;
    if (!targetId) return [];
    return this.#sessions
      .filter(s => s.parentId === targetId)
      .map(s => ({ ...s }));
  }

  /**
   * Build the full branch tree starting from a root session.
   * Returns a recursive tree structure:
   *   { id, name, created, branchPoint?, children: [...] }
   *
   * @param {string} [rootId] — defaults to the active session's root ancestor.
   * @returns {Object|null} tree node, or null if session not found.
   */
  getBranchTree(rootId) {
    // Find the root — walk up parentId chain if no rootId given
    let startId = rootId || this.#activeSessionId;
    if (!startId) return null;

    if (!rootId) {
      // Walk to root ancestor
      const byId = new Map(this.#sessions.map(s => [s.id, s]));
      let current = byId.get(startId);
      while (current?.parentId && byId.has(current.parentId)) {
        current = byId.get(current.parentId);
      }
      startId = current?.id || startId;
    }

    // Build child lookup
    const childMap = new Map();
    for (const s of this.#sessions) {
      if (s.parentId) {
        if (!childMap.has(s.parentId)) childMap.set(s.parentId, []);
        childMap.get(s.parentId).push(s);
      }
    }

    const buildNode = (session) => {
      const children = (childMap.get(session.id) || [])
        .sort((a, b) => (a.created || 0) - (b.created || 0))
        .map(buildNode);

      const node = {
        id: session.id,
        name: session.name,
        created: session.created,
        commandCount: session.commandCount || 0,
      };
      if (session.branchPoint != null) node.branchPoint = session.branchPoint;
      if (session.parentId) node.parentId = session.parentId;
      if (children.length > 0) node.children = children;
      return node;
    };

    const rootSession = this.#sessions.find(s => s.id === startId);
    if (!rootSession) return null;
    return buildNode(rootSession);
  }

  /**
   * Render the branch tree as an ASCII art string.
   * @param {string} [rootId] — defaults to active session's root ancestor.
   * @returns {string} multi-line ASCII tree.
   */
  renderBranchTree(rootId) {
    const tree = this.getBranchTree(rootId);
    if (!tree) return '(no sessions)';

    const activeId = this.#activeSessionId;
    const lines = [];

    const render = (node, prefix, isLast) => {
      const marker = node.id === activeId ? ' *' : '';
      const bp = node.branchPoint != null ? ` (branched@${node.branchPoint})` : '';
      const connector = lines.length === 0 ? '' : (isLast ? '└── ' : '├── ');
      lines.push(`${prefix}${connector}${node.name}${bp}${marker}`);

      const children = node.children || [];
      const childPrefix = lines.length === 1 ? '' : prefix + (isLast ? '    ' : '│   ');
      children.forEach((child, i) => {
        render(child, childPrefix, i === children.length - 1);
      });
    };

    render(tree, '', true);
    return lines.join('\n');
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
    this.persist().catch(e => console.warn('[clawser] Session persist:', e.message));
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

  /** Return a shallow clone of the current event array (safe for mutation). */
  cloneEvents() { return this.#store.cloneEvents(); }

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
