// Run with: node --import ./web/test/_setup-globals.mjs --test web/test/clawser-integration-calendar.test.mjs
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  CalendarAwarenessTool,
  CalendarFreeBusyTool,
  CalendarQuickAddTool,
} from '../clawser-integration-calendar.js';

function mockCalendarList(events) {
  return {
    execute: async (params) => ({
      success: true,
      output: JSON.stringify(events),
    }),
  };
}

function mockCalendarCreate(result) {
  return {
    execute: async (params) => ({
      success: true,
      output: result,
    }),
  };
}

describe('Calendar integration tool basics', () => {
  const tools = [
    new CalendarAwarenessTool(mockCalendarList([])),
    new CalendarFreeBusyTool(mockCalendarList([])),
    new CalendarQuickAddTool(mockCalendarCreate('ok')),
  ];

  it('all have unique names starting with calendar_', () => {
    const names = tools.map(t => t.name);
    assert.equal(new Set(names).size, 3);
    for (const n of names) assert.ok(n.startsWith('calendar_'), n);
  });

  it('all have descriptions and schemas', () => {
    for (const t of tools) {
      assert.ok(t.description.length > 0);
      assert.equal(t.schema.type, 'object');
    }
  });
});

describe('CalendarAwarenessTool', () => {
  it('summarizes upcoming events', async () => {
    const events = [
      { summary: 'Standup', start: '2026-03-01T09:00:00Z', end: '2026-03-01T09:15:00Z' },
      { summary: 'Lunch', start: '2026-03-01T12:00:00Z', end: '2026-03-01T13:00:00Z' },
    ];
    const tool = new CalendarAwarenessTool(mockCalendarList(events));
    const result = await tool.execute({ hours_ahead: 8 });
    assert.equal(result.success, true);
    assert.ok(result.output.includes('Standup'));
    assert.ok(result.output.includes('2 events'));
  });

  it('returns no events message when empty', async () => {
    const tool = new CalendarAwarenessTool(mockCalendarList([]));
    const result = await tool.execute({});
    assert.equal(result.success, true);
    assert.ok(result.output.includes('No upcoming events'));
  });
});

describe('CalendarFreeBusyTool', () => {
  it('identifies free time slots', async () => {
    const events = [
      { summary: 'Meeting', start: '2026-03-01T10:00:00Z', end: '2026-03-01T11:00:00Z' },
    ];
    const tool = new CalendarFreeBusyTool(mockCalendarList(events));
    const result = await tool.execute({ date: '2026-03-01', work_start: 9, work_end: 17 });
    assert.equal(result.success, true);
    assert.ok(result.output.includes('Busy') || result.output.includes('Free'));
  });
});

describe('CalendarQuickAddTool', () => {
  it('parses natural language and creates event', async () => {
    const tool = new CalendarQuickAddTool(mockCalendarCreate('Created event evt_1'));
    const result = await tool.execute({ text: 'Meeting with Bob tomorrow at 3pm for 1 hour' });
    assert.equal(result.success, true);
    assert.ok(result.output.includes('Created') || result.output.includes('event'));
  });
});
