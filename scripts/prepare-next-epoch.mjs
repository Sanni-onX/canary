import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {spawnSync} from 'node:child_process';
const path=new URL('../docs/evidence/next-epoch.json',import.meta.url);
let plan;
try{plan=JSON.parse(await readFile(path));}catch(error){if(error.code!=='ENOENT')throw error;
 plan={network:'qorechain-diana',registry:'0xc4d00be73ac4307c4550312fe2df553c835c9230',status:'prepared-unfunded',accounts:[]};}
if(process.argv.includes('--new')){
 if(plan.status!=='replaced-alarm-state-preserved')throw new Error('Complete or reconcile the current epoch before starting another');
 await mkdir(new URL('../docs/evidence/epochs/',import.meta.url),{recursive:true});
 await writeFile(new URL(`../docs/evidence/epochs/${randomUUID()}.json`,import.meta.url),JSON.stringify(plan,null,2)+'\n',{flag:'wx'});
 plan={network:'qorechain-diana',registry:plan.registry,status:'prepared-unfunded',accounts:[]};
}
for(let slot=0;slot<3;slot++){
 if(plan.accounts.some(account=>account.replacementSlot===slot))continue;
 const result=spawnSync(process.execPath,['scripts/canary-ceremony.mjs','prepare','--slot',String(slot)],{cwd:new URL('../',import.meta.url),encoding:'utf8',windowsHide:true});
 if(result.status!==0)throw new Error('Fresh epoch preparation failed');
 plan.accounts.push(JSON.parse(result.stdout));
 await writeFile(path,JSON.stringify(plan,null,2)+'\n');
}
console.log(JSON.stringify({status:plan.status,accounts:plan.accounts.map(({id,nativeAddress,replacementSlot})=>({id,nativeAddress,replacementSlot}))}));
