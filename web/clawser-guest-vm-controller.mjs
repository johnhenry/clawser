/**
 * clawser-guest-vm-controller.mjs — Guest VM (v86 Linux) lifecycle controller
 *
 * Wires the previously-dormant pieces of the v86 guest PoC into a
 * single testable boot/shutdown flow:
 *   - LinuxGuest (clawser-v86-guest.mjs) — the emulator itself
 *   - autoMountGuest (clawser-fs-guest-mount.mjs) — mounts the guest fs
 *     at /mnt/guest whenever the guest is running
 *   - renderGuestFsPanel (clawser-ui-guest-fs.mjs) — file browser UI
 *
 * All dependencies are injected so this module has no direct import of
 * v86 (network/CDN-dependent) or the DOM, making it unit-testable with
 * a fake guest. Production wiring supplies the real implementations.
 *
 * @module clawser-guest-vm-controller
 */

/**
 * @typedef {object} GuestVmControllerCtx
 * @property {() => object} createGuest - () => LinuxGuest instance (not yet booted)
 * @property {(guest: object, mountableFs: object, opts?: object) => (() => void)} autoMountGuest
 * @property {(guest: object|null, container: object) => void} renderPanel
 * @property {object} mountableFs - MountableFs instance to mount the guest fs onto
 * @property {object} container - DOM container for the file browser panel
 */

/**
 * Build the Guest VM controller.
 *
 * @param {GuestVmControllerCtx} ctx
 * @returns {{boot: Function, shutdown: Function, getGuest: () => object|null}}
 */
export function buildGuestVmController(ctx) {
  /** @type {object|null} */
  let guest = null;
  /** @type {(() => void)|null} */
  let unmountAuto = null;

  const rerender = () => ctx.renderPanel(guest, ctx.container);

  return {
    /**
     * Boot a fresh guest, wire auto-mount, and render the file browser.
     * @returns {Promise<{ok: boolean, error?: string, bootMs?: number}>}
     */
    async boot() {
      if (guest && guest.state === 'running') {
        return { ok: false, error: 'A guest is already running' };
      }

      const candidate = ctx.createGuest();
      candidate.onStateChange(() => rerender());

      try {
        const stats = await candidate.boot();
        guest = candidate;
        unmountAuto = ctx.autoMountGuest(guest, ctx.mountableFs);
        rerender();
        return { ok: true, bootMs: stats?.bootMs };
      } catch (e) {
        // Boot failed — don't leave a half-wired guest reference behind,
        // so a retry isn't blocked by the "already running" guard.
        guest = null;
        return { ok: false, error: e.message };
      }
    },

    /**
     * Shut down the running guest, unmount, and render the empty state.
     * @returns {Promise<{ok: boolean, error?: string}>}
     */
    async shutdown() {
      if (!guest) return { ok: false, error: 'No guest is running' };
      try {
        await guest.shutdown();
      } finally {
        unmountAuto?.();
        unmountAuto = null;
        guest = null;
        rerender();
      }
      return { ok: true };
    },

    /** @returns {object|null} The current guest instance, or null */
    getGuest() {
      return guest;
    },
  };
}
