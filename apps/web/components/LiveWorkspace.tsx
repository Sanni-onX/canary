'use client';
import { useEffect, useRef, useState } from 'react';
import { toEvmAddress } from '@qorechain/evm';
import { encodeFunctionData, formatEther, formatUnits, isAddress, zeroAddress, type Address, type Hex } from 'viem';
import { erc20Abi } from '../lib/contracts';
import { migrationStorageKey, parseMigrationRecord, type MigrationRecord } from '../lib/migration';
import Recovery from './Recovery';

type Vault = { address: Address; owner: Address; rescue: Address; keyHash: Hex; nonce: string; locked: boolean; alarm: boolean;
  balance: string; dailyLimit: string; delay: string; coolingOff: string; spent: string; pendingTruncated: boolean;
  pending: { id: string; token: Address; to: Address; amount: string; readyAt: string; done: boolean; invalidated: boolean; ready: boolean }[] };
type Portfolio = { chainId: number; owner: Address; block: string; balance: string; vaults: Vault[]; warnings: string[];
  assets: { token: Address; symbol: string; decimals: number; balance: string; completeWindow: boolean;
    vaultBalances: { vault: Address; balance: string }[]; approvals: { spender: Address; allowance: string }[] }[];
  approvalScan: { from: string; to: string; exhaustive: boolean } };
