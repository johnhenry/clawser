# WSH Into a Clawser Instance

This document covers the closest thing Clawser currently has to "SSH into a running instance."

The first thing to know is that Clawser itself is a browser app. There is no always-on shell daemon inside the tab. Because of that, there are two different `wsh` workflows:

1. `wsh` into a `wsh-server` running on a host. This is the fully implemented path today.
2. `wsh` into a live Clawser browser tab through a relay. This is the closest match to "wsh into Clawser", but it is only partially implemented in this repo.

If your goal is a working remote PTY right now, use the direct `wsh-server` path in the last section. If your goal is specifically to reach a live Clawser tab, use the reverse-connect flow below and note the current limitation.

## What You Need

- A machine that can run `wsh-server`
- A machine that can run the Rust `wsh` CLI
- A running Clawser tab for the target instance
- TLS for the relay/server
- Public keys added to the relay/server's `authorized_keys`

In the CLI examples below, use the installed `wsh` binary if you have it. If you do not, replace `wsh ...` with:

```bash
cargo run -p wsh-cli -- ...
```

## 1. Build the Server and CLI

From the repo root:

```bash
cargo build -p wsh-server -p wsh-cli
```

## 2. Start a Relay Server

If you only need local development on `localhost`, you can use the built-in self-signed certificate generator:

```bash
cargo run -p wsh-server -- --generate-cert --enable-relay --port 4422
```

Important:

- `--generate-cert` only creates a cert for `localhost`, `127.0.0.1`, and `::1`
- That is fine for local testing
- It is not sufficient for a real remote hostname that a browser tab will connect to

For a real hostname, run `wsh-server` with a certificate that matches the relay hostname:

```bash
cargo run -p wsh-server -- \
  --enable-relay \
  --port 4422 \
  --cert /path/to/fullchain.pem \
  --key /path/to/privkey.pem
```

The default `wsh-server` auth model reads public keys from:

- `~/.wsh/authorized_keys`
- `~/.ssh/authorized_keys`

For this guide, use `~/.wsh/authorized_keys` so the setup is explicit.

When the Rust CLI connects to a relay or host for the first time, it stores that server fingerprint in `~/.wsh/known_hosts` using TOFU (`host:port` pinning). Check that file if you need to inspect or reset a stored fingerprint.

## 3. Generate a Key for the Target Clawser Tab

Open the target Clawser instance, open its terminal, and generate a browser-side key:

```bash
wsh keygen clawser-tab
```

Copy the full `ssh-ed25519 ...` public key printed by that command.

Note:

- The browser `wsh keys` command shows only a shortened public key preview
- If you need the full browser public key later, the simplest path is to generate a fresh named key and copy the printed output immediately

## 4. Generate a Key for the CLI Operator

On the machine where you will run the Rust `wsh` CLI:

```bash
wsh keygen operator
cat ~/.wsh/keys/operator.pub
```

Copy that full public key as well.

## 5. Authorize Both Keys on the Relay

On the machine running `wsh-server`:

```bash
mkdir -p ~/.wsh
chmod 700 ~/.wsh
touch ~/.wsh/authorized_keys
chmod 600 ~/.wsh/authorized_keys
```

Append:

- the browser key from `wsh keygen clawser-tab`
- the CLI key from `~/.wsh/keys/operator.pub`

After this step, both the Clawser tab and the CLI can authenticate to the relay.

## 6. Register the Target Clawser Tab as a Reverse Peer

In the target Clawser tab, keep the terminal open and run:

```bash
wsh -i clawser-tab reverse relay.example.com
```

If you want to expose only specific capabilities instead of the default "all", use:

```bash
wsh -i clawser-tab reverse relay.example.com --expose-shell
```

Or:

```bash
wsh -i clawser-tab reverse relay.example.com --expose-shell --expose-tools --expose-fs
```

What to expect:

- Clawser will connect to the relay over `https://` or `wss://`
- the terminal prints a short peer fingerprint
- the tab must stay open, because the reverse registration is tied to that live browser session

If the relay uses a self-signed cert, this step only works reliably for local `localhost` development. A normal remote browser connection needs a trusted cert for the relay hostname.

## 7. Discover the Clawser Peer from the CLI

On the CLI machine:

```bash
wsh -i operator peers relay.example.com
```

You should see a peer list with:

- a short fingerprint
- a username
- exposed capabilities

Take note of the fingerprint for the target Clawser tab.

## 8. Send the Reverse-Connect Request

From the CLI machine:

```bash
wsh -i operator reverse-connect <fingerprint> relay.example.com
```

At this point the relay forwards a `ReverseConnect` message to the Clawser tab, and the browser-side incoming-session handler creates a session record for that CLI peer.

## 9. Current Limitation

This repo does not yet finish the last mile for "interactive `wsh` into a live Clawser tab" from the Rust CLI.

What is implemented:

- `wsh-server` relay support
- browser reverse-peer registration
- peer discovery
- reverse-connect message forwarding
- browser-side incoming session handling for relay messages

What is not finished end-to-end:

- the Rust `wsh` CLI `reverse-connect` command does not open an interactive PTY into the browser peer after sending `ReverseConnect`

So today, the exact flow above gets the Clawser tab online as a reverse peer and lets the CLI request a connection, but it does not yet drop you into a shell prompt inside that browser instance.

## 10. Fully Working Alternative Today

If you need a real interactive shell now, run `wsh-server` on the target host and connect directly to that host instead of trying to reverse-connect into the browser tab.

### On the target host

1. Add the CLI public key to `~/.wsh/authorized_keys`
2. Start `wsh-server`

Local dev example:

```bash
cargo run -p wsh-server -- --generate-cert --port 4422
```

Real host example:

```bash
cargo run -p wsh-server -- \
  --port 4422 \
  --cert /path/to/fullchain.pem \
  --key /path/to/privkey.pem
```

### From the CLI

```bash
wsh -i operator alice@target.example.com
```

Or run a one-off command:

```bash
wsh -i operator alice@target.example.com uname -a
```

This direct-host path is the one that currently provides a real PTY and command execution end to end.

If the remote host has password auth enabled on `wsh-server`, you can also bootstrap your CLI key with:

```bash
wsh -i operator copy-id alice@target.example.com
```

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

That path is also implemented today, provided the remote host is running `wsh-server` and has authorized the browser key.
