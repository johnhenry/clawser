// clawser-policy-engine.js — Configurable Rules Engine for Safety Policies
//
// PolicyEngine: user-configurable rules for input/output/tool-call filtering
// Complements the hardcoded SafetyPipeline with customizable rules.
//
// Rule structure:
//   { name, target, condition: {type, value}, action, priority?, enabled? }
//
// Condition types:
//   - pattern: regex match (case-insensitive)
//   - tool_name: exact tool name match
//   - domain: regex match on URL arguments
//
// Actions: block, warn, allow, redact

// ── PolicyEngine ────────────────────────────────────────────────

export class PolicyEngine {
  /** @type {Array<{name: string, target: string, condition: object, action: string, priority: number, enabled: boolean}>} */
  #rules = [];

  /**
   * Add a rule to the engine.
   * @param {object} rule
   * @param {string} rule.name - Unique rule identifier
   * @param {string} rule.target - 'input' | 'output' | 'tool'
   * @param {object} rule.condition - {type: 'pattern'|'tool_name'|'domain', value: string}
   * @param {string} rule.action - 'block' | 'warn' | 'allow' | 'redact'
   * @param {number} [rule.priority=10] - Lower = higher priority
   */
  addRule(rule) {
    this.#rules.push({
      name: rule.name,
      target: rule.target,
      condition: rule.condition,
      action: rule.action,
      priority: rule.priority ?? 10,
      enabled: rule.enabled !== false,
    });
  }

  /**
   * Remove a rule by name.
   * @param {string} name
   */
  removeRule(name) {
    this.#rules = this.#rules.filter(r => r.name !== name);
  }

  /**
   * List all rules (copies).
   * @returns {Array<object>}
   */
  listRules() {
    return this.#rules.map(r => ({ ...r }));
  }

  /**
   * Enable or disable a rule by name.
   * @param {string} name
   * @param {boolean} enabled
   */
  setEnabled(name, enabled) {
    const rule = this.#rules.find(r => r.name === name);
    if (rule) rule.enabled = enabled;
  }

  /**
   * Get active rules for a target, sorted by priority (ascending).
   * @param {string} target
   * @returns {Array<object>}
   */
  #activeRules(target) {
    return this.#rules
      .filter(r => r.enabled && r.target === target)
      .sort((a, b) => a.priority - b.priority);
  }

  /**
   * Test if a condition matches some text.
   * @param {object} condition
   * @param {string} text
   * @returns {boolean}
   */
  #matchCondition(condition, text) {
    if (!text || !condition?.value) return false;
    if (condition.type === 'pattern') {
      try {
        return new RegExp(condition.value, 'i').test(text);
      } catch { return false; }
    }
    return false;
  }

  // ── Evaluate Input ──────────────────────────────────────────

  /**
   * Evaluate user input against input rules.
   * @param {string} input
   * @returns {{ blocked: boolean, reason?: string, flags: Array<string> }}
   */
  evaluateInput(input) {
    const rules = this.#activeRules('input');
    const flags = [];

    for (const rule of rules) {
      if (!this.#matchCondition(rule.condition, input)) continue;

      if (rule.action === 'allow') {
        return { blocked: false, flags: [] };
      }
      if (rule.action === 'block') {
        return { blocked: true, reason: `Blocked by rule: ${rule.name}`, flags: [rule.name] };
      }
      if (rule.action === 'warn') {
        flags.push(rule.name);
      }
    }

    return { blocked: false, flags };
  }

  // ── Evaluate Tool Call ──────────────────────────────────────

  /**
   * Evaluate a tool call against tool rules.
   * @param {string} toolName
   * @param {object} args
   * @returns {{ valid: boolean, issues: Array<string> }}
   */
  evaluateToolCall(toolName, args) {
    const rules = this.#activeRules('tool');
    const issues = [];

    for (const rule of rules) {
      const { condition } = rule;

      let matched = false;
      if (!condition?.value) continue;
      try {
        if (condition.type === 'tool_name') {
          matched = toolName === condition.value;
        } else if (condition.type === 'domain') {
          const argStr = JSON.stringify(args);
          matched = new RegExp(condition.value, 'i').test(argStr);
        } else if (condition.type === 'pattern') {
          const argStr = JSON.stringify(args);
          matched = new RegExp(condition.value, 'i').test(argStr);
        }
      } catch { continue; }

      if (matched && rule.action === 'block') {
        issues.push(`Blocked by rule: ${rule.name}`);
      }
    }

    return { valid: issues.length === 0, issues };
  }

  // ── Evaluate Output ─────────────────────────────────────────

  /**
   * Evaluate LLM output against output rules.
   * @param {string} output
   * @returns {{ blocked: boolean, reason?: string, findings: Array<string>, content: string }}
   */
  evaluateOutput(output) {
    const rules = this.#activeRules('output');
    const findings = [];
    let content = output;

    for (const rule of rules) {
      if (!this.#matchCondition(rule.condition, content)) continue;

      if (rule.action === 'block') {
        return {
          blocked: true,
          reason: `Blocked by rule: ${rule.name}`,
          findings: [rule.name],
          content: '',
        };
      }

      if (rule.action === 'redact') {
        findings.push(rule.name);
        try {
          content = content.replace(new RegExp(rule.condition.value, 'gi'), '[REDACTED]');
        } catch { /* invalid regex — skip redaction */ }
      }
    }

    return { blocked: false, findings, content };
  }

  // ── Serialization ───────────────────────────────────────────

  /**
   * Serialize to a plain object.
   * @returns {object}
   */
  toJSON() {
    return { rules: this.#rules.map(r => ({ ...r })) };
  }

  /**
   * Deserialize from a plain object.
   * @param {object} data
   * @returns {PolicyEngine}
   */
  static fromJSON(data) {
    const pe = new PolicyEngine();
    for (const rule of data.rules || []) {
      pe.addRule(rule);
    }
    return pe;
  }
}
