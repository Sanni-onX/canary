export type WindowSnapshot = { live: boolean; openedHeight: string; expiryHeight: string; remainingBlocks: string;
  remainingTxs: string; remainingValueUqor: string; allowedTargets: string[]; nativeOnly: boolean };
export type Coverage = { status: 'Covered' | 'Expiring' | 'Lapsed' | 'Unknown' | 'Retired'; reason: string;
  remainingBlocks: string | null; expiryHeight: string | null; openedHeight: string | null };
export const DEFAULT_EXPIRING_BLOCKS = 600n;

/** Monitoring only: coverage failure never mutates or infers the balance alarm. */
export function assessCoverage(input: { retired: boolean; window: WindowSnapshot | null;
  balanceWei: bigint; baselineWei: bigint; toleranceBps: bigint; feePerGasWei: bigint;
  transferTargetVerified: boolean | null; expiringBlocks?: bigint }): Coverage {
  const window = input.window;
  const result = (status: Coverage['status'], reason: string): Coverage => ({ status, reason,
    remainingBlocks: window?.remainingBlocks ?? null, expiryHeight: window?.expiryHeight ?? null, openedHeight: window?.openedHeight ?? null });
  if (input.retired) return result('Retired', 'Retired by governance; excluded from coverage.');
  if (!window) return result('Unknown', 'Window could not be verified.');
  try {
    const blocks = BigInt(window.remainingBlocks), txs = BigInt(window.remainingTxs), value = BigInt(window.remainingValueUqor);
    if (!window.live || blocks <= 0n || txs <= 0n || value <= 0n) return result('Lapsed', 'Window expired, closed or exhausted.');
    if (input.transferTargetVerified !== true) return result('Unknown', 'A permitted native-transfer recipient has not been verified.');
    if (input.feePerGasWei <= 0n || input.baselineWei < 10000n || input.toleranceBps < 0n || input.toleranceBps >= 10000n) return result('Unknown', 'Invalid or missing drain-budget inputs.');
    const fee = 21000n * input.feePerGasWei;
    const floor = input.baselineWei * (10000n - input.toleranceBps) / 10000n;
    const lossNeeded = input.balanceWei >= floor ? input.balanceWei - floor + 1n : 0n;
    const budget = fee > lossNeeded ? fee : lossNeeded;
    if (input.balanceWei < budget || value * 1000000000000n < budget) return result('Lapsed', 'Insufficient balance or remaining window budget for the modeled drain.');
    return blocks <= (input.expiringBlocks ?? DEFAULT_EXPIRING_BLOCKS)
      ? result('Expiring', 'Finite epoch is approaching expiry; replace the canary before coverage lapses.')
      : result('Covered', 'A native-transfer drain fits the observed window scope and conservative fee budget.');
  } catch { return result('Unknown', 'Malformed window data.'); }
}
export function summarizeCoverage(canaries: { retired: boolean; drained: boolean; coverage: Coverage }[], threshold: number, margin = 1) {
  const eligible = canaries.filter(item => !item.retired && !item.drained);
  const covered = eligible.filter(item => ['Covered', 'Expiring'].includes(item.coverage.status)).length;
  return { covered, expiring: eligible.filter(item => item.coverage.status === 'Expiring').length,
    lapsed: eligible.filter(item => item.coverage.status === 'Lapsed').length,
    unknown: eligible.filter(item => item.coverage.status === 'Unknown').length,
    threshold, margin, desired: threshold + margin, tripFeasible: covered >= threshold, degraded: covered < threshold + margin };
}
