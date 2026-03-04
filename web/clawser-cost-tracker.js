/**
 * clawser-cost-tracker.js — Rolling window cost recording and aggregation.
 *
 * Tracks per-call costs with model/token attribution. Persists to localStorage
 * with a 30-day rolling window and 10K record cap. Provides daily totals,
 * per-model breakdown, and hourly bucketing for dashboard visualization.
 */

const MAX_RECORDS = 10_000;
const LS_PREFIX = 'clawser_cost_tracker_';

export class CostTracker {
  /** @type {string} */
  #wsId;
  /** @type {Array<{model: string, tokens: {input_tokens: number, output_tokens: number}, costCents: number, ts: number}>} */
  #records;

  constructor(wsId) {
    this.#wsId = wsId;
    this.#records = this.#load();
  }

  /** Record a cost event. */
  recordCost(model, tokens, costCents, ts) {
    this.#records.push({
      model,
      tokens: { input_tokens: tokens.input_tokens || 0, output_tokens: tokens.output_tokens || 0 },
      costCents,
      ts: ts ?? Date.now(),
    });
    // Cap at MAX_RECORDS, trim oldest
    if (this.#records.length > MAX_RECORDS) {
      this.#records = this.#records.slice(this.#records.length - MAX_RECORDS);
    }
    this.#save();
  }

  /** Get all records (read-only copy). */
  getRecords() {
    return this.#records.slice();
  }

  /**
   * Get daily cost totals for the last N days.
   * @param {number} days
   * @returns {Array<{date: string, costCents: number, tokens: number}>}
   */
  getDailyTotals(days) {
    const cutoff = Date.now() - days * 86_400_000;
    const recent = this.#records.filter(r => r.ts >= cutoff);
    if (recent.length === 0) return [];

    const byDay = new Map();
    for (const r of recent) {
      const date = new Date(r.ts).toISOString().slice(0, 10);
      const entry = byDay.get(date) || { date, costCents: 0, tokens: 0 };
      entry.costCents += r.costCents;
      entry.tokens += (r.tokens.input_tokens + r.tokens.output_tokens);
      byDay.set(date, entry);
    }
    return [...byDay.values()].sort((a, b) => a.date.localeCompare(b.date));
  }

  /**
   * Get per-model cost breakdown for the last N days.
   * @param {number} days
   * @returns {Object<string, {costCents: number, totalTokens: number, calls: number}>}
   */
  getPerModelBreakdown(days) {
    const cutoff = Date.now() - days * 86_400_000;
    const recent = this.#records.filter(r => r.ts >= cutoff);
    if (recent.length === 0) return {};

    const byModel = {};
    for (const r of recent) {
      if (!byModel[r.model]) byModel[r.model] = { costCents: 0, totalTokens: 0, calls: 0 };
      byModel[r.model].costCents += r.costCents;
      byModel[r.model].totalTokens += (r.tokens.input_tokens + r.tokens.output_tokens);
      byModel[r.model].calls += 1;
    }
    return byModel;
  }

  /**
   * Get hourly cost buckets for the last N hours.
   * @param {number} hours
   * @returns {Array<{hour: string, costCents: number, tokens: number}>}
   */
  getHourlyBuckets(hours) {
    const cutoff = Date.now() - hours * 3_600_000;
    const recent = this.#records.filter(r => r.ts >= cutoff);
    if (recent.length === 0) return [];

    const byHour = new Map();
    for (const r of recent) {
      const d = new Date(r.ts);
      const hour = `${d.toISOString().slice(0, 10)} ${String(d.getUTCHours()).padStart(2, '0')}:00`;
      const entry = byHour.get(hour) || { hour, costCents: 0, tokens: 0 };
      entry.costCents += r.costCents;
      entry.tokens += (r.tokens.input_tokens + r.tokens.output_tokens);
      byHour.set(hour, entry);
    }
    return [...byHour.values()].sort((a, b) => a.hour.localeCompare(b.hour));
  }

  /**
   * Get total cost within the last N days.
   * @param {number} days
   * @returns {number} costCents
   */
  getTotalCost(days) {
    const cutoff = Date.now() - days * 86_400_000;
    return this.#records.filter(r => r.ts >= cutoff).reduce((sum, r) => sum + r.costCents, 0);
  }

  /** Remove records older than N days. */
  pruneOlderThan(days) {
    const cutoff = Date.now() - days * 86_400_000;
    this.#records = this.#records.filter(r => r.ts >= cutoff);
    this.#save();
  }

  /** Clear all records. */
  clear() {
    this.#records = [];
    this.#save();
  }

  // ── Persistence ──────────────────────────────────────────────────

  #key() { return `${LS_PREFIX}${this.#wsId}`; }

  #load() {
    try {
      const raw = localStorage.getItem(this.#key());
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch { return []; }
  }

  #save() {
    try {
      localStorage.setItem(this.#key(), JSON.stringify(this.#records));
    } catch (e) {
      console.warn('[clawser] CostTracker save failed:', e);
    }
  }
}
