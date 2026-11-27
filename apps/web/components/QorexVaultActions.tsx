'use client';
import { useState } from 'react';
import { createPublicClient, http, parseEther, encodeFunctionData, hexToBytes, toHex, isAddress, zeroAddress, type Address } from 'viem';
import { toQorAddress } from '@qorechain/evm';
import { generateKeypair, encryptKeyBlob, decryptKeyBlob, hashPublicKey, sign, parseEncryptedKeyBlob, type EncryptedKeyBlob } from '@canary/pq';
import manifest from '../../../deployments/testnet-v2.json';
import { factoryAbi, vaultAbi } from '../lib/contracts';
import { crossVmBytes, bankSendBytes, sendQorexNative, requireQorexDiana } from '../lib/qorex-transactions';
import {parseExactAmount} from '../lib/amounts';
const client = createPublicClient({transport:http('https://evm-testnet.qore.host')});
export default function QorexVaultActions({owner, vault, refresh, purpose="create"}:{owner:Address;vault?:Address;refresh:(selected?:Address)=>Promise<void>;purpose?:"create"|"manage"|"fund"}) {
  const [rescue,setRescue]=useState(owner), [password,setPassword]=useState('');
  const [backup,setBackup]=useState<EncryptedKeyBlob|null>(null), [saved,setSaved]=useState(false);
  const [amount,setAmount]=useState('0.001'), [to,setTo]=useState(owner);
  const [busy,setBusy]=useState(false), [status,setStatus]=useState(''), [hash,setHash]=useState('');
  async function run(action:()=>Promise<void>) {
    setBusy(true);setStatus('Checking testnet and preparing your wallet approval…');setHash('');
    try { if(await client.getChainId()!==9800) throw new Error('Diana testnet required.'); await action(); }
    catch(error){setStatus(error instanceof Error?error.message:'Wallet action failed.');}
    finally{setBusy(false);}
  }
  async function makeBackup(){
    setBusy(true);setStatus('Encrypting your recovery backup on this device…');
    let pair:ReturnType<typeof generateKeypair>|undefined;
    try {
      if(password.length<12)throw new Error('Use a recovery backup password of at least 12 characters.');
      pair=generateKeypair();
      const blob=await encryptKeyBlob(pair,password);setBackup(blob);setSaved(false);
      setStatus('Encrypted backup ready. Use Save encrypted backup below, then confirm you saved it.');
    } catch(error){setStatus(error instanceof Error?error.message:'Could not encrypt backup.');}
    finally {pair?.secretKey.fill(0);setBusy(false);}
  }
  function downloadBackup(){
    if(!backup)return;
    const url=URL.createObjectURL(new Blob([JSON.stringify(backup)],{type:'application/json'}));
    const link=document.createElement('a');link.href=url;link.download=`canary-pq-${backup.publicKeyHash.slice(2,10)}.json`;
    document.body.appendChild(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),60000);
    setStatus('Backup save requested. Check your browser downloads or Files app before confirming.');
  }
  async function restoreBackup(file?:File){
    if(!file)return;
    try{
      if(file.size>100000)throw new Error('Select an encrypted Canary backup under 100 KB.');
      const blob=parseEncryptedKeyBlob(JSON.parse(await file.text()));
      setBackup(blob);setSaved(false);setStatus('Encrypted backup restored. Enter its password and confirm you saved the file before creating your vault.');
    }catch(error){setStatus(error instanceof Error?error.message:'Could not restore this encrypted backup.');}
  }
  async function create(){await run(async()=>{
    if(!backup||!saved||!isAddress(rescue)||rescue===zeroAddress)throw new Error('Save the encrypted backup and enter a valid rescue address.');
    await requireQorexDiana();
    const pair=await decryptKeyBlob(backup,password);
    try {
      const factory=manifest.contracts.VaultFactory.address as Address;
      const policy={dailyLimit:parseEther('0.01'),timelockDelay:86400n,coolingOff:3600n};
      const digest=await client.readContract({address:factory,abi:factoryAbi,functionName:'bindingDigest',args:[owner,hashPublicKey(pair.publicKey),rescue,policy]});
      const args=[owner,hashPublicKey(pair.publicKey),rescue,policy,toHex(pair.publicKey),toHex(sign(pair,hexToBytes(digest)))] as const;
      await client.simulateContract({account:owner,address:factory,abi:factoryAbi,functionName:'createVault',args,gas:2000000n});
      const data=encodeFunctionData({abi:factoryAbi,functionName:'createVault',args});
      pair.secretKey.fill(0);
      const receipt=await sendQorexNative(owner,sender=>({typeUrl:'/qorechain.crossvm.v1.MsgCrossVMCall',value:crossVmBytes(sender,factory,data)}));
      setHash(receipt);setPassword('');
      const vaults=await client.readContract({address:factory,abi:factoryAbi,functionName:'vaultsOf',args:[owner]});
      const hashes=await Promise.all(vaults.map(address=>client.readContract({address,abi:vaultAbi,functionName:'pqPkHash'})));
      const created=vaults[hashes.findIndex(hash=>hash===hashPublicKey(pair.publicKey))];
      if(!created)throw new Error('Transaction confirmed, but the expected vault key binding was not found. Check the receipt before retrying.');
      await refresh(created);setStatus('Vault creation and recovery-key binding confirmed. The newly created vault is selected below.');
    } finally {pair.secretKey.fill(0);}
  });}
  async function transfer(deposit:boolean){await run(async()=>{
    if(!vault)throw new Error('Select a vault first.');
    const actualOwner=await client.readContract({address:vault,abi:vaultAbi,functionName:'owner'});
    if(actualOwner.toLowerCase()!==owner.toLowerCase())throw new Error('Vault owner changed or does not match.');
    const value=parseExactAmount(amount,18);
    let receipt:string;
    if(deposit){
      if(value%1000000000000n!==0n)throw new Error('Native QOR deposits support at most 6 decimal places.');
      const before=await client.getBalance({address:vault});
      receipt=await sendQorexNative(owner,sender=>({typeUrl:'/cosmos.bank.v1beta1.MsgSend',value:bankSendBytes(sender,toQorAddress(vault),value/1000000000000n)}),300000);
      setHash(receipt);
      if(await client.getBalance({address:vault})<before+value)throw new Error('Receipt confirmed, but the expected vault balance increase was not observed. Do not retry automatically.');
    } else {
      if(!isAddress(to)||to===zeroAddress)throw new Error('Enter a valid withdrawal recipient.');
      const args=[zeroAddress,value,to] as const;
      await client.simulateContract({account:owner,address:vault,abi:vaultAbi,functionName:'withdrawClassical',args});
      const data=encodeFunctionData({abi:vaultAbi,functionName:'withdrawClassical',args});
      receipt=await sendQorexNative(owner,sender=>({typeUrl:'/qorechain.crossvm.v1.MsgCrossVMCall',value:crossVmBytes(sender,vault,data)}));
      setHash(receipt);
    }
    await refresh();setStatus(`${deposit?'Deposit':'Withdrawal'} confirmed on Diana. Balances refreshed.`);
  });}
  return <section className="panel"><h2>{purpose==='create'?'Create vault':purpose==='fund'?'Deposit QOR':'QOR transfers'}</h2>
    <p className="helper">Approve transactions in QoreX on Diana testnet.</p>
    {purpose==='create'&&<fieldset disabled={busy}><legend>Recovery key and rescue destination</legend>
      <p className="helper">Initial policy: 0.01 QOR daily classical limit, 24-hour large-transfer delay and 1-hour cooling-off. The PQ recovery key is separate from your wallet key.</p>
      <label className="field-label" htmlFor="qvx-rescue">Rescue address</label><input id="qvx-rescue" value={rescue} onChange={e=>setRescue(e.target.value as Address)}/>
      <label className="field-label" htmlFor="qvx-password">Recovery backup password</label><input id="qvx-password" type="password" autoComplete="new-password" value={password} onChange={e=>setPassword(e.target.value)}/>
      <p className="helper">Use at least 12 characters. Keep your backup and password separately.</p>
      <button className="secondary" onClick={()=>void makeBackup()}>Generate encrypted recovery backup</button>
      <label className="field-label" htmlFor="qvx-existing-backup">Or restore an existing encrypted backup</label><input id="qvx-existing-backup" type="file" accept=".json,application/json" onChange={event=>void restoreBackup(event.target.files?.[0])}/>
      {backup&&<><button className="secondary" onClick={downloadBackup}>Save encrypted backup</button><details><summary>Download not supported by your wallet browser?</summary><p className="helper">Copy this encrypted JSON into a .json file and store it safely. It contains encrypted recovery material, not your password.</p><textarea readOnly aria-label="Encrypted recovery backup JSON" value={JSON.stringify(backup)} onFocus={e=>e.currentTarget.select()}/></details></>}
      {backup&&<label className="backup-confirmation" htmlFor="qvx-saved"><input id="qvx-saved" type="checkbox" checked={saved} onChange={e=>setSaved(e.target.checked)}/><span>I saved the encrypted backup file and its password separately.</span></label>}
      <button className="primary" disabled={!backup||!saved} onClick={()=>void create()}>Create vault with QoreX</button>
    </fieldset>}
    {vault&&purpose!=='create'&&<fieldset disabled={busy}><legend>QOR amount</legend>
      <label className="field-label" htmlFor="qvx-amount">Amount in QOR</label><input id="qvx-amount" inputMode="decimal" value={amount} onChange={e=>setAmount(e.target.value)}/>
      <button className="primary" onClick={()=>void transfer(true)}>Deposit with QoreX</button>
      {purpose==='manage'&&<><label className="field-label" htmlFor="qvx-to">Withdrawal recipient</label><input id="qvx-to" value={to} onChange={e=>setTo(e.target.value as Address)}/>
      <button className="secondary" onClick={()=>void transfer(false)}>Withdraw within daily limit</button></>}
      <p className="helper">QOR deposits have no cooling-off reversal window.</p>
    </fieldset>}
    <p role="status">{status}</p>{hash&&<a href={`https://explore.qore.network/tx/${hash}`} target="_blank" rel="noreferrer">View confirmed native receipt ↗</a>}
  </section>;
}
