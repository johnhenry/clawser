/**
 * Clawser Shell — Extended Built-in Commands
 *
 * 37 additional shell commands that augment the base 22 builtins in clawser-shell.js.
 * Pure ES module, registers commands via `registerExtendedBuiltins(registry)`.
 *
 * Categories:
 *   File Operations (8): touch, stat, find, du, basename, dirname, realpath, tree
 *   Text Processing (9): tr, cut, paste, rev, nl, fold, column, diff, sed
 *   Generators (6): seq, yes, printf, date, sleep, time
 *   Shell Session (7): clear, history, alias, unalias, set, unset, read
 *   Data & Conversion (4): xxd, base64, sha256sum, md5sum
 *   Process-Like (3): xargs, test, [
 */

import { normalizePath } from './clawser-shell.js';

// ── Helpers ─────────────────────────────────────────────────────

/**
 * Convert a shell glob pattern to a RegExp.
 * Supports *, ?, and character classes [abc].
 * @param {string} pattern
 * @returns {RegExp}
 */
function globToRegex(pattern) {
  let re = '^';
  for (let i = 0; i < pattern.length; i++) {
    const c = pattern[i];
    switch (c) {
      case '*': re += '.*'; break;
      case '?': re += '.'; break;
      case '.': re += '\\.'; break;
      case '[': {
        let j = i + 1;
        while (j < pattern.length && pattern[j] !== ']') j++;
        re += '[' + pattern.slice(i + 1, j) + ']';
        i = j;
        break;
      }
      default: re += c.replace(/[{}()+^$|\\]/g, '\\$&');
    }
  }
  re += '$';
  return new RegExp(re);
}

/**
 * Format byte count in human-readable form.
 * @param {number} bytes
 * @returns {string}
 */
function humanSize(bytes) {
  if (bytes < 1024) return bytes + 'B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + 'K';
  if (bytes < 1024 * 1024 * 1024) return (bytes / (1024 * 1024)).toFixed(1) + 'M';
  return (bytes / (1024 * 1024 * 1024)).toFixed(1) + 'G';
}

/**
 * Recursively walk a directory, yielding {path, kind, size?} entries.
 * @param {object} fs
 * @param {string} dir - Absolute path
 * @returns {AsyncGenerator<{path: string, kind: string, size?: number}>}
 */
async function* walkDir(fs, dir) {
  let entries;
  try {
    entries = await fs.listDir(dir);
  } catch {
    return;
  }
  for (const entry of entries) {
    const full = dir === '/' ? '/' + entry.name : dir + '/' + entry.name;
    if (entry.kind === 'directory') {
      yield { path: full, kind: 'directory' };
      yield* walkDir(fs, full);
    } else {
      const st = await fs.stat(full);
      yield { path: full, kind: 'file', size: st?.size ?? 0 };
    }
  }
}

/**
 * Parse flag arguments. Returns {flags: Set<string>, flagValues: Map<string, string>, positional: string[]}
 * flagsWithValue is an array of flags that consume the next arg as their value.
 */
function parseArgs(args, flagsWithValue = []) {
  const flags = new Set();
  const flagValues = new Map();
  const positional = [];
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--') {
      positional.push(...args.slice(i + 1));
      break;
    }
    if (a.startsWith('-') && a.length > 1 && !/^-\d/.test(a)) {
      // Check if this flag expects a value
      if (flagsWithValue.includes(a) && i + 1 < args.length) {
        flagValues.set(a, args[i + 1]);
        i++;
      } else {
        // Expand combined short flags like -ba into -b, -a
        if (a.startsWith('-') && !a.startsWith('--') && a.length > 2) {
          for (const ch of a.slice(1)) flags.add('-' + ch);
        } else {
          flags.add(a);
        }
      }
    } else {
      positional.push(a);
    }
  }
  return { flags, flagValues, positional };
}

/**
 * Expand a character range like a-z into individual characters.
 * @param {string} spec - e.g. "a-z" or "A-Z" or "abc"
 * @returns {string} expanded characters
 */
function expandCharRange(spec) {
  let result = '';
  for (let i = 0; i < spec.length; i++) {
    if (i + 2 < spec.length && spec[i + 1] === '-') {
      const start = spec.charCodeAt(i);
      const end = spec.charCodeAt(i + 2);
      const lo = Math.min(start, end);
      const hi = Math.max(start, end);
      for (let c = lo; c <= hi; c++) result += String.fromCharCode(c);
      i += 2;
    } else {
      result += spec[i];
    }
  }
  return result;
}

/**
 * Compact MD5 implementation (RFC 1321).
 * Pure JS, no dependencies. Returns hex string.
 * @param {string} str
 * @returns {string}
 */
