'use client';

import { useEffect, useReducer, useRef, useState } from 'react';
import { connectQorexAccount } from '../lib/qorex-transactions';
import { generateKeypair, sign, verify, hashPublicKey, encryptKeyBlob, storeEncryptedBackup, buildTypedDigest, withdrawalAction, type Keypair } from '@canary/pq';
import { hexToBytes, isAddress, parseEther, zeroAddress, formatEther } from 'viem';
import { initialDemo, reduceDemo } from '../lib/demo';
import LiveWorkspace from '../components/LiveWorkspace';
import CoveragePanel, { type CoverageState } from '../components/CoveragePanel';
import type { Coverage } from '@canary/coverage';
import ThreatModel from '../components/ThreatModel';
import WalletConnectionChooser from '../components/WalletConnectionChooser';
import QorexNetworkSetup from '../components/QorexNetworkSetup';
import '../components/workspace.css';

type Tab = 'Overview' | 'My vault' | 'Lifeboat' | 'Canary lab' | 'Q-Day drill' | 'Activity' | 'Threat model';
const tabs: { name: Tab; icon: string }[] = [
  { name: 'Overview', icon: '◫' }, { name: 'My vault', icon: '▣' }, { name: 'Lifeboat', icon: '↗' },
  { name: 'Canary lab', icon: '⌁' }, { name: 'Q-Day drill', icon: 'ϟ' }, { name: 'Activity', icon: '≋' }, { name: 'Threat model', icon: '◇' },
];
const q = (amount: number) => amount.toLocaleString(undefined, { maximumFractionDigits: 4, minimumFractionDigits: 2 });
// Deliberately undeployable zero-address domain: demo signatures cannot authorize a real vault.
const sampleVault = zeroAddress;
const sampleRescue = zeroAddress;
const migrationSteps = ['Generate & back up PQ key', 'Choose your policy', 'Register a rescue address', 'Create protected vault', 'Review wallet assets', 'Make a test deposit', 'Move remaining assets', 'Review old approvals', 'Export migration report'];

type LiveState = { configured: boolean; error?: string; network: string; block: string; observedAt: string; bounds: string;
  alarm: boolean; registryReady: boolean; threshold: number; toleranceBps: number;
  contracts: Record<string, { address: string; transactionHash: string }>;
  canaries: { index: number; address: string; baselineWei: string; balanceWei: string; retired: boolean; drained: boolean; coverage: Coverage }[];
  coverage?: CoverageState['coverage'];
  drill: null | { completedAt: string; checks: Record<string, boolean | string>; transactions: { kind: string; hash: string }[] };
  vault: null | { address: string; owner: string; rescue: string; nonce: string; locked: boolean; balanceWei: string; spentWei: string;
    dailyLimitWei: string; timelockSeconds: string; coolingOffSeconds: string; creationHash: string; pqExitHash: string | null } };

function download(name: string, body: unknown) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(body, null, 2)], { type: 'application/json' }));
  const a = document.createElement('a'); a.href = url; a.download = name; a.click(); URL.revokeObjectURL(url);
}

