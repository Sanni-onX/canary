// Local-only testnet ceremony. Never accepts a personal wallet/key path.
import { randomBytes, randomUUID, createHash } from 'node:crypto';
import { mkdir, readFile, writeFile, realpath, unlink } from 'node:fs/promises';
import { dirname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createPublicClient, http, parseAbi, toHex, isAddress, encodeFunctionData } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { toQorAddress, evmWindowStatus } from '@qorechain/evm';
import './preload-sdk.mjs';
const { generatePqcRecoveryCode } = await import('@qorechain/sdk');
const root = fileURLToPath(new URL('../', import.meta.url));
const [action, id] = process.argv.slice(2);
const slotFlag=process.argv.indexOf('--slot');
const replacementSlot=slotFlag<0?null:Number(process.argv[slotFlag+1]);
if(replacementSlot!==null&&(!Number.isInteger(replacementSlot)||replacementSlot<0||replacementSlot>15))throw new Error('Replacement slot must be 0 through 15.');
const publicDirectory = resolve(root, 'docs/evidence/ceremonies');
const secretDirectory = resolve(root, '.local/ceremonies');
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const pathCase = path => process.platform === 'win32' ? path.toLowerCase() : path;
async function safeDirectory(path) {
  await mkdir(path, { recursive: true });
  if (!pathCase(await realpath(path)).startsWith(pathCase(await realpath(root)) + sep)) throw new Error('Directory escapes the workspace.');
}
async function save(record) { await writeFile(resolve(publicDirectory, `${record.id}.json`), JSON.stringify(record, null, 2) + '\n'); }
if (action === 'prepare') {
  await safeDirectory(publicDirectory); await safeDirectory(secretDirectory);
  const nextId = randomUUID();
  const seed = randomBytes(32);
  try {
    const account = privateKeyToAccount(toHex(seed));
    const local = { canaryEpochOnly: true, id: nextId, classicalSeedHex: toHex(seed), pqcRecoveryCode: generatePqcRecoveryCode() };
    await writeFile(resolve(secretDirectory, `${nextId}.json`), JSON.stringify(local) + '\n', { mode: 0o600, flag: 'wx' });
    const record = { version: 1, id: nextId, network: 'qorechain-diana', chainId: 9800, createdAt: new Date().toISOString(),
      address: account.address, nativeAddress: toQorAddress(account.address), classicalPublicKey: account.publicKey,
      status: 'prepared-unfunded', exposureHash: null, keyDestructionProven: false, replacementSlot,
      note: 'Local testnet epoch account only. No transaction sent. Independent destruction is not provable.' };
    await writeFile(resolve(publicDirectory, `${nextId}.json`), JSON.stringify(record, null, 2) + '\n', { flag: 'wx' });
    console.log(JSON.stringify(record));
  } finally { seed.fill(0); }
} else {
  if (!['status', 'expose', 'attest-destruction'].includes(action) || !uuid.test(id ?? '')) throw new Error('Usage: canary-ceremony.mjs prepare | status <id> | expose <id> --send | attest-destruction <id> --confirm-destruction');
  if (action === 'expose' && !process.argv.includes('--send')) throw new Error('No transaction sent. Review the account/funding first, then use expose <id> --send.');
  if (action === 'attest-destruction' && !process.argv.includes('--confirm-destruction')) throw new Error('No file removed. Review the irreversible step and pass --confirm-destruction explicitly.');
  await safeDirectory(publicDirectory); await safeDirectory(secretDirectory);
  const record = JSON.parse(await readFile(resolve(publicDirectory, `${id}.json`), 'utf8'));
  if (record.id !== id || record.chainId !== 9800 || !isAddress(record.address)) throw new Error('Invalid ceremony record.');
  const manifest = JSON.parse(await readFile(resolve(root, 'deployments/testnet-v2.json'), 'utf8'));
  if(record.governanceProposal&&record.governanceProposal.target.toLowerCase()!==manifest.contracts.CanaryRegistry.address.toLowerCase())throw new Error('Ceremony belongs to another registry; do not mix epochs.');
  const client = createPublicClient({ transport: http('https://evm-testnet.qore.host', { timeout: 20000 }) });
  if (await client.getChainId() !== 9800) throw new Error('Testnet only.');
  const registryAbi = parseAbi(['function canaryCount() view returns(uint256)',
    'function canaries(uint256) view returns(address,uint256,bytes32,uint64,bool)', 'function addCanary(address,bytes32)', 'function replaceCanary(uint256,address,bytes32)']);
  async function observe() {
    const [balance, window, count] = await Promise.all([client.getBalance({ address: record.address }),
      evmWindowStatus({ rest: 'https://api-testnet.qore.host', address: record.address }),
      client.readContract({ address: manifest.contracts.CanaryRegistry.address, abi: registryAbi, functionName: 'canaryCount' })]);
    if (count > 16n) throw new Error('Unexpected registry size.');
    const entries = await Promise.all(Array.from({ length: Number(count) }, (_, i) => client.readContract({ address: manifest.contracts.CanaryRegistry.address,
      abi: registryAbi, functionName: 'canaries', args: [BigInt(i)] })));
    const entry = entries.find(item => item[0].toLowerCase() === record.address.toLowerCase() && !item[4]);
    return { observedAt: new Date().toISOString(), balanceWei: balance.toString(), live: window.live, expiryHeight: window.expiryHeight.toString(),
      remainingBlocks: window.remainingBlocks.toString(), registered: Boolean(entry), exposureMatches: Boolean(entry && entry[2] === record.exposureHash),
      baselineWei: entry?.[1].toString() ?? null };
  }
  function addProposal(hash) {
    record.governanceProposal = { target: manifest.contracts.CanaryRegistry.address,
      data: record.replacementSlot!==null&&record.replacementSlot!==undefined
        ? encodeFunctionData({abi:registryAbi,functionName:'replaceCanary',args:[BigInt(record.replacementSlot),record.address,hash]})
        : encodeFunctionData({ abi: registryAbi, functionName: 'addCanary', args: [record.address, hash] }),
      note: 'Unsigned proposal only. Quorum approval and timelock execution are separate.' };
  }
  if (action === 'status') {
    if (record.pendingExposureHash && !record.exposureHash) {
      const [receipt, transaction] = await Promise.all([client.getTransactionReceipt({ hash: record.pendingExposureHash }),
        client.getTransaction({ hash: record.pendingExposureHash })]);
      if (receipt.status !== 'success' || transaction.from.toLowerCase() !== record.address.toLowerCase()
        || transaction.to?.toLowerCase() !== record.address.toLowerCase()) throw new Error('Pending exposure did not confirm as the expected self-transaction. No retry was sent.');
      record.exposureHash = record.pendingExposureHash; record.exposureBlock = receipt.blockNumber.toString();
      record.status = 'exposed-keys-retained'; delete record.pendingExposureHash; addProposal(record.exposureHash); await save(record);
    }
    console.log(JSON.stringify({ ...record, observation: await observe() }));
  }
  if (action === 'expose') {
    if (record.exposureHash) throw new Error('Exposure already recorded; never reopen an epoch after destruction.');
    if (record.pendingExposureHash) throw new Error('Exposure was already submitted. Run status to reconcile its receipt; no retry sent.');
    const local = JSON.parse(await readFile(resolve(secretDirectory, `${id}.json`), 'utf8'));
    if (local.canaryEpochOnly !== true || local.id !== id) throw new Error('Not a generated ceremony account.');
    const { testnetSigner } = await import('./testnet-signer.mjs');
    const signer = await testnetSigner(local);
    try {
      if (signer.account.address !== record.address) throw new Error('Account mismatch.');
      if (await client.getBalance({ address: record.address }) < 350000000000000000n) throw new Error('Fund this fresh account with at least 0.35 test QOR before exposure. No funding is automated.');
      const registrationHash = await signer.ensurePqc();
      if (registrationHash) record.registrationHash = registrationHash;
      await save(record);
      record.windowHash = await signer.openWindow([record.address, manifest.deployer.evm], { blocks: 7200n, maxTxs: 2n, maxValue: 200000n, nativeOnly: true });
      await save(record);
      await client.call({ account: signer.account, to: record.address, value: 0n, gas: 21000n });
      const hash = await signer.wallet.sendTransaction({ to: record.address, value: 0n, gas: 21000n });
      record.pendingExposureHash = hash; await save(record);
      const receipt = await client.waitForTransactionReceipt({ hash });
      if (receipt.status !== 'success') throw new Error('Exposure reverted.');
      record.exposureHash = hash; record.status = 'exposed-keys-retained'; record.exposureBlock = receipt.blockNumber.toString();
      delete record.pendingExposureHash; addProposal(hash);
      record.observation = await observe(); await save(record); console.log(JSON.stringify(record));
    } finally { signer.dispose(); local.classicalSeedHex = ''; local.pqcRecoveryCode = ''; }
  }
  if (action === 'attest-destruction') {
    if (!record.exposureHash) throw new Error('A confirmed exposure is required.');
    const [receipt, transaction, observation] = await Promise.all([client.getTransactionReceipt({ hash: record.exposureHash }),
      client.getTransaction({ hash: record.exposureHash }), observe()]);
    if (receipt.status !== 'success' || transaction.from.toLowerCase() !== record.address.toLowerCase()
      || transaction.to?.toLowerCase() !== record.address.toLowerCase() || !observation.registered || !observation.exposureMatches
      || !observation.live || BigInt(observation.remainingBlocks) < 600n) throw new Error('Require confirmed self-exposure, matching governance registration and at least 600 live blocks.');
    const secretPath = await realpath(resolve(secretDirectory, `${id}.json`));
    if (pathCase(dirname(secretPath)) !== pathCase(await realpath(secretDirectory))) throw new Error('Secret path escapes ceremony directory.');
    // Only this tool's generated account file can be removed. Other copies/GC/SSD erasure cannot be proven.
    const local = JSON.parse(await readFile(secretPath, 'utf8'));
    if (local.canaryEpochOnly !== true || local.id !== id || privateKeyToAccount(local.classicalSeedHex).address !== record.address) throw new Error('Generated account file mismatch.');
    await unlink(secretPath); local.classicalSeedHex = ''; local.pqcRecoveryCode = '';
    record.status = 'local-key-file-removal-attested'; record.attestedAt = new Date().toISOString(); record.observation = observation;
    record.keyDestructionProven = false; record.otherCopies = 'not-verifiable';
    record.attestationHash = createHash('sha256').update(JSON.stringify(record)).digest('hex');
    await save(record); console.log(JSON.stringify(record));
  }
}
