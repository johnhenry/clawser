//! # Scenario 7: Personal Research Lab
//!
//! **Actor**: Researcher investigating a hypothesis over months
//! **Duration**: Months (evidence accumulation)
//!
//! Demonstrates:
//! - Hypothesis revision based on new evidence
//! - Categorized evidence (pro/con/neutral)
//! - Evidence matrix artifact
//! - Gap identification
//! - Long-term memory synthesis

use clawser_core::agent::Agent;
use clawser_core::config::AgentConfig;
use clawser_core::memory::{InMemoryBackend, Memory, MemoryCategory, MemoryEntry};

fn sep(title: &str) {
    println!("\n{}", "=".repeat(60));
    println!("  {title}");
    println!("{}\n", "=".repeat(60));
}

fn main() {
    println!("==========================================================");
    println!("  SCENARIO 7: Personal Research Lab");
    println!("  Investigating: local AI runtimes vs cloud inference");
    println!("==========================================================\n");

    let mut memory = InMemoryBackend::new();
    let mut agent = Agent::new(AgentConfig::default());

    agent.set_system_prompt(
        "You are a research assistant. Maintain a lab notebook with \
         hypotheses, evidence, and revisions. Think scientifically.",
    );

    let _goal_id = agent.add_goal(
        "Research whether local AI runtimes can replace cloud inference for common tasks",
        1000,
    );

    // ── Initial hypothesis ──────────────────────────────────────
    sep("MONTH 1: Initial hypothesis");

    memory.store(MemoryEntry {
        id: String::new(), key: "hypothesis_v1".to_string(),
        content: "HYPOTHESIS v1: Local AI runtimes (WASM + quantized models) can replace \
                  cloud inference for 80%+ of common tasks with acceptable quality loss (<5%).".to_string(),
        category: MemoryCategory::Custom("hypotheses".to_string()),
        timestamp: 1000,
        session_id: None, score: None, embedding: None,
    }).unwrap();
    println!("[Hypothesis] v1: Local runtimes can replace cloud for 80%+ tasks");

    // ── Evidence collection: PRO ────────────────────────────────
    sep("MONTH 1-2: Collecting evidence");

    let evidence = vec![
        ("evidence_pro_1", "PRO", "Chrome AI (Gemini Nano) achieves 85% of GPT-4o quality \
          on text summarization benchmarks. Latency 10x lower. Source: Chrome AI blog."),
        ("evidence_pro_2", "PRO", "Llama-3-8B-Q4 runs at 15 tok/s on M1 MacBook, sufficient \
          for interactive use. Quality comparable to GPT-3.5. Source: personal benchmark."),
        ("evidence_con_1", "CON", "Complex multi-step reasoning (math, code generation) shows \
          40% quality drop on local models vs cloud. Source: HumanEval benchmark."),
        ("evidence_con_2", "CON", "WASM overhead adds 30% latency vs native execution. \
          Memory limited to 4GB in browser context. Source: wasm-bench suite."),
        ("evidence_neutral_1", "NEUTRAL", "WebGPU acceleration narrows the gap for compatible \
          hardware but excludes ~40% of devices. Adoption growing. Source: caniuse.com."),
        ("evidence_pro_3", "PRO", "Privacy benefit: no data leaves device. Compliance with \
          GDPR/HIPAA automatic. Significant business value. Source: enterprise survey."),
    ];

    for (key, category, content) in &evidence {
        memory.store(MemoryEntry {
            id: String::new(), key: key.to_string(),
            content: content.to_string(),
            category: MemoryCategory::Custom(format!("evidence_{}", category.to_lowercase())),
            timestamp: 2000,
            session_id: None, score: None, embedding: None,
        }).unwrap();
        println!("[Evidence] [{category}] {key}");
    }

    // ── Analysis: Build evidence matrix ─────────────────────────
    sep("MONTH 2: Evidence matrix synthesis");

    let pro = memory.list(Some(&MemoryCategory::Custom("evidence_pro".to_string())), 20).unwrap();
    let con = memory.list(Some(&MemoryCategory::Custom("evidence_con".to_string())), 20).unwrap();
    let neutral = memory.list(Some(&MemoryCategory::Custom("evidence_neutral".to_string())), 20).unwrap();

    println!("[Analysis] Evidence count: {} PRO, {} CON, {} NEUTRAL", pro.len(), con.len(), neutral.len());
    assert_eq!(pro.len(), 3);
    assert_eq!(con.len(), 2);
    assert_eq!(neutral.len(), 1);

    // Generate evidence matrix
    let mut matrix = String::from("# Evidence Matrix: Local vs Cloud AI\n\n");
    matrix.push_str("## Supporting Evidence (PRO)\n\n");
    for e in &pro {
        matrix.push_str(&format!("- {}\n", e.content));
    }
    matrix.push_str("\n## Contradicting Evidence (CON)\n\n");
    for e in &con {
        matrix.push_str(&format!("- {}\n", e.content));
    }
    matrix.push_str("\n## Neutral/Mixed Evidence\n\n");
    for e in &neutral {
        matrix.push_str(&format!("- {}\n", e.content));
    }
    println!("[Artifact] evidence-matrix.md ({} chars)", matrix.len());

    // ── Gap identification ──────────────────────────────────────
    sep("MONTH 2: Identifying research gaps");

    let gaps = vec![
        "No data on local model performance for RAG/retrieval tasks",
        "Missing: user satisfaction comparison (perceived quality vs benchmarks)",
        "No evidence on battery/power consumption impact on mobile devices",
    ];
    for gap in &gaps {
        memory.store(MemoryEntry {
            id: String::new(), key: format!("gap_{}", gap.split_whitespace().take(3).collect::<Vec<_>>().join("_").to_lowercase()),
            content: format!("RESEARCH GAP: {gap}"),
            category: MemoryCategory::Custom("gaps".to_string()),
            timestamp: 3000,
            session_id: None, score: None, embedding: None,
        }).unwrap();
        println!("[Gap] {gap}");
    }

    // ── Hypothesis revision ─────────────────────────────────────
    sep("MONTH 3: Hypothesis revision");

    memory.store(MemoryEntry {
        id: String::new(), key: "hypothesis_v2".to_string(),
        content: "HYPOTHESIS v2 (REVISED): Local AI runtimes can replace cloud inference for \
                  ~60% of common tasks (summarization, classification, simple Q&A) with \
                  acceptable quality. Complex reasoning tasks (code gen, math, multi-step) \
                  still require cloud. Hybrid approach recommended: local for simple, \
                  cloud fallback for complex. Privacy benefits make local worthwhile even \
                  at lower capability.".to_string(),
        category: MemoryCategory::Custom("hypotheses".to_string()),
        timestamp: 4000,
        session_id: None, score: None, embedding: None,
    }).unwrap();
    println!("[Hypothesis] Revised: v1 (80%) -> v2 (60%, hybrid approach recommended)");

    // Verify hypothesis evolution
    let hypotheses = memory.list(
        Some(&MemoryCategory::Custom("hypotheses".to_string())), 10
    ).unwrap();
    assert_eq!(hypotheses.len(), 2, "Should have v1 and v2");
    println!("[Memory] Hypothesis versions tracked: {}", hypotheses.len());

    // ── Final synthesis ─────────────────────────────────────────
    let total = memory.count(None).unwrap();
    let gap_count = memory.count(Some(&MemoryCategory::Custom("gaps".to_string()))).unwrap();
    println!("\n[Lab Notebook] Total entries: {total}");
    println!("[Lab Notebook] Open research gaps: {gap_count}");

    sep("SUMMARY");
    println!("  Demonstrated capabilities:");
    println!("  [x] Hypothesis formulation and revision");
    println!("  [x] Categorized evidence (PRO/CON/NEUTRAL)");
    println!("  [x] Evidence matrix artifact generation");
    println!("  [x] Research gap identification");
    println!("  [x] Long-term evidence accumulation over months");
    println!("  [x] Hypothesis versioning (v1 -> v2 based on evidence)");
    println!("  [x] Multiple custom memory categories");
    println!("\n  All assertions passed!\n");
}
