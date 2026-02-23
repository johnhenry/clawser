use serde::{Deserialize, Serialize};

/// Category for classifying memory entries.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum MemoryCategory {
    Core,
    Daily,
    Conversation,
    Custom(String),
}

impl std::fmt::Display for MemoryCategory {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            MemoryCategory::Core => write!(f, "core"),
            MemoryCategory::Daily => write!(f, "daily"),
            MemoryCategory::Conversation => write!(f, "conversation"),
            MemoryCategory::Custom(name) => write!(f, "custom:{name}"),
        }
    }
}

/// A single memory entry.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MemoryEntry {
    pub id: String,
    pub key: String,
    pub content: String,
    pub category: MemoryCategory,
    pub timestamp: i64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub session_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub score: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub embedding: Option<Vec<f32>>,
}

/// Options for recalling memories.
#[derive(Debug, Clone, Default)]
pub struct RecallOptions {
    pub limit: usize,
    pub category: Option<MemoryCategory>,
    pub session_id: Option<String>,
    pub min_score: Option<f64>,
    pub vector_weight: Option<f64>,
    pub keyword_weight: Option<f64>,
}

impl RecallOptions {
    pub fn new() -> Self {
        Self {
            limit: 10,
            ..Default::default()
        }
    }

    pub fn with_limit(mut self, limit: usize) -> Self {
        self.limit = limit;
        self
    }

    pub fn with_category(mut self, category: MemoryCategory) -> Self {
        self.category = Some(category);
        self
    }

    pub fn effective_vector_weight(&self) -> f64 {
        self.vector_weight.unwrap_or(0.7)
    }

    pub fn effective_keyword_weight(&self) -> f64 {
        self.keyword_weight.unwrap_or(0.3)
    }
}

/// Errors from memory operations.
#[derive(Debug, thiserror::Error)]
pub enum MemoryError {
    #[error("storage error: {0}")]
    Storage(String),
    #[error("entry not found: {0}")]
    NotFound(String),
    #[error("embedding error: {0}")]
    Embedding(String),
    #[error("serialization error: {0}")]
    Serialization(String),
}

/// Trait that all memory backends must implement.
pub trait Memory: Send + Sync {
    fn store(&mut self, entry: MemoryEntry) -> Result<String, MemoryError>;
    fn recall(&self, query: &str, opts: &RecallOptions) -> Result<Vec<MemoryEntry>, MemoryError>;
    fn get(&self, id: &str) -> Result<Option<MemoryEntry>, MemoryError>;
    fn list(
        &self,
        category: Option<&MemoryCategory>,
        limit: usize,
    ) -> Result<Vec<MemoryEntry>, MemoryError>;
    fn forget(&mut self, id: &str) -> Result<bool, MemoryError>;
    fn count(&self, category: Option<&MemoryCategory>) -> Result<usize, MemoryError>;
    fn health_check(&self) -> Result<bool, MemoryError>;
}

/// In-memory implementation for testing and lightweight usage.
pub struct InMemoryBackend {
    entries: Vec<MemoryEntry>,
    next_id: u64,
}

impl InMemoryBackend {
    pub fn new() -> Self {
        Self {
            entries: Vec::new(),
            next_id: 1,
        }
    }
}

impl Default for InMemoryBackend {
    fn default() -> Self {
        Self::new()
    }
}

impl Memory for InMemoryBackend {
    fn store(&mut self, mut entry: MemoryEntry) -> Result<String, MemoryError> {
        if entry.id.is_empty() {
            entry.id = format!("mem_{}", self.next_id);
            self.next_id += 1;
        }
        let id = entry.id.clone();
        self.entries.push(entry);
        Ok(id)
    }

