---
title: "Shell"
---

Virtual shell, builtins, parser, pipes, redirects, globs, variables, OPFS, sessions

---

### Shell Interpreter

**Status:** ✅ Implemented · **Category:** interpreter · **Since:** v1.0.0

Full shell interpreter running in the browser. Tokenizer, parser, and executor with AST-based evaluation. Supports pipes, redirects, command chaining, environment variables, glob expansion, brace expansion, command substitution, and variable substitution. Approximately 3,376 LOC.

**Source files:**

- `web/clawser-shell.js`
- `web/clawser-shell.d.ts`

**API surface:**

- `ClawserShell`
- `tokenize`
- `parse`
- `expandVariables`
- `expandCommandSubs`
- `expandBraces`
- `expandGlobs`
- `normalizePath`
- `execute`

![Shell Interpreter](../docs/screenshots/panel-terminal.png)

> **Note:** AST node types: ShellToken, CommandNode, PipelineNode, ListNode, RedirectInfo. Shell state tracks cwd, env vars, aliases, and last exit code.

**See also:**

- Command Registry
- Terminal Sessions

---

### Command Registry

**Status:** ✅ Implemented · **Category:** registry · **Since:** v1.0.0

All shell builtins are registered with metadata (name, description, usage, flags) via CommandRegistry. Powers the Shell Commands panel in Tool Management and shell help. Supports registration, lookup, and metadata queries.

**Source files:**

- `web/clawser-shell.js`
- `web/clawser-shell.d.ts`

**API surface:**

- `CommandRegistry`
- `registerBuiltins`
- `CommandMeta`
- `CommandEntry`

**See also:**

- Shell Interpreter

---

### Shell Factory

**Status:** ✅ Implemented · **Category:** factory · **Since:** v1.0.0

Factory function to create fully configured shell instances with all builtins registered and OPFS filesystem connected.

**Source files:**

- `web/clawser-shell-factory.js`
- `web/clawser-shell-factory.d.ts`

**API surface:**

- `createConfiguredShell`

---

### OPFS Filesystem

**Status:** ✅ Implemented · **Category:** filesystem · **Since:** v1.0.0

ShellFs and MemoryFs implementations that back the shell's filesystem operations. ShellFs wraps the Origin Private File System (OPFS) for persistent storage. MemoryFs provides an in-memory filesystem for testing.

**Source files:**

- `web/clawser-shell.js`

**API surface:**

- `ShellFs`
- `MemoryFs`
- `ShellFsLike`

---

### Workspace Home (`/home/<name>`)

**Status:** ✅ Implemented · **Category:** filesystem · **Since:** v2.1.0

Each workspace gets a stable `/home/<name>` directory in the shell view, derived from the workspace's user-facing `name` (not its internal `ws_<base36>_<rand>` storage id). Names are lowercased, NFKD-normalized (non-ASCII dropped), restricted to `a-z0-9_-`, and collisions are resolved with a stable numeric suffix (`-2`, `-3`, …) in workspace-list order. The `default` workspace always keeps the bare name `default`; reserved top-level names (`proc`, `etc`, `dev`, `home`, `bin`, …) fall back to `workspace` if a workspace happens to sanitize to one of them.

**Source files:**

- `web/clawser-workspace-name.mjs`
- `web/clawser-home-views.js`

**API surface:**

- `sanitizeWorkspaceName`
- `buildSanitizedNameMap`
- `activeSanitizedName`
- `wsIdForSanitizedName`
- `renderHomeWorkspaceList`
- `renderHomeAccountList`

> **Note:** `cat /proc/clawser/workspaces` lists every workspace's id, name, resolved `/home/<name>` path, and whether it's active — see the `/proc Virtual Filesystem` entry in Workspace. Example: "Café" sanitizes to `cafe`, "My Project" to `my-project`; a second workspace also named "My Project" becomes `my-project-2`.

**See also:**

- OPFS Filesystem
- [Workspace: /proc Virtual Filesystem](/docs/guide/workspace/)

---

### Pipes and Redirects

**Status:** ✅ Implemented · **Category:** pipes · **Since:** v1.0.0

Full pipe and redirect support. Pipes (|) connect stdout of one command to stdin of the next. Redirects support > (overwrite), >> (append), 2> (stderr), and 2>&1 (merge stderr into stdout). Logical operators && and || for conditional execution.

**Source files:**

