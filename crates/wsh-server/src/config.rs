//! Server configuration: TOML file + CLI overrides.

use serde::Deserialize;
use std::path::{Path, PathBuf};
use tracing::info;
use wsh_core::WshResult;

/// Top-level config file structure.
#[derive(Debug, Clone, Deserialize)]
pub struct ConfigFile {
    #[serde(default)]
    pub server: ServerSection,
    #[serde(default)]
    pub auth: AuthSection,
}

/// `[server]` section of the config TOML.
#[derive(Debug, Clone, Deserialize)]
pub struct ServerSection {
    #[serde(default = "default_port")]
    pub port: u16,
    #[serde(default = "default_cert_path")]
    pub cert: String,
    #[serde(default = "default_key_path")]
    pub key: String,
    #[serde(default = "default_max_sessions")]
    pub max_sessions: usize,
    #[serde(default = "default_session_ttl")]
    pub session_ttl: u64,
    #[serde(default = "default_idle_timeout")]
    pub idle_timeout: u64,
}

impl Default for ServerSection {
    fn default() -> Self {
        Self {
            port: default_port(),
            cert: default_cert_path(),
            key: default_key_path(),
            max_sessions: default_max_sessions(),
            session_ttl: default_session_ttl(),
            idle_timeout: default_idle_timeout(),
        }
    }
}

/// `[auth]` section of the config TOML.
#[derive(Debug, Clone, Deserialize)]
pub struct AuthSection {
    #[serde(default = "default_true")]
    pub allow_pubkey: bool,
    #[serde(default = "default_true")]
    pub allow_password: bool,
}

impl Default for AuthSection {
    fn default() -> Self {
        Self {
            allow_pubkey: true,
            allow_password: true,
        }
    }
}

fn default_port() -> u16 {
    4422
}
fn default_cert_path() -> String {
    "~/.wsh/cert.pem".to_string()
}
fn default_key_path() -> String {
    "~/.wsh/key.pem".to_string()
}
fn default_max_sessions() -> usize {
    100
}
fn default_session_ttl() -> u64 {
    86400
}
fn default_idle_timeout() -> u64 {
    3600
}
fn default_true() -> bool {
    true
}

/// Resolved server configuration (all paths expanded, CLI overrides applied).
#[derive(Debug, Clone)]
pub struct ServerConfig {
    pub port: u16,
    pub cert_path: PathBuf,
    pub key_path: PathBuf,
    pub max_sessions: usize,
    pub session_ttl: u64,
    pub idle_timeout: u64,
    pub enable_relay: bool,
    pub allow_pubkey: bool,
    pub allow_password: bool,
}

impl ServerConfig {
    /// Load config from TOML file, then apply CLI overrides.
    pub fn load(
        config_path: Option<&Path>,
        cli_port: Option<u16>,
        cli_cert: Option<&str>,
        cli_key: Option<&str>,
        cli_max_sessions: Option<usize>,
        cli_session_ttl: Option<u64>,
        cli_idle_timeout: Option<u64>,
        cli_enable_relay: bool,
    ) -> WshResult<Self> {
        // Load base config from file
        let file_config = if let Some(path) = config_path {
            let expanded = expand_tilde(path);
            if expanded.exists() {
                info!(path = %expanded.display(), "loading config file");
                let content = std::fs::read_to_string(&expanded)?;
                toml::from_str::<ConfigFile>(&content).map_err(|e| {
                    wsh_core::WshError::Other(format!("config parse error: {e}"))
                })?
            } else {
                info!(path = %expanded.display(), "config file not found, using defaults");
                ConfigFile {
                    server: ServerSection::default(),
                    auth: AuthSection::default(),
                }
            }
        } else {
            ConfigFile {
                server: ServerSection::default(),
                auth: AuthSection::default(),
            }
        };

        // Merge CLI overrides
        let port = cli_port.unwrap_or(file_config.server.port);
        let cert_str = cli_cert
            .map(|s| s.to_string())
            .unwrap_or(file_config.server.cert);
        let key_str = cli_key
            .map(|s| s.to_string())
            .unwrap_or(file_config.server.key);
        let max_sessions = cli_max_sessions.unwrap_or(file_config.server.max_sessions);
        let session_ttl = cli_session_ttl.unwrap_or(file_config.server.session_ttl);
        let idle_timeout = cli_idle_timeout.unwrap_or(file_config.server.idle_timeout);

        Ok(Self {
            port,
            cert_path: expand_tilde_str(&cert_str),
            key_path: expand_tilde_str(&key_str),
            max_sessions,
            session_ttl,
            idle_timeout,
            enable_relay: cli_enable_relay,
            allow_pubkey: file_config.auth.allow_pubkey,
            allow_password: file_config.auth.allow_password,
        })
    }
}

/// Expand `~` to the user's home directory.
fn expand_tilde(path: &Path) -> PathBuf {
    let s = path.to_string_lossy();
    expand_tilde_str(&s)
}

fn expand_tilde_str(s: &str) -> PathBuf {
    if s.starts_with("~/") {
        if let Some(home) = dirs::home_dir() {
            return home.join(&s[2..]);
        }
    }
    PathBuf::from(s)
}
