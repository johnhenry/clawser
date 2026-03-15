// clawser-shell-core.test.mjs — Focused tests for tokenizer, parser, executor,
// variable expansion, and glob expansion in the shell core.
// Run with: node --import ./web/test/_setup-globals.mjs --test web/test/clawser-shell-core.test.mjs

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
  expandGlobs,
  expandBraces,
  normalizePath,
  ShellState,
  CommandRegistry,
  MemoryFs,
} from '../clawser-shell.js'

// ─── Helpers ─────────────────────────────────────────────────────

/** Return only WORD tokens from a tokenized input. */
function words(input) {
  return tokenize(input).filter(t => t.type === 'WORD').map(t => t.value)
}

/** Return token types (excluding EOF) from a tokenized input. */
function types(input) {
  return tokenize(input).filter(t => t.type !== 'EOF').map(t => t.type)
}

/** Build a minimal shell environment for executor tests. */
function makeShell() {
  const state = new ShellState()
  const registry = new CommandRegistry()
  const fs = new MemoryFs()

  // Register basic builtins for testing
  registry.register('echo', async ({ args }) => ({
    stdout: args.join(' ') + '\n', stderr: '', exitCode: 0,
  }))

  registry.register('pwd', async ({ state: s }) => ({
    stdout: s.cwd + '\n', stderr: '', exitCode: 0,
  }))

  registry.register('env', async ({ state: s }) => {
    const lines = []
    if (s.env instanceof Map) {
      for (const [k, v] of s.env) lines.push(`${k}=${v}`)
    }
    return { stdout: lines.join('\n') + '\n', stderr: '', exitCode: 0 }
  })

  registry.register('true', async () => ({
    stdout: '', stderr: '', exitCode: 0,
  }))

  registry.register('false', async () => ({
    stdout: '', stderr: '', exitCode: 1,
  }))

  registry.register('cat', async ({ stdin }) => ({
    stdout: stdin || '', stderr: '', exitCode: 0,
  }))

  registry.register('upper', async ({ stdin }) => ({
    stdout: (stdin || '').toUpperCase(), stderr: '', exitCode: 0,
  }))

  return { state, registry, fs }
}

// ─── 1. Tokenizer ────────────────────────────────────────────────

describe('Tokenizer', () => {
  it('splits a simple command into word tokens', () => {
    assert.deepEqual(words('ls -la /tmp'), ['ls', '-la', '/tmp'])
  })

  it('recognises pipe, AND, OR, semicolon operators', () => {
    assert.deepEqual(types('a | b && c || d ; e'), [
      'WORD', 'PIPE', 'WORD', 'AND', 'WORD', 'OR', 'WORD', 'SEMI', 'WORD',
    ])
  })

  it('handles double-quoted strings preserving spaces', () => {
    assert.deepEqual(words('echo "hello world"'), ['echo', 'hello world'])
  })

  it('handles single-quoted strings preserving backslashes', () => {
    assert.deepEqual(words("echo 'a\\nb'"), ['echo', 'a\\nb'])
  })

  it('handles backslash escaping in unquoted context', () => {
    // backslash-space joins the two parts into one word
    assert.deepEqual(words('echo hello\\ world'), ['echo', 'hello world'])
  })

  it('tokenises redirect operators >, >>, 2>, 2>>, 2>&1', () => {
    const toks = tokenize('cmd > out 2>> err 2>&1')
    const opTypes = toks.filter(t => t.type !== 'WORD' && t.type !== 'EOF').map(t => t.type)
    assert.deepEqual(opTypes, ['REDIRECT_OUT', 'REDIRECT_ERR_APPEND', 'REDIRECT_ERR_TO_OUT'])
  })

  it('returns EOF as last token for any input', () => {
    const empty = tokenize('')
    assert.equal(empty.length, 1)
    assert.equal(empty[0].type, 'EOF')

    const normal = tokenize('x')
    assert.equal(normal[normal.length - 1].type, 'EOF')
  })
})

// ─── 2. Parser ───────────────────────────────────────────────────

