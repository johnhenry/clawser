//! `wsh user@host command` — one-off remote command execution.
//!
//! Connects to the remote host, opens an exec channel with the given command,
//! pipes stdout to the local terminal, and exits with the remote exit code.

use anyhow::{Context, Result};
use tracing::{debug, info};

use crate::config::parse_target;

/// Execute a remote command and print its output.
pub async fn run(
    target: &str,
    command: &str,
    port: u16,
    identity: &str,
    transport: Option<&str>,
) -> Result<()> {
    let (user, host) = parse_target(target)?;
    info!(user = %user, host = %host, command = %command, "exec");

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

    // TODO: Full implementation once wsh-client transport is complete.
    //
    //   let client = WshClient::connect(&url, ConnectConfig {
    //       username: user.clone(),
    //       key_name: Some(identity.to_string()),
    //       ..Default::default()
    //   }).await?;
    //
    //   let session = client.open_session(SessionOpts {
    //       kind: ChannelKind::Exec,
    //       command: Some(command.to_string()),
    //       ..Default::default()
    //   }).await?;
    //
    //   let mut stdout = std::io::stdout().lock();
    //   let mut buf = vec![0u8; 8192];
    //   loop {
    //       let n = session.read(&mut buf).await?;
    //       if n == 0 { break; }
    //       stdout.write_all(&buf[..n])?;
    //       stdout.flush()?;
    //   }
    //
    //   let exit_code = session.exit_code().await.unwrap_or(1);
    //   if exit_code != 0 {
    //       eprintln!("wsh: remote command exited with code {exit_code}");
    //   }
    //   client.disconnect().await?;
    //   std::process::exit(exit_code);

    eprintln!(
        "wsh: exec '{command}' on {user}@{host}:{port} — transport layer not yet implemented"
    );

    Ok(())
}