function download(name: string, data: unknown) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
  const anchor = document.createElement('a'); anchor.href = url; anchor.download = name; anchor.click(); URL.revokeObjectURL(url);
}
function delayLabel(value: string) {
  const seconds = BigInt(value);
  const unit = seconds >= 86400n && seconds % 86400n === 0n ? [86400n, 'day'] as const
    : seconds >= 3600n && seconds % 3600n === 0n ? [3600n, 'hour'] as const
    : seconds >= 60n && seconds % 60n === 0n ? [60n, 'minute'] as const : [1n, 'second'] as const;
  const amount = seconds / unit[0];
  return `${amount} ${unit[1]}${amount === 1n ? '' : 's'}`;
}
export default function LiveWorkspace({ wallet, tab }: { wallet: string; tab: string }) {
  const [owner, setOwner] = useState('');
  const [tokens, setTokens] = useState('');
  const [spenders, setSpenders] = useState('');
  const [portfolio, setPortfolio] = useState<Portfolio | null>(null);
  const [selected, setSelected] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [record, setRecord] = useState<MigrationRecord | null>(null);
  const [selectedApprovals, setSelectedApprovals] = useState<string[]>([]);
  const [status, setStatus] = useState('');
  const scanGeneration = useRef(0);
  const [activity, setActivity] = useState<{ from: string; to: string; completeWindow: boolean; truncated: boolean;
    events: { vault: string; name: string; hash: string; block: string; logIndex: number; args: Record<string, string | boolean> }[] } | null>(null);
  const [activityError, setActivityError] = useState('');
  useEffect(() => {
    if (tab !== 'Activity' || !portfolio) return;
    let cancelled = false;
    setActivity(null); setActivityError('');
    void fetch(`/api/activity?${new URLSearchParams({ owner: portfolio.owner })}`, { cache: 'no-store' }).then(async response => {
      const result = await response.json();
      if (!response.ok) throw new Error(result.error);
      if (!cancelled) setActivity(result);
    }).catch(error => { if (!cancelled) setActivityError(error instanceof Error ? error.message : 'Could not read activity.'); });
    return () => { cancelled = true; };
  }, [tab, portfolio]);
  useEffect(() => {
    if (wallet) { ++scanGeneration.current; setBusy(false); setOwner(toEvmAddress(wallet)); setPortfolio(null); setSelected(''); }
  }, [wallet]);
  useEffect(() => () => { ++scanGeneration.current; }, []);
  const vault = portfolio?.vaults.find(item => item.address.toLowerCase() === selected.toLowerCase());
  useEffect(() => {
    if (!portfolio || !vault) { setRecord(null); return; }
    try {
      const raw = localStorage.getItem(migrationStorageKey(portfolio.owner, vault.address));
      const restored = raw ? parseMigrationRecord(JSON.parse(raw)) : null;
      if (restored && restored.vault.toLowerCase() === vault.address.toLowerCase() && restored.keyHash === vault.keyHash) setRecord(restored);
      else setRecord(null);
    } catch { setRecord(null); setStatus('Saved migration record could not be read. Live vault state is unaffected.'); }
  }, [portfolio, vault]);
  async function scan() {
    if (!isAddress(owner) || owner === zeroAddress) { setError('Enter your canonical EVM address or connect QoreX.'); return; }
    setBusy(true); setError(''); setPortfolio(null); setSelectedApprovals([]);
    const generation = ++scanGeneration.current;
    try {
      const response = await fetch(`/api/portfolio?${new URLSearchParams({ owner, tokens, spenders })}`, { cache: 'no-store' });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Could not scan wallet.');
      if (generation !== scanGeneration.current) return;
      const data = result as Portfolio;
      setPortfolio(data);
      setSelected(current => data.vaults.some(item => item.address.toLowerCase() === current.toLowerCase()) ? current : data.vaults[0]?.address ?? '');
    } catch (problem) { if (generation === scanGeneration.current) setError(problem instanceof Error ? problem.message : 'Live scan failed.'); }
    finally { if (generation === scanGeneration.current) setBusy(false); }
  }
  function saveRecord(value: MigrationRecord) {
    const clean = parseMigrationRecord(value);
    localStorage.setItem(migrationStorageKey(clean.owner, clean.vault), JSON.stringify(clean)); setRecord(clean);
  }
  function startRecord() {
    if (!portfolio || !vault) return;
    try {
      saveRecord({ version: 1, chainId: 9800, owner: portfolio.owner, vault: vault.address, keyHash: vault.keyHash,
        updatedAt: new Date().toISOString(), receipts: [], snapshot: { rescue: vault.rescue, dailyLimitWei: vault.dailyLimit, timelockSeconds: vault.delay,
          coolingOffSeconds: vault.coolingOff, observedBlock: portfolio.block } });
      setStatus('Migration record saved on this device. Vault discovery and backup recovery work after a refresh.');
    } catch { setStatus('Device storage is unavailable. Export a report instead.'); }
  }
  async function importReport(file?: File) {
    try {
      if (!file || file.size > 100000 || !vault || !portfolio) throw new Error('Select a vault and a report under 100 KB.');
      const restored = parseMigrationRecord(JSON.parse(await file.text()));
      if (restored.owner.toLowerCase() !== portfolio.owner.toLowerCase() || restored.vault.toLowerCase() !== vault.address.toLowerCase()
        || restored.keyHash !== vault.keyHash) throw new Error('Report does not match the live owner, vault and key binding.');
      // Receipt hashes from imported reports remain evidence references, never assumed proof of completed steps.
      saveRecord(restored); setStatus('Report restored and binding checked against live chain state. Receipt references are not proof of completion.');
    } catch (problem) { setStatus(problem instanceof Error ? problem.message : 'Could not restore report.'); }
  }
  async function prepareRevocations() {
    if (!portfolio || !vault) return;
    setBusy(true); setStatus('Checking selected revocations…');
    try {
      const calls = portfolio.assets.flatMap(asset => asset.approvals.filter(approval => selectedApprovals.includes(`${asset.token}:${approval.spender}`))
        .map(approval => ({ chainId: 9800, owner: portfolio.owner, vault: vault.address, to: asset.token, value: '0',
          data: encodeFunctionData({ abi: erc20Abi, functionName: 'approve', args: [approval.spender, 0n] }),
          purpose: 'revoke-approval', token: asset.token, spender: approval.spender })));
      if (!calls.length) throw new Error('Select at least one allowance.');
      for (const call of calls) {
        const response = await fetch('/api/preflight', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(call) });
        const result = await response.json();
        if (!response.ok || !result.success) throw new Error(result.error || 'Revocation simulation failed.');
      }
      download('canary-selected-revocations.json', { version: 1, chainId: 9800, unsigned: true, transactions: calls });
      setStatus('Selected revocations passed simulation. Unsigned transaction plan downloaded. No allowance has been changed.');
    } catch (problem) { setStatus(problem instanceof Error ? problem.message : 'Revocation checks failed.'); }
    finally { setBusy(false); }
  }
  return <>
    <section className="panel"><div className="panel-heading"><h2>{tab === 'Lifeboat' ? 'Your live migration workspace' : 'Your protected vaults'}</h2><span className="subtle-pill">DIANA TESTNET</span></div>
      <p className="helper">Connect QoreX or enter a public address to discover its actual vaults and assets. Watching an address grants no signing authority.</p>
      <label className="field-label" htmlFor="live-owner">Owner EVM address</label><input id="live-owner" disabled={busy} value={owner} onChange={event => { ++scanGeneration.current; setOwner(event.target.value); setPortfolio(null); }} placeholder="0x…" />
      <details><summary>Additional tokens and approval checks</summary><label className="field-label" htmlFor="live-tokens">Custom token addresses · comma separated, up to 8</label><input id="live-tokens" value={tokens} onChange={event => setTokens(event.target.value)} /><label className="field-label" htmlFor="live-spenders">Known spender addresses · comma separated, up to 8</label><input id="live-spenders" value={spenders} onChange={event => setSpenders(event.target.value)} /></details>
      <button className="primary" disabled={busy} onClick={() => void scan()}>{busy ? 'Reading testnet…' : 'Discover vaults & review assets'}</button>
      {error && <p className="warning-box" role="alert">{error}</p>}
      <div className="warning-box">Wallet transaction sending is gated while QoreX’s supported route is verified. This workspace reads real state, restores backups and prepares checked authorizations; it never reports an unsigned plan as a completed migration.</div>
    </section>
    {portfolio && <>
      {tab === 'Activity' && <section className="panel"><h2>Decoded on-chain activity</h2>{activityError ? <p className="warning-box" role="alert">{activityError}</p> : !activity ? <p className="helper">Reading vault events…</p> : <><p className="helper">Blocks {activity.from}–{activity.to}. Latest 100 events from up to 16 owned vaults. Older history may be missing.</p>{!activity.completeWindow && <p className="warning-box">Some log queries failed. This history is incomplete.</p>}{activity.truncated && <p className="helper">Results were capped. Use the explorer for the complete history.</p>}{!activity.events.length && <p className="helper">No events found within this window.</p>}{activity.events.map(event => <article className="asset-review" key={`${event.hash}:${event.logIndex}`}><strong>{event.name}</strong><p className="helper">Block {event.block} · {event.vault}</p><code className="key-hash">{JSON.stringify(event.args)}</code><a className="text-button" href={`https://explore.qore.network/tx/${event.hash}`} target="_blank" rel="noreferrer">Transaction receipt ↗</a></article>)}</>}</section>}
      <div className="metrics"><div className="metric"><small>Wallet QOR</small><strong>{formatEther(BigInt(portfolio.balance))}</strong><span>Live block {portfolio.block}</span></div><div className="metric"><small>Protected vaults found</small><strong>{portfolio.vaults.length}</strong><span>Deployed factory only</span></div></div>
      {portfolio.warnings.map(warning => <p className="warning-box" key={warning}>{warning}</p>)}
      {!portfolio.vaults.length ? <section className="panel empty-state">No vault from Canary’s deployed factory belongs to this address. Live vault creation remains gated by wallet transaction support.</section> : <section className="panel"><label className="field-label" htmlFor="live-vault">Select protected vault</label><select id="live-vault" value={selected} onChange={event => setSelected(event.target.value)}>{portfolio.vaults.map(item => <option key={item.address} value={item.address}>{item.address}</option>)}</select></section>}
      {vault && <>
        <section className="panel"><div className="panel-heading"><h2>Your live PQ-Wrap vault</h2><span className={vault.alarm || vault.locked ? 'mode-badge frozen' : 'mode-badge'}>{vault.alarm || vault.locked ? 'FROZEN' : 'NORMAL'}</span></div><code className="key-hash">{vault.address}</code><dl><div><dt>Vault QOR</dt><dd>{formatEther(BigInt(vault.balance))}</dd></div><div><dt>Rolling daily cap / spent</dt><dd>{formatEther(BigInt(vault.dailyLimit))} / {formatEther(BigInt(vault.spent))} QOR</dd></div><div><dt>Above-limit delay</dt><dd>{delayLabel(vault.delay)}</dd></div><div><dt>Rescue destination</dt><dd className="mono">{vault.rescue}</dd></div></dl><p className="helper">This factory uses short minimum demo bounds. Your policy is displayed above; deployment remains unaudited.</p>
          <h3>Pending withdrawals</h3>{!vault.pending.length && <p className="helper">No withdrawal requests found.</p>}{vault.pendingTruncated && <p className="helper">Showing the latest 20 requests.</p>}{vault.pending.map(item => <div className="pending-row" key={item.id}><strong>#{item.id} · {item.token === zeroAddress ? `${formatEther(BigInt(item.amount))} QOR` : `${item.amount} token base units`}</strong><span>{item.done ? 'Closed' : item.invalidated ? 'Permanently invalidated by alarm' : item.ready ? 'Delay elapsed' : `Ready ${new Date(Number(item.readyAt) * 1000).toLocaleString()}`}</span></div>)}
        </section>
        <Recovery key={vault.address} vault={vault} />
      </>}
      <section className="panel"><div className="panel-heading"><h2>Wallet assets & approvals</h2><span className="subtle-pill">LIVE READS</span></div>
        <p className="helper">fUSD plus your selected token addresses. Approval events scanned from block {portfolio.approvalScan.from} to {portfolio.approvalScan.to}, plus supplied spenders. This is not an exhaustive wallet or approval scan; older approvals and unlisted tokens may be missing.</p>
        {portfolio.assets.map(asset => <article className="asset-review" key={asset.token}><h3>{asset.symbol} · {formatUnits(BigInt(asset.balance), asset.decimals)}</h3><code className="key-hash">{asset.token}</code>{!asset.completeWindow && <p className="warning-box">Approval history query was incomplete. Listed allowances were read directly; missing entries do not mean no approvals exist.</p>}{vault && <p className="helper">Selected vault balance: {formatUnits(BigInt(asset.vaultBalances.find(item => item.vault === vault.address)?.balance ?? '0'), asset.decimals)} {asset.symbol}</p>}{!asset.approvals.length && <p className="helper">No nonzero allowances found within this review’s scope.</p>}{asset.approvals.map(approval => { const id = `${asset.token}:${approval.spender}`; return <label className="approval-choice" key={id}><input type="checkbox" checked={selectedApprovals.includes(id)} onChange={event => setSelectedApprovals(current => event.target.checked ? [...current, id] : current.filter(item => item !== id))} /><span><code>{approval.spender}</code><small>{formatUnits(BigInt(approval.allowance), asset.decimals)} {asset.symbol} allowance</small></span></label>; })}</article>)}
        <button className="secondary" disabled={!vault || busy || !selectedApprovals.length} onClick={() => void prepareRevocations()}>Check selected revocations & export plan</button>
      </section>
      {vault && <section className="panel"><h2>Resume your migration</h2><p className="helper">Only public addresses, policy snapshots, key hash and receipt references are saved. The live vault is rediscovered from the factory; encrypted key backups are recovered separately.</p><div className="wizard-actions"><button className="secondary" onClick={startRecord}>{record ? 'Restart migration record' : 'Save migration record'}</button><button className="primary" onClick={() => download('canary-migration-report.json', record ?? { version: 1, chainId: 9800, owner: portfolio.owner, vault: vault.address, keyHash: vault.keyHash, updatedAt: new Date().toISOString(), receipts: [], snapshot: { rescue: vault.rescue, dailyLimitWei: vault.dailyLimit, timelockSeconds: vault.delay, coolingOffSeconds: vault.coolingOff, observedBlock: portfolio.block } })}>Export public migration report</button></div><label className="field-label" htmlFor="migration-report">Restore a migration report</label><input id="migration-report" type="file" accept=".json,application/json" onChange={event => void importReport(event.target.files?.[0])} />{record && <p className="helper">Saved {new Date(record.updatedAt).toLocaleString()} · {record.receipts.length} receipt references. Completion is determined by live state, not imported labels.</p>}</section>}
    </>}
    {status && <div className="action-result" role="status">{status}</div>}
  </>;
}
