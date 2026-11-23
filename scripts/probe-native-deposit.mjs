import { readFile, writeFile } from 'node:fs/promises';
import { toQorAddress } from '@qorechain/evm';
import { testnetSigner } from './testnet-signer.mjs';
const manifest=JSON.parse(await readFile(new URL('../deployments/testnet-v2.json',import.meta.url)));
const signer=await testnetSigner();
try {
  const vault=manifest.demoVault.address;
  const before=await signer.client.getBalance({address:vault});
  const hash=await signer.nativeBroadcast('hybrid',[{typeUrl:'/cosmos.bank.v1beta1.MsgSend',value:{fromAddress:signer.nativeAddress,toAddress:toQorAddress(vault),amount:[{denom:'uqor',amount:'1'}]}}],'300000','30000');
  const after=await signer.client.getBalance({address:vault});
  if(after!==before+1000000000000n)throw new Error('Native deposit did not credit EVM vault balance');
  const result={observedAt:new Date().toISOString(),vault,nativeHash:hash,amountUqor:'1',beforeWei:before.toString(),afterWei:after.toString(),nativeDepositVerified:true};
  await writeFile(new URL('../docs/evidence/native-deposit-probe.json',import.meta.url),JSON.stringify(result,null,2)+'\n');
  console.log(JSON.stringify(result));
}finally{signer.dispose();}
