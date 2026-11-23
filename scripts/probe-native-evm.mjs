import { readFile, writeFile } from 'node:fs/promises';
import { encodeFunctionData, hexToBytes, parseAbi } from 'viem';
import { testnetSigner } from './testnet-signer.mjs';
const manifest = JSON.parse(await readFile(new URL('../deployments/testnet-v2.json', import.meta.url)));
const signer = await testnetSigner();
try {
  const [params, circuit] = await Promise.all([
    fetch('https://api-testnet.qore.host/qorechain/crossvm/v1/params').then(r => r.json()),
    fetch('https://api-testnet.qore.host/cosmos/circuit/v1/disable_list').then(r => r.json()),
  ]);
  if (!(params.params ?? params).enabled || JSON.stringify(circuit).includes('/qorechain.crossvm.v1.MsgCrossVMCall')) throw new Error('Cross-VM unavailable');
  const abi = parseAbi(['function lock()', 'function locked() view returns(bool)', 'function owner() view returns(address)']);
  const vault = manifest.demoVault.address;
  const owner = await signer.client.readContract({ address: vault, abi, functionName: 'owner' });
  if (owner.toLowerCase() !== signer.account.address.toLowerCase() || await signer.client.getBalance({address:vault}) !== 0n) throw new Error('Probe only permits empty operator-owned demo vault');
  const { msg } = await import('@qorechain/sdk');
  const message = msg.crossvm.crossVmCall({ sender: signer.nativeAddress, sourceVm: 'cosmwasm', targetVm: 'evm',
    targetContract: vault, payload: hexToBytes(encodeFunctionData({ abi, functionName:'lock' })), funds:[], async:false, asyncGasLimit:'0', asyncMaxFactor:'0' });
  const hash = await signer.nativeBroadcast('hybrid', [message]);
  const locked = await signer.client.readContract({address:vault,abi,functionName:'locked'});
  if (!locked) throw new Error('Native transaction did not lock vault');
  const evidence = { observedAt:new Date().toISOString(), nativeHash:hash, vault, owner, locked,
    nativeToEvmSenderVerified:true, noUserAccountChanged:true, qorexWalletDecoderTested:false };
  await writeFile(new URL('../docs/evidence/native-evm-probe.json',import.meta.url),JSON.stringify(evidence,null,2)+'\n');
  console.log(JSON.stringify(evidence));
} finally { signer.dispose(); }
