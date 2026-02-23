use std::collections::HashMap;

use serde::{Deserialize, Serialize};

use crate::tools::Permission;

/// Top-level configuration.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Config {
    #[serde(default = "default_version")]
    pub version: String,

    #[serde(default)]
    pub providers: ProvidersConfig,

    #[serde(default)]
    pub agent: AgentConfig,

    #[serde(default)]
    pub memory: MemoryConfig,

    #[serde(default)]
    pub scheduler: SchedulerConfig,

    #[serde(default)]
    pub autonomy: AutonomyConfig,

    #[serde(default)]
    pub permissions: PermissionsConfig,

    #[serde(default)]
    pub observability: ObservabilityConfig,

    #[serde(default)]
    pub cost: CostConfig,

    #[serde(default)]
    pub workspace: WorkspaceConfig,
}

fn default_version() -> String {
    "1.0.0".to_string()
}

impl Default for Config {
    fn default() -> Self {
        Self {
            version: default_version(),
            providers: ProvidersConfig::default(),
            agent: AgentConfig::default(),
            memory: MemoryConfig::default(),
            scheduler: SchedulerConfig::default(),
            autonomy: AutonomyConfig::default(),
            permissions: PermissionsConfig::default(),
            observability: ObservabilityConfig::default(),
            cost: CostConfig::default(),
            workspace: WorkspaceConfig::default(),
        }
    }
}

impl Config {
    pub fn from_json(json: &str) -> Result<Self, ConfigError> {
        serde_json::from_str(json).map_err(|e| ConfigError::ParseError(e.to_string()))
    }

    pub fn to_json(&self) -> Result<String, ConfigError> {
        serde_json::to_string_pretty(self).map_err(|e| ConfigError::SerializeError(e.to_string()))
    }

    pub fn validate(&self) -> Result<(), ConfigError> {
        if self.agent.max_tool_iterations == 0 {
            return Err(ConfigError::ValidationError(
                "agent.max_tool_iterations must be > 0".to_string(),
            ));
        }
        if self.agent.token_limit == 0 {
            return Err(ConfigError::ValidationError(
                "agent.token_limit must be > 0".to_string(),
            ));
        }
        if self.memory.vector_weight + self.memory.keyword_weight == 0.0 {
            return Err(ConfigError::ValidationError(
                "memory weights cannot both be zero".to_string(),
            ));
        }
        Ok(())
    }
}

/// Provider configuration.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProvidersConfig {
    #[serde(default = "default_provider")]
    pub default: String,
    #[serde(default)]
    pub entries: HashMap<String, ProviderEntry>,
    #[serde(default)]
    pub model_routes: Vec<ModelRoute>,
    #[serde(default)]
    pub reliability: ReliabilityConfig,
}

fn default_provider() -> String {
    "openai".to_string()
}

impl Default for ProvidersConfig {
    fn default() -> Self {
        Self {
            default: default_provider(),
            entries: HashMap::new(),
            model_routes: Vec::new(),
            reliability: ReliabilityConfig::default(),
        }
    }
}

/// Configuration for a single provider.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProviderEntry {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub api_key: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub base_url: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub default_model: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub default_temperature: Option<f32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub max_tokens: Option<u32>,
}

/// Model routing hints.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ModelRoute {
    pub hint: String,
    pub provider: String,
    pub model: String,
}

/// Reliability configuration.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ReliabilityConfig {
    #[serde(default = "default_max_retries")]
    pub max_retries: u32,
    #[serde(default = "default_backoff_base_ms")]
    pub backoff_base_ms: u64,
    #[serde(default = "default_backoff_max_ms")]
    pub backoff_max_ms: u64,
    #[serde(default)]
    pub fallback_chain: Vec<String>,
}

fn default_max_retries() -> u32 {
    3
}
fn default_backoff_base_ms() -> u64 {
    1000
}
fn default_backoff_max_ms() -> u64 {
    30000
}

impl Default for ReliabilityConfig {
    fn default() -> Self {
        Self {
            max_retries: default_max_retries(),
            backoff_base_ms: default_backoff_base_ms(),
            backoff_max_ms: default_backoff_max_ms(),
            fallback_chain: Vec::new(),
        }
    }
}

/// Agent configuration.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AgentConfig {
    #[serde(default = "default_max_tool_iterations")]
    pub max_tool_iterations: u32,
    #[serde(default = "default_max_history_messages")]
    pub max_history_messages: u32,
    #[serde(default = "default_token_limit")]
    pub token_limit: u32,
    #[serde(default = "default_session_idle_timeout_secs")]
    pub session_idle_timeout_secs: u64,
    #[serde(default = "default_compaction_keep_recent")]
    pub compaction_keep_recent: u32,
    #[serde(default = "default_message_timeout_secs")]
    pub message_timeout_secs: u64,
    #[serde(default = "default_checkpoint_interval_secs")]
    pub checkpoint_interval_secs: u64,
    #[serde(default)]
    pub parallel_tools: bool,
}