    fn recall(&self, query: &str, opts: &RecallOptions) -> Result<Vec<MemoryEntry>, MemoryError> {
        let query_lower = query.to_lowercase();
        let query_terms: Vec<&str> = query_lower.split_whitespace().collect();
        let empty_query = query_terms.is_empty();

        let mut results: Vec<MemoryEntry> = self
            .entries
            .iter()
            .filter(|e| {
                if let Some(ref cat) = opts.category {
                    if &e.category != cat {
                        return false;
                    }
                }
                if let Some(ref sid) = opts.session_id {
                    if e.session_id.as_ref() != Some(sid) {
                        return false;
                    }
                }
                // Empty query returns all entries (matching category/session filters)
                if empty_query {
                    return true;
                }
                // Word-level keyword matching: entry must contain at least one query term
                let content_lower = e.content.to_lowercase();
                let key_lower = e.key.to_lowercase();
                query_terms.iter().any(|term| {
                    content_lower.contains(term) || key_lower.contains(term)
                })
            })
            .cloned()
            .map(|mut e| {
                if empty_query {
                    e.score = Some(1.0);
                    return e;
                }
                // Score by number of matching query terms + bonus for key matches
                let content_lower = e.content.to_lowercase();
                let key_lower = e.key.to_lowercase();
                let mut score = 0.0_f64;
                for term in &query_terms {
                    score += content_lower.matches(term).count() as f64;
                    score += key_lower.matches(term).count() as f64 * 2.0;
                }
                e.score = Some(score);
                e
            })
            .collect();

        // Filter by min_score
        if let Some(min) = opts.min_score {
            results.retain(|e| e.score.unwrap_or(0.0) >= min);
        }

        // Sort by score descending
        results.sort_by(|a, b| {
            b.score
                .unwrap_or(0.0)
                .partial_cmp(&a.score.unwrap_or(0.0))
                .unwrap_or(std::cmp::Ordering::Equal)
        });

        let limit = if opts.limit > 0 { opts.limit } else { 10 };
        results.truncate(limit);
        Ok(results)
    }

    fn get(&self, id: &str) -> Result<Option<MemoryEntry>, MemoryError> {
        Ok(self.entries.iter().find(|e| e.id == id).cloned())
    }

    fn list(
        &self,
        category: Option<&MemoryCategory>,
        limit: usize,
    ) -> Result<Vec<MemoryEntry>, MemoryError> {
        let mut results: Vec<MemoryEntry> = self
            .entries
            .iter()
            .filter(|e| category.is_none_or(|cat| &e.category == cat))
            .cloned()
            .collect();
        results.sort_by(|a, b| b.timestamp.cmp(&a.timestamp));
        let effective_limit = if limit > 0 { limit } else { results.len() };
        results.truncate(effective_limit);
        Ok(results)
    }

    fn forget(&mut self, id: &str) -> Result<bool, MemoryError> {
        let before = self.entries.len();
        self.entries.retain(|e| e.id != id);
        Ok(self.entries.len() < before)
    }

    fn count(&self, category: Option<&MemoryCategory>) -> Result<usize, MemoryError> {
        Ok(self
            .entries
            .iter()
            .filter(|e| category.is_none_or(|cat| &e.category == cat))
            .count())
    }

    fn health_check(&self) -> Result<bool, MemoryError> {
        Ok(true)
    }
}

/// No-op memory backend that stores nothing.
pub struct NoopMemory;

impl Memory for NoopMemory {
    fn store(&mut self, entry: MemoryEntry) -> Result<String, MemoryError> {
        Ok(entry.id)
    }
    fn recall(&self, _query: &str, _opts: &RecallOptions) -> Result<Vec<MemoryEntry>, MemoryError> {
        Ok(vec![])
    }
    fn get(&self, _id: &str) -> Result<Option<MemoryEntry>, MemoryError> {
        Ok(None)
    }
    fn list(
        &self,
        _category: Option<&MemoryCategory>,
        _limit: usize,
    ) -> Result<Vec<MemoryEntry>, MemoryError> {
        Ok(vec![])
    }
    fn forget(&mut self, _id: &str) -> Result<bool, MemoryError> {
        Ok(false)
    }
    fn count(&self, _category: Option<&MemoryCategory>) -> Result<usize, MemoryError> {
        Ok(0)
    }
    fn health_check(&self) -> Result<bool, MemoryError> {
        Ok(true)
    }
}

