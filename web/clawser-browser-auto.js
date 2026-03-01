// clawser-browser-auto.js — Browser Automation (Agent-as-User)
//
// PageSnapshot: accessibility tree, forms, links extraction
// AutomationSession: tab lifecycle + rate limiting
// AutomationManager: multi-tab session management + domain allowlist
// Agent tools: browser_open, browser_read_page, browser_screenshot,
//   browser_click, browser_fill, browser_select, browser_scroll,
//   browser_wait, browser_evaluate, browser_list_tabs, browser_close_tab

import { BrowserTool } from './clawser-tools.js';

// ── Constants ───────────────────────────────────────────────────

export const DEFAULT_ACTION_DELAY_MS = 1000; // 1 action per second
export const DEFAULT_WAIT_TIMEOUT_MS = 10_000; // 10 seconds
export const DEFAULT_MAX_TABS = 10;

export const SELECTOR_STRATEGIES = Object.freeze({
  ACCESSIBILITY: 'accessibility',
  TEXT: 'text',
  CSS: 'css',
  COORDINATES: 'coordinates',
});

export const SENSITIVE_INPUT_TYPES = Object.freeze([
  'password', 'credit-card', 'ssn',
]);

// ── Page Snapshot ───────────────────────────────────────────────

/**
 * Extract interactive elements from a DOM-like structure.
 * @param {object} doc - Document-like object (or mock)
 * @returns {Array<{ role: string, name: string, selector: string, type: string, value: string, enabled: boolean }>}
 */
export function getInteractiveElements(doc) {
  if (!doc?.querySelectorAll) return [];

  const selector = 'a, button, input, select, textarea, [role=button], [role=link], [tabindex]';
  const elements = [];

  try {
    const nodes = doc.querySelectorAll(selector);
    for (const el of nodes) {
      elements.push({
        role: el.getAttribute?.('role') || el.tagName?.toLowerCase() || 'unknown',
        name: el.getAttribute?.('aria-label') || el.textContent?.trim()?.slice(0, 50) || '',
        selector: generateSelector(el),
        type: el.type || '',
        value: el.value || '',
        enabled: !el.disabled,
      });
    }
  } catch {
    // DOM access may fail
  }

  return elements;
}

/**
 * Generate a CSS selector for an element.
 * @param {object} el
 * @returns {string}
 */
export function generateSelector(el) {
  if (!el) return '';
  if (el.id) return `#${el.id}`;
  if (el.getAttribute?.('data-testid')) return `[data-testid="${el.getAttribute('data-testid')}"]`;

  const tag = el.tagName?.toLowerCase() || 'div';
  const classes = el.className
    ? '.' + String(el.className).trim().split(/\s+/).slice(0, 2).join('.')
    : '';
  return `${tag}${classes}`;
}

/**
 * Extract article/main text from a document.
 * @param {object} doc
 * @returns {string}
 */
export function extractArticleText(doc) {
  if (!doc) return '';

  // Try article or main
  const article = doc.querySelector?.('article') || doc.querySelector?.('main');
  if (article?.textContent) return article.textContent.trim();

  // Fallback to body
  return doc.body?.textContent?.trim() || '';
}

/**
 * Extract form field information.
 * @param {object} doc
 * @returns {Array<{ label: string, name: string, type: string, selector: string, value: string, required: boolean }>}
 */
export function getFormFields(doc) {
  if (!doc?.querySelectorAll) return [];

  const fields = [];
  try {
    const inputs = doc.querySelectorAll('input, select, textarea');
    for (const el of inputs) {
      fields.push({
        label: el.getAttribute?.('aria-label') || el.getAttribute?.('placeholder') || el.name || '',
        name: el.name || '',
        type: el.type || 'text',
        selector: generateSelector(el),
        value: el.value || '',
        required: !!el.required,
      });
    }
  } catch {}

  return fields;
}

/**
 * Extract links from a document.
 * @param {object} doc
 * @returns {Array<{ text: string, href: string }>}
 */
export function getLinks(doc) {
  if (!doc?.querySelectorAll) return [];

  const links = [];
  try {
    const anchors = doc.querySelectorAll('a[href]');
    for (const a of anchors) {
      links.push({
        text: a.textContent?.trim()?.slice(0, 80) || '',
        href: a.href || a.getAttribute?.('href') || '',
      });
    }
  } catch {}

  return links;
}

