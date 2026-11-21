import { readFile, writeFile } from 'node:fs/promises';
import { createPublicClient, http, parseAbi, keccak256 } from 'viem';
const manifest = JSON.parse(await readFile(new URL('../deployments/testnet.json', import.meta.url), 'utf8'));
const client = createPublicClient({ transport: http('https://evm-testnet.qore.host') });
if (await client.getChainId() !== 9800) throw new Error('Testnet only');
const compiler = { version: '0.8.28', optimizer: true, optimizerRuns: 200, viaIR: true, evmVersion: 'paris', openZeppelin: '5.6.1' };
const evidence = { observedAt: new Date().toISOString(), network: 'qorechain-diana', compiler, contracts: {}, drillGas: {}, remainingDeployerWei: '' };
function normalizedRuntime(hex, references = {}) {
  const bytes = Buffer.from(hex.slice(2), 'hex');
  // Immutable values are constructor-specific; preserve them in the raw code,
  // but mask their compiler-declared ranges for opcode comparison.
  for (const entries of Object.values(references)) for (const { start, length } of entries) bytes.fill(0, start, start + length);
  const metadataLength = bytes.readUInt16BE(bytes.length - 2);
  if (metadataLength + 2 >= bytes.length) throw new Error('Unexpected metadata trailer');
  return bytes.subarray(0, bytes.length - metadataLength - 2).toString('hex');
}
const addresses = Object.fromEntries(Object.entries(manifest.contracts).map(([name, entry]) => [name, entry.address]));
addresses.PQVault = await client.readContract({ address: manifest.contracts.VaultFactory.address, abi: parseAbi(['function implementation() view returns(address)']), functionName: 'implementation' });
for (const [name, address] of Object.entries(addresses)) {
  const artifact = JSON.parse(await readFile(new URL(`../contracts/out/${name}.sol/${name}.json`, import.meta.url), 'utf8'));
  const code = await client.getCode({ address });
  if (!code) throw new Error(`No code for ${name}`);
  const matches = normalizedRuntime(code, artifact.deployedBytecode.immutableReferences) === normalizedRuntime(artifact.deployedBytecode.object, artifact.deployedBytecode.immutableReferences);
  if (!matches) throw new Error(`Runtime opcodes differ from compiled source for ${name}`);
  evidence.contracts[name] = { address, codeHash: keccak256(code), runtimeCode: code,
    runtimeOpcodeMatch: true, comparison: 'Exact executable runtime bytes, excluding CBOR metadata and compiler-declared constructor immutables',
    immutableReferences: artifact.deployedBytecode.immutableReferences };
  if (manifest.contracts[name]) {
    const transaction = await client.getTransaction({ hash: manifest.contracts[name].transactionHash });
    evidence.contracts[name].creationInput = transaction.input;
  }
}
const drill = JSON.parse(await readFile(new URL('../docs/evidence/live-drill.json', import.meta.url), 'utf8'));
for (const entry of drill.transactions) {
  const receipt = await client.getTransactionReceipt({ hash: entry.hash });
  evidence.drillGas[entry.kind] = { hash: entry.hash, gasUsed: receipt.gasUsed.toString(), effectiveGasPrice: receipt.effectiveGasPrice.toString() };
}
evidence.remainingDeployerWei = (await client.getBalance({ address: manifest.deployer.evm })).toString();
await writeFile(new URL('../audit/deployment-evidence.json', import.meta.url), JSON.stringify(evidence, null, 2) + '\n');
console.log(JSON.stringify({ allRuntimeOpcodesMatch: true, contracts: addresses, drillGas: evidence.drillGas, remainingDeployerWei: evidence.remainingDeployerWei }, null, 2));
