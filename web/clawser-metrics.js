// clawser-metrics.js — Observability: MetricsCollector + RingBufferLog
//
// Phase 1: Core metrics collection and structured logging
// - MetricsCollector: counters, gauges, histograms with snapshot()
// - RingBufferLog: bounded circular buffer for structured log entries
// - percentile: fast percentile calculation for histograms

// ── Helpers ─────────────────────────────────────────────────────

/**
 * Calculate a percentile from a sorted array.
 * @param {number[]} sorted - Pre-sorted array of values
 * @param {number} p - Percentile (0-100)
 * @returns {number}
 */
export function percentile(sorted, p) {
  if (!sorted.length) return 0;
  if (sorted.length === 1) return sorted[0];
  const idx = (p / 100) * (sorted.length - 1);
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sorted[lo];
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo);
}

// ── MetricsCollector ────────────────────────────────────────────

/**
 * Lightweight metrics collector supporting counters, gauges, and histograms.
 * All data is in-memory and ephemeral; call snapshot() to export.
 */
export class MetricsCollector {
  /** @type {Map<string, number>} Monotonically increasing counters */
  #counters = new Map();

  /** @type {Map<string, number>} Current-value gauges */
  #gauges = new Map();

  /** @type {Map<string, number[]>} Distribution histograms (ring, max 1000) */
  #histograms = new Map();

  /** Maximum observations per histogram */
  #histogramCapacity;

  /**
   * @param {object} [opts]
   * @param {number} [opts.histogramCapacity=1000]
   */
  constructor(opts = {}) {
    this.#histogramCapacity = opts.histogramCapacity || 1000;
  }

  /**
   * Increment a counter by value (default 1).
   * @param {string} name
   * @param {number} [value=1]
   */
  increment(name, value = 1) {
    this.#counters.set(name, (this.#counters.get(name) || 0) + value);
  }

  /**
   * Set a gauge to a specific value.
   * @param {string} name
   * @param {number} value
   */
  gauge(name, value) {
    this.#gauges.set(name, value);
  }

