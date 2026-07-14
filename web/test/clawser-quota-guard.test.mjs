// Run with: node --import ./web/test/_setup-globals.mjs --test web/test/clawser-quota-guard.test.mjs
import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import { guardBeforeWrite, resetQuotaWarningState, evictOldestSnapshots } from '../clawser-quota-guard.mjs';

const quotaResult = (percent) => ({
  usage: percent, quota: 100, percent, warning: percent >= 80, critical: percent >= 95,
});

describe('guardBeforeWrite', () => {
  beforeEach(() => resetQuotaWarningState());

  it('allows writes when usage is low', async () => {
    const result = await guardBeforeWrite(1024, 'vault-write', { checkQuotaFn: async () => quotaResult(10) });
    assert.equal(result.ok, true);
    assert.equal(result.warned, false);
  });

  it('denies writes at critical usage', async () => {
    const result = await guardBeforeWrite(1024, 'vault-write', { checkQuotaFn: async () => quotaResult(96) });
    assert.equal(result.ok, false);
    assert.match(result.reason, /storage.*full|quota/i);
  });

  it('allows but flags a warning at the warning threshold, once per session', async () => {
    const checkQuotaFn = async () => quotaResult(85);
    const first = await guardBeforeWrite(1024, 'snapshot', { checkQuotaFn });
    assert.equal(first.ok, true);
    assert.equal(first.warned, true);

    const second = await guardBeforeWrite(1024, 'snapshot', { checkQuotaFn });
    assert.equal(second.ok, true);
    assert.equal(second.warned, false, 'warning fires once until usage drops below threshold');
  });

  it('re-arms the warning after usage drops back under the threshold', async () => {
    let percent = 85;
    const checkQuotaFn = async () => quotaResult(percent);
    await guardBeforeWrite(1, 'x', { checkQuotaFn }); // first warn
    percent = 50;
    await guardBeforeWrite(1, 'x', { checkQuotaFn }); // drops below — rearms
    percent = 85;
    const rewarned = await guardBeforeWrite(1, 'x', { checkQuotaFn });
    assert.equal(rewarned.warned, true);
  });

  it('runs eviction once when warning first fires, if provided', async () => {
    const calls = [];
    await guardBeforeWrite(1, 'snapshot', {
      checkQuotaFn: async () => quotaResult(85),
      onWarning: async () => { calls.push('evicted'); },
    });
    assert.deepEqual(calls, ['evicted']);
  });

  it('tolerates a missing navigator.storage (checkQuota default) without throwing', async () => {
    // No checkQuotaFn override — falls back to the real checkQuota, which
    // itself degrades gracefully when navigator.storage is unavailable.
    const result = await guardBeforeWrite(1, 'x');
    assert.equal(typeof result.ok, 'boolean');
  });
});

describe('evictOldestSnapshots', () => {
  const makeSnapshot = (id, timestamp) => ({ id, timestamp });

  it('does nothing when quota is not in warning range', async () => {
    const mgr = {
      listSnapshots: async () => [makeSnapshot('a', 3), makeSnapshot('b', 2), makeSnapshot('c', 1)],
      deleteSnapshot: async () => true,
    };
    const pruned = await evictOldestSnapshots(mgr, { checkQuotaFn: async () => quotaResult(10) });
    assert.deepEqual(pruned, []);
  });

  it('prunes oldest-first while keeping the minimum and stops once quota clears', async () => {
    const deleted = [];
    let percent = 90;
    const mgr = {
      listSnapshots: async () => [makeSnapshot('newest', 3), makeSnapshot('mid', 2), makeSnapshot('oldest', 1)],
      deleteSnapshot: async (id) => { deleted.push(id); percent = 40; return true; }, // one delete clears pressure
    };
    const pruned = await evictOldestSnapshots(mgr, {
      keepMinimum: 1,
      checkQuotaFn: async () => quotaResult(percent),
    });
    assert.deepEqual(pruned, ['oldest']);
    assert.deepEqual(deleted, ['oldest']);
  });

  it('never prunes below keepMinimum even under sustained pressure', async () => {
    const mgr = {
      listSnapshots: async () => [makeSnapshot('a', 3), makeSnapshot('b', 2), makeSnapshot('c', 1)],
      deleteSnapshot: async () => true,
    };
    const pruned = await evictOldestSnapshots(mgr, {
      keepMinimum: 2,
      checkQuotaFn: async () => quotaResult(99), // never clears
    });
    assert.deepEqual(pruned, ['c']); // only the one beyond keepMinimum=2
  });

  it('respects maxToPrune as a safety cap', async () => {
    const snaps = Array.from({ length: 10 }, (_, i) => makeSnapshot(`s${i}`, 10 - i));
    const mgr = {
      listSnapshots: async () => snaps,
      deleteSnapshot: async () => true,
    };
    const pruned = await evictOldestSnapshots(mgr, {
      keepMinimum: 0, maxToPrune: 2,
      checkQuotaFn: async () => quotaResult(99),
    });
    assert.equal(pruned.length, 2);
  });
});
