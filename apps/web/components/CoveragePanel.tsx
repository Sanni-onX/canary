'use client';
import { useEffect, useState } from 'react';
import type { Coverage } from '@canary/coverage';
export type CoverageState = { observedAt: string; canaries: { index: number; retired: boolean; drained: boolean; coverage: Coverage }[];
  coverage?: { covered: number; expiring: number; lapsed: number; unknown: number; threshold: number; margin: number; desired: number;
    tripFeasible: boolean; degraded: boolean; blockSeconds: number | null; note: string } };
function duration(seconds: number) {
  if (seconds < 1) return 'awaiting a fresh block';
  const minutes = Math.ceil(seconds / 60);
  return minutes >= 60 ? `${Math.floor(minutes / 60)}h ${minutes % 60}m` : `${minutes}m`;
}
export default function CoveragePanel({ data, error, lab = false }: { data: CoverageState | null; error?: string; lab?: boolean }) {
  const [now, setNow] = useState(0);
  useEffect(() => { setNow(Date.now()); const timer = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(timer); }, []);
  const age = data && now ? Math.max(0, (now - Date.parse(data.observedAt)) / 1000) : 0;
  const stale = age > 45 || Boolean(error);
  const summary = data?.coverage;
  return <section className="panel"><div className="panel-heading"><h2>{lab ? 'Canary epoch workspace' : 'Canary coverage'}</h2><span className="subtle-pill">FINITE EPOCHS</span></div>
    {!summary ? <p className="helper">{error || 'Reading current window coverage…'}</p> : <>
      <div className={stale || summary.degraded ? 'warning-box' : 'success-box'} role="status"><strong>{stale ? 'Coverage unknown · data stale' : summary.degraded ? 'Coverage degraded' : 'Coverage margin met'}</strong><p>{stale ? 'Refresh before relying on a coverage label.' : `${summary.covered} intact canaries covered · threshold ${summary.threshold} · target ${summary.desired} including ${summary.margin} spare`}</p>{!stale && !summary.tripFeasible && <p>Fewer than k intact canaries are covered. These observations cannot establish that a new threshold event is currently detectable.</p>}</div>
      <div className="canary-grid">{data.canaries.map(canary => {
        const coverage = canary.coverage;
        if (!coverage) return null;
        const status = stale && !canary.retired ? 'Unknown' : coverage.status;
        const estimate = summary.blockSeconds && coverage.remainingBlocks ? Math.max(0, Number(coverage.remainingBlocks) * summary.blockSeconds - age) : null;
        return <article className="canary" key={canary.index}><h3>Canary {canary.index + 1} · epoch</h3><strong className={['Lapsed', 'Unknown'].includes(status) ? 'alert-text' : ''}>{status}</strong><p className="helper">{canary.retired ? 'Retired' : canary.drained ? 'Already drained · excluded from future coverage count' : 'Intact'}</p><p className="helper">{coverage.expiryHeight ? `Ends at block ${coverage.expiryHeight}` : 'Expiry unknown'}</p>{!stale && ['Covered', 'Expiring'].includes(status) && <p className="helper">{coverage.remainingBlocks} blocks at last read{estimate !== null ? ` · ≈ ${duration(estimate)} left` : ''}</p>}<p className="helper">{stale ? 'Fresh window state is required.' : coverage.reason}</p></article>;
      })}</div>
      <p className="helper">Countdowns estimate time using the last 60 blocks; block height is authoritative. Coverage also checks transaction capacity, transfer scope and a conservative native fee/value budget. It is an observation, not a guarantee of inclusion.</p>
      <div className="warning-box">{summary.note} Lapse changes coverage only; it never trips or clears the balance-loss alarm.</div>
    </>}
    {lab && <><h3>Prepare the next epoch</h3><ol className="ceremony-list"><li>Prepare fresh testnet accounts and enough canaries for k plus a margin.</li><li>Fund and PQ-register them, expose the classical public keys, then open bounded transfer windows while both keys are available.</li><li>Record expiry blocks, transaction/value capacity, recipient scope and actual exposure receipts.</li><li>Submit additions through PQ governance early enough for its delay to finish before the old epoch ends.</li><li>Only then perform and attest the chosen key-destruction step. Destruction cannot be proven.</li></ol><p className="helper">No automatic renewal or key destruction runs here. The current registry supports 16 lifetime slots, so epochs require a capacity/rotation review before a production rollout. The existing drill keys were retained; no burned-key demonstration is claimed.</p></>}
  </section>;
}
