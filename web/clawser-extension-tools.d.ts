// clawser-extension-tools.d.ts — Type definitions for Chrome Extension tools

import { BrowserTool, BrowserToolRegistry } from './clawser-tools.js';

/** RPC message marker constant. */
export declare const MARKER = '__clawser_ext__';

/** RPC request message. */
export interface ExtRpcRequest {
  type: typeof MARKER;
  direction: 'request';
  id: string;
  action: string;
  params: Record<string, unknown>;
}

/** RPC response message. */
export interface ExtRpcResponse {
  type: typeof MARKER;
  direction: 'response';
  id: string;
  result?: unknown;
  error?: string | null;
}

/** Presence announcement from content.js. */
export interface ExtPresenceMessage {
  type: typeof MARKER;
  direction: 'presence';
  action: 'present';
  version: string;
  capabilities: string[];
}

/** Capability detail returned by ext_capabilities. */
export interface ExtCapability {
  name: string;
  available: boolean;
  note?: string;
}

/** Tab info returned by ext_tabs_list. */
export interface ExtTabInfo {
  id: number;
  url: string;
  title: string;
  active: boolean;
  windowId: number;
  index: number;
  pinned: boolean;
  status: string;
}

/** Screenshot result. */
export interface ExtScreenshotResult {
  dataUrl: string;
  format: 'png' | 'jpeg';
}

/** Accessibility tree node from ext_read_page. */
export interface ExtAccessibilityNode {
  ref: string;
  role: string;
  name?: string;
  value?: string;
  disabled?: boolean;
  checked?: boolean;
  href?: string;
  children?: ExtAccessibilityNode[];
}

/** Console entry from ext_console. */
export interface ExtConsoleEntry {
  level: 'log' | 'warn' | 'error' | 'info' | 'debug';
  message: string;
  timestamp: number;
}

/** Network request from ext_network. */
export interface ExtNetworkEntry {
  url: string;
  method: string;
  statusCode: number;
  type: string;
  timestamp: number;
}

/** Cookie info from ext_cookies. */
export interface ExtCookieInfo {
  name: string;
  value: string;
  domain: string;
  path: string;
  secure: boolean;
  httpOnly: boolean;
  sameSite: string;
  expirationDate?: number;
}

/** WebMCP marker. */
export interface ExtWebmcpMarker {
  type: 'meta' | 'link' | 'navigator.modelContext';
  name?: string;
  content?: string;
  rel?: string;
  href?: string;
  value?: string;
}

/**
 * Promise-based RPC client for communicating with the Clawser Chrome Extension.
 */
export declare class ExtensionRpcClient {
  constructor();
  get connected(): boolean;
  get version(): string | null;
  get capabilities(): string[];
  set onStatusChange(fn: ((connected: boolean) => void) | null);
  call(action: string, params?: Record<string, unknown>): Promise<unknown>;
  destroy(): void;
}

/** Get or create the shared RPC client singleton. */
export declare function getExtensionClient(): ExtensionRpcClient;
/** Destroy the shared RPC client singleton. */
export declare function destroyExtensionClient(): void;

/** Update the extension status badge in the header. */
export declare function updateExtensionBadge(connected: boolean): void;
/** Initialize the extension badge — wire the RPC client's status callback. */
export declare function initExtensionBadge(): void;

/**
 * Coarse capability names:
 *   tabs      — chrome.tabs (tab management, navigation, screenshots)
 *   scripting — chrome.scripting (DOM, input, evaluate, console, webmcp)
 *   cookies   — chrome.cookies
 *   network   — chrome.webRequest
 */
export type ExtCapabilityName = 'tabs' | 'scripting' | 'cookies' | 'network';

/** Actionable hints for missing capabilities. */
export declare const CAPABILITY_HINTS: Record<ExtCapabilityName, string>;

// ── Tool classes ──────────────────────────────────────────────────

// Status & Info (2) — requires: null
export declare class ExtStatusTool extends BrowserTool { get requires(): null; }
export declare class ExtCapabilitiesTool extends BrowserTool { get requires(): null; }

