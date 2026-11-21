import { readFile, writeFile } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { mldsa87 } from '@qorechain/pqc';
import { encodeFunctionData, toHex, hexToBytes } from 'viem';
import { testnetSigner } from './testnet-signer.mjs';
await import('./preload-sdk.mjs');
const { generatePqcRecoveryCode } = await import('@qorechain/sdk');

const main = await testnetSigner();
const manifestPath = new URL('../deployments/testnet.json', import.meta.url);
const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
const registry = manifest.contracts.CanaryRegistry.address;
const governance = manifest.contracts.PQGovernance.address;
const targets = [...Object.values(manifest.contracts).map(c => c.address), manifest.demoVault.address];
const registryArtifact = JSON.parse(await readFile(new URL('../contracts/out/CanaryRegistry.sol/CanaryRegistry.json', import.meta.url), 'utf8'));
const governanceArtifact = JSON.parse(await readFile(new URL('../contracts/out/PQGovernance.sol/PQGovernance.json', import.meta.url), 'utf8'));
const keyPath = new URL('../.local/drill-accounts.json', import.meta.url);
let local;
try { local = JSON.parse(await readFile(keyPath, 'utf8')); }
catch (error) { if (error.code !== 'ENOENT') throw error;
  local = Array.from({ length: 3 }, () => ({ classicalSeedHex: toHex(randomBytes(32)), pqcRecoveryCode: generatePqcRecoveryCode(), testnetDrillOnly: true }));
  await writeFile(keyPath, JSON.stringify(local, null, 2) + '\n', { mode: 0o600, flag: 'wx' });
}
manifest.drillCanaries ??= [];
const save = () => writeFile(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
const guardianData = JSON.parse(await readFile(new URL('../.local/governance-keys.json', import.meta.url), 'utf8'));
const guardianPairs = guardianData.slice(0, 2).map(g => ({ publicKey: Uint8Array.from(Buffer.from(g.publicKey, 'base64')), secretKey: Uint8Array.from(Buffer.from(g.secretKey, 'base64')) }));
try {
  const windowHash = await main.openWindow(targets);
  manifest.transactions.push({ kind: 'seed_demo_window', nativeHash: windowHash, allowedTargets: targets }); await save();
  for (let index = 0; index < local.length; ++index) {
    const signer = await testnetSigner(local[index]);
    try {
      let entry = manifest.drillCanaries[index];
      if (!entry) {
        entry = { index, nativeAddress: signer.nativeAddress, address: signer.account.address, simulation: true, keyDestructionClaimed: false };
        manifest.drillCanaries[index] = entry; await save();
      }
      if (!entry.fundingHash) {
        // Funding EOAs needs an explicitly approved target in the parent's window.
        const hash = await main.openWindow([...targets, signer.account.address]);
        manifest.transactions.push({ kind: 'drill_funding_window', nativeHash: hash, allowedTargets: [...targets, signer.account.address] }); await save();
        const funding = await main.wallet.sendTransaction({ to: signer.account.address, value: 350000000000000000n, gas: 21000n });
        const receipt = await main.client.waitForTransactionReceipt({ hash: funding, timeout: 90000 });
        if (receipt.status !== 'success') throw new Error('Canary funding failed');
        entry.fundingHash = funding; await save();
      }
      if (!entry.exposureTx) { entry.exposureTx = await signer.ensurePqc(); await save(); }
      // Registration exposed the classical public key. Keys are intentionally retained for this drill.
      entry.windowHash = await signer.openWindow([main.account.address], { maxTxs: 2n, maxValue: 200000n, blocks: 1800n });
      entry.baselineWei = (await signer.client.getBalance({ address: signer.account.address })).toString(); await save();
      console.log(JSON.stringify({ stage: 'drill_canary_ready', index, address: entry.address, baselineWei: entry.baselineWei }));
      const count = await main.client.readContract({ address: registry, abi: registryArtifact.abi, functionName: 'canaryCount' });
      if (BigInt(index) < count) continue;
      const data = encodeFunctionData({ abi: registryArtifact.abi, functionName: 'addCanary', args: [entry.address, `0x${entry.exposureTx}`] });
      if (!entry.proposal) {
        const nonce = await main.client.readContract({ address: governance, abi: governanceArtifact.abi, functionName: 'nonce' });
        const block = await main.client.getBlock(); const deadline = block.timestamp + 3600n;
        const digest = await main.client.readContract({ address: governance, abi: governanceArtifact.abi, functionName: 'actionDigest', args: [registry, data, nonce, deadline] });
        const pks = guardianPairs.map(g => toHex(g.publicKey));
        const sigs = guardianPairs.map(g => toHex(mldsa87.sign(g.secretKey, hexToBytes(digest))));
        const simulation = await main.client.simulateContract({ account: main.account, address: governance, abi: governanceArtifact.abi,
          functionName: 'queue', args: [registry, data, deadline, [0n, 1n], pks, sigs], gas: 2500000n });
        const hash = await main.wallet.writeContract(simulation.request);
        const receipt = await main.client.waitForTransactionReceipt({ hash, timeout: 90000 });
        if (receipt.status !== 'success') throw new Error('PQ governance queue failed');
        entry.proposal = { nonce: nonce.toString(), deadline: deadline.toString(), digest, data, queueHash: hash }; await save();
        console.log(JSON.stringify({ stage: 'pq_governance_queued', index, hash }));
      }
    } finally { signer.dispose(); }
  }
  const classicalOnly = manifest.drillCanaries.map((entry, index) => ({ address: entry.address, privateKey: local[index].classicalSeedHex,
    network: 'qorechain-diana', testnetDrillOnly: true, fundsHaveNoValue: true }));
  await writeFile(new URL('../.local/drill-classical.json', import.meta.url), JSON.stringify(classicalOnly, null, 2) + '\n', { mode: 0o600 });
  for (const entry of manifest.drillCanaries) {
    if (entry.addedHash) continue;
    const proposal = entry.proposal;
    const started = Date.now();
    while (true) {
      const ready = await main.client.readContract({ address: governance, abi: governanceArtifact.abi, functionName: 'readyAt', args: [proposal.digest] });
      if (ready === 0n) throw new Error('Missing queued governance action');
      const block = await main.client.getBlock();
      if (block.timestamp >= ready) break;
      if (Date.now() - started > 150000) throw new Error('Timelock did not mature in the expected interval. Re-run to resume.');
      await new Promise(resolve => setTimeout(resolve, 5000));
    }
    const simulation = await main.client.simulateContract({ account: main.account, address: governance, abi: governanceArtifact.abi, functionName: 'execute',
      args: [registry, proposal.data, BigInt(proposal.nonce), BigInt(proposal.deadline)], gas: 500000n });
    const hash = await main.wallet.writeContract(simulation.request);
    const receipt = await main.client.waitForTransactionReceipt({ hash, timeout: 90000 });
    if (receipt.status !== 'success') throw new Error('Adding canary failed');
    entry.addedHash = hash; await save();
    console.log(JSON.stringify({ stage: 'canary_added_after_timelock', index: entry.index, hash }));
  }
} finally { guardianPairs.forEach(g => g.secretKey.fill(0)); main.dispose(); }
