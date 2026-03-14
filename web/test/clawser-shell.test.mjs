// clawser-shell.test.mjs — Comprehensive tests for the core shell module
// Run with: node --import ./web/test/_setup-globals.mjs --test web/test/clawser-shell.test.mjs

import { describe, it, beforeEach } from 'node:test'
import assert from 'node:assert/strict'

// Stub browser globals before importing the shell module
globalThis.BrowserTool = class { constructor() {} }
globalThis.WorkspaceFs = class {
  resolve(p) { return p }
  static isInternalPath() { return false }
  static INTERNAL_DIRS = new Set()
}

import {
  tokenize,
  parse,
  execute,
  expandVariables,
  expandCommandSubs,
  expandBraces,
  expandGlobs,
  normalizePath,
  ShellState,
  CommandRegistry,
  MemoryFs,
  ClawserShell,
  registerBuiltins,
} from '../clawser-shell.js'

// ─── Tokenizer ──────────────────────────────────────────────────────

describe('tokenize', () => {
  it('tokenizes a simple command', () => {
    const tokens = tokenize('echo hello')
    assert.equal(tokens.length, 3) // echo, hello, EOF
    assert.equal(tokens[0].type, 'WORD')
    assert.equal(tokens[0].value, 'echo')
    assert.equal(tokens[1].type, 'WORD')
    assert.equal(tokens[1].value, 'hello')
    assert.equal(tokens[2].type, 'EOF')
  })

  it('tokenizes multiple arguments', () => {
    const tokens = tokenize('echo one two three')
    const words = tokens.filter(t => t.type === 'WORD')
    assert.equal(words.length, 4)
    assert.deepEqual(words.map(w => w.value), ['echo', 'one', 'two', 'three'])
  })

  it('handles double-quoted strings', () => {
    const tokens = tokenize('echo "hello world"')
    const words = tokens.filter(t => t.type === 'WORD')
    assert.equal(words.length, 2)
    assert.equal(words[1].value, 'hello world')
  })

  it('handles single-quoted strings', () => {
    const tokens = tokenize("echo 'hello world'")
    const words = tokens.filter(t => t.type === 'WORD')
    assert.equal(words.length, 2)
    assert.equal(words[1].value, 'hello world')
  })

  it('single quotes preserve backslashes literally', () => {
    const tokens = tokenize("echo 'hello\\nworld'")
    const words = tokens.filter(t => t.type === 'WORD')
    assert.equal(words[1].value, 'hello\\nworld')
  })

  it('double quotes allow backslash escaping', () => {
    const tokens = tokenize('echo "hello\\"world"')
    const words = tokens.filter(t => t.type === 'WORD')
    assert.equal(words[1].value, 'hello"world')
  })

  it('handles backslash escape in unquoted context', () => {
    const tokens = tokenize('echo hello\\ world')
    const words = tokens.filter(t => t.type === 'WORD')
    // backslash-space escapes the space, so it becomes one word
    assert.equal(words.length, 2)
    assert.equal(words[1].value, 'hello world')
  })

  it('tokenizes pipe operator', () => {
    const tokens = tokenize('echo hello | grep hello')
    assert.ok(tokens.some(t => t.type === 'PIPE'))
    assert.equal(tokens.find(t => t.type === 'PIPE').value, '|')
  })

  it('tokenizes || (OR) operator', () => {
    const tokens = tokenize('false || echo fallback')
    assert.ok(tokens.some(t => t.type === 'OR'))
    assert.equal(tokens.find(t => t.type === 'OR').value, '||')
  })

  it('tokenizes && (AND) operator', () => {
    const tokens = tokenize('true && echo ok')
    assert.ok(tokens.some(t => t.type === 'AND'))
    assert.equal(tokens.find(t => t.type === 'AND').value, '&&')
  })

  it('tokenizes semicolon', () => {
    const tokens = tokenize('echo a; echo b')
    assert.ok(tokens.some(t => t.type === 'SEMI'))
  })

  it('tokenizes redirect out >', () => {
    const tokens = tokenize('echo hello > file.txt')
    assert.ok(tokens.some(t => t.type === 'REDIRECT_OUT'))
  })

  it('tokenizes redirect append >>', () => {
    const tokens = tokenize('echo hello >> file.txt')
    assert.ok(tokens.some(t => t.type === 'REDIRECT_APPEND'))
  })

  it('tokenizes stderr redirect 2>', () => {
    const tokens = tokenize('cmd 2> errors.log')
    assert.ok(tokens.some(t => t.type === 'REDIRECT_ERR'))
  })

  it('tokenizes stderr redirect append 2>>', () => {
    const tokens = tokenize('cmd 2>> errors.log')
    assert.ok(tokens.some(t => t.type === 'REDIRECT_ERR_APPEND'))
  })

  it('tokenizes stderr-to-stdout 2>&1', () => {
    const tokens = tokenize('cmd 2>&1')
    assert.ok(tokens.some(t => t.type === 'REDIRECT_ERR_TO_OUT'))
  })

  it('tokenizes background operator &', () => {
    const tokens = tokenize('cmd &')
    assert.ok(tokens.some(t => t.type === 'BACKGROUND'))
  })

  it('returns only EOF for empty input', () => {
    const tokens = tokenize('')
    assert.equal(tokens.length, 1)
    assert.equal(tokens[0].type, 'EOF')
  })

  it('returns only EOF for whitespace-only input', () => {
    const tokens = tokenize('   \t  ')
    assert.equal(tokens.length, 1)
    assert.equal(tokens[0].type, 'EOF')
  })

  it('handles adjacent quoted strings as a single word', () => {
    const tokens = tokenize('echo "hello""world"')
    const words = tokens.filter(t => t.type === 'WORD')
    assert.equal(words[1].value, 'helloworld')
  })

  it('handles mixed quoting in a single word', () => {
    const tokens = tokenize("echo \"hello\"'world'")
    const words = tokens.filter(t => t.type === 'WORD')
    assert.equal(words[1].value, 'helloworld')
  })

  it('handles tab as whitespace', () => {
    const tokens = tokenize("echo\thello")
    const words = tokens.filter(t => t.type === 'WORD')
    assert.equal(words.length, 2)
  })

  it('handles redirect immediately after word (no space)', () => {
    const tokens = tokenize('echo hello>file.txt')
    assert.ok(tokens.some(t => t.type === 'REDIRECT_OUT'))
  })
})