export default function Home() {
  const [tab, setTab] = useState<Tab>('Overview');
  const [environment, setEnvironment] = useState('simulation');
  const [state, dispatch] = useReducer(reduceDemo, undefined, initialDemo);
  const [wallet, setWallet] = useState('');
  const [walletNetwork,setWalletNetwork]=useState<'mainnet'|'testnet'|null>(null);
  const [walletChooserOpen, setWalletChooserOpen] = useState(false);
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [dark, setDark] = useState(true);
  const [amount, setAmount] = useState('0.1');
  const [step, setStep] = useState(0);
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [backedUp, setBackedUp] = useState(false);
  const [keyHash, setKeyHash] = useState('');
  const [preset, setPreset] = useState('Balanced');
  const [rescue, setRescue] = useState('');
  const [ceremony, setCeremony] = useState('');
  const [live, setLive] = useState<LiveState | null>(null);
  const [liveError, setLiveError] = useState('');
  const keys = useRef<Keypair | null>(null);
  const demoKeys = useRef<Keypair | null>(null);
  const drained = state.balances.filter(b => b < 0.99).length;
  const freeze = state.alarm || state.locked;
  const remaining = Math.max(0, state.dailyLimit - state.spent);
  const latest = state.activity[0];

  useEffect(() => {
    const query = new URLSearchParams(window.location.search);
    if (query.get('mode') === 'testnet') setEnvironment('testnet');
    const requestedTab = tabs.find(item => item.name === query.get('tab'));
    if (requestedTab) setTab(requestedTab.name);
  }, []);

  async function refreshLive() {
    setLiveError('');
    try {
      const response = await fetch('/api/protocol', { cache: 'no-store' });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error);
      setLive(body as LiveState);
    } catch (error) { setLiveError(error instanceof Error ? error.message : 'Live data unavailable.'); }
  }
  useEffect(() => {
    if (environment !== 'testnet') return;
    void refreshLive();
    const timer = setInterval(() => void refreshLive(), 15000);
    return () => clearInterval(timer);
  }, [environment]);

  async function perform(task: () => Promise<void>) {
    setBusy(true); setNotice('');
    try { await task(); } catch (error) { setNotice(error instanceof Error ? error.message : 'That action could not be completed.'); }
    finally { setBusy(false); }
  }

  async function connect() {
    const {key,network}=await connectQorexAccount();
    setWallet(key.bech32Address);setWalletNetwork(network);
    setNotice(network==='testnet'?'QoreX connected on testnet. No transaction has been requested.':'QoreX account connected. Your wallet is on Mainnet; Canary transactions remain blocked until it selects Diana testnet. Canary’s Live testnet view reads Diana balances, not your mainnet balance. No transaction has been requested.');
  }

  async function pqRescue() {
    if (!demoKeys.current) demoKeys.current = generateKeypair();
    const amountValue = Number(amount);
    if (!Number.isFinite(amountValue) || amountValue <= 0 || amountValue > state.vaultBalance) throw new Error('Enter a rescue amount within the vault balance.');
    const digest = buildTypedDigest({ vault: sampleVault, chainId: 9800n, nonce: BigInt(state.pqNonce),
      deadline: BigInt(Math.floor(Date.now() / 1000) + 600), action: withdrawalAction(zeroAddress, parseEther(amount), sampleRescue) });
    const message = hexToBytes(digest);
    const signature = sign(demoKeys.current, message);
    if (!verify(demoKeys.current.publicKey, message, signature)) throw new Error('PQ verification failed.');
    dispatch({ type: 'pq', amount: amountValue });
    setNotice('Real ML-DSA-87 signature verified in this browser. The transfer is a local simulation, not a blockchain transaction.');
  }

  async function backup() {
    if (!keys.current) keys.current = generateKeypair();
    const blob = await encryptKeyBlob(keys.current, password);
    download(`canary-pq-backup-${blob.publicKeyHash.slice(2, 10)}.json`, blob);
    await storeEncryptedBackup(blob);
    setKeyHash(hashPublicKey(keys.current.publicKey)); setBackedUp(true); setPassword('');
    setNotice('Encrypted backup downloaded and saved encrypted on this device. Store the password separately.');
  }

  function nextMigration() {
    if (step === 0 && (!backedUp || confirmation !== 'I SAVED MY BACKUP')) { setNotice('Download the encrypted backup and type I SAVED MY BACKUP before continuing.'); return; }
    if (step === 2 && !isAddress(rescue)) { setNotice('Enter a valid EVM rescue address.'); return; }
    if (step === 5) dispatch({ type: 'deposit', amount: 0.01 });
    if (step === 6) dispatch({ type: 'deposit', amount: 1 });
    setStep(Math.min(8, step + 1)); setNotice('');
  }

  const metric = (label: string, value: string, detail: string, accent = false) => <article className="metric"><span>{label}</span><strong className={accent ? 'accent' : ''}>{value}</strong><small>{detail}</small></article>;
  const activity = <div className="event-list">{state.activity.slice(0, tab === 'Activity' ? 40 : 5).map(event => <div className="event" key={event.id}><i className={event.tone} /><div><strong>{event.title}</strong><p>{event.detail}</p></div><span>#{String(event.id).padStart(3, '0')}</span></div>)}</div>;

  return <div className={dark ? 'app dark' : 'app'}>
    <WalletConnectionChooser open={walletChooserOpen} onClose={()=>setWalletChooserOpen(false)} onExtension={()=>{setWalletChooserOpen(false);void perform(connect);}} />
    <a className="skip" href="#main">Skip to content</a>
    <aside className="sidebar"><a className="brand" href="/" aria-label="Canary home"><span className="bird">◒</span>canary<span>.</span></a>
      <nav aria-label="Main navigation">{tabs.map(item => <button key={item.name} className={tab === item.name ? 'nav-item active' : 'nav-item'} onClick={() => { setTab(item.name); setNotice(''); }}><span>{item.icon}</span>{item.name}{item.name === 'Q-Day drill' && <small>TEST</small>}</button>)}</nav>
      <div className="sidebar-bottom"><div className="network-led"><i /> QoreChain · Diana</div><button className="text-button" onClick={() => setDark(!dark)}>{dark ? '☼ Light appearance' : '☾ Dark appearance'}</button></div>
    </aside>
    <div className="main-shell"><header className="topbar"><div className="breadcrumb">Workspace <span>/</span> <strong>{tab}</strong></div><div className="top-actions"><select aria-label="Environment" value={environment} onChange={e => setEnvironment(e.target.value)}><option value="simulation">Local simulation</option><option value="testnet">Live testnet</option></select><button className="wallet-button" disabled={busy} onClick={() => setWalletChooserOpen(true)}>{wallet ? `${wallet.slice(0, 9)}…${wallet.slice(-5)}` : 'Connect QoreX'} <span>↗</span></button></div></header>
      <main id="main"><div className="simulation-strip"><span className="pill">{environment === 'simulation' ? 'SIMULATION' : 'TESTNET'}</span>{environment === 'simulation' ? 'Sample balances · no blockchain transactions' : 'Diana testnet · no real funds'}</div>
        <div className="page-heading"><div><h1>{tab}</h1></div>{environment === 'simulation' && tab === 'Overview' && <button className="secondary" onClick={() => setTab('Q-Day drill')}>Run a Q-Day drill <span>↗</span></button>}</div>
        {notice && <div className="notice" role="status">{notice}</div>}
        {environment==='testnet'&&<QorexNetworkSetup onNetwork={chain=>{if(wallet)setWalletNetwork(chain===9800?'testnet':'mainnet');}} />}
        {walletNetwork==='mainnet'&&<div className="warning-box" role="note" aria-label="QoreX network"><strong>Wallet network: Mainnet.</strong> Account connection is available, but Canary signing is blocked until QoreX selects Diana testnet. Live testnet mode reads Diana balances.</div>}
        {environment === 'testnet' && tab === 'Threat model' ? <ThreatModel /> : environment === 'testnet' && ['My vault', 'Lifeboat', 'Activity'].includes(tab) ? <LiveWorkspace wallet={wallet} tab={tab} /> : environment === 'testnet' && tab === 'Canary lab' ? <CoveragePanel data={live} error={liveError} lab /> : environment === 'testnet' ? <>
          {liveError && <div className="warning-box" role="alert">{liveError}</div>}
          {!live ? <section className="panel live-empty"><h2>Reading deployed testnet contracts…</h2></section> : <>
            <section className={live.alarm ? 'alarm-banner tripped' : 'alarm-banner'}><span className="status-orbit">{live.alarm ? '!' : live.registryReady ? '✓' : '…'}</span><div><div className="eyebrow">LIVE TESTNET · BLOCK {live.block}</div><h2>{live.alarm ? 'On-chain alarm latched.' : live.registryReady ? 'Live canary registry is monitoring.' : 'Contracts deployed. Canary setup in progress.'}</h2><p>{live.registryReady ? `Threshold ${live.threshold} · ${live.toleranceBps / 100}% balance-loss tolerance` : 'Classical vault releases fail closed until the registry is fully configured.'}</p></div><button className="secondary" onClick={() => void refreshLive()}>Refresh ↻</button></section>
            <div className="metrics">{metric('Live vault balance', live.vault ? `${formatEther(BigInt(live.vault.balanceWei))} QOR` : 'Not created', 'Actual on-chain state', true)}{metric('Registered canaries', String(live.canaries.length), `Threshold ${live.threshold}`)}{metric('Registry', live.alarm ? 'Alarm' : live.registryReady ? 'Ready' : 'Setting up', 'No simulation fallback')}{metric('PQ exit proof', live.vault?.pqExitHash ? 'Confirmed' : 'Pending', 'Real ML-DSA-87 transaction receipt')}</div>
            <div className="two-column"><section className="panel"><div className="panel-heading"><h2>Live canaries</h2><span className="subtle-pill">DRILL ACCOUNTS · KEYS RETAINED</span></div>{!live.canaries.length ? <div className="empty-state">Canary additions are passing through PQ governance and its timelock.</div> : <div className="canary-grid">{live.canaries.map(c => <article key={c.index} className={c.drained ? 'canary drained' : 'canary'}><div><span className="canary-symbol">◒</span><i className="health-dot" /></div><h3>Drill canary {c.index + 1}</h3><span>{c.retired ? 'Retired' : c.drained ? 'Drained' : 'Intact'}</span><div className="balance-line"><strong>{Number(formatEther(BigInt(c.balanceWei))).toFixed(4)}</strong><small>QOR</small></div><a className="text-button" href={`https://explore.qore.network/address/${c.address}`} target="_blank" rel="noreferrer">{c.address.slice(0, 8)}…{c.address.slice(-4)} ↗</a></article>)}</div>}</section>
            <section className="panel"><div className="panel-heading"><h2>Real PQ-Wrap demo vault</h2></div>{live.vault ? <><code className="key-hash">{live.vault.address}</code><dl><div><dt>PQ nonce</dt><dd>{live.vault.nonce}</dd></div><div><dt>Daily limit</dt><dd>{formatEther(BigInt(live.vault.dailyLimitWei))} QOR</dd></div><div><dt>Timelock</dt><dd>{live.vault.timelockSeconds} seconds · demo only</dd></div><div><dt>Classical status</dt><dd>{live.alarm || !live.registryReady || live.vault.locked ? 'Frozen' : 'Limited access'}</dd></div></dl>{live.vault.pqExitHash && <a className="primary receipt-link" href={`https://explore.qore.network/tx/${live.vault.pqExitHash}`} target="_blank" rel="noreferrer">View real PQ rescue receipt ↗</a>}<p className="helper">Operator demo vault.</p></> : <p className="helper">Waiting for the first vault creation receipt.</p>}</section></div>
            <CoveragePanel data={live} error={liveError} />
            <p className="helper">Current state above uses revision 2. The completed Q-Day drill receipts below are historical revision-1 evidence; they do not describe the current registry alarm or coverage.</p>
            <section className="panel"><div className="panel-heading"><h2>Deployed contracts</h2><span className="subtle-pill">DEMO BOUNDS · QCAI REVIEWED</span></div>{Object.entries(live.contracts).map(([name, contract]) => <div className="deployed-row" key={name}><strong>{name}</strong><code>{contract.address}</code><a className="text-button" href={`https://explore.qore.network/tx/${contract.transactionHash}`} target="_blank" rel="noreferrer">Deployment receipt ↗</a></div>)}</section>
            {live.drill && <section className="panel"><div className="panel-heading"><h2>Real testnet Q-Day drill</h2><span className="mode-badge">COMPLETE</span></div><p className="helper">Normal classical release succeeded. Two retained-key canaries were drained. The watcher latched the alarm. Classical release was rejected in preflight without broadcasting a known failing transaction. A real PQ signature then rescued the demo balance.</p>{live.drill.transactions.map(tx => <div className="deployed-row" key={tx.hash}><strong>{tx.kind.replaceAll('_', ' ')}</strong><code>{tx.hash}</code><a className="text-button" href={`https://explore.qore.network/tx/${tx.hash}`} target="_blank" rel="noreferrer">Confirmed receipt ↗</a></div>)}<p className="helper">Completed {new Date(live.drill.completedAt).toLocaleString()} · Testnet simulation with real transactions, not real assets.</p></section>}
          </>}
        </> : <>
          {tab === 'Overview' && <>
            <section className={state.alarm ? 'alarm-banner tripped' : 'alarm-banner'}><span className="status-orbit">{state.alarm ? '!' : '✓'}</span><div><div className="eyebrow">{state.alarm ? 'ALARM LATCHED' : 'CANARY NETWORK'}</div><h2>{state.alarm ? 'Classical access is frozen.' : 'No alarm'}</h2><p>{state.alarm ? 'PQ rescue remains available.' : 'Threshold not reached.'}</p></div><div className="banner-stat"><strong>{drained}<span> / 2</span></strong><small>drained / trip threshold</small></div></section>
            <div className="metrics">{metric('Protected balance', `${q(state.vaultBalance)} QOR`, 'Sample vault · local simulation', true)}{metric('Canaries healthy', `${6 - drained} of 6`, '1% balance-loss tolerance')}{metric('Classical budget left', `${q(remaining)} QOR`, `${q(state.dailyLimit)} QOR rolling daily cap`)}{metric('PQ rescue', 'Ready', 'Separate signature · registered destination')}</div>
            <div className="two-column"><section className="panel"><div className="panel-heading"><div><h2>The canary network</h2></div><span className="subtle-pill">2 OF 6</span></div><div className="canary-grid">{state.balances.map((balance, i) => <article className={balance ? 'canary' : 'canary drained'} key={i}><div><span className="canary-symbol">◒</span><span className="health-dot" /></div><h3>Canary 0{i + 1}</h3><span>{balance ? 'Intact' : 'Drained'}</span><div className="balance-line"><strong>{q(balance)}</strong><small>/ 1.00 QOR</small></div><div className="bar"><i style={{ width: `${balance * 100}%` }} /></div></article>)}</div><div className="panel-foot">Balance loss is a compromise signal. It cannot prove a quantum attack.</div></section><section className="panel vault-summary"><div className="panel-heading"><h2>PQ-Wrap vault</h2><span className={freeze ? 'mode-badge frozen' : 'mode-badge'}>{freeze ? 'FROZEN' : 'NORMAL'}</span></div><div className="vault-art">▣<span>↗</span></div><strong className="big-balance">{q(state.vaultBalance)} <small>QOR</small></strong><dl><div><dt>Classical daily cap</dt><dd>{q(state.dailyLimit)} QOR</dd></div><div><dt>Above-limit delay</dt><dd>24 hours</dd></div><div><dt>PQ exit</dt><dd>Always authorized*</dd></div></dl><button className="primary" onClick={() => setTab('My vault')}>Manage vault ↗</button><small className="footnote">*Requires an available chain, verifier, submitting account and fees.</small></section></div>
            <section className="panel"><div className="panel-heading"><h2>Recent activity</h2><button className="text-button" onClick={() => setTab('Activity')}>View all ↗</button></div>{activity}</section>
          </>}

          {tab === 'My vault' && <><div className="metrics">{metric('Vault balance', `${q(state.vaultBalance)} QOR`, 'Local simulation', true)}{metric('Spent in rolling 24h', `${q(state.spent)} QOR`, `Remaining ${q(remaining)} QOR`)}{metric('Vault mode', freeze ? 'Frozen' : 'Normal', 'Alarm and manual lockdown enforced')}{metric('PQ nonce', String(state.pqNonce), 'One authorization, one execution')}</div><div className="two-column"><section className="panel"><div className="panel-heading"><h2>Move assets</h2><span className="subtle-pill">SIMULATION</span></div><label className="field-label" htmlFor="vault-amount">Amount in QOR</label><input id="vault-amount" type="number" min="0.000001" step="0.01" value={amount} onChange={e => setAmount(e.target.value)} /><div className="button-stack"><button className="primary" onClick={() => dispatch({ type: 'deposit', amount: Number(amount) })}>Simulate deposit</button><button className="secondary" onClick={() => dispatch({ type: 'withdraw', amount: Number(amount) })}>Try classical withdrawal</button><button className="secondary" onClick={() => dispatch({ type: 'request', amount: Number(amount) })}>Queue above-limit withdrawal · 24h</button><button className="primary rescue" disabled={busy} onClick={() => void perform(pqRescue)}>{busy ? 'Signing locally…' : 'Run PQ rescue simulation'} ↗</button></div><p className="helper">The rescue test uses a real browser-generated ML-DSA-87 signature. Asset movements remain simulated. During an alarm, the contract permits only your registered rescue destination.</p></section><section className="panel"><div className="panel-heading"><h2>Protection policy</h2><span className={freeze ? 'mode-badge frozen' : 'mode-badge'}>{freeze ? 'FROZEN' : 'NORMAL'}</span></div><dl className="policy-list"><div><dt>Rolling daily allowance</dt><dd>{q(state.dailyLimit)} QOR</dd></div><div><dt>Timelock</dt><dd>24 hours</dd></div><div><dt>Cooling-off reversal</dt><dd>Bounded by the same daily cap</dd></div><div><dt>Rescue destination</dt><dd>Simulation rescue account</dd></div></dl><div className="bar wide"><i style={{ width: `${Math.min(100, state.spent / Math.max(state.dailyLimit, .01) * 100)}%` }} /></div><p className="helper">Classical authority can only tighten. Higher limits, shorter delays, rescue changes and unlocking require PQ authorization plus a delay.</p><div className="button-stack"><button className="secondary" onClick={() => dispatch({ type: 'tighten' })}>Lower daily cap to 0.25 QOR</button><button className="danger" onClick={() => dispatch({ type: 'lock' })}>Lock classical access</button></div></section></div><section className="panel"><div className="panel-heading"><h2>Pending withdrawals</h2><button className="text-button" onClick={() => dispatch({ type: 'advance' })}>Advance simulation 24h ↗</button></div>{!state.pending.length ? <div className="empty-state">No pending withdrawals.</div> : state.pending.map((pending, index) => <div className="pending-row" key={index}><div><strong>{q(pending.amount)} QOR</strong><p>{pending.invalidated ? 'Permanently invalidated by alarm' : pending.cancelled ? 'Closed' : pending.ready ? 'Delay elapsed' : 'Waiting · 24-hour timelock'}</p></div><button className="secondary" disabled={pending.cancelled} onClick={() => dispatch({ type: 'cancel', index })}>Cancel</button><button className="secondary" disabled={pending.cancelled || pending.invalidated || !pending.ready} onClick={() => dispatch({ type: 'execute', index })}>Execute</button></div>)}</section><div className="action-result" role="status"><strong>{latest.title}</strong><span>{latest.detail}</span></div></>}

          {tab === 'Lifeboat' && <div className="migration-layout"><aside className="panel steps"><h2>Your lifeboat</h2>{migrationSteps.map((label, index) => <div key={label} className={index === step ? 'migration-step current' : 'migration-step'}><span>{index < step ? '✓' : index + 1}</span><p>{label}</p></div>)}</aside><section className="panel migration-card"><div className="eyebrow">STEP {step + 1} OF 9 · SIMULATION</div><h2>{migrationSteps[step]}</h2>{step === 0 ? <><p>Generate and save your separate vault recovery key.</p><label className="field-label" htmlFor="backup-password">Encryption password · at least 12 characters</label><input id="backup-password" type="password" autoComplete="new-password" value={password} onChange={e => setPassword(e.target.value)} /><button className="primary" disabled={busy || backedUp} onClick={() => void perform(backup)}>{backedUp ? 'Encrypted backup downloaded ✓' : busy ? 'Encrypting on your device…' : 'Generate key & download encrypted backup'}</button>{keyHash && <code className="key-hash">Public key hash: {keyHash}</code>}<label className="field-label" htmlFor="backup-confirm">Type I SAVED MY BACKUP</label><input id="backup-confirm" value={confirmation} onChange={e => setConfirmation(e.target.value)} autoComplete="off" /><p className="helper">Keep the backup file and password separately.</p></> : step === 1 ? <><p>Matured queued withdrawals can exceed the daily cap.</p><div className="presets">{['Conservative', 'Balanced', 'Strict'].map(p => <button key={p} className={preset === p ? 'preset selected' : 'preset'} onClick={() => setPreset(p)}><strong>{p}</strong><span>{p === 'Conservative' ? '0.10 QOR / day · 48h delay' : p === 'Balanced' ? '0.50 QOR / day · 24h delay' : 'Classical access starts locked'}</span></button>)}</div><p className="helper">Strict requires PQ for every exit; the canary adds little extra protection in that mode.</p></> : step === 2 ? <><p>Verify your rescue destination.</p><label className="field-label" htmlFor="rescue-address">Rescue EVM address</label><input id="rescue-address" placeholder="0x…" value={rescue} onChange={e => setRescue(e.target.value)} /><div className="warning-box">A plain classical rescue wallet could also be compromised. This page has not verified PQ protection at this address.</div></> : step === 3 ? <><p>Review your vault settings.</p><dl><div><dt>Policy</dt><dd>{preset}</dd></div><div><dt>Network</dt><dd>Local simulation</dd></div><div><dt>Rescue</dt><dd className="mono">{rescue}</dd></div></dl><p className="helper">Creates a simulated vault only.</p></> : step === 4 ? <><p>Sample migration inventory</p><div className="asset-row"><span>◈ QOR</span><strong>1.01 QOR selected</strong></div><p className="helper">Sample assets only.</p></> : step === 5 ? <><p>Start small. Simulate a 0.01 QOR deposit, then review the updated vault balance before migrating the rest.</p><div className="large-number">0.01 <small>QOR</small></div></> : step === 6 ? <><p>The test deposit is reflected in the simulation vault. Continue to simulate moving the remaining 1 QOR.</p><div className="large-number">1.00 <small>QOR</small></div><p className="helper">Cooling-off reversals never bypass alarm mode, lockdown or the daily limit.</p></> : step === 7 ? <><p>Old approvals remain dangerous after a migration. Review and revoke only the allowances you choose.</p><div className="empty-state">No live approvals queried. This simulation does not claim to revoke any allowance.</div></> : <><p>Export your simulation settings.</p><button className="primary" onClick={() => download('canary-migration-simulation.json', { simulation: true, network: 'local', exportedAt: new Date().toISOString(), policy: preset, pqKeyHash: keyHash, rescue, simulatedDepositsQor: [0.01, 1], transactions: [] })}>Download migration report ↗</button><div className="success-box">Simulation complete.</div></>}
              <div className="wizard-actions">{step > 0 && <button className="secondary" onClick={() => setStep(step - 1)}>Back</button>}{step < 8 && <button className="primary" disabled={busy} onClick={nextMigration}>{step === 3 ? 'Create simulated vault' : step === 5 ? 'Simulate test deposit' : step === 6 ? 'Simulate remaining deposit' : 'Continue'} ↗</button>}</div></section></div>}

          {tab === 'Q-Day drill' && <><section className="drill-intro panel"><span className="pill">SIMULATION · NO REAL ASSETS</span><h2>Test alarm and recovery</h2></section><div className="drill-grid"><article className="panel drill-step"><span className="step-number">01</span><h3>Compromise the bait</h3><p>Drain two sample canaries to cross the threshold.</p><strong className="large-number">{drained}<small> / 2 drained</small></strong><button className="secondary" onClick={() => dispatch({ type: 'drain' })}>Drain next canary</button></article><article className="panel drill-step"><span className="step-number">02</span><h3>Sound the alarm</h3><p>Run the permissionless balance check that the watcher submits.</p><strong className={state.alarm ? 'drill-status alert-text' : 'drill-status'}>{state.alarm ? 'ALARM LATCHED' : 'AWAITING CHECK'}</strong><button className="secondary" onClick={() => dispatch({ type: 'trip' })}>Run watcher check</button></article><article className="panel drill-step"><span className="step-number">03</span><h3>Try the classical key</h3><p>A stolen classical key must not release vault assets.</p><strong className="drill-status">{state.alarm ? 'CLASSICAL FROZEN' : 'LIMITED ACCESS'}</strong><button className="secondary" onClick={() => dispatch({ type: 'withdraw', amount: 0.1 })}>Try classical withdrawal</button></article><article className="panel drill-step"><span className="step-number">04</span><h3>Take the PQ exit</h3><p>Sign with ML-DSA-87 locally and verify before simulating rescue.</p><label className="field-label" htmlFor="drill-amount">Rescue amount in QOR</label><input id="drill-amount" type="number" min="0.01" step="0.1" value={amount} onChange={e => setAmount(e.target.value)} /><button className="primary" disabled={busy} onClick={() => void perform(pqRescue)}>Run PQ rescue simulation ↗</button></article></div><div className="action-result" role="status"><strong>{latest.title}</strong><span>{latest.detail}</span></div><div className="drill-footer"><p>Vault balance: <strong>{q(state.vaultBalance)} QOR</strong></p><button className="text-button" onClick={() => dispatch({ type: 'reset' })}>Reset local simulation ↺</button></div><section className="panel"><div className="panel-heading"><h2>Drill timeline</h2></div>{activity}</section></>}

          {tab === 'Canary lab' && <section className="panel lab"><h2>Canary setup</h2><p>A real ceremony funds bait accounts, exposes their public keys and discards the keys. Destruction cannot be proven. Independent ceremonies and a k-of-n threshold reduce reliance on a single operator.</p><ol className="ceremony-list"><li>Prepare a fresh testnet-only bait account.</li><li>Fund it and record the baseline.</li><li>Expose its public key with an on-chain transaction.</li><li>Discard the private key; record what was done honestly.</li><li>Submit evidence to timelocked PQ governance.</li></ol><div className="warning-box">Live funding and exposure are not enabled yet. A ceremony draft is not proof of key destruction or an on-chain canary.</div><button className="primary" onClick={() => { setCeremony(crypto.randomUUID()); setNotice('Ceremony draft created. No account keys generated or transaction sent.'); }}>Prepare ceremony draft ↗</button>{ceremony && <button className="secondary" onClick={() => download('canary-ceremony-draft.json', { id: ceremony, status: 'draft', createdAt: new Date().toISOString(), simulation: true, funded: false, exposureTx: null, keyDestructionProven: false })}>Export draft</button>}</section>}
          {tab === 'Activity' && <section className="panel"><div className="panel-heading"><h2>Simulation event history</h2><span className="subtle-pill">LOCAL · NO TX HASHES</span></div>{activity}</section>}
          {tab === 'Threat model' && <ThreatModel />}
        </>}

      </main>
    </div>
  </div>;
}
