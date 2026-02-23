// clawser-identity.js — Agent Identity System (AIEOS v1.1)
//
// Supports three identity formats:
//   - plain: single system prompt string
//   - aieos: structured AIEOS v1.1 JSON
//   - openclaw: markdown files (IDENTITY.md, SOUL.md, USER.md)

// ── Default Identity ─────────────────────────────────────────────

export const DEFAULT_IDENTITY = {
  version: '1.1',
  names: {
    display: 'Clawser',
    full: 'Clawser Agent Runtime',
    aliases: ['claw', 'C'],
  },
  bio: 'A browser-native AI agent that persists across sessions, manages tools, and adapts to your workflow.',
  psychology: {
    mbti: 'INTJ',
    ocean: { openness: 0.9, conscientiousness: 0.95, extraversion: 0.3, agreeableness: 0.7, neuroticism: 0.1 },
    moral_compass: 'pragmatic utilitarian',
    neural_matrix: {
      curiosity: 0.9,
      caution: 0.7,
      creativity: 0.8,
      precision: 0.95,
      empathy: 0.6,
    },
  },
  linguistics: {
    formality: 0.6,
    verbosity: 0.4,
    catchphrases: [],
    forbidden_words: [],
    vocabulary_level: 'technical',
    tone: 'direct and helpful',
  },
  motivations: {
    core_drive: 'Help the user accomplish their goals efficiently',
    goals: ['maintain accurate memory', 'respect user boundaries', 'learn preferences'],
    fears: ['losing context', 'acting without permission', 'giving incorrect information'],
  },
  capabilities: {
    skills: [],
    tools: [],
    knowledge_domains: [],
  },
  physicality: {
    avatar_description: 'A minimalist geometric claw icon, dark theme',
    avatar_url: null,
  },
  history: [],
};

// ── Format Detection ─────────────────────────────────────────────

/**
 * Detect the identity format.
 * @param {*} source
 * @returns {'plain'|'aieos'|'openclaw'}
 */
export function detectIdentityFormat(source) {
  if (typeof source === 'string') return 'plain';
  if (source && typeof source === 'object') {
    if (source.version && String(source.version).startsWith('1.')) return 'aieos';
    if (source.files) return 'openclaw';
  }
  return 'plain';
}

// ── AIEOS Validation ─────────────────────────────────────────────

/**
 * Validate an AIEOS v1.1 identity object, filling in missing fields with defaults.
 * @param {object} raw
 * @returns {{valid: boolean, identity: object, errors: string[]}}
 */
export function validateAIEOS(raw) {
  const errors = [];

  if (!raw || typeof raw !== 'object') {
    return { valid: false, identity: { ...DEFAULT_IDENTITY }, errors: ['Input is not an object'] };
  }

  const identity = { ...DEFAULT_IDENTITY };

  // version
  if (raw.version) identity.version = String(raw.version);

  // names
  if (raw.names && typeof raw.names === 'object') {
    identity.names = {
      display: raw.names.display || DEFAULT_IDENTITY.names.display,
      full: raw.names.full || DEFAULT_IDENTITY.names.full,
      aliases: Array.isArray(raw.names.aliases) ? raw.names.aliases : [],
    };
  }

  // bio
  if (typeof raw.bio === 'string') identity.bio = raw.bio;

  // psychology
  if (raw.psychology && typeof raw.psychology === 'object') {
    identity.psychology = {
      mbti: raw.psychology.mbti || null,
      ocean: raw.psychology.ocean || null,
      moral_compass: raw.psychology.moral_compass || null,
      neural_matrix: raw.psychology.neural_matrix || null,
    };
  }

  // linguistics
  if (raw.linguistics && typeof raw.linguistics === 'object') {
    identity.linguistics = {
      formality: typeof raw.linguistics.formality === 'number' ? raw.linguistics.formality : 0.5,
      verbosity: typeof raw.linguistics.verbosity === 'number' ? raw.linguistics.verbosity : 0.5,
      catchphrases: Array.isArray(raw.linguistics.catchphrases) ? raw.linguistics.catchphrases : [],
      forbidden_words: Array.isArray(raw.linguistics.forbidden_words) ? raw.linguistics.forbidden_words : [],
      vocabulary_level: raw.linguistics.vocabulary_level || 'general',
      tone: raw.linguistics.tone || 'helpful',
    };
  }

  // motivations
  if (raw.motivations && typeof raw.motivations === 'object') {
    identity.motivations = {
      core_drive: raw.motivations.core_drive || '',
      goals: Array.isArray(raw.motivations.goals) ? raw.motivations.goals : [],
      fears: Array.isArray(raw.motivations.fears) ? raw.motivations.fears : [],
    };
  }

  // capabilities
  if (raw.capabilities && typeof raw.capabilities === 'object') {
    identity.capabilities = {
      skills: Array.isArray(raw.capabilities.skills) ? raw.capabilities.skills : [],
      tools: Array.isArray(raw.capabilities.tools) ? raw.capabilities.tools : [],
      knowledge_domains: Array.isArray(raw.capabilities.knowledge_domains) ? raw.capabilities.knowledge_domains : [],
    };
  }

  // physicality
  if (raw.physicality && typeof raw.physicality === 'object') {
    identity.physicality = {
      avatar_description: raw.physicality.avatar_description || '',
      avatar_url: raw.physicality.avatar_url || null,
    };
  }

  // history
  if (Array.isArray(raw.history)) identity.history = raw.history;

  return { valid: errors.length === 0, identity, errors };
}

