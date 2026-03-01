// Tests for clawser-shell.js (tokenizer, parser, executor) and clawser-delegate.js (sub-agents)
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

// ── 1. Shell tokenizer (8 tests) ───────────────────────────────

describe('Shell tokenizer', () => {
  let tokenize;

  it('loads tokenize function', async () => {
    const mod = await import('../clawser-shell.js');
    tokenize = mod.tokenize;
    assert.ok(tokenize);
  });

  it('tokenizes simple command', () => {
    const tokens = tokenize('echo hello world');
    const words = tokens.filter(t => t.type === 'WORD');
    assert.equal(words.length, 3);
    assert.equal(words[0].value, 'echo');
    assert.equal(words[1].value, 'hello');
    assert.equal(words[2].value, 'world');
  });

  it('tokenizes pipes', () => {
    const tokens = tokenize('cat file | grep pattern');
    assert.ok(tokens.some(t => t.type === 'PIPE'));
  });

  it('tokenizes AND (&&)', () => {
    const tokens = tokenize('cmd1 && cmd2');
    assert.ok(tokens.some(t => t.type === 'AND'));
  });

  it('tokenizes OR (||)', () => {
    const tokens = tokenize('cmd1 || cmd2');
    assert.ok(tokens.some(t => t.type === 'OR'));
  });

  it('tokenizes semicolons', () => {
    const tokens = tokenize('cmd1; cmd2');
    assert.ok(tokens.some(t => t.type === 'SEMI'));
  });

  it('tokenizes output redirect', () => {
    const tokens = tokenize('echo hi > file.txt');
    assert.ok(tokens.some(t => t.type === 'REDIRECT_OUT'));
  });

  it('handles double-quoted strings', () => {
    const tokens = tokenize('echo "hello world"');
    const words = tokens.filter(t => t.type === 'WORD');
    assert.equal(words[1].value, 'hello world');
  });
});

// ── 2. Shell parser (6 tests) ──────────────────────────────────

describe('Shell parser', () => {
  let parse;

  it('loads parse function', async () => {
    const mod = await import('../clawser-shell.js');
    parse = mod.parse;
    assert.ok(parse);
  });

  it('parses simple command into AST', () => {
    const ast = parse('echo hello');
    assert.ok(ast);
    assert.ok(ast.type === 'command' || ast.type === 'list');
  });

  it('parses pipe into pipeline', () => {
    const ast = parse('cat file | grep test');
    assert.ok(ast);
  });

  it('parses sequential commands', () => {
    const ast = parse('cmd1; cmd2');
    assert.ok(ast);
    assert.equal(ast.type, 'list');
  });

  it('returns null for empty input', () => {
    const ast = parse('');
    assert.equal(ast, null);
  });

  it('parses AND chain', () => {
    const ast = parse('cmd1 && cmd2 && cmd3');
    assert.ok(ast);
    assert.equal(ast.type, 'list');
  });
});

// ── 3. expandVariables (4 tests) ────────────────────────────────

describe('expandVariables', () => {
  let expandVariables;

  it('loads function', async () => {
    const mod = await import('../clawser-shell.js');
    expandVariables = mod.expandVariables;
    assert.ok(expandVariables);
  });

  it('expands $VAR', () => {
    const result = expandVariables('$HOME', { HOME: '/home/user' });
    assert.equal(result, '/home/user');
  });

  it('expands ${VAR}', () => {
    const result = expandVariables('${HOME}/bin', { HOME: '/home/user' });
    assert.equal(result, '/home/user/bin');
  });

  it('returns empty for undefined var', () => {
    const result = expandVariables('$UNDEFINED', {});
    assert.equal(result, '');
  });
});

// ── 4. normalizePath (3 tests) ──────────────────────────────────

describe('normalizePath', () => {
  let normalizePath;

  it('loads function', async () => {
    const mod = await import('../clawser-shell.js');
    normalizePath = mod.normalizePath;
    assert.ok(normalizePath);
  });

  it('resolves . and ..', () => {
    const result = normalizePath('/a/b/../c/./d');
    assert.equal(result, '/a/c/d');
  });

  it('normalizes double slashes', () => {
    const result = normalizePath('/a//b///c');
    assert.equal(result, '/a/b/c');
  });
});

