use serde::{Deserialize, Serialize};

/// Permission level required for a tool.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Permission {
    Read,
    Write,
    Network,
    Browser,
    Scheduler,
    Agent,
    Internal,
}

impl Permission {
    /// Whether this permission is always granted without user approval.
    pub fn is_auto_granted(&self) -> bool {
        matches!(self, Permission::Internal)
    }
}

/// Specification describing a tool's interface.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ToolSpec {
    pub name: String,
    pub description: String,
    pub parameters: serde_json::Value,
    pub required_permission: Permission,
}

/// Result of a tool invocation.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ToolResult {
    pub success: bool,
    pub output: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

impl ToolResult {
    pub fn success(output: impl Into<String>) -> Self {
        Self {
            success: true,
            output: output.into(),
            error: None,
        }
    }

    pub fn failure(error: impl Into<String>) -> Self {
        Self {
            success: false,
            output: String::new(),
            error: Some(error.into()),
        }
    }
}

/// Context provided to tools during execution.
#[derive(Debug, Clone)]
pub struct ToolContext {
    pub workspace_path: String,
    pub session_id: Option<String>,
}

/// Trait that all tools must implement.
pub trait Tool: Send + Sync {
    fn name(&self) -> &str;
    fn description(&self) -> &str;
    fn parameters_schema(&self) -> serde_json::Value;
    fn required_permission(&self) -> Permission;

    fn execute(
        &self,
        params: serde_json::Value,
        context: &ToolContext,
    ) -> Result<ToolResult, ToolError>;

    fn spec(&self) -> ToolSpec {
        ToolSpec {
            name: self.name().to_string(),
            description: self.description().to_string(),
            parameters: self.parameters_schema(),
            required_permission: self.required_permission(),
        }
    }
}

/// Errors from tool operations.
#[derive(Debug, thiserror::Error)]
pub enum ToolError {
    #[error("invalid parameters: {0}")]
    InvalidParams(String),
    #[error("permission denied: {0}")]
    PermissionDenied(String),
    #[error("execution failed: {0}")]
    ExecutionFailed(String),
    #[error("tool not found: {0}")]
    NotFound(String),
    #[error("tool timeout")]
    Timeout,
}

/// A proxy tool for tools that execute outside the WASM runtime (e.g., in JS).
/// Holds only the spec — execution is handled externally by the host.
pub struct ExternalTool {
    spec: ToolSpec,
}

impl ExternalTool {
    pub fn new(spec: ToolSpec) -> Self {
        Self { spec }
    }
}

impl Tool for ExternalTool {
    fn name(&self) -> &str {
        &self.spec.name
    }

    fn description(&self) -> &str {
        &self.spec.description
    }

    fn parameters_schema(&self) -> serde_json::Value {
        self.spec.parameters.clone()
    }

    fn required_permission(&self) -> Permission {
        self.spec.required_permission.clone()
    }

    fn execute(
        &self,
        _params: serde_json::Value,
        _context: &ToolContext,
    ) -> Result<ToolResult, ToolError> {
        // External tools are executed by the host, not in WASM.
        Err(ToolError::ExecutionFailed(format!(
            "external tool '{}' must be executed by host",
            self.spec.name
        )))
    }
}

/// Registry holding all available tools.
pub struct ToolRegistry {
    tools: Vec<Box<dyn Tool>>,
    /// Names of tools that execute externally (in JS host).
    external_names: Vec<String>,
}

impl ToolRegistry {
    pub fn new() -> Self {
        Self {
            tools: Vec::new(),
            external_names: Vec::new(),
        }
    }

    pub fn register(&mut self, tool: Box<dyn Tool>) {
        self.tools.push(tool);
    }

    /// Register an external tool (spec only, executed by host).
    pub fn register_external(&mut self, spec: ToolSpec) {
        self.external_names.push(spec.name.clone());
        self.tools.push(Box::new(ExternalTool::new(spec)));
    }

    /// Check if a tool is external (executed by host, not WASM).
    pub fn is_external(&self, name: &str) -> bool {
        self.external_names.contains(&name.to_string())
    }

    pub fn get(&self, name: &str) -> Option<&dyn Tool> {
        self.tools.iter().find(|t| t.name() == name).map(|t| &**t)
    }

    pub fn list_specs(&self) -> Vec<ToolSpec> {
        self.tools.iter().map(|t| t.spec()).collect()
    }

    pub fn len(&self) -> usize {
        self.tools.len()
    }

    pub fn is_empty(&self) -> bool {
        self.tools.is_empty()
    }