// ─── Parser ─────────────────────────────────────────────────────────

describe('parse', () => {
  it('parses a simple command', () => {
    const ast = parse('echo hello world')
    assert.equal(ast.type, 'command')
    assert.equal(ast.name, 'echo')
    assert.deepEqual(ast.args, ['hello', 'world'])
  })

  it('returns null for empty input', () => {
    const ast = parse('')
    assert.equal(ast, null)
  })

  it('parses a pipeline', () => {
    const ast = parse('echo hello | grep hello')
    assert.equal(ast.type, 'pipeline')
    assert.equal(ast.commands.length, 2)
    assert.equal(ast.commands[0].name, 'echo')
    assert.equal(ast.commands[1].name, 'grep')
  })

  it('parses a three-stage pipeline', () => {
    const ast = parse('cat file | grep foo | wc -l')
    assert.equal(ast.type, 'pipeline')
    assert.equal(ast.commands.length, 3)
  })

  it('parses && (AND) operator', () => {
    const ast = parse('true && echo ok')
    assert.equal(ast.type, 'list')
    assert.deepEqual(ast.operators, ['&&'])
    assert.equal(ast.commands.length, 2)
  })

  it('parses || (OR) operator', () => {
    const ast = parse('false || echo fallback')
    assert.equal(ast.type, 'list')
    assert.deepEqual(ast.operators, ['||'])
  })

  it('parses semicolon-separated commands', () => {
    const ast = parse('echo a; echo b')
    assert.equal(ast.type, 'list')
    assert.deepEqual(ast.operators, [';'])
    assert.equal(ast.commands.length, 2)
  })

  it('parses trailing semicolon without error', () => {
    const ast = parse('echo hello;')
    // Trailing ; may produce a list with one command or just the command
    assert.ok(ast)
  })

  it('parses redirect > with pipeline', () => {
    const ast = parse('echo hello | grep hello > out.txt')
    assert.equal(ast.type, 'pipeline')
    assert.ok(ast.redirect)
    assert.equal(ast.redirect.type, 'write')
    assert.equal(ast.redirect.path, 'out.txt')
  })

  it('parses redirect >> (append)', () => {
    const ast = parse('echo hello >> out.txt')
    assert.equal(ast.type, 'pipeline')
    assert.ok(ast.redirect)
    assert.equal(ast.redirect.type, 'append')
    assert.equal(ast.redirect.path, 'out.txt')
  })

  it('parses 2> redirect', () => {
    const ast = parse('cmd 2> err.log')
    // Single command with redirect wraps in pipeline
    assert.ok(ast)
  })

  it('parses 2>&1 redirect', () => {
    const ast = parse('cmd 2>&1')
    assert.ok(ast)
  })

  it('parses mixed operators', () => {
    const ast = parse('true && echo ok; false || echo fallback')
    assert.equal(ast.type, 'list')
    assert.equal(ast.commands.length, 4)
    assert.deepEqual(ast.operators, ['&&', ';', '||'])
  })

  it('throws SyntaxError for pipe without command after', () => {
    assert.throws(() => parse('echo hello |'), SyntaxError)
  })

  it('throws SyntaxError for && without command after', () => {
    assert.throws(() => parse('echo hello &&'), SyntaxError)
  })

  it('throws SyntaxError for redirect > without filename', () => {
    assert.throws(() => parse('echo hello >'), SyntaxError)
  })

  it('parses background operator &', () => {
    const ast = parse('echo hello &')
    assert.ok(ast)
    assert.equal(ast.background, true)
  })

  it('accepts string or pre-tokenized array', () => {
    const tokens = tokenize('echo hello')
    const ast = parse(tokens)
    assert.equal(ast.type, 'command')
    assert.equal(ast.name, 'echo')
  })
})

// ─── normalizePath ──────────────────────────────────────────────────

