//! `wsh reverse <relay>` / `wsh peers <relay>` — relay and peer discovery.
//!
//! - `reverse`: connect to a relay host and register as a reverse-connectable peer
//! - `peers`: connect to a relay and list available reverse peers

use anyhow::{Context, Result};
use tracing::{debug, info};
use wsh_client::{ConnectConfig, WshClient};
use wsh_core::messages::*;

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

    // Connect and authenticate
    let username = std::env::var("USER").unwrap_or_else(|_| "unknown".to_string());
    let client = WshClient::connect(
        &url,
        ConnectConfig {
            username: username.clone(),
            key_name: Some(identity.to_string()),
            ..Default::default()
        },
    )
    .await
    .map_err(|e| anyhow::anyhow!("{e}"))
    .context("failed to connect to relay")?;

    // Send ReverseRegister message
    let register = Envelope {
        msg_type: MsgType::ReverseRegister,
        payload: Payload::ReverseRegister(ReverseRegisterPayload {
            username,
            capabilities: vec!["pty".into(), "exec".into()],
            public_key: public_bytes,
        }),
    };
    client
        .send_and_wait_public(register, MsgType::Pong) // fire-and-forget, use pong as dummy
        .await
        .ok(); // Ignore timeout — ReverseRegister has no reply

    println!("Registered as peer {short_fp} on {relay_host}:{port}");
    println!("Waiting for connections... (Ctrl+C to stop)");

    // Hold connection open, handle incoming reverse connections
    tokio::signal::ctrl_c()
        .await
        .map_err(|e| anyhow::anyhow!("ctrl_c signal error: {e}"))?;

    println!("\nDisconnecting...");
    client
        .disconnect()
        .await
        .map_err(|e| anyhow::anyhow!("{e}"))?;

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

    let scheme = match transport {
        Some("wt") => "https",
        Some("ws") | None => "ws",
        Some(other) => anyhow::bail!("unknown transport: {other}"),
    };
    let url = format!("{scheme}://{relay_host}:{port}");
    debug!(url = %url, "relay URL");

    // Connect and authenticate
    let username = std::env::var("USER").unwrap_or_else(|_| "unknown".to_string());
    let client = WshClient::connect(
        &url,
        ConnectConfig {
            username,
            key_name: Some(identity.to_string()),
            ..Default::default()
        },
    )
    .await
    .map_err(|e| anyhow::anyhow!("{e}"))
    .context("failed to connect to relay")?;

    // Send ReverseList and wait for ReversePeers
    let list_msg = Envelope {
        msg_type: MsgType::ReverseList,
        payload: Payload::ReverseList(ReverseListPayload {}),
    };

    let response = client
        .send_and_wait_public(list_msg, MsgType::ReversePeers)
        .await
        .map_err(|e| anyhow::anyhow!("{e}"))
        .context("failed to list peers")?;

    // Display peers table
    println!(
        "{:<14} {:<16} {:<20} {}",
        "FINGERPRINT", "USERNAME", "CAPABILITIES", "LAST SEEN"
    );
    println!(
        "{:<14} {:<16} {:<20} {}",
        "───────────", "────────", "────────────", "─────────"
    );

    if let Payload::ReversePeers(peers) = response.payload {
        if peers.peers.is_empty() {
            println!("(no peers online)");
        } else {
            for peer in &peers.peers {
                println!(
                    "{:<14} {:<16} {:<20} {}",
                    peer.fingerprint_short,
                    peer.username,
                    peer.capabilities.join(", "),
                    peer.last_seen
                        .map(|t| format!("{t}s ago"))
                        .unwrap_or_else(|| "—".to_string()),
                );
            }
        }
        println!("\n{} peer(s).", peers.peers.len());
    } else {
        println!("(unexpected response)");
    }

    client
        .disconnect()
        .await
        .map_err(|e| anyhow::anyhow!("{e}"))?;

    Ok(())
}

/// Reverse connect to a browser peer through a relay.
///
/// Sends `ReverseConnect` to the relay server targeting the given peer
/// fingerprint. The relay forwards this to the target browser, which
/// can then accept and bridge the connection.
pub async fn run_connect(
    target_fingerprint: &str,
    relay_host: &str,
    port: u16,
    identity: &str,
    transport: Option<&str>,
) -> Result<()> {
    info!(relay = %relay_host, target = %target_fingerprint, "reverse connecting to peer");

    let scheme = match transport {
        Some("wt") => "https",
        Some("ws") | None => "ws",
        Some(other) => anyhow::bail!("unknown transport: {other}"),
    };
    let url = format!("{scheme}://{relay_host}:{port}");
    debug!(url = %url, "relay URL");

    // Connect and authenticate
    let username = std::env::var("USER").unwrap_or_else(|_| "unknown".to_string());
    let client = WshClient::connect(
        &url,
        ConnectConfig {
            username: username.clone(),
            key_name: Some(identity.to_string()),
            ..Default::default()
        },
    )
    .await
    .map_err(|e| anyhow::anyhow!("{e}"))
    .context("failed to connect to relay")?;

    // Send ReverseConnect targeting the peer
    let connect_msg = Envelope {
        msg_type: MsgType::ReverseConnect,
        payload: Payload::ReverseConnect(ReverseConnectPayload {
            target_fingerprint: target_fingerprint.to_string(),
            username,
        }),
    };

    println!("Connecting to peer {target_fingerprint} via {relay_host}:{port}...");

    // Fire-and-forget — the relay will forward to the target
    client
        .send_and_wait_public(connect_msg, MsgType::Pong)
        .await
        .ok(); // No direct reply expected

    println!("Reverse connect sent. Waiting for peer response...");
    println!("(Press Ctrl+C to disconnect)");

    // Hold connection open for the session
    tokio::signal::ctrl_c()
        .await
        .map_err(|e| anyhow::anyhow!("ctrl_c signal error: {e}"))?;

    println!("\nDisconnecting...");
    client
        .disconnect()
        .await
        .map_err(|e| anyhow::anyhow!("{e}"))?;

    Ok(())
}
