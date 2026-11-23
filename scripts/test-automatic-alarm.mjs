import {readFile,writeFile} from 'node:fs/promises';
import {parseAbi} from 'viem';
import {testnetSigner} from './testnet-signer.mjs';
const manifest=JSON.parse(await readFile(new URL('../deployments/testnet-v2.json',import.meta.url)));
const secrets=JSON.parse(await readFile(new URL('../.local/drill-accounts.json',import.meta.url)));
const path=new URL('../docs/evidence/automatic-alarm-test.json',import.meta.url);
let evidence;
try{evidence=JSON.parse(await readFile(path));}catch(error){if(error.code!=='ENOENT')throw error;evidence={network:'qorechain-diana',registry:manifest.contracts.CanaryRegistry.address,simulation:true,method:'Controlled native hybrid spends from retained-key drill accounts; not a classical or quantum attack',transactions:[]};}
const save=()=>writeFile(path,JSON.stringify(evidence,null,2)+'\n');
const health=await fetch('https://watcher-production-64b80e30.up.railway.app/health').then(r=>r.json());
if(!health.healthy||!health.submitterConfigured||!health.alarmBot?.hasFeeBudget||health.registry.toLowerCase()!==evidence.registry.toLowerCase())throw new Error('Hosted native alarm bot not ready; no drill spend sent');
for(let index=0;index<2;index++){
 if(evidence.transactions.some(tx=>tx.index===index))continue;
 const signer=await testnetSigner(secrets[index]);
 try{
  if(signer.account.address.toLowerCase()!==manifest.drillCanaries[index].address.toLowerCase())throw new Error('Drill account mismatch');
  const hash=await signer.nativeBroadcast('hybrid',[{typeUrl:'/cosmos.bank.v1beta1.MsgSend',value:{fromAddress:signer.nativeAddress,toAddress:manifest.deployer.native,amount:[{denom:'uqor',amount:'1'}]}}],'220000','22000');
  evidence.transactions.push({index,nativeHash:hash,amountUqor:'1',feeUqor:'22000'});await save();
  console.log(JSON.stringify({stage:'controlled_drill_spend',index,nativeHash:hash}));
 }finally{signer.dispose();}
}
for(let attempt=0;attempt<24;attempt++){
 const status=await fetch('https://watcher-production-64b80e30.up.railway.app/status').then(r=>r.json());
 if(status.alarm){
  if(!status.lastAlarmTransaction)throw new Error('Alarm observed but hosted bot receipt is missing');
  const tx=await fetch(`https://api-testnet.qore.host/cosmos/tx/v1beta1/txs/${status.lastAlarmTransaction}`).then(r=>r.json());
  const message=tx.tx?.body?.messages?.[0];
  if(tx.tx_response?.code!==0||message?.sender!==status.alarmBot?.native||message?.target_contract?.toLowerCase()!==evidence.registry.toLowerCase())throw new Error('Bot receipt sender/target verification failed');
  evidence.completedAt=new Date().toISOString();evidence.hostedWatcherAlarmObserved=true;evidence.botReceiptVerified=true;evidence.alarmHash=status.lastAlarmTransaction;evidence.alarmHeight=tx.tx_response.height;evidence.status=status;await save();console.log('Hosted watcher alarm and dedicated bot receipt verified');process.exit(0);
 }
 await new Promise(resolve=>setTimeout(resolve,2500));
}
throw new Error('Alarm not yet confirmed. Do not repeat drill spends; inspect watcher status.');