// Tab Management (5) — requires: 'tabs'
export declare class ExtTabsListTool extends BrowserTool { get requires(): 'tabs'; }
export declare class ExtTabOpenTool extends BrowserTool { get requires(): 'tabs'; }
export declare class ExtTabCloseTool extends BrowserTool { get requires(): 'tabs'; }
export declare class ExtTabActivateTool extends BrowserTool { get requires(): 'tabs'; }
export declare class ExtTabReloadTool extends BrowserTool { get requires(): 'tabs'; }

// Navigation (3) — requires: 'tabs'
export declare class ExtNavigateTool extends BrowserTool { get requires(): 'tabs'; }
export declare class ExtGoBackTool extends BrowserTool { get requires(): 'tabs'; }
export declare class ExtGoForwardTool extends BrowserTool { get requires(): 'tabs'; }

// Screenshots & Window (3) — requires: 'tabs'
export declare class ExtScreenshotTool extends BrowserTool { get requires(): 'tabs'; }
export declare class ExtResizeTool extends BrowserTool { get requires(): 'tabs'; }
export declare class ExtZoomTool extends BrowserTool { get requires(): 'tabs'; }

// DOM & Page Reading (4) — requires: 'scripting'
export declare class ExtReadPageTool extends BrowserTool { get requires(): 'scripting'; }
export declare class ExtFindTool extends BrowserTool { get requires(): 'scripting'; }
export declare class ExtGetTextTool extends BrowserTool { get requires(): 'scripting'; }
export declare class ExtGetHtmlTool extends BrowserTool { get requires(): 'scripting'; }

// Input Simulation (9) — requires: 'scripting'
export declare class ExtClickTool extends BrowserTool { get requires(): 'scripting'; }
export declare class ExtDoubleClickTool extends BrowserTool { get requires(): 'scripting'; }
export declare class ExtTripleClickTool extends BrowserTool { get requires(): 'scripting'; }
export declare class ExtRightClickTool extends BrowserTool { get requires(): 'scripting'; }
export declare class ExtHoverTool extends BrowserTool { get requires(): 'scripting'; }
export declare class ExtDragTool extends BrowserTool { get requires(): 'scripting'; }
export declare class ExtScrollTool extends BrowserTool { get requires(): 'scripting'; }
export declare class ExtTypeTool extends BrowserTool { get requires(): 'scripting'; }
export declare class ExtKeyTool extends BrowserTool { get requires(): 'scripting'; }

// Form (2) — requires: 'scripting'
export declare class ExtFormInputTool extends BrowserTool { get requires(): 'scripting'; }
export declare class ExtSelectOptionTool extends BrowserTool { get requires(): 'scripting'; }

// Monitoring (2)
export declare class ExtConsoleTool extends BrowserTool { get requires(): 'scripting'; }
export declare class ExtNetworkTool extends BrowserTool { get requires(): 'network'; }

// Execution (2) — requires: 'scripting'
export declare class ExtEvaluateTool extends BrowserTool { get requires(): 'scripting'; }
export declare class ExtWaitTool extends BrowserTool { get requires(): 'scripting'; }

// Cookies (1) — requires: 'cookies'
export declare class ExtCookiesTool extends BrowserTool { get requires(): 'cookies'; }

// WebMCP Discovery (1) — requires: 'scripting'
export declare class ExtWebmcpDiscoverTool extends BrowserTool { get requires(): 'scripting'; }

/**
 * Register all 32 extension tools into a BrowserToolRegistry.
 */
export declare function registerExtensionTools(
  registry: BrowserToolRegistry,
  rpc?: ExtensionRpcClient,
): void;

/**
 * Create a bridge function compatible with AutomationManager.
 */
export declare function createExtensionBridge(
  rpc?: ExtensionRpcClient,
): (action: string, params?: Record<string, unknown>) => Promise<{ success: boolean; output: string; error?: string }>;
