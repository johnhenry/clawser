/**
 * Type definitions for clawser-log.js
 * Unified logging facade
 */

export declare const LogLevel: Readonly<{
  DEBUG: 0;
  INFO: 1;
  WARN: 2;
  ERROR: 3;
}>;

export type LogLevelValue = 0 | 1 | 2 | 3;

export interface LogBackend {
  write(level: LogLevelValue, module: string, msg: string, data?: unknown): void;
}

export declare class ConsoleBackend implements LogBackend {
  write(level: LogLevelValue, module: string, msg: string, data?: unknown): void;
}

export declare class CallbackBackend implements LogBackend {
  constructor(cb: (level: number, msg: string) => void);
  write(level: LogLevelValue, module: string, msg: string, data?: unknown): void;
}

export declare class EventLogBackend implements LogBackend {
  constructor(eventLog: { append(type: string, data: unknown, source?: string): void });
  write(level: LogLevelValue, module: string, msg: string, data?: unknown): void;
}

export declare class LogFacade {
  constructor(opts?: { minLevel?: LogLevelValue });

  addBackend(backend: LogBackend, minLevel?: LogLevelValue): void;
  removeBackend(backend: LogBackend): void;

  minLevel: LogLevelValue;

  log(level: LogLevelValue, module: string, msg: string, data?: unknown): void;
  debug(module: string, msg: string, data?: unknown): void;
  info(module: string, msg: string, data?: unknown): void;
  warn(module: string, msg: string, data?: unknown): void;
  error(module: string, msg: string, data?: unknown): void;

  asCallback(module: string): (level: number, msg: string) => void;
}
