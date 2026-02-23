//! Git integration types for workspace versioning.
//! Actual git operations are performed by the host (isomorphic-git in JS).

use serde::{Deserialize, Serialize};

/// A git commit reference.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GitCommit {
    pub hash: String,
    pub message: String,
    pub author: String,
    pub timestamp: i64,
}

/// A git diff entry.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GitDiffEntry {
    pub path: String,
    pub status: DiffStatus,
    pub additions: u32,
    pub deletions: u32,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub enum DiffStatus {
    Added,
    Modified,
    Deleted,
    Renamed,
}

/// Request to perform a git operation.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "op")]
pub enum GitOperation {
    Init { path: String },
    Commit { path: String, message: String },
    Log { path: String, max_count: u32 },
    Diff { path: String },
    Checkout { path: String, ref_name: String },
    Branch { path: String, name: String },
    Status { path: String },
}

/// Result of a git operation.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum GitResult {
    Success { message: String },
    Commits(Vec<GitCommit>),
    Diff(Vec<GitDiffEntry>),
    Status(Vec<GitStatusEntry>),
    Error { message: String },
}

/// A file's git status.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GitStatusEntry {
    pub path: String,
    pub status: FileStatus,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub enum FileStatus {
    Untracked,
    Modified,
    Staged,
    Deleted,
    Unmodified,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_git_commit_serialization() {
        let commit = GitCommit {
            hash: "abc123def456".to_string(),
            message: "Initial commit".to_string(),
            author: "Agent <agent@clawser.local>".to_string(),
            timestamp: 1700000000,
        };
        let json = serde_json::to_string(&commit).unwrap();
        let parsed: GitCommit = serde_json::from_str(&json).unwrap();
        assert_eq!(parsed.hash, "abc123def456");
        assert_eq!(parsed.message, "Initial commit");
    }

    #[test]
    fn test_git_diff_entry() {
        let entry = GitDiffEntry {
            path: "src/main.rs".to_string(),
            status: DiffStatus::Modified,
            additions: 10,
            deletions: 3,
        };
        let json = serde_json::to_string(&entry).unwrap();
        let parsed: GitDiffEntry = serde_json::from_str(&json).unwrap();
        assert_eq!(parsed.status, DiffStatus::Modified);
    }

    #[test]
    fn test_git_operation_serialization() {
        let op = GitOperation::Commit {
            path: "/workspace".to_string(),
            message: "Goal: Research complete".to_string(),
        };
        let json = serde_json::to_string(&op).unwrap();
        assert!(json.contains("Commit"));
        assert!(json.contains("Research complete"));
    }

    #[test]
    fn test_git_result_variants() {
        let success = GitResult::Success {
            message: "ok".to_string(),
        };
        let json = serde_json::to_string(&success).unwrap();
        let parsed: GitResult = serde_json::from_str(&json).unwrap();
        assert!(matches!(parsed, GitResult::Success { .. }));

        let commits = GitResult::Commits(vec![GitCommit {
            hash: "abc".to_string(),
            message: "test".to_string(),
            author: "test".to_string(),
            timestamp: 1000,
        }]);
        let json = serde_json::to_string(&commits).unwrap();
        let parsed: GitResult = serde_json::from_str(&json).unwrap();
        assert!(matches!(parsed, GitResult::Commits(ref v) if v.len() == 1));
    }

    #[test]
    fn test_file_status() {
        let entry = GitStatusEntry {
            path: "new_file.txt".to_string(),
            status: FileStatus::Untracked,
        };
        let json = serde_json::to_string(&entry).unwrap();
        let parsed: GitStatusEntry = serde_json::from_str(&json).unwrap();
        assert_eq!(parsed.status, FileStatus::Untracked);
    }
}
