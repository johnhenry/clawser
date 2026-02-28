# Skills

Install, activate, and create portable skill packages that extend the agent's capabilities.

**Time:** ~8 minutes

**Prerequisites:**
- Completed [Getting Started](01-getting-started.md)
- An LLM provider account configured

---

## 1. What Are Skills?

Skills are portable packages that extend what the agent knows and can do. They follow the [Agent Skills open standard](https://agentskills.io) and contain:

- **SKILL.md** — YAML metadata (name, version, triggers) + markdown instructions
- **scripts/** — Executable JavaScript (runs in a sandboxed environment)
- **references/** — Supporting documentation
- **assets/** — Static files

When a skill is activated, its instructions are injected into the agent's system prompt, giving it specialized knowledge and capabilities.

## 2. The Skills Panel

Press `Cmd+7` to open the **Skills** panel.

![Skills panel](../screenshots/08-skills.png)

The panel shows:
- **Installed skills** — Toggle enable/disable, view details, delete, or export
- **Search** — Find skills from remote registries
- **Token estimate** — Warning if active skills consume significant context

Skills can be installed at two scopes:
- **Global** — Available across all workspaces (stored in OPFS `clawser_skills/`)
- **Workspace** — Available only in the current workspace (stored in the workspace's `.skills/` directory)

Workspace skills override global skills with the same name.

## 3. Creating from Templates

Click the **+ New** button in the Skills panel header to create a skill from a built-in template:

| Template | Contents | Use Case |
|----------|----------|----------|
| **Basic Prompt** | `SKILL.md` with `$ARGUMENTS` substitution | Simple prompt-based skills |
| **Tool Script** | `SKILL.md` + `scripts/helper.js` | Skills that need executable code |
| **Multi-Reference** | `SKILL.md` + `references/guide.md` | Skills that inject reference docs into context |

Select a template, and it will be installed to the current workspace. Edit the generated `SKILL.md` to customize it.

## 4. Installing Skills

**From the registry:**

Use the search bar in the Skills panel to browse remote registries. Click **Install** on any skill to download it.

**Via the agent:**

```
Search for a skill that helps with code review
```

The agent uses `skill_search` to query the registry and presents matching results. Then:

```
Install the code-review skill
```

The agent calls `skill_install` to download and register the skill.

**From a ZIP file:**

If you have a skill package as a ZIP, you can install it programmatically through the agent or by placing the files in the appropriate OPFS directory.

## 5. Using Skills

Skills are invoked in two ways:

**Slash commands** — Type `/skill-name` followed by arguments:

```
/code-review Check this function for bugs
```

**Auto-activation** — The agent can activate skills automatically when it determines they're relevant. It uses the `activate_skill` tool based on the skill's trigger patterns defined in the YAML metadata.

Active skills appear with a highlighted indicator in the Skills panel. Deactivate them with:

```
Deactivate the code-review skill
```

## 6. Dependency Enforcement

Skills can declare required tools and permissions in their YAML frontmatter:

```yaml
requires:
  tools: [browser_fetch, web_search]
  permissions: [network]
```

When a skill has unmet dependencies:
- A **"Missing deps"** warning badge appears in the Skills panel
- Activation is blocked — the agent reports which dependencies are unmet (distinct from "skill not found" errors)
- Use `force: true` in the `activate_skill` tool call to bypass the check

## 7. Checking for Updates

Each skill in the panel has a refresh button (**&#x21BB;**) that checks the remote registry for a newer version. If an update is available, a diff modal shows the line-by-line changes (green = added, red = removed). Click **Apply Update** to install the new version.

## 8. Skill Validation

Before activation, Clawser scans skill scripts for potentially dangerous patterns:
- `eval`, `Function()`, `import()`
- `document.cookie`, `localStorage`
- `XMLHttpRequest` — direct XHR network access
- Network access patterns

If any are detected, you'll see a warning with the specific patterns found. You can choose to proceed or block the skill.

## 9. Creating Your Own Skill

Create a `SKILL.md` file with YAML frontmatter:

```yaml
---
name: my-helper
version: 1.0.0
description: A custom helper skill
triggers:
  - /my-helper
  - help me with
tools:
  - browser_fetch
  - browser_fs_write
---

# My Helper Skill

When activated, follow these instructions:

1. Greet the user and ask what they need help with
2. Use fetch to gather any needed data
3. Write results to a file in the workspace
```

The markdown body below the frontmatter becomes the agent's instructions when the skill is active.

Add scripts by creating a `scripts/` directory alongside the SKILL.md:

```
my-helper/
  SKILL.md
  scripts/
    analyze.js
  references/
    patterns.md
```

Install your skill by asking the agent or placing the directory in OPFS.

## 10. Managing Skills

| Action | How |
|--------|-----|
| Create new | **+ New** button in Skills panel header |
| Enable/disable | Toggle switch in Skills panel |
| Check for update | Refresh button (&#x21BB;) per skill |
| Delete | Click delete icon in Skills panel |
| Export | Export as ZIP for sharing |
| Update | `skill_update` tool, re-install, or update-check button |
| List | `skill_list` tool or Skills panel |

## Next Steps

- [Tool Management](07-tool-management.md) — Control tool permissions
- [Agents & Delegation](08-agents-and-delegation.md) — Custom agent definitions
- [MCP & Extensions](09-mcp-and-extensions.md) — External tool servers
