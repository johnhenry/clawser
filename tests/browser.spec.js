// tests/browser.spec.js — Playwright CI runner for Clawser browser test suite
import { test, expect } from '@playwright/test';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';

const RESULTS_DIR = join(process.cwd(), 'test-results');
const BASELINE_PATH = join(RESULTS_DIR, 'bench-baseline.json');
const CURRENT_PATH = join(RESULTS_DIR, 'bench-current.json');
const REGRESSION_THRESHOLD = 0.20; // 20% degradation threshold

test('test.html — all tests pass', async ({ page }) => {
  const consoleMessages = [];
  page.on('console', msg => consoleMessages.push(msg.text()));

  await page.goto('/test.html');

  // Wait for #testResults element (created after all tests finish)
  // Element has display:none, so wait for 'attached' state not 'visible'
  await page.waitForSelector('#testResults', { state: 'attached', timeout: 90_000 });

  const json = await page.textContent('#testResults');
  const results = JSON.parse(json);

  console.log(`Tests: ${results.passed} passed, ${results.failed} failed, ${results.total} total (${results.duration}ms)`);

  // Check for CI marker
  const hasPass = consoleMessages.some(m => m.includes('__TEST_RESULT__:PASS'));
  const hasFail = consoleMessages.some(m => m.includes('__TEST_RESULT__:FAIL'));

  expect(results.failed).toBe(0);
  expect(hasPass || !hasFail).toBeTruthy();
});

test('bench.html — benchmarks complete without error', async ({ page }) => {
  const errors = [];
  const consoleMessages = [];
  page.on('pageerror', err => errors.push(err.message));
  page.on('console', msg => consoleMessages.push(msg.text()));

  await page.goto('/bench.html');

  // Wait for structured results element (Gap 7.2b)
  // Element has display:none, so wait for 'attached' state not 'visible'
  await page.waitForSelector('#benchResults', { state: 'attached', timeout: 30_000 });

  // No unhandled errors during benchmark
  expect(errors.length).toBe(0);

  // Verify bench completion marker
  const hasDone = consoleMessages.some(m => m.includes('__BENCH_RESULT__:DONE'));
  expect(hasDone).toBeTruthy();

  // Parse and save structured results
  const json = await page.textContent('#benchResults');
  const results = JSON.parse(json);

  console.log(`Benchmarks: ${results.total} completed in ${results.totalDurationMs.toFixed(1)}ms`);
  for (const b of results.benchmarks) {
    console.log(`  ${b.name}: ${b.durationMs.toFixed(2)}ms (${b.opsPerSec} ops/sec)`);
  }

  // Save current results for CI artifact
  if (!existsSync(RESULTS_DIR)) mkdirSync(RESULTS_DIR, { recursive: true });
  writeFileSync(CURRENT_PATH, JSON.stringify(results, null, 2));
});

test('bench.html — regression detection', async () => {
  // Skip if no baseline or current results exist
  if (!existsSync(CURRENT_PATH)) {
    test.skip();
    return;
  }

  const current = JSON.parse(readFileSync(CURRENT_PATH, 'utf-8'));

  // If no baseline exists, save current as baseline and pass
  if (!existsSync(BASELINE_PATH)) {
    writeFileSync(BASELINE_PATH, JSON.stringify(current, null, 2));
    console.log('No baseline found — saving current results as baseline.');
    return;
  }

  const baseline = JSON.parse(readFileSync(BASELINE_PATH, 'utf-8'));
  const regressions = [];

  // Compare each benchmark against baseline
  for (const curr of current.benchmarks) {
    const base = baseline.benchmarks.find(b => b.name === curr.name);
    if (!base) continue; // New benchmark, no comparison possible

    const baseDuration = base.durationMs;
    const currDuration = curr.durationMs;

    if (baseDuration > 0) {
      const degradation = (currDuration - baseDuration) / baseDuration;
      if (degradation > REGRESSION_THRESHOLD) {
        regressions.push({
          name: curr.name,
          baseline: baseDuration.toFixed(2),
          current: currDuration.toFixed(2),
          degradation: `${(degradation * 100).toFixed(1)}%`,
        });
      }
    }
  }

  if (regressions.length > 0) {
    console.log('\nPerformance regressions detected (>20% degradation):');
    for (const r of regressions) {
      console.log(`  ${r.name}: ${r.baseline}ms → ${r.current}ms (${r.degradation} slower)`);
    }
  } else {
    console.log('No performance regressions detected.');
  }

  // Fail if any regressions found
  expect(regressions).toEqual([]);
});
