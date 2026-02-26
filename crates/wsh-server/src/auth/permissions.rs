//! Per-key permission scopes (v1.5 stub).
//!
//! When fully implemented, authorized_keys options like `command="...",no-pty`
//! will be parsed into structured permissions attached to each key.

use serde::{Deserialize, Serialize};

/// Scopes that a session may be granted.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub enum SessionScope {
    /// Full interactive shell access.
    Shell,
    /// Allowed to run a single specified command only.
    Command(String),
    /// Allowed to use MCP tool bridging.
    Mcp,
    /// Allowed to open file transfer channels.
    FileTransfer,
    /// Allowed to act as a relay peer.
    Relay,
}

/// Permissions associated with an authorized key.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct KeyPermissions {
    /// Fingerprint of the authorized key.
    pub fingerprint: String,
    /// Allowed scopes for sessions authenticated with this key.
    pub scopes: Vec<SessionScope>,
    /// Whether PTY allocation is allowed.
    pub allow_pty: bool,
    /// Optional forced command (overrides client request).
    pub forced_command: Option<String>,
    /// Maximum number of concurrent sessions for this key.
    pub max_sessions: Option<usize>,
}

impl KeyPermissions {
    /// Create default (full-access) permissions for a given fingerprint.
    pub fn full_access(fingerprint: String) -> Self {
        Self {
            fingerprint,
            scopes: vec![
                SessionScope::Shell,
                SessionScope::Mcp,
                SessionScope::FileTransfer,
                SessionScope::Relay,
            ],
            allow_pty: true,
            forced_command: None,
            max_sessions: None,
        }
    }

    /// Check if a specific scope is permitted.
    pub fn has_scope(&self, scope: &SessionScope) -> bool {
        self.scopes.contains(scope)
    }

    /// Parse permissions from an authorized_keys options string.
    ///
    /// TODO: implement full options parsing (command="...", no-pty, etc.)
    pub fn from_options(fingerprint: String, _options: Option<&str>) -> Self {
        // Stub: return full access for now
        Self::full_access(fingerprint)
    }
}
