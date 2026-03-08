import { TerminalSessionStore } from './clawser-terminal-session-store.js';
import {
  close as closeMsg,
  echoAck as echoAckMsg,
  echoState as echoStateMsg,
  exit as exitMsg,
  sessionData as sessionDataMsg,
  termDiff as termDiffMsg,
  termSync as termSyncMsg,
} from './packages-wsh.js';

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

const DEFAULT_REPLAY_LIMIT = 64 * 1024;
const INTERRUPT_EXIT_CODE = 130;

function encodeInput(data) {
  if (data instanceof Uint8Array) {
    return data;
  }
  return textEncoder.encode(String(data ?? ''));
}

function renderPrompt(cwd = '/') {
  return `${cwd || '/'}$ `;
}

function trimReplay(replay, limit) {
  if (replay.length <= limit) return replay;
  return replay.slice(replay.length - limit);
}

function normalizeTerminalText(text) {
  return String(text ?? '').replace(/\r?\n/g, '\r\n');
}

async function hashReplay(replay) {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) {
    return textEncoder.encode(String(replay.length));
  }
  const digest = await subtle.digest('SHA-256', textEncoder.encode(replay));
  return new Uint8Array(digest);
}

function currentCursorPosition({ cwd = '/', cursor = 0, cols = 80 } = {}) {
  const width = Math.max(cols || 80, 1);
  const absolute = renderPrompt(cwd).length + cursor;
  return {
    cursorX: absolute % width,
    cursorY: Math.floor(absolute / width),
  };
}

export class VirtualTerminalSession {
  #participantKey;
  #channelId;
  #kind;
  #command;
  #cols;
  #rows;
  #shellFactory;
  #sendControl;
  #replayLimit;
  #shell = null;
  #store = null;
  #line = '';
  #cursor = 0;
  #historyIndex = null;
  #historyDraft = '';
  #pendingEscape = '';
  #closed = false;
  #started = false;
  #replay = '';
  #runningToken = 0;
  #activeCommandToken = null;
  #interruptedTokens = new Set();
  #echoSeq = 0;
  #frameSeq = 0;

  onClose = null;

  constructor({
    participantKey,
    channelId,
    kind = 'pty',
    command = '',
    cols = 80,
    rows = 24,
    shellFactory,
    sendControl,
    replayLimit = DEFAULT_REPLAY_LIMIT,
  } = {}) {
    if (!participantKey) throw new Error('participantKey is required');
    if (!Number.isInteger(channelId)) throw new Error('channelId is required');
    if (typeof shellFactory !== 'function') throw new Error('shellFactory is required');
    if (typeof sendControl !== 'function') throw new Error('sendControl is required');

    this.#participantKey = participantKey;
    this.#channelId = channelId;
    this.#kind = kind;
    this.#command = command || '';
    this.#cols = cols;
    this.#rows = rows;
    this.#shellFactory = shellFactory;
    this.#sendControl = sendControl;
    this.#replayLimit = replayLimit;
  }

  get participantKey() {
    return this.#participantKey;
  }

  get channelId() {
    return this.#channelId;
  }

  get kind() {
    return this.#kind;
  }

  get command() {
    return this.#command;
  }

  get cols() {
    return this.#cols;
  }

  get rows() {
    return this.#rows;
  }

  get shell() {
    return this.#shell;
  }

  get replay() {
    return this.#replay;
  }

  get stateSnapshot() {
    return this.#store?.serializeShellState?.() || null;
  }

  get closed() {
    return this.#closed;
  }

