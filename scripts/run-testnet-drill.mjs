import { readFile, writeFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { createWalletClient, http, keccak256, encodeAbiParameters, parseAbiParameters, toHex, hexToBytes, zeroAddress } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { mldsa87 } from '@qorechain/pqc';
import { testnetSigner } from './testnet-signer.mjs';

const main = await testnetSigner();
const manifestPath = new URL('../deployments/testnet.json', import.meta.url);
const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
if (manifest.chainId !== 9800 || !manifest.drillCanaries || manifest.drillCanaries.length < 3) throw new Error('Seed the labeled testnet drill first.');
const vault = manifest.demoVault.address;
const registry = manifest.contracts.CanaryRegistry.address;
const vaultArtifact = JSON.parse(await readFile(new URL('../contracts/out/PQVault.sol/PQVault.json', import.meta.url), 'utf8'));
const registryArtifact = JSON.parse(await readFile(new URL('../contracts/out/CanaryRegistry.sol/CanaryRegistry.json', import.meta.url), 'utf8'));
const keyFile = JSON.parse(await readFile(new URL('../.local/demo-vault-key.json', import.meta.url), 'utf8'));
const pair = { publicKey: Uint8Array.from(Buffer.from(keyFile.publicKey, 'base64')), secretKey: Uint8Array.from(Buffer.from(keyFile.secretKey, 'base64')) };
const evidencePath = new URL('../docs/evidence/live-drill.json', import.meta.url);
let evidence;
try { evidence = JSON.parse(await readFile(evidencePath, 'utf8')); }
catch (error) { if (error.code !== 'ENOENT') throw error; evidence = { network: 'qorechain-diana', simulation: true,
  realTransactions: true, fundsHaveNoValue: true, canaryKeysIntentionallyRetained: true, vault, registry, checks: {}, transactions: [] }; }
const save = () => writeFile(evidencePath, JSON.stringify(evidence, null, 2) + '\n');
const receipt = async hash => { const result = await main.client.waitForTransactionReceipt({ hash, timeout: 90000 }); if (result.status !== 'success') throw new Error(`Transaction failed: ${hash}`); return result; };
try {
  const targets = [...Object.values(manifest.contracts).map(c => c.address), vault];
  const windowHash = await main.openWindow(targets);
  manifest.transactions.push({ kind: 'live_drill_window', nativeHash: windowHash, allowedTargets: targets });
  await writeFile(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
  if (!evidence.checks.normalClassicalSucceeded) {
    const [alarm,, ready] = await main.client.readContract({ address: registry, abi: registryArtifact.abi, functionName: 'securityState' });
    if (alarm || !ready) throw new Error('Normal-path test requires seeded, untripped registry.');
    await main.client.call({ account: main.account, to: vault, value: 3000000000000000n, gas: 150000n });
    const deposit = await main.wallet.sendTransaction({ to: vault, value: 3000000000000000n, gas: 150000n }); await receipt(deposit);
    const simulation = await main.client.simulateContract({ account: main.account, address: vault, abi: vaultArtifact.abi, functionName: 'withdrawClassical', args: [zeroAddress, 100000000000000n, main.account.address], gas: 600000n });
    const hash = await main.wallet.writeContract(simulation.request); await receipt(hash);
    evidence.transactions.push({ kind: 'demo_deposit', hash: deposit }, { kind: 'normal_classical_withdrawal', hash });
    evidence.checks.normalClassicalSucceeded = true; await save(); console.log(JSON.stringify({ stage: 'normal_classical_passed', hash }));
  }
  const keys = JSON.parse(await readFile(new URL('../.local/drill-classical.json', import.meta.url), 'utf8'));
  for (let index = 0; index < 2; ++index) {
    if (evidence.transactions.some(tx => tx.kind === `drain_${index}`)) continue;
    const entry = keys[index];
    if (entry.network !== 'qorechain-diana' || entry.testnetDrillOnly !== true || entry.address.toLowerCase() !== manifest.drillCanaries[index].address.toLowerCase()) throw new Error('Unexpected drill account.');
    const account = privateKeyToAccount(entry.privateKey);
    const window = await (await fetch(`https://api-testnet.qore.host/qorechain/pqc/v1/evm_window/${manifest.drillCanaries[index].nativeAddress}`)).json();
    if (!window.live) throw new Error('Drill account window expired; refresh it locally with seed-drill-canaries.mjs.');
    const wallet = createWalletClient({ account, chain: main.wallet.chain, transport: http('https://evm-testnet.qore.host') });
    const balance = await main.client.getBalance({ address: account.address });
    const maxFee = 200000000000n; const feeBudget = 21000n * maxFee;
    if (balance <= feeBudget) throw new Error('Drill canary lacks fee budget');
    await main.client.call({ account, to: main.account.address, value: balance - feeBudget, gas: 21000n });
    const hash = await wallet.sendTransaction({ to: main.account.address, value: balance - feeBudget, gas: 21000n,
      maxFeePerGas: maxFee, maxPriorityFeePerGas: 12500000000n });
    await receipt(hash); evidence.transactions.push({ kind: `drain_${index}`, hash }); await save();
    console.log(JSON.stringify({ stage: 'classical_key_drained_drill_canary', index, hash }));
  }
  if (!evidence.checks.watcherTrippedAlarm) {
    const local = JSON.parse(await readFile(new URL('../.local/deployer.json', import.meta.url), 'utf8'));
    const child = spawn(process.execPath, ['--import', 'tsx', 'services/watcher/src/index.ts', '--once'], {
      cwd: new URL('../', import.meta.url), windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, CANARY_REGISTRY_ADDRESS: registry, WATCHER_DB: new URL('../.local/watcher-demo.sqlite', import.meta.url).pathname.replace(/^\/(.:)/, '$1'), WATCHER_PRIVATE_KEY: local.classicalSeedHex },
    });
    let output = ''; child.stdout.on('data', chunk => output += chunk); child.stderr.on('data', chunk => output += chunk);
    const code = await new Promise((resolve, reject) => { child.once('error', reject); child.once('exit', resolve); });
    if (code !== 0) throw new Error(`Watcher did not complete successfully: ${output}`);
    console.log(output.trim());
    const alarm = await main.client.readContract({ address: registry, abi: registryArtifact.abi, functionName: 'alarmed' });
    if (!alarm) throw new Error('Watcher did not persist the alarm.');
    const event = output.split('\n').flatMap(line => { try { const parsed = JSON.parse(line); return parsed.kind === 'alarm_tripped' ? [parsed] : []; } catch { return []; } })[0];
    if (event?.detail?.hash) evidence.transactions.push({ kind: 'watcher_alarm', hash: event.detail.hash });
    evidence.checks.watcherTrippedAlarm = true; await save();
  }
  if (!evidence.checks.alarmClassicalBlocked) {
    const before = await main.client.getBalance({ address: vault });
    let rejected = false;
    try { await main.client.simulateContract({ account: main.account, address: vault, abi: vaultArtifact.abi, functionName: 'withdrawClassical', args: [zeroAddress, 1n, main.account.address], gas: 600000n }); }
    catch (error) { if (!String(error).includes('ClassicalFrozen')) throw error; rejected = true; }
    const after = await main.client.getBalance({ address: vault });
    if (!rejected || before !== after) throw new Error('Classical rejection check failed.');
    evidence.checks.alarmClassicalBlocked = true;
    evidence.checks.classicalRejection = 'ClassicalFrozen decoded from eth_call; rejected before broadcast; vault balance unchanged';
    await save(); console.log(JSON.stringify({ stage: 'alarm_classical_blocked', balanceWei: after.toString() }));
  }
  if (!evidence.checks.alarmPQRescueSucceeded) {
    const balance = await main.client.getBalance({ address: vault });
    const nonce = await main.client.readContract({ address: vault, abi: vaultArtifact.abi, functionName: 'pqNonce' });
    const block = await main.client.getBlock(); const deadline = block.timestamp + 600n;
    const action = keccak256(encodeAbiParameters(parseAbiParameters('string,address,uint256,address'), ['CANARY_WITHDRAW_V1', zeroAddress, balance, main.account.address]));
    const digest = await main.client.readContract({ address: vault, abi: vaultArtifact.abi, functionName: 'authorizationDigest', args: [action, nonce, deadline] });
    const proof = toHex(mldsa87.sign(pair.secretKey, hexToBytes(digest)));
    const simulation = await main.client.simulateContract({ account: main.account, address: vault, abi: vaultArtifact.abi, functionName: 'withdrawPQ', args: [zeroAddress, balance, main.account.address, deadline, toHex(pair.publicKey), proof], gas: 1500000n });
    const hash = await main.wallet.writeContract(simulation.request); const result = await receipt(hash);
    const after = await main.client.getBalance({ address: vault });
    if (after !== 0n) throw new Error('Rescue did not release the expected demo balance');
    evidence.transactions.push({ kind: 'alarm_pq_rescue', hash, gasUsed: result.gasUsed.toString(), amountWei: balance.toString() });
    evidence.checks.alarmPQRescueSucceeded = true; evidence.finalVaultBalanceWei = after.toString(); evidence.completedAt = new Date().toISOString();
    await save(); console.log(JSON.stringify({ stage: 'full_live_drill_passed', hash, amountWei: balance.toString() }));
  }
} finally { pair.secretKey.fill(0); main.dispose(); }
