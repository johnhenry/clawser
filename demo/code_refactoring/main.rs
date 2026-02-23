//! # Scenario 2: Long-Running Code Refactoring
//!
//! **Actor**: Developer migrating auth from sessions to JWT
//! **Duration**: Multi-day (simulated across checkpoint/restore cycles)
//! **Goal**: Plan and execute staged migration with workspace artifacts
//!
//! Demonstrates:
//! - Multi-phase goal with sub-goals
//! - Git operations (branch, commit) via tool calls
//! - Checkpoint mid-migration → browser close → restore → continue
//! - Workspace artifact creation (migration plan, patches)
//! - Agent reading codebase files

use clawser_core::agent::{Agent, StepResult};
use clawser_core::checkpoint::{Checkpoint, CheckpointManager};
use clawser_core::config::AgentConfig;
use clawser_core::git::{DiffStatus, FileStatus, GitCommit, GitDiffEntry, GitStatusEntry};
use clawser_core::memory::{InMemoryBackend, Memory, MemoryCategory, MemoryEntry, RecallOptions};
use clawser_core::providers::{ChatResponse, MockProvider, ToolCall, TokenUsage};
use clawser_core::tools::{MockTool, ToolRegistry, ToolResult};

fn sep(title: &str) {
    println!("\n{}", "=".repeat(60));
    println!("  {title}");
    println!("{}\n", "=".repeat(60));
}

