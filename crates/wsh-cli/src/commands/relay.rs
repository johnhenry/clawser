//! `wsh reverse <relay>` / `wsh peers <relay>` — relay and peer discovery.
//!
//! - `reverse`: connect to a relay host and register as a reverse-connectable peer
//! - `peers`: connect to a relay and list available reverse peers

use anyhow::{Context, Result};
use std::sync::Arc;
use tracing::{debug, info};
use wsh_client::SessionOpts;
use wsh_core::messages::*;
use wsh_core::RemotePeerDescriptor;

use crate::commands::common::{connect_client, resolve_target};
use crate::commands::interactive;
use crate::commands::reverse_host::{self, ReverseHostOptions};
use crate::terminal as term;

#[derive(Debug, Clone, Default)]
pub struct PeerQueryOptions {
    pub json: bool,
    pub peer_type: Option<String>,
    pub shell_backend: Option<String>,
    pub capability: Option<String>,
}

fn reverse_accept_summary(accept: &ReverseAcceptPayload) -> String {
    let caps = if accept.capabilities.is_empty() {
        "no capabilities".to_string()
    } else {
        accept.capabilities.join(", ")
    };
    let session_features = peer_session_features(
        accept.supports_attach,
        accept.supports_replay,
        accept.supports_echo,
        accept.supports_term_sync,
    );

    format!(
        "{} / {} [{}] {{{}}}",
        accept.peer_type, accept.shell_backend, caps, session_features
    )
}

fn peer_session_features(
    supports_attach: bool,
    supports_replay: bool,
    supports_echo: bool,
    supports_term_sync: bool,
) -> String {
    let mut features = Vec::new();
    if supports_attach {
        features.push("attach");
    }
    if supports_replay {
        features.push("replay");
    }
    if supports_echo {
        features.push("echo");
    }
    if supports_term_sync {
        features.push("sync");
    }
    if features.is_empty() {
        "none".to_string()
    } else {
        features.join(",")
    }
}

fn filter_peers(peers: Vec<PeerInfo>, options: &PeerQueryOptions) -> Vec<PeerInfo> {
    peers.into_iter()
        .filter(|peer| {
            options
                .peer_type
                .as_ref()
                .map_or(true, |peer_type| &peer.peer_type == peer_type)
        })
        .filter(|peer| {
            options
                .shell_backend
                .as_ref()
                .map_or(true, |backend| &peer.shell_backend == backend)
        })
        .filter(|peer| {
            options
                .capability
                .as_ref()
                .map_or(true, |capability| {
                    peer.capabilities.iter().any(|cap| cap == capability)
                })
        })
        .collect()
}

fn reverse_connect_label(accept: &ReverseAcceptPayload) -> String {
    if accept.capabilities.is_empty() {
        format!("{} {}", accept.peer_type, accept.shell_backend)
    } else {
        format!(
            "{} {} [{}]",
            accept.peer_type,
            accept.shell_backend,
            accept.capabilities.join(", ")
        )
    }
}

fn parse_reverse_connect_response(payload: Payload) -> Result<ReverseAcceptPayload> {
    match payload {
        Payload::ReverseAccept(accept) => Ok(accept),
        Payload::ReverseReject(reject) => {
            anyhow::bail!("peer rejected reverse connection: {}", reject.reason)
        }
        other => anyhow::bail!("unexpected reverse-connect response: {:?}", other),
    }
}

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
    capabilities: &[String],
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
    let reverse_options = reverse_options(capabilities)?;

    let resolved = resolve_target(relay_host, port, transport)?;
    debug!(url = %resolved.url, fallback_urls = ?resolved.fallback_urls, "relay URL");

    // Connect and authenticate
    let username = resolved.user.clone();
    let client = Arc::new(
        connect_client(&resolved, identity)
        .await
        .context("failed to connect to relay")?,
    );

    // Take the reverse-connect receiver before sending registration
    let rc_rx = client
        .take_reverse_connect_rx()
        .await
        .expect("reverse connect receiver already taken");
    let relay_rx = client
        .take_relay_message_rx()
        .await
        .expect("relay message receiver already taken");

    // Send ReverseRegister message (fire-and-forget, no reply expected)
    let register = Envelope {
        msg_type: MsgType::ReverseRegister,
        payload: Payload::ReverseRegister(
            reverse_options.reverse_register_payload(username, public_bytes),
        ),
    };
    client
        .send_fire_and_forget(register)
        .await
        .map_err(|e| anyhow::anyhow!("{e}"))
        .context("failed to send ReverseRegister")?;

    println!("Registered as peer {short_fp} on {relay_host}:{port}");
    println!("Waiting for connections... (Ctrl+C to stop)");
    reverse_host::run_with_options(client.clone(), rc_rx, relay_rx, reverse_options, None)
        .await?;

    client
        .disconnect()
        .await
        .map_err(|e| anyhow::anyhow!("{e}"))?;

    Ok(())
}