describe('normalizePath', () => {
  it('normalizes an absolute path', () => {
    assert.equal(normalizePath('/a/b/c'), '/a/b/c')
  })

  it('resolves . in path', () => {
    assert.equal(normalizePath('/a/./b'), '/a/b')
  })

  it('resolves .. in path', () => {
    assert.equal(normalizePath('/a/b/../c'), '/a/c')
  })

  it('resolves multiple .. traversals', () => {
    assert.equal(normalizePath('/a/b/c/../../d'), '/a/d')
  })

  it('collapses double slashes', () => {
    assert.equal(normalizePath('/a//b///c'), '/a/b/c')
  })

  it('ensures leading slash', () => {
    assert.equal(normalizePath('a/b/c'), '/a/b/c')
  })

  it('handles root path', () => {
    assert.equal(normalizePath('/'), '/')
  })

  it('handles empty string as root', () => {
    assert.equal(normalizePath(''), '/')
  })

  it('handles .. at root (stays at root)', () => {
    assert.equal(normalizePath('/..'), '/')
  })

  it('handles complex traversal', () => {
    assert.equal(normalizePath('/a/b/../../c/./d/../e'), '/c/e')
  })

  it('handles trailing slash', () => {
    assert.equal(normalizePath('/a/b/'), '/a/b')
  })

  it('handles only dots', () => {
    assert.equal(normalizePath('/./././.'), '/')
  })
})

// ─── ShellState ─────────────────────────────────────────────────────

describe('ShellState', () => {
  let state

  beforeEach(() => {
    state = new ShellState()
  })

  it('starts with cwd at /', () => {
    assert.equal(state.cwd, '/')
  })

  it('sets and gets cwd', () => {
    state.cwd = '/home'
    assert.equal(state.cwd, '/home')
  })

  it('resets cwd to / when set to empty string', () => {
    state.cwd = ''
    assert.equal(state.cwd, '/')
  })

  it('resets cwd to / when set to null', () => {
    state.cwd = null
    assert.equal(state.cwd, '/')
  })

  it('resets cwd to / when set to undefined', () => {
    state.cwd = undefined
    assert.equal(state.cwd, '/')
  })

  it('has an env map', () => {
    assert.ok(state.env instanceof Map)
  })

  it('sets and gets environment variables', () => {
    state.env.set('HOME', '/home/user')
    assert.equal(state.env.get('HOME'), '/home/user')
  })

  it('has an empty history initially', () => {
    assert.deepEqual(state.history, [])
  })

  it('tracks lastExitCode, defaulting to 0', () => {
    assert.equal(state.lastExitCode, 0)
  })

  it('has pipefail enabled by default', () => {
    assert.equal(state.pipefail, true)
  })

  it('has empty aliases map', () => {
    assert.ok(state.aliases instanceof Map)
    assert.equal(state.aliases.size, 0)
  })

  // resolvePath
  it('resolvePath returns cwd for empty path', () => {
    state.cwd = '/home'
    assert.equal(state.resolvePath(''), '/home')
  })

  it('resolvePath resolves absolute path', () => {
    state.cwd = '/home'
    assert.equal(state.resolvePath('/etc/config'), '/etc/config')
  })

  it('resolvePath resolves relative path from cwd', () => {
    state.cwd = '/home'
    assert.equal(state.resolvePath('docs'), '/home/docs')
  })

  it('resolvePath resolves relative path from root', () => {
    state.cwd = '/'
    assert.equal(state.resolvePath('docs'), '/docs')
  })

  it('resolvePath handles .. in relative path', () => {
    state.cwd = '/home/user'
    assert.equal(state.resolvePath('../other'), '/home/other')
  })

  it('resolvePath normalizes result', () => {
    state.cwd = '/home'
    assert.equal(state.resolvePath('./docs/../files'), '/home/files')
  })
})

// ─── CommandRegistry ────────────────────────────────────────────────

describe('CommandRegistry', () => {
  let reg

  beforeEach(() => {
    reg = new CommandRegistry()
  })

  it('registers and retrieves a command', () => {
    const handler = () => ({ stdout: '', stderr: '', exitCode: 0 })
    reg.register('test', handler)
    assert.equal(reg.get('test'), handler)
  })

  it('returns null for unknown command', () => {
    assert.equal(reg.get('nonexistent'), null)
  })

  it('has() returns true for registered commands', () => {
    reg.register('foo', () => {})
    assert.equal(reg.has('foo'), true)
  })

  it('has() returns false for unregistered commands', () => {
    assert.equal(reg.has('bar'), false)
  })

  it('names() returns all registered command names', () => {
    reg.register('a', () => {})
    reg.register('b', () => {})
    const names = reg.names()
    assert.ok(names.includes('a'))
    assert.ok(names.includes('b'))
    assert.equal(names.length, 2)
  })

  it('unregister removes a command', () => {
    reg.register('foo', () => {})
    assert.equal(reg.unregister('foo'), true)
    assert.equal(reg.has('foo'), false)
  })

  it('unregister returns false for missing command', () => {
    assert.equal(reg.unregister('missing'), false)
  })

  it('stores and retrieves metadata', () => {
    reg.register('ls', () => {}, { description: 'list files', category: 'File' })
    const meta = reg.getMeta('ls')
    assert.equal(meta.description, 'list files')
    assert.equal(meta.category, 'File')
  })

  it('getMeta returns null for unknown command', () => {
    assert.equal(reg.getMeta('unknown'), null)
  })

  it('allEntries returns name + meta for all commands', () => {
    reg.register('a', () => {}, { description: 'cmd a', category: 'Cat1' })
    reg.register('b', () => {}, { description: 'cmd b', category: 'Cat2' })
    const entries = reg.allEntries()
    assert.equal(entries.length, 2)
    assert.ok(entries.some(e => e.name === 'a' && e.description === 'cmd a'))
    assert.ok(entries.some(e => e.name === 'b' && e.description === 'cmd b'))
  })
})

