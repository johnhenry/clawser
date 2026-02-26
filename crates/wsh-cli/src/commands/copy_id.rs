//! `wsh copy-id [user@]host` — copy local public key to a remote host.
//!
//! Reads the local public key from the keystore, connects to the remote host,
//! and appends the key to `~/.wsh/authorized_keys` on the remote machine using
//! an exec channel that runs `mkdir -p ~/.wsh && cat >> ~/.wsh/authorized_keys`.

use anyhow::{Context, Result};
use tracing::{debug, info};

use crate::config::parse_target;

/// Copy the local public key to the remote host's authorized_keys.
pub async fn run(
    target: &str,
    port: u16,
    identity: &str,
    transport: Option<&str>,
) -> Result<()> {
    let (user, host) = parse_target(target)?;
    info!(user = %user, host = %host, "copy-id");

    // Load the key pair from the keystore.
    let keystore = wsh_client::KeyStore::default_location()
        .map_err(|e| anyhow::anyhow!("{e}"))
        .context("failed to initialize keystore")?;

    let pub_key_ssh = keystore
        .export_public(identity)
        .map_err(|e| anyhow::anyhow!("{e}"))
        .with_context(|| format!("failed to export public key '{identity}'"))?;

    if pub_key_ssh.is_empty() {
        anyhow::bail!("public key for '{identity}' is empty");
    }

    // Determine transport URL.
    let scheme = match transport {
        Some("wt") => "https",
        Some("ws") | None => "ws",
        Some(other) => anyhow::bail!("unknown transport: {other}"),
    };
    let url = format!("{scheme}://{host}:{port}");
    debug!(url = %url, "transport URL");

    // TODO: Full implementation once wsh-client transport is available.
    //
    //   let client = WshClient::connect(&url, ConnectConfig {
    //       username: user.clone(),
    //       key_name: Some(identity.to_string()),
    //       ..Default::default()
    //   }).await?;
    //
    //   let session = client.open_session(SessionOpts {
    //       kind: ChannelKind::Exec,
    //       command: Some("mkdir -p ~/.wsh && cat >> ~/.wsh/authorized_keys".to_string()),
    //       ..Default::default()
    //   }).await?;
    //
    //   // Send the public key as stdin, then close the write side.
    //   let payload = format!("{pub_key_ssh}\n");
    //   session.write(payload.as_bytes()).await?;
    //   session.close().await?;
    //
    //   let exit_code = session.exit_code().await.unwrap_or(1);
    //   if exit_code != 0 {
    //       anyhow::bail!("remote command failed with exit code {exit_code}");
    //   }
    //   client.disconnect().await?;

    eprintln!("wsh: copy-id to {user}@{host}:{port} — transport layer not yet implemented");
    println!("Would copy key to {user}@{host}:");
    println!("  {pub_key_ssh}");

    Ok(())
}
