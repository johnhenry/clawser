/**
 * clawser-keys.js — Keyboard shortcut module
 *
 * Provides global keyboard shortcuts for common workspace actions.
 * Uses Cmd (macOS) / Ctrl (other platforms) as the modifier.
 *
 * Shortcuts:
 *   Cmd/Ctrl+Enter  — Send message
 *   Cmd/Ctrl+K      — Focus command/search palette
 *   Cmd/Ctrl+N      — New conversation
 *   Cmd/Ctrl+1..9   — Switch panels
 *   Escape           — Close autocomplete/modals
 */

import { $, state } from './clawser-state.js';
import { activatePanel } from './clawser-router.js';

/** Panel index mapping for Cmd/Ctrl+1..9 shortcuts. */
const PANEL_ORDER = [
  'chat',      // 1
  'tools',     // 2
  'files',     // 3
  'memory',    // 4
  'goals',     // 5
  'events',    // 6
  'skills',    // 7
  'terminal',  // 8
  'config',    // 9
];

/**
 * Returns true if the modifier key (Cmd on Mac, Ctrl elsewhere) is pressed.
 * @param {KeyboardEvent} e
 * @returns {boolean}
 */
function modKey(e) {
  return navigator.platform?.includes('Mac') ? e.metaKey : e.ctrlKey;
}

/**
 * Initialize global keyboard shortcuts.
 * Call once after DOM is ready.
 */
export function initKeyboardShortcuts() {
  document.addEventListener('keydown', (e) => {
    // ── Escape — close autocomplete/modals ──
    if (e.key === 'Escape') {
      // Close slash autocomplete
      const autocomplete = $('slashAutocomplete');
      if (autocomplete?.classList.contains('visible')) {
        autocomplete.classList.remove('visible');
        e.preventDefault();
        return;
      }

      // Close command palette
      const cmdPalette = $('cmdPalette');
      if (cmdPalette?.classList.contains('visible')) {
        cmdPalette.classList.remove('visible');
        e.preventDefault();
        return;
      }

      // Close workspace dropdown
      const wsDropdown = $('wsDropdown');
      if (wsDropdown?.classList.contains('visible')) {
        wsDropdown.classList.remove('visible');
        e.preventDefault();
        return;
      }

      return;
    }

    // All remaining shortcuts require modifier key
    if (!modKey(e)) return;

    // ── Cmd/Ctrl+Enter — Send message ──
    if (e.key === 'Enter') {
      const sendBtn = $('sendBtn');
      if (sendBtn && !sendBtn.disabled) {
        sendBtn.click();
        e.preventDefault();
      }
      return;
    }

    // ── Cmd/Ctrl+K — Focus command palette / search ──
    if (e.key === 'k' || e.key === 'K') {
      const cmdPaletteBtn = $('cmdPaletteBtn');
      if (cmdPaletteBtn && !cmdPaletteBtn.disabled) {
        cmdPaletteBtn.click();
      } else {
        // Fallback: focus the user input
        const input = $('userInput');
        if (input) input.focus();
      }
      e.preventDefault();
      return;
    }

    // ── Cmd/Ctrl+N — New conversation ──
    if (e.key === 'n' || e.key === 'N') {
      // Avoid overriding browser new-window when shift is also held
      if (e.shiftKey) return;
      // Trigger the new conversation button in the item bar
      const newBtn = document.querySelector('.item-bar-new');
      if (newBtn) {
        newBtn.click();
        e.preventDefault();
      }
      return;
    }

    // ── Cmd/Ctrl+1..9 — Switch panels ──
    const digit = parseInt(e.key, 10);
    if (digit >= 1 && digit <= 9) {
      const panelName = PANEL_ORDER[digit - 1];
      if (panelName) {
        activatePanel(panelName);
        e.preventDefault();
      }
      return;
    }
  });
}
