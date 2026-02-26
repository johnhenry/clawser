/**
 * WshSession — manages a single PTY or exec channel over a wsh transport.
 *
 * Each session owns a pair of data streams (stdin/stdout) and receives
 * control messages (EXIT, CLOSE, RESIZE) dispatched by the parent WshClient.
 * Data flows as raw bytes on the transport's bidirectional streams, with no
 * CBOR framing overhead.
 */

import {
  MSG, resize as resizeMsg, signal as signalMsg, close as closeMsg,
} from './messages.mjs';

// ── Session states ────────────────────────────────────────────────────

const STATE_OPENING = 'opening';
const STATE_ACTIVE  = 'active';
const STATE_CLOSED  = 'closed';

// ── Text encoding ─────────────────────────────────────────────────────

const textEncoder = new TextEncoder();

// ── Session class ─────────────────────────────────────────────────────

export class WshSession {
  /** @type {string} Unique session identifier (typically matches channelId). */
  id;

  /** @type {'pty'|'exec'} Channel kind. */
  kind;

  /** @type {number} Channel identifier assigned by the server. */
  channelId;

  /** @type {'opening'|'active'|'closed'} Current session state. */
  #state = STATE_OPENING;

  /** @type {import('./transport.mjs').WshTransport} Transport reference. */
  #transport;

  /**
   * Stream IDs returned by the server in OPEN_OK.
   * Typically { stdin: number, stdout: number } or a single bidirectional ID.
   * @type {object}
   */
  #streamIds;

  /**
   * The writable side of the stdin data stream.
   * @type {WritableStreamDefaultWriter|null}
   */
  #stdinWriter = null;

  /**
   * The readable side of the stdout data stream.
   * @type {ReadableStream<Uint8Array>|null}
   */
  #stdoutReadable = null;

  /** @type {AbortController} Cancels the background data pump. */
  #abort = new AbortController();

  /** @type {Promise<void>|null} Resolves when the data pump finishes. */
  #pumpDone = null;

  /** @type {number|null} Exit code received from the server. */
  #exitCode = null;

  // ── Callbacks ───────────────────────────────────────────────────────

  /**
   * Called when stdout/stderr data arrives.
   * @type {function(Uint8Array): void|null}
   */
  onData = null;

  /**
   * Called when the remote process exits.
   * @type {function(number): void|null}
   */
  onExit = null;

  /**
   * Called when the session is fully closed.
   * @type {function(): void|null}
   */
  onClose = null;

  // ── Constructor ─────────────────────────────────────────────────────

  /**
   * @param {import('./transport.mjs').WshTransport} transport
   * @param {number} channelId
   * @param {object} streamIds - Stream identifiers from OPEN_OK.
   * @param {'pty'|'exec'} kind
   */
  constructor(transport, channelId, streamIds, kind) {
    this.#transport = transport;
    this.channelId = channelId;
    this.#streamIds = streamIds;
    this.kind = kind;
    this.id = String(channelId);
  }

  /** Current session state. */
  get state() {
    return this.#state;
  }

  /** Exit code, if the process has exited. */
  get exitCode() {
    return this.#exitCode;
  }

  // ── Stream binding ──────────────────────────────────────────────────

  /**
   * Bind the raw data streams to this session and start the read pump.
   * Called by WshClient after stream setup.
   *
   * @param {ReadableStream<Uint8Array>} readable - stdout/stderr bytes from server
   * @param {WritableStream<Uint8Array>} writable - stdin bytes to server
   */
  _bind(readable, writable) {
    if (this.#state === STATE_CLOSED) {
      throw new Error('Cannot bind streams to a closed session');
    }
    this.#stdoutReadable = readable;
    this.#stdinWriter = writable.getWriter();
    this.#state = STATE_ACTIVE;
    this.#pumpDone = this._pumpDataStream();
  }

  // ── Public API ──────────────────────────────────────────────────────

  /**
   * Write data to the session's stdin stream.
   * Accepts a Uint8Array for raw bytes or a string (UTF-8 encoded).
   *
   * @param {Uint8Array|string} data
   */
  async write(data) {
    if (this.#state === STATE_CLOSED) {
      throw new Error('Cannot write to a closed session');
    }
    if (this.#stdinWriter === null) {
      throw new Error('Session not yet bound — stdin writer unavailable');
    }

    const bytes = typeof data === 'string' ? textEncoder.encode(data) : data;
    await this.#stdinWriter.write(bytes);
  }

