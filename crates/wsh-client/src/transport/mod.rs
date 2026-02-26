//! Transport layer auto-selection for wsh.
//!
//! Selects WebTransport (QUIC) or WebSocket based on the URL scheme:
//! - `wss://` or `ws://` → WebSocket
//! - `https://` or `wt://` → WebTransport (QUIC)

pub mod websocket;
pub mod webtransport;

pub use websocket::WebSocketSession;
pub use webtransport::WebTransportSession;

use wsh_core::error::{WshError, WshResult};
use wsh_core::transport::{IdentifiedStream, TransportSession};

/// Transport kind, inferred from the connection URL.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TransportKind {
    WebSocket,
    WebTransport,
}

/// Enum-dispatched transport session.
///
/// Wraps both WebSocket and WebTransport sessions so we can use them
/// without `dyn TransportSession` (which is not object-safe due to async methods).
pub enum AnyTransport {
    WebSocket(WebSocketSession),
    WebTransport(WebTransportSession),
}

impl AnyTransport {
    pub async fn send_control(&mut self, data: &[u8]) -> WshResult<()> {
        match self {
            Self::WebSocket(s) => s.send_control(data).await,
            Self::WebTransport(s) => s.send_control(data).await,
        }
    }

    pub async fn recv_control(&mut self) -> WshResult<Vec<u8>> {
        match self {
            Self::WebSocket(s) => s.recv_control().await,
            Self::WebTransport(s) => s.recv_control().await,
        }
    }

    pub async fn open_stream(&mut self) -> WshResult<IdentifiedStream> {
        match self {
            Self::WebSocket(s) => s.open_stream().await,
            Self::WebTransport(s) => s.open_stream().await,
        }
    }

    pub async fn accept_stream(&mut self) -> WshResult<IdentifiedStream> {
        match self {
            Self::WebSocket(s) => s.accept_stream().await,
            Self::WebTransport(s) => s.accept_stream().await,
        }
    }

    pub async fn close(&mut self) -> WshResult<()> {
        match self {
            Self::WebSocket(s) => s.close().await,
            Self::WebTransport(s) => s.close().await,
        }
    }

    pub fn is_connected(&self) -> bool {
        match self {
            Self::WebSocket(s) => s.is_connected(),
            Self::WebTransport(s) => s.is_connected(),
        }
    }
}

/// Determine the transport kind from a URL string.
pub fn detect_transport(url: &str) -> WshResult<TransportKind> {
    let lower = url.to_lowercase();
    if lower.starts_with("ws://") || lower.starts_with("wss://") {
        Ok(TransportKind::WebSocket)
    } else if lower.starts_with("https://") || lower.starts_with("wt://") {
        Ok(TransportKind::WebTransport)
    } else {
        Err(WshError::Transport(format!(
            "unsupported URL scheme: {url} (expected ws://, wss://, https://, or wt://)"
        )))
    }
}

/// Connect to a wsh server, auto-selecting the transport from the URL scheme.
pub async fn auto_connect(url: &str) -> WshResult<AnyTransport> {
    let kind = detect_transport(url)?;

    match kind {
        TransportKind::WebSocket => {
            let session = WebSocketSession::connect(url).await?;
            Ok(AnyTransport::WebSocket(session))
        }
        TransportKind::WebTransport => {
            let (addr, server_name) = parse_webtransport_url(url)?;
            let session = WebTransportSession::connect(&addr, &server_name).await?;
            Ok(AnyTransport::WebTransport(session))
        }
    }
}

/// Parse a WebTransport URL into `(host:port, server_name)`.
fn parse_webtransport_url(url: &str) -> WshResult<(String, String)> {
    // Strip the scheme
    let without_scheme = if url.starts_with("https://") {
        &url[8..]
    } else if url.to_lowercase().starts_with("wt://") {
        &url[5..]
    } else {
        return Err(WshError::Transport(format!("invalid WebTransport URL: {url}")));
    };

    // Strip path
    let host_port = without_scheme.split('/').next().unwrap_or(without_scheme);

    // Extract server name (without port)
    let server_name = host_port
        .split(':')
        .next()
        .unwrap_or(host_port)
        .to_string();

    // Default port for QUIC/WebTransport
    let addr = if host_port.contains(':') {
        host_port.to_string()
    } else {
        format!("{host_port}:443")
    };

    Ok((addr, server_name))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn detect_websocket() {
        assert_eq!(detect_transport("ws://localhost:8080").unwrap(), TransportKind::WebSocket);
        assert_eq!(detect_transport("wss://example.com").unwrap(), TransportKind::WebSocket);
    }

    #[test]
    fn detect_webtransport() {
        assert_eq!(detect_transport("https://example.com:4433").unwrap(), TransportKind::WebTransport);
        assert_eq!(detect_transport("wt://example.com:4433").unwrap(), TransportKind::WebTransport);
    }

    #[test]
    fn detect_unknown() {
        assert!(detect_transport("http://example.com").is_err());
        assert!(detect_transport("ftp://example.com").is_err());
    }

    #[test]
    fn parse_wt_url() {
        let (addr, name) = parse_webtransport_url("https://example.com:4433/wsh").unwrap();
        assert_eq!(addr, "example.com:4433");
        assert_eq!(name, "example.com");
    }

    #[test]
    fn parse_wt_url_default_port() {
        let (addr, name) = parse_webtransport_url("https://example.com/wsh").unwrap();
        assert_eq!(addr, "example.com:443");
        assert_eq!(name, "example.com");
    }
}
