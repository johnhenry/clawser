/**
 * clawser-mobile.js — Mobile support utilities
 *
 * Provides touch gesture handling, mobile layout management,
 * virtual keyboard handling, pull-to-refresh, and device detection.
 *
 * @example
 * import { initMobile, isMobile, isTouch } from './clawser-mobile.js';
 * initMobile(); // call once after DOM ready
 */

import { $ } from './clawser-state.js';

// ── Device Detection ──────────────────────────────────────────

/**
 * Detect if the current device is mobile based on viewport width + touch.
 * @returns {boolean}
 *
 * @example
 * if (isMobile()) console.log('mobile layout active');
 */
export const isMobile = () => window.innerWidth <= 768;

/**
 * Detect if the device supports touch input.
 * @returns {boolean}
 *
 * @example
 * if (isTouch()) enableSwipeGestures();
 */
export const isTouch = () =>
  'ontouchstart' in window || navigator.maxTouchPoints > 0;

/**
 * Detect if viewport is in portrait orientation.
 * @returns {boolean}
 */
export const isPortrait = () => window.innerHeight > window.innerWidth;

/**
 * Get the current breakpoint tier.
 * @returns {'compact'|'medium'|'full'}
 *
 * @example
 * const tier = getBreakpoint(); // 'compact' on phones
 */
export const getBreakpoint = () => {
  const w = window.innerWidth;
  if (w <= 480) return 'compact';
  if (w <= 768) return 'medium';
  return 'full';
};

// ── State ─────────────────────────────────────────────────────

/** @type {{ activePanel: string, swipeStartX: number, swipeStartY: number, pullStartY: number, isPulling: boolean, keyboardVisible: boolean, cleanup: Function[] }} */
const mobileState = {
  activePanel: 'chat',
  swipeStartX: 0,
  swipeStartY: 0,
  pullStartY: 0,
  isPulling: false,
  keyboardVisible: false,
  cleanup: [],
};

/** Panel order for swipe navigation */
const PANEL_ORDER = [
  'chat', 'tools', 'files', 'memory', 'goals',
  'events', 'skills', 'terminal', 'dashboard',
  'servers', 'toolMgmt', 'agents', 'channels',
  'marketplace', 'swarms', 'transfers', 'mesh',
  'peers', 'remote', 'config',
];

// ── Swipe Gesture Handling ────────────────────────────────────

const SWIPE_THRESHOLD = 50;
const SWIPE_MAX_VERTICAL = 80;

/**
 * Handle touch start for swipe detection.
 * @param {TouchEvent} e
 */
const onTouchStart = (e) => {
  if (!isMobile()) return;
  const touch = e.touches[0];
  mobileState.swipeStartX = touch.clientX;
  mobileState.swipeStartY = touch.clientY;
};

/**
 * Handle touch end for swipe panel switching.
 * @param {TouchEvent} e
 */
const onTouchEnd = (e) => {
  if (!isMobile()) return;
  const touch = e.changedTouches[0];
  const dx = touch.clientX - mobileState.swipeStartX;
  const dy = touch.clientY - mobileState.swipeStartY;

  // Only trigger if horizontal swipe dominates vertical
  if (Math.abs(dx) < SWIPE_THRESHOLD || Math.abs(dy) > SWIPE_MAX_VERTICAL) return;

  // Don't swipe if interacting with input/textarea/scrollable
  const tag = e.target?.tagName?.toLowerCase();
  if (tag === 'input' || tag === 'textarea' || tag === 'select') return;

  const currentIdx = PANEL_ORDER.indexOf(mobileState.activePanel);
  if (currentIdx === -1) return;

  if (dx < 0 && currentIdx < PANEL_ORDER.length - 1) {
    // Swipe left → next panel
    switchPanel(PANEL_ORDER[currentIdx + 1]);
  } else if (dx > 0 && currentIdx > 0) {
    // Swipe right → prev panel
    switchPanel(PANEL_ORDER[currentIdx - 1]);
  }
};

/**
 * Switch to a panel by name.
 * Syncs sidebar active state and panel visibility.
 * @param {string} panelName
 *
 * @example
 * switchPanel('tools');
 */
