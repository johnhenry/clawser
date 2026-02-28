import type { ToolResult } from './types.d.ts';
import { BrowserTool } from './clawser-tools.js';

export const DEFAULT_ACTION_DELAY_MS: number;
export const DEFAULT_WAIT_TIMEOUT_MS: number;
export const DEFAULT_MAX_TABS: number;
export const SELECTOR_STRATEGIES: Readonly<Record<string, string>>;
export const SENSITIVE_INPUT_TYPES: Readonly<string[]>;

export interface InteractiveElement {
  tag: string;
  type?: string;
  id?: string;
  name?: string;
  text?: string;
  selector: string;
  role?: string;
}

export interface PageSnapshot {
  url: string;
  title: string;
  text: string;
  links: Array<{ text: string; href: string }>;
  forms: Array<Record<string, unknown>>;
  interactive: InteractiveElement[];
}

export function getInteractiveElements(doc: Document): InteractiveElement[];
export function generateSelector(el: Element): string;
export function extractArticleText(doc: Document): string;
export function getFormFields(doc: Document): Array<Record<string, unknown>>;
export function getLinks(doc: Document): Array<{ text: string; href: string }>;
export function createPageSnapshot(doc: Document, url?: string): PageSnapshot;
export function resolveElement(doc: Document, opts?: { selector?: string; text?: string; index?: number }): Element | null;
export function isSensitiveField(element: Element): boolean;
export function isDomainAllowed(url: string, allowlist: string[]): boolean;
export function resetSessionCounter(): void;

export class AutomationSession {
  constructor(opts?: { id?: string; maxTabs?: number; actionDelay?: number; domainAllowlist?: string[]; createTabFn?: () => Promise<unknown>; closeTabFn?: (id: string) => Promise<void> });
  get id(): string;
  get tabCount(): number;
  get activeTabId(): string | null;
  openTab(url: string): Promise<unknown>;
  closeTab(tabId: string): Promise<void>;
  getActiveTab(): unknown | null;
  setActiveTab(tabId: string): void;
  listTabs(): Array<{ id: string; url: string }>;
}

export class AutomationManager {
  constructor(opts?: { maxSessions?: number; domainAllowlist?: string[]; createTabFn?: () => Promise<unknown>; closeTabFn?: (id: string) => Promise<void>; navigateFn?: (tab: unknown, url: string) => Promise<void>; readPageFn?: (tab: unknown) => Promise<PageSnapshot>; clickFn?: (tab: unknown, selector: string) => Promise<void>; fillFn?: (tab: unknown, selector: string, value: string) => Promise<void>; waitFn?: (tab: unknown, selector: string, timeout: number) => Promise<void>; evalFn?: (tab: unknown, code: string) => Promise<unknown> });
  get sessionCount(): number;
  getOrCreateSession(): AutomationSession;
}

export class BrowserOpenTool extends BrowserTool {
  constructor(manager: AutomationManager);
  execute(params: { url: string }): Promise<ToolResult>;
}

export class BrowserReadPageTool extends BrowserTool {
  constructor(manager: AutomationManager);
  execute(params?: { format?: string }): Promise<ToolResult>;
}

export class BrowserClickTool extends BrowserTool {
  constructor(manager: AutomationManager);
  execute(params: { selector?: string; text?: string; index?: number }): Promise<ToolResult>;
}

export class BrowserFillTool extends BrowserTool {
  constructor(manager: AutomationManager);
  execute(params: { selector: string; value: string }): Promise<ToolResult>;
}

export class BrowserWaitTool extends BrowserTool {
  constructor(manager: AutomationManager);
  execute(params: { selector: string; timeout?: number }): Promise<ToolResult>;
}

export class BrowserEvaluateTool extends BrowserTool {
  constructor(manager: AutomationManager);
  execute(params: { code: string }): Promise<ToolResult>;
}

export class BrowserListTabsTool extends BrowserTool {
  constructor(manager: AutomationManager);
  execute(): Promise<ToolResult>;
}

export class BrowserCloseTabTool extends BrowserTool {
  constructor(manager: AutomationManager);
  execute(params: { tab_id: string }): Promise<ToolResult>;
}
