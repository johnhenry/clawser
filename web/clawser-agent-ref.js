/**
 * Clawser Agent References — @agent-name inline sub-conversations
 *
 * Parses @agent-name references from prompts and dispatches sub-conversations
 * to the referenced agent's configuration. Results are injected back into
 * the main conversation context.
 *
 * Usage:
 *   > @sql-expert What index for SELECT * FROM orders WHERE user_id=?
 *   > @code-reviewer Review the last commit
 *   > Summarize this, then @haiku simplify the summary
 */

/**
 * Parse @agent-name references from a prompt string.
 * Returns an array of segments: text or agent reference.
 *
 * @param {string} prompt
 * @returns {Array<{type: 'text'|'ref', content: string, agent?: string}>}
 */
export function parseAgentRefs(prompt) {
  if (!prompt || typeof prompt !== 'string') {
    return [{ type: 'text', content: prompt || '' }];
  }

  const segments = [];
  // Match @agent-name at word boundary, followed by space or end
  const regex = /@([\w][\w-]*)/g;
  let lastIndex = 0;
  const matches = [];

  let match;
  while ((match = regex.exec(prompt)) !== null) {
    matches.push({ index: match.index, name: match[1], fullMatch: match[0] });
  }

  if (matches.length === 0) {
    return [{ type: 'text', content: prompt }];
  }

  for (let i = 0; i < matches.length; i++) {
    const m = matches[i];

    // Text before this @ref
    if (m.index > lastIndex) {
      const text = prompt.slice(lastIndex, m.index).trim();
      if (text) segments.push({ type: 'text', content: text });
    }

    // Content for this @ref: from after the @name to the next @ref or end
    const contentStart = m.index + m.fullMatch.length;
    const contentEnd = i + 1 < matches.length ? matches[i + 1].index : prompt.length;
    const content = prompt.slice(contentStart, contentEnd).trim();

    segments.push({ type: 'ref', agent: m.name, content });
    lastIndex = contentEnd;
  }

  // Any remaining text after the last ref
  if (lastIndex < prompt.length) {
    const remaining = prompt.slice(lastIndex).trim();
    if (remaining) segments.push({ type: 'text', content: remaining });
  }

  return segments;
}

/**
 * Check if a prompt contains any @agent references.
 * @param {string} prompt
 * @returns {boolean}
 */
export function hasAgentRefs(prompt) {
  return /@[\w][\w-]*/.test(prompt || '');
}

/** Maximum depth for nested @agent references */
const MAX_AGENT_REF_DEPTH = 3;

/**
 * Execute a sub-conversation with a referenced agent definition.
 * Creates a temporary engine, applies the agent config, and runs to completion.
 *
 * @param {Object} agentDef — The agent definition to use
 * @param {string} message — The message to send
 * @param {Object} opts
 * @param {Object} opts.providers — ProviderRegistry instance
 * @param {Object} [opts.browserTools] — BrowserToolRegistry for tools
 * @param {Object} [opts.mcpManager] — MCP manager for MCP tools
 * @param {Function} [opts.onLog] — Log callback
 * @param {Function} [opts.onStream] — Stream callback for progressive rendering
 * @param {Function} [opts.createEngine] — Factory to create a new engine instance
 * @param {Set<string>} [opts.visited] — Set of already-visited agent names (recursion guard)
 * @param {number} [opts.depth] — Current recursion depth (recursion guard)
 * @returns {Promise<{response: string, usage?: Object}>}
 */
export async function executeAgentRef(agentDef, message, opts = {}) {
  const { providers, browserTools, mcpManager, onLog, createEngine } = opts;

  if (!createEngine) {
    throw new Error('executeAgentRef requires opts.createEngine factory');
  }

  // Create a temporary engine instance
  const subEngine = await createEngine({
    providers,
    browserTools,
    mcpManager,
    onLog: onLog || (() => {}),
  });

  // Apply the referenced agent's configuration
  subEngine.applyAgent(agentDef);

  // Send the message and run
  subEngine.sendMessage(message);

  let response = '';
  let usage = null;

  if (opts.onStream && subEngine.runStream) {
    for await (const chunk of subEngine.runStream()) {
      if (chunk.type === 'text') {
        response += chunk.text;
        opts.onStream(chunk);
      } else if (chunk.type === 'done' && chunk.response?.usage) {
        usage = chunk.response.usage;
      }
    }
  } else {
    const result = await subEngine.run();
    response = result.data || '';
    usage = result.usage || null;
  }

  return { response, usage };
}

