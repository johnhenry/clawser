/**
 * Tests for CostTracker — rolling window cost recording and aggregation.
 */
// Run with: node --import ./web/test/_setup-globals.mjs --test web/test/clawser-cost-tracker.test.mjs
import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { CostTracker } from '../clawser-cost-tracker.js';

describe('CostTracker', () => {
  let tracker;

  beforeEach(() => {
    localStorage.clear();
    tracker = new CostTracker('test-ws');
  });

  describe('constructor', () => {
    it('creates with empty records', () => {
      assert.deepStrictEqual(tracker.getRecords(), []);
    });

    it('restores from localStorage', () => {
      tracker.recordCost('gpt-4o', { input_tokens: 100, output_tokens: 50 }, 0.35, Date.now());
      const tracker2 = new CostTracker('test-ws');
      assert.strictEqual(tracker2.getRecords().length, 1);
    });
  });

  describe('recordCost', () => {
    it('appends a record with all fields', () => {
      const ts = Date.now();
      tracker.recordCost('gpt-4o', { input_tokens: 100, output_tokens: 50 }, 0.35, ts);
      const records = tracker.getRecords();
      assert.strictEqual(records.length, 1);
      assert.strictEqual(records[0].model, 'gpt-4o');
      assert.strictEqual(records[0].costCents, 0.35);
      assert.strictEqual(records[0].tokens.input_tokens, 100);
      assert.strictEqual(records[0].tokens.output_tokens, 50);
      assert.strictEqual(records[0].ts, ts);
    });

    it('defaults timestamp to Date.now()', () => {
      const before = Date.now();
      tracker.recordCost('echo', { input_tokens: 0, output_tokens: 0 }, 0);
      const after = Date.now();
      const ts = tracker.getRecords()[0].ts;
      assert.ok(ts >= before && ts <= after);
    });

    it('caps at 10000 records', () => {
      for (let i = 0; i < 10050; i++) {
        tracker.recordCost('echo', { input_tokens: 1, output_tokens: 1 }, 0.01, i);
      }
      assert.strictEqual(tracker.getRecords().length, 10000);
      // oldest should be trimmed
      assert.strictEqual(tracker.getRecords()[0].ts, 50);
    });

    it('persists to localStorage', () => {
      tracker.recordCost('gpt-4o', { input_tokens: 10, output_tokens: 5 }, 0.1);
      const raw = localStorage.getItem('clawser_cost_tracker_test-ws');
      assert.ok(raw);
      const parsed = JSON.parse(raw);
      assert.strictEqual(parsed.length, 1);
    });
  });

  describe('getDailyTotals', () => {
    it('returns empty array for no records', () => {
      assert.deepStrictEqual(tracker.getDailyTotals(7), []);
    });

    it('groups costs by day', () => {
      const now = Date.now();
      const day = 86400000;
      tracker.recordCost('gpt-4o', { input_tokens: 100, output_tokens: 50 }, 1.0, now);
      tracker.recordCost('gpt-4o', { input_tokens: 100, output_tokens: 50 }, 2.0, now);
      tracker.recordCost('gpt-4o', { input_tokens: 100, output_tokens: 50 }, 3.0, now - day);

      const totals = tracker.getDailyTotals(7);
      assert.ok(totals.length >= 1);
      // Most recent day should have 3.0 total
      const today = totals.find(t => t.date === new Date(now).toISOString().slice(0, 10));
      assert.strictEqual(today.costCents, 3.0);
    });

    it('respects days parameter', () => {
      const now = Date.now();
      const day = 86400000;
      tracker.recordCost('a', { input_tokens: 1, output_tokens: 1 }, 1.0, now - 10 * day);
      tracker.recordCost('b', { input_tokens: 1, output_tokens: 1 }, 2.0, now);

      const totals3 = tracker.getDailyTotals(3);
      // Should only include recent days, not 10 days ago
      const totalCost = totals3.reduce((s, t) => s + t.costCents, 0);
      assert.strictEqual(totalCost, 2.0);
    });
  });

  describe('getPerModelBreakdown', () => {
    it('returns empty object for no records', () => {
      assert.deepStrictEqual(tracker.getPerModelBreakdown(7), {});
    });

    it('groups by model within time window', () => {
      const now = Date.now();
      tracker.recordCost('gpt-4o', { input_tokens: 100, output_tokens: 50 }, 1.0, now);
      tracker.recordCost('gpt-4o', { input_tokens: 200, output_tokens: 100 }, 2.0, now);
      tracker.recordCost('claude-sonnet-4-6', { input_tokens: 50, output_tokens: 25 }, 0.5, now);

      const breakdown = tracker.getPerModelBreakdown(7);
      assert.strictEqual(breakdown['gpt-4o'].costCents, 3.0);
      assert.strictEqual(breakdown['gpt-4o'].totalTokens, 450);
      assert.strictEqual(breakdown['claude-sonnet-4-6'].costCents, 0.5);
      assert.strictEqual(breakdown['claude-sonnet-4-6'].totalTokens, 75);
    });
  });

  describe('getHourlyBuckets', () => {
    it('returns empty array for no records', () => {
      assert.deepStrictEqual(tracker.getHourlyBuckets(24), []);
    });

    it('groups by hour', () => {
      const now = Date.now();
      const hour = 3600000;
      tracker.recordCost('a', { input_tokens: 10, output_tokens: 5 }, 1.0, now);
      tracker.recordCost('b', { input_tokens: 10, output_tokens: 5 }, 2.0, now - hour);

      const buckets = tracker.getHourlyBuckets(24);
      assert.ok(buckets.length >= 1);
      const totalCost = buckets.reduce((s, b) => s + b.costCents, 0);
      assert.strictEqual(totalCost, 3.0);
    });
  });

  describe('getTotalCost', () => {
    it('sums all costs within window', () => {
      const now = Date.now();
      tracker.recordCost('a', { input_tokens: 1, output_tokens: 1 }, 1.5, now);
      tracker.recordCost('b', { input_tokens: 1, output_tokens: 1 }, 2.5, now);
      assert.strictEqual(tracker.getTotalCost(1), 4.0);
    });
  });

  describe('pruneOlderThan', () => {
    it('removes records older than given days', () => {
      const now = Date.now();
      const day = 86400000;
      tracker.recordCost('old', { input_tokens: 1, output_tokens: 1 }, 1.0, now - 40 * day);
      tracker.recordCost('new', { input_tokens: 1, output_tokens: 1 }, 2.0, now);
      tracker.pruneOlderThan(30);
      assert.strictEqual(tracker.getRecords().length, 1);
      assert.strictEqual(tracker.getRecords()[0].model, 'new');
    });
  });

  describe('clear', () => {
    it('removes all records', () => {
      tracker.recordCost('a', { input_tokens: 1, output_tokens: 1 }, 1.0);
      tracker.clear();
      assert.strictEqual(tracker.getRecords().length, 0);
    });
  });
});