// ─── expandVariables ────────────────────────────────────────────────

describe('expandVariables', () => {
  it('expands $VAR', () => {
    const env = new Map([['HOME', '/home/user']])
    assert.equal(expandVariables('$HOME', env), '/home/user')
  })

  it('expands ${VAR}', () => {
    const env = new Map([['NAME', 'clawser']])
    assert.equal(expandVariables('${NAME}', env), 'clawser')
  })

  it('expands $? for exit code', () => {
    const env = new Map([['?', '42']])
    assert.equal(expandVariables('$?', env), '42')
  })

  it('defaults $? to 0 when not set', () => {
    const env = new Map()
    assert.equal(expandVariables('$?', env), '0')
  })

  it('returns empty string for undefined variable', () => {
    const env = new Map()
    assert.equal(expandVariables('$MISSING', env), '')
  })

  it('preserves literal $ at end of string', () => {
    const env = new Map()
    assert.equal(expandVariables('price$', env), 'price$')
  })

  it('preserves $ followed by non-alphanumeric', () => {
    const env = new Map()
    assert.equal(expandVariables('$!', env), '$!')
  })

  it('handles multiple variables in one string', () => {
    const env = new Map([['A', 'hello'], ['B', 'world']])
    assert.equal(expandVariables('$A $B', env), 'hello world')
  })

  it('handles plain object env (not Map)', () => {
    const env = { HOME: '/root' }
    assert.equal(expandVariables('$HOME', env), '/root')
  })

  it('returns empty string for null input', () => {
    assert.equal(expandVariables(null, new Map()), '')
  })

  it('returns empty string for undefined input', () => {
    assert.equal(expandVariables(undefined, new Map()), '')
  })

  it('handles ${VAR} with no closing brace as literal $', () => {
    const env = new Map()
    assert.equal(expandVariables('${UNCLOSED', env), '${UNCLOSED')
  })

  it('handles variable with underscores', () => {
    const env = new Map([['MY_VAR_1', 'val']])
    assert.equal(expandVariables('$MY_VAR_1', env), 'val')
  })
})

// ─── expandBraces ───────────────────────────────────────────────────

describe('expandBraces', () => {
  it('expands {a,b,c}', () => {
    assert.deepEqual(expandBraces('{a,b,c}'), ['a', 'b', 'c'])
  })

  it('expands with prefix and suffix', () => {
    assert.deepEqual(expandBraces('file.{js,ts}'), ['file.js', 'file.ts'])
  })

  it('returns input array when no braces', () => {
    assert.deepEqual(expandBraces('nobraces'), ['nobraces'])
  })

  it('handles nested braces', () => {
    const result = expandBraces('{a,b{1,2}}')
    assert.deepEqual(result.sort(), ['a', 'b1', 'b2'].sort())
  })

  it('returns input when braces have no comma (literal)', () => {
    assert.deepEqual(expandBraces('{single}'), ['{single}'])
  })

  it('handles null/undefined input', () => {
    assert.deepEqual(expandBraces(null), [''])
    assert.deepEqual(expandBraces(undefined), [''])
  })

  it('handles empty string', () => {
    assert.deepEqual(expandBraces(''), [''])
  })
})

// ─── MemoryFs ───────────────────────────────────────────────────────

