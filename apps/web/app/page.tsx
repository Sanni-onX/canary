'use client';
import {useEffect,useState} from 'react';
import {formatEther} from 'viem';
import {connectQorexAccount} from '../lib/qorex-transactions';
import LiveWorkspace from '../components/LiveWorkspace';
import CoveragePanel,{type CoverageState} from '../components/CoveragePanel';
import type {Coverage} from '@canary/coverage';
import ThreatModel from '../components/ThreatModel';
import WalletConnectionChooser from '../components/WalletConnectionChooser';
import QorexNetworkSetup from '../components/QorexNetworkSetup';
import '../components/workspace.css';

type Tab = 'Overview'|'My vault'|'Lifeboat'|'Canaries'|'Activity'|'Wallet'|'Threat model';
const tabs:Tab[]=['Overview','My vault','Lifeboat','Canaries','Activity','Wallet','Threat model'];
const descriptions:Record<Tab,string>={Overview:'Monitor the alarm and the coverage behind it.','My vault':'Manage withdrawals, limits and post-quantum recovery.',Lifeboat:'Create a vault, save its recovery backup and move assets into it.',Canaries:'Check which canaries can currently detect a compromised classical key.',Activity:'Review your vault events and transaction receipts.',Wallet:'Connect QoreX and check its selected network.','Threat model':'Review protection rules and recovery requirements.'};
type LiveState = { configured: boolean; error?: string; network: string; block: string; observedAt: string; bounds: string;
  alarm: boolean; registryReady: boolean; threshold: number; toleranceBps: number;
  contracts: Record<string, { address: string; transactionHash: string }>;
  canaries: { index: number; address: string; baselineWei: string; balanceWei: string; retired: boolean; drained: boolean; coverage: Coverage }[];
  coverage?: CoverageState['coverage'];
  drill: null | { completedAt: string; checks: Record<string, boolean | string>; transactions: { kind: string; hash: string }[] };
  vault: null | { address: string; owner: string; rescue: string; nonce: string; locked: boolean; balanceWei: string; spentWei: string;
    dailyLimitWei: string; timelockSeconds: string; coolingOffSeconds: string; creationHash: string; pqExitHash: string | null } };


