import { getQorexNative } from '@qorechain/qorex-types';
import { toEvmAddress } from '@qorechain/evm';
import { createPublicClient, http, hexToBytes, isAddress, type Address, type Hex } from 'viem';
const utf8 = new TextEncoder();
export const QOREX_TESTNET_HELP='QoreX is not on Diana testnet. Use “Request Diana testnet” to check whether your wallet can switch. If QoreX refuses, its active network must be changed in a testnet-capable QoreX build. Keep your saved backup. No transaction was sent.';
export async function readQorexNetwork(){
  const evm=typeof window==='undefined'?undefined:window.qorex?.evm;
  if(!evm)throw new Error('QoreX network provider not found. Unlock the extension, then refresh Canary.');
  const value=await evm.request({method:'eth_chainId'});
  if(typeof value!=='string'||! /^(0x[0-9a-f]+|[0-9]+)$/i.test(value))throw new Error('QoreX returned an unreadable network ID.');
  const chain=BigInt(value);
  if(chain!==9800n&&chain!==9801n)throw new Error('QoreX is not reporting a QoreChain network.');
  return Number(chain);
}
export async function requestQorexDiana(){
  const before=await readQorexNetwork();
  if(before===9800)return {before,after:before,requested:false};
  let refusal:string|undefined,code:number|undefined;
  try{await window.qorex!.evm.request({method:'wallet_switchEthereumChain',params:[{chainId:'0x2648'}]});}
  catch(error){
    refusal=error instanceof Error?error.message:error&&typeof error==='object'&&'message' in error&&typeof error.message==='string'?error.message:typeof error==='string'?error:'QoreX refused the network request.';
    if(error&&typeof error==='object'&&'code' in error&&typeof error.code==='number')code=error.code;
  }
  // A resolved request alone is not proof that the wallet actually switched.
  return {before,after:await readQorexNetwork(),requested:true,refusal,code};
}
export async function connectQorexAccount(){
  const provider=getQorexNative();
  if(!provider)throw new Error('QoreX extension not found. Mobile QR pairing is not enabled in Canary yet.');
  const evm=typeof window==='undefined'?undefined:window.qorex?.evm;
  if(!evm){const native=await requireQorexDiana();return {key:await native.getKey('qorechain-diana'),network:'testnet' as const};}
  const chain=await evm.request({method:'eth_chainId'});
  if(typeof chain!=='string'||! /^(0x[0-9a-f]+|[0-9]+)$/i.test(chain))throw new Error('Could not identify QoreX’s active network. Unlock it and retry.');
  const id=BigInt(chain);
  if(id!==9800n&&id!==9801n)throw new Error('QoreX must select a QoreChain account to connect.');
  const nativeChain=id===9800n?'qorechain-diana':'qorechain-vladi';
  await provider.enable(nativeChain);
  return {key:await provider.getKey(nativeChain),network:id===9800n?'testnet' as const:'mainnet' as const};
}
export async function requireQorexDiana(){
  const provider=getQorexNative();
  if(!provider)throw new Error('QoreX extension not found. Mobile QR pairing is not enabled in Canary yet.');
  // This reads QoreX itself, not the separate Diana RPC used for simulation.
  const evm=typeof window==='undefined'?undefined:window.qorex?.evm;
  if(evm){
    let chain:unknown;
    try{chain=await evm.request({method:'eth_chainId'});}catch{throw new Error('Could not read QoreX’s active network. Unlock the extension and retry. No transaction was sent.');}
    if(typeof chain!=='string'||! /^(0x[0-9a-f]+|[0-9]+)$/i.test(chain)||BigInt(chain)!==9800n)throw new Error(QOREX_TESTNET_HELP);
  }
  try{await provider.enable('qorechain-diana');}
  catch(error){
    if(error instanceof Error&&/does not match the active network|chain.*mismatch/i.test(error.message))throw new Error(QOREX_TESTNET_HELP);
    throw error;
  }
  return provider;
}
function varint(value: number): number[] {
  const out = []; do { const byte = value % 128; value = Math.floor(value / 128); out.push(byte | (value ? 128 : 0)); } while (value); return out;
}
function field(index: number, value: string | Uint8Array): number[] {
  const bytes = typeof value === 'string' ? utf8.encode(value) : value;
  return [...varint(index * 8 + 2), ...varint(bytes.length), ...bytes];
}
export function crossVmBytes(sender: string, target: Address, data: Hex): Uint8Array {
  if (!/^qor1[0-9a-z]+$/.test(sender) || !isAddress(target) || !/^0x([0-9a-fA-F]{2})*$/.test(data) || data.length > 64000) throw new Error('Invalid native contract call.');
  return Uint8Array.from([...field(1, sender), ...field(2, 'cosmwasm'), ...field(3, 'evm'), ...field(4, target), ...field(5, hexToBytes(data))]);
}
export function bankSendBytes(sender: string, recipient: string, amount: bigint): Uint8Array {
  if (!/^qor1[0-9a-z]+$/.test(sender) || !/^qor1[0-9a-z]+$/.test(recipient) || amount <= 0n) throw new Error('Invalid QOR deposit.');
  const coin = Uint8Array.from([...field(1, 'uqor'), ...field(2, amount.toString())]);
  return Uint8Array.from([...field(1, sender), ...field(2, recipient), ...field(3, coin)]);
}
export async function sendQorexNative(owner: Address, build: (sender: string) => {typeUrl:string; value:Uint8Array}, gasLimit = 2000000): Promise<string> {
  const provider = await requireQorexDiana();
  if (!provider?.capabilities?.includes('signAndBroadcast')) throw new Error('QoreX signing provider unavailable. Install/update the desktop extension; mobile QR pairing is not enabled in Canary yet.');
  const key = await provider.getKey('qorechain-diana');
  if (toEvmAddress(key.bech32Address).toLowerCase() !== owner.toLowerCase()) throw new Error('Selected QoreX account differs from the vault owner. Switch accounts and reconnect.');
  const result = await provider.signAndBroadcast({ chainId:'qorechain-diana', messages:[build(key.bech32Address)], gasLimit, memo:'Canary testnet vault action' });
  if (result.code !== 0) throw new Error(`QoreX transaction failed (code ${result.code}).`);
  const hash = result.txHash.replace(/^0x/, '').toUpperCase();
  if (!/^[0-9A-F]{64}$/.test(hash)) throw new Error('Wallet returned an invalid transaction hash.');
  for (let attempt=0;attempt<30;attempt++) {
    const response = await fetch(`/api/native-receipt?hash=${hash}`, {cache:'no-store'});
    const receipt = await response.json();
    if (response.ok && receipt.confirmed) {
      if (receipt.code !== 0) throw new Error(`Transaction ${hash} reverted (code ${receipt.code}).`);
      return hash;
    }
    if (!response.ok && response.status !== 404) throw new Error(`Receipt verification unavailable. Check transaction ${hash} before retrying.`);
    await new Promise(resolve=>setTimeout(resolve,2000));
  }
  throw new Error(`Confirmation pending for ${hash}. Check the explorer before retrying.`);
}

export async function sendCheckedContract(owner:Address,target:Address,data:Hex){
  const client=createPublicClient({transport:http('https://evm-testnet.qore.host')});
  if(await client.getChainId()!==9800)throw new Error('Diana testnet required.');
  if(!isAddress(target)||!/^0x([0-9a-fA-F]{2})+$/.test(data))throw new Error('Invalid contract call');
  await client.call({account:owner,to:target,data,gas:2000000n});
  return sendQorexNative(owner,sender=>({typeUrl:'/qorechain.crossvm.v1.MsgCrossVMCall',value:crossVmBytes(sender,target,data)}));
}