function md5(str) {
  // Convert string to UTF-8 byte array
  const bytes = new TextEncoder().encode(str);

  // Pre-processing: pad message
  const bitLen = bytes.length * 8;
  const padLen = ((bytes.length + 8) >>> 6 << 6) + 64;
  const padded = new Uint8Array(padLen);
  padded.set(bytes);
  padded[bytes.length] = 0x80;
  // Append original length in bits as 64-bit LE
  const dv = new DataView(padded.buffer);
  dv.setUint32(padLen - 8, bitLen >>> 0, true);
  dv.setUint32(padLen - 4, (bitLen / 0x100000000) >>> 0, true);

  // Per-round shift amounts
  const S = [
    7,12,17,22, 7,12,17,22, 7,12,17,22, 7,12,17,22,
    5, 9,14,20, 5, 9,14,20, 5, 9,14,20, 5, 9,14,20,
    4,11,16,23, 4,11,16,23, 4,11,16,23, 4,11,16,23,
    6,10,15,21, 6,10,15,21, 6,10,15,21, 6,10,15,21,
  ];

  // Pre-computed T table: floor(2^32 * abs(sin(i+1)))
  const K = new Uint32Array(64);
  for (let i = 0; i < 64; i++) {
    K[i] = (Math.floor(Math.abs(Math.sin(i + 1)) * 0x100000000)) >>> 0;
  }

  let a0 = 0x67452301 >>> 0;
  let b0 = 0xefcdab89 >>> 0;
  let c0 = 0x98badcfe >>> 0;
  let d0 = 0x10325476 >>> 0;

  for (let offset = 0; offset < padLen; offset += 64) {
    const M = new Uint32Array(16);
    for (let j = 0; j < 16; j++) {
      M[j] = dv.getUint32(offset + j * 4, true);
    }

    let A = a0, B = b0, C = c0, D = d0;

    for (let i = 0; i < 64; i++) {
      let F, g;
      if (i < 16) {
        F = (B & C) | (~B & D);
        g = i;
      } else if (i < 32) {
        F = (D & B) | (~D & C);
        g = (5 * i + 1) % 16;
      } else if (i < 48) {
        F = B ^ C ^ D;
        g = (3 * i + 5) % 16;
      } else {
        F = C ^ (B | ~D);
        g = (7 * i) % 16;
      }
      F = (F + A + K[i] + M[g]) >>> 0;
      A = D;
      D = C;
      C = B;
      B = (B + ((F << S[i]) | (F >>> (32 - S[i])))) >>> 0;
    }

    a0 = (a0 + A) >>> 0;
    b0 = (b0 + B) >>> 0;
    c0 = (c0 + C) >>> 0;
    d0 = (d0 + D) >>> 0;
  }

  // Output as hex LE
  function toLEHex(n) {
    return [n & 0xff, (n >>> 8) & 0xff, (n >>> 16) & 0xff, (n >>> 24) & 0xff]
      .map(b => b.toString(16).padStart(2, '0')).join('');
  }
  return toLEHex(a0) + toLEHex(b0) + toLEHex(c0) + toLEHex(d0);
}

// ── Main Export ─────────────────────────────────────────────────

/**
 * Register 37 extended built-in commands with a CommandRegistry.
 * @param {import('./clawser-shell.js').CommandRegistry} registry
 */
