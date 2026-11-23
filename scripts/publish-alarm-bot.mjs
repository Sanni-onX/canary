// Upload only the dedicated generated bot credential, never deployer or guardian keys.
import {readFile} from 'node:fs/promises';
import {spawn} from 'node:child_process';
import {resolve} from 'node:path';
const data=JSON.parse(await readFile(new URL('../.local/alarm-bot.json',import.meta.url)));
if(data.testnetAlarmBot!==true)throw new Error('Not a dedicated testnet alarm bot');
const executable=process.platform==='win32'?resolve(process.env.APPDATA,'npm/node_modules/@railway/cli/bin/railway.exe'):'railway';
const child=spawn(executable,['variable','set','WATCHER_NATIVE_ACCOUNT','--stdin','--service','watcher','--skip-deploys'],{stdio:['pipe','ignore','pipe'],shell:false,windowsHide:true});
child.stdin.end(JSON.stringify(data));
let error='';child.stderr.on('data',chunk=>error+=chunk);
const code=await new Promise((resolve,reject)=>{child.on('error',reject);child.on('close',resolve);});
if(code!==0)throw new Error('Railway credential upload failed; credential was not printed.');
console.log('Dedicated alarm bot credential uploaded without displaying it.');