/// Compute cosine similarity between two vectors.
pub fn cosine_similarity(a: &[f32], b: &[f32]) -> f64 {
    if a.len() != b.len() || a.is_empty() {
        return 0.0;
    }

    let mut dot = 0.0f64;
    let mut norm_a = 0.0f64;
    let mut norm_b = 0.0f64;

    for (x, y) in a.iter().zip(b.iter()) {
        let x = *x as f64;
        let y = *y as f64;
        dot += x * y;
        norm_a += x * x;
        norm_b += y * y;
    }

    let denom = norm_a.sqrt() * norm_b.sqrt();
    if denom == 0.0 {
        0.0
    } else {
        dot / denom
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn make_entry(key: &str, content: &str, category: MemoryCategory) -> MemoryEntry {
        MemoryEntry {
            id: String::new(),
            key: key.to_string(),
            content: content.to_string(),
            category,
            timestamp: 1000,
            session_id: None,
            score: None,
            embedding: None,
        }
    }

    #[test]
    fn test_memory_category_display() {
        assert_eq!(MemoryCategory::Core.to_string(), "core");
        assert_eq!(MemoryCategory::Daily.to_string(), "daily");
        assert_eq!(MemoryCategory::Conversation.to_string(), "conversation");
        assert_eq!(
            MemoryCategory::Custom("research".to_string()).to_string(),
            "custom:research"
        );
    }

    #[test]
    fn test_recall_options_defaults() {
        let opts = RecallOptions::new();
        assert_eq!(opts.limit, 10);
        assert_eq!(opts.effective_vector_weight(), 0.7);
        assert_eq!(opts.effective_keyword_weight(), 0.3);
    }

    #[test]
    fn test_in_memory_store_and_get() {
        let mut mem = InMemoryBackend::new();
        let entry = make_entry("user_name", "Alice", MemoryCategory::Core);
        let id = mem.store(entry).unwrap();

        let retrieved = mem.get(&id).unwrap().unwrap();
        assert_eq!(retrieved.key, "user_name");
        assert_eq!(retrieved.content, "Alice");
    }

    #[test]
    fn test_in_memory_store_assigns_id() {
        let mut mem = InMemoryBackend::new();
        let id1 = mem.store(make_entry("a", "b", MemoryCategory::Core)).unwrap();
        let id2 = mem.store(make_entry("c", "d", MemoryCategory::Core)).unwrap();
        assert_ne!(id1, id2);
        assert!(id1.starts_with("mem_"));
    }

    #[test]
    fn test_in_memory_recall() {
        let mut mem = InMemoryBackend::new();
        mem.store(make_entry("fact", "The sky is blue", MemoryCategory::Core)).unwrap();
        mem.store(make_entry("pref", "User likes red", MemoryCategory::Core)).unwrap();
        mem.store(make_entry("log", "Meeting at 3pm", MemoryCategory::Daily)).unwrap();

        let results = mem.recall("sky", &RecallOptions::new()).unwrap();
        assert_eq!(results.len(), 1);
        assert_eq!(results[0].key, "fact");
    }

    #[test]
    fn test_in_memory_recall_with_category_filter() {
        let mut mem = InMemoryBackend::new();
        mem.store(make_entry("a", "hello world", MemoryCategory::Core)).unwrap();
        mem.store(make_entry("b", "hello again", MemoryCategory::Daily)).unwrap();

        let opts = RecallOptions::new().with_category(MemoryCategory::Core);
        let results = mem.recall("hello", &opts).unwrap();
        assert_eq!(results.len(), 1);
        assert_eq!(results[0].key, "a");
    }

    #[test]
    fn test_in_memory_recall_with_limit() {
        let mut mem = InMemoryBackend::new();
        for i in 0..20 {
            mem.store(make_entry(&format!("k{i}"), &format!("content {i}"), MemoryCategory::Core))
                .unwrap();
        }

        let opts = RecallOptions::new().with_limit(5);
        let results = mem.recall("content", &opts).unwrap();
        assert_eq!(results.len(), 5);
    }

    #[test]
    fn test_in_memory_forget() {
        let mut mem = InMemoryBackend::new();
        let id = mem.store(make_entry("temp", "delete me", MemoryCategory::Daily)).unwrap();

        assert_eq!(mem.count(None).unwrap(), 1);
        assert!(mem.forget(&id).unwrap());
        assert_eq!(mem.count(None).unwrap(), 0);
        assert!(!mem.forget(&id).unwrap()); // already gone
    }

    #[test]
    fn test_in_memory_list() {
        let mut mem = InMemoryBackend::new();
        mem.store(make_entry("a", "core1", MemoryCategory::Core)).unwrap();
        mem.store(make_entry("b", "daily1", MemoryCategory::Daily)).unwrap();
        mem.store(make_entry("c", "core2", MemoryCategory::Core)).unwrap();

        let all = mem.list(None, 0).unwrap();
        assert_eq!(all.len(), 3);

        let core_only = mem.list(Some(&MemoryCategory::Core), 0).unwrap();
        assert_eq!(core_only.len(), 2);
    }

    #[test]
    fn test_in_memory_count() {
        let mut mem = InMemoryBackend::new();
        assert_eq!(mem.count(None).unwrap(), 0);

        mem.store(make_entry("a", "x", MemoryCategory::Core)).unwrap();
        mem.store(make_entry("b", "y", MemoryCategory::Daily)).unwrap();

        assert_eq!(mem.count(None).unwrap(), 2);
        assert_eq!(mem.count(Some(&MemoryCategory::Core)).unwrap(), 1);
        assert_eq!(mem.count(Some(&MemoryCategory::Daily)).unwrap(), 1);
        assert_eq!(mem.count(Some(&MemoryCategory::Conversation)).unwrap(), 0);
    }

    #[test]
    fn test_in_memory_health_check() {
        let mem = InMemoryBackend::new();
        assert!(mem.health_check().unwrap());
    }

    #[test]
    fn test_noop_memory() {
        let mut mem = NoopMemory;
        let id = mem.store(make_entry("k", "v", MemoryCategory::Core)).unwrap();
        assert!(id.is_empty()); // NoopMemory returns the entry's empty id
        assert!(mem.recall("anything", &RecallOptions::new()).unwrap().is_empty());
        assert!(mem.get("any_id").unwrap().is_none());
        assert!(mem.list(None, 10).unwrap().is_empty());
        assert!(!mem.forget("any").unwrap());
        assert_eq!(mem.count(None).unwrap(), 0);
        assert!(mem.health_check().unwrap());
    }

    #[test]
    fn test_cosine_similarity_identical() {
        let a = vec![1.0, 0.0, 0.0];
        let b = vec![1.0, 0.0, 0.0];
        let sim = cosine_similarity(&a, &b);
        assert!((sim - 1.0).abs() < 1e-10);
    }

    #[test]
    fn test_cosine_similarity_orthogonal() {
        let a = vec![1.0, 0.0];
        let b = vec![0.0, 1.0];
        let sim = cosine_similarity(&a, &b);
        assert!(sim.abs() < 1e-10);
    }

    #[test]
    fn test_cosine_similarity_opposite() {
        let a = vec![1.0, 0.0];
        let b = vec![-1.0, 0.0];
        let sim = cosine_similarity(&a, &b);
        assert!((sim - (-1.0)).abs() < 1e-10);
    }

    #[test]
    fn test_cosine_similarity_empty() {
        assert_eq!(cosine_similarity(&[], &[]), 0.0);
    }

    #[test]
    fn test_cosine_similarity_length_mismatch() {
        let a = vec![1.0, 2.0];
        let b = vec![1.0];
        assert_eq!(cosine_similarity(&a, &b), 0.0);
    }

    #[test]
    fn test_cosine_similarity_zero_vector() {
        let a = vec![0.0, 0.0];
        let b = vec![1.0, 0.0];
        assert_eq!(cosine_similarity(&a, &b), 0.0);
    }

    #[test]
    fn test_cosine_similarity_real_vectors() {
        // Similar vectors should have high similarity
        let a = vec![0.1, 0.2, 0.3, 0.4];
        let b = vec![0.15, 0.25, 0.35, 0.45];
        let sim = cosine_similarity(&a, &b);
        assert!(sim > 0.99); // Very similar

        // Different vectors should have lower similarity
        let c = vec![0.9, -0.1, 0.0, 0.1];
        let sim2 = cosine_similarity(&a, &c);
        assert!(sim2 < sim);
    }

    #[test]
    fn test_memory_entry_serialization() {
        let entry = MemoryEntry {
            id: "mem_1".to_string(),
            key: "fact".to_string(),
            content: "The sky is blue".to_string(),
            category: MemoryCategory::Core,
            timestamp: 1700000000,
            session_id: None,
            score: Some(0.95),
            embedding: None,
        };

        let json = serde_json::to_string(&entry).unwrap();
        let parsed: MemoryEntry = serde_json::from_str(&json).unwrap();
        assert_eq!(parsed.id, "mem_1");
        assert_eq!(parsed.category, MemoryCategory::Core);
        assert!(!json.contains("session_id")); // skip_serializing_if None
        assert!(!json.contains("embedding"));
    }

    #[test]
    fn test_recall_case_insensitive() {
        let mut mem = InMemoryBackend::new();
        mem.store(make_entry("k", "The SKY is Blue", MemoryCategory::Core)).unwrap();

        let results = mem.recall("sky", &RecallOptions::new()).unwrap();
        assert_eq!(results.len(), 1);

        let results = mem.recall("SKY", &RecallOptions::new()).unwrap();
        assert_eq!(results.len(), 1);
    }

    #[test]
    fn test_recall_matches_key_too() {
        let mut mem = InMemoryBackend::new();
        mem.store(make_entry("weather", "sunny today", MemoryCategory::Core)).unwrap();

        let results = mem.recall("weather", &RecallOptions::new()).unwrap();
        assert_eq!(results.len(), 1);
    }
}
