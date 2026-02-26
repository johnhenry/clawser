//! `wsh sessions` / `wsh attach` / `wsh detach` — session management.
//!
//! - `sessions`: list active sessions on the connected host
//! - `attach <session>`: reattach to a named/ID'd session
//! - `detach`: detach from the current session (typically Ctrl+\ in interactive mode)

use anyhow::{Context, Result};
use tracing::info;

/// List active sessions on the most recently connected host.
///
/// Reads the last-connected host from `~/.wsh/last_session` and queries
/// the server for active sessions.
pub async fn run_list() -> Result<()> {
    let wsh_dir = dirs::home_dir()
        .context("cannot determine home directory")?
        .join(".wsh");
    let _last_session_path = wsh_dir.join("last_session");

    // TODO: Full implementation once transport is available.
    //
    //   let session_info = std::fs::read_to_string(&last_session_path)?;
    //   let (host, port, identity) = parse_last_session(&session_info)?;
    //   let mut client = WshClient::connect_meta(&host, port, &identity).await?;
    //   let sessions = client.list_sessions().await?;
    //
    //   println!("{:<24} {:<12} {:<10} {}", "SESSION", "ID", "STATE", "CREATED");
    //   println!("{:<24} {:<12} {:<10} {}", "───────", "──", "─────", "───────");
    //   for s in &sessions {
    //       println!("{:<24} {:<12} {:<10} {}", s.name, s.id, s.state, s.created);
    //   }

    println!("{:<24} {:<12} {:<10} {}", "SESSION", "ID", "STATE", "CREATED");
    println!("{:<24} {:<12} {:<10} {}", "───────", "──", "─────", "───────");
    println!("(no sessions — transport not yet implemented)");

    Ok(())
}

/// Reattach to a session by name or ID.
pub async fn run_attach(
    session: &str,
    _port: u16,
    _identity: &str,
    _transport: Option<&str>,
) -> Result<()> {
    info!(session = %session, "attaching");

    // TODO: Full implementation.
    //
    //   let wsh_dir = dirs::home_dir()?.join(".wsh");
    //   let last_session = std::fs::read_to_string(wsh_dir.join("last_session"))?;
    //   let (host, port, identity) = parse_last_session(&last_session)?;
    //
    //   let mut client = WshClient::connect(&url, &signing_key, &user).await?;
    //   let channel = client.attach_session(session).await?;
    //
    //   // Enter interactive mode (same loop as connect.rs).
    //   crate::commands::connect::interactive_loop(channel).await?;

    eprintln!("wsh: attach to session '{session}' — transport not yet implemented");
    Ok(())
}

/// Detach from the current session.
///
/// In interactive mode, this is typically invoked via the escape sequence
/// (Ctrl+\). As a standalone command, it sends a detach message to the
/// currently attached session.
pub async fn run_detach() -> Result<()> {
    info!("detach requested");

    // TODO: Full implementation.
    //
    //   let wsh_dir = dirs::home_dir()?.join(".wsh");
    //   let active_path = wsh_dir.join("active_session");
    //   if !active_path.exists() {
    //       anyhow::bail!("no active session to detach from");
    //   }
    //   let session_info = std::fs::read_to_string(&active_path)?;
    //   // Send detach message and clean up active_session file.

    eprintln!("wsh: detach — no active session (transport not yet implemented)");
    Ok(())
}