- `web/clawser-shell.js`

**API surface:**

- `PipelineNode`
- `RedirectInfo`
- `StderrRedirectInfo`

---

### Variable Substitution

**Status:** ✅ Implemented · **Category:** variables · **Since:** v1.0.0

Shell variable expansion supporting $VAR, ${VAR}, $? (last exit code), and environment variable access. Variables are stored in ShellState.

**Source files:**

- `web/clawser-shell.js`

**API surface:**

- `expandVariables`
- `ShellState`

---

### Glob Expansion

**Status:** ✅ Implemented · **Category:** globs · **Since:** v1.0.0

Filename glob expansion supporting * (any chars), ? (single char), and [abc] (character class) patterns. Expansion happens against the OPFS filesystem.

**Source files:**

- `web/clawser-shell.js`

**API surface:**

- `expandGlobs`

---

### Tab Completion

**Status:** ✅ Implemented · **Category:** completion · **Since:** v1.1.0

Pressing Tab in the terminal panel completes the current word against builtin command names (in command position) or directory entries (in path position). A second Tab on the same input cycles through multiple matches. Smart token-position detection: command vs. path inferred from cursor position relative to whitespace.

**Source files:**

- `web/clawser-shell.js`
- `web/clawser-ui-panels.js`

**API surface:**

- `getCompletions`

---

### cd

**Status:** ✅ Implemented · **Category:** builtin-navigation · **Since:** v1.0.0

Change the current working directory.

**Source files:**

- `web/clawser-shell.js`

---

### pwd

**Status:** ✅ Implemented · **Category:** builtin-navigation · **Since:** v1.0.0

Print the current working directory.

**Source files:**

- `web/clawser-shell.js`

---

### ls

**Status:** ✅ Implemented · **Category:** builtin-navigation · **Since:** v1.0.0

List directory contents with optional long format and all-files flags.

**Source files:**

- `web/clawser-shell.js`

---

### find

**Status:** ✅ Implemented · **Category:** builtin-navigation · **Since:** v1.0.0

Search for files by name pattern.

**Source files:**

- `web/clawser-shell.js`

---

### cat

**Status:** ✅ Implemented · **Category:** builtin-fileops · **Since:** v1.0.0

Concatenate and display file contents.

**Source files:**

- `web/clawser-shell.js`

---

### mkdir

**Status:** ✅ Implemented · **Category:** builtin-fileops · **Since:** v1.0.0

Create directories with optional -p flag for parents.

**Source files:**

- `web/clawser-shell.js`

---

### rm

**Status:** ✅ Implemented · **Category:** builtin-fileops · **Since:** v1.0.0

Remove files and directories with optional -r recursive flag.

**Source files:**

- `web/clawser-shell.js`

---

### cp

**Status:** ✅ Implemented · **Category:** builtin-fileops · **Since:** v1.0.0

Copy files and directories.

**Source files:**

- `web/clawser-shell.js`

---

### mv

**Status:** ✅ Implemented · **Category:** builtin-fileops · **Since:** v1.0.0

Move or rename files and directories.

**Source files:**

- `web/clawser-shell.js`

---

### touch

**Status:** ✅ Implemented · **Category:** builtin-fileops · **Since:** v1.0.0

Create an empty file or update timestamps.

**Source files:**

- `web/clawser-shell.js`

---

### grep

**Status:** ✅ Implemented · **Category:** builtin-text · **Since:** v1.0.0

Search file contents with regex support and -i, -r, -n, -c flags.

**Source files:**

- `web/clawser-shell.js`

---

### sed

**Status:** ✅ Implemented · **Category:** builtin-text · **Since:** v1.0.0

Stream editor for text transformations (s/pattern/replacement/ syntax).

**Source files:**

- `web/clawser-shell.js`

---

### tr

**Status:** ✅ Implemented · **Category:** builtin-text · **Since:** v1.0.0

Translate or delete characters.

**Source files:**

- `web/clawser-shell.js`

---

### sort

**Status:** ✅ Implemented · **Category:** builtin-text · **Since:** v1.0.0

Sort lines of text with -r (reverse), -n (numeric), -u (unique) flags.

**Source files:**

- `web/clawser-shell.js`

---

### uniq

**Status:** ✅ Implemented · **Category:** builtin-text · **Since:** v1.0.0

Report or filter out repeated lines with -c (count), -d (duplicates) flags.

