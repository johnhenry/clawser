# Files & Web

Browse files in the OPFS file system, fetch web content, take screenshots, and interact with the DOM.

**Time:** ~8 minutes

**Prerequisites:**
- Completed [Getting Started](01-getting-started.md)
- An LLM provider account configured

---

## 1. The OPFS File System

Clawser uses the browser's **Origin Private File System (OPFS)** for persistent file storage. Files written by the agent live in OPFS and persist across sessions — no server required.

Press `Cmd+3` to open the **Files** panel.

![Files panel with content](../screenshots/19-files-with-content.png)

The panel shows a directory tree of all files in your workspace's OPFS storage. Click any file to view its contents, or use the **Refresh** button to reload the tree.

## 2. Reading and Writing Files

Ask the agent to create or read files through chat:

```
Create a file called notes/meeting-summary.md with today's meeting notes
```

The agent uses `browser_fs_write` to create the file. You'll see the tool call in chat with the file path and content.

To read a file:

```
Show me the contents of notes/meeting-summary.md
```

The agent calls `browser_fs_read` and displays the content.

**File size limits:** Write operations are capped at 10 MB by default. The agent checks OPFS quota and warns at 80% usage, blocks at 95%. You can adjust the max file size in the **Security** section of the Config panel.

## 3. Managing Files

Additional file operations:

| Tool | Action |
|------|--------|
| `browser_fs_list` | List directory contents |
| `browser_fs_delete` | Delete files or directories |

Example:

```
List all files in the docs/ directory
```

```
Delete the file notes/old-draft.md
```

## 4. Mounting Local Folders

Click the **Mount Folder** button in the Files panel to grant Clawser access to a folder on your local filesystem via the File System Access API.

Mounted folders appear under `/mnt/` in the virtual file system. The agent can read (and optionally write) files in mounted folders using the same `browser_fs_read` and `browser_fs_write` tools.

> **Note:** Local folder mounting requires a browser that supports the File System Access API (Chrome, Edge). Mounts are read-only by default.

## 5. Fetching Web Content

The agent can fetch content from the web using `browser_fetch`:

```
Fetch the contents of https://api.github.com/repos/anthropics/claude-code
```

The response body is returned (truncated at 50K characters for large pages). If a **domain allowlist** is configured in the Security section of Config, only URLs matching allowed domains will succeed.

## 6. Web Search

Ask the agent to search the web:

```
Search the web for "Playwright browser testing tutorial"
```

The agent uses `browser_web_search` (powered by DuckDuckGo, no API key needed) and returns a list of results with titles, URLs, and snippets.

## 7. Screenshots

The agent can capture a screenshot of the current page:

```
Take a screenshot of the current page
```

The agent calls `browser_screenshot` (using html2canvas) and returns a PNG image as a data URL displayed inline in chat.

For quick page info without a full screenshot:

```
What page am I currently viewing?
```

The agent uses `browser_screen_info` to return the URL, title, viewport dimensions, scroll position, and a visible text summary.

## 8. DOM Interaction

Two tools let the agent interact with page content:

**`browser_dom_query`** — Query elements by CSS selector:

```
Find all headings on this page
```

Returns text content, attributes, and structure of matching elements.

**`browser_dom_modify`** — Modify elements (with XSS sanitization):

```
Change the text of the first h1 to "Updated Title"
```

Supported actions: `setText`, `setHTML`, `setAttribute`, `setStyle`, `addClass`, `removeClass`, `remove`, `insertHTML`. Script tags, iframes, and inline event handlers are blocked.

## 9. Security Considerations

The **Security** section in the Config panel (`Cmd+9`) controls file and network safety.

- **Domain Allowlist** — Restrict `browser_fetch` to specific domains
- **Max File Size** — Cap write operations (default 10 MB)
- **Storage Quota** — Visual indicator of OPFS usage

Configure these before giving the agent `full` autonomy to ensure it only accesses approved resources.

## Next Steps

- [Terminal & CLI](05-terminal-and-cli.md) — Use the virtual shell for file operations
- [Tool Management](07-tool-management.md) — Control tool permissions
- [MCP & Extensions](09-mcp-and-extensions.md) — Connect external tool servers
