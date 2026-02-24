# Clawser CLI and Shell Commands

Clawser provides two layers of command-line interaction: the `clawser` CLI for agent operations and a virtual shell with 59 built-in commands.

## Clawser CLI

**File**: `web/clawser-cli.js`

The `clawser` command provides AI agent interaction from the terminal.

### Usage

```
clawser "prompt"              One-shot ask (shorthand for -p)
clawser -p "prompt"           One-shot ask
clawser do "task"             Agentic task execution (encourages tool use)
clawser chat                  Enter interactive agent chat mode
clawser exit                  Exit agent chat mode
```

### Subcommands

| Command | Description |
|---------|-------------|
| `clawser "prompt"` | One-shot prompt (treats unrecognized args as a prompt) |
| `clawser do "task"` | Agentic task execution, encourages the agent to use tools |
| `clawser chat` | Enter interactive agent chat mode |
| `clawser exit` | Exit agent chat mode |
| `clawser config` | Show current configuration (model, tool count, history length) |
| `clawser config set KEY VALUE` | Set config value. Keys: `model`, `max_tokens`, `system_prompt` |
| `clawser status` | Show agent state summary (model, state, history, memory, goals, jobs) |
| `clawser model [name]` | Show or set the current model |
| `clawser cost` | Show session cost (from AutonomyController) |
| `clawser tools` | List available shell commands and agent tool count |
| `clawser history` | Show last 30 conversation events |
| `clawser clear` | Clear conversation history |
| `clawser compact` | Trigger context compaction |
| `clawser memory list` | List all stored memories |
| `clawser memory add KEY VALUE` | Add a memory entry (category: user) |
| `clawser memory remove KEY` | Remove a memory entry by key or ID |
| `clawser mcp` | Show MCP server status |
| `clawser help` | Show help text |

### Session Management

| Command | Description |
|---------|-------------|
| `clawser session` | List terminal sessions |
| `clawser session new [name]` | Create a new terminal session |
| `clawser session switch <name>` | Switch to a named session |
| `clawser session rename <name>` | Rename the current session |
| `clawser session delete <name>` | Delete a session |
| `clawser session fork [name]` | Fork the current session |
| `clawser session export [fmt]` | Export session (`--script`, `--markdown`, `--json`, `--jsonl`) |
| `clawser session save` | Persist the current session |

### Flags

| Flag | Short | Description |
|------|-------|-------------|
| `--print TEXT` | `-p` | Prompt text for one-shot mode |
| `--model NAME` | `-m` | Model override |
| `--system TEXT` | `-s` | System prompt override |
| `--no-stream` | | Disable streaming |
| `--continue` | | Continue previous conversation |
| `--resume` | | Resume from checkpoint |
| `--tools LIST` | | Comma-separated tool filter |
| `--max-turns N` | | Max agent loop iterations |

---

## Base Shell Builtins

**File**: `web/clawser-shell.js`

The shell supports pipes (`|`), output redirects (`>`, `>>`), logical operators (`&&`, `||`, `;`), and quoting.

### File Operations (10)

| Command | Description |
|---------|-------------|
| `pwd` | Print working directory |
| `cd <path>` | Change directory |
| `ls [path]` | List directory contents |
| `cat <file> [file...]` | Display file contents (reads from stdin if no args) |
| `mkdir <path>` | Create directory |
| `rm <path>` | Remove file |
| `cp <src> <dst>` | Copy file |
| `mv <src> <dst>` | Move/rename file |
| `head [-n N] [file]` | Show first N lines (default 10) |
| `tail [-n N] [file]` | Show last N lines (default 10) |

### Text Processing (4)

| Command | Description |
|---------|-------------|
| `grep <pattern> [file]` | Search for pattern (supports `-i`, `-v`, `-c`, `-n`) |
| `wc [file]` | Count lines, words, and characters |
| `sort [file]` | Sort lines (supports `-r`, `-n`, `-u`) |
| `uniq [file]` | Remove adjacent duplicate lines (supports `-c`, `-d`, `-u`) |

