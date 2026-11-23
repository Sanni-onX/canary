import {readFile,writeFile} from 'node:fs/promises';
import {randomBytes} from 'node:crypto';
import {toHex} from 'viem';
import './preload-sdk.mjs';
import {testnetSigner} from './testnet-signer.mjs';
const {generatePqcRecoveryCode}=await import('@qorechain/sdk');
const path=new URL('../.local/alarm-bot.json',import.meta.url);
let data;
try{data=JSON.parse(await readFile(path,'utf8'));}catch(error){if(error.code!=='ENOENT')throw error;
 data={testnetAlarmBot:true,classicalSeedHex:toHex(randomBytes(32)),pqcRecoveryCode:generatePqcRecoveryCode()};
 await writeFile(path,JSON.stringify(data)+'\n',{flag:'wx',mode:0o600});}
const signer=await testnetSigner(data);
try{
 const balance=await signer.client.getBalance({address:signer.account.address});
 let previous={};try{previous=JSON.parse(await readFile(new URL('../docs/evidence/alarm-bot.json',import.meta.url)));}catch(error){if(error.code!=='ENOENT')throw error;}
 const info={...previous,native:signer.nativeAddress,evm:signer.account.address,balanceWei:balance.toString(),purpose:'Dedicated permissionless alarm submitter; no vault or governance authority'};
 if(process.argv.includes('--register'))info.registrationHash=await signer.ensurePqc();
 await writeFile(new URL('../docs/evidence/alarm-bot.json',import.meta.url),JSON.stringify(info,null,2)+'\n');
 console.log(JSON.stringify(info));
}finally{signer.dispose();}