fn default_max_tool_iterations() -> u32 {
    10
}
fn default_max_history_messages() -> u32 {
    50
}
fn default_token_limit() -> u32 {
    128_000
}
fn default_session_idle_timeout_secs() -> u64 {
    1800
}
fn default_compaction_keep_recent() -> u32 {
    20
}
fn default_message_timeout_secs() -> u64 {
    300
}
fn default_checkpoint_interval_secs() -> u64 {
    30
}

impl Default for AgentConfig {
    fn default() -> Self {
        Self {
            max_tool_iterations: default_max_tool_iterations(),
            max_history_messages: default_max_history_messages(),
            token_limit: default_token_limit(),
            session_idle_timeout_secs: default_session_idle_timeout_secs(),
            compaction_keep_recent: default_compaction_keep_recent(),
            message_timeout_secs: default_message_timeout_secs(),
            checkpoint_interval_secs: default_checkpoint_interval_secs(),
            parallel_tools: false,
        }
    }
}

/// Memory configuration.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MemoryConfig {
    #[serde(default = "default_memory_backend")]
    pub backend: String,
    #[serde(default = "default_true")]
    pub auto_save: bool,
    #[serde(default = "default_embedding_provider")]
    pub embedding_provider: String,
    #[serde(default = "default_embedding_model")]
    pub embedding_model: String,
    #[serde(default = "default_embedding_dimensions")]
    pub embedding_dimensions: u32,
    #[serde(default = "default_vector_weight")]
    pub vector_weight: f64,
    #[serde(default = "default_keyword_weight")]
    pub keyword_weight: f64,
    #[serde(default)]
    pub hygiene: HygieneConfig,
}

fn default_memory_backend() -> String {
    "sqlite".to_string()
}
fn default_embedding_provider() -> String {
    "noop".to_string()
}
fn default_embedding_model() -> String {
    "text-embedding-3-small".to_string()
}
fn default_embedding_dimensions() -> u32 {
    1536
}
fn default_vector_weight() -> f64 {
    0.7
}
fn default_keyword_weight() -> f64 {
    0.3
}
fn default_true() -> bool {
    true
}

impl Default for MemoryConfig {
    fn default() -> Self {
        Self {
            backend: default_memory_backend(),
            auto_save: true,
            embedding_provider: default_embedding_provider(),
            embedding_model: default_embedding_model(),
            embedding_dimensions: default_embedding_dimensions(),
            vector_weight: default_vector_weight(),
            keyword_weight: default_keyword_weight(),
            hygiene: HygieneConfig::default(),
        }
    }
}

/// Memory hygiene configuration.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HygieneConfig {
    #[serde(default = "default_true")]
    pub enabled: bool,
    #[serde(default = "default_archive_after_days")]
    pub archive_after_days: u32,
    #[serde(default = "default_purge_after_days")]
    pub purge_after_days: u32,
}

fn default_archive_after_days() -> u32 {
    7
}
fn default_purge_after_days() -> u32 {
    30
}

impl Default for HygieneConfig {
    fn default() -> Self {
        Self {
            enabled: true,
            archive_after_days: default_archive_after_days(),
            purge_after_days: default_purge_after_days(),
        }
    }
}

/// Scheduler configuration.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SchedulerConfig {
    #[serde(default = "default_heartbeat_interval")]
    pub heartbeat_interval_minutes: u32,
    #[serde(default = "default_max_concurrent_jobs")]
    pub max_concurrent_jobs: u32,
}

fn default_heartbeat_interval() -> u32 {
    5
}
fn default_max_concurrent_jobs() -> u32 {
    3
}

impl Default for SchedulerConfig {
    fn default() -> Self {
        Self {
            heartbeat_interval_minutes: default_heartbeat_interval(),
            max_concurrent_jobs: default_max_concurrent_jobs(),
        }
    }
}

/// Autonomy level.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum AutonomyLevel {
    ReadOnly,
    Supervised,
    Full,
}

/// Autonomy configuration.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AutonomyConfig {
    #[serde(default = "default_autonomy_level")]
    pub level: AutonomyLevel,
    #[serde(default = "default_max_actions_per_hour")]
    pub max_actions_per_hour: u32,
    #[serde(default = "default_max_cost_per_day_cents")]
    pub max_cost_per_day_cents: u32,
    #[serde(default = "default_true")]
    pub workspace_only: bool,
}