    pub fn execute(
        &self,
        name: &str,
        params: serde_json::Value,
        context: &ToolContext,
    ) -> Result<ToolResult, ToolError> {
        let tool = self.get(name).ok_or_else(|| ToolError::NotFound(name.to_string()))?;
        tool.execute(params, context)
    }
}

impl Default for ToolRegistry {
    fn default() -> Self {
        Self::new()
    }
}

/// A simple mock tool for testing.
pub struct MockTool {
    pub name: String,
    pub result: ToolResult,
}

impl MockTool {
    pub fn new(name: impl Into<String>, result: ToolResult) -> Self {
        Self {
            name: name.into(),
            result,
        }
    }
}

impl Tool for MockTool {
    fn name(&self) -> &str {
        &self.name
    }

    fn description(&self) -> &str {
        "A mock tool for testing"
    }

    fn parameters_schema(&self) -> serde_json::Value {
        serde_json::json!({
            "type": "object",
            "properties": {}
        })
    }

    fn required_permission(&self) -> Permission {
        Permission::Internal
    }

    fn execute(
        &self,
        _params: serde_json::Value,
        _context: &ToolContext,
    ) -> Result<ToolResult, ToolError> {
        Ok(self.result.clone())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_tool_result_success() {
        let result = ToolResult::success("file contents here");
        assert!(result.success);
        assert_eq!(result.output, "file contents here");
        assert!(result.error.is_none());
    }

    #[test]
    fn test_tool_result_failure() {
        let result = ToolResult::failure("file not found");
        assert!(!result.success);
        assert!(result.output.is_empty());
        assert_eq!(result.error.as_deref(), Some("file not found"));
    }

    #[test]
    fn test_permission_auto_grant() {
        assert!(Permission::Internal.is_auto_granted());
        assert!(!Permission::Read.is_auto_granted());
        assert!(!Permission::Write.is_auto_granted());
        assert!(!Permission::Network.is_auto_granted());
    }

    #[test]
    fn test_tool_registry_register_and_lookup() {
        let mut registry = ToolRegistry::new();
        assert!(registry.is_empty());

        registry.register(Box::new(MockTool::new(
            "test_tool",
            ToolResult::success("ok"),
        )));

        assert_eq!(registry.len(), 1);
        assert!(!registry.is_empty());
        assert!(registry.get("test_tool").is_some());
        assert!(registry.get("nonexistent").is_none());
    }

    #[test]
    fn test_tool_registry_list_specs() {
        let mut registry = ToolRegistry::new();
        registry.register(Box::new(MockTool::new("tool_a", ToolResult::success("a"))));
        registry.register(Box::new(MockTool::new("tool_b", ToolResult::success("b"))));

        let specs = registry.list_specs();
        assert_eq!(specs.len(), 2);
        assert_eq!(specs[0].name, "tool_a");
        assert_eq!(specs[1].name, "tool_b");
    }

    #[test]
    fn test_tool_registry_execute() {
        let mut registry = ToolRegistry::new();
        registry.register(Box::new(MockTool::new(
            "echo",
            ToolResult::success("echoed"),
        )));

        let ctx = ToolContext {
            workspace_path: "/workspace".to_string(),
            session_id: None,
        };

        let result = registry
            .execute("echo", serde_json::json!({}), &ctx)
            .unwrap();
        assert!(result.success);
        assert_eq!(result.output, "echoed");
    }

    #[test]
    fn test_tool_registry_execute_not_found() {
        let registry = ToolRegistry::new();
        let ctx = ToolContext {
            workspace_path: "/workspace".to_string(),
            session_id: None,
        };
        let result = registry.execute("missing", serde_json::json!({}), &ctx);
        assert!(result.is_err());
        assert!(matches!(result.unwrap_err(), ToolError::NotFound(_)));
    }

    #[test]
    fn test_tool_spec_serialization() {
        let spec = ToolSpec {
            name: "file_read".to_string(),
            description: "Read a file".to_string(),
            parameters: serde_json::json!({
                "type": "object",
                "properties": {
                    "path": { "type": "string" }
                },
                "required": ["path"]
            }),
            required_permission: Permission::Read,
        };

        let json = serde_json::to_string(&spec).unwrap();
        let parsed: ToolSpec = serde_json::from_str(&json).unwrap();
        assert_eq!(parsed.name, "file_read");
        assert_eq!(parsed.required_permission, Permission::Read);
    }

    #[test]
    fn test_tool_result_serialization() {
        let result = ToolResult::success("data");
        let json = serde_json::to_string(&result).unwrap();
        assert!(!json.contains("error")); // skip_serializing_if = None
        let parsed: ToolResult = serde_json::from_str(&json).unwrap();
        assert!(parsed.success);
    }
}