describe('MemoryFs', () => {
  let fs

  beforeEach(() => {
    fs = new MemoryFs()
  })

  // writeFile / readFile
  it('writes and reads a file', async () => {
    await fs.writeFile('/hello.txt', 'world')
    const content = await fs.readFile('/hello.txt')
    assert.equal(content, 'world')
  })

  it('throws ENOENT for reading nonexistent file', async () => {
    await assert.rejects(() => fs.readFile('/nope.txt'), /ENOENT/)
  })

  it('overwrites existing file', async () => {
    await fs.writeFile('/f.txt', 'v1')
    await fs.writeFile('/f.txt', 'v2')
    assert.equal(await fs.readFile('/f.txt'), 'v2')
  })

  it('auto-creates parent directories on write', async () => {
    await fs.writeFile('/a/b/c.txt', 'deep')
    const stat = await fs.stat('/a/b')
    assert.equal(stat.kind, 'directory')
  })

  // mkdir
  it('creates a directory', async () => {
    await fs.mkdir('/newdir')
    const stat = await fs.stat('/newdir')
    assert.equal(stat.kind, 'directory')
  })

  it('creates nested directories', async () => {
    await fs.mkdir('/a/b/c')
    assert.equal((await fs.stat('/a')).kind, 'directory')
    assert.equal((await fs.stat('/a/b')).kind, 'directory')
    assert.equal((await fs.stat('/a/b/c')).kind, 'directory')
  })

  // listDir
  it('lists directory contents', async () => {
    await fs.writeFile('/dir/a.txt', 'a')
    await fs.writeFile('/dir/b.txt', 'b')
    const entries = await fs.listDir('/dir')
    const names = entries.map(e => e.name).sort()
    assert.deepEqual(names, ['a.txt', 'b.txt'])
  })

  it('lists root directory', async () => {
    await fs.writeFile('/file.txt', 'content')
    await fs.mkdir('/sub')
    const entries = await fs.listDir('/')
    const names = entries.map(e => e.name)
    assert.ok(names.includes('file.txt'))
    assert.ok(names.includes('sub'))
  })

  it('distinguishes files and directories', async () => {
    await fs.writeFile('/dir/file.txt', 'x')
    await fs.mkdir('/dir/subdir')
    const entries = await fs.listDir('/dir')
    const fileEntry = entries.find(e => e.name === 'file.txt')
    const dirEntry = entries.find(e => e.name === 'subdir')
    assert.equal(fileEntry.kind, 'file')
    assert.equal(dirEntry.kind, 'directory')
  })

  it('throws ENOENT for listing nonexistent directory', async () => {
    await assert.rejects(() => fs.listDir('/nonexistent'), /ENOENT/)
  })

  // delete
  it('deletes a file', async () => {
    await fs.writeFile('/f.txt', 'content')
    await fs.delete('/f.txt')
    assert.equal(await fs.stat('/f.txt'), null)
  })

  it('deletes an empty directory', async () => {
    await fs.mkdir('/emptydir')
    await fs.delete('/emptydir')
    assert.equal(await fs.stat('/emptydir'), null)
  })

  it('throws for non-recursive delete of non-empty directory', async () => {
    await fs.writeFile('/dir/file.txt', 'content')
    await assert.rejects(() => fs.delete('/dir', false), /not empty/i)
  })

  it('recursive delete removes directory and contents', async () => {
    await fs.writeFile('/dir/a.txt', 'a')
    await fs.writeFile('/dir/sub/b.txt', 'b')
    await fs.delete('/dir', true)
    assert.equal(await fs.stat('/dir'), null)
    assert.equal(await fs.stat('/dir/a.txt'), null)
  })

  it('throws ENOENT for deleting nonexistent path', async () => {
    await assert.rejects(() => fs.delete('/nope'), /ENOENT/)
  })

  // copy / move
  it('copies a file', async () => {
    await fs.writeFile('/src.txt', 'data')
    await fs.copy('/src.txt', '/dst.txt')
    assert.equal(await fs.readFile('/dst.txt'), 'data')
    assert.equal(await fs.readFile('/src.txt'), 'data')
  })

  it('moves a file', async () => {
    await fs.writeFile('/src.txt', 'data')
    await fs.move('/src.txt', '/dst.txt')
    assert.equal(await fs.readFile('/dst.txt'), 'data')
    assert.equal(await fs.stat('/src.txt'), null)
  })

  // stat
  it('stat returns file info', async () => {
    await fs.writeFile('/f.txt', 'hello')
    const st = await fs.stat('/f.txt')
    assert.equal(st.kind, 'file')
    assert.equal(st.size, 5)
  })

  it('stat returns directory info', async () => {
    await fs.mkdir('/d')
    const st = await fs.stat('/d')
    assert.equal(st.kind, 'directory')
  })

  it('stat returns null for nonexistent path', async () => {
    assert.equal(await fs.stat('/nope'), null)
  })

  // path normalization
  it('normalizes paths on read/write', async () => {
    await fs.writeFile('/a/./b/../c.txt', 'normalized')
    assert.equal(await fs.readFile('/a/c.txt'), 'normalized')
  })
})

// ─── execute (AST executor) ─────────────────────────────────────────

describe('execute', () => {
  let state, registry, fs

  beforeEach(() => {
    state = new ShellState()
    registry = new CommandRegistry()
    fs = new MemoryFs()
    registerBuiltins(registry)
  })

  async function run(cmd) {
    const ast = parse(cmd)
    return execute(ast, state, registry, { fs })
  }

  it('executes a simple command', async () => {
    const result = await run('echo hello')
    assert.equal(result.stdout, 'hello\n')
    assert.equal(result.exitCode, 0)
  })

  it('returns exit code 127 for unknown command', async () => {
    const result = await run('nonexistent_cmd')
    assert.equal(result.exitCode, 127)
    assert.ok(result.stderr.includes('command not found'))
  })

  it('sets lastExitCode on state', async () => {
    await run('false')
    assert.equal(state.lastExitCode, 1)
    await run('true')
    assert.equal(state.lastExitCode, 0)
  })

  it('returns empty result for null AST', async () => {
    const result = await execute(null, state, registry)
    assert.equal(result.stdout, '')
    assert.equal(result.exitCode, 0)
  })

  it('returns error for unknown AST node type', async () => {
    const result = await execute({ type: 'bogus' }, state, registry)
    assert.equal(result.exitCode, 1)
    assert.ok(result.stderr.includes('Unknown AST node'))
  })

  // Pipelines
  it('executes a pipeline', async () => {
    const result = await run('echo "a\nb\nc" | grep b')
    assert.ok(result.stdout.includes('b'))
  })

  it('passes stdout as stdin through pipe', async () => {
    const result = await run('echo "3\n1\n2" | sort')
    assert.equal(result.stdout, '1\n2\n3\n')
  })

  // Logical operators
  it('&& skips second command on failure', async () => {
    const result = await run('false && echo should-not-appear')
    assert.ok(!result.stdout.includes('should-not-appear'))
  })

  it('&& runs second command on success', async () => {
    const result = await run('true && echo appeared')
    assert.ok(result.stdout.includes('appeared'))
  })

  it('|| runs second command on failure', async () => {
    const result = await run('false || echo fallback')
    assert.ok(result.stdout.includes('fallback'))
  })

  it('|| skips second command on success', async () => {
    const result = await run('true || echo should-not-appear')
    assert.ok(!result.stdout.includes('should-not-appear'))
  })

  // Semicolons
  it('; runs both commands regardless', async () => {
    const result = await run('false; echo hello')
    assert.ok(result.stdout.includes('hello'))
  })

  // Variable expansion
  it('expands $VAR in args', async () => {
    state.env.set('NAME', 'clawser')
    const result = await run('echo $NAME')
    assert.equal(result.stdout, 'clawser\n')
  })

  it('expands $? to last exit code', async () => {
    await run('false')
    const result = await run('echo $?')
    assert.equal(result.stdout, '1\n')
  })

  // Variable assignment
  it('handles bare variable assignment', async () => {
    await run('FOO=bar')
    assert.equal(state.env.get('FOO'), 'bar')
  })

  // Alias expansion
  it('expands aliases', async () => {
    state.aliases.set('ll', 'echo aliased')
    const result = await run('ll')
    assert.ok(result.stdout.includes('aliased'))
  })

  // Redirects
  it('redirect > writes stdout to file', async () => {
    await run('echo content > /out.txt')
    assert.equal(await fs.readFile('/out.txt'), 'content\n')
  })

  it('redirect >> appends to file', async () => {
    await fs.writeFile('/out.txt', 'first\n')
    await run('echo second >> /out.txt')
    assert.equal(await fs.readFile('/out.txt'), 'first\nsecond\n')
  })

  // Pipefail
  it('pipefail aborts pipeline on non-zero exit', async () => {
    state.pipefail = true
    const result = await run('false | echo should-not-reach')
    // With pipefail, the pipeline stops at the first failure
    assert.equal(result.exitCode, 1)
  })
})