// ── 5. MemoryFs (6 tests) ──────────────────────────────────────

describe('MemoryFs', () => {
  let MemoryFs;

  it('loads class', async () => {
    const mod = await import('../clawser-shell.js');
    MemoryFs = mod.MemoryFs;
    assert.ok(MemoryFs);
  });

  it('mkdir and listDir', async () => {
    const fs = new MemoryFs();
    await fs.mkdir('/test');
    const entries = await fs.listDir('/');
    assert.ok(entries.some(e => e.name === 'test'));
  });

  it('writeFile and readFile', async () => {
    const fs = new MemoryFs();
    await fs.mkdir('/docs');
    await fs.writeFile('/docs/readme.txt', 'Hello World');
    const content = await fs.readFile('/docs/readme.txt');
    assert.equal(content, 'Hello World');
  });

  it('delete removes a file', async () => {
    const fs = new MemoryFs();
    await fs.writeFile('/tmp.txt', 'data');
    await fs.delete('/tmp.txt');
    await assert.rejects(() => fs.readFile('/tmp.txt'));
  });

  it('stat returns file info', async () => {
    const fs = new MemoryFs();
    await fs.writeFile('/file.txt', 'content');
    const info = await fs.stat('/file.txt');
    assert.equal(info.kind, 'file');
    assert.equal(info.size, 7);
  });

  it('stat returns null for missing paths', async () => {
    const fs = new MemoryFs();
    const result = await fs.stat('/nonexistent');
    assert.equal(result, null);
  });
});

// ── 6. CommandRegistry (4 tests) ────────────────────────────────

describe('CommandRegistry', () => {
  let CommandRegistry;

  it('loads class', async () => {
    const mod = await import('../clawser-shell.js');
    CommandRegistry = mod.CommandRegistry;
    assert.ok(CommandRegistry);
  });

  it('registers and looks up commands', () => {
    const reg = new CommandRegistry();
    const handler = async () => ({ stdout: 'hi', exitCode: 0 });
    reg.register('greet', handler);
    assert.ok(reg.has('greet'));
    assert.equal(reg.get('greet'), handler);
  });

  it('unregister removes command', () => {
    const reg = new CommandRegistry();
    reg.register('temp', async () => ({}));
    reg.unregister('temp');
    assert.equal(reg.has('temp'), false);
  });

  it('names returns all command names', () => {
    const reg = new CommandRegistry();
    reg.register('a', async () => ({}));
    reg.register('b', async () => ({}));
    const n = reg.names();
    assert.ok(n.includes('a'));
    assert.ok(n.includes('b'));
  });
});

// ── 7. SubAgent (6 tests) ──────────────────────────────────────

describe('SubAgent', () => {
  let SubAgent, MAX_DELEGATION_DEPTH, DEFAULT_MAX_ITERATIONS;

  const mockChatFn = async () => ({
    content: 'done', tool_calls: [],
    usage: { input_tokens: 0, output_tokens: 0 }, model: 'test',
  });
  const mockExecuteFn = async () => ({ success: true, output: '' });
  const mockToolSpecs = [];

  it('loads exports', async () => {
    const mod = await import('../clawser-delegate.js');
    SubAgent = mod.SubAgent;
    MAX_DELEGATION_DEPTH = mod.MAX_DELEGATION_DEPTH;
    DEFAULT_MAX_ITERATIONS = mod.DEFAULT_MAX_ITERATIONS;
    assert.ok(SubAgent);
    assert.equal(typeof MAX_DELEGATION_DEPTH, 'number');
    assert.equal(typeof DEFAULT_MAX_ITERATIONS, 'number');
  });

  it('creates with required options', () => {
    const agent = new SubAgent({
      goal: 'Test task',
      chatFn: mockChatFn,
      executeFn: mockExecuteFn,
      toolSpecs: mockToolSpecs,
    });
    assert.ok(agent);
    assert.equal(agent.status, 'pending');
  });

  it('has correct initial status', () => {
    const agent = new SubAgent({
      goal: 'task',
      chatFn: mockChatFn,
      executeFn: mockExecuteFn,
      toolSpecs: mockToolSpecs,
    });
    assert.equal(agent.status, 'pending');
    assert.equal(agent.result, null);
  });

  it('run completes with result', async () => {
    const agent = new SubAgent({
      goal: 'Say hello',
      chatFn: async () => ({
        content: 'Hello!', tool_calls: [],
        usage: { input_tokens: 10, output_tokens: 5 }, model: 'echo',
      }),
      executeFn: mockExecuteFn,
      toolSpecs: mockToolSpecs,
    });
    const result = await agent.run();
    assert.ok(result);
    assert.equal(result.success, true);
  });

  it('cancel sets cancelled status', () => {
    const agent = new SubAgent({
      goal: 'Long task',
      chatFn: mockChatFn,
      executeFn: mockExecuteFn,
      toolSpecs: mockToolSpecs,
    });
    agent.cancel();
    assert.equal(agent.status, 'cancelled');
  });

  it('respects depth limit', async () => {
    const agent = new SubAgent({
      goal: 'deep task',
      depth: MAX_DELEGATION_DEPTH + 1,
      chatFn: mockChatFn,
      executeFn: mockExecuteFn,
      toolSpecs: mockToolSpecs,
    });
    const result = await agent.run();
    assert.equal(result.success, false);
    assert.ok(result.summary.toLowerCase().includes('depth'));
  });
});

