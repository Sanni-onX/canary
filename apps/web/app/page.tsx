'use client';

import { useState } from 'react';
import { getQorexNative, hasCapability } from '@qorechain/qorex-types';
import { CHAIN_ID, OWNER } from '../lib/network';

type Account = { observedAt: string; balanceUqor: string; canonicalEvmAddress: string;
  pqRegistered: boolean; possessionProven: boolean; window: { live: boolean } };
type Wallet = { address: string; capabilities: string[]; canBroadcast: boolean };

export default function Home() {
  const [account, setAccount] = useState<Account | null>(null);
  const [wallet, setWallet] = useState<Wallet | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [pq, setPq] = useState('Not run');
  const [dark, setDark] = useState(true);

  async function run(name: string, task: () => Promise<void>) {
    setBusy(name); setError('');
    try { await task(); } catch (err) {
      if (name === 'pq') setPq('Check failed · see the message below');
      setError(err instanceof Error ? err.message : 'The check did not finish. Please try again.');
    } finally { setBusy(null); }
  }

  async function connect() {
    setWallet(null);
    const native = getQorexNative();
    if (!native) throw new Error('Open this HTTPS page inside the QoreX mobile dApp browser, with testnet selected.');
    await native.enable(CHAIN_ID);
    const key = await native.getKey(CHAIN_ID);
    if (key.bech32Address !== OWNER) throw new Error('The connected account differs from the project wallet. Select the project account in QoreX and reconnect.');
    setWallet({ address: key.bech32Address, capabilities: [...(native.capabilities ?? [])],
      canBroadcast: hasCapability(native, 'signAndBroadcast') });
  }

  async function checkAccount() {
    setAccount(null);
    const response = await fetch('/api/account', { cache: 'no-store' });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error);
    setAccount(result as Account);
  }

  async function checkPq() {
    setPq('Checking in this browser…');
    const { mldsa87 } = await import('@qorechain/pqc');
    const keys = mldsa87.keygen();
    try {
      const message = new TextEncoder().encode('Canary browser compatibility check. No authority granted.');
      const signature = mldsa87.sign(keys.secretKey, message);
      const valid = mldsa87.verify(keys.publicKey, message, signature);
      const rejectsChange = !mldsa87.verify(keys.publicKey, new Uint8Array([0]), signature);
      if (!valid || !rejectsChange || keys.publicKey.length !== 2592 || signature.length !== 4627) {
        throw new Error('Browser PQ compatibility check failed.');
      }
      setPq('Passed · real ML-DSA-87 key generation, signing and verification');
    } finally { keys.secretKey.fill(0); }
  }

  return <div className={dark ? 'shell dark' : 'shell'}>
    <a href="#main" className="skip">Skip to content</a>
    <header className="top"><a className="brand" href="/" aria-label="Canary home"><span className="bird">◒</span> canary<span className="brand-dot">.</span></a>
      <div className="top-right"><span className="network"><i /> QoreChain testnet</span><button className="theme" aria-label="Toggle light and dark mode" onClick={() => setDark(!dark)}>{dark ? '☼' : '☾'}</button></div></header>
    <main id="main">
      <div className="eyebrow">THE EARLY WARNING LAYER</div>
      <h1>A little warning.<br /><span>A safer way forward.</span></h1>
      <p className="intro">An alarm for compromised keys. A vault that locks classical access.
        A post-quantum way out.</p>
      <div className="phase"><span className="phase-label">PHASE 00</span><p>Discovery is underway. No vaults deployed. No funds move from this page.</p></div>
      <section className="workspace" aria-labelledby="readiness">
        <div className="section-title"><div><div className="eyebrow">BEFORE WE BUILD</div><h2 id="readiness">Check the foundations</h2></div><span className="tag">QoreX only</span></div>
        <div className="cards">
          <article><div className="card-number">01 <span>↗</span></div><h3>Your testnet account</h3><p>Read your balance, proven PQ key and EVM window directly from the chain.</p>
            <div className="result" aria-live="polite">{account ? <><strong>{(Number(account.balanceUqor) / 1e6).toLocaleString(undefined, { maximumFractionDigits: 6 })} QOR</strong><span>PQ key: {account.pqRegistered && account.possessionProven ? 'registered & proven' : 'needs attention'}</span><span>EVM window: {account.window.live ? 'open' : 'closed'}</span><small>Checked {new Date(account.observedAt).toLocaleTimeString()}</small></> : <span>Ready for a live check</span>}</div>
            <button disabled={!!busy} onClick={() => void run('account', checkAccount)}>{busy === 'account' ? 'Reading testnet…' : 'Check account'} <span>↗</span></button>
          </article>
          <article><div className="card-number">02 <span>⌁</span></div><h3>Connect QoreX</h3><p>Use QoreX’s mobile dApp browser on testnet. Connection shares your public address.</p>
            <div className="result" aria-live="polite">{wallet ? <><strong>Connected</strong><span>Native signing: {wallet.canBroadcast ? 'available' : 'not advertised'}</span><span>Capabilities: {wallet.capabilities.join(', ') || 'none advertised'}</span></> : <span>Waiting for your wallet</span>}</div>
            <button disabled={!!busy} onClick={() => void run('wallet', connect)}>{busy === 'wallet' ? 'Waiting for QoreX…' : wallet ? 'Reconnect QoreX' : 'Connect QoreX'} <span>↗</span></button>
          </article>
          <article><div className="card-number">03 <span>✳</span></div><h3>Browser PQ signing</h3><p>Generate a temporary, unfunded key and verify a real ML-DSA-87 signature on this device.</p>
            <div className="result" aria-live="polite"><strong>{pq}</strong><small>The temporary key is never saved or sent. Buffer clearing is best effort.</small></div>
            <button disabled={!!busy} onClick={() => void run('pq', checkPq)}>{busy === 'pq' ? 'Testing browser…' : 'Test browser signing'} <span>↗</span></button>
          </article>
        </div>
        {error && <p className="error" role="alert">{error}</p>}
      </section>
      <section className="note"><span className="note-icon">!</span><div><h2>QoreX mobile: one integration to resolve</h2><p>The documented EVM provider can read accounts, but cannot send contract transactions. A native session-key route is under investigation. It is disabled here; no session keys or permissions are created.</p><a href="https://docs.qorechain.io/qorex/dapp-browser/" target="_blank" rel="noreferrer">Read the wallet’s current limits ↗</a></div></section>
      <div className="address"><span>PROJECT ACCOUNT</span><code>{OWNER}</code><small>This native account’s EVM encoding may differ from QoreX’s separately derived EVM wallet.</small>{account && <code>{account.canonicalEvmAddress}</code>}</div>
    </main>
    <footer><span>Small signal. Stronger boundaries.</span><span>Built for #BuildBeforeQDay · Testnet only</span></footer>
  </div>;
}
