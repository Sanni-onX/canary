'use client';
import {useState} from 'react';
import {readQorexNetwork,requestQorexDiana} from '../lib/qorex-transactions';
export default function QorexNetworkSetup({onNetwork}:{onNetwork:(chain:number)=>void}){
 const [busy,setBusy]=useState(false),[status,setStatus]=useState('Check the network selected inside QoreX. This does not send a transaction.');
 async function run(switchNetwork:boolean){
  setBusy(true);setStatus(switchNetwork?'Waiting for QoreX’s network-switch response…':'Reading QoreX’s selected network…');
  try{
   if(!switchNetwork){const chain=await readQorexNetwork();onNetwork(chain);setStatus(chain===9800?'QoreX reports Diana testnet (9800).':'QoreX reports Vladi mainnet (9801). Canary transactions remain blocked.');}
   else{
    const result=await requestQorexDiana();onNetwork(result.after);
    setStatus(result.after===9800?'Verified: QoreX now reports Diana testnet (9800). Reconnect QoreX to refresh the account. No transaction was sent.':`QoreX still reports Vladi mainnet (9801). The wallet did not switch. No transaction was sent.${result.refusal?` Wallet response${result.code!==undefined?` (${result.code})`:''}: ${result.refusal}`:''}`);
   }
  }catch(error){setStatus(error instanceof Error?error.message:'Could not check QoreX’s network.');}
  finally{setBusy(false);}
 }
 return <section className="panel qorex-network-setup" aria-labelledby="qorex-network-title"><h2 id="qorex-network-title">QoreX network setup</h2>
  <p className="helper">Transactions require Diana testnet.</p>
  <div className="button-stack"><button className="secondary" disabled={busy} onClick={()=>void run(false)}>Check QoreX network</button><button className="secondary" disabled={busy} onClick={()=>void run(true)}>Request Diana testnet</button></div>
  <p className="helper" role="status">{status}</p>
 </section>;
}