export const switchPanel = (panelName) => {
  mobileState.activePanel = panelName;

  // Update sidebar buttons
  const sidebar = document.querySelector('.sidebar');
  if (!sidebar) return;
  sidebar.querySelectorAll('button[data-panel]').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.panel === panelName);
  });

  // Update panels
  document.querySelectorAll('.panel').forEach((p) => {
    const id = p.id.replace('panel', '').toLowerCase();
    const match = id === panelName.toLowerCase() ||
      p.id === `panel${panelName.charAt(0).toUpperCase()}${panelName.slice(1)}`;
    p.classList.toggle('active-panel', match);
  });

  // Update bottom nav if present
  document.querySelectorAll('.mobile-bottom-nav button').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.panel === panelName);
  });
};

// ── Pull-to-Refresh ──────────────────────────────────────────

const PULL_THRESHOLD = 80;

/**
 * Create a pull-to-refresh indicator element.
 * @returns {HTMLElement}
 */
const createPullIndicator = () => {
  const el = document.createElement('div');
  el.className = 'pull-refresh-indicator';
  el.innerHTML = '<span class="pull-refresh-spinner"></span><span class="pull-refresh-text">Pull to refresh</span>';
  return el;
};

/**
 * Initialize pull-to-refresh on the messages container.
 */
const initPullToRefresh = () => {
  const messages = $('messages');
  if (!messages) return;

  const indicator = createPullIndicator();
  messages.parentElement?.insertBefore(indicator, messages);

  const onPullStart = (e) => {
    if (messages.scrollTop > 0 || !isMobile()) return;
    mobileState.pullStartY = e.touches[0].clientY;
    mobileState.isPulling = true;
  };

  const onPullMove = (e) => {
    if (!mobileState.isPulling) return;
    const dy = e.touches[0].clientY - mobileState.pullStartY;
    if (dy < 0) return;

    const progress = Math.min(dy / PULL_THRESHOLD, 1);
    indicator.style.transform = `translateY(${Math.min(dy, PULL_THRESHOLD)}px)`;
    indicator.style.opacity = String(progress);

    if (dy > PULL_THRESHOLD) {
      indicator.querySelector('.pull-refresh-text').textContent = 'Release to refresh';
    } else {
      indicator.querySelector('.pull-refresh-text').textContent = 'Pull to refresh';
    }

    if (dy > 10) e.preventDefault();
  };

  const onPullEnd = (e) => {
    if (!mobileState.isPulling) return;
    const dy = e.changedTouches[0].clientY - mobileState.pullStartY;
    mobileState.isPulling = false;

    indicator.style.transition = 'transform .3s, opacity .3s';
    indicator.style.transform = 'translateY(0)';
    indicator.style.opacity = '0';
    setTimeout(() => { indicator.style.transition = ''; }, 300);

    if (dy > PULL_THRESHOLD) {
      // Trigger refresh — scroll to bottom for latest
      messages.scrollTop = messages.scrollHeight;
    }
  };

  messages.addEventListener('touchstart', onPullStart, { passive: true });
  messages.addEventListener('touchmove', onPullMove, { passive: false });
  messages.addEventListener('touchend', onPullEnd, { passive: true });

  mobileState.cleanup.push(() => {
    messages.removeEventListener('touchstart', onPullStart);
    messages.removeEventListener('touchmove', onPullMove);
    messages.removeEventListener('touchend', onPullEnd);
    indicator.remove();
  });
};

// ── Virtual Keyboard Handling ─────────────────────────────────

/**
 * Handle virtual keyboard show/hide by adjusting layout.
 * Uses the Visual Viewport API when available.
 */
