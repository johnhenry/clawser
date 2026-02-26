//! Authentication handshake flow.
//!
//! Implements the wsh auth protocol:
//! 1. Client sends HELLO
//! 2. Server sends CHALLENGE with random nonce
//! 3. Client sends AUTH (pubkey signature or password)
//! 4. Server sends AUTH_OK (with session token) or AUTH_FAIL

use rand::Rng;
use sha2::{Digest, Sha256};
use tracing::{debug, info, warn};
use wsh_core::keys::AuthorizedKey;
use wsh_core::messages::*;
use wsh_core::{self, WshError, WshResult};

/// Result of a successful authentication.
#[derive(Debug)]
pub struct AuthResult {
    /// Authenticated username.
    pub username: String,
    /// Fingerprint of the key used (empty string for password auth).
    pub fingerprint: String,
    /// Session token bytes.
    pub token: Vec<u8>,
    /// Session ID.
    pub session_id: String,
}

/// Result of processing a HELLO message.
pub struct HelloResult {
    /// SERVER_HELLO envelope to send back.
    pub server_hello: Envelope,
    /// CHALLENGE envelope to send back.
    pub challenge: Envelope,
    /// The generated session ID (needed for transcript verification).
    pub session_id: String,
    /// The nonce (needed for transcript verification).
    pub nonce: Vec<u8>,
    /// Server fingerprints to advertise.
    pub fingerprints: Vec<String>,
}

/// Process a HELLO message, returning SERVER_HELLO + CHALLENGE envelopes.
pub fn handle_hello(
    hello: &HelloPayload,
    server_fingerprints: &[String],
) -> WshResult<HelloResult> {
    // Validate protocol version
    if hello.version != PROTOCOL_VERSION {
        return Err(WshError::InvalidMessage(format!(
            "unsupported protocol version: {} (expected {})",
            hello.version, PROTOCOL_VERSION
        )));
    }

    debug!(username = %hello.username, version = %hello.version, "received HELLO");

    // Generate session ID early — it's part of the auth transcript
    let session_id = generate_session_id();

    // Generate random 32-byte nonce
    let mut nonce = vec![0u8; 32];
    let mut rng = rand::thread_rng();
    rng.fill(&mut nonce[..]);

    let server_hello = Envelope {
        msg_type: MsgType::ServerHello,
        payload: Payload::ServerHello(ServerHelloPayload {
            session_id: session_id.clone(),
            features: vec!["mcp".to_string(), "file-transfer".to_string()],
            fingerprints: server_fingerprints.to_vec(),
        }),
    };

    let challenge = Envelope {
        msg_type: MsgType::Challenge,
        payload: Payload::Challenge(ChallengePayload {
            nonce: nonce.clone(),
        }),
    };

    Ok(HelloResult {
        server_hello,
        challenge,
        session_id,
        nonce,
        fingerprints: server_fingerprints.to_vec(),
    })
}

/// Verify an AUTH message against authorized keys or password.
///
/// `session_id` is the one from SERVER_HELLO — it's part of the auth transcript.
pub fn verify_auth(
    auth: &AuthPayload,
    nonce: &[u8],
    session_id: &str,
    authorized_keys: &[AuthorizedKey],
    server_secret: &[u8],
    session_ttl: u64,
    allow_pubkey: bool,
    allow_password: bool,
) -> WshResult<AuthResult> {
    match auth.method {
        AuthMethod::Pubkey => {
            if !allow_pubkey {
                return Err(WshError::AuthFailed("pubkey auth disabled".into()));
            }
            verify_pubkey_auth(auth, nonce, session_id, authorized_keys, server_secret, session_ttl)
        }
        AuthMethod::Password => {
            if !allow_password {
                return Err(WshError::AuthFailed("password auth disabled".into()));
            }
            verify_password_auth(auth, session_id, server_secret, session_ttl)
        }
    }
}

/// Build the challenge transcript (must match JS and Rust client implementations).
///
/// Format: `SHA-256("wsh-v1\0" || session_id || nonce)`
fn build_transcript(session_id: &str, nonce: &[u8]) -> Vec<u8> {
    let mut hasher = Sha256::new();
    hasher.update(PROTOCOL_VERSION.as_bytes());
    hasher.update(b"\0");
    hasher.update(session_id.as_bytes());
    hasher.update(nonce);
    hasher.finalize().to_vec()
}

