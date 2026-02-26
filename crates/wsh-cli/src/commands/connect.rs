//! `wsh connect [user@]host` — open an interactive PTY session.
//!
//! Parses the target, loads the identity key from the keystore, connects via
//! WshClient, opens a PTY channel, and enters raw terminal mode to pipe
//! stdin/stdout between the local terminal and the remote PTY. Terminal
//! resize events are forwarded to the server.

use anyhow::{Context, Result};
use crossterm::event::{self, Event, KeyCode, KeyModifiers};
use tokio::sync::mpsc;
use tracing::{debug, info, warn};

use crate::config::parse_target;
use crate::terminal as term;

/// Run an interactive PTY session against `target` ([user@]host).
pub async fn run(
    target: &str,
    port: u16,
    identity: &str,
    transport: Option<&str>,
) -> Result<()> {
    let (user, host) = parse_target(target)?;
    info!(user = %user, host = %host, port, "connecting");

    // Load the signing key from the keystore.
    let keystore = wsh_client::KeyStore::default_location()
        .map_err(|e| anyhow::anyhow!("{e}"))
        .context("failed to initialize keystore")?;
    let (_signing_key, _verifying_key) = keystore
        .load(identity)
        .map_err(|e| anyhow::anyhow!("{e}"))
        .with_context(|| format!("failed to load key '{identity}'"))?;

    // Determine transport URL.
    let scheme = match transport {
        Some("wt") => "https",
        Some("ws") | None => "ws",
        Some(other) => anyhow::bail!("unknown transport: {other}"),
    };
    let url = format!("{scheme}://{host}:{port}");
    debug!(url = %url, "transport URL");

    // TODO: Connect using wsh-client transport layer.
    //
    //   let client = WshClient::connect(&url, ConnectConfig {
    //       username: user.clone(),
    //       key_name: Some(identity.to_string()),
    //       ..Default::default()
    //   }).await?;
    //
    //   let session = client.open_session(SessionOpts {
    //       kind: ChannelKind::Pty,
    //       cols: Some(cols),
    //       rows: Some(rows),
    //       ..Default::default()
    //   }).await?;

    // Get initial terminal size.
    let (cols, rows) = term::get_terminal_size();
    info!(cols, rows, "terminal size");

    // Enter raw mode.
    let _guard = term::RawModeGuard::enter()
        .context("failed to enter raw terminal mode")?;

    // Create channels for coordinating the I/O loop.
    let (tx_input, mut rx_input) = mpsc::channel::<Vec<u8>>(64);
    let (tx_resize, mut rx_resize) = mpsc::channel::<(u16, u16)>(8);
    let (tx_quit, mut rx_quit) = mpsc::channel::<()>(1);

    // Spawn a blocking thread to read crossterm events (stdin + resize).
    let input_handle = tokio::task::spawn_blocking(move || {
        loop {
            match event::read() {
                Ok(Event::Key(key_event)) => {
                    // Ctrl+] is the escape sequence to disconnect (like ssh ~.).
                    if key_event.modifiers.contains(KeyModifiers::CONTROL)
                        && key_event.code == KeyCode::Char(']')
                    {
                        let _ = tx_quit.blocking_send(());
                        break;
                    }

                    // Convert key event to bytes.
                    if let Some(bytes) = key_event_to_bytes(&key_event) {
                        if tx_input.blocking_send(bytes).is_err() {
                            break;
                        }
                    }
                }
                Ok(Event::Resize(new_cols, new_rows)) => {
                    let _ = tx_resize.blocking_send((new_cols, new_rows));
                }
                Ok(_) => {}
                Err(e) => {
                    warn!("crossterm event error: {e}");
                    break;
                }
            }
        }
    });

    // Main async I/O loop.
    // In the full implementation this shuttles bytes between the PTY session
    // and the terminal. For now we provide the loop skeleton.
    //
    //   let mut stdout = std::io::stdout();
    //   let mut buf = vec![0u8; 8192];
    //   loop {
    //       tokio::select! {
    //           result = session.read(&mut buf) => {
    //               let n = result?;
    //               if n == 0 { break; }
    //               stdout.write_all(&buf[..n])?;
    //               stdout.flush()?;
    //           }
    //           Some(bytes) = rx_input.recv() => {
    //               session.write(&bytes).await?;
    //           }
    //           Some((c, r)) = rx_resize.recv() => {
    //               session.resize(c, r).await?;
    //           }
    //           _ = rx_quit.recv() => { break; }
    //       }
    //   }

    // Placeholder: wait for the input thread to finish (it will on Ctrl+]).
    eprintln!("\r\nwsh: transport layer not yet implemented — connect skeleton ready");
    eprintln!("wsh: press Ctrl+] to exit\r");

    loop {
        tokio::select! {
            Some(_bytes) = rx_input.recv() => {
                // Would forward to remote PTY session.
            }
            Some((c, r)) = rx_resize.recv() => {
                debug!(cols = c, rows = r, "terminal resized");
            }
            _ = rx_quit.recv() => {
                info!("disconnect requested");
                break;
            }
        }
    }

    // Cleanup: the RawModeGuard drop will restore terminal mode.
    input_handle.abort();
    info!("disconnected from {host}");
    eprintln!("\r\nConnection to {host} closed.");

    Ok(())
}

/// Convert a crossterm key event to raw bytes suitable for a PTY.
fn key_event_to_bytes(event: &crossterm::event::KeyEvent) -> Option<Vec<u8>> {
    match event.code {
        KeyCode::Char(c) => {
            if event.modifiers.contains(KeyModifiers::CONTROL) {
                // Ctrl+A = 0x01, Ctrl+B = 0x02, etc.
                let byte = (c as u8).wrapping_sub(b'a').wrapping_add(1);
                if byte <= 26 {
                    return Some(vec![byte]);
                }
            }
            let mut buf = [0u8; 4];
            let s = c.encode_utf8(&mut buf);
            Some(s.as_bytes().to_vec())
        }
        KeyCode::Enter => Some(vec![b'\r']),
        KeyCode::Backspace => Some(vec![0x7f]),
        KeyCode::Tab => Some(vec![b'\t']),
        KeyCode::Esc => Some(vec![0x1b]),
        KeyCode::Up => Some(b"\x1b[A".to_vec()),
        KeyCode::Down => Some(b"\x1b[B".to_vec()),
        KeyCode::Right => Some(b"\x1b[C".to_vec()),
        KeyCode::Left => Some(b"\x1b[D".to_vec()),
        KeyCode::Home => Some(b"\x1b[H".to_vec()),
        KeyCode::End => Some(b"\x1b[F".to_vec()),
        KeyCode::PageUp => Some(b"\x1b[5~".to_vec()),
        KeyCode::PageDown => Some(b"\x1b[6~".to_vec()),
        KeyCode::Insert => Some(b"\x1b[2~".to_vec()),
        KeyCode::Delete => Some(b"\x1b[3~".to_vec()),
        KeyCode::F(n) => {
            let seq = match n {
                1 => "\x1bOP",
                2 => "\x1bOQ",
                3 => "\x1bOR",
                4 => "\x1bOS",
                5 => "\x1b[15~",
                6 => "\x1b[17~",
                7 => "\x1b[18~",
                8 => "\x1b[19~",
                9 => "\x1b[20~",
                10 => "\x1b[21~",
                11 => "\x1b[23~",
                12 => "\x1b[24~",
                _ => return None,
            };
            Some(seq.as_bytes().to_vec())
        }
        _ => None,
    }
}
