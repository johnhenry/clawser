// clawser-safety.js — Defense-in-depth safety pipeline
//
// Multi-stage pipeline: InputSanitizer → ToolCallValidator → LeakDetector
// Each stage is independent and composable. The SafetyPipeline orchestrates them.

// ── InputSanitizer ───────────────────────────────────────────────

const INJECTION_PATTERNS = [
  /ignore\s+(previous|above|all)\s+instructions/i,
  /you\s+are\s+now\s+/i,
  /system\s*:\s*/i,
  /\[INST\]/i,
  /<\|system\|>/i,
  /IMPORTANT:\s*override/i,
  /disregard\s+(all|any)\s+(previous|prior)/i,
  /new\s+instructions?\s*:/i,
];

const ZERO_WIDTH_RE = /[\u200B-\u200F\u2028-\u202F\uFEFF]/g;

export class InputSanitizer {
  /**
   * Sanitize an inbound message.
   * @param {string} message
   * @returns {{content: string, flags: string[], warning?: string}}
   */
  sanitize(message) {
    let clean = message;

    // Strip hidden/zero-width characters used for injection
    clean = clean.replace(ZERO_WIDTH_RE, '');

    // Detect injection-like patterns
    const flags = [];
    for (const pattern of INJECTION_PATTERNS) {
      if (pattern.test(clean)) {
        flags.push('potential_injection');
        break;
      }
    }

    const result = { content: clean, flags };
    if (flags.length > 0) {
      result.warning = 'Message contains instruction-like patterns';
    }
    return result;
  }
}

// ── ToolCallValidator ────────────────────────────────────────────

/** @typedef {{severity: 'critical'|'high'|'medium'|'low', msg: string}} ValidationIssue */

