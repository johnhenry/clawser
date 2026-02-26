//! WebTransport (QUIC) transport implementation for wsh.
//!
//! Uses `quinn` to establish a QUIC connection. The first bidirectional stream
//! opened becomes the control stream. Subsequent bidi streams are used for data.

use std::future::Future;
use std::pin::Pin;
use std::sync::Arc;

use quinn::{ClientConfig, Connection, Endpoint, RecvStream, SendStream};
use rustls::pki_types::ServerName;
use wsh_core::codec::FrameDecoder;
use wsh_core::error::{WshError, WshResult};
use wsh_core::transport::{ByteStream, IdentifiedStream, TransportSession};

/// A QUIC bidirectional stream wrapped as a `ByteStream`.
struct QuinnStream {
    send: SendStream,
    recv: RecvStream,
}

impl ByteStream for QuinnStream {
    fn read<'a>(
        &'a mut self,
        buf: &'a mut [u8],
    ) -> Pin<Box<dyn Future<Output = WshResult<usize>> + Send + 'a>> {
        Box::pin(async move {
            match self.recv.read(buf).await {
                Ok(Some(n)) => Ok(n),
                Ok(None) => Ok(0),
                Err(e) => Err(WshError::Transport(format!("QUIC read error: {e}"))),
            }
        })
    }

    fn write_all<'a>(
        &'a mut self,
        data: &'a [u8],
    ) -> Pin<Box<dyn Future<Output = WshResult<()>> + Send + 'a>> {
        Box::pin(async move {
            self.send
                .write_all(data)
                .await
                .map_err(|e| WshError::Transport(format!("QUIC write error: {e}")))
        })
    }

    fn close(&mut self) -> Pin<Box<dyn Future<Output = WshResult<()>> + Send + '_>> {
        Box::pin(async move {
            self.send
                .finish()
                .map_err(|e| WshError::Transport(format!("QUIC close error: {e}")))?;
            Ok(())
        })
    }
}

/// WebTransport session backed by a QUIC connection via quinn.
pub struct WebTransportSession {
    connection: Connection,
    control_send: SendStream,
    control_recv: RecvStream,
    decoder: FrameDecoder,
    next_stream_id: u32,
    connected: bool,
}

impl WebTransportSession {
    /// Connect to a wsh server over QUIC/WebTransport.
    ///
    /// The `addr` should be a `host:port` string. The first bidirectional stream
    /// is opened as the control stream.
    pub async fn connect(addr: &str, server_name: &str) -> WshResult<Self> {
        // Build a client config that skips certificate verification for development.
        // In production, proper TLS certificate validation should be used.
        let crypto = rustls::ClientConfig::builder()
            .dangerous()
            .with_custom_certificate_verifier(Arc::new(SkipServerVerification))
            .with_no_client_auth();

        let client_config = ClientConfig::new(Arc::new(
            quinn::crypto::rustls::QuicClientConfig::try_from(crypto)
                .map_err(|e| WshError::Transport(format!("TLS config error: {e}")))?,
        ));

        let mut endpoint = Endpoint::client("0.0.0.0:0".parse().unwrap())
            .map_err(|e| WshError::Transport(format!("endpoint error: {e}")))?;
        endpoint.set_default_client_config(client_config);

        let socket_addr = tokio::net::lookup_host(addr)
            .await
            .map_err(|e| WshError::Transport(format!("DNS lookup failed: {e}")))?
            .next()
            .ok_or_else(|| WshError::Transport(format!("no addresses for {addr}")))?;

        let connection = endpoint
            .connect(socket_addr, server_name)
            .map_err(|e| WshError::Transport(format!("QUIC connect error: {e}")))?
            .await
            .map_err(|e| WshError::Transport(format!("QUIC connection failed: {e}")))?;

        tracing::info!(
            "QUIC connected to {} ({})",
            addr,
            connection.remote_address()
        );

        // Open the control stream (first bidi stream)
        let (control_send, control_recv) = connection
            .open_bi()
            .await
            .map_err(|e| WshError::Transport(format!("failed to open control stream: {e}")))?;

        Ok(Self {
            connection,
            control_send,
            control_recv,
            decoder: FrameDecoder::new(),
            next_stream_id: 1,
            connected: true,
        })
    }
}

impl TransportSession for WebTransportSession {
    async fn send_control(&mut self, data: &[u8]) -> WshResult<()> {
        // Send as length-prefixed frame
        let frame = frame_helpers::encode_raw(data);
        self.control_send
            .write_all(&frame)
            .await
            .map_err(|e| WshError::Transport(format!("control send error: {e}")))?;
        Ok(())
    }