/**
 * Create a full page snapshot.
 * @param {object} doc
 * @param {string} url
 * @returns {object}
 */
export function createPageSnapshot(doc, url = '') {
  return {
    title: doc?.title || '',
    url: url || doc?.location?.href || '',
    elements: getInteractiveElements(doc),
    content: extractArticleText(doc),
    forms: getFormFields(doc),
    links: getLinks(doc),
    timestamp: Date.now(),
  };
}

// ── Element Resolver ────────────────────────────────────────────

/**
 * Resolve an element from multiple selector strategies.
 * @param {object} doc
 * @param {object} opts - { selector, text, role, name, x, y }
 * @returns {{ element: object|null, strategy: string }}
 */
export function resolveElement(doc, opts = {}) {
  if (!doc) return { element: null, strategy: 'none' };

  // 1. Accessibility (role + name)
  if (opts.role || opts.ariaName) {
    const elements = doc.querySelectorAll?.(`[role="${opts.role}"]`) || [];
    for (const el of elements) {
      const elName = el.getAttribute?.('aria-label') || el.textContent?.trim() || '';
      if (!opts.ariaName || elName.includes(opts.ariaName)) {
        return { element: el, strategy: SELECTOR_STRATEGIES.ACCESSIBILITY };
      }
    }
  }

  // 2. Text content
  if (opts.text) {
    const all = doc.querySelectorAll?.('a, button, [role=button], [role=link]') || [];
    for (const el of all) {
      if (el.textContent?.trim()?.includes(opts.text)) {
        return { element: el, strategy: SELECTOR_STRATEGIES.TEXT };
      }
    }
  }

  // 3. CSS selector
  if (opts.selector) {
    try {
      const el = doc.querySelector?.(opts.selector);
      if (el) return { element: el, strategy: SELECTOR_STRATEGIES.CSS };
    } catch {}
  }

  // 4. Coordinates (no DOM element, but recognized strategy)
  if (opts.x !== undefined && opts.y !== undefined) {
    return { element: null, strategy: SELECTOR_STRATEGIES.COORDINATES };
  }

  return { element: null, strategy: 'none' };
}

// ── Safety Checks ───────────────────────────────────────────────

/**
 * Check if a form field is sensitive (password, etc.).
 * @param {object} element
 * @returns {boolean}
 */
export function isSensitiveField(element) {
  if (!element) return false;
  const type = (element.type || '').toLowerCase();
  return SENSITIVE_INPUT_TYPES.includes(type);
}

/**
 * Check if a domain is in the allowlist.
 * @param {string} url
 * @param {string[]} allowlist
 * @returns {boolean}
 */
export function isDomainAllowed(url, allowlist) {
  if (!allowlist || allowlist.length === 0) return true; // empty = allow all
  try {
    const hostname = new URL(url).hostname;
    return allowlist.some(domain =>
      hostname === domain || hostname.endsWith('.' + domain)
    );
  } catch {
    return false;
  }
}

// ── AutomationSession ───────────────────────────────────────────

let sessionCounter = 0;
export function resetSessionCounter() { sessionCounter = 0; }

/**
 * Represents a single tab automation session with rate limiting.
 */
export class AutomationSession {
  #id;
  #tabId;
  #url;
  #lastActionTime = 0;
  #actionDelay;
  #actions = [];
  #active = true;

  /** @type {Function|null} Injectable extension bridge */
  #bridge;

  /**
   * @param {object} opts
   * @param {string|number} opts.tabId
   * @param {string} [opts.url]
   * @param {number} [opts.actionDelay]
   * @param {Function} [opts.bridge] - (action, params) => Promise<result>
   */
  constructor(opts = {}) {
    this.#id = `session_${++sessionCounter}`;
    this.#tabId = opts.tabId || null;
    this.#url = opts.url || '';
    this.#actionDelay = opts.actionDelay || DEFAULT_ACTION_DELAY_MS;
    this.#bridge = opts.bridge || null;
  }

