// Public authorization in; operator pays gas. User PQ private keys are never accepted.
import { readFile } from 'node:fs/promises';
import { createPublicClient, http, isAddress, parseAbi, decodeFunctionData, keccak256, hexToBytes } from 'viem';
import { mldsa87 } from '@qorechain/pqc';

const file = process.argv.slice(2).find(arg => !arg.startsWith('--'));
if (!file) throw new Error('Usage: node scripts/pq-rescue.mjs <public-authorization.json> [--submit]');
const text = await readFile(file, 'utf8');
if (text.length > 32000) throw new Error('Authorization file is too large.');
const input = JSON.parse(text);
const allowed = new Set(['version', 'chainId', 'owner', 'vault', 'to', 'value', 'data', 'kind', 'recipient', 'amountWei', 'nonce', 'deadline']);
if (Object.keys(input).some(key => !allowed.has(key)) || input.version !== 1 || input.chainId !== 9800 || input.kind !== 'pq-rescue'
  || !isAddress(input.owner) || !isAddress(input.vault) || input.to !== input.vault || input.value !== '0'
  || typeof input.data !== 'string' || !/^0x(?:[0-9a-fA-F]{2})+$/.test(input.data)) throw new Error('Invalid public rescue authorization. Do not supply wallet or private-key files.');
const manifest = JSON.parse(await readFile(new URL('../deployments/testnet.json', import.meta.url), 'utf8'));
const client = createPublicClient({ transport: http('https://evm-testnet.qore.host', { timeout: 20000 }) });
if (await client.getChainId() !== 9800) throw new Error('Wrong chain. Testnet only.');
const factoryAbi = parseAbi(['function vaultsOf(address) view returns(address[])']);
const vaultAbi = parseAbi(['function pqPkHash() view returns(bytes32)', 'function pqNonce() view returns(uint256)',
  'function rescue() view returns(address)', 'function registry() view returns(address)',
  'function authorizationDigest(bytes32,uint256,uint256) view returns(bytes32)',
  'function withdrawPQ(address,uint256,address,uint256,bytes,bytes)']);
const vaults = await client.readContract({ address: manifest.contracts.VaultFactory.address, abi: factoryAbi, functionName: 'vaultsOf', args: [input.owner] });
if (!vaults.some(vault => vault.toLowerCase() === input.vault.toLowerCase())) throw new Error('Owner/vault binding is not in the deployed factory.');
const decoded = decodeFunctionData({ abi: vaultAbi, data: input.data });
if (decoded.functionName !== 'withdrawPQ') throw new Error('Only a PQ withdrawal can be relayed.');
const [token, amount, recipient, deadline, pk, signature] = decoded.args;
const [keyHash, nonce, rescue, registry, block] = await Promise.all([
  client.readContract({ address: input.vault, abi: vaultAbi, functionName: 'pqPkHash' }),
  client.readContract({ address: input.vault, abi: vaultAbi, functionName: 'pqNonce' }),
  client.readContract({ address: input.vault, abi: vaultAbi, functionName: 'rescue' }),
  client.readContract({ address: input.vault, abi: vaultAbi, functionName: 'registry' }), client.getBlock(),
]);
if (registry.toLowerCase() !== manifest.contracts.CanaryRegistry.address.toLowerCase() || keccak256(pk) !== keyHash
  || nonce.toString() !== input.nonce || deadline.toString() !== input.deadline || amount.toString() !== input.amountWei
  || recipient.toLowerCase() !== rescue.toLowerCase() || recipient.toLowerCase() !== input.recipient?.toLowerCase()
  || deadline <= block.timestamp || deadline > block.timestamp + 600n || amount <= 0n) throw new Error('Stale or mismatched authorization. Refresh the live vault and sign again.');
const { encodeAbiParameters, parseAbiParameters } = await import('viem');
const action = keccak256(encodeAbiParameters(parseAbiParameters('string,address,uint256,address'), ['CANARY_WITHDRAW_V1', token, amount, recipient]));
const digest = await client.readContract({ address: input.vault, abi: vaultAbi, functionName: 'authorizationDigest', args: [action, nonce, deadline] });
if (!mldsa87.verify(hexToBytes(pk), hexToBytes(digest), hexToBytes(signature))) throw new Error('Invalid ML-DSA-87 signature.');
await client.call({ account: input.owner, to: input.vault, data: input.data, gas: 1500000n });
console.log(JSON.stringify({ stage: 'preflight_passed', chainId: 9800, vault: input.vault, token, amountWei: amount.toString(), recipient, nonce: nonce.toString(), deadline: deadline.toString(), broadcast: false }));
if (process.argv.includes('--submit')) {
  const { testnetSigner } = await import('./testnet-signer.mjs');
  const relay = await testnetSigner();
  try {
    await relay.openWindow([input.vault], { blocks: 30n, maxTxs: 1n, maxValue: 500000n });
    // Simulate again with the actual fee payer after opening the window.
    await relay.client.call({ account: relay.account, to: input.vault, data: input.data, gas: 1500000n });
    const hash = await relay.wallet.sendTransaction({ to: input.vault, data: input.data, gas: 1500000n });
    const receipt = await relay.client.waitForTransactionReceipt({ hash, timeout: 90000 });
    if (receipt.status !== 'success') throw new Error(`Rescue reverted: ${hash}`);
    const nextNonce = await relay.client.readContract({ address: input.vault, abi: vaultAbi, functionName: 'pqNonce' });
    if (nextNonce !== nonce + 1n) throw new Error(`Receipt succeeded but nonce did not advance as expected: ${hash}`);
    console.log(JSON.stringify({ stage: 'pq_rescue_confirmed', hash, block: receipt.blockNumber.toString(), nextNonce: nextNonce.toString() }));
  } finally { relay.dispose(); }
}