describe('Parser', () => {
  it('parses a single command into a command node', () => {
    const ast = parse('echo hello world')
    assert.equal(ast.type, 'command')
    assert.equal(ast.name, 'echo')
    assert.deepEqual(ast.args, ['hello', 'world'])
  })

  it('parses a pipe into a pipeline node', () => {
    const ast = parse('cat file | grep foo')
    assert.equal(ast.type, 'pipeline')
    assert.equal(ast.commands.length, 2)
    assert.equal(ast.commands[0].name, 'cat')
    assert.equal(ast.commands[1].name, 'grep')
  })

  it('parses logical AND (&&) into a list node', () => {
    const ast = parse('true && echo yes')
    assert.equal(ast.type, 'list')
    assert.deepEqual(ast.operators, ['&&'])
    assert.equal(ast.commands.length, 2)
  })

  it('parses logical OR (||) into a list node', () => {
    const ast = parse('false || echo fallback')
    assert.equal(ast.type, 'list')
    assert.deepEqual(ast.operators, ['||'])
  })

  it('parses semicolons into a list with ";" operators', () => {
    const ast = parse('a ; b ; c')
    assert.equal(ast.type, 'list')
    assert.deepEqual(ast.operators, [';', ';'])
    assert.equal(ast.commands.length, 3)
  })

  it('attaches redirect info to a pipeline node', () => {
    const ast = parse('echo hi > out.txt')
    assert.equal(ast.type, 'pipeline')
    assert.ok(ast.redirect)
    assert.equal(ast.redirect.type, 'write')
    assert.equal(ast.redirect.path, 'out.txt')
  })

  it('returns null for empty input', () => {
    assert.equal(parse(''), null)
    assert.equal(parse('   '), null)
  })
})

// ─── 3. Built-in Commands (echo, pwd, env) ──────────────────────

describe('Built-in commands via executor', () => {
  it('echo joins arguments with spaces', async () => {
    const { state, registry, fs } = makeShell()
    const ast = parse('echo hello world')
    const result = await execute(ast, state, registry, { fs })
    assert.equal(result.stdout, 'hello world\n')
    assert.equal(result.exitCode, 0)
  })

  it('pwd returns the current working directory', async () => {
    const { state, registry, fs } = makeShell()
    state.cwd = '/home'
    const ast = parse('pwd')
    const result = await execute(ast, state, registry, { fs })
    assert.equal(result.stdout, '/home\n')
  })

  it('env lists environment variables', async () => {
    const { state, registry, fs } = makeShell()
    state.env.set('FOO', 'bar')
    state.env.set('BAZ', '42')
    const ast = parse('env')
    const result = await execute(ast, state, registry, { fs })
    assert.ok(result.stdout.includes('FOO=bar'))
    assert.ok(result.stdout.includes('BAZ=42'))
  })

  it('returns exit code 127 for unknown commands', async () => {
    const { state, registry, fs } = makeShell()
    const ast = parse('nosuchcmd')
    const result = await execute(ast, state, registry, { fs })
    assert.equal(result.exitCode, 127)
    assert.ok(result.stderr.includes('command not found'))
  })
})

// ─── 4. Variable Expansion ──────────────────────────────────────

describe('Variable expansion', () => {
  it('expands $VAR using a plain object env', () => {
    assert.equal(expandVariables('$HOME', { HOME: '/usr' }), '/usr')
  })

  it('expands ${VAR} braced syntax', () => {
    assert.equal(expandVariables('${USER}', { USER: 'alice' }), 'alice')
  })

  it('expands $? to the last exit code', () => {
    const env = new Map([['?', '42']])
    assert.equal(expandVariables('exit=$?', env), 'exit=42')
  })

  it('leaves undefined variables as empty string', () => {
    assert.equal(expandVariables('$NOPE', {}), '')
  })

  it('preserves literal $ at end of string or before non-alpha', () => {
    assert.equal(expandVariables('cost$', {}), 'cost$')
    assert.equal(expandVariables('$1', {}), '$1')
  })

  it('expands variables during command execution', async () => {
    const { state, registry, fs } = makeShell()
    state.env.set('GREETING', 'hi')
    const ast = parse('echo $GREETING')
    const result = await execute(ast, state, registry, { fs })
    assert.equal(result.stdout, 'hi\n')
  })
})

