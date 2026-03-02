// clawser-integration-slack.js — Slack integration wrapper tools
//
// Higher-level tools wrapping the base Slack tools (SlackChannelsTool, SlackPostTool,
// SlackHistoryTool) for agent-friendly operations like monitoring and drafting responses.
//
// Tools:
//   SlackMonitorTool       — Monitor recent activity across multiple channels
//   SlackDraftResponseTool — Draft and send a response in a channel or thread

// ── SlackMonitorTool ──────────────────────────────────────────────

export class SlackMonitorTool {
  #slackHistory;
  #slackChannels;

  /**
   * @param {object} slackHistoryTool  - A SlackHistoryTool instance (or compatible)
   * @param {object} slackChannelsTool - A SlackChannelsTool instance (or compatible)
   */
  constructor(slackHistoryTool, slackChannelsTool) {
    this.#slackHistory = slackHistoryTool;
    this.#slackChannels = slackChannelsTool;
  }

  get name() { return 'slack_integration_monitor'; }
  get description() { return 'Monitor recent activity across specified Slack channels, providing an activity digest.'; }
  get schema() {
    return {
      type: 'object',
      properties: {
        channels: { type: 'array', items: { type: 'string' }, description: 'Channel IDs to monitor (omit for all channels)' },
        limit: { type: 'number', description: 'Max messages per channel (default: 10)' },
        since_minutes: { type: 'number', description: 'Only show messages from last N minutes (default: 60)' },
      },
      required: [],
    };
  }

  async execute({ channels, limit = 10, since_minutes = 60 } = {}) {
    try {
      // Get channel list if not specified
      let targetChannels = channels;
      if (!targetChannels || targetChannels.length === 0) {
        const chResult = await this.#slackChannels.execute({});
        if (chResult.success) {
          const allChannels = JSON.parse(chResult.output);
          targetChannels = allChannels.slice(0, 5).map(c => c.id);
        } else {
          return chResult;
        }
      }

      // Get channel name mapping
      const chResult = await this.#slackChannels.execute({});
      const channelMap = new Map();
      if (chResult.success) {
        for (const ch of JSON.parse(chResult.output)) {
          channelMap.set(ch.id, ch.name);
        }
      }

      // Calculate oldest timestamp
      const oldest = String((Date.now() - since_minutes * 60 * 1000) / 1000);

      const digest = [];
      for (const channelId of targetChannels) {
        const histResult = await this.#slackHistory.execute({ channel: channelId, limit, oldest });
        if (!histResult.success) continue;

        const messages = JSON.parse(histResult.output);
        const channelName = channelMap.get(channelId) || channelId;

        if (messages.length > 0) {
          digest.push({
            channel: channelName,
            channel_id: channelId,
            message_count: messages.length,
            messages: messages.map(m => ({
              user: m.user || 'bot',
              text: (m.text || '').slice(0, 200),
              ts: m.ts,
            })),
          });
        }
      }

      if (digest.length === 0) {
        return { success: true, output: `No recent activity in the last ${since_minutes} minutes.` };
      }

      const lines = [`Activity digest (last ${since_minutes} min):`];
      for (const ch of digest) {
        lines.push('', `#${ch.channel} (${ch.message_count} messages):`);
        for (const m of ch.messages) {
          lines.push(`  [${m.user}] ${m.text}`);
        }
      }

      return { success: true, output: lines.join('\n') };
    } catch (e) {
      return { success: false, output: '', error: e.message };
    }
  }
}

// ── SlackDraftResponseTool ────────────────────────────────────────

export class SlackDraftResponseTool {
  #slackPost;

  /**
   * @param {object} slackPostTool - A SlackPostTool instance (or compatible)
   */
  constructor(slackPostTool) {
    this.#slackPost = slackPostTool;
  }

  get name() { return 'slack_integration_draft_response'; }
  get description() { return 'Draft and send a Slack response to a channel or thread.'; }
  get schema() {
    return {
      type: 'object',
      properties: {
        channel: { type: 'string', description: 'Channel ID to post in' },
        text: { type: 'string', description: 'Response message text' },
        thread_ts: { type: 'string', description: 'Thread timestamp to reply in (for threaded responses)' },
        tone: { type: 'string', description: 'Desired tone: professional, casual, concise (hint for agent)' },
      },
      required: ['channel', 'text'],
    };
  }

  async execute({ channel, text, thread_ts, tone }) {
    try {
      const params = { channel, text };
      if (thread_ts) params.thread_ts = thread_ts;

      const result = await this.#slackPost.execute(params);
      if (!result.success) return result;

      const threadLabel = thread_ts ? ' (threaded reply)' : '';
      return { success: true, output: `Slack response sent${threadLabel}. ${result.output}` };
    } catch (e) {
      return { success: false, output: '', error: e.message };
    }
  }
}