/// Verify pubkey-based authentication.
fn verify_pubkey_auth(
    auth: &AuthPayload,
    nonce: &[u8],
    session_id: &str,
    authorized_keys: &[AuthorizedKey],
    server_secret: &[u8],
    session_ttl: u64,
) -> WshResult<AuthResult> {
    let public_key = auth
        .public_key
        .as_ref()
        .ok_or_else(|| WshError::AuthFailed("missing public_key in pubkey auth".into()))?;
    let signature = auth
        .signature
        .as_ref()
        .ok_or_else(|| WshError::AuthFailed("missing signature in pubkey auth".into()))?;

    // Check if the key is authorized
    if !wsh_core::keys::is_key_authorized(public_key, authorized_keys) {
        let fp = wsh_core::fingerprint(public_key);
        warn!(fingerprint = %fp, "unauthorized key");
        return Err(WshError::AuthFailed("key not authorized".into()));
    }

    // Verify the signature over the transcript.
    // Transcript: SHA-256("wsh-v1\0" || session_id || nonce)
    let transcript = build_transcript(session_id, nonce);

    // Import the public key and verify Ed25519 signature.
    let vk_bytes: [u8; 32] = public_key
        .as_slice()
        .try_into()
        .map_err(|_| WshError::AuthFailed("invalid public key length".into()))?;
    let verifying_key = ed25519_dalek::VerifyingKey::from_bytes(&vk_bytes)
        .map_err(|e| WshError::AuthFailed(format!("invalid public key: {e}")))?;
    let sig = ed25519_dalek::Signature::from_slice(signature)
        .map_err(|e| WshError::AuthFailed(format!("invalid signature: {e}")))?;

    use ed25519_dalek::Verifier;
    verifying_key
        .verify(&transcript, &sig)
        .map_err(|_| WshError::AuthFailed("signature verification failed".into()))?;

    let fp = wsh_core::fingerprint(public_key);
    let token = wsh_core::create_token(server_secret, session_id, session_ttl);

    info!(fingerprint = %wsh_core::short_fingerprint(&fp, &[], 8), "pubkey auth OK");

    Ok(AuthResult {
        username: String::new(), // Will be filled from HELLO
        fingerprint: fp,
        token,
        session_id: session_id.to_string(),
    })
}

/// Verify password-based authentication.
///
/// TODO: implement real password verification against a password store.
/// Currently this is a stub that always fails.
fn verify_password_auth(
    auth: &AuthPayload,
    session_id: &str,
    server_secret: &[u8],
    session_ttl: u64,
) -> WshResult<AuthResult> {
    let _password = auth
        .password
        .as_ref()
        .ok_or_else(|| WshError::AuthFailed("missing password in password auth".into()))?;

    // Stub: password auth is not yet implemented.
    // In production, this would check against PAM, /etc/shadow, or a config-defined hash.
    warn!("password auth attempted but not yet implemented");
    Err(WshError::AuthFailed(
        "password auth not yet implemented".into(),
    ))
}

/// Build an AUTH_OK envelope.
pub fn build_auth_ok(session_id: &str, token: &[u8], ttl: u64) -> Envelope {
    Envelope {
        msg_type: MsgType::AuthOk,
        payload: Payload::AuthOk(AuthOkPayload {
            session_id: session_id.to_string(),
            token: token.to_vec(),
            ttl,
        }),
    }
}

/// Build an AUTH_FAIL envelope.
pub fn build_auth_fail(reason: &str) -> Envelope {
    Envelope {
        msg_type: MsgType::AuthFail,
        payload: Payload::AuthFail(AuthFailPayload {
            reason: reason.to_string(),
        }),
    }
}

/// Generate a random session ID.
fn generate_session_id() -> String {
    let mut rng = rand::thread_rng();
    let bytes: Vec<u8> = (0..16).map(|_| rng.gen()).collect();
    hex::encode(bytes)
}