// ─── 5. Glob Expansion ──────────────────────────────────────────

describe('Glob expansion', () => {
  let fs

  beforeEach(async () => {
    fs = new MemoryFs()
    await fs.writeFile('/readme.md', '# readme')
    await fs.writeFile('/notes.txt', 'notes')
    await fs.writeFile('/data.csv', 'a,b')
    await fs.writeFile('/src/app.js', 'code')
  })

  it('expands * to matching files in cwd', async () => {
    const matches = await expandGlobs('*.txt', fs, '/')
    assert.deepEqual(matches, ['notes.txt'])
  })

  it('expands ? single-character wildcard', async () => {
    await fs.writeFile('/a1', '')
    await fs.writeFile('/a2', '')
    await fs.writeFile('/ab', '')
    const matches = await expandGlobs('a?', fs, '/')
    assert.ok(matches.includes('a1'))
    assert.ok(matches.includes('a2'))
    assert.ok(matches.includes('ab'))
  })

  it('returns original token when no matches found', async () => {
    const matches = await expandGlobs('*.xyz', fs, '/')
    assert.deepEqual(matches, ['*.xyz'])
  })

  it('passes through tokens without glob characters', async () => {
    const matches = await expandGlobs('plain', fs, '/')
    assert.deepEqual(matches, ['plain'])
  })
})

// ─── 6. Executor — Pipes and Logical Operators ──────────────────

describe('Executor — pipes and logical operators', () => {
  it('pipes stdout from one command to stdin of the next', async () => {
    const { state, registry, fs } = makeShell()
    const ast = parse('echo hello | upper')
    const result = await execute(ast, state, registry, { fs })
    assert.equal(result.stdout, 'HELLO\n')
  })

  it('&& skips second command when first fails', async () => {
    const { state, registry, fs } = makeShell()
    const ast = parse('false && echo nope')
    const result = await execute(ast, state, registry, { fs })
    assert.equal(result.exitCode, 1)
    assert.equal(result.stdout, '')
  })

  it('|| runs second command only when first fails', async () => {
    const { state, registry, fs } = makeShell()
    const ast = parse('false || echo fallback')
    const result = await execute(ast, state, registry, { fs })
    assert.equal(result.stdout, 'fallback\n')
    assert.equal(result.exitCode, 0)
  })

  it('semicolons run commands sequentially regardless of exit code', async () => {
    const { state, registry, fs } = makeShell()
    const ast = parse('false ; echo after')
    const result = await execute(ast, state, registry, { fs })
    assert.equal(result.stdout, 'after\n')
    assert.equal(result.exitCode, 0)
  })
})

// ─── 7. Brace Expansion ─────────────────────────────────────────

describe('Brace expansion', () => {
  it('expands {a,b,c} into three alternatives', () => {
    assert.deepEqual(expandBraces('file.{js,ts,py}'), ['file.js', 'file.ts', 'file.py'])
  })

  it('returns original token when no braces present', () => {
    assert.deepEqual(expandBraces('plain'), ['plain'])
  })

  it('handles nested braces', () => {
    const result = expandBraces('{a,b{1,2}}')
    assert.deepEqual(result, ['a', 'b1', 'b2'])
  })
})

// ─── 8. Path Utilities ──────────────────────────────────────────

describe('normalizePath', () => {
  it('resolves . and .. segments', () => {
    assert.equal(normalizePath('/a/b/../c'), '/a/c')
    assert.equal(normalizePath('/a/./b'), '/a/b')
  })

  it('collapses double slashes', () => {
    assert.equal(normalizePath('/a//b///c'), '/a/b/c')
  })

  it('always returns a leading slash', () => {
    assert.equal(normalizePath('a/b'), '/a/b')
    assert.equal(normalizePath(''), '/')
  })
})
