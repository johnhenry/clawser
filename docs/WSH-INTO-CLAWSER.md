# WSH Into a Clawser Instance

This document covers the closest thing Clawser currently has to "SSH into a running instance."

The first thing to know is that Clawser itself is a browser app. There is no always-on shell daemon inside the tab. Because of that, there are two different `wsh` workflows:

1. `wsh` into a `wsh-server` running on a host. Command execution only (see the PTY note below).
2. `wsh` into a live Clawser browser tab through a relay. This is the closest match to "wsh into Clawser", and it works for normal interactive shell workloads through a browser-backed virtual terminal.

If your goal is specifically to reach a live Clawser tab, use the reverse-connect flow below. If your goal is running a command on a real host, use the direct `wsh-server` path in the last section. If you want the browser-hosted guest-console path, expose a VM peer with `--type vm-guest --backend vm-console --vm-runtime demo-linux`.

> **Provenance note**: earlier drafts of this guide described a Rust `wsh-server`/`wsh-cli` "operator" toolchain (`cargo build -p wsh-server -p wsh-cli`). That toolchain was real and did exist in this repo — six crates (`clawser-core`, `clawser-wasm`, `wsh-core`, `wsh-client`, `wsh-server`, `wsh-cli`) under a Cargo workspace, removed in commit `7a2d7a5` ("chore: remove legacy Rust crates and Cargo workspace", 2026-03-14) as a side effect of replacing Clawser's own agent core with the pure-JS runtime — not because `wsh` itself was replaced with anything. The Rust `wsh-server` specifically provided two things nothing here fully replaces:
>
> - **Native WebTransport (QUIC/HTTP3)** via `wtransport`/`quinn`, alongside a WebSocket fallback (`tokio-tungstenite`). Node has no mature built-in WebTransport server implementation; the closest option is the native-binding package [`@fails-components/webtransport`](https://github.com/fails-components/webtransport), not currently a dependency here.
> - **Real PTYs** via `portable-pty`, giving genuine `/dev/tty` semantics for both direct-host and reverse-host sessions.
>
> Practically, this matters less than it sounds: `wsh-upon-star`'s browser client already tries WebTransport first and **falls back to WebSocket automatically** when WebTransport isn't available (see step 6 below), so every flow in this guide still works end-to-end over the Node server below — you just don't get QUIC's connection-migration/multiplexing benefits, and you don't get a real PTY. The prior Rust source is still recoverable from git at `7a2d7a5~1:crates/wsh-server` and `7a2d7a5~1:crates/wsh-cli` if reviving native WebTransport/PTY support becomes worth doing.
>
> Everything below uses the real, currently-shipping pieces instead:
>
> - [`wsh-upon-star`](https://github.com/johnhenry/wsh-upon-star) — the pure-JS client library Clawser's browser `wsh` shell command is built on (re-exported via `web/packages-wsh.js`)
> - [`tools/wsh-server.mjs`](../tools/wsh-server.mjs) — a from-scratch Node.js server (WebSocket-only direct-host exec + optional reverse-connect relay) that interoperates with the real `wsh-upon-star` client
> - [`tools/wsh-operator-cli.mjs`](../tools/wsh-operator-cli.mjs) — a thin Node.js operator CLI on top of that client, replacing the removed Rust CLI's operator-side commands
>
> A few Rust-CLI conveniences have no equivalent yet and are called out explicitly where relevant instead of silently vanishing: `wsh check relay` (relay self-diagnosis), `wsh agent install` (systemd/launchd startup unit for a dial-out host agent), `wsh copy-id` (password-bootstrapped key install), `~/.wsh/known_hosts` TOFU pinning, and real PTY semantics on the host side. None of these exist in `wsh-upon-star` either — they'd need to be built from scratch, same as the server and CLI below were (or recovered from the removed Rust source above).

## Topology At A Glance

| Mode | Source | Target | Transport Path | Terminal Type | Status |
|------|--------|--------|----------------|---------------|--------|
| Direct host | Node `wsh-operator-cli.mjs` or browser `wsh` client | `tools/wsh-server.mjs` on a host | Direct `ws(s)://host:port` | Command exec (no PTY) | Implemented |
| Reverse browser peer | Node `wsh-operator-cli.mjs` | Live Clawser tab | Relay-mediated reverse connect (`tools/wsh-server.mjs --enable-relay`) | Virtual terminal | Implemented for interactive shell workloads |
| Reverse host peer | Node `wsh-operator-cli.mjs` | Relay-registered host agent | Relay-mediated reverse connect | Real PTY | **Not implemented** — no host-side dial-out agent exists yet (see below) |
| VM guest peer | Node `wsh-operator-cli.mjs` | Browser-hosted VM console | Relay-mediated reverse connect | VM console | Implemented for the `demo-linux` MVP runtime (uses the same relay path — Clawser's browser client handles the peer side) |

```mermaid
flowchart LR
  A["Node wsh-operator-cli.mjs"] -->|direct ws(s)://host:port| B["tools/wsh-server.mjs"]
  A -->|reverse-connect via relay| C["tools/wsh-server.mjs --enable-relay"]
  C --> D["Clawser browser peer"]
  C --> E["wsh-agent host peer (not built)"]
  C --> F["VM guest peer (demo-linux)"]
```

Use this rule of thumb:

- choose **direct host** when you need to run commands on a host over the network
- choose **reverse browser peer** when you need to reach a live tab/workspace
- **reverse host peer** (a machine that dials out but should not expose an inbound listener) is a documented gap, not a supported path today
- choose **VM guest peer** only when you specifically want a browser-hosted guest runtime rather than the normal browser shell

## Support Matrix

| Capability | Direct host | Reverse browser peer | Reverse host peer | VM guest peer |
|------------|-------------|----------------------|-------------------|---------------|
| Interactive shell | No (one-shot exec only) | Yes | Not implemented | Yes |
| Real PTY semantics | No | No | Not implemented | No |
| File transfer | No | Yes | Not implemented | Partial |
| Tool / MCP access | No | Yes | Not implemented | Partial |
| Attach / replay | No | Yes | Not implemented | Partial |
| Echo / term sync hints | No | Yes | Not implemented | No |

`tools/wsh-server.mjs` implements `kind: 'exec'` sessions only — it spawns the command, streams stdout/stderr back, and reports the exit code. It explicitly rejects `kind: 'pty'` with an error, since there's no PTY backend (no `node-pty` or equivalent dependency) wired up. If you need a real Unix PTY today, the reverse browser peer path (into a live Clawser tab's virtual terminal) or your own SSH remain the practical options.

## Remote Filesystem Modes

Phase 7A supports three distinct remote file access modes, unrelated to the direct-host/relay distinction above:

- `transfer`: explicit upload/download or structured file read/write over `wsh`
- `live browse`: remote listing/stat/read/write flows used by the shared remote runtime UI and broker-backed orchestration paths
- `mount`: remote peers exposed through the remote mount manager so shell/filesystem surfaces can consume them as mounted runtimes

Use `transfer` for bulk movement, `live browse` for remote inspection/edit flows, and `mount` when you want the remote runtime to behave like an attached filesystem surface in Clawser. These are Clawser browser-side features (`web/clawser-wsh-cli.js` and friends) and work the same regardless of which server/relay you're talking to.

Terminology used in this guide:

- **Direct host session**: a `wsh-operator-cli.mjs exec` (or browser `wsh connect`) session into `tools/wsh-server.mjs`
- **Reverse peer**: a runtime that registered outward to a relay and can be reached with `wsh-operator-cli.mjs reverse-connect`
- **Virtual terminal**: a browser-backed, PTY-like terminal stream implemented in app/runtime code rather than by the host kernel
- **Real PTY**: a host/kernel terminal device backing an interactive shell
- **Peer capability**: the advertised surfaces a reverse peer exposes, such as `shell`, `fs`, `tools`, or `gateway`

## Before You Start

This guide uses three different command surfaces:

- `Repo shell`: your normal macOS/Linux terminal in the repo root
- `Relay shell`: the shell on the machine running `tools/wsh-server.mjs`
- `Clawser terminal`: the terminal panel inside the target Clawser browser tab

Sometimes `Relay shell` and `Repo shell` are the same machine. That is fine.

Two important address rules:

- In the `Clawser terminal`, `wsh reverse` accepts `relay-host[:port]`
- In `wsh-operator-cli.mjs`, `peers` and `reverse-connect` accept a bare host; the port comes from `-p/--port` and defaults to `4422`

So for a local relay:

- `Clawser terminal`: `wsh -i clawser-tab reverse localhost:4422`
- `Repo shell` (operator): `node tools/wsh-operator-cli.mjs peers localhost`

Do not write `localhost:4422` in `wsh-operator-cli.mjs` commands — the port is a separate `-p` flag.

Use the relay hostname as seen from the place where the command runs:

- if the relay is on the same machine as the browser tab, `localhost` works in the `Clawser terminal`
- if the relay is on another machine, use a hostname the browser can reach
- if the relay is on the same machine as the operator CLI, `localhost` works there too
- if the relay is on another machine, use a hostname the CLI machine can reach

## What You Need

- A machine that can run `tools/wsh-server.mjs` (Node 18+; the `ws` and `wsh-upon-star` packages are already root dependencies of this repo)
- A running Clawser tab for the target instance
- TLS for the relay/server, if it's reachable over anything other than `localhost`
- Public keys added to the relay/server's `authorized_keys` file

For local browser testing, the repo's default static server runs over HTTPS:

```bash
npm start
```

That serves Clawser at `https://localhost:8080`, which is the simplest local origin for reverse-browser `wsh` work.

There is no separate CLI binary to install — `tools/wsh-operator-cli.mjs` is run directly with `node`:

```bash
node tools/wsh-operator-cli.mjs ...
```

That replaces every `wsh ...` command in your normal shell in the rest of this guide. It is not needed inside the `Clawser terminal`, where `wsh` is already a built-in shell command.

## 1. Start Clawser

Run this in the `Repo shell`:

```bash
npm start
```

Then open:

```text
https://localhost:8080
```

Open the target workspace and keep its terminal available for later steps.

## 2. Start a Relay Server

Run this in the `Relay shell`. No build step is needed — it's a plain ES module.

If you only need local development on `localhost`, plain `ws://` is fine (browsers only require TLS for a *non-localhost* origin doing WebTransport/secure-context work — talking to a `ws://localhost` relay from an `https://localhost:8080` page works):

```bash
node tools/wsh-server.mjs --enable-relay --port 4422
```

For a real hostname, pass a certificate that matches it (there's no `--generate-cert` convenience flag — bring your own cert/key, e.g. from `mkcert` or your normal ACME flow):

```bash
node tools/wsh-server.mjs \
  --enable-relay \
  --port 4422 \
  --cert /path/to/fullchain.pem \
  --key /path/to/privkey.pem
```

The default auth model reads public keys from `~/.wsh/authorized_keys` (override with `--authorized-keys <path>`; unlike the old Rust server, there's no automatic fallback to `~/.ssh/authorized_keys`).

There is no `~/.wsh/known_hosts` TOFU pinning today — `wsh-operator-cli.mjs` doesn't verify the server's identity beyond the auth handshake itself. If you need host-key pinning, that's a documented gap, not a silent regression.

If you are doing everything locally on one machine, the relay address for the rest of this guide is:

- `Clawser terminal`: `localhost:4422`
- `Repo shell` (operator): `localhost` with the default port `4422`

## 2A. Relay Self-Check

There's no `wsh check relay` diagnostic command today. To sanity-check the setup manually:

`Repo shell`

```bash
npm start
```

Expected: Clawser serves from `https://localhost:8080`.

`Relay shell`

```bash
node tools/wsh-server.mjs --enable-relay --port 4422
```

Expected: `wsh-server ready on ws://0.0.0.0:4422 (relay enabled)`.

`Repo shell` (operator)

```bash
node tools/wsh-operator-cli.mjs keys
node tools/wsh-operator-cli.mjs peers localhost
```

Expected:

- your operator identity exists (or run `keygen` first — see step 4 below)
- the relay command returns immediately, even if no peers are online yet (`No peers registered.`)

There is no `wsh agent install` equivalent — a host-side agent that dials out to the relay and survives login/session churn as a startup unit doesn't exist yet. If you need a reverse host peer that starts automatically, you'll need to wrap `wsh-operator-cli.mjs` (or a small script built on the `WshClient` reverse-connect API it uses) in your own `launchd`/`systemd --user` unit.

## 3. Generate a Key for the Target Clawser Tab

Run this in the `Clawser terminal` inside the target browser tab:

```bash
wsh keygen clawser-tab
```

Copy the full `ssh-ed25519 ...` public key printed by that command somewhere safe. You will paste it into the relay's `authorized_keys` file in step 5.

Note:

- The browser `wsh keys` command shows only a shortened public key preview
- If you need the full browser public key later, the simplest path is to generate a fresh named key and copy the printed output immediately

## 4. Generate a Key for the CLI Operator

Run this in the `Repo shell`:

```bash
node tools/wsh-operator-cli.mjs keygen operator
cat ~/.wsh/keys/operator.pub
```

Copy that full public key as well. You will also paste this into the relay's `authorized_keys` file in step 5.

## 5. Authorize Both Keys on the Relay

Run this in the `Relay shell`:

```bash
mkdir -p ~/.wsh
chmod 700 ~/.wsh
touch ~/.wsh/authorized_keys
chmod 600 ~/.wsh/authorized_keys
```

Then append both public keys, one line each, to `~/.wsh/authorized_keys`:

- the browser key from step 3
- the CLI key from step 4

One simple way is:

```bash
cat >> ~/.wsh/authorized_keys
```

Then paste:

1. the full `ssh-ed25519 ...` line from the `Clawser terminal`
2. the full `ssh-ed25519 ...` line from `~/.wsh/keys/operator.pub`

Then press `Ctrl+D`.

After this step, both the Clawser tab and the CLI can authenticate to the relay. If you restart `tools/wsh-server.mjs`, it re-reads `authorized_keys` from disk on the next start (there's no hot-reload — restart the server after editing the file).

## 6. Register the Target Clawser Tab as a Reverse Peer

Run this in the `Clawser terminal`.

For local development, where the relay is running on the same machine as the browser:

```bash
wsh -i clawser-tab reverse localhost:4422
```

For a remote relay:

```bash
wsh -i clawser-tab reverse relay.example.com:4422
```

If you want to expose only specific capabilities instead of the default "all", use the same relay address with flags:

```bash
wsh -i clawser-tab reverse localhost:4422 --expose-shell
```

Or:

```bash
wsh -i clawser-tab reverse localhost:4422 --expose-shell --expose-tools --expose-fs
```

You can also use named presets and require local approval for each incoming reverse session:

```bash
wsh -i clawser-tab reverse localhost:4422 --preset shell-only --require-approval
```

For a VM-backed peer:

```bash
wsh -i clawser-tab reverse localhost:4422 --preset vm-console
```

What to expect:

- the terminal prints a short peer fingerprint
- the browser remote panel shows what this tab is exposing, whether approvals are automatic or per-session, and how many incoming reverse sessions are active
- the tab must stay open, because the reverse registration is tied to that live browser session
- after registration, the relay knows this browser tab as a reverse-connectable peer

`tools/wsh-server.mjs` only speaks plain WebSocket (`ws://`/`wss://`), not WebTransport — Clawser's browser client falls back to WebSocket automatically when WebTransport isn't available or the relay doesn't offer it, so this works, but there's no WebTransport path to fall back *from* with this relay.

## 7. Discover the Clawser Peer from the CLI

Run this in the `Repo shell`.

For local development, where the relay is on the same machine as the CLI:

```bash
node tools/wsh-operator-cli.mjs peers localhost
```

For a remote relay on the default port:

```bash
node tools/wsh-operator-cli.mjs peers relay.example.com
```

For a non-default port:

```bash
node tools/wsh-operator-cli.mjs peers relay.example.com -p 5544
```

You should see a peer list with a short fingerprint, a username, and exposed capabilities. Take note of the fingerprint — `wsh-operator-cli.mjs reverse-connect` (unlike the old Rust CLI) takes the fingerprint only, not a `@name` selector.

## 8. Send the Reverse-Connect Request

Run this in the `Repo shell`.

```bash
node tools/wsh-operator-cli.mjs reverse-connect <fingerprint> localhost -- echo hello
```

For a remote relay on a non-default port:

```bash
node tools/wsh-operator-cli.mjs reverse-connect <fingerprint> relay.example.com -p 5544 -- echo hello
```

At this point:

- the relay forwards `ReverseConnect` to the Clawser tab
- the browser accepts or rejects the request
- on accept, `wsh-operator-cli.mjs` opens a browser-backed virtual terminal channel, runs the given command, and prints its output

Unlike the old Rust CLI, `wsh-operator-cli.mjs reverse-connect` runs one command and exits — it's not an interactive terminal loop. If the peer rejects the connection, the CLI prints the rejection reason and exits non-zero.

There's no `wsh check relay` diagnostic if this fails. The most common causes: the fingerprint is stale (the peer disconnected — re-run `peers` to refresh it), the authorized_keys file wasn't updated after generating a new key, or the relay isn't running with `--enable-relay`.

## 9. Current Limits of the Browser Path

The reverse browser terminal is interactive, but it is still not the same thing as a real host PTY.

What works well:

- relay support via `tools/wsh-server.mjs --enable-relay`
- browser reverse-peer registration
- peer discovery
- reverse-connect accept/reject handshake
- browser-side line editing, prompt redraw, history, resize, Ctrl-C, and Ctrl-D (from the `Clawser terminal` side)
- replay/reattach of browser-owned terminal state across reconnects

What this path is not:

- a kernel-backed PTY
- a shell attached to a real Unix TTY device
- an interactive terminal loop from `wsh-operator-cli.mjs` — it runs one command per `reverse-connect` invocation today

Practical consequences:

- good fit: Clawser shell commands, normal command output, one-shot commands from the operator CLI
- not a good fit: `vim`, `tmux`, `top`, `less`, curses apps, job control, or programs that require real `/dev/tty` semantics

So the reverse browser path is usable, but it should be understood as an emulated PTY-like terminal backed by the browser shell runtime, driven one command at a time from the operator side.

## 10. Direct Host Sessions Today

`tools/wsh-server.mjs` also runs without `--enable-relay`, accepting direct exec sessions from any authorized client.

### On the target host

1. Add the operator's public key to `~/.wsh/authorized_keys`
2. Start the server

Local dev example:

```bash
node tools/wsh-server.mjs --port 4422
```

Real host example:

```bash
node tools/wsh-server.mjs \
  --port 4422 \
  --cert /path/to/fullchain.pem \
  --key /path/to/privkey.pem
```

### From the CLI

```bash
node tools/wsh-operator-cli.mjs exec target.example.com "uname -a"
```

This is one-shot command execution with stdout and an exit code — there is no interactive shell loop and no PTY on this path either. There's also no `wsh copy-id` password-bootstrap equivalent; keys must be added to `authorized_keys` out of band (e.g. by whoever has shell access to the host already).

## 11. If You Want Clawser to Reach the Host Instead

If what you actually meant was "from Clawser, connect to a remote machine with `wsh`", use the Clawser terminal or the `wsh_*` tools instead of the reverse-connect flow:

```bash
wsh alice@target.example.com
```

Or through the browser tool layer:

- `wsh_connect`
- `wsh_exec`
- `wsh_pty_open`
- `wsh_pty_write`
- `wsh_upload`
- `wsh_download`

That path is implemented today, provided the remote host is running `tools/wsh-server.mjs` (or any wsh-v1-compatible server) and has authorized the browser key. Note `wsh_pty_open`/`wsh_pty_write` specifically require a server that supports `kind: 'pty'` sessions — `tools/wsh-server.mjs` doesn't (see the PTY note in the Support Matrix above), so those two tools will fail with an `OPEN_FAIL` against it today; `wsh_connect`/`wsh_exec`/`wsh_upload`/`wsh_download` all work against it.