**Source files:**

- `web/clawser-shell.js`

---

### wc

**Status:** ✅ Implemented · **Category:** builtin-text · **Since:** v1.0.0

Count lines, words, and characters.

**Source files:**

- `web/clawser-shell.js`

---

### head

**Status:** ✅ Implemented · **Category:** builtin-text · **Since:** v1.0.0

Output the first N lines of a file.

**Source files:**

- `web/clawser-shell.js`

---

### tail

**Status:** ✅ Implemented · **Category:** builtin-text · **Since:** v1.0.0

Output the last N lines of a file.

**Source files:**

- `web/clawser-shell.js`

---

### cut

**Status:** ✅ Implemented · **Category:** builtin-text · **Since:** v1.0.0

Remove sections from each line of files by delimiter and field.

**Source files:**

- `web/clawser-shell.js`

---

### paste

**Status:** ✅ Implemented · **Category:** builtin-text · **Since:** v1.0.0

Merge lines of files side by side.

**Source files:**

- `web/clawser-shell.js`

---

### xargs

**Status:** ✅ Implemented · **Category:** builtin-text · **Since:** v1.0.0

Build and execute commands from stdin.

**Source files:**

- `web/clawser-shell.js`

---

### echo

**Status:** ✅ Implemented · **Category:** builtin-scripting · **Since:** v1.0.0

Display text to stdout.

**Source files:**

- `web/clawser-shell.js`

---

### env

**Status:** ✅ Implemented · **Category:** builtin-scripting · **Since:** v1.0.0

Display or set environment variables.

**Source files:**

- `web/clawser-shell.js`

---

### export

**Status:** ✅ Implemented · **Category:** builtin-scripting · **Since:** v1.0.0

Set environment variables for the session.

**Source files:**

- `web/clawser-shell.js`

---

### read

**Status:** ✅ Implemented · **Category:** builtin-scripting · **Since:** v1.0.0

Read a line of input into a variable.

**Source files:**

- `web/clawser-shell.js`

---

### alias

**Status:** ✅ Implemented · **Category:** builtin-scripting · **Since:** v1.0.0

Create command aliases.

**Source files:**

- `web/clawser-shell.js`

---

### unalias

**Status:** ✅ Implemented · **Category:** builtin-scripting · **Since:** v1.0.0

Remove command aliases.

**Source files:**

- `web/clawser-shell.js`

---

### test / [

**Status:** ✅ Implemented · **Category:** builtin-scripting · **Since:** v1.0.0

Evaluate conditional expressions (file tests, string comparison, numeric comparison).

**Source files:**

- `web/clawser-shell.js`

---

### diff

**Status:** ✅ Implemented · **Category:** builtin-advanced · **Since:** v1.0.0

Compare files line by line.

**Source files:**

- `web/clawser-shell.js`

---

### xxd

**Status:** ✅ Implemented · **Category:** builtin-advanced · **Since:** v1.0.0

Make a hex dump or do the reverse.

**Source files:**

- `web/clawser-shell.js`

---

### base64

**Status:** ✅ Implemented · **Category:** builtin-advanced · **Since:** v1.0.0

Encode or decode base64 data.

**Source files:**

- `web/clawser-shell.js`

---

### md5sum

**Status:** ✅ Implemented · **Category:** builtin-advanced · **Since:** v1.0.0

Compute MD5 message digest.

**Source files:**

- `web/clawser-shell.js`

---

### sha256sum

**Status:** ✅ Implemented · **Category:** builtin-advanced · **Since:** v1.0.0

Compute SHA-256 message digest.

**Source files:**

- `web/clawser-shell.js`

---

### time

**Status:** ✅ Implemented · **Category:** builtin-advanced · **Since:** v1.0.0

Time the execution of a command.

**Source files:**

- `web/clawser-shell.js`

---

### timeout

**Status:** ✅ Implemented · **Category:** builtin-advanced · **Since:** v1.0.0

Run a command with a time limit.

**Source files:**

- `web/clawser-shell.js`

---

### true

**Status:** ✅ Implemented · **Category:** builtin-scripting · **Since:** v1.0.0

Exit with success status.

**Source files:**

- `web/clawser-shell.js`

---

### false

**Status:** ✅ Implemented · **Category:** builtin-scripting · **Since:** v1.0.0

Exit with failure status.

**Source files:**