fn default_autonomy_level() -> AutonomyLevel {
    AutonomyLevel::Supervised
}
fn default_max_actions_per_hour() -> u32 {
    50
}
fn default_max_cost_per_day_cents() -> u32 {
    500
}

impl Default for AutonomyConfig {
    fn default() -> Self {
        Self {
            level: default_autonomy_level(),
            max_actions_per_hour: default_max_actions_per_hour(),
            max_cost_per_day_cents: default_max_cost_per_day_cents(),
            workspace_only: true,
        }
    }
}

/// Permissions configuration.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PermissionsConfig {
    #[serde(default = "default_auto_grant")]
    pub auto_grant: Vec<Permission>,
    #[serde(default = "default_require_approval")]
    pub require_approval: Vec<Permission>,
    #[serde(default)]
    pub deny: Vec<Permission>,
}

fn default_auto_grant() -> Vec<Permission> {
    vec![Permission::Read, Permission::Internal]
}

fn default_require_approval() -> Vec<Permission> {
    vec![
        Permission::Write,
        Permission::Network,
        Permission::Browser,
        Permission::Scheduler,
    ]
}

impl Default for PermissionsConfig {
    fn default() -> Self {
        Self {
            auto_grant: default_auto_grant(),
            require_approval: default_require_approval(),
            deny: Vec::new(),
        }
    }
}

/// Observability configuration.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ObservabilityConfig {
    #[serde(default = "default_observe_backend")]
    pub backend: String,
    #[serde(default = "default_ring_buffer_size")]
    pub ring_buffer_size: usize,
    #[serde(default = "default_true")]
    pub emit_to_event_bus: bool,
}

fn default_observe_backend() -> String {
    "ring_buffer".to_string()
}
fn default_ring_buffer_size() -> usize {
    1000
}

impl Default for ObservabilityConfig {
    fn default() -> Self {
        Self {
            backend: default_observe_backend(),
            ring_buffer_size: default_ring_buffer_size(),
            emit_to_event_bus: true,
        }
    }
}

/// Cost tracking configuration.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CostConfig {
    #[serde(default = "default_true")]
    pub tracking_enabled: bool,
    #[serde(default = "default_daily_limit")]
    pub daily_limit_cents: u32,
    #[serde(default = "default_monthly_limit")]
    pub monthly_limit_cents: u32,
    #[serde(default = "default_warning_threshold")]
    pub warning_threshold_percent: u32,
}

fn default_daily_limit() -> u32 {
    500
}
fn default_monthly_limit() -> u32 {
    10000
}
fn default_warning_threshold() -> u32 {
    80
}

impl Default for CostConfig {
    fn default() -> Self {
        Self {
            tracking_enabled: true,
            daily_limit_cents: default_daily_limit(),
            monthly_limit_cents: default_monthly_limit(),
            warning_threshold_percent: default_warning_threshold(),
        }
    }
}

/// Workspace configuration.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WorkspaceConfig {
    #[serde(default = "default_true")]
    pub auto_git_init: bool,
    #[serde(default = "default_true")]
    pub auto_commit_on_goal_complete: bool,
    #[serde(default = "default_max_file_size")]
    pub max_file_size_bytes: u64,
}

fn default_max_file_size() -> u64 {
    10_485_760 // 10MB
}

impl Default for WorkspaceConfig {
    fn default() -> Self {
        Self {
            auto_git_init: true,
            auto_commit_on_goal_complete: true,
            max_file_size_bytes: default_max_file_size(),
        }
    }
}

/// Configuration errors.
#[derive(Debug, thiserror::Error)]
pub enum ConfigError {
    #[error("failed to parse config: {0}")]
    ParseError(String),
    #[error("failed to serialize config: {0}")]
    SerializeError(String),
    #[error("config validation failed: {0}")]
    ValidationError(String),
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_default_config() {
        let config = Config::default();
        assert_eq!(config.version, "1.0.0");
        assert_eq!(config.providers.default, "openai");
        assert_eq!(config.agent.max_tool_iterations, 10);
        assert_eq!(config.agent.token_limit, 128_000);
        assert_eq!(config.memory.backend, "sqlite");
        assert_eq!(config.memory.vector_weight, 0.7);
        assert_eq!(config.autonomy.level, AutonomyLevel::Supervised);
        assert!(config.autonomy.workspace_only);
    }

    #[test]
    fn test_config_from_json_minimal() {
        let json = r#"{}"#;
        let config = Config::from_json(json).unwrap();
        assert_eq!(config.version, "1.0.0");
        assert_eq!(config.agent.max_tool_iterations, 10);
    }

