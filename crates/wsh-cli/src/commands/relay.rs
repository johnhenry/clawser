//! `wsh reverse <relay>` / `wsh peers <relay>` — relay and peer discovery.
//!
//! - `reverse`: connect to a relay host and register as a reverse-connectable peer
//! - `peers`: connect to a relay and list available reverse peers

use anyhow::{Context, Result};
use tracing::{debug, info};

/// Register as a reverse-connectable peer on a relay host.
///
/// The client connects to the relay, sends a `ReverseRegister` message with
/// its public key and capabilities, and then holds the connection open so
/// other clients can initiate reverse connections through the relay.
pub async fn run_reverse(
    relay_host: &str,
    port: u16,
    identity: &str,
    transport: Option<&str>,
) -> Result<()> {
    info!(relay = %relay_host, "registering as reverse peer");

    // Load signing key and derive public key / fingerprint.
    let keystore = wsh_client::KeyStore::default_location()
        .map_err(|e| anyhow::anyhow!("{e}"))
        .context("failed to initialize keystore")?;
    let (_signing_key, verifying_key) = keystore
        .load(identity)
        .map_err(|e| anyhow::anyhow!("{e}"))
        .with_context(|| format!("failed to load key '{identity}'"))?;

    let public_bytes = wsh_client::auth::public_key_bytes(&verifying_key);
    let fingerprint = wsh_core::fingerprint(&public_bytes);
    let short_fp = &fingerprint[..fingerprint.len().min(12)];

    let scheme = match transport {
        Some("wt") => "https",
        Some("ws") | None => "ws",
        Some(other) => anyhow::bail!("unknown transport: {other}"),
    };
    let url = format!("{scheme}://{relay_host}:{port}");
    debug!(url = %url, "relay URL");

    // TODO: Full implementation.
    //
    //   let client = WshClient::connect(&url, ConnectConfig {
    //       username: whoami(),
    //       key_name: Some(identity.to_string()),
    //       ..Default::default()
    //   }).await?;
    //
    //   // Send ReverseRegister message.
    //   client.send_and_wait_public(
    //       Envelope {
    //           msg_type: MsgType::ReverseRegister,
    //           payload: Payload::ReverseRegister(ReverseRegisterPayload {
    //               username: whoami(),
    //               capabilities: vec!["pty".into(), "exec".into()],
    //               public_key: public_bytes,
    //           }),
    //       },
    //       MsgType::AuthOk,
    //   ).await?;
    //
    //   println!("Registered as peer {short_fp} on {relay_host}");
    //   println!("Waiting for connections... (Ctrl+C to stop)");
    //
    //   // Hold connection open, handle incoming reverse connections.
    //   loop {
    //       tokio::select! {
    //           _ = tokio::signal::ctrl_c() => { break; }
    //       }
    //   }
    //   client.disconnect().await?;

    println!("Registered as peer {short_fp} on {relay_host}:{port}");
    eprintln!("wsh: reverse registration — transport not yet implemented");

    Ok(())
}

/// List peers available on a relay host.
pub async fn run_peers(
    relay_host: &str,
    port: u16,
    identity: &str,
    transport: Option<&str>,
) -> Result<()> {
    info!(relay = %relay_host, "listing peers");

    // Load signing key for authentication.
    let keystore = wsh_client::KeyStore::default_location()
        .map_err(|e| anyhow::anyhow!("{e}"))
        .context("failed to initialize keystore")?;
    let (_signing_key, _verifying_key) = keystore
        .load(identity)
        .map_err(|e| anyhow::anyhow!("{e}"))
        .with_context(|| format!("failed to load key '{identity}'"))?;

    let scheme = match transport {
        Some("wt") => "https",
        Some("ws") | None => "ws",
        Some(other) => anyhow::bail!("unknown transport: {other}"),
    };
    let url = format!("{scheme}://{relay_host}:{port}");
    debug!(url = %url, "relay URL");

    // TODO: Full implementation.
    //
    //   let client = WshClient::connect(&url, ConnectConfig { ... }).await?;
    //   let response = client.send_and_wait_public(
    //       Envelope {
    //           msg_type: MsgType::ReverseList,
    //           payload: Payload::ReverseList(ReverseListPayload {}),
    //       },
    //       MsgType::ReversePeers,
    //   ).await?;
    //
    //   if let Payload::ReversePeers(peers) = response.payload {
    //       println!("{:<14} {:<16} {:<20} {}", "FINGERPRINT", "USERNAME", "CAPABILITIES", "LAST SEEN");
    //       for peer in &peers.peers {
    //           println!("{:<14} {:<16} {:<20} {}",
    //               peer.fingerprint_short, peer.username,
    //               peer.capabilities.join(", "),
    //               peer.last_seen.map(|t| format!("{t}s ago")).unwrap_or_default(),
    //           );
    //       }
    //       println!("\n{} peer(s).", peers.peers.len());
    //   }
    //   client.disconnect().await?;

    println!(
        "{:<14} {:<16} {:<20} {}",
        "FINGERPRINT", "USERNAME", "CAPABILITIES", "LAST SEEN"
    );
    println!(
        "{:<14} {:<16} {:<20} {}",
        "\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}",
        "\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}",
        "\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}",
        "\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}"
    );
    println!("(no peers — transport not yet implemented)");

    Ok(())
}