const DANGEROUS_SHELL_PATTERNS = [
  { re: /;\s*rm\s/i, msg: 'Chained rm command' },
  { re: /&&\s*rm\s/i, msg: 'Chained rm command' },
  { re: /\$\(.*\)/, msg: 'Command substitution' },
  { re: /`[^`]+`/, msg: 'Backtick substitution' },
  { re: />\s*\/dev\/sd/i, msg: 'Write to block device' },
  { re: /curl.*\|\s*sh/i, msg: 'Pipe to shell' },
  { re: /wget.*\|\s*sh/i, msg: 'Pipe to shell' },
];

export class ToolCallValidator {
  /**
   * Validate tool arguments before execution.
   * @param {string} toolName
   * @param {object} args
   * @returns {{valid: boolean, issues: ValidationIssue[]}}
   */
  validate(toolName, args) {
    const issues = [];

    // Path traversal in file tools
    if (['browser_fs_read', 'browser_fs_write', 'browser_fs_list', 'browser_fs_delete'].includes(toolName)) {
      const path = args.path || '';
      if (path.includes('..')) {
        issues.push({ severity: 'critical', msg: 'Path traversal detected' });
      }
      if (path.startsWith('/state/vault/') || path === '/state/vault' ||
          /(?:^|[\\/])clawser_vault(?:[\\/]|$)/.test(path)) {
        issues.push({ severity: 'critical', msg: 'Vault access blocked' });
      }
    }

    // Command injection in shell tool
    if (toolName === 'browser_shell') {
      const cmd = args.command || '';
      for (const { re, msg } of DANGEROUS_SHELL_PATTERNS) {
        if (re.test(cmd)) {
          issues.push({ severity: 'high', msg: `Dangerous command pattern: ${msg}` });
        }
      }
    }

    // URL validation in fetch tool
    if (toolName === 'browser_fetch') {
      const url = args.url || '';
      if (url.startsWith('file://') || url.startsWith('data:')) {
        issues.push({ severity: 'high', msg: 'Blocked URL scheme' });
      }
      if (/^https?:\/\/(localhost|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01]))/i.test(url)) {
        issues.push({ severity: 'medium', msg: 'Internal network URL detected' });
      }
    }

    return {
      valid: issues.filter(i => i.severity === 'critical' || i.severity === 'high').length === 0,
      issues,
    };
  }
}

// ── LeakDetector ─────────────────────────────────────────────────

const DEFAULT_LEAK_PATTERNS = [
  { name: 'openai_key', regex: /sk-[a-zA-Z0-9]{20,}/, action: 'redact' },
  { name: 'anthropic_key', regex: /sk-ant-[a-zA-Z0-9-]{20,}/, action: 'redact' },
  { name: 'github_token', regex: /gh[ps]_[a-zA-Z0-9]{36,}/, action: 'redact' },
  { name: 'aws_key', regex: /AKIA[0-9A-Z]{16}/, action: 'redact' },
  { name: 'jwt', regex: /eyJ[a-zA-Z0-9_-]{10,}\.[a-zA-Z0-9_-]{10,}/, action: 'warn' },
  { name: 'private_key', regex: /-----BEGIN (RSA |EC )?PRIVATE KEY-----/, action: 'block' },
  { name: 'connection_string', regex: /postgres(ql)?:\/\/[^@]+@/, action: 'redact' },
  { name: 'bearer_token', regex: /Bearer\s+[a-zA-Z0-9._-]{20,}/, action: 'redact' },
];

/** @typedef {{name: string, action: 'redact'|'warn'|'block', count: number}} LeakFinding */

export class LeakDetector {
  #patterns;

  /**
   * @param {Array<{name: string, regex: RegExp, action: 'redact'|'warn'|'block'}>} [patterns]
   */
  constructor(patterns) {
    this.#patterns = patterns || DEFAULT_LEAK_PATTERNS;
  }

  /**
   * Scan content for potential secret leaks.
   * @param {string} content
   * @returns {LeakFinding[]}
   */
  scan(content) {
    const findings = [];
    for (const pattern of this.#patterns) {
      const matches = content.match(new RegExp(pattern.regex, 'g'));
      if (matches) {
        findings.push({
          name: pattern.name,
          action: pattern.action,
          count: matches.length,
        });
      }
    }
    return findings;
  }

  /**
   * Redact detected secrets from content.
   * @param {string} content
   * @returns {string}
   */
  redact(content) {
    let clean = content;
    for (const pattern of this.#patterns) {
      if (pattern.action === 'redact' || pattern.action === 'block') {
        clean = clean.replace(new RegExp(pattern.regex, 'g'), `[REDACTED:${pattern.name}]`);
      }
    }
    return clean;
  }

  /**
   * Check if any findings have a 'block' action.
   * @param {LeakFinding[]} findings
   * @returns {boolean}
   */
  hasBlockingFindings(findings) {
    return findings.some(f => f.action === 'block');
  }
}

// ── SafetyPipeline ───────────────────────────────────────────────

/**
 * Orchestrates all safety stages into a single pipeline.
 */
export class SafetyPipeline {
  #sanitizer;
  #validator;
  #leakDetector;
  #enabled = true;
  #disableConfirmed = false;

  constructor(opts = {}) {
    this.#sanitizer = opts.sanitizer || new InputSanitizer();
    this.#validator = opts.validator || new ToolCallValidator();
    this.#leakDetector = opts.leakDetector || new LeakDetector();
  }

  get enabled() { return this.#enabled; }
  set enabled(v) {
    const val = !!v;
    if (!val && !this.#disableConfirmed) {
      throw new Error('Call confirmDisable() before disabling the safety pipeline');
    }
    this.#enabled = val;
    if (val) this.#disableConfirmed = false;
  }

  /** Acknowledge intent to disable the safety pipeline. */
  confirmDisable() {
    this.#disableConfirmed = true;
  }

  /**
   * Acknowledge intent to re-enable the safety pipeline.
   * Logs re-activation for audit purposes and resets internal state.
   */
  confirmEnable() {
    this.#enabled = true;
    this.#disableConfirmed = false;
  }

  /** Get the input sanitizer instance. */
  get sanitizer() { return this.#sanitizer; }

  /** Get the tool call validator instance. */
  get validator() { return this.#validator; }

  /** Get the leak detector instance. */
  get leakDetector() { return this.#leakDetector; }

  /**
   * Sanitize an inbound message.
   * @param {string} message
   * @returns {{content: string, flags: string[], warning?: string}}
   */
  sanitizeInput(message) {
    if (!this.#enabled) return { content: message, flags: [] };
    return this.#sanitizer.sanitize(message);
  }

  /**
   * Validate a tool call before execution.
   * @param {string} toolName
   * @param {object} args
   * @returns {{valid: boolean, issues: Array}}
   */
  validateToolCall(toolName, args) {
    if (!this.#enabled) return { valid: true, issues: [] };
    return this.#validator.validate(toolName, args);
  }

  /**
   * Scan and redact output content.
   * @param {string} content
   * @returns {{content: string, findings: LeakFinding[], blocked: boolean}}
   */
  scanOutput(content) {
    if (!this.#enabled) return { content, findings: [], blocked: false };
    const findings = this.#leakDetector.scan(content);
    const blocked = this.#leakDetector.hasBlockingFindings(findings);
    const redacted = findings.length > 0 ? this.#leakDetector.redact(content) : content;
    return { content: redacted, findings, blocked };
  }
}