  /**
   * Request the remote PTY to resize.
   *
   * @param {number} cols - Terminal columns
   * @param {number} rows - Terminal rows
   */
  async resize(cols, rows) {
    this.#assertNotClosed('resize');
    await this.#transport.sendControl(
      resizeMsg({ channelId: this.channelId, cols, rows })
    );
  }

  /**
   * Send a signal to the remote process (e.g. 'SIGINT', 'SIGTERM').
   *
   * @param {string} sig - Signal name
   */
  async signal(sig) {
    this.#assertNotClosed('signal');
    await this.#transport.sendControl(
      signalMsg({ channelId: this.channelId, signal: sig })
    );
  }

  /**
   * Close this session. Sends a CLOSE control message and tears down
   * the data streams. Safe to call multiple times.
   */
  async close() {
    if (this.#state === STATE_CLOSED) return;

    // Optimistically mark closed so no further writes are accepted.
    this.#state = STATE_CLOSED;
    this.#abort.abort();

    // Send CLOSE to the server (best-effort).
    try {
      await this.#transport.sendControl(
        closeMsg({ channelId: this.channelId })
      );
    } catch {
      // Transport may already be closed; ignore.
    }

    // Release the stdin writer.
    try {
      await this.#stdinWriter?.close();
    } catch {
      // May already be closed or errored.
    }

    // Wait for the data pump to finish.
    if (this.#pumpDone) {
      await this.#pumpDone.catch(() => {});
    }

    this.#stdinWriter = null;
    this.#stdoutReadable = null;
    this.#emitClose();
  }

  // ── Control message dispatch ────────────────────────────────────────

  /**
   * Handle a control message dispatched by WshClient for this channel.
   * @param {object} msg - Decoded CBOR control message
   * @internal
   */
  _handleControlMessage(msg) {
    switch (msg.type) {
      case MSG.EXIT: {
        this.#exitCode = msg.code ?? -1;
        try {
          this.onExit?.(this.#exitCode);
        } catch (err) {
          console.error('[wsh:session] onExit handler error:', err);
        }
        break;
      }

      case MSG.CLOSE: {
        // Server-initiated close.
        if (this.#state !== STATE_CLOSED) {
          this.#state = STATE_CLOSED;
          this.#abort.abort();
          this.#releaseStreams();
          this.#emitClose();
        }
        break;
      }

      case MSG.RESIZE: {
        // Server acknowledgment of resize; currently a no-op on the client.
        break;
      }

      default:
        // Unknown control message for this channel — ignore gracefully.
        break;
    }
  }

  // ── Data stream pump ────────────────────────────────────────────────

  /**
   * Continuously read from the stdout data stream and invoke onData.
   * Runs until the stream ends, errors, or the session is aborted.
   * @private
   */
  async _pumpDataStream() {
    if (!this.#stdoutReadable) return;

    const reader = this.#stdoutReadable.getReader();
    try {
      while (true) {
        if (this.#abort.signal.aborted) break;

        const { done, value } = await reader.read();
        if (done) break;

        if (value && value.byteLength > 0) {
          try {
            this.onData?.(value);
          } catch (err) {
            console.error('[wsh:session] onData handler error:', err);
          }
        }
      }
    } catch (err) {
      // Only report errors if we haven't been intentionally aborted.
      if (!this.#abort.signal.aborted) {
        console.error('[wsh:session] data stream read error:', err);
      }
    } finally {
      reader.releaseLock();
    }

    // If the data stream ended but we haven't received a CLOSE message,
    // transition to closed state.
    if (this.#state !== STATE_CLOSED) {
      this.#state = STATE_CLOSED;
      this.#releaseStreams();
      this.#emitClose();
    }
  }

  // ── Private helpers ─────────────────────────────────────────────────

  /**
   * Release stream resources without sending a CLOSE message.
   * @private
   */
  #releaseStreams() {
    try {
      this.#stdinWriter?.close();
    } catch {
      // Ignore.
    }
    this.#stdinWriter = null;
    this.#stdoutReadable = null;
  }

  /**
   * Emit the onClose callback exactly once.
   * @private
   */
  #emitClose() {
    try {
      this.onClose?.();
    } catch (err) {
      console.error('[wsh:session] onClose handler error:', err);
    }
    // Clear callbacks to prevent repeat invocations.
    this.onClose = null;
  }

  /**
   * Throw if the session is closed.
   * @param {string} action - Description of the attempted action.
   * @private
   */
  #assertNotClosed(action) {
    if (this.#state === STATE_CLOSED) {
      throw new Error(`Cannot ${action}: session is closed`);
    }
  }
}
