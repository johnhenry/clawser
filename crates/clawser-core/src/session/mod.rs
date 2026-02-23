use serde::{Deserialize, Serialize};

use crate::providers::{ChatMessage, Role};

/// A conversation session with history management.
#[derive(Debug, Serialize, Deserialize)]
pub struct Session {
    pub id: String,
    pub created_at: i64,
    pub last_activity: i64,
    pub idle_timeout_secs: u64,
    messages: Vec<ChatMessage>,
    compaction_keep_recent: usize,
}

impl Session {
    pub fn new(id: impl Into<String>, now: i64, idle_timeout_secs: u64) -> Self {
        Self {
            id: id.into(),
            created_at: now,
            last_activity: now,
            idle_timeout_secs,
            messages: Vec::new(),
            compaction_keep_recent: 20,
        }
    }

    pub fn with_compaction_keep_recent(mut self, n: usize) -> Self {
        self.compaction_keep_recent = n;
        self
    }

    /// Add a message to the session.
    pub fn push(&mut self, message: ChatMessage, now: i64) {
        self.messages.push(message);
        self.last_activity = now;
    }

    /// Get all messages.
    pub fn messages(&self) -> &[ChatMessage] {
        &self.messages
    }

    /// Get message count.
    pub fn len(&self) -> usize {
        self.messages.len()
    }

    pub fn is_empty(&self) -> bool {
        self.messages.is_empty()
    }

    /// Check if session has timed out.
    pub fn is_expired(&self, now: i64) -> bool {
        (now - self.last_activity) as u64 > self.idle_timeout_secs
    }

    /// Touch the session to update last activity.
    pub fn touch(&mut self, now: i64) {
        self.last_activity = now;
    }

    /// Compact old messages into a summary, keeping recent ones.
    /// Returns the messages that were compacted (for summarization).
    pub fn compact(&mut self) -> Vec<ChatMessage> {
        if self.messages.len() <= self.compaction_keep_recent {
            return Vec::new();
        }

        // Find system messages (keep them)
        let system_messages: Vec<ChatMessage> = self
            .messages
            .iter()
            .filter(|m| m.role == Role::System)
            .cloned()
            .collect();

        // Non-system messages
        let non_system: Vec<ChatMessage> = self
            .messages
            .iter()
            .filter(|m| m.role != Role::System)
            .cloned()
            .collect();

        if non_system.len() <= self.compaction_keep_recent {
            return Vec::new();
        }

        let split_at = non_system.len() - self.compaction_keep_recent;
        let to_compact = non_system[..split_at].to_vec();
        let to_keep = non_system[split_at..].to_vec();

        // Rebuild messages: system + kept
        self.messages = system_messages;
        self.messages.extend(to_keep);

        to_compact
    }

    /// Insert a summary message at the beginning (after system messages).
    pub fn insert_summary(&mut self, summary: &str) {
        let insert_pos = self
            .messages
            .iter()
            .position(|m| m.role != Role::System)
            .unwrap_or(self.messages.len());

        self.messages.insert(
            insert_pos,
            ChatMessage::assistant(format!("[Previous conversation summary]: {summary}")),
        );
    }

    /// Replace all messages (used after checkpoint restore).
    pub fn replace_messages(&mut self, messages: Vec<ChatMessage>) {
        self.messages = messages;
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_session_creation() {
        let session = Session::new("sess_1", 1000, 1800);
        assert_eq!(session.id, "sess_1");
        assert_eq!(session.created_at, 1000);
        assert_eq!(session.last_activity, 1000);
        assert!(session.is_empty());
    }

    #[test]
    fn test_session_push() {
        let mut session = Session::new("s1", 1000, 1800);
        session.push(ChatMessage::user("Hello"), 1001);
        assert_eq!(session.len(), 1);
        assert_eq!(session.last_activity, 1001);
    }

    #[test]
    fn test_session_expired() {
        let session = Session::new("s1", 1000, 60);
        assert!(!session.is_expired(1050));
        assert!(session.is_expired(1061));
    }

    #[test]
    fn test_session_touch() {
        let mut session = Session::new("s1", 1000, 60);
        session.touch(1050);
        assert_eq!(session.last_activity, 1050);
        assert!(!session.is_expired(1100));
    }

    #[test]
    fn test_session_compact_below_threshold() {
        let mut session = Session::new("s1", 1000, 1800)
            .with_compaction_keep_recent(5);

        for i in 0..3 {
            session.push(ChatMessage::user(format!("msg {i}")), 1000 + i as i64);
        }

        let compacted = session.compact();
        assert!(compacted.is_empty());
        assert_eq!(session.len(), 3);
    }

    #[test]
    fn test_session_compact_above_threshold() {
        let mut session = Session::new("s1", 1000, 1800)
            .with_compaction_keep_recent(3);

        session.push(ChatMessage::system("System prompt"), 1000);
        for i in 0..8 {
            session.push(ChatMessage::user(format!("msg {i}")), 1001 + i as i64);
        }

        // 1 system + 8 user = 9 total, keep_recent=3 non-system
        let compacted = session.compact();
        assert_eq!(compacted.len(), 5); // 8 - 3 = 5 compacted

        // Remaining: 1 system + 3 recent
        assert_eq!(session.len(), 4);
        assert_eq!(session.messages()[0].role, Role::System);
    }

    #[test]
    fn test_session_insert_summary() {
        let mut session = Session::new("s1", 1000, 1800);
        session.push(ChatMessage::system("You are helpful"), 1000);
        session.push(ChatMessage::user("Latest message"), 1001);

        session.insert_summary("Previously discussed weather");

        assert_eq!(session.len(), 3);
        assert_eq!(session.messages()[0].role, Role::System);
        assert_eq!(session.messages()[1].role, Role::Assistant);
        assert!(session.messages()[1].content.contains("summary"));
        assert_eq!(session.messages()[2].role, Role::User);
    }

    #[test]
    fn test_session_insert_summary_no_system() {
        let mut session = Session::new("s1", 1000, 1800);
        session.push(ChatMessage::user("Hello"), 1001);

        session.insert_summary("Earlier chat");
        assert_eq!(session.len(), 2);
        assert_eq!(session.messages()[0].role, Role::Assistant); // Summary first
        assert_eq!(session.messages()[1].role, Role::User);
    }

    #[test]
    fn test_session_replace_messages() {
        let mut session = Session::new("s1", 1000, 1800);
        session.push(ChatMessage::user("old"), 1000);

        let new_msgs = vec![
            ChatMessage::system("sys"),
            ChatMessage::user("new"),
            ChatMessage::assistant("response"),
        ];
        session.replace_messages(new_msgs);
        assert_eq!(session.len(), 3);
        assert_eq!(session.messages()[0].role, Role::System);
    }

    #[test]
    fn test_session_compact_preserves_system_messages() {
        let mut session = Session::new("s1", 1000, 1800)
            .with_compaction_keep_recent(2);

        session.push(ChatMessage::system("Important system instruction"), 1000);
        for i in 0..5 {
            session.push(ChatMessage::user(format!("msg {i}")), 1001 + i as i64);
        }

        let _compacted = session.compact();

        // System message should be preserved
        assert!(session.messages().iter().any(|m| m.role == Role::System));
        assert_eq!(session.messages()[0].role, Role::System);
    }
}