// ─── ClawserShell ───────────────────────────────────────────────────

describe('ClawserShell', () => {
  let shell

  beforeEach(() => {
    shell = new ClawserShell({ fs: new MemoryFs() })
  })

  it('creates with default builtins registered', () => {
    assert.ok(shell.registry.has('echo'))
    assert.ok(shell.registry.has('cd'))
    assert.ok(shell.registry.has('ls'))
    assert.ok(shell.registry.has('cat'))
  })

  it('exec runs a simple command', async () => {
    const result = await shell.exec('echo hello')
    assert.equal(result.stdout, 'hello\n')
    assert.equal(result.exitCode, 0)
  })

  it('exec returns empty for null/empty command', async () => {
    const r1 = await shell.exec('')
    assert.equal(r1.exitCode, 0)
    const r2 = await shell.exec(null)
    assert.equal(r2.exitCode, 0)
  })

  it('exec returns syntax error for invalid syntax', async () => {
    const result = await shell.exec('echo hello |')
    assert.equal(result.exitCode, 2)
    assert.ok(result.stderr.includes('syntax error'))
  })

  it('records command in history', async () => {
    await shell.exec('echo test')
    assert.ok(shell.state.history.includes('echo test'))
  })

  it('exec runs pipes', async () => {
    const result = await shell.exec('echo "hello world" | grep hello')
    assert.ok(result.stdout.includes('hello'))
    assert.equal(result.exitCode, 0)
  })

  it('exec runs && chains', async () => {
    const result = await shell.exec('true && echo ok')
    assert.ok(result.stdout.includes('ok'))
  })

  it('exec runs || chains', async () => {
    const result = await shell.exec('false || echo fallback')
    assert.ok(result.stdout.includes('fallback'))
  })

  it('cwd management through cd', async () => {
    await shell.exec('mkdir /mydir')
    await shell.exec('cd /mydir')
    assert.equal(shell.state.cwd, '/mydir')
  })

  it('pwd reports current directory', async () => {
    await shell.exec('mkdir /mydir')
    await shell.exec('cd /mydir')
    const result = await shell.exec('pwd')
    assert.equal(result.stdout, '/mydir\n')
  })

  // Background jobs
  it('exec with & creates a background job', async () => {
    const result = await shell.exec('echo bg &')
    assert.ok(result.stdout.includes('started'))
    assert.ok(result.jobId > 0)
  })

  it('jobs() lists active jobs', async () => {
    await shell.exec('echo bg &')
    // Give it a tick to settle
    const jobs = shell.jobs()
    assert.ok(jobs.length > 0)
    assert.ok(jobs[0].id > 0)
  })

  // Package management
  it('installPackage registers commands', () => {
    shell.installPackage({
      name: 'mypkg',
      commands: {
        mycmd: () => ({ stdout: 'pkg output\n', stderr: '', exitCode: 0 }),
      },
    })
    assert.ok(shell.registry.has('mycmd'))
  })

  it('installed package command is executable', async () => {
    shell.installPackage({
      name: 'mypkg',
      commands: {
        mycmd: () => ({ stdout: 'pkg output\n', stderr: '', exitCode: 0 }),
      },
    })
    const result = await shell.exec('mycmd')
    assert.ok(result.stdout.includes('pkg output'))
  })

  it('uninstallPackage removes commands', () => {
    shell.installPackage({
      name: 'mypkg',
      commands: { mycmd: () => ({}) },
    })
    shell.uninstallPackage('mypkg')
    assert.equal(shell.registry.has('mycmd'), false)
  })

  it('listPackages returns installed package info', () => {
    shell.installPackage({
      name: 'test-pkg',
      commands: { tpc: () => ({}) },
    })
    const pkgs = shell.listPackages()
    assert.equal(pkgs.length, 1)
    assert.equal(pkgs[0].name, 'test-pkg')
    assert.deepEqual(pkgs[0].commands, ['tpc'])
  })

  it('installPackage throws for missing name', () => {
    assert.throws(() => shell.installPackage({}), /name/)
  })

  it('installPackage throws for missing commands', () => {
    assert.throws(() => shell.installPackage({ name: 'x' }), /commands/)
  })

  // Source
  it('source executes file lines as commands', async () => {
    await shell.exec('echo "export FOO=bar" > /init.sh')
    await shell.source('/init.sh')
    assert.equal(shell.state.env.get('FOO'), 'bar')
  })

  // Accepts pre-built registry
  it('accepts a pre-built registry', () => {
    const reg = new CommandRegistry()
    reg.register('custom', () => ({ stdout: 'custom\n', stderr: '', exitCode: 0 }))
    const s = new ClawserShell({ registry: reg })
    assert.ok(s.registry.has('custom'))
    // Should NOT have default builtins since we passed our own registry
    assert.equal(s.registry.has('echo'), false)
  })
})

