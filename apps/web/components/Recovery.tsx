'use client';
import { useEffect, useRef, useState } from 'react';
import { decryptKeyBlob, parseEncryptedKeyBlob, loadEncryptedBackups, hashPublicKey, sign, verify,
  buildTypedDigest, withdrawalAction, type Keypair, type EncryptedKeyBlob } from '@canary/pq';
import { encodeFunctionData, hexToBytes, toHex, parseEther, zeroAddress, type Address } from 'viem';
import { vaultAbi } from '../lib/contracts';
import { crossVmBytes, sendQorexNative } from '../lib/qorex-transactions';

function download(name: string, body: unknown) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(body, null, 2)], { type: 'application/json' }));
  const a = document.createElement('a'); a.href = url; a.download = name; a.click(); URL.revokeObjectURL(url);
}
export default function Recovery({ vault, refresh }: { vault: { address: Address; owner: Address; rescue: Address; keyHash: string; nonce: string; balance: string }; refresh?:()=>Promise<void> }) {
  const [backups, setBackups] = useState<EncryptedKeyBlob[]>([]);
  const [blob, setBlob] = useState<EncryptedKeyBlob | null>(null);
  const [password, setPassword] = useState('');
  const [amount, setAmount] = useState('0.001');
  const [unlocked, setUnlocked] = useState(false);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('Import the encrypted backup belonging to this vault.');
  const key = useRef<Keypair | null>(null);
  const alive = useRef(true);
  function clearKey() { key.current?.secretKey.fill(0); key.current = null; setUnlocked(false); setPassword(''); }
  useEffect(() => {
    alive.current = true;
    void loadEncryptedBackups().then(items => { if (alive.current) setBackups(items.filter(item => item.publicKeyHash === vault.keyHash)); }).catch(() => {});
    return () => { alive.current = false; key.current?.secretKey.fill(0); key.current = null; };
  }, [vault.keyHash]);
  useEffect(() => {
    if (!unlocked) return;
    const timer = setTimeout(() => { clearKey(); setStatus('Recovery key locked after five minutes.'); }, 300000);
    return () => clearTimeout(timer);
  }, [unlocked]);
  async function importFile(file?: File) {
    clearKey();
    try {
      if (!file || file.size > 100000) throw new Error('Choose an encrypted Canary backup under 100 KB.');
      const parsed = parseEncryptedKeyBlob(JSON.parse(await file.text()));
      if (parsed.publicKeyHash !== vault.keyHash) throw new Error('This backup belongs to a different vault key.');
      setBlob(parsed); setStatus('Encrypted backup accepted. Enter its password to unlock locally.');
    } catch (error) { setBlob(null); setStatus(error instanceof Error ? error.message : 'Invalid backup.'); }
  }
  async function unlock() {
    if (!blob) return;
    setBusy(true);
    try {
      const restored = await decryptKeyBlob(blob, password);
      if (!alive.current) { restored.secretKey.fill(0); return; }
      if (hashPublicKey(restored.publicKey) !== vault.keyHash) { restored.secretKey.fill(0); throw new Error('Wrong vault key.'); }
      key.current?.secretKey.fill(0); key.current = restored; setUnlocked(true); setPassword('');
      setStatus('Recovery key unlocked on this device for five minutes.');
    } catch { setStatus('Could not unlock this backup. Check the file and password.'); }
    finally { if (alive.current) setBusy(false); }
  }
  async function prepareRescue(submit = false) {
    if (!key.current) return;
    setBusy(true);
    try {
      const value = parseEther(amount);
      if (value <= 0n || value > BigInt(vault.balance)) throw new Error('Enter an amount within the current vault balance.');
      // Short-lived, chain/vault/nonce/action-bound authorization. No secret leaves this component.
      const deadline = BigInt(Math.floor(Date.now() / 1000) + 300);
      const digest = buildTypedDigest({ vault: vault.address, chainId: 9800n, nonce: BigInt(vault.nonce), deadline,
        action: withdrawalAction(zeroAddress, value, vault.rescue) });
      const signature = sign(key.current, hexToBytes(digest));
      if (!verify(key.current.publicKey, hexToBytes(digest), signature)) throw new Error('Local verification failed.');
      const data = encodeFunctionData({ abi: vaultAbi, functionName: 'withdrawPQ', args: [zeroAddress, value, vault.rescue, deadline, toHex(key.current.publicKey), toHex(signature)] });
      const transaction = { version: 1, chainId: 9800, owner: vault.owner, vault: vault.address, to: vault.address, value: '0', data,
        kind: 'pq-rescue', recipient: vault.rescue, amountWei: value.toString(), nonce: vault.nonce, deadline: deadline.toString() };
      const response = await fetch('/api/preflight', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(transaction) });
      const result = await response.json();
      if (!response.ok || !result.success) throw new Error(result.error || 'Chain simulation failed. Refresh vault state.');
      if (!alive.current) return;
      if (submit) {
        clearKey();
        const hash = await sendQorexNative(vault.owner, sender => ({ typeUrl:'/qorechain.crossvm.v1.MsgCrossVMCall', value:crossVmBytes(sender,vault.address,data) }));
        clearKey(); await refresh?.();
        if (alive.current) setStatus(`PQ rescue confirmed on Diana: ${hash}. Recovery key locked.`);
        return;
      }
      download('canary-pq-rescue-authorization.json', transaction);
      setStatus('Chain simulation passed. Public signed authorization downloaded; expires in five minutes. No transaction was sent.');
    } catch (error) { if (alive.current) setStatus(error instanceof Error ? error.message : 'Could not prepare rescue.'); }
    finally { if (alive.current) setBusy(false); }
  }
  return <section className="panel"><div className="panel-heading"><h2>Recover with your PQ backup</h2><span className="subtle-pill">ON THIS DEVICE</span></div>
    <p className="helper">Your password and private key stay here. The exported authorization contains a public signature that permits only the displayed rescue amount and destination.</p>
    {!!backups.length && <button className="secondary" disabled={busy} onClick={() => { clearKey(); setBlob(backups[0]); setStatus('Stored encrypted backup selected. Enter its password.'); }}>Use encrypted backup saved on this device</button>}
    <label className="field-label" htmlFor="recovery-file">Encrypted PQ backup file</label><input id="recovery-file" type="file" accept=".json,application/json" disabled={busy} onChange={event => void importFile(event.target.files?.[0])} />
    <label className="field-label" htmlFor="recovery-password">Backup password</label><input id="recovery-password" type="password" autoComplete="off" value={password} onChange={event => setPassword(event.target.value)} />
    <div className="wizard-actions"><button className="secondary" disabled={busy || !blob || !password || unlocked} onClick={() => void unlock()}>Unlock recovery key</button><button className="text-button" disabled={!unlocked} onClick={() => { clearKey(); setStatus('Recovery key locked.'); }}>Lock recovery key</button></div>
    <dl><div><dt>Rescue destination</dt><dd className="mono">{vault.rescue}</dd></div><div><dt>Current PQ nonce</dt><dd>{vault.nonce}</dd></div></dl>
    <label className="field-label" htmlFor="recovery-amount">PQ rescue amount in QOR</label><input id="recovery-amount" type="text" inputMode="decimal" value={amount} onChange={event => setAmount(event.target.value)} />
    <button className="primary" disabled={!unlocked || busy} onClick={() => void prepareRescue()}>{busy ? 'Checking…' : 'Sign & check rescue authorization'}</button>
    <button className="secondary" disabled={!unlocked || busy} onClick={() => void prepareRescue(true)}>Sign & submit PQ rescue with QoreX</button>
    <p className="helper">QoreX approves the native transaction; your separate vault PQ key authorizes rescue. The export route remains available for a local relay. Refresh vault state before each authorization.</p>
    <p className="action-result" role="status">{status}</p>
  </section>;
}