  get id() { return this.#id; }
  get tabId() { return this.#tabId; }
  get url() { return this.#url; }
  get active() { return this.#active; }
  get actionCount() { return this.#actions.length; }

  /**
   * Execute an action with rate limiting.
   * @param {string} action
   * @param {object} params
   * @returns {Promise<object>}
   */
  async execute(action, params = {}) {
    if (!this.#active) throw new Error('Session is closed');

    // Rate limit
    const now = Date.now();
    const elapsed = now - this.#lastActionTime;
    if (elapsed < this.#actionDelay) {
      await new Promise(r => setTimeout(r, this.#actionDelay - elapsed));
    }

    this.#lastActionTime = Date.now();

    // Record action
    const record = { action, params, timestamp: Date.now() };
    this.#actions.push(record);

    // Execute via bridge
    if (this.#bridge) {
      const result = await this.#bridge(action, { tabId: this.#tabId, ...params });
      record.result = result;
      if (params.url) this.#url = params.url;
      return result;
    }

    return { success: true, output: `Action ${action} executed (no bridge)` };
  }

  /**
   * Get action history.
   * @returns {Array<{ action: string, params: object, timestamp: number }>}
   */
  getHistory() {
    return [...this.#actions];
  }

  /**
   * Close this session.
   */
  close() {
    this.#active = false;
  }
}

// ── AutomationManager ───────────────────────────────────────────

/**
 * Manages multiple automation sessions with domain allowlisting.
 */
export class AutomationManager {
  /** @type {Map<string, AutomationSession>} */
  #sessions = new Map();

  /** @type {string[]} */
  #domainAllowlist;

  /** @type {number} */
  #maxTabs;

  /** @type {Function|null} */
  #bridge;

  /** @type {Function|null} */
  #onLog;

  /**
   * @param {object} [opts]
   * @param {string[]} [opts.domainAllowlist] - Allowed domains (empty = all)
   * @param {number} [opts.maxTabs]
   * @param {Function} [opts.bridge] - Extension bridge function
   * @param {Function} [opts.onLog]
   */
  constructor(opts = {}) {
    this.#domainAllowlist = opts.domainAllowlist || [];
    this.#maxTabs = opts.maxTabs || DEFAULT_MAX_TABS;
    this.#bridge = opts.bridge || null;
    this.#onLog = opts.onLog || null;
  }

  /** Number of active sessions. */
  get sessionCount() { return this.#sessions.size; }

  /** Domain allowlist. */
  get domainAllowlist() { return [...this.#domainAllowlist]; }

  /**
   * Set the domain allowlist.
   * @param {string[]} domains
   */
  setDomainAllowlist(domains) {
    this.#domainAllowlist = [...domains];
  }

  /**
   * Open a new automation session.
   * @param {string} url
   * @param {object} [opts]
   * @returns {AutomationSession}
   */
  open(url, opts = {}) {
    if (this.#sessions.size >= this.#maxTabs) {
      throw new Error(`Max tabs (${this.#maxTabs}) reached`);
    }

    if (!isDomainAllowed(url, this.#domainAllowlist)) {
      throw new Error(`Domain not in allowlist: ${url}`);
    }

    const session = new AutomationSession({
      tabId: opts.tabId || `tab_${Date.now()}`,
      url,
      bridge: this.#bridge,
    });

    this.#sessions.set(session.id, session);
    this.#log(`Opened session ${session.id} for ${url}`);
    return session;
  }

  /**
   * Get a session by ID.
   * @param {string} id
   * @returns {AutomationSession|undefined}
   */
  getSession(id) {
    return this.#sessions.get(id);
  }

  /**
   * Close a session.
   * @param {string} id
   * @returns {boolean}
   */
  close(id) {
    const session = this.#sessions.get(id);
    if (!session) return false;
    session.close();
    this.#sessions.delete(id);
    this.#log(`Closed session ${id}`);
    return true;
  }

  /**
   * Close all sessions.
   */
  closeAll() {
    for (const session of this.#sessions.values()) {
      session.close();
    }
    this.#sessions.clear();
    this.#log('All sessions closed');
  }

  /**
   * List active sessions.
   * @returns {Array<{ id: string, tabId: string|number, url: string, actionCount: number }>}
   */
  listSessions() {
    return [...this.#sessions.values()].map(s => ({
      id: s.id,
      tabId: s.tabId,
      url: s.url,
      actionCount: s.actionCount,
    }));
  }

  /**
   * Check if a URL is allowed.
   * @param {string} url
   * @returns {boolean}
   */
  isAllowed(url) {
    return isDomainAllowed(url, this.#domainAllowlist);
  }

  #log(msg) {
    if (this.#onLog) this.#onLog(msg);
  }
}

// ── Agent Tools ─────────────────────────────────────────────────

export class BrowserOpenTool extends BrowserTool {
  #manager;

  constructor(manager) {
    super();
    this.#manager = manager;
  }

  get name() { return 'browser_open'; }
  get description() { return 'Open a URL in a new automated browser tab.'; }
  get parameters() {
    return {
      type: 'object',
      properties: {
        url: { type: 'string', description: 'URL to open' },
      },
      required: ['url'],
    };
  }
  get permission() { return 'approve'; }

  async execute({ url }) {
    try {
      const session = this.#manager.open(url);
      return { success: true, output: `Opened ${url} (session: ${session.id})` };
    } catch (e) {
      return { success: false, output: '', error: e.message };
    }
  }
}

export class BrowserReadPageTool extends BrowserTool {
  #manager;

  constructor(manager) {
    super();
    this.#manager = manager;
  }

  get name() { return 'browser_read_page'; }
  get description() { return 'Extract text content and interactive elements from a page.'; }
  get parameters() {
    return {
      type: 'object',
      properties: {
        session_id: { type: 'string', description: 'Session ID to read from' },
      },
      required: ['session_id'],
    };
  }
  get permission() { return 'approve'; }

  async execute({ session_id }) {
    const session = this.#manager.getSession(session_id);
    if (!session) return { success: false, output: '', error: 'Session not found' };

    try {
      const result = await session.execute('read_page');
      return { success: true, output: typeof result === 'string' ? result : JSON.stringify(result, null, 2) };
    } catch (e) {
      return { success: false, output: '', error: e.message };
    }
  }
}

export class BrowserClickTool extends BrowserTool {
  #manager;

  constructor(manager) {
    super();
    this.#manager = manager;
  }

  get name() { return 'browser_click'; }
  get description() { return 'Click an element by selector, text, or coordinates.'; }
  get parameters() {
    return {
      type: 'object',
      properties: {
        session_id: { type: 'string', description: 'Session ID' },
        selector: { type: 'string', description: 'CSS selector' },
        text: { type: 'string', description: 'Element text content' },
        x: { type: 'number', description: 'X coordinate' },
        y: { type: 'number', description: 'Y coordinate' },
      },
      required: ['session_id'],
    };
  }
  get permission() { return 'approve'; }

  async execute({ session_id, selector, text, x, y }) {
    const session = this.#manager.getSession(session_id);
    if (!session) return { success: false, output: '', error: 'Session not found' };

    try {
      const result = await session.execute('click', { selector, text, x, y });
      return { success: true, output: `Clicked element` };
    } catch (e) {
      return { success: false, output: '', error: e.message };
    }
  }
}

export class BrowserFillTool extends BrowserTool {
  #manager;

  constructor(manager) {
    super();
    this.#manager = manager;
  }

  get name() { return 'browser_fill'; }
  get description() { return 'Fill a form field (refuses password fields).'; }
  get parameters() {
    return {
      type: 'object',
      properties: {
        session_id: { type: 'string', description: 'Session ID' },
        selector: { type: 'string', description: 'CSS selector for field' },
        value: { type: 'string', description: 'Value to fill' },
        field_type: { type: 'string', description: 'Field type (for safety check)' },
      },
      required: ['session_id', 'selector', 'value'],
    };
  }
  get permission() { return 'approve'; }

  async execute({ session_id, selector, value, field_type }) {
    if (SENSITIVE_INPUT_TYPES.includes(field_type)) {
      return { success: false, output: '', error: 'Cannot fill sensitive fields (password, credit card, SSN)' };
    }

    const session = this.#manager.getSession(session_id);
    if (!session) return { success: false, output: '', error: 'Session not found' };

    try {
      const result = await session.execute('fill', { selector, value });
      return { success: true, output: `Filled ${selector}` };
    } catch (e) {
      return { success: false, output: '', error: e.message };
    }
  }
}

export class BrowserWaitTool extends BrowserTool {
  #manager;

  constructor(manager) {
    super();
    this.#manager = manager;
  }

  get name() { return 'browser_wait'; }
  get description() { return 'Wait for an element to appear on the page.'; }
  get parameters() {
    return {
      type: 'object',
      properties: {
        session_id: { type: 'string', description: 'Session ID' },
        selector: { type: 'string', description: 'CSS selector to wait for' },
        timeout: { type: 'number', description: 'Timeout in ms (default 10000)' },
      },
      required: ['session_id', 'selector'],
    };
  }
  get permission() { return 'approve'; }

  async execute({ session_id, selector, timeout }) {
    const session = this.#manager.getSession(session_id);
    if (!session) return { success: false, output: '', error: 'Session not found' };

    try {
      const result = await session.execute('wait', {
        selector,
        timeout: timeout || DEFAULT_WAIT_TIMEOUT_MS,
      });
      return { success: true, output: `Element ${selector} found` };
    } catch (e) {
      return { success: false, output: '', error: e.message };
    }
  }
}

export class BrowserSelectTool extends BrowserTool {
  #manager;

  constructor(manager) {
    super();
    this.#manager = manager;
  }

  get name() { return 'browser_select'; }
  get description() { return 'Select an option in a dropdown/select element.'; }
  get parameters() {
    return {
      type: 'object',
      properties: {
        session_id: { type: 'string', description: 'Session ID' },
        selector: { type: 'string', description: 'CSS selector for select element' },
        value: { type: 'string', description: 'Option value or text to select' },
      },
      required: ['session_id', 'selector', 'value'],
    };
  }
  get permission() { return 'approve'; }

  async execute({ session_id, selector, value }) {
    const session = this.#manager.getSession(session_id);
    if (!session) return { success: false, output: '', error: 'Session not found' };

    try {
      const result = await session.execute('select', { selector, value });
      return { success: true, output: `Selected "${value}" in ${selector}` };
    } catch (e) {
      return { success: false, output: '', error: e.message };
    }
  }
}

export class BrowserScrollTool extends BrowserTool {
  #manager;

  constructor(manager) {
    super();
    this.#manager = manager;
  }

  get name() { return 'browser_scroll'; }
  get description() { return 'Scroll the page or a specific element.'; }
  get parameters() {
    return {
      type: 'object',
      properties: {
        session_id: { type: 'string', description: 'Session ID' },
        direction: { type: 'string', description: 'Scroll direction: up, down, left, right', enum: ['up', 'down', 'left', 'right'] },
        amount: { type: 'number', description: 'Scroll amount in pixels (default 300)' },
        selector: { type: 'string', description: 'CSS selector of element to scroll (default: page)' },
      },
      required: ['session_id'],
    };
  }
  get permission() { return 'auto'; }

  async execute({ session_id, direction, amount, selector }) {
    const session = this.#manager.getSession(session_id);
    if (!session) return { success: false, output: '', error: 'Session not found' };

    try {
      const result = await session.execute('scroll', {
        direction: direction || 'down',
        amount: amount || 300,
        selector,
      });
      return { success: true, output: `Scrolled ${direction || 'down'}` };
    } catch (e) {
      return { success: false, output: '', error: e.message };
    }
  }
}

export class BrowserEvaluateTool extends BrowserTool {
  #manager;

  constructor(manager) {
    super();
    this.#manager = manager;
  }

  get name() { return 'browser_evaluate'; }
  get description() { return 'Run JavaScript in the page context and return result.'; }
  get parameters() {
    return {
      type: 'object',
      properties: {
        session_id: { type: 'string', description: 'Session ID' },
        script: { type: 'string', description: 'JavaScript to execute' },
      },
      required: ['session_id', 'script'],
    };
  }
  get permission() { return 'approve'; }

  async execute({ session_id, script }) {
    const session = this.#manager.getSession(session_id);
    if (!session) return { success: false, output: '', error: 'Session not found' };

    try {
      const result = await session.execute('evaluate', { script });
      return { success: true, output: typeof result === 'string' ? result : JSON.stringify(result) };
    } catch (e) {
      return { success: false, output: '', error: e.message };
    }
  }
}

export class BrowserListTabsTool extends BrowserTool {
  #manager;

  constructor(manager) {
    super();
    this.#manager = manager;
  }

  get name() { return 'browser_list_tabs'; }
  get description() { return 'List open automated browser tabs.'; }
  get parameters() { return { type: 'object', properties: {} }; }
  get permission() { return 'read'; }

  async execute() {
    const sessions = this.#manager.listSessions();
    if (sessions.length === 0) {
      return { success: true, output: 'No active automation sessions.' };
    }
    const lines = sessions.map(s =>
      `${s.id} | ${s.url} | ${s.actionCount} actions`
    );
    return { success: true, output: `Active tabs (${sessions.length}):\n${lines.join('\n')}` };
  }
}

export class BrowserCloseTabTool extends BrowserTool {
  #manager;

  constructor(manager) {
    super();
    this.#manager = manager;
  }

  get name() { return 'browser_close_tab'; }
  get description() { return 'Close an automated browser tab.'; }
  get parameters() {
    return {
      type: 'object',
      properties: {
        session_id: { type: 'string', description: 'Session ID to close' },
      },
      required: ['session_id'],
    };
  }
  get permission() { return 'approve'; }

  async execute({ session_id }) {
    const ok = this.#manager.close(session_id);
    if (ok) return { success: true, output: `Closed session ${session_id}` };
    return { success: false, output: '', error: 'Session not found' };
  }
}

// NOTE: BrowserScreenshotTool was removed — the active version (ScreenshotTool) lives in clawser-tools.js

// ── Workflow Recorder ──────────────────────────────────────────

/**
 * Records multi-step browser automation workflows for replay.
 */
export class WorkflowRecorder {
  #steps = [];

  /** @returns {Array<{action: string, [key: string]: any, timestamp: number}>} */
  get steps() { return [...this.#steps]; }

  /**
   * Record a workflow step.
   * @param {{ action: string, [key: string]: any }} step
   */
  addStep(step) {
    this.#steps.push({ ...step, timestamp: Date.now() });
  }

  /** Clear all recorded steps. */
  clear() {
    this.#steps = [];
  }

  /**
   * Export the workflow as a serializable object.
   * @param {string} name - Workflow name
   * @returns {{ name: string, steps: Array, createdAt: number }}
   */
  export(name) {
    return {
      name,
      steps: this.steps,
      createdAt: Date.now(),
    };
  }

  /**
   * Export the recorded workflow as a SKILL.md file for the skills system.
   * @param {string} name - Skill name
   * @param {string} description - Skill description
   * @param {object} [opts] - Additional options
   * @param {string} [opts.version='1.0.0'] - Skill version
   * @returns {string} SKILL.md content with YAML frontmatter
   */
  exportAsSkill(name, description, opts = {}) {
    const version = opts.version || '1.0.0';

    // Determine required browser tools from recorded actions
    const actionToolMap = {
      navigate: 'browser_navigate',
      click: 'browser_click',
      fill: 'browser_fill',
      select: 'browser_select',
      scroll: 'browser_scroll',
      screenshot: 'browser_screenshot',
    };
    const usedTools = new Set();
    for (const step of this.#steps) {
      const tool = actionToolMap[step.action];
      if (tool) usedTools.add(tool);
      else usedTools.add(`browser_${step.action}`);
    }

    const toolsList = [...usedTools].map(t => `    - ${t}`).join('\n');

    const frontmatter = [
      '---',
      `name: ${name}`,
      `description: ${description}`,
      `version: ${version}`,
      'requires:',
      '  tools:',
      toolsList,
      '---',
    ].join('\n');

    const stepsJson = JSON.stringify(this.steps, null, 2);
    const body = [
      `# ${name}`,
      '',
      description,
      '',
      '## Workflow Steps',
      '',
      '```json',
      stepsJson,
      '```',
    ].join('\n');

    return frontmatter + '\n\n' + body;
  }
}
