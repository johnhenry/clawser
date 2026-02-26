//! `wsh scp <src> <dst>` — file transfer using [user@]host:path syntax.
//!
//! Supports both upload (local -> remote) and download (remote -> local)
//! based on which argument contains the host:path syntax. Shows a terminal
//! progress bar during transfer.

use anyhow::{Context, Result};
use std::fs;
use std::io::{self, Write as _};
use std::path::{Path, PathBuf};
use tracing::{debug, info};

use crate::config::parse_target;

/// A parsed SCP endpoint — either local or remote.
#[derive(Debug)]
enum Endpoint {
    Local(PathBuf),
    Remote {
        user: String,
        host: String,
        path: String,
    },
}

/// Run a file transfer between src and dst.
pub async fn run(
    src: &str,
    dst: &str,
    port: u16,
    identity: &str,
    transport: Option<&str>,
) -> Result<()> {
    let src_ep = parse_endpoint(src)?;
    let dst_ep = parse_endpoint(dst)?;

    match (&src_ep, &dst_ep) {
        (Endpoint::Local(local_path), Endpoint::Remote { user, host, path }) => {
            info!(local = %local_path.display(), remote = %format!("{user}@{host}:{path}"), "upload");
            upload(local_path, user, host, path, port, identity, transport).await
        }
        (Endpoint::Remote { user, host, path }, Endpoint::Local(local_path)) => {
            info!(remote = %format!("{user}@{host}:{path}"), local = %local_path.display(), "download");
            download(user, host, path, local_path, port, identity, transport).await
        }
        (Endpoint::Local(_), Endpoint::Local(_)) => {
            anyhow::bail!("both source and destination are local — use cp instead")
        }
        (Endpoint::Remote { .. }, Endpoint::Remote { .. }) => {
            anyhow::bail!("remote-to-remote transfer is not supported")
        }
    }
}

/// Upload a local file to a remote host.
async fn upload(
    local_path: &Path,
    user: &str,
    host: &str,
    remote_path: &str,
    port: u16,
    identity: &str,
    transport: Option<&str>,
) -> Result<()> {
    // Verify the local file exists and get its size.
    let metadata = fs::metadata(local_path)
        .with_context(|| format!("cannot stat {}", local_path.display()))?;
    let file_size = metadata.len();

    // Load signing key from keystore.
    let keystore = wsh_client::KeyStore::default_location()
        .map_err(|e| anyhow::anyhow!("{e}"))?;
    let (_signing_key, _verifying_key) = keystore
        .load(identity)
        .map_err(|e| anyhow::anyhow!("{e}"))
        .with_context(|| format!("failed to load key '{identity}'"))?;

    let scheme = match transport {
        Some("wt") => "https",
        Some("ws") | None => "ws",
        Some(other) => anyhow::bail!("unknown transport: {other}"),
    };
    let url = format!("{scheme}://{host}:{port}");
    debug!(url = %url, file_size, "upload transport URL");

    // TODO: Full implementation using wsh-client file_transfer module.
    //
    //   let client = WshClient::connect(&url, ConnectConfig {
    //       username: user.to_string(),
    //       key_name: Some(identity.to_string()),
    //       ..Default::default()
    //   }).await?;
    //
    //   let session = client.open_session(SessionOpts {
    //       kind: ChannelKind::File,
    //       ..Default::default()
    //   }).await?;
    //
    //   let file = fs::File::open(local_path)?;
    //   let mut reader = io::BufReader::new(file);
    //   let mut buf = vec![0u8; 32768];
    //   let mut transferred: u64 = 0;
    //
    //   loop {
    //       let n = reader.read(&mut buf)?;
    //       if n == 0 { break; }
    //       session.write(&buf[..n]).await?;
    //       transferred += n as u64;
    //       print_progress(transferred, file_size);
    //   }
    //   session.close().await?;
    //   client.disconnect().await?;

    println!(
        "wsh: scp {} -> {user}@{host}:{remote_path} ({}) — transport not yet implemented",
        local_path.display(),
        format_size(file_size),
    );

    Ok(())
}

