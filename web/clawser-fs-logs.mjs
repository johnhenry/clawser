/**
 * clawser-fs-logs.mjs — Rotating log writer for /var/log/clawser/ files
 *
 * Implements the log rotation policy from the Unix FS design (§2.5):
 *  - Max file size: 5 MB per log file (configurable)
 *  - On rotation: current file becomes `.1`, older rotations shift up
 *  - Keeps at most 3 rotated files (`.1`, `.2`, `.3`)
 *  - Rotation check runs on every 100th append or on init()
 *
 * OPFS has no atomic rename, so rotation shifts files via read+write copy.
 * Appends are buffered in memory and flushed in batches to avoid O(n²)
 * read-concat-write cycles on every line.
 *
 * @module clawser-fs-logs
 *
 * @example
 *   const writer = new RotatingLogWriter(shell.fs, '/var/log/clawser/events.jsonl');
 *   await writer.init();
 *   writer.append(JSON.stringify({ ts: 1714435200000, type: 'tool_call' }));
 *   // ... on workspace teardown:
 *   await writer.close();
 */

export class RotatingLogWriter {
  #fs;
  #path;
  #maxBytes;
  #maxRotations;
  #checkEvery;
  #flushLines;
  #flushMs;

  /** @type {string[]} */
  #buffer = [];
  #appendsSinceCheck = 0;
  /** @type {ReturnType<typeof setTimeout>|null} */
  #flushTimer = null;
  /** @type {Promise<void>|null} */
  #flushPromise = null;
  #closed = false;

  /**
   * @param {object} fs - ShellFs-compatible object with readFile/writeFile
   * @param {string} path - Virtual log file path (e.g. '/var/log/clawser/events.jsonl')
   * @param {object} [opts]
   * @param {number} [opts.maxBytes=5242880] - Rotate when the file exceeds this size
   * @param {number} [opts.maxRotations=3] - Number of rotated files to keep
   * @param {number} [opts.checkEvery=100] - Appends between rotation checks
   * @param {number} [opts.flushLines=20] - Buffered lines that trigger a flush
   * @param {number} [opts.flushMs=2000] - Max time a buffered line waits before flush
   */
  constructor(fs, path, {
    maxBytes = 5 * 1024 * 1024,
    maxRotations = 3,
    checkEvery = 100,
    flushLines = 20,
    flushMs = 2000,
  } = {}) {
    this.#fs = fs;
    this.#path = path;
    this.#maxBytes = maxBytes;
    this.#maxRotations = maxRotations;
    this.#checkEvery = checkEvery;
    this.#flushLines = flushLines;
    this.#flushMs = flushMs;
  }

  /** Run the rotation check against any pre-existing file. Call on workspace init. */
  async init() {
    await this.#checkRotation();
  }

  /**
   * Queue a log line. Flushes when the buffer fills; otherwise a timer
   * flushes within flushMs.
   * @param {string} line - One log line (no trailing newline)
   */
  append(line) {
    if (this.#closed) return;
    this.#buffer.push(line);
    this.#appendsSinceCheck++;
    if (this.#buffer.length >= this.#flushLines) {
      void this.flush();
    } else if (!this.#flushTimer) {
      this.#flushTimer = setTimeout(() => { void this.flush(); }, this.#flushMs);
    }
  }

  /**
   * Write all buffered lines to the file, then run a rotation check if due.
   * Concurrent calls share the in-flight write.
   * @returns {Promise<void>}
   */
  flush() {
    if (this.#flushTimer) {
      clearTimeout(this.#flushTimer);
      this.#flushTimer = null;
    }
    if (!this.#flushPromise) {
      if (this.#buffer.length === 0) return Promise.resolve();
      this.#flushPromise = this.#doFlush().finally(() => { this.#flushPromise = null; });
    }
    return this.#flushPromise;
  }

  async #doFlush() {
    const lines = this.#buffer.splice(0);
    let existing = '';
    try {
      existing = await this.#fs.readFile(this.#path);
    } catch { /* first write — file doesn't exist yet */ }
    const prefix = existing && !existing.endsWith('\n') ? existing + '\n' : existing;
    await this.#fs.writeFile(this.#path, prefix + lines.join('\n') + '\n');

    if (this.#appendsSinceCheck >= this.#checkEvery) {
      this.#appendsSinceCheck = 0;
      await this.#checkRotation();
    }
  }

  /** Flush remaining lines and stop the timer. Call on workspace teardown. */
  async close() {
    while (this.#buffer.length > 0 || this.#flushPromise) {
      await this.flush();
    }
    if (this.#flushTimer) {
      clearTimeout(this.#flushTimer);
      this.#flushTimer = null;
    }
    this.#closed = true;
  }

  /** Rotate if the current file exceeds maxBytes. */
  async #checkRotation() {
    let content;
    try {
      content = await this.#fs.readFile(this.#path);
    } catch {
      return; // no file yet — nothing to rotate
    }
    const size = new TextEncoder().encode(content).byteLength;
    if (size <= this.#maxBytes) return;
    await this.#rotate(content);
  }

  /**
   * Shift rotations up (`.2`→`.3`, `.1`→`.2`), move the current file to
   * `.1`, and truncate the current file.
   * @param {string} currentContent - Content of the current log file
   */
  async #rotate(currentContent) {
    for (let i = this.#maxRotations - 1; i >= 1; i--) {
      try {
        const older = await this.#fs.readFile(`${this.#path}.${i}`);
        await this.#fs.writeFile(`${this.#path}.${i + 1}`, older);
      } catch { /* rotation slot empty — skip */ }
    }
    await this.#fs.writeFile(`${this.#path}.1`, currentContent);
    await this.#fs.writeFile(this.#path, '');
  }
}