fn main() {
    println!("==========================================================");
    println!("  SCENARIO 2: Long-Running Code Refactoring");
    println!("  Simulating multi-day auth migration: sessions -> JWT");
    println!("==========================================================\n");

    let mut memory = InMemoryBackend::new();
    let mut checkpoint_mgr = CheckpointManager::new(10);

    let config = AgentConfig {
        max_tool_iterations: 15,
        ..AgentConfig::default()
    };
    let mut agent = Agent::new(config);
    agent.set_system_prompt(
        "You are a code refactoring assistant. Plan staged migrations, \
         create branches per phase, commit with descriptive messages.",
    );

    let mut tools = ToolRegistry::new();
    tools.register(Box::new(MockTool::new("file_read", ToolResult::success(
        "// auth.js\nfunction login(req, res) {\n  req.session.user = user;\n  res.redirect('/');\n}"
    ))));
    tools.register(Box::new(MockTool::new("file_write", ToolResult::success("Written"))));
    tools.register(Box::new(MockTool::new("git_commit", ToolResult::success("Committed: abc123"))));
    tools.register(Box::new(MockTool::new("git_branch", ToolResult::success("Branch created: jwt-migration"))));

    // ── DAY 1: Analysis & Planning ──────────────────────────────
    sep("DAY 1: Codebase analysis + migration plan");

    let goal_id = agent.add_goal(
        "Migrate authentication from express-session to JWT tokens",
        1000,
    );

    // Agent reads the codebase
    let provider = MockProvider::new("refactor-planner")
        .with_response(ChatResponse {
            content: String::new(),
            tool_calls: vec![ToolCall {
                id: "tc_read".to_string(),
                name: "file_read".to_string(),
                arguments: r#"{"path": "/workspace/src/auth.js"}"#.to_string(),
            }],
            usage: TokenUsage { input_tokens: 200, output_tokens: 40 },
            model: "mock".to_string(),
            reasoning_content: None,
        })
        .with_response(ChatResponse {
            content: "I've analyzed the codebase. Here's the migration plan:\n\
                      Phase 1: Add JWT token generation utility\n\
                      Phase 2: Replace session writes with token issuance\n\
                      Phase 3: Add middleware for token verification\n\
                      Phase 4: Remove session dependencies\n\
                      Phase 5: Update tests".to_string(),
            tool_calls: vec![],
            usage: TokenUsage { input_tokens: 400, output_tokens: 150 },
            model: "mock".to_string(),
            reasoning_content: None,
        });

    agent.on_message("Migrate this project's auth from sessions to JWT");
    let result = agent.step(&provider, &tools);
    assert!(matches!(result, StepResult::ToolCalls(_)));
    println!("[Agent] Reading codebase via file_read");
    agent.execute_tools(&tools);
    let _result = agent.step(&provider, &tools);
    let result = agent.step(&provider, &tools);
    if let StepResult::Response(text) = &result {
        println!("[Agent] {text}");
    }

    // Store migration plan in memory
    memory.store(MemoryEntry {
        id: String::new(),
        key: "migration_plan".to_string(),
        content: "JWT Migration: 5 phases – token gen, replace sessions, middleware, cleanup, tests".to_string(),
        category: MemoryCategory::Core,
        timestamp: 1000,
        session_id: None, score: None, embedding: None,
    }).unwrap();

    // Simulate creating the plan artifact
    let plan = "# JWT Migration Plan\n\n\
                ## Phase 1: Token Generation (Day 1)\n\
                - Add jsonwebtoken dependency\n\
                - Create src/jwt.js with sign/verify functions\n\n\
                ## Phase 2: Replace Sessions (Day 2)\n\
                - Update login() to issue JWT\n\
                - Update logout() to clear token\n\n\
                ## Phase 3: Verification Middleware (Day 2)\n\
                - Create authMiddleware.js\n\
                - Apply to protected routes\n\n\
                ## Phase 4: Remove Sessions (Day 3)\n\
                - Remove express-session dependency\n\
                - Remove session config\n\n\
                ## Phase 5: Update Tests (Day 3)\n\
                - Rewrite auth tests for JWT flow\n";
    println!("[Artifact] jwt-migration-plan.md ({} chars)", plan.len());
    assert!(plan.contains("Phase 1"));
    assert!(plan.contains("Phase 5"));

    // Checkpoint after day 1
    let mut ckpt1 = Checkpoint::new(checkpoint_mgr.next_id(), 1000);
    ckpt1.session_history = agent.history.clone();
    ckpt1.active_goals = agent.goals.clone();
    let (id, data1) = checkpoint_mgr.save(&ckpt1).unwrap();
    println!("[Checkpoint] Day 1 saved: {id}");

    // ── DAY 2: Execute Phases 1-3 ───────────────────────────────
    sep("DAY 2: Execute phases 1-3 (token gen, replace sessions, middleware)");

    // Simulate browser closed overnight, restore from checkpoint
    let restored = Checkpoint::from_bytes(&data1).unwrap();
    println!("[Restore] Resumed from checkpoint, {} messages in history", restored.session_history.len());
    assert!(!restored.active_goals.is_empty());

    // Phase 1: Create JWT utility
    memory.store(MemoryEntry {
        id: String::new(),
        key: "phase1_complete".to_string(),
        content: "Phase 1 done: created src/jwt.js with sign() and verify() using HS256".to_string(),
        category: MemoryCategory::Core,
        timestamp: 2000,
        session_id: None, score: None, embedding: None,
    }).unwrap();

    let commit1 = GitCommit {
        hash: "a1b2c3d".to_string(),
        message: "feat(auth): add JWT token generation utility".to_string(),
        author: "Clawser Agent".to_string(),
        timestamp: 2000,
    };
    println!("[Git] Commit: {} – {}", commit1.hash, commit1.message);

    // Phase 2: Replace sessions
    memory.store(MemoryEntry {
        id: String::new(),
        key: "phase2_complete".to_string(),
        content: "Phase 2 done: login() now issues JWT, logout() clears httpOnly cookie".to_string(),
        category: MemoryCategory::Core,
        timestamp: 2100,
        session_id: None, score: None, embedding: None,
    }).unwrap();

    let commit2 = GitCommit {
        hash: "e4f5g6h".to_string(),
        message: "refactor(auth): replace session writes with JWT issuance".to_string(),
        author: "Clawser Agent".to_string(),
        timestamp: 2100,
    };
    println!("[Git] Commit: {} – {}", commit2.hash, commit2.message);

    // Phase 3: Middleware
    memory.store(MemoryEntry {
        id: String::new(),
        key: "phase3_complete".to_string(),
        content: "Phase 3 done: authMiddleware.js verifies JWT on protected routes".to_string(),
        category: MemoryCategory::Core,
        timestamp: 2200,
        session_id: None, score: None, embedding: None,
    }).unwrap();

    let commit3 = GitCommit {
        hash: "i7j8k9l".to_string(),
        message: "feat(auth): add JWT verification middleware".to_string(),
        author: "Clawser Agent".to_string(),
        timestamp: 2200,
    };
    println!("[Git] Commit: {} – {}", commit3.hash, commit3.message);

    // Checkpoint mid-migration
    let mut ckpt2 = Checkpoint::new(checkpoint_mgr.next_id(), 2200);
    ckpt2.active_goals = agent.goals.clone();
    let (id2, _data2) = checkpoint_mgr.save(&ckpt2).unwrap();
    println!("[Checkpoint] Day 2 saved: {id2} (mid-migration, phases 1-3 done)");

    // ── DAY 3: Execute Phases 4-5 + Complete ────────────────────
    sep("DAY 3: Complete migration (cleanup + tests)");

    // Verify we can recall the migration progress
    let progress = memory.recall("phase", &RecallOptions::new().with_limit(10)).unwrap();
    println!("[Memory] Migration progress: {} phases tracked", progress.len());
    assert!(progress.len() >= 3, "Should have phases 1-3");

    // Phase 4: Remove sessions
    let diff_entry = GitDiffEntry {
        path: "package.json".to_string(),
        status: DiffStatus::Modified,
        additions: 0,
        deletions: 2,
    };
    println!("[Git] Diff: {} – {:?} (+{}, -{})", diff_entry.path, diff_entry.status, diff_entry.additions, diff_entry.deletions);

    // Phase 5: Update tests
    let status_entries = vec![
        GitStatusEntry { path: "tests/auth.test.js".to_string(), status: FileStatus::Modified },
        GitStatusEntry { path: "tests/jwt.test.js".to_string(), status: FileStatus::Untracked },
    ];
    for entry in &status_entries {
        println!("[Git] Status: {} – {:?}", entry.path, entry.status);
    }

    // Complete the goal
    assert!(agent.complete_goal(&goal_id, 3000));
    println!("[Goal] JWT migration completed!");

    // Generate summary artifact
    let _summary = "# JWT Migration Summary\n\n\
                   ## Commits\n\
                   - a1b2c3d: feat(auth): add JWT token generation utility\n\
                   - e4f5g6h: refactor(auth): replace session writes with JWT issuance\n\
                   - i7j8k9l: feat(auth): add JWT verification middleware\n\
                   - m0n1o2p: chore(auth): remove express-session dependency\n\
                   - q3r4s5t: test(auth): rewrite auth tests for JWT flow\n\n\
                   ## Files Changed: 8\n\
                   ## Lines Added: 142\n\
                   ## Lines Removed: 87\n";
    println!("[Artifact] jwt-migration-summary.md generated");

    sep("SUMMARY");
    println!("  Demonstrated capabilities:");
    println!("  [x] Multi-phase goal with staged execution");
    println!("  [x] Codebase reading via file_read tool");
    println!("  [x] Git commits per migration phase");
    println!("  [x] Checkpoint after day 1, restore on day 2");
    println!("  [x] Memory tracks phase completion across days");
    println!("  [x] Workspace artifacts (plan + summary)");
    println!("  [x] Git diff/status tracking");
    println!("  [x] Goal completion after 3-day migration");
    println!("\n  All assertions passed!\n");
}
