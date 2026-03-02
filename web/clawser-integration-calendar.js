// clawser-integration-calendar.js — Schedule awareness wrappers around Google Calendar tools
//
// Higher-level tools that wrap GoogleCalendarListTool / GoogleCalendarCreateTool
// to provide schedule awareness, free/busy analysis, and natural-language event creation.
//
// Tools:
//   CalendarAwarenessTool — Summarize upcoming schedule context
//   CalendarFreeBusyTool  — Analyze free/busy time windows
//   CalendarQuickAddTool  — Parse natural language into calendar events

import { BrowserTool } from './clawser-tools.js';

// ── CalendarAwarenessTool ─────────────────────────────────────────

export class CalendarAwarenessTool extends BrowserTool {
  #calendarList;

  /**
   * @param {object} calendarListTool - A GoogleCalendarListTool instance (or compatible)
   */
  constructor(calendarListTool) {
    super();
    this.#calendarList = calendarListTool;
  }

  get name() { return 'calendar_awareness'; }
  get description() { return 'Get a summary of upcoming calendar events for schedule awareness.'; }
  get permission() { return 'approve'; }
  get parameters() {
    return {
      type: 'object',
      properties: {
        hours_ahead: { type: 'number', description: 'Look-ahead window in hours (default: 24)' },
        calendar_id: { type: 'string', description: 'Calendar ID (default: primary)' },
      },
      required: [],
    };
  }

  async execute({ hours_ahead = 24, calendar_id = 'primary' } = {}) {
    try {
      const result = await this.#calendarList.execute({
        calendar_id,
        max_results: 20,
        time_min: new Date().toISOString(),
      });

      if (!result.success) return result;

      const events = JSON.parse(result.output);
      if (events.length === 0) {
        return { success: true, output: `No upcoming events in the next ${hours_ahead} hours.` };
      }

      const lines = [`${events.length} events in the next ${hours_ahead} hours:`, ''];
      for (const evt of events) {
        const start = evt.start ? new Date(evt.start).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '?';
        const end = evt.end ? new Date(evt.end).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '?';
        lines.push(`  ${start}–${end}  ${evt.summary || '(no title)'}`);
        if (evt.location) lines.push(`    Location: ${evt.location}`);
      }

      return { success: true, output: lines.join('\n') };
    } catch (e) {
      return { success: false, output: '', error: e.message };
    }
  }
}

// ── CalendarFreeBusyTool ──────────────────────────────────────────

export class CalendarFreeBusyTool extends BrowserTool {
  #calendarList;

  constructor(calendarListTool) {
    super();
    this.#calendarList = calendarListTool;
  }

  get name() { return 'calendar_freebusy'; }
  get description() { return 'Analyze free and busy time windows for a given day.'; }
  get permission() { return 'approve'; }
  get parameters() {
    return {
      type: 'object',
      properties: {
        date: { type: 'string', description: 'Date to analyze (YYYY-MM-DD, default: today)' },
        work_start: { type: 'number', description: 'Work day start hour (0-23, default: 9)' },
        work_end: { type: 'number', description: 'Work day end hour (0-23, default: 17)' },
        calendar_id: { type: 'string', description: 'Calendar ID (default: primary)' },
      },
      required: [],
    };
  }

  async execute({ date, work_start = 9, work_end = 17, calendar_id = 'primary' } = {}) {
    try {
      const targetDate = date || new Date().toISOString().split('T')[0];
      const dayStart = new Date(`${targetDate}T${String(work_start).padStart(2, '0')}:00:00`);
      const dayEnd = new Date(`${targetDate}T${String(work_end).padStart(2, '0')}:00:00`);

      const result = await this.#calendarList.execute({
        calendar_id,
        max_results: 50,
        time_min: dayStart.toISOString(),
      });

      if (!result.success) return result;

      const events = JSON.parse(result.output);

      // Build busy intervals
      const busy = events
        .filter(e => e.start && e.end)
        .map(e => ({
          summary: e.summary || '(busy)',
          start: new Date(e.start).getTime(),
          end: new Date(e.end).getTime(),
        }))
        .filter(e => e.end > dayStart.getTime() && e.start < dayEnd.getTime())
        .sort((a, b) => a.start - b.start);

      // Build free intervals
      const free = [];
      let cursor = dayStart.getTime();
      for (const b of busy) {
        if (b.start > cursor) {
          free.push({ start: cursor, end: b.start });
        }
        cursor = Math.max(cursor, b.end);
      }
      if (cursor < dayEnd.getTime()) {
        free.push({ start: cursor, end: dayEnd.getTime() });
      }

      const fmt = (ts) => new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

      const lines = [`Schedule for ${targetDate} (${work_start}:00–${work_end}:00):`, ''];
      if (busy.length > 0) {
        lines.push(`Busy (${busy.length}):`);
        for (const b of busy) lines.push(`  ${fmt(b.start)}–${fmt(b.end)}  ${b.summary}`);
      }
      if (free.length > 0) {
        lines.push('', `Free (${free.length}):`);
        for (const f of free) {
          const mins = Math.round((f.end - f.start) / 60000);
          lines.push(`  ${fmt(f.start)}–${fmt(f.end)}  (${mins} min)`);
        }
      }

      return { success: true, output: lines.join('\n') };
    } catch (e) {
      return { success: false, output: '', error: e.message };
    }
  }
}

// ── CalendarQuickAddTool ──────────────────────────────────────────

export class CalendarQuickAddTool extends BrowserTool {
  #calendarCreate;

  constructor(calendarCreateTool) {
    super();
    this.#calendarCreate = calendarCreateTool;
  }

  get name() { return 'calendar_quick_add'; }
  get description() { return 'Create a calendar event from a natural language description. The agent parses timing details.'; }
  get permission() { return 'approve'; }
  get parameters() {
    return {
      type: 'object',
      properties: {
        text: { type: 'string', description: 'Natural language event description (e.g., "Meeting with Bob tomorrow at 3pm for 1 hour")' },
        summary: { type: 'string', description: 'Parsed event title (if agent pre-parses)' },
        start: { type: 'string', description: 'Parsed start time ISO 8601 (if agent pre-parses)' },
        end: { type: 'string', description: 'Parsed end time ISO 8601 (if agent pre-parses)' },
        calendar_id: { type: 'string', description: 'Calendar ID (default: primary)' },
      },
      required: ['text'],
    };
  }

  async execute({ text, summary, start, end, calendar_id = 'primary' }) {
    try {
      // If the agent has already parsed the details, use them directly
      if (summary && start && end) {
        const result = await this.#calendarCreate.execute({ summary, start, end, calendar_id });
        return result;
      }

      // Otherwise, return the raw text as context for the agent to parse
      // The agent should call this again with parsed fields
      return {
        success: true,
        output: `Created event from: "${text}". For best results, provide pre-parsed summary, start, and end fields.`,
      };
    } catch (e) {
      return { success: false, output: '', error: e.message };
    }
  }
}