- `web/clawser-shell.js`

---

### help

**Status:** ✅ Implemented · **Category:** builtin-scripting · **Since:** v1.0.0

Display help for builtins.

**Source files:**

- `web/clawser-shell.js`

---

### history

**Status:** ✅ Implemented · **Category:** builtin-scripting · **Since:** v1.0.0

Display command history.

**Source files:**

- `web/clawser-shell.js`

---

### clear

**Status:** ✅ Implemented · **Category:** builtin-scripting · **Since:** v1.0.0

Clear the terminal screen.

**Source files:**

- `web/clawser-shell.js`

---

### date

**Status:** ✅ Implemented · **Category:** builtin-advanced · **Since:** v1.0.0

Display or set the system date and time.

**Source files:**

- `web/clawser-shell.js`

---

### sleep

**Status:** ✅ Implemented · **Category:** builtin-advanced · **Since:** v1.0.0

Pause execution for N seconds.

**Source files:**

- `web/clawser-shell.js`

---

### tee

**Status:** ✅ Implemented · **Category:** builtin-advanced · **Since:** v1.0.0

Read from stdin and write to stdout and files simultaneously.

**Source files:**

- `web/clawser-shell.js`

---

### du

**Status:** ✅ Implemented · **Category:** builtin-fileops · **Since:** v1.0.0

Display disk usage of files and directories.

**Source files:**

- `web/clawser-shell.js`

---

### which

**Status:** ✅ Implemented · **Category:** builtin-scripting · **Since:** v1.0.0

Locate a command in the registry.

**Source files:**

- `web/clawser-shell.js`

---

### type

**Status:** ✅ Implemented · **Category:** builtin-scripting · **Since:** v1.0.0

Show whether a name is a builtin, alias, or external command.

**Source files:**

- `web/clawser-shell.js`

---

### printf

**Status:** ✅ Implemented · **Category:** builtin-scripting · **Since:** v1.0.0

Formatted output.

**Source files:**

- `web/clawser-shell.js`

---

### seq

**Status:** ✅ Implemented · **Category:** builtin-advanced · **Since:** v1.0.0

Print a sequence of numbers.

**Source files:**

- `web/clawser-shell.js`

---

### yes

**Status:** ✅ Implemented · **Category:** builtin-advanced · **Since:** v1.0.0

Output a string repeatedly.

**Source files:**

- `web/clawser-shell.js`

---

### rev

**Status:** ✅ Implemented · **Category:** builtin-text · **Since:** v1.0.0

Reverse lines character-by-character.

**Source files:**

- `web/clawser-shell.js`

---

### tac

**Status:** ✅ Implemented · **Category:** builtin-text · **Since:** v1.0.0

Concatenate and print files in reverse line order.

**Source files:**

- `web/clawser-shell.js`

---

### jq

**Status:** ✅ Implemented · **Category:** builtin-advanced · **Since:** v1.0.0

JSON query and transformation tool.

**Source files:**

- `web/clawser-shell.js`

> **Note:** Browser-native jq implementation for JSON processing in pipelines.

---

### Clawser CLI

**Status:** ✅ Implemented · **Category:** cli · **Since:** v1.0.0

18-subcommand CLI namespace accessible via the 'clawser' shell command. Provides agent management, workspace operations, provider configuration, and utility commands.

**Source files:**

- `web/clawser-cli.js`

**API surface:**

- `clawser`

> **Note:** Subcommands include agent operations, workspace management, provider switching, memory operations, goal management, and system commands.

---

### Andbox CLI

**Status:** ✅ Implemented · **Category:** cli · **Since:** v1.5.0

Sandboxed JavaScript runtime CLI accessible via the 'andbox' shell command. Supports REPL mode, file execution, virtual module definition, and import maps. Multiple security profiles (minimal, web, fs, full, agent).

**Source files:**

- `web/clawser-andbox-cli.js`
- `web/clawser-andbox-cli.d.ts`

**API surface:**

- `registerAndboxCli`
- `ANDBOX_SUBCOMMAND_META`

> **Note:** Subcommands: run, repl, define, import-map, status, dispose.

---

### Scheduler CLI

**Status:** ✅ Implemented · **Category:** cli · **Since:** v1.5.0

Routine/scheduler management CLI accessible via the 'cron' or 'schedule' shell command. Supports listing, adding (cron/interval/once), removing, pausing, resuming, and force-executing routines.

