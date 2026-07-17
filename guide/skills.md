# Skills

Skill system, lifecycle, registry, validation, slash commands, agentskills.io

---

### SkillParser

**Status:** ✅ Implemented · **Category:** parser · **Since:** v1.0.0

Parses SKILL.md files with YAML frontmatter and markdown body. Validates metadata fields, checks script safety (detects dangerous patterns), and escapes attributes. Implements the agentskills.io standard format.

**Source files:**

- `web/clawser-skills.js`
- `web/clawser-skills.d.ts`

**API surface:**

- `SkillParser`

> **Note:** SKILL.md format: YAML frontmatter (name, version, description, author, tools, scripts) followed by markdown instructions body.

**See also:**

- SkillStorage
- SkillRegistry

---

### SkillStorage

**Status:** ✅ Implemented · **Category:** storage · **Since:** v1.0.0

OPFS-based skill persistence with global and per-workspace scoping. Global skills live in clawser_skills/, workspace skills in clawser_workspaces/{wsId}/.skills/. Supports ZIP import/export for sharing.

**Source files:**

- `web/clawser-skills.js`
- `web/clawser-skills.d.ts`

**API surface:**

- `SkillStorage`

> **Note:** Skills are stored as individual files in OPFS directories.

**See also:**

- Workspace Management

---

### SkillRegistry

**Status:** ✅ Implemented · **Category:** registry · **Since:** v1.0.0

Local skill registry managing discovery, activation, and deactivation. Tracks which skills are active, registers their tools with the tool registry, and persists auto-enable state. Skills are injected into the system prompt pipeline when active.

**Source files:**

- `web/clawser-skills.js`
- `web/clawser-skills.d.ts`

**API surface:**

- `SkillRegistry`

> **Note:** SkillActivation contains the parsed body, scripts, references, and registered tool names for each active skill.

---

### SkillRegistryClient

**Status:** ✅ Implemented · **Category:** remote-registry · **Since:** v1.0.0

Remote registry client for searching, fetching, installing, and version checking community skills from an online registry. Supports semver version comparison.

**Source files:**

- `web/clawser-skills.js`
- `web/clawser-skills.d.ts`

**API surface:**

- `SkillRegistryClient`

> **Note:** Registry URL is configurable. Implements search, fetch, install, and version check.

---

### Skill Registry Server

**Status:** ✅ Implemented · **Category:** remote-registry · **Since:** v1.5.0

Server-side registry implementation for hosting a skill registry. Supports publishing, searching, and serving skill packages.

**Source files:**

- `web/clawser-skills-registry-server.js`

**API surface:**

- `SkillsRegistryServer`

---

### Skill Validation

**Status:** ✅ Implemented · **Category:** validation · **Since:** v1.0.0

Safety validation for skill scripts. Detects dangerous patterns (eval, Function constructor, DOM manipulation, network access) and blocks skills with unsafe code. Validates YAML metadata fields against the agentskills.io schema.

**Source files:**

- `web/clawser-skills.js`

**API surface:**

- `SkillParser`

---

### Skill Lifecycle

**Status:** ✅ Implemented · **Category:** lifecycle · **Since:** v1.0.0

Full lifecycle management — install from registry or ZIP, activate with arguments, deactivate, update to latest version, remove. Skills can register custom tools that appear in the tool registry while active.

**Source files:**

- `web/clawser-skills.js`

**API surface:**

- `ActivateSkillTool`
- `DeactivateSkillTool`
- `SkillInstallTool`
- `SkillUpdateTool`
- `SkillRemoveTool`
- `SkillListTool`
- `SkillSearchTool`

> **Note:** 7 agent tools: activate_skill, deactivate_skill, skill_search, skill_install, skill_update, skill_remove, skill_list.

---

### Skill ZIP Export/Import

**Status:** ✅ Implemented · **Category:** portability · **Since:** v1.0.0

Export installed skills as ZIP bundles for sharing. Import skills from ZIP files. Includes skill manifest, instructions, and bundled assets.

**Source files:**

- `web/clawser-skills.js`

**API surface:**

- `SkillStorage`

---

### Skill Semver Utilities

**Status:** ✅ Implemented · **Category:** versioning · **Since:** v1.0.0

Semantic versioning utilities for comparing skill versions and checking compatibility during updates.

**Source files:**

- `web/clawser-skills.js`

**API surface:**

- `semverCompare`

---

### agentskills.io Standard

**Status:** ✅ Implemented · **Category:** standard · **Since:** v1.0.0

Implements the agentskills.io open standard for portable agent skills. Skills defined with this standard are interoperable across compatible agent platforms.

**Source files:**

- `web/clawser-skills.js`
- `web/clawser-skills.d.ts`
- `web/types.d.ts`

**API surface:**

- `SkillManifest`

> **Note:** Standard format: YAML frontmatter with name, version, description, author, tools, scripts.

---

### Skill Marketplace

**Status:** ✅ Implemented · **Category:** marketplace · **Since:** v1.5.0

Browser-based marketplace UI for discovering, previewing, and installing skills from the remote registry.

**Source files:**

- `web/clawser-marketplace.js`

**API surface:**

- `SkillMarketplace`

---

---

[← Memory](./memory.md) | [Index](./index.md) | [Mesh →](./mesh.md)
