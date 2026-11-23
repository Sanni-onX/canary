import { getQorexNative } from '@qorechain/qorex-types';
import { toEvmAddress } from '@qorechain/evm';
import { createPublicClient, http, hexToBytes, isAddress, type Address, type Hex } from 'viem';
const utf8 = new TextEncoder();
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
  const provider = getQorexNative();
  if (!provider?.capabilities?.includes('signAndBroadcast')) throw new Error('Open Canary in QoreX or install/update the QoreX extension.');
  await provider.enable('qorechain-diana');
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
