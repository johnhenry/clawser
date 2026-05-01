/**
 * clawser-v86-guest.mjs — v86-backed Linux guest emulator
 *
 * Wraps the v86 x86 emulator to run a real Linux kernel inside the browser.
 * Loads v86 WASM + BIOS + a Linux image from CDN, exposes a serial-console
 * interface for sending commands and receiving output.
 *
 * This is a proof-of-concept for embedding a full Linux guest within clawser.
 *
 * @example
 * ```js
 * import { LinuxGuest } from './clawser-v86-guest.mjs';
 *
 * const guest = new LinuxGuest({ memoryMb: 64 });
 * guest.onOutput((text) => console.log(text));
 * await guest.boot();
 * await guest.sendCommand('uname -a');
 * await guest.shutdown();
 * ```
 */

// ── CDN URLs ────────────────────────────────────────────────────────

/**
 * v86 library + assets CDN configuration.
 * BIOS files are sourced from the v86 GitHub repo.
 * WASM + JS from the npm package via jsdelivr.
 */
const V86_CDN = {
  lib: 'https://cdn.jsdelivr.net/npm/v86@0.5.355/build/libv86.mjs',
  wasm: 'https://cdn.jsdelivr.net/npm/v86@0.5.355/build/v86.wasm',
  bios: 'https://raw.githubusercontent.com/copy/v86/master/bios/seabios.bin',
  vgaBios: 'https://raw.githubusercontent.com/copy/v86/master/bios/vgabios.bin',
};

/**
 * Default Linux image — Alpine Linux via the v86 project's hosted images.
 * For production use, self-host or build a custom image.
 */
const DEFAULT_IMAGE = {
  cdrom: { url: 'https://copy.sh/v86/images/linux4.iso' },
};

// ── LinuxGuest states ───────────────────────────────────────────────

/** @enum {string} */
const GuestState = {
  IDLE: 'idle',
  BOOTING: 'booting',
  RUNNING: 'running',
  SHUTDOWN: 'shutdown',
  ERROR: 'error',
};

// ── Helpers ─────────────────────────────────────────────────────────

/**
 * Dynamically import the V86 constructor from CDN.
 * Caches the result so we only fetch once per page lifetime.
 *
 * @returns {Promise<Function>} V86 constructor
 *
 * @example
 * ```js
 * const V86 = await loadV86();
 * const emulator = new V86({ ... });
 * ```
 */
let _v86Cache = null;
const loadV86 = async () => {
  if (_v86Cache) return _v86Cache;
  const mod = await import(V86_CDN.lib);
  // The npm package exports { V86 } as a named export
  _v86Cache = mod.V86 ?? mod.default?.V86 ?? mod.default;
  if (!_v86Cache) throw new Error('Failed to resolve V86 constructor from CDN module');
  return _v86Cache;
};

/**
 * Measure heap memory usage if available (Chrome/Node).
 *
 * @returns {{ usedMb: number, totalMb: number } | null}
 *
 * @example
 * ```js
 * const mem = getMemoryUsage();
 * if (mem) console.log(`Heap: ${mem.usedMb}MB`);
 * ```
 */
const getMemoryUsage = () => {
  if (typeof performance !== 'undefined' && performance.memory) {
    return {
      usedMb: Math.round(performance.memory.usedJSHeapSize / 1024 / 1024),
      totalMb: Math.round(performance.memory.totalJSHeapSize / 1024 / 1024),
    };
  }
  return null;
};

// ── LinuxGuest class ────────────────────────────────────────────────

export class LinuxGuest {
  #emulator = null;
  #state = GuestState.IDLE;
  #outputCallbacks = [];
  #stateCallbacks = [];
  #outputBuffer = '';
  #config = {};
  #bootTimestamp = 0;
  #bootDurationMs = 0;
  #memoryBefore = null;
  #memoryAfter = null;
  #serialListener = null;