/// Download a remote file to a local path.
async fn download(
    user: &str,
    host: &str,
    remote_path: &str,
    local_path: &Path,
    port: u16,
    identity: &str,
    transport: Option<&str>,
) -> Result<()> {
    // Load signing key from keystore.
    let keystore = wsh_client::KeyStore::default_location()
        .map_err(|e| anyhow::anyhow!("{e}"))?;
    let (_signing_key, _verifying_key) = keystore
        .load(identity)
        .map_err(|e| anyhow::anyhow!("{e}"))
        .with_context(|| format!("failed to load key '{identity}'"))?;

    let scheme = match transport {
        Some("wt") => "https",
        Some("ws") | None => "ws",
        Some(other) => anyhow::bail!("unknown transport: {other}"),
    };
    let url = format!("{scheme}://{host}:{port}");
    debug!(url = %url, "download transport URL");

    // TODO: Full implementation using wsh-client file_transfer module.
    //
    //   let client = WshClient::connect(&url, ConnectConfig { ... }).await?;
    //   let (session, file_size) = client.open_file_download(remote_path).await?;
    //
    //   let file = fs::File::create(local_path)?;
    //   let mut writer = io::BufWriter::new(file);
    //   let mut buf = vec![0u8; 32768];
    //   let mut transferred: u64 = 0;
    //
    //   loop {
    //       let n = session.read(&mut buf).await?;
    //       if n == 0 { break; }
    //       writer.write_all(&buf[..n])?;
    //       transferred += n as u64;
    //       print_progress(transferred, file_size);
    //   }
    //   writer.flush()?;
    //   client.disconnect().await?;

    println!(
        "wsh: scp {user}@{host}:{remote_path} -> {} — transport not yet implemented",
        local_path.display(),
    );

    Ok(())
}

/// Parse an SCP endpoint string. Remote endpoints use `[user@]host:path` syntax.
fn parse_endpoint(s: &str) -> Result<Endpoint> {
    // Look for the colon that separates host from path, but skip Windows drive letters
    // (e.g., C:\path) by requiring that the part before the colon contains no path separators.
    if let Some(colon_pos) = s.find(':') {
        let before = &s[..colon_pos];
        // If the part before the colon looks like a host (no slashes), treat as remote.
        if !before.contains('/') && !before.contains('\\') && !before.is_empty() {
            let path = &s[colon_pos + 1..];
            if path.is_empty() {
                anyhow::bail!("remote path cannot be empty in '{s}'");
            }
            let (user, host) = if before.contains('@') {
                parse_target(before)?
            } else {
                // No user specified — use current username.
                let user = whoami().unwrap_or_else(|| "root".into());
                (user, before.to_string())
            };
            return Ok(Endpoint::Remote {
                user,
                host,
                path: path.to_string(),
            });
        }
    }

    Ok(Endpoint::Local(PathBuf::from(s)))
}

/// Get the current system username.
fn whoami() -> Option<String> {
    std::env::var("USER")
        .or_else(|_| std::env::var("USERNAME"))
        .ok()
}

/// Print a progress bar to stderr.
#[allow(dead_code)]
fn print_progress(transferred: u64, total: u64) {
    if total == 0 {
        return;
    }
    let pct = (transferred as f64 / total as f64 * 100.0).min(100.0);
    let bar_width = 40;
    let filled = (pct / 100.0 * bar_width as f64) as usize;
    let empty = bar_width - filled;

    eprint!(
        "\r  [{}{}] {:5.1}% {}/{}",
        "=".repeat(filled),
        " ".repeat(empty),
        pct,
        format_size(transferred),
        format_size(total),
    );

    if transferred >= total {
        eprintln!();
    }
    let _ = io::stderr().flush();
}

/// Format a byte count as a human-readable string.
fn format_size(bytes: u64) -> String {
    const KB: u64 = 1024;
    const MB: u64 = 1024 * KB;
    const GB: u64 = 1024 * MB;

    if bytes >= GB {
        format!("{:.1} GB", bytes as f64 / GB as f64)
    } else if bytes >= MB {
        format!("{:.1} MB", bytes as f64 / MB as f64)
    } else if bytes >= KB {
        format!("{:.1} KB", bytes as f64 / KB as f64)
    } else {
        format!("{bytes} B")
    }
}