const initKeyboardHandling = () => {
  if (!window.visualViewport) return;

  const onResize = () => {
    const vv = window.visualViewport;
    const keyboardHeight = window.innerHeight - vv.height;
    const isKeyboard = keyboardHeight > 100;

    document.documentElement.style.setProperty(
      '--keyboard-height', `${isKeyboard ? keyboardHeight : 0}px`
    );
    document.body.classList.toggle('keyboard-visible', isKeyboard);
    mobileState.keyboardVisible = isKeyboard;

    // Keep focused input visible
    if (isKeyboard) {
      const focused = document.activeElement;
      if (focused && (focused.tagName === 'INPUT' || focused.tagName === 'TEXTAREA')) {
        requestAnimationFrame(() => {
          focused.scrollIntoView({ behavior: 'smooth', block: 'center' });
        });
      }
    }
  };

  window.visualViewport.addEventListener('resize', onResize);
  mobileState.cleanup.push(() => {
    window.visualViewport.removeEventListener('resize', onResize);
  });
};

// ── Chat Input Enhancements ──────────────────────────────────

/**
 * Upgrade the chat input from a single-line input to an auto-resizing textarea
 * on touch devices for a better mobile typing experience.
 */
const enhanceChatInput = () => {
  const input = $('userInput');
  if (!input || input.tagName === 'TEXTAREA') return;
  if (!isTouch()) return;

  const textarea = document.createElement('textarea');
  textarea.id = input.id;
  textarea.placeholder = input.placeholder;
  textarea.disabled = input.disabled;
  textarea.className = input.className;
  textarea.setAttribute('rows', '1');
  textarea.setAttribute('aria-label', input.getAttribute('aria-label') || 'Message input');

  // Auto-resize logic
  const autoResize = () => {
    textarea.style.height = 'auto';
    const maxH = 120; // max 5 lines roughly
    textarea.style.height = `${Math.min(textarea.scrollHeight, maxH)}px`;
  };

  textarea.addEventListener('input', autoResize);

  // Enter to send (without shift), shift+enter for newline
  textarea.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      const sendBtn = $('sendBtn');
      if (sendBtn && !sendBtn.disabled) sendBtn.click();
    }
  });

  input.replaceWith(textarea);
};

// ── Bottom Navigation Bar ─────────────────────────────────────

/** Primary nav items shown in the mobile bottom bar. */
const BOTTOM_NAV_ITEMS = [
  { panel: 'chat', icon: '💬', label: 'Chat' },
  { panel: 'tools', icon: '🔧', label: 'Tools' },
  { panel: 'files', icon: '📁', label: 'Files' },
  { panel: 'memory', icon: '🧠', label: 'Memory' },
  { panel: 'config', icon: '⚙️', label: 'Settings' },
];

/**
 * Create and insert a mobile bottom navigation bar.
 * Only visible on compact viewports via CSS.
 */
const createBottomNav = () => {
  if (document.querySelector('.mobile-bottom-nav')) return;

  const nav = document.createElement('nav');
  nav.className = 'mobile-bottom-nav';
  nav.setAttribute('role', 'navigation');
  nav.setAttribute('aria-label', 'Mobile navigation');

  for (const item of BOTTOM_NAV_ITEMS) {
    const btn = document.createElement('button');
    btn.dataset.panel = item.panel;
    btn.className = item.panel === mobileState.activePanel ? 'active' : '';
    btn.setAttribute('aria-label', item.label);
    btn.innerHTML = `<span class="mobile-nav-icon">${item.icon}</span><span class="mobile-nav-label">${item.label}</span>`;
    btn.addEventListener('click', () => switchPanel(item.panel));
    nav.appendChild(btn);
  }

  const workspace = document.querySelector('#viewWorkspace');
  if (workspace) workspace.appendChild(nav);
};

// ── Orientation Handling ──────────────────────────────────────

/**
 * Update CSS class on body for orientation-specific styles.
 */
const updateOrientation = () => {
  document.body.classList.toggle('landscape', !isPortrait());
  document.body.classList.toggle('portrait', isPortrait());
};

// ── Touch-Friendly Tool Approval ──────────────────────────────

/**
 * Enhance modal overlay buttons for touch: ensure min 44px tap targets.
 * Observes DOM for dynamically added modals.
 */
