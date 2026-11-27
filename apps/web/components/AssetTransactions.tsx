'use client';
import {useState} from 'react';
import {createPublicClient,http,encodeFunctionData,parseUnits,zeroAddress,type Address} from 'viem';
import {erc20Abi,vaultAbi} from '../lib/contracts';
import {sendCheckedContract} from '../lib/qorex-transactions';
import {parseExactAmount} from '../lib/amounts';
type Asset={token:Address;symbol:string;decimals:number};
type Pending={id:string;done:boolean;invalidated:boolean;ready:boolean};
export default function AssetTransactions({owner,vault,assets,pending,refresh,onReceipt,purpose}:{purpose:"deposit"|"withdraw";owner:Address;vault:Address;assets:Asset[];pending:Pending[];refresh:()=>Promise<void>;onReceipt:(hash:string,purpose:string)=>void}){
 const [token,setToken]=useState<Address>(assets[0]?.token??zeroAddress),[amount,setAmount]=useState('0.001'),[to,setTo]=useState(owner);
 const [busy,setBusy]=useState(false),[status,setStatus]=useState(''),[receipts,setReceipts]=useState<string[]>([]);
 const client=createPublicClient({transport:http('https://evm-testnet.qore.host')});
 async function run(task:()=>Promise<void>){setBusy(true);setStatus('Checking live state…');try{
  if(await client.getChainId()!==9800)throw new Error('Diana testnet required.');
  if((await client.readContract({address:vault,abi:vaultAbi,functionName:'owner'})).toLowerCase()!==owner.toLowerCase())throw new Error('Vault owner mismatch');
  await task();await refresh();
 }catch(error){setStatus(error instanceof Error?error.message:'Transaction failed');}finally{setBusy(false);}}
 async function send(target:Address,data:`0x${string}`,purpose:string){
  const hash=await sendCheckedContract(owner,target,data);setReceipts(current=>[hash,...current].slice(0,10));onReceipt(hash,purpose);return hash;
 }
 async function tokenAction(deposit:boolean){await run(async()=>{
  const asset=assets.find(a=>a.token===token);if(!asset)throw new Error('Select a discovered token.');
  const decimals=await client.readContract({address:token,abi:erc20Abi,functionName:'decimals'});
  if(decimals>36||decimals!==asset.decimals)throw new Error('Token decimals changed or are unsupported. Rescan assets.');
  const value=parseExactAmount(amount,decimals);
  if(deposit){
   const allowance=await client.readContract({address:token,abi:erc20Abi,functionName:'allowance',args:[owner,vault]});
   if(allowance<value)throw new Error('Approve this exact amount first; deposit is a separate approval.');
   const before=await client.readContract({address:token,abi:erc20Abi,functionName:'balanceOf',args:[vault]});
   await send(vault,encodeFunctionData({abi:vaultAbi,functionName:'depositToken',args:[token,value]}),'token-deposit');
   const after=await client.readContract({address:token,abi:erc20Abi,functionName:'balanceOf',args:[vault]});
   if(after<before+value)throw new Error('Receipt confirmed but expected token balance increase was not observed. Check receipts before retrying.');
  }else{
   const current=await client.readContract({address:token,abi:erc20Abi,functionName:'allowance',args:[owner,vault]});
   if(current!==0n&&current!==value)throw new Error('An existing different allowance must be revoked first. Use Revoke vault allowance below.');
   await send(token,encodeFunctionData({abi:erc20Abi,functionName:'approve',args:[vault,value]}),'token-exact-approval');
   if(await client.readContract({address:token,abi:erc20Abi,functionName:'allowance',args:[owner,vault]})!==value)throw new Error('Token did not confirm the expected allowance.');
  }
  setStatus(deposit?'Token deposit confirmed.':'Exact token allowance confirmed. Deposit is the next separate step.');
 });}
 async function revoke(){await run(async()=>{
  if(!assets.some(a=>a.token===token))throw new Error('Select a discovered token.');
  await send(token,encodeFunctionData({abi:erc20Abi,functionName:'approve',args:[vault,0n]}),'revoke-vault-allowance');
  if(await client.readContract({address:token,abi:erc20Abi,functionName:'allowance',args:[owner,vault]})!==0n)throw new Error('Allowance is still nonzero.');
  setStatus('Vault token allowance revoked.');
 });}
 async function queue(){await run(async()=>{
  const decimals=token===zeroAddress?18:assets.find(a=>a.token===token)?.decimals;
  if(decimals===undefined)throw new Error('Select a discovered asset.');
  const value=parseExactAmount(amount,decimals);
  const before=await client.readContract({address:vault,abi:vaultAbi,functionName:'withdrawalCount'});
  await send(vault,encodeFunctionData({abi:vaultAbi,functionName:'requestWithdrawal',args:[token,value,to]}),'queue-withdrawal');
  if(await client.readContract({address:vault,abi:vaultAbi,functionName:'withdrawalCount'})<=before)throw new Error('Receipt confirmed but no new withdrawal request was observed.');
  setStatus('Withdrawal request confirmed. It cannot execute before its on-chain delay and remains subject to alarm checks.');
 });}
 async function pendingAction(id:string,cancel:boolean){await run(async()=>{
  await send(vault,encodeFunctionData({abi:vaultAbi,functionName:cancel?'cancelWithdrawal':'executeWithdrawal',args:[BigInt(id)]}),cancel?'cancel-withdrawal':'execute-withdrawal');
  if(!(await client.readContract({address:vault,abi:vaultAbi,functionName:'pendingWithdrawals',args:[BigInt(id)]}))[5])throw new Error('Receipt confirmed but request is not closed.');
  setStatus(cancel?'Cancellation confirmed. No assets released.':'Withdrawal execution confirmed.');
 });}
 if(purpose==='deposit'&&!assets.length)return null;
 return <section className="panel"><h2>{purpose==='deposit'?'Deposit tokens':'Delayed withdrawals'}</h2>
 <fieldset disabled={busy}><legend>Choose an asset and amount</legend>
 <label className="field-label" htmlFor="asset-tx-token">Asset</label><select id="asset-tx-token" value={token} onChange={e=>setToken(e.target.value as Address)}>{purpose==='withdraw'&&<option value={zeroAddress}>QOR</option>}{assets.map(a=><option key={a.token} value={a.token}>{a.symbol} · {a.token.slice(0,10)}…</option>)}</select>
 <label className="field-label" htmlFor="asset-tx-amount">Amount</label><input id="asset-tx-amount" value={amount} onChange={e=>setAmount(e.target.value)} inputMode="decimal"/>
 {purpose==='deposit'&&<><button className="secondary" disabled={token===zeroAddress} onClick={()=>void tokenAction(false)}>Approve exact token amount</button>
 <button className="primary" disabled={token===zeroAddress} onClick={()=>void tokenAction(true)}>Deposit approved tokens</button>
 <button className="secondary" disabled={token===zeroAddress} onClick={()=>void revoke()}>Revoke vault allowance</button>
 <p className="helper">Approval and deposit are separate wallet confirmations. Fee-on-transfer and rebasing tokens are unsupported. New tokens start without classical spending authority until a PQ-approved policy is applied.</p></>}
 {purpose==='withdraw'&&<><label className="field-label" htmlFor="asset-tx-recipient">Delayed withdrawal recipient</label><input id="asset-tx-recipient" value={to} onChange={e=>setTo(e.target.value as Address)}/>
 <button className="secondary" onClick={()=>void queue()}>Queue above-limit withdrawal</button></>}
 </fieldset>
 {purpose==='withdraw'&&<><h3>Manage pending withdrawals</h3>{pending.filter(item=>!item.done).map(item=><div key={item.id}><span>Request #{item.id}</span><button className="secondary" disabled={busy||!item.ready||item.invalidated} onClick={()=>void pendingAction(item.id,false)}>Execute #{item.id}</button><button className="secondary" disabled={busy} onClick={()=>void pendingAction(item.id,true)}>Cancel #{item.id}</button></div>)}</>}
 <p role="status">{status}</p>{receipts.map(hash=><p key={hash}><a href={`https://explore.qore.network/tx/${hash}`} target="_blank" rel="noreferrer">Confirmed transaction {hash.slice(0,10)}… ↗</a></p>)}
 </section>;
}