// ─── Built-in commands (via execute) ────────────────────────────────

describe('Built-in commands via shell.exec', () => {
  let shell, fs

  beforeEach(() => {
    fs = new MemoryFs()
    shell = new ClawserShell({ fs })
  })

  // echo
  it('echo outputs args with newline', async () => {
    const r = await shell.exec('echo hello world')
    assert.equal(r.stdout, 'hello world\n')
  })

  // true / false
  it('true returns exitCode 0', async () => {
    assert.equal((await shell.exec('true')).exitCode, 0)
  })

  it('false returns exitCode 1', async () => {
    assert.equal((await shell.exec('false')).exitCode, 1)
  })

  // cat
  it('cat reads file content', async () => {
    await fs.writeFile('/hello.txt', 'content')
    const r = await shell.exec('cat /hello.txt')
    assert.equal(r.stdout, 'content')
    assert.equal(r.exitCode, 0)
  })

  it('cat with no args passes through stdin (via pipe)', async () => {
    const r = await shell.exec('echo hello | cat')
    assert.equal(r.stdout, 'hello\n')
  })

  // mkdir
  it('mkdir creates directory', async () => {
    await shell.exec('mkdir /newdir')
    assert.equal((await fs.stat('/newdir')).kind, 'directory')
  })

  // rm
  it('rm deletes a file', async () => {
    await fs.writeFile('/f.txt', 'x')
    await shell.exec('rm /f.txt')
    assert.equal(await fs.stat('/f.txt'), null)
  })

  it('rm -r deletes directory recursively', async () => {
    await fs.writeFile('/d/f.txt', 'x')
    await shell.exec('rm -r /d')
    assert.equal(await fs.stat('/d'), null)
  })

  // cp / mv
  it('cp copies a file', async () => {
    await fs.writeFile('/a.txt', 'data')
    await shell.exec('cp /a.txt /b.txt')
    assert.equal(await fs.readFile('/b.txt'), 'data')
    assert.equal(await fs.readFile('/a.txt'), 'data')
  })

  it('mv moves a file', async () => {
    await fs.writeFile('/a.txt', 'data')
    await shell.exec('mv /a.txt /b.txt')
    assert.equal(await fs.readFile('/b.txt'), 'data')
    assert.equal(await fs.stat('/a.txt'), null)
  })

  // head / tail
  it('head returns first N lines', async () => {
    const r = await shell.exec('echo "1\n2\n3\n4\n5" | head -n 2')
    const lines = r.stdout.trim().split('\n')
    assert.equal(lines[0], '1')
    assert.equal(lines[1], '2')
  })

  it('tail returns last N lines', async () => {
    const r = await shell.exec('echo "1\n2\n3\n4\n5" | tail -n 2')
    const lines = r.stdout.trim().split('\n')
    assert.ok(lines.includes('4'))
    assert.ok(lines.includes('5'))
  })

  // grep
  it('grep filters matching lines', async () => {
    const r = await shell.exec('echo "apple\nbanana\napricot" | grep ap')
    assert.ok(r.stdout.includes('apple'))
    assert.ok(r.stdout.includes('apricot'))
    assert.ok(!r.stdout.includes('banana'))
  })

  it('grep returns exitCode 1 on no match', async () => {
    const r = await shell.exec('echo hello | grep xyz')
    assert.equal(r.exitCode, 1)
  })

  // wc
  it('wc -l counts lines', async () => {
    const r = await shell.exec('echo "a\nb\nc" | wc -l')
    // "a\nb\nc\n" -> 4 lines? depends on echo behavior. echo adds trailing newline
    assert.ok(r.stdout.trim().match(/\d+/))
    assert.equal(r.exitCode, 0)
  })

  // sort
  it('sort orders lines alphabetically', async () => {
    const r = await shell.exec('echo "c\na\nb" | sort')
    const lines = r.stdout.trim().split('\n')
    assert.deepEqual(lines, ['a', 'b', 'c'])
  })

  // uniq
  it('uniq removes adjacent duplicates', async () => {
    const r = await shell.exec('echo "a\na\nb\nb\na" | uniq')
    const lines = r.stdout.trim().split('\n')
    assert.deepEqual(lines, ['a', 'b', 'a'])
  })

  // env / export
  it('export sets env var readable by echo', async () => {
    await shell.exec('export MYVAR=hello')
    const r = await shell.exec('echo $MYVAR')
    assert.equal(r.stdout, 'hello\n')
  })

  it('env lists variables', async () => {
    await shell.exec('export A=1')
    await shell.exec('export B=2')
    const r = await shell.exec('env')
    assert.ok(r.stdout.includes('A=1'))
    assert.ok(r.stdout.includes('B=2'))
  })

  // which
  it('which finds a builtin', async () => {
    const r = await shell.exec('which echo')
    assert.ok(r.stdout.includes('shell built-in'))
    assert.equal(r.exitCode, 0)
  })

  it('which returns exitCode 1 for missing command', async () => {
    const r = await shell.exec('which nonexistent')
    assert.equal(r.exitCode, 1)
  })

  // help
  it('help lists commands', async () => {
    const r = await shell.exec('help')
    assert.ok(r.stdout.includes('echo'))
    assert.equal(r.exitCode, 0)
  })

  it('help for specific command shows usage', async () => {
    const r = await shell.exec('help echo')
    assert.ok(r.stdout.includes('echo'))
    assert.equal(r.exitCode, 0)
  })
})

