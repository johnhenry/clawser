//! `wsh tools [host]` — discover MCP tools on a remote host.
//!
//! Connects to the specified (or configured default) host, sends an
//! McpDiscover message, and prints the available tools in a table.

use anyhow::{Context, Result};
use tracing::{debug, info};

use crate::config::parse_target;

/// List MCP tools available on a remote host.
pub async fn run(
    host: Option<&str>,
    port: u16,
    identity: &str,
    transport: Option<&str>,
) -> Result<()> {
    let host = host.unwrap_or("localhost");
    info!(host = %host, "discovering MCP tools");

    // Load signing key from keystore.
    let keystore = wsh_client::KeyStore::default_location()
        .map_err(|e| anyhow::anyhow!("{e}"))
        .context("failed to initialize keystore")?;
    let (_signing_key, _verifying_key) = keystore
        .load(identity)
        .map_err(|e| anyhow::anyhow!("{e}"))
        .with_context(|| format!("failed to load key '{identity}'"))?;

    // Parse target (may include user@).
    let (user, resolved_host) = if host.contains('@') {
        parse_target(host)?
    } else {
        let user = std::env::var("USER")
            .or_else(|_| std::env::var("USERNAME"))
            .unwrap_or_else(|_| "root".into());
        (user, host.to_string())
    };

    let scheme = match transport {
        Some("wt") => "https",
        Some("ws") | None => "ws",
        Some(other) => anyhow::bail!("unknown transport: {other}"),
    };
    let url = format!("{scheme}://{resolved_host}:{port}");
    debug!(url = %url, user = %user, "transport URL");

    // TODO: Full implementation.
    //
    //   let client = WshClient::connect(&url, ConnectConfig {
    //       username: user,
    //       key_name: Some(identity.to_string()),
    //       ..Default::default()
    //   }).await?;
    //
    //   let response = client.send_and_wait_public(
    //       Envelope {
    //           msg_type: MsgType::McpDiscover,
    //           payload: Payload::McpDiscover(McpDiscoverPayload {}),
    //       },
    //       MsgType::McpTools,
    //   ).await?;
    //
    //   if let Payload::McpTools(tools_payload) = response.payload {
    //       if tools_payload.tools.is_empty() {
    //           println!("No MCP tools available on {resolved_host}.");
    //           return Ok(());
    //       }
    //       println!("{:<24} {}", "NAME", "DESCRIPTION");
    //       println!("{:<24} {}", "----", "-----------");
    //       for tool in &tools_payload.tools {
    //           println!("{:<24} {}", tool.name, tool.description);
    //       }
    //       println!("\n{} tool(s) available.", tools_payload.tools.len());
    //   }
    //   client.disconnect().await?;

    println!("{:<24} {}", "NAME", "DESCRIPTION");
    println!(
        "{:<24} {}",
        "\u{2500}\u{2500}\u{2500}\u{2500}",
        "\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}"
    );
    println!("(no tools — transport not yet implemented)");

    Ok(())
}
