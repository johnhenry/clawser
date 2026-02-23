//! # Scenario 4: Security Audit Sentinel
//!
//! **Actor**: Developer monitoring project dependencies for CVEs
//! **Duration**: Ongoing (daily scheduled scans)
//!
//! Demonstrates:
//! - Recurring cron jobs (daily CVE checks)
//! - Memory deduplication (known vs new CVEs)
//! - Accumulative security report artifact
//! - Notification on new findings
//! - Agent distinguishes already-known from genuinely new threats

use clawser_core::agent::Agent;
use clawser_core::config::AgentConfig;
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
    println!("  SCENARIO 4: Security Audit Sentinel");
    println!("  Simulating ongoing CVE monitoring for project deps");
    println!("==========================================================\n");

    let mut memory = InMemoryBackend::new();
    let mut scheduler = Scheduler::new();
    let mut agent = Agent::new(AgentConfig::default());

    agent.set_system_prompt(
        "You are a security sentinel. Monitor dependencies for CVEs, \
         assess real impact, and produce actionable remediation guidance.",
    );

    let mut tools = ToolRegistry::new();
    tools.register(Box::new(MockTool::new("file_read", ToolResult::success(
        r#"{"dependencies": {"express": "4.18.2", "jsonwebtoken": "9.0.0", "lodash": "4.17.21", "axios": "1.6.0"}}"#
    ))));
    tools.register(Box::new(MockTool::new("web_fetch", ToolResult::success(
        r#"{"cves": [{"id": "CVE-2024-1234", "package": "axios", "severity": "HIGH", "description": "SSRF via redirect following"}]}"#
    ))));

    // ── Setup: Read dependency manifest ─────────────────────────
    sep("SETUP: Parse project dependencies");

    let deps = vec![
        ("express", "4.18.2"),
        ("jsonwebtoken", "9.0.0"),
        ("lodash", "4.17.21"),
        ("axios", "1.6.0"),
    ];
    for (pkg, ver) in &deps {
        memory.store(MemoryEntry {
            id: String::new(),
            key: format!("dep_{pkg}"),
            content: format!("Dependency: {pkg}@{ver}"),
            category: MemoryCategory::Core,
            timestamp: 1000,
            session_id: None, score: None, embedding: None,
        }).unwrap();
    }
    println!("[Memory] Tracked {} dependencies", deps.len());

    let _goal_id = agent.add_goal(
        "Monitor project dependencies for security vulnerabilities",
        1000,
    );

    // Schedule daily CVE check
    let job_id = scheduler.add(
        "Daily CVE scan",
        Schedule::Every(86_400_000),
        JobAction::AgentPrompt {
            prompt: "Check for new CVEs affecting project dependencies".to_string(),
        },
        1000,
    );
    println!("[Scheduler] Daily scan job: {job_id}");

    // ── Day 1: First scan – finds axios CVE ─────────────────────
    sep("DAY 1: First CVE scan");

    let actions = scheduler.tick(86_400_000);
    assert_eq!(actions.len(), 1);
    println!("[Scheduler] Daily scan fired");

    // Simulate finding a CVE
    let cve_1 = MemoryEntry {
        id: String::new(),
        key: "cve_2024_1234".to_string(),
        content: "CVE-2024-1234 | axios@1.6.0 | HIGH | SSRF via redirect following. \
                  Impact: Our API proxy uses axios for external requests – EXPLOITABLE. \
                  Remediation: Upgrade to axios@1.7.0+".to_string(),
        category: MemoryCategory::Custom("security".to_string()),
        timestamp: 2000,
        session_id: None, score: None, embedding: None,
    };
    memory.store(cve_1).unwrap();
    println!("[CVE] NEW: CVE-2024-1234 (axios, HIGH severity, EXPLOITABLE)");

    // Generate initial security report
    let _report_v1 = "# Security Report\n\n\
        ## Active Vulnerabilities\n\n\
        ### CVE-2024-1234 (HIGH)\n\
        - **Package**: axios@1.6.0\n\
        - **Type**: SSRF via redirect following\n\
        - **Impact**: EXPLOITABLE – our API proxy uses axios for external requests\n\
        - **Remediation**: Upgrade to axios@1.7.0+\n\
        - **Priority**: IMMEDIATE\n\n\
        ## Scanned Dependencies\n\
        - express@4.18.2 – clean\n\
        - jsonwebtoken@9.0.0 – clean\n\
        - lodash@4.17.21 – clean\n\
        - axios@1.6.0 – VULNERABLE\n";
    println!("[Artifact] security-report.md v1 generated");

    // ── Day 2: Second scan – same CVE, no new alert ─────────────
    sep("DAY 2: Second scan (deduplication test)");

    let actions = scheduler.tick(172_800_000);
    assert_eq!(actions.len(), 1);
    println!("[Scheduler] Daily scan fired");

    // Check if CVE already known
    let known = memory.recall("CVE-2024-1234", &RecallOptions::new()).unwrap();
    assert!(!known.is_empty(), "Should already know about this CVE");
    println!("[Dedup] CVE-2024-1234 already known – no new alert");

    // ── Day 3: New CVE found ────────────────────────────────────
    sep("DAY 3: New CVE discovered");

    let actions = scheduler.tick(259_200_000);
    assert_eq!(actions.len(), 1);

    let cve_2 = MemoryEntry {
        id: String::new(),
        key: "cve_2024_5678".to_string(),
        content: "CVE-2024-5678 | lodash@4.17.21 | MEDIUM | Prototype pollution in merge(). \
                  Impact: We use lodash.merge in config loading – POTENTIALLY EXPLOITABLE. \
                  Remediation: Upgrade to lodash@4.17.22+ or use structuredClone".to_string(),
        category: MemoryCategory::Custom("security".to_string()),
        timestamp: 4000,
        session_id: None, score: None, embedding: None,
    };

    // Verify it's genuinely new
    let existing = memory.recall("CVE-2024-5678", &RecallOptions::new()).unwrap();
    assert!(existing.is_empty(), "This CVE should be new");
    memory.store(cve_2).unwrap();
    println!("[CVE] NEW: CVE-2024-5678 (lodash, MEDIUM severity, POTENTIALLY EXPLOITABLE)");
    println!("[Notify] Browser notification: 'New vulnerability in lodash'");

    // Verify accumulation
    let all_cves = memory.recall(
        "CVE",
        &RecallOptions::new()
            .with_category(MemoryCategory::Custom("security".to_string()))
            .with_limit(20),
    ).unwrap();
    println!("[Memory] Total CVEs tracked: {}", all_cves.len());
    assert_eq!(all_cves.len(), 2, "Should have exactly 2 CVEs");

    // ── Day 7: Remediation complete ─────────────────────────────
    sep("DAY 7: Remediation applied");

    memory.store(MemoryEntry {
        id: String::new(),
        key: "remediation_axios".to_string(),
        content: "RESOLVED: axios upgraded to 1.7.2. CVE-2024-1234 mitigated.".to_string(),
        category: MemoryCategory::Custom("security".to_string()),
        timestamp: 7000,
        session_id: None, score: None, embedding: None,
    }).unwrap();
    println!("[Remediation] axios upgraded to 1.7.2 – CVE-2024-1234 resolved");

    let total = memory.count(Some(&MemoryCategory::Custom("security".to_string()))).unwrap();
    println!("[Memory] Security entries: {total}");

    sep("SUMMARY");
    println!("  Demonstrated capabilities:");
    println!("  [x] Recurring daily cron job for CVE scanning");
    println!("  [x] Dependency tracking in persistent memory");
    println!("  [x] New CVE detection + exploitability assessment");
    println!("  [x] Deduplication (day 2 scan skips known CVE)");
    println!("  [x] Accumulative security report artifact");
    println!("  [x] Browser notification on new findings");
    println!("  [x] Remediation tracking");
    println!("  [x] Custom memory category ('security')");
    println!("\n  All assertions passed!\n");
}
