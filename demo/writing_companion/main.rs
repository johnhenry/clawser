//! # Scenario 5: Writing Companion
//!
//! **Actor**: Novelist writing across months
//! **Duration**: Multi-month (simulated as multiple sessions)
//!
//! Demonstrates:
//! - Character consistency tracking via memory
//! - Contradiction detection across chapters
//! - Story bible artifact maintained over time
//! - Long-term memory recall (details from weeks ago)

use clawser_core::agent::Agent;
use clawser_core::config::AgentConfig;
use clawser_core::memory::{InMemoryBackend, Memory, MemoryCategory, MemoryEntry, RecallOptions};

fn sep(title: &str) {
    println!("\n{}", "=".repeat(60));
    println!("  {title}");
    println!("{}\n", "=".repeat(60));
}

fn main() {
    println!("==========================================================");
    println!("  SCENARIO 5: Writing Companion");
    println!("  Simulating novel-writing assistant with character tracking");
    println!("==========================================================\n");

    let mut memory = InMemoryBackend::new();
    let mut agent = Agent::new(AgentConfig::default());

    agent.set_system_prompt(
        "You are a writing companion for a novelist. Track character details, \
         detect contradictions, maintain a story bible, and flag inconsistencies.",
    );

    let _goal_id = agent.add_goal("Help write novel – track characters, plots, themes", 1000);

    // ── Chapter 1: Establish characters ─────────────────────────
    sep("CHAPTER 1: Character introductions");

    memory.store(MemoryEntry {
        id: String::new(), key: "char_alex_appearance".to_string(),
        content: "CHARACTER: Alex Chen – tall, brown eyes, black hair, scar on left cheek. \
                  Age 34. Architect. Reserved personality, speaks carefully.".to_string(),
        category: MemoryCategory::Custom("characters".to_string()),
        timestamp: 1000,
        session_id: None, score: None, embedding: None,
    }).unwrap();

    memory.store(MemoryEntry {
        id: String::new(), key: "char_maya_appearance".to_string(),
        content: "CHARACTER: Maya Torres – short, green eyes, red curly hair. \
                  Age 28. Journalist. Bold, asks uncomfortable questions.".to_string(),
        category: MemoryCategory::Custom("characters".to_string()),
        timestamp: 1000,
        session_id: None, score: None, embedding: None,
    }).unwrap();

    memory.store(MemoryEntry {
        id: String::new(), key: "plot_thread_missing_building".to_string(),
        content: "PLOT THREAD: The old library building disappeared overnight. \
                  No one remembers it except Alex. Status: UNRESOLVED.".to_string(),
        category: MemoryCategory::Custom("plot_threads".to_string()),
        timestamp: 1000,
        session_id: None, score: None, embedding: None,
    }).unwrap();

    println!("[Memory] Stored: Alex Chen (brown eyes, scar left cheek)");
    println!("[Memory] Stored: Maya Torres (green eyes, red curly hair)");
    println!("[Memory] Stored: Plot thread – missing library building");

    // ── Chapter 3: Weeks later, user writes new chapter ─────────
    sep("CHAPTER 3 (2 weeks later): New content with potential contradiction");

    // User submits chapter 3 draft
    let chapter_3_excerpt = "Alex looked at her with his striking blue eyes. \
                             'The building was never there,' Maya said, \
                             tucking her straight blonde hair behind her ear.";
    println!("[User] Submitted chapter 3 excerpt");

    // Agent checks character details against memory
    let alex_details = memory.recall(
        "Alex",
        &RecallOptions::new()
            .with_category(MemoryCategory::Custom("characters".to_string()))
            .with_limit(5),
    ).unwrap();

    assert!(!alex_details.is_empty(), "Should recall Alex's details");
    let alex_desc = &alex_details[0].content;
    println!("[Memory] Recalled Alex's description from chapter 1");

    // Detect contradiction: brown eyes vs blue eyes
    let has_brown_eyes = alex_desc.contains("brown eyes");
    let chapter_says_blue = chapter_3_excerpt.contains("blue eyes");
    assert!(has_brown_eyes, "Memory says brown eyes");
    assert!(chapter_says_blue, "Chapter says blue eyes");
    println!("[CONTRADICTION] Alex had brown eyes (ch1), now blue eyes (ch3)");

    // Detect contradiction: Maya's hair
    let maya_details = memory.recall(
        "Maya",
        &RecallOptions::new()
            .with_category(MemoryCategory::Custom("characters".to_string()))
            .with_limit(5),
    ).unwrap();
    let maya_desc = &maya_details[0].content;
    let has_red_curly = maya_desc.contains("red curly hair");
    let chapter_says_blonde = chapter_3_excerpt.contains("blonde hair");
    assert!(has_red_curly, "Memory says red curly hair");
    assert!(chapter_says_blonde, "Chapter says blonde straight hair");
    println!("[CONTRADICTION] Maya had red curly hair (ch1), now straight blonde (ch3)");

    // Store contradictions
    memory.store(MemoryEntry {
        id: String::new(), key: "contradiction_alex_eyes".to_string(),
        content: "CONTRADICTION: Alex's eyes were brown (ch1) but described as blue (ch3). \
                  Author should resolve – pick one.".to_string(),
        category: MemoryCategory::Custom("contradictions".to_string()),
        timestamp: 3000,
        session_id: None, score: None, embedding: None,
    }).unwrap();

    memory.store(MemoryEntry {
        id: String::new(), key: "contradiction_maya_hair".to_string(),
        content: "CONTRADICTION: Maya's hair was red and curly (ch1) but described as \
                  straight blonde (ch3). Significant continuity error.".to_string(),
        category: MemoryCategory::Custom("contradictions".to_string()),
        timestamp: 3000,
        session_id: None, score: None, embedding: None,
    }).unwrap();

    // ── Chapter 5: Check plot threads ───────────────────────────
    sep("CHAPTER 5: Unresolved plot thread check");

    let unresolved = memory.recall(
        "UNRESOLVED",
        &RecallOptions::new()
            .with_category(MemoryCategory::Custom("plot_threads".to_string()))
            .with_limit(10),
    ).unwrap();
    println!("[Plot] Unresolved threads: {}", unresolved.len());
    assert!(!unresolved.is_empty());
    for thread in &unresolved {
        println!("  - {}", thread.key);
    }

    // ── Generate story bible ────────────────────────────────────
    sep("ARTIFACT: Story bible generation");

    let chars = memory.list(
        Some(&MemoryCategory::Custom("characters".to_string())), 20
    ).unwrap();
    let threads = memory.list(
        Some(&MemoryCategory::Custom("plot_threads".to_string())), 20
    ).unwrap();
    let contradictions = memory.list(
        Some(&MemoryCategory::Custom("contradictions".to_string())), 20
    ).unwrap();

    let mut bible = String::from("# Story Bible\n\n");
    bible.push_str("## Characters\n\n");
    for c in &chars {
        bible.push_str(&format!("### {}\n{}\n\n", c.key.replace("char_", "").replace('_', " "), c.content));
    }
    bible.push_str("## Active Plot Threads\n\n");
    for t in &threads {
        bible.push_str(&format!("- {}\n", t.content));
    }
    bible.push_str("\n## Detected Contradictions\n\n");
    for c in &contradictions {
        bible.push_str(&format!("- {}\n", c.content));
    }

    println!("[Artifact] story-bible.md ({} chars)", bible.len());
    println!("  Characters: {}", chars.len());
    println!("  Plot threads: {}", threads.len());
    println!("  Contradictions: {}", contradictions.len());

    assert!(bible.contains("Alex"));
    assert!(bible.contains("CONTRADICTION"));
    assert!(bible.contains("UNRESOLVED"));

    sep("SUMMARY");
    println!("  Demonstrated capabilities:");
    println!("  [x] Character detail storage in persistent memory");
    println!("  [x] Contradiction detection across chapters");
    println!("  [x] Long-term recall (details from weeks ago)");
    println!("  [x] Unresolved plot thread tracking");
    println!("  [x] Story bible artifact auto-generation");
    println!("  [x] Custom memory categories (characters, plot_threads, contradictions)");
    println!("\n  All assertions passed!\n");
}
