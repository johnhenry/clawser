# Safety

Self-repair watchdog, heartbeat, sanitization, scanning, XSS prevention, autonomy

---

### SafetyPipeline

**Status:** ✅ Implemented · **Category:** pipeline · **Since:** v1.0.0

Three-stage defense-in-depth pipeline applied to every message and tool call. Stage 1: InputSanitizer strips invisible Unicode and detects injection patterns. Stage 2: ToolCallValidator checks path traversal, dangerous shell commands, unsafe URLs. Stage 3: LeakDetector scans output for credential leaks and PII. Requires explicit confirmation to disable.

**Source files:**

- `web/clawser-safety.js`
- `web/clawser-safety.d.ts`

**API surface:**

- `SafetyPipeline`
- `SafetyPipeline.enabled`
- `SafetyPipeline.confirmDisable`
- `SafetyPipeline.confirmEnable`
- `SafetyPipeline.sanitizeInput`
- `SafetyPipeline.validateToolCall`
- `SafetyPipeline.scanOutput`
- `SafetyPipeline.sanitizer`
- `SafetyPipeline.validator`
- `SafetyPipeline.leakDetector`

> **Note:** Critical severity blocks execution; medium/low severity warns only.

**See also:**

- InputSanitizer
- ToolCallValidator
- LeakDetector

---

### InputSanitizer

**Status:** ✅ Implemented · **Category:** input · **Since:** v1.0.0

User input sanitization with flag detection. Strips invisible Unicode characters, detects prompt injection patterns, and flags suspicious input.

**Source files:**

- `web/clawser-safety.js`
- `web/clawser-safety.d.ts`

**API surface:**

- `InputSanitizer`
- `InputSanitizer.sanitize`

---

### ToolCallValidator

**Status:** ✅ Implemented · **Category:** tool-validation · **Since:** v1.0.0

Tool call validation with severity levels (critical, high, medium, low). Checks for path traversal, dangerous shell commands, unsafe URLs, and other potentially harmful tool parameters.

**Source files:**

- `web/clawser-safety.js`
- `web/clawser-safety.d.ts`

**API surface:**

- `ToolCallValidator`
- `ToolCallValidator.validate`

---

### LeakDetector

**Status:** ✅ Implemented · **Category:** output-scanning · **Since:** v1.0.0

Pattern-based PII and credential detection in agent output. Detects API keys (OpenAI, Anthropic, GitHub, AWS), connection strings, JWTs, and RSA/EC private keys. Actions: redact (replace with placeholder), warn (flag but allow), block (prevent output). Configurable patterns.

**Source files:**

- `web/clawser-safety.js`
- `web/clawser-safety.d.ts`

**API surface:**

- `LeakDetector`
- `LeakDetector.scan`
- `LeakDetector.redact`
- `LeakDetector.hasBlockingFindings`

> **Note:** RSA/EC private keys block output entirely. JWTs trigger warnings. API keys are auto-redacted.

---

### PolicyEngine

**Status:** ✅ Implemented · **Category:** policy · **Since:** v1.5.0

Configurable rules engine for input, tool call, and output policies. Supports custom rules with name, target, condition, action, priority, and enable/disable. Integrates with AutonomyController for fine-grained tool-level decisions.

**Source files:**

- `web/clawser-policy-engine.js`

**API surface:**

- `PolicyEngine`
- `PolicyEngine.addRule`
- `PolicyEngine.removeRule`
- `PolicyEngine.listRules`
- `PolicyEngine.setEnabled`
- `PolicyEngine.evaluateInput`
- `PolicyEngine.evaluateToolCall`
- `PolicyEngine.evaluateOutput`
- `PolicyEngine.toJSON`
- `PolicyEngine.fromJSON`

**See also:**

- AutonomyController

---

### Self-Repair Engine

**Status:** ✅ Implemented · **Category:** self-repair · **Since:** v1.5.0

Detects stuck states and applies recovery strategies. StuckDetector checks for tool timeouts, no-progress conditions, loop detection, context pressure, consecutive errors, and cost runaway. SelfRepairEngine applies recovery strategies per issue type with configurable handlers and repair logging.

**Source files:**

- `web/clawser-self-repair.js`
- `web/clawser-self-repair.d.ts`

**API surface:**

- `SelfRepairEngine`
- `SelfRepairEngine.check`
- `SelfRepairEngine.enabled`
- `SelfRepairEngine.repairLog`
- `SelfRepairEngine.clearLog`
- `SelfRepairEngine.registerHandler`
- `SelfRepairEngine.getSummary`
- `StuckDetector`
- `StuckDetector.detect`
- `StuckDetector.setThresholds`
- `StuckDetector.resetThresholds`
- `findDuplicateSequences`
- `DEFAULT_THRESHOLDS`
- `ISSUE_TYPES`
- `RECOVERY_STRATEGIES`

> **Note:** DEFAULT_THRESHOLDS: toolTimeout (60s), noProgress (120s), loopDetection (3 duplicates), contextPressure (0.95), consecutiveErrors (5), costRunaway ($2.00). ISSUE_TYPES: tool_timeout, no_progress, loop_detected, context_pressure, consecutive_errors, cost_runaway.

**See also:**

- Error Classification

---

### Self-Repair Tools

**Status:** ✅ Implemented · **Category:** tools · **Since:** v1.5.0

Two agent tools: self_repair_status (check system health) and self_repair_configure (set repair thresholds and policies).

**Source files:**

- `web/clawser-self-repair.js`
- `web/clawser-self-repair.d.ts`

**API surface:**

- `SelfRepairStatusTool`
- `SelfRepairConfigureTool`

---

### Secret Vault (v2 — wrapped-DEK with multiple unlock paths)

**Status:** ✅ Implemented · **Category:** vault · **Since:** v1.0.0 (v2 architecture: 2026-05-03)

