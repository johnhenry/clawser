# BrowserMCP Evaluation: Fork vs. Standalone

## Context

Clawser needs browser automation capabilities (DOM interaction, page navigation, screenshot capture) that go beyond its current in-page tool set. BrowserMCP is an open-source Model Context Protocol server that exposes browser control to LLM agents.

This document evaluates whether Clawser should fork BrowserMCP or integrate it as a standalone service via the existing MCP bridge.

## Options Considered

### Option A: Fork BrowserMCP into Clawser

Embed BrowserMCP directly into the Clawser codebase, modifying it to work within the browser runtime.

**Pros:**
- Full control over API surface and tool definitions
- No external process management; everything in one runtime
- Can customize to match Clawser BrowserTool patterns natively

**Cons:**
- Maintenance burden: must keep up with upstream changes
- BrowserMCP relies on a Node.js server + Chrome DevTools Protocol (CDP), which conflicts with Clawser's browser-only architecture
- Significant rewrite required to adapt CDP-based control for in-browser use
- Duplicates functionality already available through MCP client integration

### Option B: Standalone via MCP Bridge (Recommended)

Run BrowserMCP as an external MCP server and connect through Clawser's existing `clawser-mcp.js` MCP client.

**Pros:**
- Zero fork maintenance; use BrowserMCP as-is or pin to a version
- Leverages existing MCP tool registration pipeline
- Clean separation of concerns: Clawser handles agent logic, BrowserMCP handles browser control
- Aligns with Clawser's MCP-first external tool philosophy
- BrowserMCP tools appear alongside other MCP tools in the agent's tool registry
- User can upgrade BrowserMCP independently

**Cons:**
- Requires external process (Node.js) running BrowserMCP server
- Additional latency from MCP transport (stdio or HTTP+SSE)
- User must install and configure BrowserMCP separately

## Recommendation

**Standalone via MCP bridge (Option B).**

Rationale:
1. Clawser already has a mature MCP client (`clawser-mcp.js`) that handles tool registration, result parsing, and lifecycle management.
2. Forking introduces an ongoing maintenance burden with no clear upside, since the MCP bridge provides full access to BrowserMCP capabilities.
3. BrowserMCP's architecture (Node.js + CDP) is fundamentally incompatible with browser-only execution.
4. The MCP bridge pattern is consistent with how Clawser integrates other external tools (filesystem MCP servers, database MCP servers, etc.).

## Integration Path

1. User installs BrowserMCP: `npx @anthropic/browsermcp` or equivalent
2. User configures an MCP server entry in Clawser workspace settings:
   ```json
   {
     "name": "browsermcp",
     "transport": "stdio",
     "command": "npx",
     "args": ["@anthropic/browsermcp"]
   }
   ```
3. Clawser's MCP manager connects on workspace init and registers BrowserMCP tools
4. Agent can invoke browser automation tools (`browser_navigate`, `browser_click`, `browser_snapshot`, etc.) like any other tool

## Alternative: Hybrid Approach

If deeper integration is desired in the future, Clawser could wrap selected BrowserMCP tools with thin adapter classes that provide friendlier schemas or add permission checks. This would still use the MCP bridge under the hood but present a curated subset to the agent.

```
BrowserMCP (MCP server) → clawser-mcp.js → optional adapter layer → agent tool registry
```

This hybrid preserves the benefits of standalone operation while allowing Clawser-specific customization.

## Decision Status

**Accepted** — Standalone via MCP bridge. No fork needed.

## References

- `web/clawser-mcp.js` — MCP client implementation
- `docs/TOOLS.md` — Tool registration and permission system
- BrowserMCP repository — https://github.com/anthropics/browsermcp