// ─── expandGlobs ────────────────────────────────────────────────────

describe('expandGlobs', () => {
  it('returns token unchanged when no glob chars', async () => {
    const result = await expandGlobs('hello', {}, '/')
    assert.deepEqual(result, ['hello'])
  })

  it('returns token unchanged when no fs', async () => {
    const result = await expandGlobs('*.txt', null, '/')
    assert.deepEqual(result, ['*.txt'])
  })

  it('expands * wildcard against directory entries', async () => {
    const mockFs = {
      listDir: async () => [
        { name: 'foo.txt', isDirectory: false },
        { name: 'bar.txt', isDirectory: false },
        { name: 'baz.js', isDirectory: false },
      ],
    }
    const result = await expandGlobs('*.txt', mockFs, '/')
    assert.ok(result.includes('foo.txt'))
    assert.ok(result.includes('bar.txt'))
    assert.ok(!result.includes('baz.js'))
  })

  it('expands ? wildcard', async () => {
    const mockFs = {
      listDir: async () => [
        { name: 'a1', isDirectory: false },
        { name: 'a2', isDirectory: false },
        { name: 'abc', isDirectory: false },
      ],
    }
    const result = await expandGlobs('a?', mockFs, '/')
    assert.ok(result.includes('a1'))
    assert.ok(result.includes('a2'))
    assert.ok(!result.includes('abc'))
  })

  it('returns original token when no matches found', async () => {
    const mockFs = {
      listDir: async () => [{ name: 'nope.py', isDirectory: false }],
    }
    const result = await expandGlobs('*.txt', mockFs, '/')
    assert.deepEqual(result, ['*.txt'])
  })

  it('handles {a,b} brace expansion with glob', async () => {
    const mockFs = {
      listDir: async () => [
        { name: 'foo.js', isDirectory: false },
        { name: 'foo.ts', isDirectory: false },
        { name: 'foo.py', isDirectory: false },
      ],
    }
    const result = await expandGlobs('foo.{js,ts}', mockFs, '/')
    assert.ok(result.includes('foo.js'))
    assert.ok(result.includes('foo.ts'))
    assert.ok(!result.includes('foo.py'))
  })
})

// ─── expandCommandSubs ──────────────────────────────────────────────

describe('expandCommandSubs', () => {
  it('substitutes $(cmd) with command output', async () => {
    const executor = async () => ({ stdout: 'result', stderr: '', exitCode: 0 })
    const out = await expandCommandSubs('$(cmd)', executor)
    assert.equal(out, 'result')
  })

  it('handles multiple substitutions', async () => {
    let call = 0
    const executor = async () => {
      call++
      return { stdout: `v${call}`, stderr: '', exitCode: 0 }
    }
    const out = await expandCommandSubs('$(a)-$(b)', executor)
    assert.equal(out, 'v1-v2')
  })

  it('strips trailing newlines from output', async () => {
    const executor = async () => ({ stdout: 'value\n\n', stderr: '', exitCode: 0 })
    const out = await expandCommandSubs('$(cmd)', executor)
    assert.equal(out, 'value')
  })

  it('preserves text without $()', async () => {
    const executor = async () => ({ stdout: 'X', stderr: '', exitCode: 0 })
    const out = await expandCommandSubs('no subs here', executor)
    assert.equal(out, 'no subs here')
  })

  it('returns empty string for null input', async () => {
    assert.equal(await expandCommandSubs(null, async () => ({})), '')
  })

  it('returns token as-is without executor', async () => {
    assert.equal(await expandCommandSubs('$(cmd)', null), '$(cmd)')
  })

  it('handles escaped \\$() as literal', async () => {
    const executor = async () => ({ stdout: 'X', stderr: '', exitCode: 0 })
    const out = await expandCommandSubs('literal \\$(cmd)', executor)
    assert.ok(out.includes('$(cmd)'))
  })
})