  async start() {
    if (this.#started) return;
    this.#started = true;
    this.#shell = await this.#shellFactory();
    this.#store = new TerminalSessionStore({ shell: this.#shell });

    if (this.#kind === 'exec') {
      await this.#runCommand(this.#command, { closeAfter: true });
      return;
    }

    await this.#emitPrompt();
  }

  async write(data) {
    if (this.#closed) return;
    const bytes = encodeInput(data);
    const input = textDecoder.decode(bytes, { stream: true });

    for (const char of input) {
      await this.#handleInputChar(char);
      if (this.#closed) break;
    }

    if (!this.#closed && bytes.byteLength > 0) {
      this.#echoSeq += bytes.byteLength;
      await this.#emitEchoState();
    }
  }

  async resize(cols, rows) {
    if (this.#closed) return;
    this.#cols = cols;
    this.#rows = rows;

    if (!this.#activeCommandToken && this.#kind !== 'exec') {
      await this.#redrawLine();
    }
  }

  async replayToRemote({ cols = this.#cols, rows = this.#rows } = {}) {
    if (this.#closed) return;
    this.#cols = cols;
    this.#rows = rows;

    if (!this.#replay) return;

    const data = textEncoder.encode(this.#replay);
    await this.#sendControl(sessionDataMsg({ channelId: this.#channelId, data }));
    await this.#emitTermFrame(data);
  }

  async signal(signal) {
    if (this.#closed) return;
    if (signal === 'SIGINT') {
      await this.#interrupt();
    }
  }

  async close({ exitCode = 0, notifyRemote = true } = {}) {
    if (this.#closed) return;
    this.#closed = true;
    this.#activeCommandToken = null;

    if (notifyRemote) {
      await this.#sendControl(exitMsg({ channelId: this.#channelId, code: exitCode }));
      await this.#sendControl(closeMsg({ channelId: this.#channelId }));
    }

    try {
      this.onClose?.();
    } finally {
      this.onClose = null;
    }
  }

  async #handleInputChar(char) {
    if (this.#pendingEscape || char === '\x1b') {
      const handled = await this.#handleEscapeInput(char);
      if (handled) return;
    }

    if (this.#activeCommandToken) {
      if (char === '\u0003') {
        await this.#interrupt();
      }
      return;
    }

    switch (char) {
      case '\r':
      case '\n':
        await this.#submitLine();
        break;
      case '\u0003':
        await this.#interrupt();
        break;
      case '\u0004':
        if (!this.#line) {
          await this.close({ exitCode: 0, notifyRemote: true });
        }
        break;
      case '\u007f':
        if (this.#cursor > 0) {
          this.#line = this.#line.slice(0, this.#cursor - 1) + this.#line.slice(this.#cursor);
          this.#cursor -= 1;
          await this.#redrawLine();
        }
        break;
      default:
        if (char >= ' ' || char === '\t') {
          this.#historyIndex = null;
          this.#line = this.#line.slice(0, this.#cursor) + char + this.#line.slice(this.#cursor);
          this.#cursor += char.length;
          await this.#redrawLine();
        }
        break;
    }
  }

  async #handleEscapeInput(char) {
    if (!this.#pendingEscape) {
      if (char !== '\x1b') return false;
      this.#pendingEscape = char;
      return true;
    }

    this.#pendingEscape += char;
    const sequence = this.#pendingEscape;

    if (sequence === '\x1b' || sequence === '\x1b[') {
      return true;
    }

    const complete = [
      '\x1b[A',
      '\x1b[B',
      '\x1b[C',
      '\x1b[D',
      '\x1b[H',
      '\x1b[F',
      '\x1b[3~',
      '\x1b[1~',
      '\x1b[4~',
    ];
    if (!complete.includes(sequence)) {
      if (sequence.length >= 4 && !sequence.endsWith('~') && !/[A-Za-z]$/.test(sequence)) {
        this.#pendingEscape = '';
      }
      return true;
    }

    this.#pendingEscape = '';

    switch (sequence) {
      case '\x1b[A':
        await this.#historyUp();
        break;
      case '\x1b[B':
        await this.#historyDown();
        break;
      case '\x1b[C':
        if (this.#cursor < this.#line.length) {
          this.#cursor += 1;
          await this.#redrawLine();
        }
        break;
      case '\x1b[D':
        if (this.#cursor > 0) {
          this.#cursor -= 1;
          await this.#redrawLine();
        }
        break;
      case '\x1b[H':
      case '\x1b[1~':
        this.#cursor = 0;
        await this.#redrawLine();
        break;
      case '\x1b[F':
      case '\x1b[4~':
        this.#cursor = this.#line.length;
        await this.#redrawLine();
        break;
      case '\x1b[3~':
        if (this.#cursor < this.#line.length) {
          this.#line = this.#line.slice(0, this.#cursor) + this.#line.slice(this.#cursor + 1);
          await this.#redrawLine();
        }
        break;
      default:
        break;
    }

    return true;
  }

  async #historyUp() {
    const history = this.#shell?.state?.history || [];
    if (!history.length) return;

    if (this.#historyIndex === null) {
      this.#historyDraft = this.#line;
      this.#historyIndex = history.length - 1;
    } else if (this.#historyIndex > 0) {
      this.#historyIndex -= 1;
    }

    this.#line = history[this.#historyIndex] || '';
    this.#cursor = this.#line.length;
    await this.#redrawLine();
  }

  async #historyDown() {
    const history = this.#shell?.state?.history || [];
    if (this.#historyIndex === null) return;

    if (this.#historyIndex < history.length - 1) {
      this.#historyIndex += 1;
      this.#line = history[this.#historyIndex] || '';
    } else {
      this.#historyIndex = null;
      this.#line = this.#historyDraft;
    }

    this.#cursor = this.#line.length;
    await this.#redrawLine();
  }

  async #submitLine() {
    const command = this.#line;
    this.#line = '';
    this.#cursor = 0;
    this.#historyIndex = null;
    this.#historyDraft = '';

    await this.#sendText('\r\n');

    if (!command.trim()) {
      await this.#emitPrompt();
      return;
    }

    await this.#runCommand(command, { closeAfter: false });
  }

  async #runCommand(command, { closeAfter = false } = {}) {
    const token = ++this.#runningToken;
    this.#activeCommandToken = token;
    this.#store?.recordCommand(command);

    let result;
    try {
      result = await this.#shell.exec(command);
    } catch (err) {
      result = {
        stdout: '',
        stderr: err?.message || String(err),
        exitCode: 1,
      };
    }

    const wasInterrupted = this.#interruptedTokens.has(token);
    this.#interruptedTokens.delete(token);

    if (this.#closed) return;
    if (this.#activeCommandToken === token) {
      this.#activeCommandToken = null;
    }

    if (wasInterrupted) {
      if (closeAfter) {
        await this.close({ exitCode: INTERRUPT_EXIT_CODE, notifyRemote: true });
      }
      return;
    }

    this.#store?.recordResult(result.stdout, result.stderr, result.exitCode ?? 0);
    this.#store?.recordStateSnapshot();

    if (result.stdout) {
      await this.#sendText(result.stdout);
    }
    if (result.stderr) {
      await this.#sendText(result.stderr);
    }

    if (closeAfter) {
      await this.close({ exitCode: result.exitCode ?? 0, notifyRemote: true });
      return;
    }

    await this.#emitPrompt();
  }

  async #interrupt() {
    if (this.#activeCommandToken !== null) {
      this.#interruptedTokens.add(this.#activeCommandToken);
      this.#activeCommandToken = null;
    }

    this.#line = '';
    this.#cursor = 0;
    this.#historyIndex = null;
    this.#historyDraft = '';

    await this.#sendText('^C\r\n');

    if (!this.#closed && this.#kind !== 'exec') {
      await this.#emitPrompt();
    }
  }

  async #emitPrompt() {
    await this.#sendText(renderPrompt(this.#shell?.state?.cwd));
  }

  async #redrawLine() {
    const prompt = renderPrompt(this.#shell?.state?.cwd);
    const cursorOffset = this.#line.length - this.#cursor;
    let frame = `\r${prompt}${this.#line}\x1b[K`;
    if (cursorOffset > 0) {
      frame += `\x1b[${cursorOffset}D`;
    }
    await this.#sendText(frame);
  }

  async #sendText(text) {
    if (!text) return;
    const normalized = normalizeTerminalText(text);
    const data = textEncoder.encode(normalized);
    this.#replay = trimReplay(this.#replay + normalized, this.#replayLimit);
    await this.#sendControl(sessionDataMsg({
      channelId: this.#channelId,
      data,
    }));
    await this.#emitTermFrame(data);
  }

  async #emitEchoState() {
    const { cursorX, cursorY } = currentCursorPosition({
      cwd: this.#shell?.state?.cwd || '/',
      cursor: this.#cursor,
      cols: this.#cols,
    });

    await this.#sendControl(echoAckMsg({
      channelId: this.#channelId,
      echoSeq: this.#echoSeq,
    }));
    await this.#sendControl(echoStateMsg({
      channelId: this.#channelId,
      echoSeq: this.#echoSeq,
      cursorX,
      cursorY,
      pending: 0,
    }));
  }

  async #emitTermFrame(patch) {
    if (!patch?.byteLength) return;

    const baseSeq = this.#frameSeq;
    this.#frameSeq += 1;

    await this.#sendControl(termDiffMsg({
      channelId: this.#channelId,
      frameSeq: this.#frameSeq,
      baseSeq,
      patch,
    }));
    await this.#sendControl(termSyncMsg({
      channelId: this.#channelId,
      frameSeq: this.#frameSeq,
      stateHash: await hashReplay(this.#replay),
    }));
  }
}
