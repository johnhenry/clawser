/**
 * Type definitions for the Clawser Virtual Server Subsystem (Phase 7).
 */

/** Handler types supported by the server subsystem. */
export type HandlerType = 'function' | 'static' | 'proxy' | 'skill';

/** Where the handler code executes. */
export type ExecutionMode = 'page' | 'sw';

/** Source of static files. */
export type StaticSource = 'opfs' | 'fsapi' | 'wsh';

/** Route scope: global or per-workspace. */
export type RouteScope = '_global' | string;

/** Handler configuration stored in a ServerRoute. */
export interface ServerHandler {
  type: HandlerType;
  execution: ExecutionMode;

  // function handler
  source?: 'opfs' | 'inline';
  path?: string;               // OPFS path to handler.js
  code?: string;               // inline JS module source

  // static handler
  staticSource?: StaticSource;
  staticRoot?: string;         // OPFS directory path
  fsapiHandle?: FileSystemDirectoryHandle;
  indexFile?: string;           // default: 'index.html'

  // proxy handler
  proxyTarget?: string;        // target URL
  proxyRewrite?: string;       // "pattern -> replacement"
  proxyHeaders?: Record<string, string>;

  // skill handler
  skillName?: string;
}

/** A server route stored in IndexedDB. */
export interface ServerRoute {
  id: string;
  hostname: string;
  port: number;
  scope: RouteScope;
  handler: ServerHandler;
  env: Record<string, string>;
  enabled: boolean;
  created: string;              // ISO 8601 timestamp
}

/** Parsed URL components from /http/{host}[:{port}]/{path}. */
export interface ParsedServerUrl {
  hostname: string;
  port: number;
  path: string;
}

/** A request log entry. */
export interface ServerLogEntry {
  ts: number;
  method: string;
  path: string;
  status: number;
  ms: number;
}

/** Context passed to function handlers. */
export interface HandlerContext {
  request: Request;
  env: Record<string, string>;
  log: {
    log(...args: unknown[]): void;
    warn(...args: unknown[]): void;
    error(...args: unknown[]): void;
    info(...args: unknown[]): void;
  };
  tools?: unknown;  // available in page-mode only
}

/** Pseudo-request sent from SW to page via MessageChannel. */
export interface PseudoRequest {
  url: string;
  method: string;
  headers: [string, string][];
  hostname: string;
  port: number;
  routeId: string;
  body?: ArrayBuffer;
}

/** Pseudo-response sent from page back to SW via MessageChannel. */
export interface PseudoResponse {
  body: ArrayBuffer | null;
  status: number;
  statusText: string;
  headers: [string, string][];
}

/** Test request result. */
export interface TestResult {
  status: number;
  statusText: string;
  headers: Record<string, string>;
  body: string;
}

/** SKILL.md frontmatter server declaration. */
export interface SkillServerConfig {
  hostname: string;
  port?: number;
  routes?: Array<{
    path: string;
    method?: string;
  }>;
}

/** ServerManager class. */
export declare class ServerManager {
  init(): Promise<void>;

  addRoute(route: Partial<ServerRoute> & { hostname: string }): Promise<string>;
  removeRoute(id: string): Promise<void>;
  updateRoute(id: string, updates: Partial<ServerRoute>): Promise<void>;
  getRoute(hostname: string, port?: number): Promise<ServerRoute | null>;
  getRouteById(id: string): Promise<ServerRoute | null>;
  listRoutes(scope?: string): Promise<ServerRoute[]>;

  startServer(id: string): Promise<void>;
  stopServer(id: string): Promise<void>;

  compileHandler(code: string): Promise<Record<string, unknown>>;
  getHandler(route: ServerRoute): Promise<Record<string, unknown> | null>;

  getLogs(routeId: string, limit?: number): ServerLogEntry[];
  testRequest(hostname: string, port?: number, path?: string, opts?: {
    method?: string;
    headers?: Record<string, string>;
    body?: string;
  }): Promise<TestResult>;

  onChange(fn: () => void): () => void;

  // Static helpers
  static createSkillHandler(
    skillName: string,
    opts?: { execution?: ExecutionMode },
  ): ServerHandler;

  static createSSEResponse(
    events: Array<{ data: string; event?: string; id?: string }>,
  ): Response;

  static createSSEResponseFromGenerator(
    generator: AsyncIterable<{ data: string; event?: string; id?: string }>,
  ): Promise<Response>;

  static executeSkillHandler(
    skillName: string,
    request: { method: string; url: string; headers: Record<string, string>; body?: string },
    registry: { get(name: string): { body?: string; metadata?: Record<string, unknown> } | null },
  ): Promise<Response>;
}

// ── SSEChannel ───────────────────────────────────────────────

export interface SSEMessage {
  type: string;
  data: string;
  timestamp?: number;
  [key: string]: unknown;
}

export declare class SSEChannel {
  constructor(id: string);
  get id(): string;
  get closed(): boolean;
  send(message: SSEMessage): void;
  drain(): SSEMessage[];
  onMessage(fn: (message: SSEMessage) => void): void;
  receive(message: SSEMessage): void;
  close(): void;
}

export declare function getServerManager(): ServerManager;
export declare function initServerManager(): Promise<ServerManager>;
