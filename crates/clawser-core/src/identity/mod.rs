use serde::{Deserialize, Serialize};

/// AIEOS v1.1 compatible identity.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AieosIdentity {
    #[serde(default = "default_aieos_version")]
    pub version: String,
    pub names: Names,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub bio: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub psychology: Option<Psychology>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub linguistics: Option<Linguistics>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub motivations: Option<Motivations>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub capabilities: Option<Capabilities>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub history: Option<Vec<HistoryEvent>>,
}

fn default_aieos_version() -> String {
    "1.1".to_string()
}

impl AieosIdentity {
    /// Generate a system prompt from this identity.
    pub fn to_system_prompt(&self) -> String {
        let mut parts = Vec::new();

        parts.push(format!("Your name is {}.", self.names.display));
        if let Some(ref full) = self.names.full {
            parts.push(format!("Your full name is {full}."));
        }

        if let Some(ref bio) = self.bio {
            parts.push(bio.clone());
        }

        if let Some(ref psych) = self.psychology {
            if let Some(ref mbti) = psych.mbti {
                parts.push(format!("Your MBTI type is {mbti}."));
            }
        }

        if let Some(ref ling) = self.linguistics {
            if let Some(ref formality) = ling.formality {
                parts.push(format!("Your communication style is {formality}."));
            }
            if !ling.catchphrases.is_empty() {
                parts.push(format!(
                    "You sometimes use phrases like: {}",
                    ling.catchphrases.join(", ")
                ));
            }
            if !ling.forbidden_words.is_empty() {
                parts.push(format!(
                    "You never use these words: {}",
                    ling.forbidden_words.join(", ")
                ));
            }
        }

        if let Some(ref motiv) = self.motivations {
            if let Some(ref drive) = motiv.core_drive {
                parts.push(format!("Your core drive is: {drive}"));
            }
        }

        if let Some(ref caps) = self.capabilities {
            if !caps.skills.is_empty() {
                parts.push(format!("Your skills include: {}", caps.skills.join(", ")));
            }
        }

        parts.join("\n")
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Names {
    pub display: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub full: Option<String>,
    #[serde(default)]
    pub aliases: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Psychology {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub mbti: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub ocean: Option<OceanTraits>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub moral_compass: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OceanTraits {
    pub openness: f32,
    pub conscientiousness: f32,
    pub extraversion: f32,
    pub agreeableness: f32,
    pub neuroticism: f32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Linguistics {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub formality: Option<String>,
    #[serde(default)]
    pub catchphrases: Vec<String>,
    #[serde(default)]
    pub forbidden_words: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Motivations {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub core_drive: Option<String>,
    #[serde(default)]
    pub goals: Vec<String>,
    #[serde(default)]
    pub fears: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Capabilities {
    #[serde(default)]
    pub skills: Vec<String>,
    #[serde(default)]
    pub tools: Vec<String>,
    #[serde(default)]
    pub knowledge_domains: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HistoryEvent {
    pub date: String,
    pub event: String,
}

/// Source of identity configuration.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "format")]
pub enum IdentitySource {
    #[serde(rename = "aieos")]
    Aieos(AieosIdentity),
    #[serde(rename = "plain")]
    Plain { system_prompt: String },
    #[serde(rename = "none")]
    None,
}

impl IdentitySource {
    pub fn to_system_prompt(&self) -> Option<String> {
        match self {
            IdentitySource::Aieos(identity) => Some(identity.to_system_prompt()),
            IdentitySource::Plain { system_prompt } => Some(system_prompt.clone()),
            IdentitySource::None => None,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample_identity() -> AieosIdentity {
        AieosIdentity {
            version: "1.1".to_string(),
            names: Names {
                display: "Clawser".to_string(),
                full: Some("Clawser Agent v1".to_string()),
                aliases: vec!["claw".to_string()],
            },
            bio: Some("A helpful browser-native AI agent.".to_string()),
            psychology: Some(Psychology {
                mbti: Some("INTJ".to_string()),
                ocean: None,
                moral_compass: None,
            }),
            linguistics: Some(Linguistics {
                formality: Some("casual-professional".to_string()),
                catchphrases: vec!["Let me look into that".to_string()],
                forbidden_words: vec!["obviously".to_string()],
            }),
            motivations: Some(Motivations {
                core_drive: Some("Help users achieve their goals efficiently".to_string()),
                goals: vec!["Be helpful".to_string()],
                fears: vec![],
            }),
            capabilities: Some(Capabilities {
                skills: vec!["research".to_string(), "writing".to_string()],
                tools: vec![],
                knowledge_domains: vec![],
            }),
            history: None,
        }
    }

    #[test]
    fn test_identity_to_system_prompt() {
        let identity = sample_identity();
        let prompt = identity.to_system_prompt();

        assert!(prompt.contains("Clawser"));
        assert!(prompt.contains("INTJ"));
        assert!(prompt.contains("casual-professional"));
        assert!(prompt.contains("Let me look into that"));
        assert!(prompt.contains("obviously"));
        assert!(prompt.contains("research"));
        assert!(prompt.contains("Help users achieve"));
    }

    #[test]
    fn test_identity_serialization() {
        let identity = sample_identity();
        let json = serde_json::to_string(&identity).unwrap();
        let parsed: AieosIdentity = serde_json::from_str(&json).unwrap();
        assert_eq!(parsed.names.display, "Clawser");
        assert_eq!(parsed.version, "1.1");
    }

    #[test]
    fn test_identity_minimal() {
        let json = r#"{
            "names": { "display": "Agent" }
        }"#;
        let identity: AieosIdentity = serde_json::from_str(json).unwrap();
        assert_eq!(identity.names.display, "Agent");
        assert_eq!(identity.version, "1.1");
        assert!(identity.bio.is_none());
        assert!(identity.psychology.is_none());
    }

    #[test]
    fn test_identity_source_aieos() {
        let source = IdentitySource::Aieos(sample_identity());
        let prompt = source.to_system_prompt();
        assert!(prompt.is_some());
        assert!(prompt.unwrap().contains("Clawser"));
    }

    #[test]
    fn test_identity_source_plain() {
        let source = IdentitySource::Plain {
            system_prompt: "You are a helpful assistant.".to_string(),
        };
        let prompt = source.to_system_prompt();
        assert_eq!(prompt.as_deref(), Some("You are a helpful assistant."));
    }

    #[test]
    fn test_identity_source_none() {
        let source = IdentitySource::None;
        assert!(source.to_system_prompt().is_none());
    }

    #[test]
    fn test_ocean_traits() {
        let ocean = OceanTraits {
            openness: 0.8,
            conscientiousness: 0.9,
            extraversion: 0.3,
            agreeableness: 0.7,
            neuroticism: 0.2,
        };
        let json = serde_json::to_string(&ocean).unwrap();
        let parsed: OceanTraits = serde_json::from_str(&json).unwrap();
        assert!((parsed.openness - 0.8).abs() < f32::EPSILON);
    }

    #[test]
    fn test_history_event() {
        let event = HistoryEvent {
            date: "2026-01-01".to_string(),
            event: "Created".to_string(),
        };
        let json = serde_json::to_string(&event).unwrap();
        let parsed: HistoryEvent = serde_json::from_str(&json).unwrap();
        assert_eq!(parsed.date, "2026-01-01");
    }
}
