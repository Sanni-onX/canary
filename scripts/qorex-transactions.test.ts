import {test} from 'node:test';
import assert from 'node:assert/strict';
import './preload-sdk.mjs';
import {qorechainTypes} from '@qorechain/sdk';
import {MsgSend} from 'cosmjs-types/cosmos/bank/v1beta1/tx';
import {crossVmBytes,bankSendBytes,sendQorexNative,requireQorexDiana,connectQorexAccount,requestQorexDiana} from '../apps/web/lib/qorex-transactions';
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

test('QoreX mainnet is refused before enable or signing; Diana succeeds after a fresh read',async()=>{
  let enabled=0,chain='0x2649';
  const prior=Object.getOwnPropertyDescriptor(globalThis,'window');
  Object.defineProperty(globalThis,'window',{configurable:true,value:{addEventListener:()=>{},qorex:{evm:{request:async()=>chain},native:{signDirect:async()=>{},getKey:async()=>{},enable:async()=>{enabled++;}}}}});
  try{
    await assert.rejects(requireQorexDiana(),/Request Diana testnet.*No transaction was sent/);
    assert.equal(enabled,0);
    chain='0x2648';await requireQorexDiana();assert.equal(enabled,1);
  }finally{if(prior)Object.defineProperty(globalThis,'window',prior);else delete (globalThis as {window?:unknown}).window;}
});

test('native network mismatch is explained when EVM network reads are unavailable',async()=>{
  const prior=Object.getOwnPropertyDescriptor(globalThis,'window');
  Object.defineProperty(globalThis,'window',{configurable:true,value:{addEventListener:()=>{},qorex:{native:{signDirect:async()=>{},getKey:async()=>{},enable:async()=>{throw Error('QoreX: chain qorechain-diana does not match the active network qorechain-vladi');}}}}});
  try{await assert.rejects(requireQorexDiana(),/Request Diana testnet/);}
  finally{if(prior)Object.defineProperty(globalThis,'window',prior);else delete (globalThis as {window?:unknown}).window;}
});

test('mainnet public connection uses the active native chain but transaction signing remains blocked',async()=>{
 const chains:string[]=[];let sends=0;
 const prior=Object.getOwnPropertyDescriptor(globalThis,'window');
 Object.defineProperty(globalThis,'window',{configurable:true,value:{addEventListener:()=>{},qorex:{evm:{request:async()=> '0x2649'},native:{capabilities:['signAndBroadcast'],signDirect:async()=>{},enable:async(chain:string)=>{chains.push(chain);},getKey:async(chain:string)=>{chains.push(chain);return {bech32Address:sender};},signAndBroadcast:async()=>{sends++;}}}}});
 try{
  const result=await connectQorexAccount();assert.equal(result.network,'mainnet');assert.equal(result.key.bech32Address,sender);
  assert.deepEqual(chains,['qorechain-vladi','qorechain-vladi']);
  await assert.rejects(sendQorexNative(target,()=>({typeUrl:'test',value:new Uint8Array()})),/not on Diana/);
  assert.equal(sends,0);assert.equal(chains.length,2);
 }finally{if(prior)Object.defineProperty(globalThis,'window',prior);else delete (globalThis as {window?:unknown}).window;}
});

test('Diana network request distinguishes refusal, ineffective success and a verified switch',async()=>{
 const prior=Object.getOwnPropertyDescriptor(globalThis,'window');
 try{for(const mode of ['already','refused','refused-object','ineffective','switched']){
  let requests=0,switched=false;
  Object.defineProperty(globalThis,'window',{configurable:true,value:{qorex:{evm:{request:async(args:{method:string;params?:unknown})=>{
   if(args.method==='eth_chainId')return mode==='already'||switched?'0x2648':'0x2649';
   assert.equal(args.method,'wallet_switchEthereumChain');assert.deepEqual(args.params,[{chainId:'0x2648'}]);requests++;
   if(mode==='refused')throw Object.assign(new Error('QoreX refuses other networks'),{code:4902});
   if(mode==='refused-object')throw {message:'QoreX refuses other networks',code:4902};
   if(mode==='switched')switched=true;
   return null;
  }}}}});
  const result=await requestQorexDiana();
  assert.equal(result.after,mode==='already'||mode==='switched'?9800:9801);
  assert.equal(requests,mode==='already'?0:1);
  if(mode.startsWith('refused')){assert.equal(result.code,4902);assert.equal(result.refusal,'QoreX refuses other networks');}
 }}finally{if(prior)Object.defineProperty(globalThis,'window',prior);else delete (globalThis as {window?:unknown}).window;}
});