  /**
   * Record an observation in a histogram.
   * @param {string} name
   * @param {number} value
   */
  observe(name, value) {
    if (!this.#histograms.has(name)) this.#histograms.set(name, []);
    const arr = this.#histograms.get(name);
    arr.push(value);
    if (arr.length > this.#histogramCapacity) {
      arr.splice(0, arr.length - this.#histogramCapacity);
    }
  }

  /**
   * Get a counter's current value.
   * @param {string} name
   * @returns {number}
   */
  counter(name) {
    return this.#counters.get(name) || 0;
  }

  /**
   * Get a gauge's current value.
   * @param {string} name
   * @returns {number|undefined}
   */
  getGauge(name) {
    return this.#gauges.get(name);
  }

  /**
   * Get raw histogram observations.
   * @param {string} name
   * @returns {number[]}
   */
  histogram(name) {
    return this.#histograms.get(name) || [];
  }

  /**
   * Export a point-in-time snapshot of all metrics.
   * @returns {object}
   */
  snapshot() {
    const histogramStats = {};
    for (const [name, values] of this.#histograms) {
      if (values.length === 0) {
        histogramStats[name] = { count: 0, min: 0, max: 0, avg: 0, p50: 0, p95: 0, p99: 0 };
        continue;
      }
      const sorted = [...values].sort((a, b) => a - b);
      const sum = values.reduce((a, b) => a + b, 0);
      histogramStats[name] = {
        count: values.length,
        min: sorted[0],
        max: sorted[sorted.length - 1],
        avg: sum / values.length,
        p50: percentile(sorted, 50),
        p95: percentile(sorted, 95),
        p99: percentile(sorted, 99),
      };
    }

    return {
      counters: Object.fromEntries(this.#counters),
      gauges: Object.fromEntries(this.#gauges),
      histograms: histogramStats,
      timestamp: Date.now(),
    };
  }

  /**
   * Reset all metrics.
   */
  reset() {
    this.#counters.clear();
    this.#gauges.clear();
    this.#histograms.clear();
  }

  /**
   * Create a dated rollup of current metrics for time-series storage.
   * @param {string} [date] - ISO date string (defaults to today)
   * @returns {{date: string, counters: object, gauges: object, histograms: object}}
   */
  rollup(date) {
    const snap = this.snapshot();
    return {
      date: date || new Date().toISOString().slice(0, 10),
      counters: snap.counters,
      gauges: snap.gauges,
      histograms: snap.histograms,
    };
  }

  /**
   * Create a scoped view that prefixes all metric names with a namespace.
   * Writes go to the parent collector; snapshot() filters to scoped keys only.
   * @param {string} namespace - Prefix (e.g., 'conv-123', 'goal-abc')
   * @returns {ScopedMetricsView}
   */
  scopedView(namespace) {
    return new ScopedMetricsView(this, namespace);
  }
}

/**
 * Scoped view into a MetricsCollector.
 * Prefixes all metric names with `namespace:` and filters snapshots to scoped keys.
 */
class ScopedMetricsView {
  #parent;
  #prefix;

  constructor(parent, namespace) {
    this.#parent = parent;
    this.#prefix = namespace + ':';
  }

  increment(name, value = 1) { this.#parent.increment(this.#prefix + name, value); }
  gauge(name, value) { this.#parent.gauge(this.#prefix + name, value); }
  observe(name, value) { this.#parent.observe(this.#prefix + name, value); }
  counter(name) { return this.#parent.counter(this.#prefix + name); }
  getGauge(name) { return this.#parent.getGauge(this.#prefix + name); }
  histogram(name) { return this.#parent.histogram(this.#prefix + name); }

  snapshot() {
    const full = this.#parent.snapshot();
    const prefix = this.#prefix;
    const strip = (obj) => {
      const result = {};
      for (const [k, v] of Object.entries(obj)) {
        if (k.startsWith(prefix)) result[k.slice(prefix.length)] = v;
      }
      return result;
    };
    return {
      counters: strip(full.counters),
      gauges: strip(full.gauges),
      histograms: strip(full.histograms),
      timestamp: full.timestamp,
    };
  }
}

// ── MetricsTimeSeries ───────────────────────────────────────────

/**
 * Time-series storage for daily metric rollups.
 * Stores dated snapshots and supports range queries.
 */
export class MetricsTimeSeries {
  /** @type {Map<string, object>} date → rollup data */
  #entries = new Map();

  /** Number of stored rollups. */
  get size() { return this.#entries.size; }

  /**
   * Add a rollup entry.
   * @param {object} rollup - {date, counters, gauges, ...}
   */
  add(rollup) {
    if (!rollup || !rollup.date) return;
    this.#entries.set(rollup.date, rollup);
  }

  /**
   * Query rollups within a date range (inclusive).
   * @param {string} startDate - ISO date string (YYYY-MM-DD)
   * @param {string} endDate - ISO date string (YYYY-MM-DD)
   * @returns {object[]} Matching rollups sorted by date
   */
  query(startDate, endDate) {
    const results = [];
    for (const [date, rollup] of this.#entries) {
      if (date >= startDate && date <= endDate) {
        results.push(rollup);
      }
    }
    return results.sort((a, b) => a.date.localeCompare(b.date));
  }

  /**
   * Export all data as a JSON-serializable array.
   * @returns {object[]}
   */
  export() {
    return [...this.#entries.values()].sort((a, b) => a.date.localeCompare(b.date));
  }

  /**
   * Import rollup data from a JSON array.
   * @param {object[]} data
   */
  import(data) {
    if (!Array.isArray(data)) return;
    for (const rollup of data) {
      if (rollup && rollup.date) {
        this.#entries.set(rollup.date, rollup);
      }
    }
  }

  /**
   * Clear all stored data.
   */
  clear() {
    this.#entries.clear();
  }
}

// ── RingBufferLog ───────────────────────────────────────────────

/**
 * Bounded circular buffer for structured log entries.
 * Entries are stored in a fixed-size array; once full, oldest entries are overwritten.
 *
 * Log levels: 0=debug, 1=info, 2=warn, 3=error
 */
export const LOG_LEVELS = { debug: 0, info: 1, warn: 2, error: 3 };

export class RingBufferLog {
  #buffer;
  #capacity;
  #head = 0;
  #size = 0;
  #seq = 0;

  /**
   * @param {number} [capacity=1000]
   */
  constructor(capacity = 1000) {
    this.#buffer = new Array(capacity);
    this.#capacity = capacity;
  }

  /**
   * Add a log entry.
   * @param {object} entry
   * @param {number} [entry.level=1] - 0=debug, 1=info, 2=warn, 3=error
   * @param {string} [entry.source] - Component name (agent, provider, tool, etc.)
   * @param {string} [entry.message] - Human-readable message
   * @param {object} [entry.data] - Structured data payload
   */
  push(entry) {
    this.#buffer[this.#head] = {
      ...entry,
      timestamp: Date.now(),
      seq: this.#seq++,
    };
    this.#head = (this.#head + 1) % this.#capacity;
    this.#size = Math.min(this.#size + 1, this.#capacity);
  }

  /**
   * Query log entries with optional filters.
   * @param {object} [opts]
   * @param {number} [opts.level] - Minimum log level
   * @param {string} [opts.source] - Source component filter
   * @param {string} [opts.pattern] - Substring match on message
   * @param {number} [opts.limit=100] - Max results
   * @returns {object[]}
   */
  query({ level, source, pattern, limit = 100 } = {}) {
    const entries = this.toArray();
    return entries
      .filter(e => level == null || e.level >= level)
      .filter(e => !source || e.source === source)
      .filter(e => !pattern || e.message?.includes(pattern))
      .slice(-limit);
  }

  /**
   * Get all entries in chronological order.
   * @returns {object[]}
   */
  toArray() {
    if (this.#size < this.#capacity) return this.#buffer.slice(0, this.#size);
    return [
      ...this.#buffer.slice(this.#head),
      ...this.#buffer.slice(0, this.#head),
    ];
  }

  /** Current number of entries stored */
  get size() { return this.#size; }

  /** Maximum capacity */
  get capacity() { return this.#capacity; }

  /** Clear all entries */
  clear() {
    this.#head = 0;
    this.#size = 0;
    this.#seq = 0;
    this.#buffer = new Array(this.#capacity);
  }
}

// ── Metrics Export ──────────────────────────────────────────────

/**
 * Export a metrics snapshot as a simple JSON blob (for download/analysis).
 * @param {object} snapshot - From MetricsCollector.snapshot()
 * @returns {string} Pretty-printed JSON
 */
export function exportMetricsJSON(snapshot) {
  return JSON.stringify(snapshot, null, 2);
}

/**
 * Export a metrics snapshot in OpenTelemetry-compatible JSON format.
 * Maps counters → Sum (monotonic), gauges → Gauge, histograms → Histogram.
 * @param {object} snapshot
 * @param {string} [serviceName='clawser']
 * @returns {object} OTLP-compatible resource metrics structure
 */
export function exportMetricsOTLP(snapshot, serviceName = 'clawser') {
  const timeUnixNano = String(snapshot.timestamp * 1_000_000);
  const metrics = [];

  // Counters → Sum
  for (const [name, value] of Object.entries(snapshot.counters)) {
    metrics.push({
      name,
      sum: {
        dataPoints: [{ asDouble: value, timeUnixNano }],
        aggregationTemporality: 2, // CUMULATIVE
        isMonotonic: true,
      },
    });
  }

  // Gauges
  for (const [name, value] of Object.entries(snapshot.gauges)) {
    metrics.push({
      name,
      gauge: {
        dataPoints: [{ asDouble: value, timeUnixNano }],
      },
    });
  }

  // Histograms
  for (const [name, stats] of Object.entries(snapshot.histograms)) {
    metrics.push({
      name,
      histogram: {
        dataPoints: [{
          count: stats.count,
          sum: stats.avg * stats.count,
          min: stats.min,
          max: stats.max,
          timeUnixNano,
        }],
        aggregationTemporality: 2,
      },
    });
  }

  return {
    resourceMetrics: [{
      resource: {
        attributes: [{ key: 'service.name', value: { stringValue: serviceName } }],
      },
      scopeMetrics: [{
        scope: { name: 'clawser.metrics', version: '1.0.0' },
        metrics,
      }],
    }],
  };
}
