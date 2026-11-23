import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assessCoverage, summarizeCoverage, type WindowSnapshot } from '../src/index.js';
const window: WindowSnapshot = { live: true, openedHeight: '1000', expiryHeight: '3000', remainingBlocks: '2000', remainingTxs: '2',
  remainingValueUqor: '200000', allowedTargets: [], nativeOnly: true };
const base = { retired: false, window, balanceWei: 150000000000000000n, baselineWei: 150000000000000000n,
  toleranceBps: 100n, feePerGasWei: 225000000000n, transferTargetVerified: true };
test('coverage separates expiry, scope, fee/value capacity and unknown RPC state', () => {
  assert.equal(assessCoverage(base).status, 'Covered');
  assert.equal(assessCoverage({ ...base, window: { ...window, remainingBlocks: '600' } }).status, 'Expiring');
  for (const change of [{ live: false }, { remainingBlocks: '0' }, { remainingTxs: '0' }, { remainingValueUqor: '1' }])
    assert.equal(assessCoverage({ ...base, window: { ...window, ...change } }).status, 'Lapsed');
  assert.equal(assessCoverage({ ...base, transferTargetVerified: null }).status, 'Unknown');
  assert.equal(assessCoverage({ ...base, window: null }).status, 'Unknown');
  assert.equal(assessCoverage({ ...base, retired: true }).status, 'Retired');
});
test('threshold/margin count only intact covered canaries; expiry never becomes a drain alarm', () => {
  const healthy = { retired: false, drained: false, coverage: assessCoverage(base) };
  const lapsed = { ...healthy, coverage: assessCoverage({ ...base, window: { ...window, live: false } }) };
  const drained = { ...healthy, drained: true };
  assert.equal(summarizeCoverage([healthy, healthy, healthy], 2).degraded, false);
  const marginLost = summarizeCoverage([healthy, healthy, lapsed], 2);
  assert.equal(marginLost.tripFeasible, true); assert.equal(marginLost.degraded, true);
  const blind = summarizeCoverage([healthy, lapsed, drained], 2);
  assert.equal(blind.tripFeasible, false); assert.equal(blind.covered, 1);
  assert.equal(blind.lapsed, 1); assert.equal(lapsed.drained, false);
});