### I/O & Environment (5)

| Command | Description |
|---------|-------------|
| `echo [args...]` | Print arguments |
| `tee <file>` | Write stdin to file and stdout |
| `env` | Print all environment variables |
| `export KEY=VALUE` | Set an environment variable |
| `which <cmd>` | Show if a command is registered |

### Control (3)

| Command | Description |
|---------|-------------|
| `true` | Exit with code 0 |
| `false` | Exit with code 1 |
| `help` | List all available commands |

---

## Extended Shell Builtins

**File**: `web/clawser-shell-builtins.js`

37 additional commands registered via `registerExtendedBuiltins(registry)`.

### File Operations (8)

| Command | Description |
|---------|-------------|
| `touch <file>` | Create empty file or update timestamp |
| `stat <path>` | Show file/directory metadata |
| `find <path> [-name pattern] [-type f\|d]` | Find files matching criteria |
| `du [path]` | Show disk usage (supports `-h`, `-s`, `-d N`) |
| `basename <path>` | Extract filename from path |
| `dirname <path>` | Extract directory from path |
| `realpath <path>` | Resolve to absolute path |
| `tree [path]` | Display directory tree (supports `-L N`, `-d`, `--noreport`) |

### Text Processing (9)

| Command | Description |
|---------|-------------|
| `tr <set1> <set2>` | Translate characters (supports `-d`, `-s`) |
| `cut -d<delim> -f<fields>` | Extract fields from lines |
| `paste [-d<delim>]` | Merge lines (stdin-only) |
| `rev` | Reverse each line |
| `nl [-b a\|t] [-w N]` | Number lines |
| `fold [-w N]` | Wrap lines to width |
| `column [-t] [-s<sep>]` | Columnate output |
| `diff <file1> <file2>` | Compare files (unified diff, supports `-u`, `-y`) |
| `sed <script>` | Stream editor (supports `s/pat/repl/[g]`, `d`, `p`, line ranges) |

### Generators (6)

| Command | Description |
|---------|-------------|
| `seq [first] [incr] last` | Generate number sequence |
| `yes [string]` | Repeatedly output a string (limited to 1000 lines) |
| `printf <format> [args...]` | Formatted output (supports `%s`, `%d`, `%f`, `%x`, `%o`, `%%`, `\n`, `\t`) |
| `date [+format]` | Display current date/time |
| `sleep <seconds>` | Pause execution |
| `time <command>` | Measure command execution time |

### Shell Session (7)

| Command | Description |
|---------|-------------|
| `clear` | Clear terminal screen |
| `history` | Show command history |
| `alias [name=value]` | Set or list aliases |
| `unalias <name>` | Remove an alias |
| `set [name=value]` | Set or list shell variables |
| `unset <name>` | Remove a shell variable |
| `read <varname>` | Read stdin into a variable |

### Data & Conversion (4)

| Command | Description |
|---------|-------------|
| `xxd [file]` | Hex dump (supports `-r` for reverse) |
| `base64 [file]` | Base64 encode (supports `-d` for decode) |
| `sha256sum` | Compute SHA-256 hash of stdin |
| `md5sum` | Compute MD5 hash of stdin |

### Process-Like (3)

| Command | Description |
|---------|-------------|
| `xargs <cmd> [args]` | Build and execute commands from stdin (supports `-I{}`, `-n N`, `-d<delim>`, `-P N`) |
| `test <expr>` | Evaluate conditional expression |
| `[` | Alias for `test` (requires closing `]`) |

### Test Expressions

The `test` / `[` command supports:
- String tests: `-z str`, `-n str`, `str1 = str2`, `str1 != str2`
- Numeric tests: `n1 -eq n2`, `-ne`, `-lt`, `-le`, `-gt`, `-ge`
- File tests: `-e path`, `-f path`, `-d path`, `-s path`
- Logical: `! expr`, `expr -a expr`, `expr -o expr`
