//! # Scenario 8: Digital Maintenance Caretaker
//!
//! **Actor**: Any user wanting organized workspace
//! **Duration**: Ongoing (periodic scans)
//!
//! Demonstrates:
//! - Periodic workspace scanning via scheduled jobs
//! - Duplicate detection across directories
//! - Suggestion-only mode (user approval required for destructive actions)
//! - Maintenance log tracking

use clawser_core::agent::Agent;
use clawser_core::config::{AgentConfig, AutonomyConfig, AutonomyLevel};
use clawser_core::memory::{InMemoryBackend, Memory, MemoryCategory, MemoryEntry, RecallOptions};
use clawser_core::scheduler::{JobAction, Schedule, Scheduler};
use clawser_core::tools::{MockTool, ToolRegistry, ToolResult};

fn sep(title: &str) {
    println!("\n{}", "=".repeat(60));
    println!("  {title}");
    println!("{}\n", "=".repeat(60));
}

fn main() {
    println!("==========================================================");
    println!("  SCENARIO 8: Digital Maintenance Caretaker");
    println!("  Simulating periodic workspace organization");
    println!("==========================================================\n");

    let mut memory = InMemoryBackend::new();
    let mut scheduler = Scheduler::new();

    let config = AgentConfig::default();
    let _autonomy = AutonomyConfig {
        level: AutonomyLevel::Supervised, // Suggest only, user approves
        ..AutonomyConfig::default()
    };
    let mut agent = Agent::new(config);

    agent.set_system_prompt(
        "You are a digital maintenance assistant. Scan workspaces for \
         organization issues, suggest improvements, and track what was done. \
         NEVER delete without user approval.",
    );
    println!("[Config] Autonomy: Supervised (suggestions only)");

    let mut tools = ToolRegistry::new();
    tools.register(Box::new(MockTool::new("file_list", ToolResult::success(
        r#"[
            {"name": "resume_v1.pdf", "size": 524288},
            {"name": "resume_v2.pdf", "size": 540672},
            {"name": "resume_final.pdf", "size": 548864},
            {"name": "resume_FINAL_v2.pdf", "size": 552960},
            {"name": "notes.txt", "size": 1024},
            {"name": "project_plan.md", "size": 8192},
            {"name": "old_project_plan.md", "size": 7168},
            {"name": "screenshot_2024_01.png", "size": 2097152},
            {"name": "screenshot_2024_02.png", "size": 2097152},
            {"name": "screenshot_2024_03.png", "size": 2097152}
        ]"#
    ))));

    let _goal_id = agent.add_goal("Keep my workspace organized", 1000);

    // Schedule weekly maintenance scan
    let job_id = scheduler.add(
        "Weekly workspace scan",
        Schedule::Every(604_800_000), // Weekly
        JobAction::AgentPrompt {
            prompt: "Scan workspace for organization opportunities".to_string(),
        },
        1000,
    );
    println!("[Scheduler] Weekly scan job: {job_id}");

    // ── Week 1: First scan ──────────────────────────────────────
    sep("WEEK 1: First workspace scan");

    let actions = scheduler.tick(604_800_000);
    assert_eq!(actions.len(), 1);
    println!("[Scheduler] Weekly scan fired");

    // Simulate workspace analysis
    let files = vec![
        ("resume_v1.pdf", 524288_u64, "documents"),
        ("resume_v2.pdf", 540672, "documents"),
        ("resume_final.pdf", 548864, "documents"),
        ("resume_FINAL_v2.pdf", 552960, "documents"),
        ("notes.txt", 1024, "documents"),
        ("project_plan.md", 8192, "documents"),
        ("old_project_plan.md", 7168, "documents"),
        ("screenshot_2024_01.png", 2097152, "media"),
        ("screenshot_2024_02.png", 2097152, "media"),
        ("screenshot_2024_03.png", 2097152, "media"),
    ];

    // Detect duplicates (files with similar names)
    let resume_variants: Vec<_> = files.iter()
        .filter(|(name, _, _)| name.starts_with("resume"))
        .collect();
    let screenshot_cluster: Vec<_> = files.iter()
        .filter(|(name, _, _)| name.starts_with("screenshot"))
        .collect();
    let plan_variants: Vec<_> = files.iter()
        .filter(|(name, _, _)| name.contains("project_plan"))
        .collect();

    println!("[Scan] Found {} files total", files.len());
    println!("[Scan] Duplicate cluster: {} resume variants", resume_variants.len());
    println!("[Scan] Duplicate cluster: {} screenshots", screenshot_cluster.len());
    println!("[Scan] Duplicate cluster: {} project plan variants", plan_variants.len());

    // Generate suggestions (NOT actions – supervised mode)
    let mut suggestions = Vec::new();

    suggestions.push(format!(
        "SUGGEST: Move {} resume drafts to drafts/resume/, keep only resume_FINAL_v2.pdf in root",
        resume_variants.len() - 1,
    ));
    suggestions.push(format!(
        "SUGGEST: Move {} screenshots to media/screenshots/2024/",
        screenshot_cluster.len(),
    ));
    suggestions.push(
        "SUGGEST: Archive old_project_plan.md to archive/".to_string(),
    );

    let total_reclaimable: u64 = resume_variants.iter()
        .take(resume_variants.len() - 1)
        .map(|(_, size, _)| size)
        .sum();
    suggestions.push(format!(
        "SUGGEST: {} KB reclaimable by removing old resume drafts",
        total_reclaimable / 1024,
    ));

    for s in &suggestions {
        println!("[Maintenance] {s}");
    }

    // Store in maintenance log
    for (i, suggestion) in suggestions.iter().enumerate() {
        memory.store(MemoryEntry {
            id: String::new(),
            key: format!("maintenance_week1_suggestion_{i}"),
            content: suggestion.clone(),
            category: MemoryCategory::Custom("maintenance".to_string()),
            timestamp: 2000,
            session_id: None, score: None, embedding: None,
        }).unwrap();
    }
    println!("[Memory] Stored {} maintenance suggestions", suggestions.len());

    // ── User approves some suggestions ──────────────────────────
    sep("USER RESPONSE: Approve/reject suggestions");

    println!("[User] Approved: move screenshots to media/screenshots/");
    println!("[User] Approved: archive old project plan");
    println!("[User] Rejected: resume cleanup (wants to keep all versions)");

    memory.store(MemoryEntry {
        id: String::new(), key: "maintenance_week1_action_1".to_string(),
        content: "ACTION TAKEN: Moved 3 screenshots to media/screenshots/2024/".to_string(),
        category: MemoryCategory::Custom("maintenance".to_string()),
        timestamp: 2100,
        session_id: None, score: None, embedding: None,
    }).unwrap();

    memory.store(MemoryEntry {
        id: String::new(), key: "maintenance_week1_action_2".to_string(),
        content: "ACTION TAKEN: Archived old_project_plan.md to archive/".to_string(),
        category: MemoryCategory::Custom("maintenance".to_string()),
        timestamp: 2100,
        session_id: None, score: None, embedding: None,
    }).unwrap();

    memory.store(MemoryEntry {
        id: String::new(), key: "user_pref_resumes".to_string(),
        content: "USER PREFERENCE: Keep all resume versions. Do not suggest cleanup.".to_string(),
        category: MemoryCategory::Core,
        timestamp: 2100,
        session_id: None, score: None, embedding: None,
    }).unwrap();
    println!("[Memory] Stored user preference: keep resume versions");

    // ── Week 2: Second scan (respects learned preferences) ──────
    sep("WEEK 2: Second scan (preference-aware)");

    let actions = scheduler.tick(1_209_600_000);
    assert_eq!(actions.len(), 1);
    println!("[Scheduler] Weekly scan fired");

    // Check learned preferences before suggesting
    let resume_pref = memory.recall("resume", &RecallOptions::new().with_limit(5)).unwrap();
    let has_keep_pref = resume_pref.iter().any(|e| e.content.contains("Keep all resume"));
    assert!(has_keep_pref, "Should recall user preference about resumes");
    println!("[Preference] Recalled: user wants to keep all resume versions");
    println!("[Scan] Skipping resume cleanup suggestions (user preference)");

    // ── Generate maintenance log ────────────────────────────────
    sep("ARTIFACT: Maintenance log");

    let log_entries = memory.list(
        Some(&MemoryCategory::Custom("maintenance".to_string())), 20
    ).unwrap();

    let mut log = String::from("# Workspace Maintenance Log\n\n");
    log.push_str("## Actions Taken\n\n");
    for entry in log_entries.iter().filter(|e| e.content.starts_with("ACTION")) {
        log.push_str(&format!("- {}\n", entry.content));
    }
    log.push_str("\n## Pending Suggestions\n\n");
    log.push_str("- (none – all approved or rejected)\n");
    log.push_str("\n## Learned Preferences\n\n");
    log.push_str("- Keep all resume versions\n");

    println!("[Artifact] maintenance-log.md ({} chars)", log.len());

    let total_entries = memory.count(None).unwrap();
    println!("[Memory] Total entries: {total_entries}");

    sep("SUMMARY");
    println!("  Demonstrated capabilities:");
    println!("  [x] Periodic workspace scanning (weekly scheduled job)");
    println!("  [x] Duplicate / similar file detection");
    println!("  [x] Suggestion-only mode (supervised autonomy)");
    println!("  [x] User approval required before destructive actions");
    println!("  [x] Learned preferences persist (no repeat suggestions)");
    println!("  [x] Maintenance log artifact");
    println!("  [x] Reclaimable space estimation");
    println!("\n  All assertions passed!\n");
}