AES-GCM-256 encrypted storage for API keys and secrets. As of v2, the
vault uses a **wrapped data-encryption key (DEK)** model: a single
master DEK encrypts every secret, and the DEK is wrapped by one or
more KEKs (key-encryption keys). Each KEK is a separate unlock path
— passphrase today, WebAuthn passkey (PRF extension) today, future
unlock kinds tomorrow. Rotating a passphrase rewraps the DEK; secrets
are not re-encrypted. Adding a passkey adds a wrap entry without
touching anything else.

For the architecture, on-disk format, and threat model, see
[`docs/VAULT.md`](../docs/VAULT.md).

**Source files:**

- `web/clawser-vault.js`
- `web/clawser-passkey.mjs` (WebAuthn enrollment + assertion helpers)
- `web/clawser-vault-settings.js` (UI: change passphrase + manage passkeys)

**API surface:**

- `SecretVault` — `unlock(passphrase)`, `unlockWithPasskey(credId, prfOutput)`,
  `lock()`, `store(name, secret)`, `retrieve(name)`, `list()`,
  `changePassphrase(old, new)`, `addPasskeyWrap({...})`, `removeWrap(id)`,
  `listWraps()`, `getOrCreatePrfSalt()`, `peekPrfSalt()`, `peekPasskeyCredentialIds()`
- `MemoryVaultStorage`, `OPFSVaultStorage`
- `VaultRekeyer` — convenience wrapper around `changePassphrase`
- `generateDek`, `wrapDek`, `unwrapDek`, `deriveKekFromPassphrase`, `deriveKekFromPrf`
- `measurePassphraseStrength`

#### Walkthroughs

**Change your passphrase.** Click the gear icon on the vault unlock
modal → "Change passphrase". Enter the current passphrase, the new
passphrase (12+ characters, must differ from old), confirm. The
modal closes on success. Bytes on disk: the secrets don't move; only
the DEK wrap is replaced.

**Enroll a passkey.** From the gear menu → "Passkeys…" → "Add a
passkey". The browser prompts for an authenticator; on success the
PRF output is wrapped around the existing DEK. Up to 5 passkeys per
vault. Browser must support WebAuthn + the PRF extension; the UI
detects and disables the button when unsupported.

**Unlock with a passkey.** When at least one passkey is registered,
the unlock modal shows an "Unlock with passkey" button. Click it,
the browser prompts for any registered passkey, the PRF output
unwraps the DEK, vault is open. Falls back to passphrase if you
cancel the WebAuthn prompt.

**Remove a passkey.** Settings → Passkeys → "Remove" next to the
entry. The vault refuses to remove the last unlock path — once you
have a passkey, you can also remove the passphrase wrap (and rely
purely on the passkey), but never both.

**Forgot the passphrase, no passkey?** Reset the vault and lose all
data. There are intentionally no recovery codes — see the rationale
in `docs/VAULT.md`'s "What we deliberately did not ship" section.

> **Notes.**
> - Passphrase: PBKDF2-SHA256, 600,000 iterations, AES-GCM-256 KEK.
> - Passkey: WebAuthn PRF output (32 bytes) → AES-GCM-256 KEK directly.
> - All secrets stored in OPFS at `clawser_vault/`. v1 vaults migrate
>   to v2 atomically on first unlock under the new code; the meta-write
>   is the commit point and a `.next` fallback covers partial post-commit
>   cleanup.

---

### Heartbeat Monitor

**Status:** ✅ Implemented · **Category:** heartbeat · **Since:** v1.5.0

Periodic health checks from a markdown checklist. Checks context capacity (under 80%), stuck scheduler jobs, daily cost caps, and storage usage. Silent on pass; alerts on failure. Custom checks loadable from HEARTBEAT.md. Two tools: heartbeat_status and heartbeat_run.

**Source files:**

- `web/clawser-heartbeat.js`

**API surface:**

- `heartbeat_status`
- `heartbeat_run`

---

### XSS Prevention

**Status:** ✅ Implemented · **Category:** xss · **Since:** v1.0.0

Built into dom_modify tool. Sanitizes HTML to block scripts, iframes, and event handlers. Uses native Sanitizer API when available, falls back to DOMPurify-style stripping.

**Source files:**

- `web/clawser-tools.js`

**API surface:**

- `dom_modify`

---

### Domain Allowlist

**Status:** ✅ Implemented · **Category:** network-security · **Since:** v1.0.0

Configurable domain allowlist for the fetch tool and browser_open. Restricts which domains the agent can access via network tools.

**Source files:**

- `web/clawser-tools.js`

**API surface:**

- `domainAllowlist`

---

### File Size Limits

**Status:** ✅ Implemented · **Category:** file-security · **Since:** v1.0.0

Enforced file size limits for OPFS operations. fs_read max 50MB, fs_write max 10MB. Storage quota warnings at 80%, blocking at 95%.

**Source files:**

- `web/clawser-tools.js`

**API surface:**

- `fs_read`
- `fs_write`

---

### Permission System

**Status:** ✅ Implemented · **Category:** permissions · **Since:** v1.0.0

Five-level permission hierarchy for tools: internal (agent-only), read (safe reads), write (filesystem/state mutations), network (HTTP/WebSocket), browser (DOM, clipboard, navigation). Approval gates for sensitive operations based on autonomy level.

**Source files:**

- `web/clawser-tools.js`
- `web/clawser-tools.d.ts`

**API surface:**

- `BrowserToolRegistry`
- `ToolPermissionLevel`

> **Note:** Levels: auto (always), approve (user confirms), denied (blocked).

**See also:**

- AutonomyController

---

---

[← Scheduling](./scheduling.md) | [Index](./index.md) | [Workspace →](./workspace.md)