export function registerExtendedBuiltins(registry) {

  // ════════════════════════════════════════════════════════════════
  // FILE OPERATIONS (8)
  // ════════════════════════════════════════════════════════════════

  // ── touch ──
  registry.register('touch', async ({ args, state, fs }) => {
    if (!fs) return { stdout: '', stderr: 'touch: no filesystem', exitCode: 1 };
    const paths = args.filter(a => !a.startsWith('-'));
    if (paths.length === 0) return { stdout: '', stderr: 'touch: missing operand', exitCode: 1 };
    for (const p of paths) {
      const resolved = state.resolvePath(p);
      const st = await fs.stat(resolved);
      if (!st) {
        try {
          await fs.writeFile(resolved, '');
        } catch (e) {
          return { stdout: '', stderr: `touch: ${p}: ${e.message}`, exitCode: 1 };
        }
      }
      // If file exists, touch is a no-op (OPFS has no utime API)
    }
    return { stdout: '', stderr: '', exitCode: 0 };
  });

  // ── stat ──
  registry.register('stat', async ({ args, state, fs }) => {
    if (!fs) return { stdout: '', stderr: 'stat: no filesystem', exitCode: 1 };
    const paths = args.filter(a => !a.startsWith('-'));
    if (paths.length === 0) return { stdout: '', stderr: 'stat: missing operand', exitCode: 1 };
    const lines = [];
    for (const p of paths) {
      const resolved = state.resolvePath(p);
      const st = await fs.stat(resolved);
      if (!st) {
        return { stdout: lines.join('\n'), stderr: `stat: ${p}: No such file or directory`, exitCode: 1 };
      }
      lines.push(`  File: ${resolved}`);
      lines.push(`  Type: ${st.kind}`);
      if (st.size !== undefined) lines.push(`  Size: ${st.size}`);
      if (st.lastModified !== undefined) {
        lines.push(`  Modified: ${new Date(st.lastModified).toISOString()}`);
      }
    }
    return { stdout: lines.join('\n') + '\n', stderr: '', exitCode: 0 };
  });

  // ── find ──
  registry.register('find', async ({ args, state, fs }) => {
    if (!fs) return { stdout: '', stderr: 'find: no filesystem', exitCode: 1 };

    // Parse find-style arguments
    let searchPath = '.';
    let namePattern = null;
    let typeFilter = null; // 'f' or 'd'

    let i = 0;
    // First non-flag argument is the path
    if (i < args.length && !args[i].startsWith('-')) {
      searchPath = args[i];
      i++;
    }
    while (i < args.length) {
      if (args[i] === '-name' && i + 1 < args.length) {
        namePattern = args[i + 1];
        i += 2;
      } else if (args[i] === '-type' && i + 1 < args.length) {
        typeFilter = args[i + 1];
        i += 2;
      } else {
        i++;
      }
    }

    const resolved = state.resolvePath(searchPath);
    const nameRegex = namePattern ? globToRegex(namePattern) : null;
    const results = [];

    // Include the root directory itself if it matches
    const rootStat = await fs.stat(resolved);
    if (rootStat) {
      const rootName = resolved === '/' ? '/' : resolved.split('/').pop();
      const rootKind = rootStat.kind === 'directory' ? 'd' : 'f';
      if ((!typeFilter || typeFilter === rootKind) && (!nameRegex || nameRegex.test(rootName))) {
        results.push(resolved);
      }
    }

    for await (const entry of walkDir(fs, resolved)) {
      const entryKind = entry.kind === 'directory' ? 'd' : 'f';
      if (typeFilter && typeFilter !== entryKind) continue;
      const name = entry.path.split('/').pop();
      if (nameRegex && !nameRegex.test(name)) continue;
      results.push(entry.path);
    }

    return {
      stdout: results.length > 0 ? results.join('\n') + '\n' : '',
      stderr: '',
      exitCode: 0,
    };
  });

  // ── du ──
  registry.register('du', async ({ args, state, fs }) => {
    if (!fs) return { stdout: '', stderr: 'du: no filesystem', exitCode: 1 };
    const { flags, positional } = parseArgs(args);
    const summary = flags.has('-s');
    const human = flags.has('-h');
    const target = positional[0] || '.';
    const resolved = state.resolvePath(target);

    const fmt = (bytes) => human ? humanSize(bytes) : String(bytes);

    // Recursive size calculation
    async function dirSize(dir) {
      let total = 0;
      const lines = [];
      let entries;
      try {
        entries = await fs.listDir(dir);
      } catch {
        return { total: 0, lines: [] };
      }
      for (const entry of entries) {
        const full = dir === '/' ? '/' + entry.name : dir + '/' + entry.name;
        if (entry.kind === 'directory') {
          const sub = await dirSize(full);
          total += sub.total;
          if (!summary) lines.push(...sub.lines);
        } else {
          const st = await fs.stat(full);
          total += st?.size ?? 0;
        }
      }
      lines.push(`${fmt(total)}\t${dir}`);
      return { total, lines };
    }

    const st = await fs.stat(resolved);
    if (!st) return { stdout: '', stderr: `du: ${target}: No such file or directory`, exitCode: 1 };

    if (st.kind === 'file') {
      return { stdout: `${fmt(st.size ?? 0)}\t${resolved}\n`, stderr: '', exitCode: 0 };
    }

    const result = await dirSize(resolved);
    const output = summary
      ? `${fmt(result.total)}\t${resolved}\n`
      : result.lines.join('\n') + '\n';

    return { stdout: output, stderr: '', exitCode: 0 };
  });

  // ── basename ──
  registry.register('basename', ({ args }) => {
    if (args.length === 0) return { stdout: '', stderr: 'basename: missing operand', exitCode: 1 };
    let name = args[0];
    // Remove trailing slashes
    name = name.replace(/\/+$/, '');
    // Get last component
    const idx = name.lastIndexOf('/');
    if (idx >= 0) name = name.slice(idx + 1);
    // Strip suffix if provided
    if (args[1] && name.endsWith(args[1])) {
      name = name.slice(0, -args[1].length);
    }
    // Edge case: empty result from '/'
    if (!name) name = '/';
    return { stdout: name + '\n', stderr: '', exitCode: 0 };
  });

  // ── dirname ──
  registry.register('dirname', ({ args }) => {
    if (args.length === 0) return { stdout: '', stderr: 'dirname: missing operand', exitCode: 1 };
    let path = args[0];
    // Remove trailing slashes (except root)
    path = path.replace(/\/+$/, '') || '/';
    const idx = path.lastIndexOf('/');
    if (idx < 0) return { stdout: '.\n', stderr: '', exitCode: 0 };
    if (idx === 0) return { stdout: '/\n', stderr: '', exitCode: 0 };
    return { stdout: path.slice(0, idx) + '\n', stderr: '', exitCode: 0 };
  });

  // ── realpath ──
  registry.register('realpath', ({ args, state }) => {
    if (args.length === 0) return { stdout: '', stderr: 'realpath: missing operand', exitCode: 1 };
    const results = [];
    for (const p of args) {
      results.push(state.resolvePath(p));
    }
    return { stdout: results.join('\n') + '\n', stderr: '', exitCode: 0 };
  });

  // ── tree ──
  registry.register('tree', async ({ args, state, fs }) => {
    if (!fs) return { stdout: '', stderr: 'tree: no filesystem', exitCode: 1 };

    let maxDepth = Infinity;
    const lIdx = args.indexOf('-L');
    if (lIdx >= 0 && args[lIdx + 1]) {
      maxDepth = parseInt(args[lIdx + 1], 10);
      if (isNaN(maxDepth) || maxDepth < 1) maxDepth = Infinity;
    }
    const positional = args.filter((a, i) => !a.startsWith('-') && (i !== lIdx + 1 || lIdx < 0));
    const target = positional[0] || '.';
    const resolved = state.resolvePath(target);

    const lines = [resolved];
    let dirCount = 0;
    let fileCount = 0;

    async function buildTree(dir, prefix, depth) {
      if (depth >= maxDepth) return;
      let entries;
      try {
        entries = await fs.listDir(dir);
      } catch {
        return;
      }
      entries.sort((a, b) => a.name.localeCompare(b.name));

      for (let i = 0; i < entries.length; i++) {
        const entry = entries[i];
        const isLast = i === entries.length - 1;
        const connector = isLast ? '\u2514\u2500\u2500 ' : '\u251c\u2500\u2500 ';
        const childPrefix = isLast ? '    ' : '\u2502   ';

        lines.push(prefix + connector + entry.name);
        if (entry.kind === 'directory') {
          dirCount++;
          const full = dir === '/' ? '/' + entry.name : dir + '/' + entry.name;
          await buildTree(full, prefix + childPrefix, depth + 1);
        } else {
          fileCount++;
        }
      }
    }

    await buildTree(resolved, '', 0);
    lines.push('');
    lines.push(`${dirCount} directories, ${fileCount} files`);

    return { stdout: lines.join('\n') + '\n', stderr: '', exitCode: 0 };
  });

  // ════════════════════════════════════════════════════════════════
  // TEXT PROCESSING (9)
  // ════════════════════════════════════════════════════════════════

  // ── tr ──
  registry.register('tr', ({ args, stdin }) => {
    const deleteMode = args[0] === '-d';
    const operands = deleteMode ? args.slice(1) : args;

    if (deleteMode) {
      if (operands.length < 1) return { stdout: '', stderr: 'tr: missing operand', exitCode: 1 };
      const delChars = expandCharRange(operands[0]);
      const delSet = new Set(delChars);
      let result = '';
      for (const ch of stdin) {
        if (!delSet.has(ch)) result += ch;
      }
      return { stdout: result, stderr: '', exitCode: 0 };
    }

    if (operands.length < 2) return { stdout: '', stderr: 'tr: missing operand', exitCode: 1 };
    const fromChars = expandCharRange(operands[0]);
    const toChars = expandCharRange(operands[1]);
    const map = new Map();
    for (let i = 0; i < fromChars.length; i++) {
      // If toChars is shorter, repeat last char
      const replacement = i < toChars.length ? toChars[i] : toChars[toChars.length - 1];
      map.set(fromChars[i], replacement);
    }
    let result = '';
    for (const ch of stdin) {
      result += map.has(ch) ? map.get(ch) : ch;
    }
    return { stdout: result, stderr: '', exitCode: 0 };
  });

  // ── cut ──
  registry.register('cut', ({ args, stdin }) => {
    let delimiter = '\t';
    let fields = null;     // 1-indexed field list
    let charRange = null;  // [start, end] 1-indexed inclusive

    for (let i = 0; i < args.length; i++) {
      const a = args[i];
      if (a === '-d' && i + 1 < args.length) {
        delimiter = args[i + 1];
        i++;
      } else if (a.startsWith('-d') && a.length > 2) {
        delimiter = a.slice(2);
      } else if (a === '-f' && i + 1 < args.length) {
        fields = args[i + 1].split(',').map(Number);
        i++;
      } else if (a.startsWith('-f') && a.length > 2) {
        fields = a.slice(2).split(',').map(Number);
      } else if (a === '-c' && i + 1 < args.length) {
        charRange = parseRange(args[i + 1]);
        i++;
      } else if (a.startsWith('-c') && a.length > 2) {
        charRange = parseRange(a.slice(2));
      }
    }

    function parseRange(spec) {
      const parts = spec.split('-');
      const start = parts[0] ? parseInt(parts[0], 10) : 1;
      const end = parts[1] ? parseInt(parts[1], 10) : Infinity;
      return [start, end];
    }

    const lines = stdin.split('\n');
    // Preserve trailing newline handling
    const hasTrailingNewline = stdin.endsWith('\n');
    const inputLines = hasTrailingNewline ? lines.slice(0, -1) : lines;

    const result = inputLines.map(line => {
      if (charRange) {
        const [start, end] = charRange;
        return line.slice(start - 1, end === Infinity ? undefined : end);
      }
      if (fields) {
        const parts = line.split(delimiter);
        return fields.map(f => parts[f - 1] ?? '').join(delimiter);
      }
      return line;
    });

    return { stdout: result.join('\n') + '\n', stderr: '', exitCode: 0 };
  });

  // ── paste ──
  registry.register('paste', ({ args, stdin }) => {
    let delimiter = '\t';
    for (let i = 0; i < args.length; i++) {
      if (args[i] === '-d' && i + 1 < args.length) {
        delimiter = args[i + 1];
        i++;
      } else if (args[i].startsWith('-d') && args[i].length > 2) {
        delimiter = args[i].slice(2);
      }
    }

    // paste merges lines of input. Without multiple files, it just joins stdin lines.
    const lines = stdin.split('\n');
    if (lines[lines.length - 1] === '') lines.pop();
    return { stdout: lines.join(delimiter) + '\n', stderr: '', exitCode: 0 };
  });

  // ── rev ──
  registry.register('rev', ({ stdin }) => {
    const lines = stdin.split('\n');
    const hasTrailingNewline = stdin.endsWith('\n');
    const inputLines = hasTrailingNewline ? lines.slice(0, -1) : lines;
    const reversed = inputLines.map(line => [...line].reverse().join(''));
    return { stdout: reversed.join('\n') + '\n', stderr: '', exitCode: 0 };
  });

  // ── nl ──
  registry.register('nl', ({ args, stdin }) => {
    const numberAll = args.includes('-ba') || args.includes('-b') && args.includes('a');
    const lines = stdin.split('\n');
    const hasTrailingNewline = stdin.endsWith('\n');
    const inputLines = hasTrailingNewline ? lines.slice(0, -1) : lines;

    let lineNum = 0;
    const result = inputLines.map(line => {
      if (numberAll || line.trim().length > 0) {
        lineNum++;
        return String(lineNum).padStart(6, ' ') + '\t' + line;
      }
      return '      \t' + line;
    });

    return { stdout: result.join('\n') + '\n', stderr: '', exitCode: 0 };
  });

  // ── fold ──
  registry.register('fold', ({ args, stdin }) => {
    let width = 80;
    let breakSpaces = false;

    for (let i = 0; i < args.length; i++) {
      if (args[i] === '-w' && i + 1 < args.length) {
        width = parseInt(args[i + 1], 10) || 80;
        i++;
      } else if (args[i].startsWith('-w') && args[i].length > 2) {
        width = parseInt(args[i].slice(2), 10) || 80;
      } else if (args[i] === '-s') {
        breakSpaces = true;
      }
    }

    const lines = stdin.split('\n');
    const result = [];

    for (const line of lines) {
      if (line.length <= width) {
        result.push(line);
        continue;
      }
      let remaining = line;
      while (remaining.length > width) {
        let breakAt = width;
        if (breakSpaces) {
          // Find last space within width
          const lastSpace = remaining.lastIndexOf(' ', width);
          if (lastSpace > 0) breakAt = lastSpace + 1;
        }
        result.push(remaining.slice(0, breakAt));
        remaining = remaining.slice(breakAt);
      }
      result.push(remaining);
    }

    return { stdout: result.join('\n'), stderr: '', exitCode: 0 };
  });

  // ── column ──
  registry.register('column', ({ args, stdin }) => {
    const tableMode = args.includes('-t');

    if (!tableMode) {
      // Without -t, just pass through
      return { stdout: stdin, stderr: '', exitCode: 0 };
    }

    const lines = stdin.split('\n');
    const hasTrailingNewline = stdin.endsWith('\n');
    const inputLines = hasTrailingNewline ? lines.slice(0, -1) : lines;

    // Split each line by whitespace
    const rows = inputLines.map(line => line.trim().split(/\s+/));
    if (rows.length === 0) return { stdout: '', stderr: '', exitCode: 0 };

    // Compute column widths
    const colCount = Math.max(...rows.map(r => r.length));
    const widths = new Array(colCount).fill(0);
    for (const row of rows) {
      for (let i = 0; i < row.length; i++) {
        widths[i] = Math.max(widths[i], row[i].length);
      }
    }

    // Format rows
    const formatted = rows.map(row => {
      return row.map((cell, i) => {
        if (i === row.length - 1) return cell; // Don't pad last column
        return cell.padEnd(widths[i], ' ');
      }).join('  ');
    });

    return { stdout: formatted.join('\n') + '\n', stderr: '', exitCode: 0 };
  });

  // ── diff ──
  registry.register('diff', async ({ args, state, fs }) => {
    if (!fs) return { stdout: '', stderr: 'diff: no filesystem', exitCode: 1 };
    const paths = args.filter(a => !a.startsWith('-'));
    if (paths.length < 2) return { stdout: '', stderr: 'diff: need two files', exitCode: 2 };

    let contentA, contentB;
    try {
      contentA = await fs.readFile(state.resolvePath(paths[0]));
    } catch {
      return { stdout: '', stderr: `diff: ${paths[0]}: No such file or directory`, exitCode: 2 };
    }
    try {
      contentB = await fs.readFile(state.resolvePath(paths[1]));
    } catch {
      return { stdout: '', stderr: `diff: ${paths[1]}: No such file or directory`, exitCode: 2 };
    }

    const linesA = contentA.split('\n');
    const linesB = contentB.split('\n');

    if (contentA === contentB) return { stdout: '', stderr: '', exitCode: 0 };

    // Simple line-by-line diff (unified-ish format)
    const output = [];
    output.push(`--- ${paths[0]}`);
    output.push(`+++ ${paths[1]}`);

    // Simple LCS-based diff
    const m = linesA.length;
    const n = linesB.length;

    // Build LCS table (for small files; cap to avoid memory blow-up)
    if (m > 10000 || n > 10000) {
      // Fallback: show full replacement
      output.push(`@@ -1,${m} +1,${n} @@`);
      for (const l of linesA) output.push('-' + l);
      for (const l of linesB) output.push('+' + l);
      return { stdout: output.join('\n') + '\n', stderr: '', exitCode: 1 };
    }

    // LCS dp table
    const dp = Array.from({ length: m + 1 }, () => new Uint16Array(n + 1));
    for (let i = 1; i <= m; i++) {
      for (let j = 1; j <= n; j++) {
        if (linesA[i - 1] === linesB[j - 1]) {
          dp[i][j] = dp[i - 1][j - 1] + 1;
        } else {
          dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1]);
        }
      }
    }

    // Backtrack to get diff operations
    const ops = [];
    let ia = m, ib = n;
    while (ia > 0 || ib > 0) {
      if (ia > 0 && ib > 0 && linesA[ia - 1] === linesB[ib - 1]) {
        ops.push({ type: ' ', line: linesA[ia - 1] });
        ia--; ib--;
      } else if (ib > 0 && (ia === 0 || dp[ia][ib - 1] >= dp[ia - 1][ib])) {
        ops.push({ type: '+', line: linesB[ib - 1] });
        ib--;
      } else {
        ops.push({ type: '-', line: linesA[ia - 1] });
        ia--;
      }
    }
    ops.reverse();

    // Group into hunks
    const contextLines = 3;
    const changes = ops.map((op, idx) => ({ ...op, idx })).filter(op => op.type !== ' ');
    if (changes.length === 0) return { stdout: '', stderr: '', exitCode: 0 };

    // Simple output: emit all ops as a single hunk
    output.push(`@@ -1,${m} +1,${n} @@`);
    for (const op of ops) {
      output.push(op.type + op.line);
    }

    return { stdout: output.join('\n') + '\n', stderr: '', exitCode: 1 };
  });

  // ── sed ──
  registry.register('sed', ({ args, stdin }) => {
    if (args.length === 0) return { stdout: '', stderr: 'sed: missing expression', exitCode: 1 };

    const expr = args[0];
    const lines = stdin.split('\n');
    const hasTrailingNewline = stdin.endsWith('\n');
    const inputLines = hasTrailingNewline ? lines.slice(0, -1) : lines;

    // Parse s/pattern/replacement/flags
    const subMatch = expr.match(/^s(.)(.+?)\1(.*?)\1([gi]*)$/);
    if (subMatch) {
      const [, , pattern, replacement, flags] = subMatch;
      const global = flags.includes('g');
      try {
        const regex = new RegExp(pattern, global ? 'g' : '');
        const result = inputLines.map(line => line.replace(regex, replacement));
        return { stdout: result.join('\n') + '\n', stderr: '', exitCode: 0 };
      } catch (e) {
        return { stdout: '', stderr: `sed: invalid regex: ${e.message}`, exitCode: 1 };
      }
    }

    // Parse line-address deletion: Nd or N,Md
    const singleDelete = expr.match(/^(\d+)d$/);
    if (singleDelete) {
      const lineNum = parseInt(singleDelete[1], 10);
      const result = inputLines.filter((_, i) => i + 1 !== lineNum);
      return { stdout: result.join('\n') + '\n', stderr: '', exitCode: 0 };
    }

    const rangeDelete = expr.match(/^(\d+),(\d+)d$/);
    if (rangeDelete) {
      const start = parseInt(rangeDelete[1], 10);
      const end = parseInt(rangeDelete[2], 10);
      const result = inputLines.filter((_, i) => {
        const n = i + 1;
        return n < start || n > end;
      });
      return { stdout: result.join('\n') + '\n', stderr: '', exitCode: 0 };
    }

    return { stdout: '', stderr: `sed: unsupported expression: ${expr}`, exitCode: 1 };
  });

  // ════════════════════════════════════════════════════════════════
  // GENERATORS (6)
  // ════════════════════════════════════════════════════════════════

  // ── seq ──
  registry.register('seq', ({ args }) => {
    let first = 1, increment = 1, last;

    if (args.length === 1) {
      last = parseFloat(args[0]);
    } else if (args.length === 2) {
      first = parseFloat(args[0]);
      last = parseFloat(args[1]);
    } else if (args.length >= 3) {
      first = parseFloat(args[0]);
      increment = parseFloat(args[1]);
      last = parseFloat(args[2]);
    } else {
      return { stdout: '', stderr: 'seq: missing operand', exitCode: 1 };
    }

    if (isNaN(first) || isNaN(increment) || isNaN(last)) {
      return { stdout: '', stderr: 'seq: invalid number', exitCode: 1 };
    }
    if (increment === 0) {
      return { stdout: '', stderr: 'seq: zero increment', exitCode: 1 };
    }

    const numbers = [];
    const maxIter = 100000; // Safety cap
    let count = 0;

    if (increment > 0) {
      for (let i = first; i <= last && count < maxIter; i += increment, count++) {
        numbers.push(Number.isInteger(i) ? String(i) : i.toFixed(10).replace(/0+$/, '').replace(/\.$/, ''));
      }
    } else {
      for (let i = first; i >= last && count < maxIter; i += increment, count++) {
        numbers.push(Number.isInteger(i) ? String(i) : i.toFixed(10).replace(/0+$/, '').replace(/\.$/, ''));
      }
    }

    return { stdout: numbers.join('\n') + '\n', stderr: '', exitCode: 0 };
  });

  // ── yes ──
  registry.register('yes', ({ args }) => {
    const text = args.length > 0 ? args.join(' ') : 'y';
    const cap = 1000;
    const lines = new Array(cap).fill(text);
    return { stdout: lines.join('\n') + '\n', stderr: '', exitCode: 0 };
  });

  // ── printf ──
  registry.register('printf', ({ args }) => {
    if (args.length === 0) return { stdout: '', stderr: '', exitCode: 0 };

    const format = args[0];
    const params = args.slice(1);
    let paramIdx = 0;
    let result = '';
    let i = 0;

    while (i < format.length) {
      if (format[i] === '%' && i + 1 < format.length) {
        const next = format[i + 1];
        switch (next) {
          case 's':
            result += paramIdx < params.length ? params[paramIdx++] : '';
            i += 2;
            break;
          case 'd':
            result += paramIdx < params.length ? String(parseInt(params[paramIdx++], 10) || 0) : '0';
            i += 2;
            break;
          case 'f':
            result += paramIdx < params.length ? String(parseFloat(params[paramIdx++]) || 0) : '0';
            i += 2;
            break;
          case '%':
            result += '%';
            i += 2;
            break;
          default:
            result += format[i];
            i++;
        }
      } else if (format[i] === '\\' && i + 1 < format.length) {
        const next = format[i + 1];
        switch (next) {
          case 'n': result += '\n'; i += 2; break;
          case 't': result += '\t'; i += 2; break;
          case '\\': result += '\\'; i += 2; break;
          default: result += format[i]; i++; break;
        }
      } else {
        result += format[i];
        i++;
      }
    }

    return { stdout: result, stderr: '', exitCode: 0 };
  });

  // ── date ──
  registry.register('date', ({ args }) => {
    const now = new Date();

    // Check for format string starting with +
    const fmtArg = args.find(a => a.startsWith('+'));
    if (fmtArg) {
      const fmt = fmtArg.slice(1);
      const pad2 = (n) => String(n).padStart(2, '0');
      let result = fmt;
      result = result.replace(/%F/g, `${now.getFullYear()}-${pad2(now.getMonth() + 1)}-${pad2(now.getDate())}`);
      result = result.replace(/%T/g, `${pad2(now.getHours())}:${pad2(now.getMinutes())}:${pad2(now.getSeconds())}`);
      result = result.replace(/%Y/g, String(now.getFullYear()));
      result = result.replace(/%m/g, pad2(now.getMonth() + 1));
      result = result.replace(/%d/g, pad2(now.getDate()));
      result = result.replace(/%H/g, pad2(now.getHours()));
      result = result.replace(/%M/g, pad2(now.getMinutes()));
      result = result.replace(/%S/g, pad2(now.getSeconds()));
      result = result.replace(/%%()/g, '%');
      return { stdout: result + '\n', stderr: '', exitCode: 0 };
    }

    return { stdout: now.toString() + '\n', stderr: '', exitCode: 0 };
  });

  // ── sleep ──
  registry.register('sleep', async ({ args }) => {
    const seconds = parseFloat(args[0]);
    if (isNaN(seconds) || seconds < 0) {
      return { stdout: '', stderr: 'sleep: invalid time interval', exitCode: 1 };
    }
    const capped = Math.min(seconds, 30);
    await new Promise(resolve => setTimeout(resolve, capped * 1000));
    return { stdout: '', stderr: '', exitCode: 0 };
  });

  // ── time ──
  registry.register('time', async ({ args, stdin, state, registry: reg, fs }) => {
    if (args.length === 0) return { stdout: '', stderr: 'time: missing command', exitCode: 1 };

    const cmdName = args[0];
    const cmdArgs = args.slice(1);
    const handler = reg.get(cmdName);
    if (!handler) {
      return { stdout: '', stderr: `time: ${cmdName}: command not found`, exitCode: 127 };
    }

    const start = performance.now();
    const result = await handler({ args: cmdArgs, stdin, state, registry: reg, fs });
    const elapsed = performance.now() - start;

    const realSec = (elapsed / 1000).toFixed(3);
    const timingInfo = `\nreal\t${realSec}s\n`;

    return {
      stdout: (result.stdout ?? '') + timingInfo,
      stderr: result.stderr ?? '',
      exitCode: result.exitCode ?? 0,
    };
  });

  // ════════════════════════════════════════════════════════════════
  // SHELL SESSION (7)
  // ════════════════════════════════════════════════════════════════

  // ── clear ──
  registry.register('clear', () => {
    return { stdout: '', stderr: '', exitCode: 0, __clearTerminal: true };
  });

  // ── history ──
  registry.register('history', ({ state }) => {
    const lines = state.history.map((cmd, i) =>
      String(i + 1).padStart(5, ' ') + '  ' + cmd
    );
    return { stdout: lines.join('\n') + '\n', stderr: '', exitCode: 0 };
  });

  // ── alias ──
  registry.register('alias', ({ args, state }) => {
    // Ensure aliases Map exists on state
    if (!state.aliases) state.aliases = new Map();

    if (args.length === 0) {
      // List all aliases
      const lines = [];
      for (const [name, value] of state.aliases) {
        lines.push(`alias ${name}='${value}'`);
      }
      return { stdout: lines.join('\n') + (lines.length > 0 ? '\n' : ''), stderr: '', exitCode: 0 };
    }

    for (const arg of args) {
      const eq = arg.indexOf('=');
      if (eq > 0) {
        const name = arg.slice(0, eq);
        let value = arg.slice(eq + 1);
        // Strip surrounding quotes if present
        if ((value.startsWith('"') && value.endsWith('"')) ||
            (value.startsWith("'") && value.endsWith("'"))) {
          value = value.slice(1, -1);
        }
        state.aliases.set(name, value);
      } else {
        // Show specific alias
        if (state.aliases.has(arg)) {
          return { stdout: `alias ${arg}='${state.aliases.get(arg)}'\n`, stderr: '', exitCode: 0 };
        }
        return { stdout: '', stderr: `alias: ${arg}: not found`, exitCode: 1 };
      }
    }
    return { stdout: '', stderr: '', exitCode: 0 };
  });

  // ── unalias ──
  registry.register('unalias', ({ args, state }) => {
    if (!state.aliases) state.aliases = new Map();
    if (args.length === 0) return { stdout: '', stderr: 'unalias: missing argument', exitCode: 1 };

    for (const name of args) {
      if (name === '-a') {
        state.aliases.clear();
        continue;
      }
      if (!state.aliases.has(name)) {
        return { stdout: '', stderr: `unalias: ${name}: not found`, exitCode: 1 };
      }
      state.aliases.delete(name);
    }
    return { stdout: '', stderr: '', exitCode: 0 };
  });

  // ── set ──
  registry.register('set', ({ args, state }) => {
    if (args.length === 0) {
      // Show current options
      const lines = [`pipefail\t${state.pipefail ? 'on' : 'off'}`];
      return { stdout: lines.join('\n') + '\n', stderr: '', exitCode: 0 };
    }

    // set -o pipefail / set +o pipefail
    if (args.length >= 2 && (args[0] === '-o' || args[0] === '+o')) {
      const enable = args[0] === '-o';
      const option = args[1];
      if (option === 'pipefail') {
        state.pipefail = enable;
        return { stdout: '', stderr: '', exitCode: 0 };
      }
      return { stdout: '', stderr: `set: unknown option: ${option}`, exitCode: 1 };
    }

    return { stdout: '', stderr: `set: unsupported arguments: ${args.join(' ')}`, exitCode: 1 };
  });

  // ── unset ──
  registry.register('unset', ({ args, state }) => {
    if (args.length === 0) return { stdout: '', stderr: 'unset: missing argument', exitCode: 1 };
    for (const name of args) {
      state.env.delete(name);
    }
    return { stdout: '', stderr: '', exitCode: 0 };
  });

  // ── read ──
  registry.register('read', ({ args, stdin, state }) => {
    if (args.length === 0) return { stdout: '', stderr: 'read: missing variable name', exitCode: 1 };
    const varName = args[0];
    state.env.set(varName, stdin.trim());
    return { stdout: '', stderr: '', exitCode: 0 };
  });

  // ════════════════════════════════════════════════════════════════
  // DATA & CONVERSION (4)
  // ════════════════════════════════════════════════════════════════

  // ── xxd ──
  registry.register('xxd', ({ args, stdin }) => {
    const reverseMode = args.includes('-r');

    if (reverseMode) {
      // Reverse hex dump: parse hex bytes from each line
      const lines = stdin.split('\n').filter(l => l.trim());
      let result = '';
      for (const line of lines) {
        // Expected format: "OFFSET: HH HH HH ... ASCII"
        // Extract hex portion (after colon, before ASCII section)
        const colonIdx = line.indexOf(':');
        if (colonIdx < 0) continue;
        const afterColon = line.slice(colonIdx + 1);
        // Hex bytes are before the double-space that precedes ASCII
        const hexPart = afterColon.split('  ')[0].trim();
        const hexBytes = hexPart.split(/\s+/);
        for (const hb of hexBytes) {
          if (/^[0-9a-fA-F]{2}$/.test(hb)) {
            result += String.fromCharCode(parseInt(hb, 16));
          }
        }
      }
      return { stdout: result, stderr: '', exitCode: 0 };
    }

    // Forward: hex dump
    const bytes = new TextEncoder().encode(stdin);
    const lines = [];
    for (let offset = 0; offset < bytes.length; offset += 16) {
      const chunk = bytes.slice(offset, offset + 16);
      const hex = Array.from(chunk).map(b => b.toString(16).padStart(2, '0')).join(' ');
      const ascii = Array.from(chunk).map(b => (b >= 0x20 && b <= 0x7e) ? String.fromCharCode(b) : '.').join('');
      const offsetStr = offset.toString(16).padStart(8, '0');
      lines.push(`${offsetStr}: ${hex.padEnd(47, ' ')}  ${ascii}`);
    }

    return { stdout: lines.join('\n') + '\n', stderr: '', exitCode: 0 };
  });

  // ── base64 ──
  registry.register('base64', ({ args, stdin }) => {
    const decode = args.includes('-d') || args.includes('--decode') || args.includes('-D');

    if (decode) {
      try {
        const cleaned = stdin.replace(/\s/g, '');
        const binary = atob(cleaned);
        return { stdout: binary, stderr: '', exitCode: 0 };
      } catch (e) {
        return { stdout: '', stderr: `base64: invalid input: ${e.message}`, exitCode: 1 };
      }
    }

    // Encode
    try {
      // Remove trailing newline for encoding (matches GNU base64 behavior)
      const toEncode = stdin.endsWith('\n') ? stdin.slice(0, -1) : stdin;
      const encoded = btoa(toEncode);
      return { stdout: encoded + '\n', stderr: '', exitCode: 0 };
    } catch (e) {
      return { stdout: '', stderr: `base64: encoding error: ${e.message}`, exitCode: 1 };
    }
  });

  // ── sha256sum ──
  registry.register('sha256sum', async ({ stdin }) => {
    try {
      const data = new TextEncoder().encode(stdin);
      const hashBuffer = await crypto.subtle.digest('SHA-256', data);
      const hashArray = Array.from(new Uint8Array(hashBuffer));
      const hex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
      return { stdout: hex + '  -\n', stderr: '', exitCode: 0 };
    } catch (e) {
      return { stdout: '', stderr: `sha256sum: ${e.message}`, exitCode: 1 };
    }
  });

  // ── md5sum ──
  registry.register('md5sum', ({ stdin }) => {
    try {
      const hex = md5(stdin);
      return { stdout: hex + '  -\n', stderr: '', exitCode: 0 };
    } catch (e) {
      return { stdout: '', stderr: `md5sum: ${e.message}`, exitCode: 1 };
    }
  });

  // ════════════════════════════════════════════════════════════════
  // PROCESS-LIKE (3)
  // ════════════════════════════════════════════════════════════════

  // ── xargs ──
  registry.register('xargs', async ({ args, stdin, state, registry: reg, fs }) => {
    // Parse xargs flags
    let nPerExec = 0; // 0 means all at once
    let cmdArgs = [];

    for (let i = 0; i < args.length; i++) {
      if (args[i] === '-n' && i + 1 < args.length) {
        nPerExec = parseInt(args[i + 1], 10) || 1;
        i++;
      } else {
        cmdArgs = args.slice(i);
        break;
      }
    }

    // Default command is echo
    if (cmdArgs.length === 0) cmdArgs = ['echo'];

    const cmdName = cmdArgs[0];
    const baseArgs = cmdArgs.slice(1);
    const handler = reg.get(cmdName);
    if (!handler) {
      return { stdout: '', stderr: `xargs: ${cmdName}: command not found`, exitCode: 127 };
    }

    // Split stdin into items (by newline and whitespace)
    const items = stdin.trim().split(/\s+/).filter(Boolean);
    if (items.length === 0) {
      // No input, run command with no extra args
      const result = await handler({ args: baseArgs, stdin: '', state, registry: reg, fs });
      return result;
    }

    let stdout = '';
    let stderr = '';
    let exitCode = 0;

    if (nPerExec > 0) {
      // Run in batches of N
      for (let i = 0; i < items.length; i += nPerExec) {
        const batch = items.slice(i, i + nPerExec);
        const result = await handler({
          args: [...baseArgs, ...batch],
          stdin: '',
          state,
          registry: reg,
          fs,
        });
        stdout += result.stdout ?? '';
        stderr += result.stderr ?? '';
        if (result.exitCode !== 0) exitCode = result.exitCode;
      }
    } else {
      // All items at once
      const result = await handler({
        args: [...baseArgs, ...items],
        stdin: '',
        state,
        registry: reg,
        fs,
      });
      stdout = result.stdout ?? '';
      stderr = result.stderr ?? '';
      exitCode = result.exitCode ?? 0;
    }

    return { stdout, stderr, exitCode };
  });

  // ── test / [ ──
  const testHandler = async ({ args, state, fs }) => {
    // Strip trailing ] for [ form
    let testArgs = [...args];
    if (testArgs[testArgs.length - 1] === ']') testArgs.pop();

    if (testArgs.length === 0) {
      return { stdout: '', stderr: '', exitCode: 1 }; // false
    }

    // Single-arg form: test STRING (true if non-empty)
    if (testArgs.length === 1) {
      return { stdout: '', stderr: '', exitCode: testArgs[0] ? 0 : 1 };
    }

    // Two-arg forms: -f file, -d dir, -e path, -z str, -n str
    if (testArgs.length === 2) {
      const [flag, operand] = testArgs;
      switch (flag) {
        case '-f': {
          if (!fs) return { stdout: '', stderr: '', exitCode: 1 };
          const st = await fs.stat(state.resolvePath(operand));
          return { stdout: '', stderr: '', exitCode: st && st.kind === 'file' ? 0 : 1 };
        }
        case '-d': {
          if (!fs) return { stdout: '', stderr: '', exitCode: 1 };
          const st = await fs.stat(state.resolvePath(operand));
          return { stdout: '', stderr: '', exitCode: st && st.kind === 'directory' ? 0 : 1 };
        }
        case '-e': {
          if (!fs) return { stdout: '', stderr: '', exitCode: 1 };
          const st = await fs.stat(state.resolvePath(operand));
          return { stdout: '', stderr: '', exitCode: st ? 0 : 1 };
        }
        case '-z':
          return { stdout: '', stderr: '', exitCode: operand.length === 0 ? 0 : 1 };
        case '-n':
          return { stdout: '', stderr: '', exitCode: operand.length > 0 ? 0 : 1 };
        case '!': {
          // Negate single value
          return { stdout: '', stderr: '', exitCode: operand ? 1 : 0 };
        }
      }
    }

    // Three-arg forms: str1 = str2, str1 != str2, num1 -op num2
    if (testArgs.length === 3) {
      const [left, op, right] = testArgs;
      switch (op) {
        case '=':
        case '==':
          return { stdout: '', stderr: '', exitCode: left === right ? 0 : 1 };
        case '!=':
          return { stdout: '', stderr: '', exitCode: left !== right ? 0 : 1 };
        case '-eq':
          return { stdout: '', stderr: '', exitCode: Number(left) === Number(right) ? 0 : 1 };
        case '-ne':
          return { stdout: '', stderr: '', exitCode: Number(left) !== Number(right) ? 0 : 1 };
        case '-gt':
          return { stdout: '', stderr: '', exitCode: Number(left) > Number(right) ? 0 : 1 };
        case '-lt':
          return { stdout: '', stderr: '', exitCode: Number(left) < Number(right) ? 0 : 1 };
        case '-ge':
          return { stdout: '', stderr: '', exitCode: Number(left) >= Number(right) ? 0 : 1 };
        case '-le':
          return { stdout: '', stderr: '', exitCode: Number(left) <= Number(right) ? 0 : 1 };
      }
    }

    return { stdout: '', stderr: 'test: unsupported expression', exitCode: 2 };
  };

  registry.register('test', testHandler);
  registry.register('[', testHandler);
}