const initTouchModals = () => {
  const observer = new MutationObserver((mutations) => {
    if (!isMobile()) return;
    for (const m of mutations) {
      for (const node of m.addedNodes) {
        if (node.nodeType !== 1) continue;
        if (node.classList?.contains('modal-overlay') || node.querySelector?.('.modal-overlay')) {
          const buttons = (node.classList?.contains('modal-overlay') ? node : node.querySelector('.modal-overlay'))
            ?.querySelectorAll('.modal-btn') || [];
          buttons.forEach((btn) => {
            btn.classList.add('touch-target');
          });
        }
      }
    }
  });

  observer.observe(document.body, { childList: true, subtree: true });
  mobileState.cleanup.push(() => observer.disconnect());
};

// ── Swipe-to-Approve on Tool Cards ────────────────────────────

/**
 * Allow swiping right on pending tool-card elements to approve.
 * Observes for .msg.tool-card.pending elements.
 */
const initSwipeApproval = () => {
  const observer = new MutationObserver((mutations) => {
    if (!isTouch()) return;
    for (const m of mutations) {
      for (const node of m.addedNodes) {
        if (node.nodeType !== 1) continue;
        const cards = node.classList?.contains('tool-card')
          ? [node]
          : [...(node.querySelectorAll?.('.msg.tool-card.pending') || [])];

        for (const card of cards) {
          if (!card.classList.contains('pending') || card.dataset.swipeInit) continue;
          card.dataset.swipeInit = '1';
          let startX = 0;

          card.addEventListener('touchstart', (e) => {
            startX = e.touches[0].clientX;
          }, { passive: true });

          card.addEventListener('touchend', (e) => {
            const dx = e.changedTouches[0].clientX - startX;
            if (dx > 80) {
              // Find and click approve button
              const approveBtn = card.querySelector('.modal-btn-ok, .btn-sm');
              if (approveBtn) approveBtn.click();
            }
          }, { passive: true });
        }
      }
    }
  });

  observer.observe(document.body, { childList: true, subtree: true });
  mobileState.cleanup.push(() => observer.disconnect());
};

// ── Initialization ────────────────────────────────────────────

/**
 * Initialize all mobile support features.
 * Call once after the DOM is ready.
 *
 * @example
 * document.addEventListener('DOMContentLoaded', () => initMobile());
 */
export const initMobile = () => {
  // Set CSS custom property for safe area
  document.documentElement.style.setProperty(
    '--keyboard-height', '0px'
  );

  // Orientation tracking
  updateOrientation();
  window.addEventListener('orientationchange', updateOrientation);
  window.addEventListener('resize', updateOrientation);
  mobileState.cleanup.push(() => {
    window.removeEventListener('orientationchange', updateOrientation);
    window.removeEventListener('resize', updateOrientation);
  });

  // Touch gestures
  if (isTouch()) {
    document.addEventListener('touchstart', onTouchStart, { passive: true });
    document.addEventListener('touchend', onTouchEnd, { passive: true });
    mobileState.cleanup.push(() => {
      document.removeEventListener('touchstart', onTouchStart);
      document.removeEventListener('touchend', onTouchEnd);
    });
  }

  // Bottom nav (compact viewports)
  createBottomNav();

  // Virtual keyboard
  initKeyboardHandling();

  // Chat input upgrade
  enhanceChatInput();

  // Pull to refresh
  initPullToRefresh();

  // Touch-friendly modals
  initTouchModals();

  // Swipe approval
  initSwipeApproval();

  // Add mobile class for CSS
  const updateMobileClass = () => {
    document.body.classList.toggle('is-mobile', isMobile());
    document.body.classList.toggle('is-touch', isTouch());
  };
  updateMobileClass();
  window.addEventListener('resize', updateMobileClass);
  mobileState.cleanup.push(() => window.removeEventListener('resize', updateMobileClass));
};

/**
 * Tear down all mobile handlers. Useful for testing.
 */
export const destroyMobile = () => {
  for (const fn of mobileState.cleanup) fn();
  mobileState.cleanup.length = 0;
  document.querySelector('.mobile-bottom-nav')?.remove();
  document.querySelector('.pull-refresh-indicator')?.remove();
  document.body.classList.remove('is-mobile', 'is-touch', 'landscape', 'portrait', 'keyboard-visible');
  document.documentElement.style.removeProperty('--keyboard-height');
};
