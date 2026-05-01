// Tests for CLI JSON output mode (--json / -j / --output json).
import { describe, it, expect, beforeEach } from 'vitest';
import {
  parseFlags,
  registerClawserCli,
  jsonOut,
  jsonErr,
  jsonLine,
  isJsonMode,
} from '../clawser-cli.js';

// ── Unit tests for exported helpers ─────────────────────────────

describe('jsonOut', () => {
  it('wraps data in { ok, command, data } envelope', () => {
    const result = jsonOut({ model: 'test-model' }, 'clawser model');
    const parsed = JSON.parse(result.stdout);
    expect(parsed.ok).toBe(true);
    expect(parsed.command).toBe('clawser model');
    expect(parsed.data.model).toBe('test-model');
    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe('');
  });

  it('stdout ends with newline', () => {
    const result = jsonOut({}, 'test');
    expect(result.stdout.endsWith('\n')).toBe(true);
  });
});

describe('jsonErr', () => {
  it('wraps error in { ok: false, command, error } envelope', () => {
    const result = jsonErr({ code: 'NO_AGENT', message: 'No agent' }, 'clawser status');
    const parsed = JSON.parse(result.stdout);
    expect(parsed.ok).toBe(false);
    expect(parsed.error.code).toBe('NO_AGENT');
    expect(parsed.error.message).toBe('No agent');
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toBe('');
  });
});

describe('jsonLine', () => {
  it('produces a valid JSON line with type and timestamp', () => {
    const line = jsonLine('status', { state: 'thinking' });
    const parsed = JSON.parse(line);
    expect(parsed.type).toBe('status');
    expect(parsed.state).toBe('thinking');
    expect(parsed.timestamp).toBeDefined();
    expect(line.endsWith('\n')).toBe(true);
  });

  it('works with no extra fields', () => {
    const line = jsonLine('done');
    const parsed = JSON.parse(line);
    expect(parsed.type).toBe('done');
    expect(parsed.timestamp).toBeDefined();
  });
});

describe('isJsonMode', () => {
  it('returns true for --json flag', () => {
    expect(isJsonMode({ json: true })).toBe(true);
  });

  it('returns true for --output json', () => {
    expect(isJsonMode({ output: 'json' })).toBe(true);
  });

  it('returns false for --output text', () => {
    expect(isJsonMode({ output: 'text' })).toBe(false);
  });

  it('returns false when no json flags', () => {
    expect(isJsonMode({})).toBe(false);
    expect(isJsonMode({ model: 'test' })).toBe(false);
  });
});

// ── parseFlags with json flags ──────────────────────────────────

describe('parseFlags json support', () => {
  const SPEC = { j: 'json', json: true, p: 'print', m: 'model' };

  it('parses --json as boolean', () => {
    const { flags } = parseFlags(['--json', 'status'], SPEC);
    expect(flags.json).toBe(true);
  });

  it('parses -j as --json', () => {
    const { flags } = parseFlags(['-j', 'status'], SPEC);
    expect(flags.json).toBe(true);
  });

  it('parses --output json as value flag', () => {
    const { flags } = parseFlags(['--output', 'json', 'status'], SPEC);
    expect(flags.output).toBe('json');
  });
});

// ── Integration: subcommands with --json via registry ───────────

/**
 * Create a fake agent with controllable state.
 */
const createMockAgent = (overrides = {}) => ({
  getModel: () => overrides.model ?? 'test-model',
  setModel: () => {},
  setSystemPrompt: () => {},
  getState: () => ({
    agent_state: 'Idle',
    history_len: 5,
    memory_count: 2,
    tool_count: 3,
    maxToolIterations: 20,
    goals: [],
    scheduler_jobs: 0,
    ...overrides.state,
  }),
  getEventLog: () => overrides.eventLog ?? { events: [] },
  getCheckpointJSON: () => ({}),
  memoryRecall: () => overrides.memories ?? [],
  memoryStore: ({ key }) => `id_${key}`,
  memoryForget: () => true,
  reinit: async () => {},
  compactContext: async () => {},
  autonomy: overrides.autonomy ?? { stats: { costTodayCents: 42 } },
  sendMessage: () => {},
  run: async () => overrides.response ?? { content: 'test response' },
});

const createMockShell = () => ({
  registry: {
    names: () => ['ls', 'cat', 'clawser'],
  },
});

/**
 * Register the CLI on a mock registry and return an executor.
 */
