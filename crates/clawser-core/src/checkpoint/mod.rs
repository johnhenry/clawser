use serde::{Deserialize, Serialize};

use crate::agent::{AgentState, Goal};
use crate::providers::ChatMessage;
use crate::scheduler::ScheduledJob;

/// A serializable checkpoint of the entire agent state.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Checkpoint {
    pub id: String,
    pub timestamp: i64,
    pub agent_state: AgentState,
    pub session_history: Vec<ChatMessage>,
    pub active_goals: Vec<Goal>,
    pub scheduler_snapshot: Vec<ScheduledJob>,
    pub version: String,
}

impl Checkpoint {
    pub fn new(id: impl Into<String>, timestamp: i64) -> Self {
        Self {
            id: id.into(),
            timestamp,
            agent_state: AgentState::Idle,
            session_history: Vec::new(),
            active_goals: Vec::new(),
            scheduler_snapshot: Vec::new(),
            version: "1.0.0".to_string(),
        }
    }

    /// Serialize to JSON bytes.
    pub fn to_bytes(&self) -> Result<Vec<u8>, CheckpointError> {
        serde_json::to_vec(self).map_err(|e| CheckpointError::SerializeError(e.to_string()))
    }

    /// Deserialize from JSON bytes.
    pub fn from_bytes(data: &[u8]) -> Result<Self, CheckpointError> {
        serde_json::from_slice(data).map_err(|e| CheckpointError::DeserializeError(e.to_string()))
    }

    /// Estimate the size of this checkpoint in bytes.
    pub fn estimate_size(&self) -> usize {
        // Rough estimate based on content
        let history_size: usize = self
            .session_history
            .iter()
            .map(|m| m.content.len() + 50) // content + overhead
            .sum();
        let goals_size = self.active_goals.len() * 200;
        let scheduler_size = self.scheduler_snapshot.len() * 300;
        history_size + goals_size + scheduler_size + 100 // base overhead
    }
}

/// Manages checkpoint storage and retrieval.
pub struct CheckpointManager {
    checkpoints: Vec<CheckpointMeta>,
    max_checkpoints: usize,
    next_id: u64,
}

/// Metadata about a stored checkpoint.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CheckpointMeta {
    pub id: String,
    pub timestamp: i64,
    pub size_bytes: usize,
}

impl CheckpointManager {
    pub fn new(max_checkpoints: usize) -> Self {
        Self {
            checkpoints: Vec::new(),
            max_checkpoints,
            next_id: 1,
        }
    }

    /// Save a checkpoint, returning its ID and serialized data.
    pub fn save(&mut self, checkpoint: &Checkpoint) -> Result<(String, Vec<u8>), CheckpointError> {
        let data = checkpoint.to_bytes()?;
        let meta = CheckpointMeta {
            id: checkpoint.id.clone(),
            timestamp: checkpoint.timestamp,
            size_bytes: data.len(),
        };

        self.checkpoints.push(meta);

        // Prune old checkpoints if over limit
        while self.checkpoints.len() > self.max_checkpoints {
            self.checkpoints.remove(0);
        }

        Ok((checkpoint.id.clone(), data))
    }

    /// Generate the next checkpoint ID.
    pub fn next_id(&mut self) -> String {
        let id = format!("ckpt_{}", self.next_id);
        self.next_id += 1;
        id
    }

    /// List all checkpoint metadata.
    pub fn list(&self) -> &[CheckpointMeta] {
        &self.checkpoints
    }

    /// Get the latest checkpoint metadata.
    pub fn latest(&self) -> Option<&CheckpointMeta> {
        self.checkpoints.last()
    }

    /// Count stored checkpoints.
    pub fn len(&self) -> usize {
        self.checkpoints.len()
    }

    pub fn is_empty(&self) -> bool {
        self.checkpoints.is_empty()
    }
}

/// Errors from checkpoint operations.
#[derive(Debug, thiserror::Error)]
pub enum CheckpointError {
    #[error("serialization failed: {0}")]
    SerializeError(String),
    #[error("deserialization failed: {0}")]
    DeserializeError(String),
    #[error("checkpoint not found: {0}")]
    NotFound(String),
    #[error("storage error: {0}")]
    StorageError(String),
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::agent::GoalStatus;

    #[test]
    fn test_checkpoint_creation() {
        let ckpt = Checkpoint::new("ckpt_1", 1000);
        assert_eq!(ckpt.id, "ckpt_1");
        assert_eq!(ckpt.timestamp, 1000);
        assert_eq!(ckpt.agent_state, AgentState::Idle);
        assert!(ckpt.session_history.is_empty());
    }

    #[test]
    fn test_checkpoint_serialization_roundtrip() {
        let mut ckpt = Checkpoint::new("ckpt_1", 1000);
        ckpt.session_history.push(ChatMessage::user("Hello"));
        ckpt.session_history
            .push(ChatMessage::assistant("Hi there!"));
        ckpt.active_goals.push(Goal {
            id: "g1".to_string(),
            description: "Test goal".to_string(),
            status: GoalStatus::Active,
            created_at: 1000,
            updated_at: 1000,
            sub_goals: vec![],
            artifacts: vec![],
        });

        let bytes = ckpt.to_bytes().unwrap();
        let restored = Checkpoint::from_bytes(&bytes).unwrap();

        assert_eq!(restored.id, "ckpt_1");
        assert_eq!(restored.session_history.len(), 2);
        assert_eq!(restored.active_goals.len(), 1);
        assert_eq!(restored.active_goals[0].description, "Test goal");
    }

    #[test]
    fn test_checkpoint_invalid_bytes() {
        let result = Checkpoint::from_bytes(b"not json");
        assert!(result.is_err());
    }

    #[test]
    fn test_checkpoint_estimate_size() {
        let mut ckpt = Checkpoint::new("ckpt_1", 1000);
        let base_size = ckpt.estimate_size();

        ckpt.session_history
            .push(ChatMessage::user("A longer message with more content"));
        let with_msg = ckpt.estimate_size();
        assert!(with_msg > base_size);
    }

    #[test]
    fn test_checkpoint_manager_save() {
        let mut mgr = CheckpointManager::new(5);
        let ckpt = Checkpoint::new("ckpt_1", 1000);
        let (id, data) = mgr.save(&ckpt).unwrap();
        assert_eq!(id, "ckpt_1");
        assert!(!data.is_empty());
        assert_eq!(mgr.len(), 1);
    }

    #[test]
    fn test_checkpoint_manager_pruning() {
        let mut mgr = CheckpointManager::new(3);

        for i in 0..5 {
            let ckpt = Checkpoint::new(format!("ckpt_{i}"), 1000 + i);
            mgr.save(&ckpt).unwrap();
        }

        assert_eq!(mgr.len(), 3);
        assert_eq!(mgr.list()[0].id, "ckpt_2"); // Oldest two pruned
    }

    #[test]
    fn test_checkpoint_manager_latest() {
        let mut mgr = CheckpointManager::new(10);
        assert!(mgr.latest().is_none());

        mgr.save(&Checkpoint::new("a", 100)).unwrap();
        mgr.save(&Checkpoint::new("b", 200)).unwrap();

        assert_eq!(mgr.latest().unwrap().id, "b");
    }

    #[test]
    fn test_checkpoint_manager_next_id() {
        let mut mgr = CheckpointManager::new(10);
        assert_eq!(mgr.next_id(), "ckpt_1");
        assert_eq!(mgr.next_id(), "ckpt_2");
        assert_eq!(mgr.next_id(), "ckpt_3");
    }
}
