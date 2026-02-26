//! MCP proxy: forward MCP requests to local MCP servers via HTTP.
//!
//! This allows the wsh server to act as a gateway, proxying MCP tool
//! calls to local MCP-compatible servers (e.g., running on localhost).

use serde_json::json;
use std::collections::HashMap;
use tracing::{debug, info, warn};
use wsh_core::messages::{McpCallPayload, McpResultPayload, McpToolSpec};

/// Configuration for a proxied MCP server.
#[derive(Debug, Clone)]
pub struct ProxiedServer {
    /// Name of the server (used as tool namespace prefix).
    pub name: String,
    /// HTTP base URL of the MCP server.
    pub url: String,
    /// Optional API key or auth token.
    pub auth_token: Option<String>,
    /// Timeout for requests in seconds.
    pub timeout_secs: u64,
}

/// MCP proxy that forwards requests to local MCP servers.
pub struct McpProxy {
    /// Registered proxied servers.
    servers: HashMap<String, ProxiedServer>,
    /// Cached tool lists per server.
    tool_cache: HashMap<String, Vec<McpToolSpec>>,
}

impl McpProxy {
    /// Create a new empty proxy.
    pub fn new() -> Self {
        Self {
            servers: HashMap::new(),
            tool_cache: HashMap::new(),
        }
    }

    /// Register a proxied MCP server.
    pub fn register_server(&mut self, server: ProxiedServer) {
        info!(name = %server.name, url = %server.url, "registered proxied MCP server");
        self.servers.insert(server.name.clone(), server);
    }

    /// Unregister a server.
    pub fn unregister_server(&mut self, name: &str) -> bool {
        self.tool_cache.remove(name);
        self.servers.remove(name).is_some()
    }

    /// Discover tools from all registered servers.
    ///
    /// TODO: implement actual HTTP discovery against MCP servers.
    /// This stub returns cached tools or an empty list.
    pub async fn discover_all(&mut self) -> Vec<McpToolSpec> {
        let mut all_tools = Vec::new();

        for (name, _server) in &self.servers {
            // TODO: HTTP GET {server.url}/tools to discover available tools.
            // For now, return whatever is in the cache.
            if let Some(cached) = self.tool_cache.get(name) {
                all_tools.extend(cached.clone());
            } else {
                debug!(server = %name, "no cached tools for proxied server (discovery not yet implemented)");
            }
        }

        all_tools
    }

    /// Manually register tools for a server (e.g., from static config).
    pub fn set_tools(&mut self, server_name: &str, tools: Vec<McpToolSpec>) {
        self.tool_cache.insert(server_name.to_string(), tools);
    }

    /// Forward an MCP call to the appropriate proxied server.
    ///
    /// Tool names are expected to be prefixed with the server name:
    /// e.g., `servername.toolname`.
    ///
    /// TODO: implement actual HTTP POST forwarding.
    pub async fn call(&self, call: &McpCallPayload) -> McpResultPayload {
        // Parse server name from tool name (format: "server.tool")
        let (server_name, _tool_name) = match call.tool.split_once('.') {
            Some(parts) => parts,
            None => {
                return McpResultPayload {
                    result: json!({
                        "error": format!(
                            "tool name must be prefixed with server name: {}",
                            call.tool
                        ),
                    }),
                };
            }
        };

        let server = match self.servers.get(server_name) {
            Some(s) => s,
            None => {
                return McpResultPayload {
                    result: json!({
                        "error": format!("unknown MCP server: {server_name}"),
                    }),
                };
            }
        };

        // TODO: implement HTTP POST to {server.url}/call with the tool call payload.
        // For now, return a stub response.
        warn!(
            server = %server.name,
            tool = %call.tool,
            "MCP proxy call not yet implemented (HTTP forwarding stub)"
        );

        McpResultPayload {
            result: json!({
                "error": "MCP proxy HTTP forwarding not yet implemented",
                "server": server.name,
                "url": server.url,
                "tool": call.tool,
            }),
        }
    }

    /// Number of registered servers.
    pub fn server_count(&self) -> usize {
        self.servers.len()
    }
}