const setupCli = (agentOverrides = {}, { noAgent = false } = {}) => {
  const handlers = {};
  const registry = {
    register: (name, handler) => { handlers[name] = handler; },
  };
  const agent = noAgent ? null : createMockAgent(agentOverrides);
  const shell = createMockShell();
  registerClawserCli(registry, () => agent, () => shell);

  return {
    run: (argsStr) => {
      const args = argsStr.split(/\s+/).filter(Boolean);
      return handlers.clawser({ args });
    },
    /** Parse stdout as JSON (first line for JSONL) */
    runJson: async (argsStr) => {
      const result = await handlers.clawser({
        args: argsStr.split(/\s+/).filter(Boolean),
      });
      const firstLine = result.stdout.split('\n')[0];
      return { ...result, parsed: JSON.parse(firstLine) };
    },
  };
};

describe('clawser status --json', () => {
  it('returns structured JSON envelope', async () => {
    const cli = setupCli();
    const { parsed } = await cli.runJson('status --json');
    expect(parsed.ok).toBe(true);
    expect(parsed.command).toBe('clawser status');
    expect(parsed.data.model).toBe('test-model');
    expect(parsed.data.state).toBe('Idle');
    expect(parsed.data.history_len).toBe(5);
  });

  it('returns error JSON when no agent', async () => {
    const cli = setupCli({}, { noAgent: true });
    const { parsed } = await cli.runJson('status --json');
    expect(parsed.ok).toBe(false);
    expect(parsed.error.code).toBe('NO_AGENT');
  });
});

describe('clawser model --json', () => {
  it('returns current model as JSON', async () => {
    const cli = setupCli({ model: 'claude-sonnet-4-20250514' });
    const { parsed } = await cli.runJson('model --json');
    expect(parsed.ok).toBe(true);
    expect(parsed.data.model).toBe('claude-sonnet-4-20250514');
  });

  it('returns set model as JSON', async () => {
    const cli = setupCli();
    const { parsed } = await cli.runJson('model new-model --json');
    expect(parsed.ok).toBe(true);
    expect(parsed.data.model).toBe('new-model');
  });
});

describe('clawser config --json', () => {
  it('returns config data as JSON', async () => {
    const cli = setupCli();
    const { parsed } = await cli.runJson('config --json');
    expect(parsed.ok).toBe(true);
    expect(parsed.data.model).toBe('test-model');
    expect(parsed.data.tool_count).toBe(3);
  });

  it('returns set result as JSON', async () => {
    const cli = setupCli();
    const { parsed } = await cli.runJson('config set model gpt-4 --json');
    expect(parsed.ok).toBe(true);
    expect(parsed.data.key).toBe('model');
    expect(parsed.data.value).toBe('gpt-4');
  });
});

describe('clawser cost --json', () => {
  it('returns cost data as JSON', async () => {
    const cli = setupCli({ autonomy: { stats: { costTodayCents: 150 } } });
    const { parsed } = await cli.runJson('cost --json');
    expect(parsed.ok).toBe(true);
    expect(parsed.data.cost_cents).toBe(150);
    expect(parsed.data.cost_dollars).toBe(1.5);
  });
});

describe('clawser tools --json', () => {
  it('returns tools data as JSON', async () => {
    const cli = setupCli();
    const { parsed } = await cli.runJson('tools --json');
    expect(parsed.ok).toBe(true);
    expect(parsed.data.shell_commands).toEqual(['cat', 'clawser', 'ls']);
    expect(parsed.data.agent_tools).toBe(3);
  });
});

describe('clawser history --json', () => {
  it('returns empty events array when no history', async () => {
    const cli = setupCli();
    const { parsed } = await cli.runJson('history --json');
    expect(parsed.ok).toBe(true);
    expect(parsed.data.events).toEqual([]);
  });

  it('returns all events as JSON', async () => {
    const events = [
      { type: 'user_message', timestamp: Date.now(), data: { content: 'hello' } },
      { type: 'assistant_message', timestamp: Date.now(), data: { content: 'hi' } },
    ];
    const cli = setupCli({ eventLog: { events } });
    const { parsed } = await cli.runJson('history --json');
    expect(parsed.ok).toBe(true);
    expect(parsed.data.events).toHaveLength(2);
    expect(parsed.data.events[0].type).toBe('user_message');
  });
});

