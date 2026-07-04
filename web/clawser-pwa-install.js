import { silentCatch } from './clawser-silent-catch.mjs'
/**
 * clawser-pwa-install.js — PWA install flow.
 *
 * Listens for `beforeinstallprompt`, stores the deferred prompt, and exposes
 * a `tryInstall()` function plus a state observer so the UI can show an
 * "Install Clawser" button only when an install is actually offerable.
 *
 * On iOS Safari (which has no `beforeinstallprompt`), the module reports
 * `isInstallable: false` but `isStandalone()` correctly detects the case
 * when the user added the app to their home screen via Share -> Add to
 * Home Screen. The UI can use that signal to show iOS-specific guidance.
 *
 * @module clawser-pwa-install
 *
 * @example
 *   import { initPwaInstall, tryInstall, getInstallState } from './clawser-pwa-install.js';
 *   initPwaInstall();
 *   if (getInstallState().installable) {
 *     installButton.onclick = () => tryInstall();
 *   }
 */

/** @type {BeforeInstallPromptEvent|null} */
let deferredPrompt = null;
/** @type {Set<(state: { installable: boolean, installed: boolean, platform: string }) => void>} */
const listeners = new Set();
/** @type {boolean} */
let installed = false;

/**
 * Detect whether the page is running in a standalone PWA context.
 * Covers Chrome/Edge installed PWAs, iOS Safari "Add to Home Screen",
 * and the `display-mode: standalone` media query used by other browsers.
 *
 * @returns {boolean}
 */
export const isStandalone = () => {
  if (typeof window === 'undefined') return false;
  // iOS Safari: navigator.standalone
  if (typeof navigator !== 'undefined' && /** @type {any} */ (navigator).standalone === true) {
    return true;
  }
  if (typeof window.matchMedia === 'function') {
    return window.matchMedia('(display-mode: standalone)').matches;
  }
  return false;
};

/**
 * Detect a rough platform tag for guidance text.
 * @returns {'ios'|'android'|'desktop'|'unknown'}
 */
export const detectPlatform = () => {
  if (typeof navigator === 'undefined') return 'unknown';
  const ua = navigator.userAgent || '';
  if (/iPhone|iPad|iPod/i.test(ua)) return 'ios';
  if (/Android/i.test(ua)) return 'android';
  if (/Mac|Windows|Linux/i.test(ua)) return 'desktop';
  return 'unknown';
};

/**
 * Initialise the PWA install flow.
 *
 * Safe to call multiple times — re-binds the event listener if the
 * environment supports it.
 *
 * @returns {() => void} Teardown function that removes the listener.
 */
export const initPwaInstall = () => {
  if (typeof window === 'undefined') return () => {};

  installed = isStandalone();

  const onBeforeInstall = (e) => {
    e.preventDefault();
    deferredPrompt = e;
    notify();
  };
  const onAppInstalled = () => {
    installed = true;
    deferredPrompt = null;
    notify();
  };

  window.addEventListener('beforeinstallprompt', onBeforeInstall);
  window.addEventListener('appinstalled', onAppInstalled);

  return () => {
    window.removeEventListener('beforeinstallprompt', onBeforeInstall);
    window.removeEventListener('appinstalled', onAppInstalled);
  };
};

/**
 * Trigger the native install prompt. Returns the user's choice.
 *
 * @returns {Promise<{ outcome: 'accepted'|'dismissed'|'unavailable' }>}
 *
 * @example
 *   const result = await tryInstall();
 *   if (result.outcome === 'accepted') analytics.track('pwa_installed');
 */
export const tryInstall = async () => {
  if (!deferredPrompt) return { outcome: 'unavailable' };
  try {
    deferredPrompt.prompt();
    const choice = await deferredPrompt.userChoice;
    deferredPrompt = null;
    notify();
    return { outcome: choice.outcome };
  } catch {
    deferredPrompt = null;
    notify();
    return { outcome: 'unavailable' };
  }
};

/**
 * Subscribe to install state changes. The callback fires immediately with
 * the current state and on every transition (installable / installed).
 *
 * @param {(state: { installable: boolean, installed: boolean, platform: string }) => void} cb
 * @returns {() => void} Unsubscribe function.
 */
export const onInstallStateChange = (cb) => {
  listeners.add(cb);
  // Fire immediately with current state
  try { cb(getInstallState()); } catch (e) { silentCatch('clawser-pwa-install', 'swallow', e) }
  return () => listeners.delete(cb);
};

/**
 * Get current install state synchronously.
 *
 * @returns {{ installable: boolean, installed: boolean, platform: string }}
 */
export const getInstallState = () => ({
  installable: !!deferredPrompt && !installed,
  installed,
  platform: detectPlatform(),
});

const notify = () => {
  const state = getInstallState();
  for (const cb of listeners) {
    try { cb(state); } catch (e) { silentCatch('clawser-pwa-install', 'swallow', e) }
  }
};

/**
 * Reset internal state — for tests only.
 * @internal
 */
export const __resetForTests = () => {
  deferredPrompt = null;
  installed = false;
  listeners.clear();
};
