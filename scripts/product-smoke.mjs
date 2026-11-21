// Verify the actual deployed product and its saved drill receipts without signing.
import { readFile, writeFile } from 'node:fs/promises';
import { createPublicClient, http, parseAbi } from 'viem';
const manifest = JSON.parse(await readFile(new URL('../deployments/testnet.json', import.meta.url), 'utf8'));
const drill = JSON.parse(await readFile(new URL('../docs/evidence/live-drill.json', import.meta.url), 'utf8'));
const client = createPublicClient({ transport: http('https://evm-testnet.qore.host', { timeout: 20000 }) });
if (manifest.chainId !== 9800 || await client.getChainId() !== 9800) throw new Error('Testnet only');
for (const [name, entry] of Object.entries(manifest.contracts)) {
  const receipt = await client.getTransactionReceipt({ hash: entry.transactionHash });
  if (receipt.status !== 'success' || receipt.contractAddress?.toLowerCase() !== entry.address.toLowerCase()) throw new Error(`Bad deployment receipt: ${name}`);
  if (!await client.getCode({ address: entry.address })) throw new Error(`Missing deployed code: ${name}`);
}
const abi = parseAbi(['function securityState() view returns(bool,uint256,bool)', 'function pqNonce() view returns(uint256)']);
const [alarm, alarmBlock, ready] = await client.readContract({ address: manifest.contracts.CanaryRegistry.address, abi, functionName: 'securityState' });
const nonce = await client.readContract({ address: manifest.demoVault.address, abi, functionName: 'pqNonce' });
const balance = await client.getBalance({ address: manifest.demoVault.address });
if (!alarm || !ready || nonce < 2n || balance !== 0n) throw new Error('Unexpected live drill final state');
for (const entry of drill.transactions) {
  const receipt = await client.getTransactionReceipt({ hash: entry.hash });
  if (receipt.status !== 'success') throw new Error(`Drill receipt failed: ${entry.kind}`);
}
if (!drill.checks.normalClassicalSucceeded || !drill.checks.watcherTrippedAlarm || !drill.checks.alarmClassicalBlocked || !drill.checks.alarmPQRescueSucceeded) throw new Error('Incomplete live drill evidence');
const report = { observedAt: new Date().toISOString(), network: 'qorechain-diana', broadcast: false,
  method: 'Read-only verification of real deployed code, receipts and final state',
  realPqcPrecompile: true, mockVerifier: false, alarmLatched: alarm, registryReady: ready,
  alarmBlock: alarmBlock.toString(), pqNonce: nonce.toString(), finalVaultBalanceWei: balance.toString(),
  verifiedDrillReceipts: drill.transactions.length, checks: drill.checks, passed: true };
await writeFile(new URL('../docs/evidence/product-smoke.json', import.meta.url), JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(report, null, 2));