    #[test]
    fn test_config_from_json_with_overrides() {
        let json = r#"{
            "version": "2.0.0",
            "agent": {
                "max_tool_iterations": 5,
                "token_limit": 64000
            },
            "autonomy": {
                "level": "full"
            }
        }"#;
        let config = Config::from_json(json).unwrap();
        assert_eq!(config.version, "2.0.0");
        assert_eq!(config.agent.max_tool_iterations, 5);
        assert_eq!(config.agent.token_limit, 64000);
        assert_eq!(config.autonomy.level, AutonomyLevel::Full);
    }

    #[test]
    fn test_config_roundtrip() {
        let config = Config::default();
        let json = config.to_json().unwrap();
        let parsed = Config::from_json(&json).unwrap();
        assert_eq!(parsed.version, config.version);
        assert_eq!(parsed.agent.max_tool_iterations, config.agent.max_tool_iterations);
    }

    #[test]
    fn test_config_validate_valid() {
        let config = Config::default();
        assert!(config.validate().is_ok());
    }

    #[test]
    fn test_config_validate_zero_iterations() {
        let mut config = Config::default();
        config.agent.max_tool_iterations = 0;
        let result = config.validate();
        assert!(result.is_err());
        assert!(result.unwrap_err().to_string().contains("max_tool_iterations"));
    }

    #[test]
    fn test_config_validate_zero_token_limit() {
        let mut config = Config::default();
        config.agent.token_limit = 0;
        let result = config.validate();
        assert!(result.is_err());
    }

    #[test]
    fn test_config_validate_zero_weights() {
        let mut config = Config::default();
        config.memory.vector_weight = 0.0;
        config.memory.keyword_weight = 0.0;
        let result = config.validate();
        assert!(result.is_err());
    }

    #[test]
    fn test_config_invalid_json() {
        let result = Config::from_json("not json");
        assert!(result.is_err());
    }

    #[test]
    fn test_provider_entry_serialization() {
        let entry = ProviderEntry {
            api_key: Some("sk-test".to_string()),
            base_url: Some("https://api.example.com".to_string()),
            default_model: Some("gpt-4".to_string()),
            default_temperature: Some(0.5),
            max_tokens: Some(4096),
        };
        let json = serde_json::to_string(&entry).unwrap();
        let parsed: ProviderEntry = serde_json::from_str(&json).unwrap();
        assert_eq!(parsed.api_key.as_deref(), Some("sk-test"));
    }

    #[test]
    fn test_autonomy_level_serialization() {
        let json = serde_json::to_string(&AutonomyLevel::ReadOnly).unwrap();
        assert_eq!(json, "\"read_only\"");
        let json = serde_json::to_string(&AutonomyLevel::Supervised).unwrap();
        assert_eq!(json, "\"supervised\"");
        let json = serde_json::to_string(&AutonomyLevel::Full).unwrap();
        assert_eq!(json, "\"full\"");
    }

    #[test]
    fn test_model_route() {
        let route = ModelRoute {
            hint: "fast".to_string(),
            provider: "chrome-ai".to_string(),
            model: "default".to_string(),
        };
        let json = serde_json::to_string(&route).unwrap();
        let parsed: ModelRoute = serde_json::from_str(&json).unwrap();
        assert_eq!(parsed.hint, "fast");
    }

    #[test]
    fn test_permissions_config_defaults() {
        let perms = PermissionsConfig::default();
        assert!(perms.auto_grant.contains(&Permission::Read));
        assert!(perms.auto_grant.contains(&Permission::Internal));
        assert!(perms.require_approval.contains(&Permission::Write));
        assert!(perms.require_approval.contains(&Permission::Network));
        assert!(perms.deny.is_empty());
    }

    #[test]
    fn test_hygiene_config_defaults() {
        let hygiene = HygieneConfig::default();
        assert!(hygiene.enabled);
        assert_eq!(hygiene.archive_after_days, 7);
        assert_eq!(hygiene.purge_after_days, 30);
    }

    #[test]
    fn test_config_with_providers() {
        let json = r#"{
            "providers": {
                "default": "anthropic",
                "entries": {
                    "anthropic": {
                        "api_key": "sk-ant-test",
                        "default_model": "claude-sonnet-4-20250514"
                    },
                    "openai": {
                        "api_key": "sk-test"
                    }
                },
                "model_routes": [
                    {"hint": "fast", "provider": "openai", "model": "gpt-4o-mini"}
                ]
            }
        }"#;
        let config = Config::from_json(json).unwrap();
        assert_eq!(config.providers.default, "anthropic");
        assert_eq!(config.providers.entries.len(), 2);
        assert_eq!(config.providers.model_routes.len(), 1);
    }
}
