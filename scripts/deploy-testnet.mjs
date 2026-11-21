import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createPublicClient, createWalletClient, defineChain, http, keccak256, toHex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { mldsa87 } from '@qorechain/pqc';
await import('./preload-sdk.mjs');
const { unifiedAccountFromSeed, fetchPqcStatus, isRegisteredPqcKey, EthNativeSigner,
  buildRegisterPqcKeyMsg, signProofOfPossession, openEvmWindowMsg } = await import('@qorechain/sdk');
const { StargateClient } = await import('@cosmjs/stargate');

const REST = 'https://api-testnet.qore.host';
const RPC = 'https://evm-testnet.qore.host';
const chain = defineChain({ id: 9800, name: 'QoreChain Diana testnet', nativeCurrency: { name: 'QOR', symbol: 'QOR', decimals: 18 }, rpcUrls: { default: { http: [RPC] } } });
const client = createPublicClient({ chain, transport: http(RPC, { timeout: 20000 }) });
if (await client.getChainId() !== 9800) throw new Error('Refusing non-testnet network');
const local = JSON.parse(await readFile(new URL('../.local/deployer.json', import.meta.url), 'utf8'));
const seed = Uint8Array.from(Buffer.from(local.classicalSeedHex.slice(2), 'hex'));
const unified = unifiedAccountFromSeed(seed, { recoveryCode: local.pqcRecoveryCode });
seed.fill(0);
const account = privateKeyToAccount(local.classicalSeedHex);
const wallet = createWalletClient({ account, chain, transport: http(RPC) });
await mkdir(new URL('../deployments/', import.meta.url), { recursive: true });
const manifestPath = new URL('../deployments/testnet.json', import.meta.url);
let manifest;
try { manifest = JSON.parse(await readFile(manifestPath, 'utf8')); }
catch (error) { if (error.code !== 'ENOENT') throw error;
  manifest = { network: 'qorechain-diana', chainId: 9800, bounds: 'DEMO ONLY: 60s governance/vault minimum, 10s cooling-off minimum',
    deployer: { native: unified.cosmos, evm: account.address }, contracts: {}, transactions: [], createdAt: new Date().toISOString() }; }