export default function Home(){
 const [tab,setTab]=useState<Tab>('Overview');
 const [wallet,setWallet]=useState('');
 const [walletNetwork,setWalletNetwork]=useState<'mainnet'|'testnet'|null>(null);
 const [walletChooserOpen,setWalletChooserOpen]=useState(false);
 const [notice,setNotice]=useState('');
 const [busy,setBusy]=useState(false);
 const [live,setLive]=useState<LiveState|null>(null);
 const [liveError,setLiveError]=useState('');
 const [now,setNow]=useState(0);
 useEffect(()=>{
  const requested=new URLSearchParams(location.search).get('tab');
  if(requested==='Canary lab')setTab('Canaries');
  else if(tabs.includes(requested as Tab))setTab(requested as Tab);
 },[]);
 async function refreshLive(){
  try{
   const response=await fetch('/api/protocol',{cache:'no-store'});
   const result=await response.json();
   if(!response.ok)throw Error(result.error||'Could not read protocol status.');
   setLive(result);setLiveError('');
  }catch(error){setLiveError(error instanceof Error?error.message:'Could not read protocol status.');}
 }
 useEffect(()=>{void refreshLive();const timer=setInterval(()=>{setNow(Date.now());void refreshLive();},15000);return()=>clearInterval(timer);},[]);
 function navigate(next:Tab){setTab(next);setNotice('');const url=new URL(location.href);url.searchParams.delete('mode');url.searchParams.set('tab',next);history.replaceState(null,'',url);}
 async function connect(){
  setBusy(true);setNotice('');
  try{const {key,network}=await connectQorexAccount();setWallet(key.bech32Address);setWalletNetwork(network);setNotice(network==='testnet'?'QoreX connected on Diana.':'QoreX account connected. Select Diana in QoreX before approving transactions.');}
  catch(error){setNotice(error instanceof Error?error.message:'Could not connect QoreX.');}
  finally{setBusy(false);}
 }
 const stale=Boolean(liveError)||(!!live&&!!now&&now-Date.parse(live.observedAt)>45000);
 const coverage=live?.coverage;
 return <div className="app">
  <WalletConnectionChooser open={walletChooserOpen} onClose={()=>setWalletChooserOpen(false)} onExtension={()=>{setWalletChooserOpen(false);void connect();}}/>
  <a className="skip" href="#main">Skip to content</a>
  <aside className="sidebar"><a className="brand" href="/" aria-label="Canary home"><span className="bird">◒</span>canary<span>.</span></a>
   <nav aria-label="Main navigation">{tabs.map(name=><button key={name} className={tab===name?'nav-item active':'nav-item'} aria-current={tab===name?'page':undefined} onClick={()=>navigate(name)}>{name}</button>)}</nav>
   <div className="sidebar-bottom"><div className="network-led"><i/> QoreChain · Diana</div></div>
  </aside>
  <div className="main-shell"><header className="topbar"><div className="breadcrumb">Workspace <span>/</span> <strong>{tab}</strong></div><div className="top-actions"><button className="wallet-button" disabled={busy} onClick={()=>setWalletChooserOpen(true)}>{wallet?`${wallet.slice(0,9)}…${wallet.slice(-5)}`:'Connect QoreX'} <span>↗</span></button></div></header>
   <main id="main"><div className="page-heading"><div><h1>{tab}</h1><p>{descriptions[tab]}</p></div>{['Overview','Canaries'].includes(tab)&&<button className="secondary" onClick={()=>void refreshLive()}>Refresh</button>}</div>
    {notice&&<div className="notice" role="status">{notice}</div>}
    {walletNetwork==='mainnet'&&<div className="warning-box" role="note" aria-label="QoreX network"><strong>Wallet network: Mainnet.</strong> Transaction signing is blocked until QoreX selects Diana. <button className="text-button" onClick={()=>navigate('Wallet')}>Open wallet settings</button></div>}
    {tab==='Wallet'&&<><QorexNetworkSetup onNetwork={chain=>{if(wallet)setWalletNetwork(chain===9800?'testnet':'mainnet');}}/><section className="panel"><h2>Connection options</h2><p className="helper">Use the QoreX browser extension. Mobile QR pairing is not supported yet.</p><button className="primary" onClick={()=>setWalletChooserOpen(true)}>Connect QoreX</button></section></>}
    {tab==='Threat model'&&<ThreatModel/>}
    {['My vault','Lifeboat','Activity'].includes(tab)&&<LiveWorkspace wallet={wallet} tab={tab} onNavigate={navigate} onConnect={()=>setWalletChooserOpen(true)}/>}
    {tab==='Canaries'&&<CoveragePanel data={live} error={liveError} lab/>}
    {tab==='Overview'&&<>
     {liveError&&<div className="warning-box" role="alert">{liveError}</div>}
     {!live?<section className="panel"><h2>{liveError?'Protocol status unavailable':'Reading protocol status…'}</h2></section>:<>
      <section className={live.alarm?'alarm-banner tripped':'alarm-banner'}><span className="status-orbit">{live.alarm?'!':stale?'?':'✓'}</span><div><div className="eyebrow">{stale?'LAST KNOWN STATUS':`BLOCK ${live.block}`}</div><h2>{live.alarm?'Classical withdrawals frozen':stale?'Refresh required':live.registryReady?'No alarm':'Registry not ready'}</h2><p>{live.alarm?'The alarm is latched. Post-quantum recovery remains available.':!live.registryReady?'Classical withdrawals are blocked until registry setup is complete.':stale?'Current alarm state could not be verified.':'The balance-loss threshold has not been reached.'}</p></div></section>
      <section className="coverage-summary panel" aria-label="Coverage summary"><div><h2>{stale||!coverage?'Coverage unknown':coverage.degraded?'Coverage degraded':'Coverage active'}</h2><p className="helper">{stale||!coverage?'Current permission coverage could not be verified.':`${coverage.covered} covered canaries · ${coverage.threshold} required to trigger the alarm · ${coverage.margin} spare targeted`}</p>{!stale&&coverage&&!coverage.tripFeasible&&<p className="helper">Too few canaries have active permissions to detect a new threshold breach.</p>}</div><button className="secondary" onClick={()=>navigate('Canaries')}>Review canary coverage</button></section>
      <section className="two-column product-paths"><article className="panel"><h2>Create and fund a vault</h2><p className="helper">Save a separate recovery key, set the rescue destination and deposit assets.</p><button className="primary" onClick={()=>navigate('Lifeboat')}>Create a vault</button></article><article className="panel"><h2>Manage an existing vault</h2><p className="helper">Review its balance, withdrawal limits, pending requests and recovery options.</p><button className="secondary" onClick={()=>navigate('My vault')}>Open my vault</button></article></section>
      <details className="panel protocol-evidence"><summary>Protocol contracts and verification receipts</summary><p className="helper">Operator verification records. These are separate from your vault and its activity.</p>{Object.entries(live.contracts).map(([name,contract])=><div className="deployed-row" key={name}><strong>{name}</strong><code>{contract.address}</code><a className="text-button" href={`https://explore.qore.network/tx/${contract.transactionHash}`} target="_blank" rel="noreferrer">Deployment receipt ↗</a></div>)}{live.vault?.pqExitHash&&<p><a href={`https://explore.qore.network/tx/${live.vault.pqExitHash}`} target="_blank" rel="noreferrer">Operator vault PQ recovery receipt ↗</a></p>}{live.drill&&<><h3>Historical alarm verification</h3><p className="helper">Retained-key canaries were deliberately drained to verify freezing and PQ recovery. These earlier registry receipts do not describe current coverage.</p>{live.drill.transactions.map(tx=><div className="deployed-row" key={tx.hash}><strong>{tx.kind.replaceAll('_',' ')}</strong><code>{tx.hash}</code><a className="text-button" href={`https://explore.qore.network/tx/${tx.hash}`} target="_blank" rel="noreferrer">Transaction receipt ↗</a></div>)}</>}</details>
     </>}
    </>}
   </main>
  </div>
 </div>;
}
