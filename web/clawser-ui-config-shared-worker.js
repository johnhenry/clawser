/**
 * clawser-ui-config-shared-worker.js — SharedWorker toggle + lifecycle
 *
 * Provides opt-in SharedWorker cross-tab agent sharing.
 * Persists enabled state per workspace in localStorage.
 */
import { $, state } from './clawser-state.js';
import { getActiveWorkspaceId } from './clawser-workspaces.js';

// ── Persistence ─────────────────────────────────────────────────

function storageKey() {
  return `clawser_shared_worker_${getActiveWorkspaceId()}`;
}

/** Load saved SharedWorker config. @returns {{ enabled: boolean }} */
export function loadSharedWorkerConfig() {
  try {
    return JSON.parse(localStorage.getItem(storageKey()) || '{"enabled":false}');
  } catch { return { enabled: false }; }
}

/** Save SharedWorker config. @param {{ enabled: boolean }} config */
export function saveSharedWorkerConfig(config) {
  localStorage.setItem(storageKey(), JSON.stringify(config));
}

// ── Feature detection ───────────────────────────────────────────

/** @returns {boolean} Whether SharedWorker API is available */
export function isSharedWorkerAvailable() {
  return typeof SharedWorker !== 'undefined';
}

// ── Lifecycle ───────────────────────────────────────────────────

/**
 * Start the SharedWorker and create a client.
 * Sets state.sharedWorkerClient.
 * @returns {boolean} Whether successfully started
 */
export async function startSharedWorker() {
  if (!isSharedWorkerAvailable()) return false;
  try {
    const { SharedWorkerClient } = await import('./clawser-shared-worker-client.js');
    const worker = new SharedWorker('./shared-worker.js', { name: 'clawser-agent' });
    const client = new SharedWorkerClient(worker.port);
    state.sharedWorkerClient = client;
    state._sharedWorker = worker;
    return true;
  } catch (e) {
    console.warn('[clawser] SharedWorker start failed:', e);
    return false;
  }
}

/**
 * Stop the SharedWorker and disconnect the client.
 */
export function stopSharedWorker() {
  if (state.sharedWorkerClient) {
    state.sharedWorkerClient.disconnect();
    state.sharedWorkerClient = null;
  }
  if (state._sharedWorker) {
    state._sharedWorker = null;
  }
}

// ── UI rendering ────────────────────────────────────────────────

/** Update the SharedWorker status indicator in the config panel. */
export function updateSharedWorkerStatus() {
  const dot = $('swStatusDot');
  const label = $('swStatusLabel');
  if (!dot || !label) return;

  if (!isSharedWorkerAvailable()) {
    dot.className = 'sw-status-dot off';
    label.textContent = 'Unavailable (browser does not support SharedWorker)';
    return;
  }

  const connected = state.sharedWorkerClient?.connected ?? false;
  dot.className = connected ? 'sw-status-dot on' : 'sw-status-dot off';
  label.textContent = connected ? 'Connected' : 'Disconnected';
}

/**
 * Render the SharedWorker config section.
 * Syncs the checkbox with persisted state.
 */
export function renderSharedWorkerSection() {
  const checkbox = $('sharedWorkerEnabled');
  if (!checkbox) return;

  const config = loadSharedWorkerConfig();
  checkbox.checked = config.enabled;

  if (!isSharedWorkerAvailable()) {
    checkbox.disabled = true;
  }

  updateSharedWorkerStatus();
}

/**
 * Handle toggle change: start/stop SharedWorker and persist.
 */
export async function handleSharedWorkerToggle() {
  const checkbox = $('sharedWorkerEnabled');
  if (!checkbox) return;

  const enabled = checkbox.checked;
  saveSharedWorkerConfig({ enabled });

  if (enabled) {
    const ok = await startSharedWorker();
    if (!ok) {
      checkbox.checked = false;
      saveSharedWorkerConfig({ enabled: false });
    }
  } else {
    stopSharedWorker();
  }

  updateSharedWorkerStatus();
}

/**
 * Initialize SharedWorker from saved config on workspace init.
 * Call during workspace bootstrap.
 */
export async function initSharedWorkerFromConfig() {
  const config = loadSharedWorkerConfig();
  if (config.enabled && isSharedWorkerAvailable()) {
    await startSharedWorker();
  }
}