fn reverse_options(capabilities: &[String]) -> Result<ReverseHostOptions> {
    let capabilities = if capabilities.is_empty() {
        vec!["shell".to_string(), "exec".to_string()]
    } else {
        capabilities
            .iter()
            .map(|value| value.trim().to_ascii_lowercase())
            .filter(|value| !value.is_empty())
            .collect::<Vec<_>>()
    };

    for capability in &capabilities {
        if capability != "shell"
            && capability != "exec"
            && capability != "fs"
            && capability != "tools"
            && capability != "gateway"
        {
            anyhow::bail!(
                "unsupported reverse-host capability `{capability}`; supported capabilities are shell, exec, fs, tools, and gateway"
            );
        }
    }

    Ok(ReverseHostOptions {
        capabilities,
        ..ReverseHostOptions::default()
    })
}

/// List peers available on a relay host.
pub async fn run_peers(
    relay_host: &str,
    port: u16,
    identity: &str,
    transport: Option<&str>,
    options: &PeerQueryOptions,
) -> Result<()> {
    info!(relay = %relay_host, "listing peers");

    let resolved = resolve_target(relay_host, port, transport)?;
    debug!(url = %resolved.url, fallback_urls = ?resolved.fallback_urls, "relay URL");

    // Connect and authenticate
    let client = connect_client(&resolved, identity)
        .await
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

    if let Payload::ReversePeers(peers) = response.payload {
        let peers = filter_peers(peers.peers, options);

        if options.json {
            let descriptors: Vec<RemotePeerDescriptor> = peers
                .iter()
                .map(|peer| RemotePeerDescriptor::from_wsh_peer_info(peer, relay_host, port))
                .collect();
            println!(
                "{}",
                serde_json::to_string_pretty(&descriptors).context("failed to serialize peers")?
            );
        } else {
            println!(
                "{:<14} {:<16} {:<14} {:<16} {:<18} {:<20} {}",
                "FINGERPRINT",
                "USERNAME",
                "TYPE",
                "BACKEND",
                "SESSION",
                "CAPABILITIES",
                "LAST SEEN"
            );
            println!(
                "{:<14} {:<16} {:<14} {:<16} {:<18} {:<20} {}",
                "───────────",
                "────────",
                "────",
                "───────",
                "───────",
                "────────────",
                "─────────"
            );

            if peers.is_empty() {
                println!("(no peers online)");
            } else {
                for peer in &peers {
                    println!(
                        "{:<14} {:<16} {:<14} {:<16} {:<18} {:<20} {}",
                        peer.fingerprint_short,
                        peer.username,
                        peer.peer_type,
                        peer.shell_backend,
                        peer_session_features(
                            peer.supports_attach,
                            peer.supports_replay,
                            peer.supports_echo,
                            peer.supports_term_sync,
                        ),
                        peer.capabilities.join(", "),
                        peer.last_seen
                            .map(|t| format!("{t}s ago"))
                            .unwrap_or_else(|| "—".to_string()),
                    );
                }
            }

            println!("\n{} peer(s).", peers.len());
        }
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

    let resolved = resolve_target(relay_host, port, transport)?;
    debug!(url = %resolved.url, fallback_urls = ?resolved.fallback_urls, "relay URL");

    // Connect and authenticate
    let username = resolved.user.clone();
    let client = connect_client(&resolved, identity)
        .await
        .context("failed to connect to relay")?;

    let connect_msg = Envelope {
        msg_type: MsgType::ReverseConnect,
        payload: Payload::ReverseConnect(ReverseConnectPayload {
            target_fingerprint: target_fingerprint.to_string(),
            username: username.clone(),
        }),
    };

    println!("Connecting to peer {target_fingerprint} via {relay_host}:{port}...");

    let response = client
        .send_and_wait_public(connect_msg, MsgType::ReverseAccept)
        .await
        .map_err(|e| anyhow::anyhow!("{e}"))
        .context("failed to reverse-connect to peer")?;

    let accept = parse_reverse_connect_response(response.payload)?;
    println!(
        "Peer accepted reverse connection. Backend: {}",
        reverse_accept_summary(&accept)
    );

    let (cols, rows) = term::get_terminal_size();
    let session = client
        .open_session(SessionOpts {
            kind: ChannelKind::Pty,
            command: None,
            cols: Some(cols),
            rows: Some(rows),
            env: None,
        })
        .await
        .map_err(|e| anyhow::anyhow!("{e}"))
        .context("failed to open reverse PTY session")?;

    interactive::run_session(
        session,
        &format!(
            "peer {target_fingerprint} ({})",
            reverse_connect_label(&accept)
        ),
    )
    .await?;
    client
        .disconnect()
        .await
        .map_err(|e| anyhow::anyhow!("{e}"))?;

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::{
        filter_peers, parse_reverse_connect_response, peer_session_features,
        reverse_accept_summary, PeerQueryOptions,
    };
    use wsh_core::messages::{Payload, PeerInfo, ReverseAcceptPayload, ReverseRejectPayload};

    #[test]
    fn reverse_accept_summary_includes_backend_and_capabilities() {
        assert_eq!(
            reverse_accept_summary(&ReverseAcceptPayload {
                target_fingerprint: "fp".into(),
                username: "user".into(),
                capabilities: vec!["shell".into()],
                peer_type: "browser-shell".into(),
                shell_backend: "virtual-shell".into(),
                supports_attach: true,
                supports_replay: true,
                supports_echo: true,
                supports_term_sync: true,
            }),
            "browser-shell / virtual-shell [shell] {attach,replay,echo,sync}"
        );
    }

    #[test]
    fn peer_session_features_reports_none_when_no_session_features_are_advertised() {
        assert_eq!(peer_session_features(false, false, false, false), "none");
    }

    #[test]
    fn filter_peers_applies_type_backend_and_capability_filters() {
        let peers = vec![
            PeerInfo {
                fingerprint: "host".into(),
                fingerprint_short: "host".into(),
                username: "host".into(),
                capabilities: vec!["shell".into(), "fs".into()],
                peer_type: "host".into(),
                shell_backend: "pty".into(),
                source: "wsh-relay".into(),
                supports_attach: true,
                supports_replay: true,
                supports_echo: false,
                supports_term_sync: false,
                last_seen: Some(1),
            },
            PeerInfo {
                fingerprint: "browser".into(),
                fingerprint_short: "browser".into(),
                username: "browser".into(),
                capabilities: vec!["shell".into()],
                peer_type: "browser-shell".into(),
                shell_backend: "virtual-shell".into(),
                source: "wsh-relay".into(),
                supports_attach: true,
                supports_replay: true,
                supports_echo: true,
                supports_term_sync: true,
                last_seen: Some(2),
            },
        ];

        let filtered = filter_peers(
            peers,
            &PeerQueryOptions {
                json: false,
                peer_type: Some("browser-shell".into()),
                shell_backend: Some("virtual-shell".into()),
                capability: Some("shell".into()),
            },
        );

        assert_eq!(filtered.len(), 1);
        assert_eq!(filtered[0].username, "browser");
    }

    #[test]
    fn parse_reverse_connect_response_accepts_reverse_accept() {
        let accept = parse_reverse_connect_response(Payload::ReverseAccept(ReverseAcceptPayload {
            target_fingerprint: "fp".into(),
            username: "user".into(),
            capabilities: vec!["shell".into()],
            peer_type: "browser-shell".into(),
            shell_backend: "virtual-shell".into(),
            supports_attach: true,
            supports_replay: true,
            supports_echo: true,
            supports_term_sync: true,
        }))
        .unwrap();
        assert_eq!(accept.peer_type, "browser-shell");
        assert_eq!(accept.shell_backend, "virtual-shell");
    }

    #[test]
    fn parse_reverse_connect_response_rejects_reverse_reject() {
        let err = parse_reverse_connect_response(Payload::ReverseReject(ReverseRejectPayload {
            target_fingerprint: "fp".into(),
            username: "user".into(),
            reason: "busy".into(),
        }))
        .unwrap_err();

        assert!(err.to_string().contains("busy"));
    }
}
