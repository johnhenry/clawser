// Run with: node --import ./web/test/_setup-globals.mjs --test web/test/clawser-log.test.mjs
import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import {
  LogLevel,
  ConsoleBackend,
  CallbackBackend,
  EventLogBackend,
  LogFacade,
} from '../clawser-log.js';

// ── LogLevel ────────────────────────────────────────────────────

describe('LogLevel', () => {
  it('has correct numeric values', () => {
    assert.equal(LogLevel.DEBUG, 0);
    assert.equal(LogLevel.INFO, 1);
    assert.equal(LogLevel.WARN, 2);
    assert.equal(LogLevel.ERROR, 3);
  });

  it('is frozen', () => {
    assert.ok(Object.isFrozen(LogLevel));
  });
});

// ── ConsoleBackend ──────────────────────────────────────────────

describe('ConsoleBackend', () => {
  it('write() does not throw', () => {
    const backend = new ConsoleBackend();
    assert.doesNotThrow(() => backend.write(LogLevel.INFO, 'test', 'hello'));
  });

  it('write() with data does not throw', () => {
    const backend = new ConsoleBackend();
    assert.doesNotThrow(() => backend.write(LogLevel.DEBUG, 'mod', 'msg', { a: 1 }));
  });
});

// ── CallbackBackend ─────────────────────────────────────────────

describe('CallbackBackend', () => {
  it('invokes callback with level and formatted message', () => {
    const calls = [];
    const cb = (level, msg) => calls.push({ level, msg });
    const backend = new CallbackBackend(cb);

    backend.write(LogLevel.WARN, 'myMod', 'something happened');

    assert.equal(calls.length, 1);
    assert.equal(calls[0].level, LogLevel.WARN);
    assert.ok(calls[0].msg.includes('[myMod]'));
    assert.ok(calls[0].msg.includes('something happened'));
  });
});

// ── EventLogBackend ─────────────────────────────────────────────

describe('EventLogBackend', () => {
  it('calls eventLog.append with correct arguments', () => {
    const appended = [];
    const fakeLog = {
      append(type, data, source) { appended.push({ type, data, source }); },
    };
    const backend = new EventLogBackend(fakeLog);

    backend.write(LogLevel.ERROR, 'test', 'oops', { detail: 42 });

    assert.equal(appended.length, 1);
    assert.equal(appended[0].type, 'log');
    assert.equal(appended[0].source, 'system');
    assert.equal(appended[0].data.level, LogLevel.ERROR);
    assert.equal(appended[0].data.module, 'test');
    assert.equal(appended[0].data.message, 'oops');
    assert.deepEqual(appended[0].data.data, { detail: 42 });
  });

  it('does not throw when eventLog is null', () => {
    const backend = new EventLogBackend(null);
    assert.doesNotThrow(() => backend.write(LogLevel.INFO, 'mod', 'msg'));
  });
});

// ── LogFacade ───────────────────────────────────────────────────

describe('LogFacade', () => {
  let facade;
  let calls;
  let backend;

  beforeEach(() => {
    calls = [];
    backend = { write(level, module, msg, data) { calls.push({ level, module, msg, data }); } };
    facade = new LogFacade();
    facade.addBackend(backend);
  });

  it('dispatches to backend on log()', () => {
    facade.log(LogLevel.INFO, 'mod', 'hello');
    assert.equal(calls.length, 1);
    assert.equal(calls[0].level, LogLevel.INFO);
    assert.equal(calls[0].module, 'mod');
    assert.equal(calls[0].msg, 'hello');
  });

  it('debug/info/warn/error delegate to log()', () => {
    facade.debug('m', 'd');
    facade.info('m', 'i');
    facade.warn('m', 'w');
    facade.error('m', 'e');

    assert.equal(calls.length, 4);
    assert.equal(calls[0].level, LogLevel.DEBUG);
    assert.equal(calls[1].level, LogLevel.INFO);
    assert.equal(calls[2].level, LogLevel.WARN);
    assert.equal(calls[3].level, LogLevel.ERROR);
  });

  it('filters by facade minLevel', () => {
    facade.minLevel = LogLevel.WARN;
    facade.debug('m', 'skip');
    facade.info('m', 'skip');
    facade.warn('m', 'show');
    facade.error('m', 'show');

    assert.equal(calls.length, 2);
    assert.equal(calls[0].level, LogLevel.WARN);
    assert.equal(calls[1].level, LogLevel.ERROR);
  });

  it('filters by per-backend minLevel', () => {
    const errorCalls = [];
    const errorBackend = { write(level, module, msg) { errorCalls.push({ level, msg }); } };
    facade.addBackend(errorBackend, LogLevel.ERROR);

    facade.info('m', 'info msg');
    facade.error('m', 'err msg');

    // Default backend gets both
    assert.equal(calls.length, 2);
    // Error-only backend gets only error
    assert.equal(errorCalls.length, 1);
    assert.equal(errorCalls[0].level, LogLevel.ERROR);
  });

  it('dispatches to multiple backends', () => {
    const calls2 = [];
    const backend2 = { write(level, module, msg) { calls2.push(msg); } };
    facade.addBackend(backend2);

    facade.info('m', 'multi');
    assert.equal(calls.length, 1);
    assert.equal(calls2.length, 1);
  });

  it('removeBackend removes a backend', () => {
    facade.removeBackend(backend);
    facade.info('m', 'gone');
    assert.equal(calls.length, 0);
  });

  it('asCallback returns a bound function', () => {
    const cb = facade.asCallback('boundMod');
    cb(LogLevel.WARN, 'callback message');

    assert.equal(calls.length, 1);
    assert.equal(calls[0].module, 'boundMod');
    assert.equal(calls[0].msg, 'callback message');
  });

  it('catches backend errors without throwing', () => {
    const badBackend = { write() { throw new Error('boom'); } };
    facade.addBackend(badBackend);

    assert.doesNotThrow(() => facade.info('m', 'test'));
  });

  it('minLevel getter/setter works', () => {
    assert.equal(facade.minLevel, LogLevel.DEBUG);
    facade.minLevel = LogLevel.ERROR;
    assert.equal(facade.minLevel, LogLevel.ERROR);
  });
});