if (manifest.deployer.evm.toLowerCase() !== account.address.toLowerCase()) throw new Error('Manifest belongs to a different deployer.');
const save = () => writeFile(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
const funded = await client.getBalance({ address: account.address });
if (funded < 1500000000000000000n) throw new Error('Fresh deployer needs test QOR before setup/deployment.');
console.log(JSON.stringify({ stage: 'funding_confirmed', account: account.address, balanceWei: funded.toString() }));

async function nativeBroadcast(mode, messages) {
  const response = await fetch(`${REST}/cosmos/auth/v1beta1/accounts/${unified.cosmos}`, { signal: AbortSignal.timeout(20000) });
  if (!response.ok) throw new Error(`Native account query failed: ${response.status}`);
  const body = await response.json();
  const base = body.account?.base_account ?? body.account;
  if (base?.account_number === undefined || base?.sequence === undefined) throw new Error('Unrecognized native account response.');
  const signer = new EthNativeSigner(unified, { signMode: mode, rest: REST });
  const transport = await StargateClient.connect('https://rpc-testnet.qore.host');
  try {
    const result = await signer.signAndBroadcast(transport, { chainId: 'qorechain-diana',
      accountNumber: BigInt(base.account_number), sequence: BigInt(base.sequence),
      fee: { amount: [{ denom: 'uqor', amount: '100000' }], gas: '800000' }, messages });
    if (result.code !== undefined && result.code !== 0) throw new Error(`Native tx failed with code ${result.code}`);
    return result.transactionHash;
  } finally { transport.disconnect(); }
}

async function deployment(name, artifactPath, args) {
  if (manifest.contracts[name]) {
    if (!await client.getCode({ address: manifest.contracts[name].address })) throw new Error(`Missing saved code: ${name}`);
    return manifest.contracts[name].address;
  }
  const artifact = JSON.parse(await readFile(new URL(`../contracts/out/${artifactPath}.json`, import.meta.url), 'utf8'));
  const estimated = await client.estimateGas({ account, data: (await import('viem')).encodeDeployData({ abi: artifact.abi, bytecode: artifact.bytecode.object, args }) });
  const gas = estimated * 12n / 10n;
  if (gas > 10000000n) throw new Error(`Deployment gas exceeds reviewed cap: ${name}`);
  console.log(JSON.stringify({ stage: 'deploying', contract: name, estimatedGas: estimated.toString() }));
  const hash = await wallet.deployContract({ abi: artifact.abi, bytecode: artifact.bytecode.object, args, gas });
  const receipt = await client.waitForTransactionReceipt({ hash, timeout: 90000 });
  if (receipt.status !== 'success' || !receipt.contractAddress) throw new Error(`Deployment failed: ${name} ${hash}`);
  manifest.contracts[name] = { address: receipt.contractAddress, transactionHash: hash,
    blockNumber: receipt.blockNumber.toString(), gasUsed: receipt.gasUsed.toString() };
  manifest.transactions.push({ kind: 'deployment', name, hash });
  await save(); console.log(JSON.stringify({ stage: 'deployed', name, ...manifest.contracts[name] }));
  return receipt.contractAddress;
}

try {
  const status = await fetchPqcStatus({ rest: REST, address: unified.cosmos });
  if (!status.registered) {
    const proof = signProofOfPossession({ chainId: 'qorechain-diana', account: unified.cosmos, keypair: unified.pqc });
    const hash = await nativeBroadcast('classical', [buildRegisterPqcKeyMsg(unified.cosmos, { pqcKeypair: unified.pqc, proofOfPossession: proof })]);
    manifest.transactions.push({ kind: 'pqc_registration', nativeHash: hash }); await save();
    console.log(JSON.stringify({ stage: 'pqc_registered', hash }));
  } else if (!isRegisteredPqcKey(status, unified.pqc.publicKey)) throw new Error('Registered PQ key differs; automatic rotation is not permitted.');

  const window = await (await fetch(`${REST}/qorechain/pqc/v1/evm_window/${unified.cosmos}`, { signal: AbortSignal.timeout(20000) })).json();
  if (!window.live || BigInt(window.remaining_txs ?? '0') < 3n) {
    const request = { sender: unified.cosmos, blocks: 600n, maxTxs: 12n, maxValue: 4000000n };
    const hash = await nativeBroadcast('hybrid', [openEvmWindowMsg(request)]);
    manifest.transactions.push({ kind: 'deployment_window', nativeHash: hash,
      scope: { blocks: '600', maxTxs: '12', maxValueUqor: '4000000', allowedTargets: [], purpose: 'initial contract creation; replaced with target scope after deployment' } });
    await save(); console.log(JSON.stringify({ stage: 'deployment_window_opened', hash }));
  }

  let guardians;
  const guardianPath = new URL('../.local/governance-keys.json', import.meta.url);
  try { guardians = JSON.parse(await readFile(guardianPath, 'utf8')); }
  catch (error) { if (error.code !== 'ENOENT') throw error;
    guardians = Array.from({ length: 3 }, () => { const key = mldsa87.keygen();
      try { return { publicKey: Buffer.from(key.publicKey).toString('base64'), secretKey: Buffer.from(key.secretKey).toString('base64') }; }
      finally { key.secretKey.fill(0); } });
    await writeFile(guardianPath, JSON.stringify(guardians) + '\n', { mode: 0o600, flag: 'wx' });
  }
  const hashes = guardians.map(g => keccak256(Uint8Array.from(Buffer.from(g.publicKey, 'base64'))));
  const governance = await deployment('PQGovernance', 'PQGovernance.sol/PQGovernance', [hashes, 2n, 60n]);
  const registry = await deployment('CanaryRegistry', 'CanaryRegistry.sol/CanaryRegistry', [governance, 2n, 100n, 60n]);
  const factory = await deployment('VaultFactory', 'VaultFactory.sol/VaultFactory', [registry, 60, 10]);
  const scoped = { sender: unified.cosmos, blocks: 600n, maxTxs: 20n, maxValue: 2000000n,
    allowedTargets: [governance, registry, factory] };
  const hash = await nativeBroadcast('hybrid', [openEvmWindowMsg(scoped)]);
  manifest.transactions.push({ kind: 'scoped_window', nativeHash: hash,
    scope: { blocks: '600', maxTxs: '20', maxValueUqor: '2000000', allowedTargets: scoped.allowedTargets } });
  manifest.updatedAt = new Date().toISOString(); await save();
  console.log(JSON.stringify({ stage: 'core_deployment_complete', manifest: 'deployments/testnet.json', scopedWindowHash: hash }));
} finally { unified.pqc.secretKey.fill(0); }