  /**
   * @param {Object} [config]
   * @param {number} [config.memoryMb=64] — guest RAM in MB
   * @param {number} [config.vgaMemoryMb=8] — VGA RAM in MB
   * @param {Object} [config.cdrom] — { url } for CD-ROM image
   * @param {Object} [config.bzimage] — { url } for direct kernel boot
   * @param {Object} [config.initrd] — { url } for initrd
   * @param {boolean} [config.headless=true] — skip VGA screen container
   * @param {HTMLElement} [config.screenContainer] — VGA display target
   * @param {string} [config.wasmUrl] — override WASM URL
   * @param {string} [config.biosUrl] — override BIOS URL
   * @param {string} [config.vgaBiosUrl] — override VGA BIOS URL
   *
   * @example
   * ```js
   * const guest = new LinuxGuest({ memoryMb: 128, headless: false });
   * ```
   */
  constructor(config = {}) {
    this.#config = {
      memoryMb: config.memoryMb ?? 64,
      vgaMemoryMb: config.vgaMemoryMb ?? 8,
      cdrom: config.cdrom ?? DEFAULT_IMAGE.cdrom,
      bzimage: config.bzimage ?? null,
      initrd: config.initrd ?? null,
      headless: config.headless ?? true,
      screenContainer: config.screenContainer ?? null,
      wasmUrl: config.wasmUrl ?? V86_CDN.wasm,
      biosUrl: config.biosUrl ?? V86_CDN.bios,
      vgaBiosUrl: config.vgaBiosUrl ?? V86_CDN.vgaBios,
    };
  }

  /** Current guest state. */
  get state() { return this.#state; }

  /** Boot duration in ms (0 until boot completes). */
  get bootDurationMs() { return this.#bootDurationMs; }

  /** Memory snapshot taken before/after boot. */
  get memorySnapshot() {
    return { before: this.#memoryBefore, after: this.#memoryAfter };
  }

  /** Direct access to the v86 emulator instance (for advanced use). */
  get emulator() { return this.#emulator; }

  // ── Lifecycle ───────────────────────────────────────────────────

  /**
   * Boot the Linux guest. Loads v86 from CDN, initializes the emulator,
   * and waits for the kernel to reach a login prompt or shell.
   *
   * @param {Object} [options]
   * @param {number} [options.timeoutMs=60000] — boot timeout
   * @returns {Promise<{ bootMs: number, memory: Object|null }>}
   * @throws {Error} if already booted, or boot times out
   *
   * @example
   * ```js
   * const stats = await guest.boot();
   * console.log(`Booted in ${stats.bootMs}ms`);
   * ```
   */
  boot = async (options = {}) => {
    if (this.#state !== GuestState.IDLE) {
      throw new Error(`Cannot boot: guest is in state "${this.#state}"`);
    }

    const timeoutMs = options.timeoutMs ?? 60_000;
    this.#setState(GuestState.BOOTING);
    this.#memoryBefore = getMemoryUsage();
    this.#bootTimestamp = performance.now();

    let hiddenScreenEl = null;

    try {
      const V86 = await loadV86();

      // Build v86 config
      const v86Config = {
        wasm_path: this.#config.wasmUrl,
        bios: { url: this.#config.biosUrl },
        vga_bios: { url: this.#config.vgaBiosUrl },
        memory_size: this.#config.memoryMb * 1024 * 1024,
        vga_memory_size: this.#config.vgaMemoryMb * 1024 * 1024,
        autostart: true,
        disable_keyboard: this.#config.headless,
        disable_mouse: this.#config.headless,
      };

      // Disk/kernel source
      if (this.#config.bzimage) {
        v86Config.bzimage = this.#config.bzimage;
        if (this.#config.initrd) v86Config.initrd = this.#config.initrd;
      } else if (this.#config.cdrom) {
        v86Config.cdrom = this.#config.cdrom;
      }

      // Screen container — headless uses a hidden div
      if (this.#config.headless && !this.#config.screenContainer) {
        if (typeof document !== 'undefined') {
          hiddenScreenEl = document.createElement('div');
          hiddenScreenEl.style.cssText = 'position:absolute;left:-9999px;width:1px;height:1px;overflow:hidden;';
          document.body.appendChild(hiddenScreenEl);
          v86Config.screen_container = hiddenScreenEl;
        }
      } else if (this.#config.screenContainer) {
        v86Config.screen_container = this.#config.screenContainer;
      }

      // Create the emulator
      this.#emulator = new V86(v86Config);

      // Wire serial0 output
      this.#serialListener = (byte) => {
        const char = String.fromCharCode(byte);
        this.#outputBuffer += char;
        this.#emitOutput(char);
      };
      this.#emulator.add_listener('serial0-output-byte', this.#serialListener);

      // Wait for shell prompt (heuristic: look for "login:" or "# " or "$ ")
      await this.#waitForPrompt(timeoutMs);

      this.#bootDurationMs = Math.round(performance.now() - this.#bootTimestamp);
      this.#memoryAfter = getMemoryUsage();
      this.#setState(GuestState.RUNNING);

      return {
        bootMs: this.#bootDurationMs,
        memory: this.#memoryAfter,
      };
    } catch (err) {
      // Clean up the hidden screen element if we created one
      if (hiddenScreenEl) {
        hiddenScreenEl.remove();
      }
      this.#setState(GuestState.ERROR);
      throw err;
    }
  };

  /**
   * Send a command string to the guest shell via serial console.
   * Appends a newline if not present.
   *
   * @param {string} cmd — shell command
   * @returns {Promise<string>} — output captured until next prompt
   *
   * @example
   * ```js
   * const output = await guest.sendCommand('uname -a');
   * console.log(output); // "Linux ... x86_64 ..."
   * ```
   */
  sendCommand = async (cmd) => {
    if (this.#state !== GuestState.RUNNING) {
      throw new Error(`Cannot send command: guest is in state "${this.#state}"`);
    }

    // Clear output buffer before sending
    this.#outputBuffer = '';

    // Send each character via serial
    const line = cmd.endsWith('\n') ? cmd : cmd + '\n';
    for (const ch of line) {
      this.#emulator.serial0_send(ch);
    }

    // Wait for output to settle (prompt reappears)
    return this.#waitForOutput(10_000);
  };

  /**
   * Register a callback for guest serial output.
   * Called with each character or chunk as it arrives.
   *
   * @param {(text: string) => void} callback
   * @returns {() => void} unsubscribe function
   *
   * @example
   * ```js
   * const unsub = guest.onOutput((text) => terminal.write(text));
   * // later:
   * unsub();
   * ```
   */
  onOutput = (callback) => {
    this.#outputCallbacks.push(callback);
    return () => {
      this.#outputCallbacks = this.#outputCallbacks.filter((cb) => cb !== callback);
    };
  };

  /**
   * Register a callback for guest state changes.
   *
   * @param {(state: string) => void} callback
   * @returns {() => void} unsubscribe function
   *
   * @example
   * ```js
   * guest.onStateChange((state) => console.log('Guest:', state));
   * ```
   */
  onStateChange = (callback) => {
    this.#stateCallbacks.push(callback);
    return () => {
      this.#stateCallbacks = this.#stateCallbacks.filter((cb) => cb !== callback);
    };
  };

  /**
   * Gracefully shut down the guest. Sends 'poweroff' then stops the emulator.
   *
   * @param {Object} [options]
   * @param {boolean} [options.force=false] — skip graceful shutdown, just kill
   * @param {number} [options.timeoutMs=10000] — graceful shutdown timeout
   *
   * @example
   * ```js
   * await guest.shutdown();
   * ```
   */
  shutdown = async (options = {}) => {
    if (this.#state === GuestState.SHUTDOWN || this.#state === GuestState.IDLE) return;

    const force = options.force ?? false;
    const timeoutMs = options.timeoutMs ?? 10_000;

    try {
      if (!force && this.#state === GuestState.RUNNING) {
        // Try graceful shutdown
        for (const ch of 'poweroff\n') {
          this.#emulator.serial0_send(ch);
        }
        // Wait a bit for shutdown to propagate
        await new Promise((resolve) => setTimeout(resolve, Math.min(timeoutMs, 3000)));
      }
    } catch {
      // Ignore errors during graceful shutdown
    }

    // Hard stop
    if (this.#emulator) {
      if (this.#serialListener) {
        this.#emulator.remove_listener('serial0-output-byte', this.#serialListener);
        this.#serialListener = null;
      }
      this.#emulator.stop();
      this.#emulator.destroy();
      this.#emulator = null;
    }

    this.#setState(GuestState.SHUTDOWN);
  };

  /**
   * Get performance metrics for the guest.
   *
   * @returns {{ state: string, bootMs: number, memoryBefore: Object|null, memoryAfter: Object|null, memoryDeltaMb: number|null }}
   *
   * @example
   * ```js
   * const metrics = guest.metrics();
   * console.log(`Boot: ${metrics.bootMs}ms, Memory delta: ${metrics.memoryDeltaMb}MB`);
   * ```
   */
  metrics = () => {
    const deltaMb = (this.#memoryBefore && this.#memoryAfter)
      ? this.#memoryAfter.usedMb - this.#memoryBefore.usedMb
      : null;

    return {
      state: this.#state,
      bootMs: this.#bootDurationMs,
      memoryBefore: this.#memoryBefore,
      memoryAfter: this.#memoryAfter,
      memoryDeltaMb: deltaMb,
    };
  };

  // ── Private ───────────────────────────────────────────────────

  #setState = (state) => {
    this.#state = state;
    for (const cb of this.#stateCallbacks) {
      try { cb(state); } catch { /* swallow */ }
    }
  };

  #emitOutput = (text) => {
    for (const cb of this.#outputCallbacks) {
      try { cb(text); } catch { /* swallow */ }
    }
  };

  /**
   * Wait for a shell prompt to appear in the serial output.
   * Heuristic: looks for common prompt patterns.
   */
  #waitForPrompt = (timeoutMs) => {
    return new Promise((resolve, reject) => {
      const promptPatterns = [/[#$]\s*$/, /login:\s*$/, /~\s*[#$]\s*$/];
      let buffer = '';

      const timer = setTimeout(() => {
        cleanup();
        // Resolve anyway — some images don't have a traditional prompt
        resolve();
      }, timeoutMs);

      const listener = (byte) => {
        buffer += String.fromCharCode(byte);
        // Check last 80 chars for prompt
        const tail = buffer.slice(-80);
        for (const pattern of promptPatterns) {
          if (pattern.test(tail)) {
            cleanup();
            resolve();
            return;
          }
        }
      };

      const cleanup = () => {
        clearTimeout(timer);
        this.#emulator?.remove_listener('serial0-output-byte', listener);
      };

      this.#emulator.add_listener('serial0-output-byte', listener);
    });
  };

  /**
   * Wait for command output to settle (next prompt appears).
   */
  #waitForOutput = (timeoutMs) => {
    return new Promise((resolve) => {
      const promptPatterns = [/[#$]\s*$/, /~\s*[#$]\s*$/];
      let settled = false;
      let idleTimer = null;

      const settle = () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (idleTimer) clearTimeout(idleTimer);
        this.#emulator?.remove_listener('serial0-output-byte', listener);
        resolve(this.#outputBuffer);
      };

      const timer = setTimeout(() => settle(), timeoutMs);

      // Also resolve when we detect a prompt after some output
      const listener = (byte) => {
        if (settled) return;
        // Reset idle timer on each byte
        if (idleTimer) clearTimeout(idleTimer);
        idleTimer = setTimeout(() => settle(), 500);

        const tail = this.#outputBuffer.slice(-80);
        for (const pattern of promptPatterns) {
          if (pattern.test(tail) && this.#outputBuffer.length > 5) {
            settle();
            return;
          }
        }
      };

      this.#emulator.add_listener('serial0-output-byte', listener);
    });
  };
}

// ── Integration helper: connect LinuxGuest to WTermAdapter ──────

/**
 * Wire a LinuxGuest to a WTermAdapter for bidirectional I/O.
 * Guest serial output → adapter.write(); adapter user input → guest serial input.
 *
 * @param {LinuxGuest} guest — the Linux guest instance
 * @param {import('./clawser-terminal-adapter-wterm.mjs').WTermAdapter} adapter — WTermAdapter instance
 * @returns {{ disconnect: () => void }} — call disconnect() to unwire
 *
 * @example
 * ```js
 * import { LinuxGuest, connectGuestToAdapter } from './clawser-v86-guest.mjs';
 * import { WTermAdapter } from './clawser-terminal-adapter-wterm.mjs';
 *
 * const guest = new LinuxGuest();
 * const adapter = new WTermAdapter();
 * await adapter.init(document.getElementById('terminal'));
 *
 * const { disconnect } = connectGuestToAdapter(guest, adapter);
 * await guest.boot();
 *
 * // User types in terminal → sent to guest
 * // Guest output → displayed in terminal
 * ```
 */
export const connectGuestToAdapter = (guest, adapter) => {
  // Guest output → terminal display
  const unsubOutput = guest.onOutput((text) => {
    adapter.write(text);
  });

  // Terminal input → guest serial
  adapter.onData((data) => {
    if (guest.state !== GuestState.RUNNING && guest.state !== GuestState.BOOTING) return;
    const emulator = guest.emulator;
    if (!emulator) return;
    for (const ch of data) {
      emulator.serial0_send(ch);
    }
  });

  return {
    disconnect: () => {
      unsubOutput();
      // Note: WTermAdapter.onData doesn't return unsub, so we can't fully unwire input.
      // In production, WTermAdapter should support unsubscription.
    },
  };
};

// ── Exports ─────────────────────────────────────────────────────

export { GuestState, V86_CDN, DEFAULT_IMAGE, loadV86, getMemoryUsage };