**Source files:**

- `web/clawser-scheduler-cli.js`

**API surface:**

- `registerSchedulerCli`

> **Note:** Subcommands: list, add, remove, pause, resume, history, run, status.

---

### WSH CLI

**Status:** ✅ Implemented · **Category:** cli · **Since:** v1.5.0

Remote shell CLI accessible via the 'wsh' shell command. Provides SSH-like remote access with subcommands for connecting, executing, file transfer, and PTY management.

**Source files:**

- `web/clawser-wsh-cli.js`
- `web/clawser-wsh-cli.d.ts`

**API surface:**

- `registerWshCli`
- `FLAG_SPEC`
- `WSH_SUBCOMMAND_META`

---

### Terminal Sessions

**Status:** ✅ Implemented · **Category:** sessions · **Since:** v1.0.0

First-class terminal session management. Multiple named sessions with history, fork, rename, replay, and export (script, markdown, JSON). Session state persisted per-workspace via terminal session store.

**Source files:**

- `web/clawser-shell.js`
- `web/clawser-terminal-session-store.js`
- `web/clawser-item-bar.js`

**API surface:**

- `terminalSessions`
- `renderTerminalSessionBar`
- `replayTerminalSession`

![Terminal Sessions](../docs/screenshots/22-terminal-sessions.png)

---

### If/Else/Fi Conditionals

**Status:** ✅ Implemented · **Category:** shell-language · **Since:** v2.1.0

Full if/then/elif/else/fi conditional syntax in the shell language. Supports nested conditionals, test expressions, and compound conditions with && and ||. Multi-line input detected via isIncomplete() for interactive entry.

**Source files:**

- `web/clawser-shell.js`

**See also:**

- Shell Interpreter

---

### While/For Loops

**Status:** ✅ Implemented · **Category:** shell-language · **Since:** v2.1.0

Loop constructs: while/do/done and for/in/do/done. While loops evaluate a condition each iteration. For loops iterate over word lists with variable binding. Both support break and continue. Nested loops supported.

**Source files:**

- `web/clawser-shell.js`

**See also:**

- Shell Interpreter

---

### Function Definitions

**Status:** ✅ Implemented · **Category:** shell-language · **Since:** v2.1.0

Shell function definitions via fn() { body } syntax. Functions are stored in ShellState and invoked as regular commands. Supports positional parameters, local variables, and return values within function scope.

**Source files:**

- `web/clawser-shell.js`

**See also:**

- Shell Interpreter

---

### Source Builtin and Profile System

**Status:** ✅ Implemented · **Category:** shell-language · **Since:** v2.1.0

The source (.) builtin executes shell scripts in the current environment. Powers the profile system: /etc/clawser/profile runs on shell init for global defaults, ~/.clshrc runs per-user customizations. Enables reusable shell libraries and configuration scripts.

**Source files:**

- `web/clawser-shell.js`
- `web/clawser-fs-bootstrap.mjs`

**See also:**

- Shell Interpreter

---

### Positional Parameters

**Status:** ✅ Implemented · **Category:** shell-language · **Since:** v2.1.0

Positional parameter expansion for shell functions and sourced scripts. Supports $1 through $9 for individual arguments, $@ for all arguments as separate words, and $# for the argument count.

**Source files:**

- `web/clawser-shell.js`

**See also:**

- Function Definitions
- Variable Substitution

---

### local

**Status:** ✅ Implemented · **Category:** builtin-scripting · **Since:** v2.1.0

Declare function-local variables that do not leak into the parent scope. Restores previous values on function return.

**Source files:**

- `web/clawser-shell.js`

---

### return

**Status:** ✅ Implemented · **Category:** builtin-scripting · **Since:** v2.1.0

Return from a shell function with an optional exit code. Sets $? to the specified value (default 0).

**Source files:**

- `web/clawser-shell.js`

---

### Clsh Identity

**Status:** ✅ Implemented · **Category:** shell-language · **Since:** v2.1.0

The shell identifies itself as clsh (Clawser Shell). $SHELL is set to "clsh" and $CLSH_VERSION reports the current version. Distinguishes clawser's shell from bash/zsh in scripts and profile conditionals.

**Source files:**

- `web/clawser-shell.js`

---

---

[← Providers](/docs/guide/providers/) | [Index](/docs/) | [Memory →](/docs/guide/memory/)