/**
 * Process a prompt with @agent references.
 * Executes sub-conversations for each reference and returns an augmented prompt.
 *
 * @param {string} prompt
 * @param {Object} opts
 * @param {Object} opts.agentStorage — AgentStorage instance
 * @param {Object} opts.providers — ProviderRegistry
 * @param {Object} [opts.browserTools]
 * @param {Object} [opts.mcpManager]
 * @param {Function} [opts.onLog]
 * @param {Function} [opts.onRefStart] — Called when a ref starts: (agentName, content) => void
 * @param {Function} [opts.onRefEnd] — Called when a ref ends: (agentName, response, error?) => void
 * @param {Function} [opts.createEngine]
 * @param {Set<string>} [visited] — Set of already-visited agent names (recursion guard)
 * @param {number} [depth] — Current recursion depth (recursion guard)
 * @returns {Promise<{prompt: string, refs: Array<{agent: string, response?: string, error?: string}>}>}
 */
export async function processAgentRefs(prompt, opts, visited = new Set(), depth = 0) {
  const { agentStorage, onRefStart, onRefEnd } = opts;

  const segments = parseAgentRefs(prompt);

  // If no @refs, return prompt unchanged
  if (!segments.some(s => s.type === 'ref')) {
    return { prompt, refs: [] };
  }

  const agents = await agentStorage.listAll();
  const results = [];
  let augmented = '';

  for (const seg of segments) {
    if (seg.type === 'text') {
      augmented += seg.content + '\n';
      continue;
    }

    // Resolve agent by name (case-insensitive, supports hyphens for spaces)
    const agentDef = agents.find(
      a => a.name.toLowerCase().replace(/\s+/g, '-') === seg.agent.toLowerCase() ||
           a.name.toLowerCase() === seg.agent.toLowerCase()
    );

    if (!agentDef) {
      augmented += `[@${seg.agent}: agent not found]\n`;
      results.push({ agent: seg.agent, error: 'not found' });
      continue;
    }

    // Recursion guard: check depth limit
    if (depth >= MAX_AGENT_REF_DEPTH) {
      const errMsg = `maximum agent reference depth (${MAX_AGENT_REF_DEPTH}) exceeded`;
      augmented += `[@${seg.agent}: error — ${errMsg}]\n`;
      results.push({ agent: seg.agent, error: errMsg });
      onRefEnd?.(seg.agent, null, new Error(errMsg));
      continue;
    }

    // Recursion guard: check for circular references
    if (visited.has(seg.agent.toLowerCase())) {
      const errMsg = `circular agent reference detected for @${seg.agent}`;
      augmented += `[@${seg.agent}: error — ${errMsg}]\n`;
      results.push({ agent: seg.agent, error: errMsg });
      onRefEnd?.(seg.agent, null, new Error(errMsg));
      continue;
    }

    // Track this agent in the visited set for this chain
    visited.add(seg.agent.toLowerCase());

    onRefStart?.(seg.agent, seg.content);

    try {
      const { response } = await executeAgentRef(agentDef, seg.content, {
        ...opts,
        visited,
        depth: depth + 1,
      });
      augmented += `[Response from @${seg.agent}]:\n${response}\n\n`;
      results.push({ agent: seg.agent, response });
      onRefEnd?.(seg.agent, response);
    } catch (e) {
      augmented += `[@${seg.agent}: error — ${e.message}]\n`;
      results.push({ agent: seg.agent, error: e.message });
      onRefEnd?.(seg.agent, null, e);
    }
  }

  return { prompt: augmented.trim(), refs: results };
}

/**
 * Filter tools based on an agent's tool configuration.
 * @param {Array<Object>} allTools — Full tool spec array
 * @param {Object} toolConfig — { mode, list, permissionOverrides }
 * @returns {Array<Object>}
 */
export function filterToolsForAgent(allTools, toolConfig) {
  if (!toolConfig) return [...allTools];
  if (toolConfig.mode === 'all') return [...allTools];
  if (toolConfig.mode === 'none') return [];
  if (toolConfig.mode === 'allowlist') {
    return allTools.filter(t => toolConfig.list.includes(t.name));
  }
  if (toolConfig.mode === 'blocklist') {
    return allTools.filter(t => !toolConfig.list.includes(t.name));
  }
  return [...allTools];
}