describe('clawser memory --json', () => {
  it('returns empty memories array', async () => {
    const cli = setupCli();
    const { parsed } = await cli.runJson('memory list --json');
    expect(parsed.ok).toBe(true);
    expect(parsed.data.memories).toEqual([]);
  });

  it('returns memories when present', async () => {
    const memories = [{ key: 'name', content: 'John', category: 'user', id: 'id_name' }];
    const cli = setupCli({ memories });
    const { parsed } = await cli.runJson('memory --json');
    expect(parsed.ok).toBe(true);
    expect(parsed.data.memories).toHaveLength(1);
    expect(parsed.data.memories[0].key).toBe('name');
  });

  it('returns add result as JSON', async () => {
    const cli = setupCli();
    const { parsed } = await cli.runJson('memory add foo bar --json');
    expect(parsed.ok).toBe(true);
    expect(parsed.data.key).toBe('foo');
    expect(parsed.data.id).toBe('id_foo');
  });
});

describe('clawser mcp --json', () => {
  it('returns mcp status as JSON', async () => {
    const cli = setupCli();
    const { parsed } = await cli.runJson('mcp --json');
    expect(parsed.ok).toBe(true);
    expect(parsed.data.agent_state).toBe('Idle');
    expect(parsed.data.total_tools).toBe(3);
  });
});

describe('clawser chat/exit --json', () => {
  it('chat returns JSON with __enterAgentMode', async () => {
    const cli = setupCli();
    const result = await cli.run('chat --json');
    const parsed = JSON.parse(result.stdout.split('\n')[0]);
    expect(parsed.ok).toBe(true);
    expect(parsed.data.mode).toBe('chat');
    expect(result.__enterAgentMode).toBe(true);
  });

  it('exit returns JSON with __exitAgentMode', async () => {
    const cli = setupCli();
    const result = await cli.run('exit --json');
    const parsed = JSON.parse(result.stdout.split('\n')[0]);
    expect(parsed.ok).toBe(true);
    expect(parsed.data.mode).toBe('exit');
    expect(result.__exitAgentMode).toBe(true);
  });
});

// ── Flag aliases ────────────────────────────────────────────────

describe('--json flag aliases', () => {
  it('-j works as alias for --json', async () => {
    const cli = setupCli();
    const { parsed } = await cli.runJson('status -j');
    expect(parsed.ok).toBe(true);
    expect(parsed.command).toBe('clawser status');
  });

  it('--output json works as alias for --json', async () => {
    const cli = setupCli();
    const { parsed } = await cli.runJson('status --output json');
    expect(parsed.ok).toBe(true);
    expect(parsed.command).toBe('clawser status');
  });
});

// ── One-shot prompt with --json ─────────────────────────────────

describe('one-shot prompt --json', () => {
  it('emits JSONL lines for prompt response', async () => {
    const cli = setupCli({ response: { content: 'Hello world' } });
    const result = await cli.run('say hello --json');
    const lines = result.stdout.trim().split('\n').map(l => JSON.parse(l));
    expect(lines).toHaveLength(3);
    expect(lines[0].type).toBe('status');
    expect(lines[0].state).toBe('thinking');
    expect(lines[1].type).toBe('message');
    expect(lines[1].role).toBe('assistant');
    expect(lines[1].content).toBe('Hello world');
    expect(lines[2].type).toBe('status');
    expect(lines[2].state).toBe('done');
  });

  it('emits JSONL via -p flag with --json', async () => {
    const cli = setupCli({ response: { content: 'pong' } });
    const result = await cli.run('-p ping --json');
    const lines = result.stdout.trim().split('\n').map(l => JSON.parse(l));
    expect(lines[1].content).toBe('pong');
  });

  it('returns error JSON when no agent', async () => {
    const cli = setupCli({}, { noAgent: true });
    const result = await cli.run('hello --json');
    const parsed = JSON.parse(result.stdout.split('\n')[0]);
    expect(parsed.ok).toBe(false);
    expect(parsed.error.code).toBe('NO_AGENT');
  });
});

// ── Default (non-JSON) output unchanged ─────────────────────────

describe('default output unchanged without --json', () => {
  it('status returns human-readable text', async () => {
    const cli = setupCli();
    const result = await cli.run('status');
    expect(result.stdout).toContain('Agent Status');
    expect(result.stdout).toContain('test-model');
    // Should NOT be valid JSON
    expect(() => JSON.parse(result.stdout)).toThrow();
  });

  it('model returns human-readable text', async () => {
    const cli = setupCli();
    const result = await cli.run('model');
    expect(result.stdout).toContain('Current model:');
  });
});
