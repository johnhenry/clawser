//! Defines the syscall interface between WASM and the host.
//! These are the "contracts" that the JS host must implement.

use serde::{Deserialize, Serialize};

/// Categories of syscalls available to the WASM runtime.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub enum SyscallCategory {
    Log,
    Time,
    Task,
    Network,
    Filesystem,
    Mcp,
    Ai,
    Memory,
    Crypto,
    Git,
    State,
    Events,
    Permissions,
    Notification,
}

/// A filesystem operation request.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "op")]
pub enum FsOperation {
    Read { path: String },
    Write { path: String, data: Vec<u8> },
    List { path: String },
    Delete { path: String },
    Stat { path: String },
    Mkdir { path: String },
}

/// Metadata returned from a stat operation.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FsMetadata {
    pub size: u64,
    pub is_dir: bool,
    pub is_file: bool,
    pub modified: Option<i64>,
    pub created: Option<i64>,
}

/// A directory entry.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FsEntry {
    pub name: String,
    pub is_dir: bool,
    pub size: u64,
}

/// An HTTP fetch request.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FetchRequest {
    pub url: String,
    pub method: String,
    #[serde(default)]
    pub headers: Vec<(String, String)>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub body: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub timeout_ms: Option<u64>,
}

impl FetchRequest {
    pub fn get(url: impl Into<String>) -> Self {
        Self {
            url: url.into(),
            method: "GET".to_string(),
            headers: Vec::new(),
            body: None,
            timeout_ms: None,
        }
    }

    pub fn post(url: impl Into<String>, body: impl Into<String>) -> Self {
        Self {
            url: url.into(),
            method: "POST".to_string(),
            headers: Vec::new(),
            body: Some(body.into()),
            timeout_ms: None,
        }
    }

    pub fn with_header(mut self, name: impl Into<String>, value: impl Into<String>) -> Self {
        self.headers.push((name.into(), value.into()));
        self
    }

    pub fn with_timeout(mut self, ms: u64) -> Self {
        self.timeout_ms = Some(ms);
        self
    }
}

/// An HTTP fetch response.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FetchResponse {
    pub status: u16,
    pub headers: Vec<(String, String)>,
    pub body: String,
}

impl FetchResponse {
    pub fn is_success(&self) -> bool {
        (200..300).contains(&self.status)
    }

    pub fn header(&self, name: &str) -> Option<&str> {
        let lower = name.to_lowercase();
        self.headers
            .iter()
            .find(|(k, _)| k.to_lowercase() == lower)
            .map(|(_, v)| v.as_str())
    }
}

/// A log level for host logging.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum LogLevel {
    Trace = 0,
    Debug = 1,
    Info = 2,
    Warn = 3,
    Error = 4,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_fetch_request_get() {
        let req = FetchRequest::get("https://api.example.com/data");
        assert_eq!(req.method, "GET");
        assert_eq!(req.url, "https://api.example.com/data");
        assert!(req.body.is_none());
    }

    #[test]
    fn test_fetch_request_post() {
        let req = FetchRequest::post("https://api.example.com/data", r#"{"key":"val"}"#);
        assert_eq!(req.method, "POST");
        assert_eq!(req.body.as_deref(), Some(r#"{"key":"val"}"#));
    }

    #[test]
    fn test_fetch_request_with_headers() {
        let req = FetchRequest::get("https://example.com")
            .with_header("Authorization", "Bearer token123")
            .with_header("Content-Type", "application/json");
        assert_eq!(req.headers.len(), 2);
    }

    #[test]
    fn test_fetch_request_with_timeout() {
        let req = FetchRequest::get("https://example.com").with_timeout(5000);
        assert_eq!(req.timeout_ms, Some(5000));
    }

    #[test]
    fn test_fetch_response_success() {
        let resp = FetchResponse {
            status: 200,
            headers: vec![("content-type".to_string(), "application/json".to_string())],
            body: "{}".to_string(),
        };
        assert!(resp.is_success());
    }

    #[test]
    fn test_fetch_response_error() {
        let resp = FetchResponse {
            status: 404,
            headers: vec![],
            body: "Not Found".to_string(),
        };
        assert!(!resp.is_success());
    }

    #[test]
    fn test_fetch_response_header_lookup() {
        let resp = FetchResponse {
            status: 200,
            headers: vec![
                ("Content-Type".to_string(), "application/json".to_string()),
                ("X-Custom".to_string(), "value".to_string()),
            ],
            body: "{}".to_string(),
        };
        assert_eq!(resp.header("content-type"), Some("application/json"));
        assert_eq!(resp.header("Content-Type"), Some("application/json"));
        assert_eq!(resp.header("x-custom"), Some("value"));
        assert_eq!(resp.header("missing"), None);
    }

    #[test]
    fn test_fs_operation_serialization() {
        let op = FsOperation::Read {
            path: "/workspace/test.md".to_string(),
        };
        let json = serde_json::to_string(&op).unwrap();
        assert!(json.contains("Read"));
        assert!(json.contains("/workspace/test.md"));
    }

    #[test]
    fn test_fs_metadata() {
        let meta = FsMetadata {
            size: 1024,
            is_dir: false,
            is_file: true,
            modified: Some(1700000000),
            created: Some(1699000000),
        };
        let json = serde_json::to_string(&meta).unwrap();
        let parsed: FsMetadata = serde_json::from_str(&json).unwrap();
        assert_eq!(parsed.size, 1024);
        assert!(parsed.is_file);
    }

    #[test]
    fn test_fs_entry() {
        let entry = FsEntry {
            name: "hello.md".to_string(),
            is_dir: false,
            size: 256,
        };
        let json = serde_json::to_string(&entry).unwrap();
        let parsed: FsEntry = serde_json::from_str(&json).unwrap();
        assert_eq!(parsed.name, "hello.md");
    }

    #[test]
    fn test_log_level_ordering() {
        assert!((LogLevel::Trace as i32) < (LogLevel::Error as i32));
        assert!((LogLevel::Info as i32) < (LogLevel::Warn as i32));
    }

    #[test]
    fn test_syscall_category_serialization() {
        let cat = SyscallCategory::Filesystem;
        let json = serde_json::to_string(&cat).unwrap();
        let parsed: SyscallCategory = serde_json::from_str(&json).unwrap();
        assert_eq!(parsed, SyscallCategory::Filesystem);
    }

    #[test]
    fn test_fetch_request_serialization() {
        let req = FetchRequest::post("https://api.example.com", "{}")
            .with_header("Auth", "Bearer x")
            .with_timeout(3000);
        let json = serde_json::to_string(&req).unwrap();
        let parsed: FetchRequest = serde_json::from_str(&json).unwrap();
        assert_eq!(parsed.method, "POST");
        assert_eq!(parsed.headers.len(), 1);
        assert_eq!(parsed.timeout_ms, Some(3000));
    }
}
