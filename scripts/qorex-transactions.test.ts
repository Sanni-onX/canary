import {test} from 'node:test';
import assert from 'node:assert/strict';
import './preload-sdk.mjs';
import {qorechainTypes} from '@qorechain/sdk';
import {MsgSend} from 'cosmjs-types/cosmos/bank/v1beta1/tx';
import {crossVmBytes,bankSendBytes,sendQorexNative} from '../apps/web/lib/qorex-transactions';
const sender='qor1mqfp8mfhqwpf8sc26850r94qarahf4ryfjvdpp';
const target='0x73fc8909324a0360B53d4763fD98cDFAcC0c2d64' as const;
test('native cross-VM bytes match official protobuf encoding exactly',()=>{
  const value={sender,sourceVm:'cosmwasm',targetVm:'evm',targetContract:target,payload:Uint8Array.of(1,2,3,4),funds:[],async:false,asyncGasLimit:'0',asyncMaxFactor:'0'};
  const decoded=qorechainTypes.crossvm.MsgCrossVMCall.decode(crossVmBytes(sender,target,'0x01020304'));
  assert.deepEqual(decoded,value);
});
test('native QOR deposits encode exact uqor integer amount',()=>{
  const bytes=bankSendBytes(sender,sender,12345678901234567890n);
  assert.deepEqual(MsgSend.decode(bytes),{fromAddress:sender,toAddress:sender,amount:[{denom:'uqor',amount:'12345678901234567890'}]});
  assert.throws(()=>bankSendBytes(sender,sender,0n));
  assert.throws(()=>crossVmBytes(sender,target,'0x01zz' as `0x${string}`));
});
test('QoreX refuses a foreign owner before asking for a signature',async()=>{
  let sent=0;
  const prior=Object.getOwnPropertyDescriptor(globalThis,'window');
  Object.defineProperty(globalThis,'window',{configurable:true,value:{qorex:{native:{capabilities:['signAndBroadcast'],signDirect:async()=>{},enable:async()=>{},getKey:async()=>({bech32Address:sender}),signAndBroadcast:async()=>{sent++;return {code:0,txHash:'A'.repeat(64)};}}}}});
  Object.assign((globalThis as unknown as {window:object}).window,{addEventListener:()=>{}});
  try {await assert.rejects(sendQorexNative(target,()=>({typeUrl:'test',value:new Uint8Array()})),/differs/);assert.equal(sent,0);}
  finally {if(prior)Object.defineProperty(globalThis,'window',prior);else delete (globalThis as {window?:unknown}).window;}
});
