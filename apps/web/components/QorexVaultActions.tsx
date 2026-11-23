'use client';
import { useState } from 'react';
import { createPublicClient, http, parseEther, encodeFunctionData, hexToBytes, toHex, isAddress, zeroAddress, type Address } from 'viem';
import { toQorAddress } from '@qorechain/evm';
import { generateKeypair, encryptKeyBlob, decryptKeyBlob, hashPublicKey, sign, type EncryptedKeyBlob } from '@canary/pq';
import manifest from '../../../deployments/testnet-v2.json';
import { factoryAbi, vaultAbi } from '../lib/contracts';
import { crossVmBytes, bankSendBytes, sendQorexNative } from '../lib/qorex-transactions';
const client = createPublicClient({transport:http('https://evm-testnet.qore.host')});
export default function QorexVaultActions({owner, vault, refresh}:{owner:Address;vault?:Address;refresh:()=>Promise<void>}) {
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
  async function makeBackup(){await run(async()=>{
    const pair=generateKeypair();
    try {
      const blob=await encryptKeyBlob(pair,password);setBackup(blob);setSaved(false);
      const url=URL.createObjectURL(new Blob([JSON.stringify(blob)],{type:'application/json'}));
      const link=document.createElement('a');link.href=url;link.download=`canary-pq-${blob.publicKeyHash.slice(2,10)}.json`;link.click();URL.revokeObjectURL(url);
      setStatus('Encrypted recovery backup downloaded. Save it and its password before creating the vault.');
    } finally {pair.secretKey.fill(0);}
  });}
  async function create(){await run(async()=>{
    if(!backup||!saved||!isAddress(rescue)||rescue===zeroAddress)throw new Error('Save the encrypted backup and enter a valid rescue address.');
    const pair=await decryptKeyBlob(backup,password);
    try {
      const factory=manifest.contracts.VaultFactory.address as Address;
      const policy={dailyLimit:parseEther('0.01'),timelockDelay:86400n,coolingOff:3600n};
      const digest=await client.readContract({address:factory,abi:factoryAbi,functionName:'bindingDigest',args:[owner,hashPublicKey(pair.publicKey),rescue,policy]});
      const args=[owner,hashPublicKey(pair.publicKey),rescue,policy,toHex(pair.publicKey),toHex(sign(pair,hexToBytes(digest)))] as const;
      await client.simulateContract({account:owner,address:factory,abi:factoryAbi,functionName:'createVault',args,gas:2000000n});
      const data=encodeFunctionData({abi:factoryAbi,functionName:'createVault',args});
      const receipt=await sendQorexNative(owner,sender=>({typeUrl:'/qorechain.crossvm.v1.MsgCrossVMCall',value:crossVmBytes(sender,factory,data)}));
      setHash(receipt);setPassword('');
      const vaults=await client.readContract({address:factory,abi:factoryAbi,functionName:'vaultsOf',args:[owner]});
      const hashes=await Promise.all(vaults.map(address=>client.readContract({address,abi:vaultAbi,functionName:'pqPkHash'})));
      if(!hashes.includes(hashPublicKey(pair.publicKey)))throw new Error('Transaction confirmed, but the expected vault key binding was not found. Check the receipt before retrying.');
      await refresh();setStatus('Vault creation and recovery-key binding confirmed. Review the discovered vault below.');
    } finally {pair.secretKey.fill(0);}
  });}
  async function transfer(deposit:boolean){await run(async()=>{
    if(!vault)throw new Error('Select a vault first.');
    const actualOwner=await client.readContract({address:vault,abi:vaultAbi,functionName:'owner'});
    if(actualOwner.toLowerCase()!==owner.toLowerCase())throw new Error('Vault owner changed or does not match.');
    const value=parseEther(amount);if(value<=0n)throw new Error('Enter a positive amount.');
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
  return <section className="panel"><h2>QoreX vault transactions</h2>
    <p className="helper">QoreX approves each native transaction with its hybrid signature. Contract calls use the tested native cross-VM route. If your wallet refuses an unknown message, stop and update QoreX; no secret export is needed.</p>
    <fieldset disabled={busy}><legend>Create a protected vault</legend>
      <p className="helper">Initial policy: 0.01 QOR daily classical limit, 24-hour large-transfer delay and 1-hour cooling-off. The PQ recovery key is separate from your wallet key.</p>
      <label className="field-label" htmlFor="qvx-rescue">Rescue address</label><input id="qvx-rescue" value={rescue} onChange={e=>setRescue(e.target.value as Address)}/>
      <label className="field-label" htmlFor="qvx-password">Recovery backup password</label><input id="qvx-password" type="password" autoComplete="new-password" value={password} onChange={e=>setPassword(e.target.value)}/>
      <button className="secondary" onClick={()=>void makeBackup()}>Generate encrypted recovery backup</button>
      {backup&&<label><input type="checkbox" checked={saved} onChange={e=>setSaved(e.target.checked)}/> I saved the downloaded backup and its password.</label>}
      <button className="primary" disabled={!backup||!saved} onClick={()=>void create()}>Create vault with QoreX</button>
    </fieldset>
    {vault&&<fieldset disabled={busy}><legend>Move test QOR</legend>
      <label className="field-label" htmlFor="qvx-amount">Amount in QOR</label><input id="qvx-amount" inputMode="decimal" value={amount} onChange={e=>setAmount(e.target.value)}/>
      <button className="primary" onClick={()=>void transfer(true)}>Deposit with QoreX</button>
      <label className="field-label" htmlFor="qvx-to">Withdrawal recipient</label><input id="qvx-to" value={to} onChange={e=>setTo(e.target.value as Address)}/>
      <button className="secondary" onClick={()=>void transfer(false)}>Withdraw within daily limit</button>
      <p className="helper">Native deposits credit the vault balance directly; they do not invoke its Solidity receive event. Alarm, lock and daily-limit checks still apply to classical withdrawals.</p>
    </fieldset>}
    <p role="status">{status}</p>{hash&&<a href={`https://explore.qore.network/tx/${hash}`} target="_blank" rel="noreferrer">View confirmed native receipt ↗</a>}
  </section>;
}
