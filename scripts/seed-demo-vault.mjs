import { readFile, writeFile } from 'node:fs/promises';
import { mldsa87 } from '@qorechain/pqc';
import { keccak256, toHex, hexToBytes, encodeAbiParameters, parseAbiParameters, decodeEventLog, zeroAddress } from 'viem';
import { testnetSigner } from './testnet-signer.mjs';

const connection = await testnetSigner();
const { client, wallet, account, openWindow } = connection;
const revision2 = process.argv.includes('--revision-2');
const manifestPath = new URL(revision2 ? '../deployments/testnet-v2.json' : '../deployments/testnet.json', import.meta.url);
const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
const artifact = async name => JSON.parse(await readFile(new URL(`../contracts/out/${name}.sol/${name}.json`, import.meta.url), 'utf8'));
const factoryArtifact = await artifact('VaultFactory'); const vaultArtifact = await artifact('PQVault');
const factory = manifest.contracts.VaultFactory.address;
const targets = Object.values(manifest.contracts).map(entry => entry.address);
const save = () => writeFile(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
const keyPath = new URL(revision2 ? '../.local/demo-vault-v2-key.json' : '../.local/demo-vault-key.json', import.meta.url);
let pair;
try { const data = JSON.parse(await readFile(keyPath, 'utf8')); pair = { publicKey: Uint8Array.from(Buffer.from(data.publicKey, 'base64')), secretKey: Uint8Array.from(Buffer.from(data.secretKey, 'base64')) }; }
catch (error) { if (error.code !== 'ENOENT') throw error;
  pair = mldsa87.keygen(); await writeFile(keyPath, JSON.stringify({ testnetDemoOnly: true, publicKey: Buffer.from(pair.publicKey).toString('base64'), secretKey: Buffer.from(pair.secretKey).toString('base64') }) + '\n', { mode: 0o600, flag: 'wx' }); }
try {
  if (!manifest.demoVault) {
    const policy = { dailyLimit: 100000000000000000n, timelockDelay: 60, coolingOff: 10 };
    const digest = await client.readContract({ address: factory, abi: factoryArtifact.abi, functionName: 'bindingDigest', args: [account.address, keccak256(pair.publicKey), account.address, policy] });
    const proof = toHex(mldsa87.sign(pair.secretKey, hexToBytes(digest)));
    const simulation = await client.simulateContract({ account, address: factory, abi: factoryArtifact.abi, functionName: 'createVault',
      args: [account.address, keccak256(pair.publicKey), account.address, policy, toHex(pair.publicKey), proof], gas: 1500000n });
    const hash = await wallet.writeContract(simulation.request);
    const receipt = await client.waitForTransactionReceipt({ hash, timeout: 90000 });
    if (receipt.status !== 'success') throw new Error('Vault creation failed');
    const created = receipt.logs.flatMap(log => { try { const decoded = decodeEventLog({ abi: factoryArtifact.abi, ...log }); return decoded.eventName === 'VaultCreated' ? [decoded.args] : []; } catch { return []; } })[0];
    if (!created?.vault) throw new Error('Vault creation event missing');
    manifest.demoVault = { address: created.vault, owner: account.address, rescue: account.address, pqKeyHash: keccak256(pair.publicKey),
      creationHash: hash, blockNumber: receipt.blockNumber.toString(), note: 'Local operator-owned demo vault; no user PQ key stored on a server.' };
    await save(); console.log(JSON.stringify({ stage: 'demo_vault_created', ...manifest.demoVault }));
  }
  const vault = manifest.demoVault.address;
  // Verify getters and ownership before sending even a tiny test deposit.
  const [owner, keyHash, nonce] = await Promise.all(['owner', 'pqPkHash', 'pqNonce'].map(functionName => client.readContract({ address: vault, abi: vaultArtifact.abi, functionName })));
  if (owner.toLowerCase() !== account.address.toLowerCase() || keyHash !== keccak256(pair.publicKey)) throw new Error('Unexpected demo vault binding.');
  console.log(JSON.stringify({ stage: 'demo_vault_binding_checked', address: vault, pqNonce: nonce.toString() }));
  const windowHash = await openWindow([...targets, vault]);
  manifest.transactions.push({ kind: 'demo_vault_scoped_window', nativeHash: windowHash, allowedTargets: [...targets, vault] }); await save();
  if (!manifest.demoVault.testDepositHash) {
    await client.call({ account, to: vault, value: 1000000000000000n, gas: 150000n });
    const hash = await wallet.sendTransaction({ to: vault, value: 1000000000000000n, gas: 150000n });
    const receipt = await client.waitForTransactionReceipt({ hash, timeout: 90000 });
    if (receipt.status !== 'success') throw new Error('Test deposit failed');
    manifest.demoVault.testDepositHash = hash; await save();
    console.log(JSON.stringify({ stage: 'tiny_test_deposit', hash, amountQor: '0.001' }));
  }
  if (!manifest.demoVault.pqExitHash) {
    const nonce = await client.readContract({ address: vault, abi: vaultArtifact.abi, functionName: 'pqNonce' });
    const block = await client.getBlock(); const deadline = block.timestamp + 600n;
    const action = keccak256(encodeAbiParameters(parseAbiParameters('string,address,uint256,address'), ['CANARY_WITHDRAW_V1', zeroAddress, 1000000000000000n, account.address]));
    const digest = await client.readContract({ address: vault, abi: vaultArtifact.abi, functionName: 'authorizationDigest', args: [action, nonce, deadline] });
    const proof = toHex(mldsa87.sign(pair.secretKey, hexToBytes(digest)));
    const simulation = await client.simulateContract({ account, address: vault, abi: vaultArtifact.abi, functionName: 'withdrawPQ',
      args: [zeroAddress, 1000000000000000n, account.address, deadline, toHex(pair.publicKey), proof], gas: 1500000n });
    const hash = await wallet.writeContract(simulation.request);
    const receipt = await client.waitForTransactionReceipt({ hash, timeout: 90000 });
    if (receipt.status !== 'success') throw new Error('PQ exit failed');
    manifest.demoVault.pqExitHash = hash; manifest.demoVault.pqExitGas = receipt.gasUsed.toString(); await save();
    console.log(JSON.stringify({ stage: 'real_pq_exit_passed', hash, gasUsed: receipt.gasUsed.toString() }));
  }
} finally { pair.secretKey.fill(0); connection.dispose(); }
