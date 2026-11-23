'use client';
import {useEffect,useState} from 'react';
import {createPublicClient,http,encodeFunctionData,encodeAbiParameters,parseAbiParameters,keccak256,hexToBytes,toHex,isAddress,zeroAddress,type Address} from 'viem';
import {decryptKeyBlob,hashPublicKey,parseEncryptedKeyBlob,sign,type EncryptedKeyBlob} from '@canary/pq';
import {vaultAbi} from '../lib/contracts';
import {sendCheckedContract} from '../lib/qorex-transactions';
import {parseExactAmount} from '../lib/amounts';
const client=createPublicClient({transport:http('https://evm-testnet.qore.host')});
export default function PolicyTransactions({owner,vault,assets,refresh,onReceipt}:{owner:Address;vault:{address:Address;rescue:Address;keyHash:string};assets:{token:Address;symbol:string;decimals:number}[];refresh:()=>Promise<void>;onReceipt:(hash:string,purpose:string)=>void}){
 const [token,setToken]=useState<Address>(zeroAddress),[limit,setLimit]=useState('0.01'),[delay,setDelay]=useState('86400'),[cooling,setCooling]=useState('3600');
 const [rescue,setRescue]=useState(vault.rescue),[unlock,setUnlock]=useState(false),[password,setPassword]=useState(''),[backup,setBackup]=useState<EncryptedKeyBlob|null>(null);
 const [busy,setBusy]=useState(false),[status,setStatus]=useState(''),[changes,setChanges]=useState<{id:string;readyAt:string;done:boolean;invalid:boolean;token:Address;cap:string;delay:string;cooling:string;rescue:Address;unlock:boolean;newKey:string}[]>([]);
 async function loadChanges(){
  const count=await client.readContract({address:vault.address,abi:vaultAbi,functionName:'changeCount'});
  const key=await client.readContract({address:vault.address,abi:vaultAbi,functionName:'pqPkHash'});
  const start=count>20n?count-20n:0n;
  const values=await Promise.all(Array.from({length:Number(count-start)},async(_,index)=>{
   const id=start+BigInt(index);const change=await client.readContract({address:vault.address,abi:vaultAbi,functionName:'pendingChanges',args:[id]});
   return {id:id.toString(),readyAt:change[6].toString(),done:change[7],invalid:change[4]!==key,token:change[0],cap:change[1].dailyLimit.toString(),delay:change[1].timelockDelay.toString(),cooling:change[1].coolingOff.toString(),rescue:change[2],unlock:change[5],newKey:change[3]};
  }));setChanges(values);
 }
 useEffect(()=>{void loadChanges().catch(()=>setStatus('Pending policy changes could not be loaded. Use Refresh changes.'));},[vault.address]); // eslint-disable-line react-hooks/exhaustive-deps
 useEffect(()=>{setRescue(vault.rescue);},[vault.rescue]);
 async function importBackup(file?:File){try{
  if(!file||file.size>100000)throw new Error('Select an encrypted backup under 100 KB.');
  const blob=parseEncryptedKeyBlob(JSON.parse(await file.text()));if(blob.publicKeyHash!==vault.keyHash)throw new Error('Backup does not match this vault.');
  setBackup(blob);setStatus('Encrypted backup matched. It is unlocked only while signing a policy announcement.');
 }catch(error){setStatus(error instanceof Error?error.message:'Backup could not be read');}}
 function policy(){
  const decimals=token===zeroAddress?18:assets.find(a=>a.token===token)?.decimals;
  if(decimals===undefined)throw new Error('Select a discovered asset.');
  if(delay.length>20||cooling.length>20||!/^\d+$/.test(delay)||!/^\d+$/.test(cooling))throw new Error('Delays must be whole seconds within the supported range.');
  const timelockDelay=BigInt(delay),coolingOff=BigInt(cooling);
  if(timelockDelay>2n**64n-1n||coolingOff>2n**64n-1n)throw new Error('Delay is too large.');
  return {dailyLimit:limit==='0'?0n:parseExactAmount(limit,decimals),timelockDelay,coolingOff};
 }
 async function run(task:()=>Promise<void>){setBusy(true);setStatus('Checking live policy and wallet account…');try{
  if(await client.getChainId()!==9800)throw new Error('Diana testnet required');
  if((await client.readContract({address:vault.address,abi:vaultAbi,functionName:'owner'})).toLowerCase()!==owner.toLowerCase())throw new Error('Vault owner mismatch');
  await task();await loadChanges();await refresh();
 }catch(error){setStatus(error instanceof Error?error.message:'Policy transaction failed');}finally{setBusy(false);}}
 async function tighten(){await run(async()=>{
  const next=policy();const hash=await sendCheckedContract(owner,vault.address,encodeFunctionData({abi:vaultAbi,functionName:'tighten',args:[token,next]}));
  onReceipt(hash,'tighten-policy');
  const current=await client.readContract({address:vault.address,abi:vaultAbi,functionName:'policies',args:[token]});
  if(current[0]!==next.dailyLimit||current[1]!==next.timelockDelay||current[2]!==next.coolingOff)throw new Error('Receipt confirmed but policy differs from the requested values.');
  setStatus('Policy tightening confirmed.');
 });}
 async function announce(){await run(async()=>{
  if(!backup||!isAddress(rescue)||rescue===zeroAddress)throw new Error('Import the matching backup and enter a valid rescue address.');
  const next=policy();const pair=await decryptKeyBlob(backup,password);
  try{
   const key=await client.readContract({address:vault.address,abi:vaultAbi,functionName:'pqPkHash'});
   if(hashPublicKey(pair.publicKey)!==key)throw new Error('Vault key changed. Refresh before signing.');
   const nonce=await client.readContract({address:vault.address,abi:vaultAbi,functionName:'pqNonce'});
   const block=await client.getBlock();const deadline=block.timestamp+300n;
   const action=keccak256(encodeAbiParameters(parseAbiParameters('string,address,(uint256 dailyLimit,uint64 timelockDelay,uint64 coolingOff),address,bool'),['CANARY_LOOSEN_V1',token,next,rescue,unlock]));
   const digest=await client.readContract({address:vault.address,abi:vaultAbi,functionName:'authorizationDigest',args:[action,nonce,deadline]});
   const data=encodeFunctionData({abi:vaultAbi,functionName:'announceLoosen',args:[token,next,rescue,unlock,deadline,toHex(pair.publicKey),toHex(sign(pair,hexToBytes(digest)))]});
   pair.secretKey.fill(0);
   const hash=await sendCheckedContract(owner,vault.address,data);onReceipt(hash,'pq-policy-announcement');setPassword('');
   if(await client.readContract({address:vault.address,abi:vaultAbi,functionName:'pqNonce'})<=nonce)throw new Error('Receipt confirmed but PQ nonce did not advance.');
   setStatus('PQ-approved change announced. The existing timelock must elapse before it can be applied.');
  }finally{pair.secretKey.fill(0);}
 });}
 async function apply(id:string){await run(async()=>{
  const hash=await sendCheckedContract(owner,vault.address,encodeFunctionData({abi:vaultAbi,functionName:'applyLoosen',args:[BigInt(id)]}));onReceipt(hash,'apply-policy');
  if(!(await client.readContract({address:vault.address,abi:vaultAbi,functionName:'pendingChanges',args:[BigInt(id)]}))[7])throw new Error('Receipt confirmed but change is not applied.');
  setStatus('Matured policy change applied.');
 });}
 return <section className="panel"><h2>Vault policy controls</h2><fieldset disabled={busy}>
 <legend>Policy to apply</legend><label className="field-label" htmlFor="policy-token">Policy asset</label><select id="policy-token" value={token} onChange={e=>setToken(e.target.value as Address)}><option value={zeroAddress}>QOR</option>{assets.map(a=><option key={a.token} value={a.token}>{a.symbol}</option>)}</select>
 <label className="field-label" htmlFor="policy-limit">Daily classical limit · asset units, zero freezes small withdrawals</label><input id="policy-limit" value={limit} onChange={e=>setLimit(e.target.value)}/>
 <label className="field-label" htmlFor="policy-delay">Above-limit delay in seconds</label><input id="policy-delay" value={delay} onChange={e=>setDelay(e.target.value)} inputMode="numeric"/>
 <label className="field-label" htmlFor="policy-cooling">Cooling-off in seconds</label><input id="policy-cooling" value={cooling} onChange={e=>setCooling(e.target.value)} inputMode="numeric"/>
 <button className="secondary" onClick={()=>void tighten()}>Tighten existing policy now</button>
 <p className="helper">Tightening can only lower the cap or increase delays. New token policies, higher caps, shorter delays, rescue changes and unlocking require PQ approval and the existing timelock.</p>
 <details><summary>Announce a PQ-approved policy or rescue change</summary>
 <label className="field-label" htmlFor="policy-rescue">New rescue address</label><input id="policy-rescue" value={rescue} onChange={e=>setRescue(e.target.value as Address)}/>
 <label><input type="checkbox" checked={unlock} onChange={e=>setUnlock(e.target.checked)}/> Request unlock after the timelock</label>
 <label className="field-label" htmlFor="policy-backup">Encrypted PQ backup</label><input id="policy-backup" type="file" accept=".json,application/json" onChange={e=>void importBackup(e.target.files?.[0])}/>
 <label className="field-label" htmlFor="policy-password">Backup password for policy signing</label><input id="policy-password" type="password" autoComplete="off" value={password} onChange={e=>setPassword(e.target.value)}/>
 <button className="primary" disabled={!backup} onClick={()=>void announce()}>Sign & announce delayed change</button></details>
 </fieldset><h3>Latest policy changes</h3><button className="secondary" disabled={busy} onClick={()=>void loadChanges().catch(()=>setStatus('Could not refresh changes.'))}>Refresh changes</button>
 {changes.filter(change=>!change.done).map(change=><div key={change.id}><p>Change #{change.id} · {change.invalid?'Invalidated by key rotation':`eligible after ${new Date(Number(change.readyAt)*1000).toLocaleString()}`}</p><p className="helper">Asset: {change.token===zeroAddress?'QOR':change.token} · cap {change.cap} base units · delay {change.delay}s · cooling-off {change.cooling}s · rescue {change.rescue} · unlock {change.unlock?'requested':'not requested'}{!/^0x0+$/.test(change.newKey)&&` · replacement PQ hash ${change.newKey}`}</p><button className="secondary" disabled={busy||change.invalid} onClick={()=>void apply(change.id)}>Check & apply change #{change.id}</button></div>)}
 <p role="status">{status}</p></section>;
}
