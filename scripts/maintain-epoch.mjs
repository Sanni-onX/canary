// Local operator only: guardian credentials are never sent to Railway.
import {readFile,writeFile} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {encodeFunctionData,toHex,hexToBytes} from 'viem';
import {mldsa87} from '@qorechain/pqc';
import {evmWindowStatus} from '@qorechain/evm';
import {testnetSigner} from './testnet-signer.mjs';
const path=new URL('../docs/evidence/next-epoch.json',import.meta.url);
const plan=JSON.parse(await readFile(path));
const manifest=JSON.parse(await readFile(new URL('../deployments/testnet-v2.json',import.meta.url)));
if(plan.registry!==manifest.contracts.CanaryRegistry.address||plan.accounts.length!==3)throw new Error('Invalid epoch plan');
const main=await testnetSigner();
const save=()=>writeFile(path,JSON.stringify(plan,null,2)+'\n');
const registryArtifact=JSON.parse(await readFile(new URL('../contracts/out/CanaryRegistry.sol/CanaryRegistry.json',import.meta.url)));
const govArtifact=JSON.parse(await readFile(new URL('../contracts/out/PQGovernance.sol/PQGovernance.json',import.meta.url)));
const governance=manifest.contracts.PQGovernance.address;
const guardians=JSON.parse(await readFile(new URL('../.local/governance-keys.json',import.meta.url))).slice(0,2).map(g=>({publicKey:Buffer.from(g.publicKey,'base64'),secretKey:Buffer.from(g.secretKey,'base64')}));
async function receipt(hash){const r=await main.client.waitForTransactionReceipt({hash,timeout:90000});if(r.status!=='success')throw new Error('Governance transaction reverted');return r;}
async function govern(name,data){
 plan.actions??={};let action=plan.actions[name];
 if(!action){const nonce=await main.client.readContract({address:governance,abi:govArtifact.abi,functionName:'nonce'});const block=await main.client.getBlock();const deadline=block.timestamp+7200n;
  const digest=await main.client.readContract({address:governance,abi:govArtifact.abi,functionName:'actionDigest',args:[plan.registry,data,nonce,deadline]});
  action={nonce:nonce.toString(),deadline:deadline.toString(),digest,data};plan.actions[name]=action;await save();}
 if(action.data!==data)throw new Error('Proposal changed; refusing mixed epoch');
 if(!action.queueHash){
  if(action.queueIntent)throw new Error('Uncertain queue outcome requires reconciliation before retry');
  const args=[plan.registry,data,BigInt(action.deadline),[0n,1n],guardians.map(g=>toHex(g.publicKey)),guardians.map(g=>toHex(mldsa87.sign(g.secretKey,hexToBytes(action.digest))))];
  const simulated=await main.client.simulateContract({account:main.account,address:governance,abi:govArtifact.abi,functionName:'queue',args});
  const gas=await main.client.estimateContractGas(simulated.request);
  action.queueIntent=true;await save();action.queueHash=await main.wallet.writeContract({...simulated.request,gas:gas*11n/10n,gasPrice:await main.client.getGasPrice()});await save();}
 await receipt(action.queueHash);
 console.log(JSON.stringify({stage:'maintenance_queued',name,hash:action.queueHash}));
 if(!action.executeHash){
  const started=Date.now();while(true){const ready=await main.client.readContract({address:governance,abi:govArtifact.abi,functionName:'readyAt',args:[action.digest]});
   if(ready===0n)throw new Error('Missing governance queue');if((await main.client.getBlock()).timestamp>=ready)break;
   if(Date.now()-started>150000)throw new Error('Timelock not ready; resume later');await new Promise(resolve=>setTimeout(resolve,5000));}
  const simulated=await main.client.simulateContract({account:main.account,address:governance,abi:govArtifact.abi,functionName:'execute',args:[plan.registry,data,BigInt(action.nonce),BigInt(action.deadline)]});
  const gas=await main.client.estimateContractGas(simulated.request);action.executeHash=await main.wallet.writeContract({...simulated.request,gas:gas*11n/10n,gasPrice:await main.client.getGasPrice()});await save();}
 await receipt(action.executeHash);console.log(JSON.stringify({stage:'maintenance_executed',name,hash:action.executeHash}));
}
try{
 if(await main.client.getBalance({address:main.account.address})<2000000000000000000n&&!plan.fundingHash)throw new Error('Needs at least 2 test QOR in the operator account before funding a fresh epoch');
 if(!plan.fundingHash){
  if(plan.fundingIntent)throw new Error('Uncertain funding outcome; reconcile before sending again');
  plan.fundingIntent=true;await save();
  plan.fundingHash=await main.nativeBroadcast('hybrid',plan.accounts.map(account=>({typeUrl:'/cosmos.bank.v1beta1.MsgSend',value:{fromAddress:main.nativeAddress,toAddress:account.nativeAddress,amount:[{denom:'uqor',amount:'400000'}]}})));await save();}
 if(!plan.windowHash){plan.windowHash=await main.openWindow([governance,plan.registry]);await save();}
 for(const account of plan.accounts){
  let record=JSON.parse(await readFile(new URL(`../docs/evidence/ceremonies/${account.id}.json`,import.meta.url)));
  if(!record.exposureHash){
    const exposed=spawnSync(process.execPath,['scripts/canary-ceremony.mjs','expose',account.id,'--send'],{cwd:new URL('../',import.meta.url),encoding:'utf8',windowsHide:true});
    if(exposed.status!==0)throw new Error('Canary exposure failed; inspect its public record before retry');
    record=JSON.parse(await readFile(new URL(`../docs/evidence/ceremonies/${account.id}.json`,import.meta.url)));
  }
  if(!record.exposureHash)throw new Error('No confirmed exposure');
  const window=await evmWindowStatus({rest:'https://api-testnet.qore.host',address:record.address});
  if(!window.live||window.remainingBlocks<600n)throw new Error('Fresh canary window is too close to expiry; replacement stopped');
  const data=encodeFunctionData({abi:registryArtifact.abi,functionName:'replaceCanary',args:[BigInt(account.replacementSlot),record.address,record.exposureHash]});
  await govern(`slot-${account.replacementSlot}`,data);
  const current=await main.client.readContract({address:plan.registry,abi:registryArtifact.abi,functionName:'canaries',args:[BigInt(account.replacementSlot)]});
  if(current[0].toLowerCase()!==record.address.toLowerCase()||current[4])throw new Error('Replacement receipt confirmed but registry slot does not match');
 }
 plan.status='replaced-alarm-state-preserved';plan.completedAt=new Date().toISOString();await save();
 // Reset is deliberately separate from replacement. Evidence is retained for operator review.
 const evidence=await readFile(new URL('../docs/evidence/automatic-alarm-test.json',import.meta.url));
 plan.resetProposal={target:plan.registry,data:encodeFunctionData({abi:registryArtifact.abi,functionName:'resetAlarm',args:[`0x${createHash('sha256').update(evidence).digest('hex')}`]}),note:'Unsigned reset proposal only; review drill evidence and execute separately after cooldown.'};await save();
 console.log(JSON.stringify({status:plan.status,reset:'requires separate review',accounts:plan.accounts.map(a=>a.nativeAddress)}));
}finally{guardians.forEach(g=>g.secretKey.fill(0));main.dispose();}