    async fn recv_control(&mut self) -> WshResult<Vec<u8>> {
        loop {
            // Try to decode a complete frame from the buffer
            let frames = self.decoder.feed_raw(&[]);
            if let Some(frame) = frames.into_iter().next() {
                return Ok(frame);
            }

            // Read more data from the control stream
            let mut buf = vec![0u8; 8192];
            match self.control_recv.read(&mut buf).await {
                Ok(Some(n)) => {
                    let frames = self.decoder.feed_raw(&buf[..n]);
                    if let Some(frame) = frames.into_iter().next() {
                        return Ok(frame);
                    }
                }
                Ok(None) => {
                    self.connected = false;
                    return Err(WshError::Transport("control stream closed".into()));
                }
                Err(e) => {
                    self.connected = false;
                    return Err(WshError::Transport(format!("control recv error: {e}")));
                }
            }
        }
    }

    async fn open_stream(&mut self) -> WshResult<IdentifiedStream> {
        let (send, recv) = self
            .connection
            .open_bi()
            .await
            .map_err(|e| WshError::Transport(format!("failed to open stream: {e}")))?;

        let id = self.next_stream_id;
        self.next_stream_id += 1;

        Ok(IdentifiedStream {
            id,
            stream: Box::new(QuinnStream { send, recv }),
        })
    }

    async fn accept_stream(&mut self) -> WshResult<IdentifiedStream> {
        let (send, recv) = self
            .connection
            .accept_bi()
            .await
            .map_err(|e| WshError::Transport(format!("failed to accept stream: {e}")))?;

        let id = self.next_stream_id;
        self.next_stream_id += 1;

        Ok(IdentifiedStream {
            id,
            stream: Box::new(QuinnStream { send, recv }),
        })
    }

    async fn close(&mut self) -> WshResult<()> {
        self.connected = false;
        self.connection.close(0u32.into(), b"client disconnect");
        Ok(())
    }

    fn is_connected(&self) -> bool {
        self.connected && self.connection.close_reason().is_none()
    }
}

/// Certificate verifier that accepts any server certificate.
///
/// This is intended for development only. Production deployments should
/// use proper certificate validation.
#[derive(Debug)]
struct SkipServerVerification;

impl rustls::client::danger::ServerCertVerifier for SkipServerVerification {
    fn verify_server_cert(
        &self,
        _end_entity: &rustls::pki_types::CertificateDer<'_>,
        _intermediates: &[rustls::pki_types::CertificateDer<'_>],
        _server_name: &ServerName<'_>,
        _ocsp_response: &[u8],
        _now: rustls::pki_types::UnixTime,
    ) -> Result<rustls::client::danger::ServerCertVerified, rustls::Error> {
        Ok(rustls::client::danger::ServerCertVerified::assertion())
    }

    fn verify_tls12_signature(
        &self,
        _message: &[u8],
        _cert: &rustls::pki_types::CertificateDer<'_>,
        _dss: &rustls::DigitallySignedStruct,
    ) -> Result<rustls::client::danger::HandshakeSignatureValid, rustls::Error> {
        Ok(rustls::client::danger::HandshakeSignatureValid::assertion())
    }

    fn verify_tls13_signature(
        &self,
        _message: &[u8],
        _cert: &rustls::pki_types::CertificateDer<'_>,
        _dss: &rustls::DigitallySignedStruct,
    ) -> Result<rustls::client::danger::HandshakeSignatureValid, rustls::Error> {
        Ok(rustls::client::danger::HandshakeSignatureValid::assertion())
    }

    fn supported_verify_schemes(&self) -> Vec<rustls::SignatureScheme> {
        vec![
            rustls::SignatureScheme::ED25519,
            rustls::SignatureScheme::ECDSA_NISTP256_SHA256,
            rustls::SignatureScheme::ECDSA_NISTP384_SHA384,
            rustls::SignatureScheme::RSA_PSS_SHA256,
            rustls::SignatureScheme::RSA_PSS_SHA384,
            rustls::SignatureScheme::RSA_PSS_SHA512,
            rustls::SignatureScheme::RSA_PKCS1_SHA256,
            rustls::SignatureScheme::RSA_PKCS1_SHA384,
            rustls::SignatureScheme::RSA_PKCS1_SHA512,
        ]
    }
}

/// Helper to encode raw bytes into a length-prefixed frame (used for control messages).
/// This is a local helper mirroring wsh_core::frame_encode but for raw bytes.
mod frame_helpers {
    pub fn encode_raw(data: &[u8]) -> Vec<u8> {
        let len = data.len() as u32;
        let mut frame = Vec::with_capacity(4 + data.len());
        frame.extend_from_slice(&len.to_be_bytes());
        frame.extend_from_slice(data);
        frame
    }
}