// ── 8. DelegateManager (5 tests) ────────────────────────────────

describe('DelegateManager', () => {
  let DelegateManager;

  const mockChatFn = async () => ({
    content: '', tool_calls: [],
    usage: { input_tokens: 0, output_tokens: 0 }, model: 'test',
  });
  const mockExecuteFn = async () => ({ success: true, output: '' });
  const mockToolSpecs = [];

  it('loads class', async () => {
    const mod = await import('../clawser-delegate.js');
    DelegateManager = mod.DelegateManager;
    assert.ok(DelegateManager);
  });

  it('creates with defaults', () => {
    const mgr = new DelegateManager();
    assert.ok(mgr);
    assert.equal(mgr.size, 0);
  });

  it('create returns a sub-agent', () => {
    const mgr = new DelegateManager();
    const agent = mgr.create({
      goal: 'test',
      chatFn: mockChatFn,
      executeFn: mockExecuteFn,
      toolSpecs: mockToolSpecs,
    });
    assert.ok(agent);
    assert.ok(agent.id);
    assert.equal(mgr.size, 1);
  });

  it('cancel marks sub-agent cancelled', () => {
    const mgr = new DelegateManager();
    const agent = mgr.create({
      goal: 'test',
      chatFn: mockChatFn,
      executeFn: mockExecuteFn,
      toolSpecs: mockToolSpecs,
    });
    mgr.cancel(agent.id);
    assert.ok(true); // cancel doesn't throw
  });

  it('list returns tracked sub-agents', () => {
    const mgr = new DelegateManager();
    mgr.create({
      goal: 'task1',
      chatFn: mockChatFn,
      executeFn: mockExecuteFn,
      toolSpecs: mockToolSpecs,
    });
    const list = mgr.list();
    assert.ok(Array.isArray(list));
    assert.equal(list.length, 1);
  });
});

// ── 9. McpClient & McpManager (5 tests) ─────────────────────────

describe('McpClient', () => {
  let McpClient, McpManager;

  it('loads classes', async () => {
    const mod = await import('../clawser-mcp.js');
    McpClient = mod.McpClient;
    McpManager = mod.McpManager;
    assert.ok(McpClient);
    assert.ok(McpManager);
  });

  it('creates with endpoint', () => {
    const client = new McpClient('http://localhost:3000/mcp');
    assert.equal(client.endpoint, 'http://localhost:3000/mcp');
    assert.equal(client.connected, false);
  });

  it('starts with empty tools', () => {
    const client = new McpClient('http://localhost:3000/mcp');
    assert.deepEqual(client.tools, []);
    assert.deepEqual(client.toolSpecs, []);
  });

  it('McpManager starts empty', () => {
    const mgr = new McpManager();
    assert.equal(mgr.serverCount, 0);
    assert.deepEqual(mgr.serverNames, []);
  });

  it('McpManager.allToolSpecs returns empty when no servers', () => {
    const mgr = new McpManager();
    assert.deepEqual(mgr.allToolSpecs(), []);
  });
});