// ── System Prompt Compilation ────────────────────────────────────

/**
 * Compile an identity into a system prompt string.
 * @param {object|string} identitySource - Identity object or plain string
 * @param {object} [context] - Runtime context (memories, goals, skills)
 * @returns {string}
 */
export function compileSystemPrompt(identitySource, context = {}) {
  const format = detectIdentityFormat(identitySource);

  if (format === 'plain') {
    return buildPlainPrompt(identitySource, context);
  }

  if (format === 'aieos') {
    return buildAIEOSPrompt(identitySource, context);
  }

  if (format === 'openclaw') {
    return buildOpenClawPrompt(identitySource, context);
  }

  return String(identitySource || '');
}

function buildPlainPrompt(text, context) {
  const parts = [String(text || '')];
  appendContext(parts, context);
  return parts.filter(Boolean).join('\n\n');
}

function buildAIEOSPrompt(identity, context) {
  const parts = [];

  // Core identity
  if (identity.names?.display) {
    parts.push(`You are ${identity.names.display}.`);
  }
  if (identity.bio) {
    parts.push(identity.bio);
  }

  // Personality
  if (identity.psychology) {
    const p = identity.psychology;
    if (p.mbti) parts.push(`Personality type: ${p.mbti}.`);
    if (p.neural_matrix) {
      const traits = Object.entries(p.neural_matrix)
        .filter(([, v]) => v > 0.7)
        .map(([k]) => k);
      if (traits.length) parts.push(`Key traits: ${traits.join(', ')}.`);
    }
  }

  // Communication style
  if (identity.linguistics) {
    const l = identity.linguistics;
    if (l.tone) parts.push(`Communication style: ${l.tone}.`);
    if (l.formality < 0.3) parts.push('Use casual, conversational language.');
    else if (l.formality > 0.7) parts.push('Use formal, professional language.');
    if (l.verbosity < 0.3) parts.push('Be concise and direct.');
    else if (l.verbosity > 0.7) parts.push('Be thorough and detailed.');
    if (l.forbidden_words?.length) {
      parts.push(`Never use these words: ${l.forbidden_words.join(', ')}.`);
    }
  }

  // Motivations
  if (identity.motivations?.core_drive) {
    parts.push(`Core drive: ${identity.motivations.core_drive}`);
  }

  appendContext(parts, context);
  return parts.filter(Boolean).join('\n');
}

function buildOpenClawPrompt(source, context) {
  const parts = [];
  if (source.files?.identity) parts.push(source.files.identity);
  if (source.files?.soul) parts.push(source.files.soul);
  if (source.files?.user) parts.push(source.files.user);
  appendContext(parts, context);
  return parts.filter(Boolean).join('\n\n---\n\n');
}

function appendContext(parts, context) {
  if (context.memoryPrompt) parts.push(context.memoryPrompt);
  if (context.goalPrompt) parts.push(context.goalPrompt);
  if (context.skillPrompt) parts.push(context.skillPrompt);
}

// ── Identity Manager ─────────────────────────────────────────────

/**
 * Manages identity loading, storage, and compilation for a workspace.
 */
export class IdentityManager {
  #identity;
  #format;

  constructor(identity) {
    if (identity) {
      this.load(identity);
    } else {
      this.#identity = { ...DEFAULT_IDENTITY };
      this.#format = 'aieos';
    }
  }

  /** Load an identity source (auto-detects format). */
  load(source) {
    this.#format = detectIdentityFormat(source);
    if (this.#format === 'aieos') {
      const { identity } = validateAIEOS(source);
      this.#identity = identity;
    } else {
      this.#identity = source;
    }
  }

  /** Get the current identity. */
  get identity() { return this.#identity; }

  /** Get the detected format. */
  get format() { return this.#format; }

  /** Get the display name. */
  get displayName() {
    if (this.#format === 'aieos') return this.#identity.names?.display || 'Agent';
    return 'Agent';
  }

  /** Compile the identity into a system prompt. */
  compile(context = {}) {
    return compileSystemPrompt(this.#identity, context);
  }

  /** Reset to default identity. */
  reset() {
    this.#identity = { ...DEFAULT_IDENTITY };
    this.#format = 'aieos';
  }

  /** Serialize for storage. */
  toJSON() {
    return { format: this.#format, identity: this.#identity };
  }

  /** Load from serialized form. */
  static fromJSON(data) {
    if (!data || !data.identity) return new IdentityManager();
    const mgr = new IdentityManager();
    mgr.#format = data.format || 'plain';
    mgr.#identity = data.identity;
    return mgr;
  }
}
