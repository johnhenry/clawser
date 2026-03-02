/**
 * Tests for clawser-ui-charts — Pure CSS chart rendering.
 */
// Run with: node --import ./web/test/_setup-globals.mjs --test web/test/clawser-ui-charts.test.mjs
import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { renderBarChart, renderTimeSeriesChart, renderCostBreakdown } from '../clawser-ui-charts.js';

// Helper to create a mock container element
function createContainer() {
  const el = {
    innerHTML: '',
    children: [],
    className: '',
    appendChild(child) { this.children.push(child); },
    querySelectorAll() { return []; },
  };
  return el;
}

describe('renderBarChart', () => {
  it('renders bars for each data point', () => {
    const el = createContainer();
    const data = [
      { label: 'Mon', value: 10 },
      { label: 'Tue', value: 20 },
      { label: 'Wed', value: 5 },
    ];
    renderBarChart(el, data);
    assert.ok(el.innerHTML.includes('chart-bar'));
    assert.ok(el.innerHTML.includes('Mon'));
    assert.ok(el.innerHTML.includes('Tue'));
    assert.ok(el.innerHTML.includes('Wed'));
  });

  it('handles empty data', () => {
    const el = createContainer();
    renderBarChart(el, []);
    assert.ok(el.innerHTML.includes('No data'));
  });

  it('normalizes bar heights to max value', () => {
    const el = createContainer();
    const data = [
      { label: 'A', value: 100 },
      { label: 'B', value: 50 },
    ];
    renderBarChart(el, data);
    // The tallest bar should be 100%
    assert.ok(el.innerHTML.includes('100%'));
    assert.ok(el.innerHTML.includes('50%'));
  });

  it('applies custom options', () => {
    const el = createContainer();
    const data = [{ label: 'A', value: 10 }];
    renderBarChart(el, data, { title: 'Test Chart', color: 'var(--green)' });
    assert.ok(el.innerHTML.includes('Test Chart'));
    assert.ok(el.innerHTML.includes('var(--green)'));
  });
});

describe('renderTimeSeriesChart', () => {
  it('renders time series with multiple data points', () => {
    const el = createContainer();
    const series = [
      { label: '12:00', value: 5 },
      { label: '13:00', value: 10 },
      { label: '14:00', value: 3 },
    ];
    renderTimeSeriesChart(el, series);
    assert.ok(el.innerHTML.includes('chart-ts'));
    assert.ok(el.innerHTML.includes('12:00'));
  });

  it('handles empty series', () => {
    const el = createContainer();
    renderTimeSeriesChart(el, []);
    assert.ok(el.innerHTML.includes('No data'));
  });

  it('supports title option', () => {
    const el = createContainer();
    renderTimeSeriesChart(el, [{ label: 'x', value: 1 }], { title: 'Tokens Over Time' });
    assert.ok(el.innerHTML.includes('Tokens Over Time'));
  });
});

describe('renderCostBreakdown', () => {
  it('renders per-model breakdown', () => {
    const el = createContainer();
    const perModel = {
      'gpt-4o': { costCents: 5.0, totalTokens: 1000, calls: 3 },
      'claude-sonnet-4-6': { costCents: 2.5, totalTokens: 500, calls: 1 },
    };
    renderCostBreakdown(el, perModel);
    assert.ok(el.innerHTML.includes('gpt-4o'));
    assert.ok(el.innerHTML.includes('claude-sonnet'));
    assert.ok(el.innerHTML.includes('cost-breakdown'));
  });

  it('handles empty breakdown', () => {
    const el = createContainer();
    renderCostBreakdown(el, {});
    assert.ok(el.innerHTML.includes('No cost data'));
  });

  it('sorts by cost descending', () => {
    const el = createContainer();
    const perModel = {
      'cheap': { costCents: 1.0, totalTokens: 100, calls: 1 },
      'expensive': { costCents: 10.0, totalTokens: 500, calls: 5 },
    };
    renderCostBreakdown(el, perModel);
    // expensive should appear before cheap
    const expIdx = el.innerHTML.indexOf('expensive');
    const cheapIdx = el.innerHTML.indexOf('cheap');
    assert.ok(expIdx < cheapIdx, 'expensive model should be listed first');
  });

  it('shows percentage of total', () => {
    const el = createContainer();
    const perModel = {
      'a': { costCents: 75, totalTokens: 100, calls: 1 },
      'b': { costCents: 25, totalTokens: 100, calls: 1 },
    };
    renderCostBreakdown(el, perModel);
    assert.ok(el.innerHTML.includes('75'));
    assert.ok(el.innerHTML.includes('25'));
  });
});
