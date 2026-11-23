import { createServer } from 'node:http';
import { DatabaseSync } from 'node:sqlite';
import { createPublicClient, createWalletClient, http, webSocket, isAddress, parseAbi, type Address } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { defineChain } from 'viem';
import { parseEvmWindow, toQorAddress } from '@qorechain/evm';
import { assessCoverage, summarizeCoverage, type WindowSnapshot, type Coverage } from '@canary/coverage';

const address = process.env.CANARY_REGISTRY_ADDRESS;
if (!address || !isAddress(address) || /^0x0{40}$/i.test(address)) throw new Error('Set CANARY_REGISTRY_ADDRESS to the deployed testnet registry.');
const registry: Address = address;
const rpc = process.env.QORE_EVM_RPC_URL ?? 'https://evm-testnet.qore.host';
const nativeRest = process.env.QORE_REST_URL ?? (process.env.QORE_EVM_RPC_URL ? undefined : 'https://api-testnet.qore.host');
const chain = defineChain({ id: 9800, name: 'QoreChain Diana testnet', nativeCurrency: { name: 'QOR', symbol: 'QOR', decimals: 18 }, rpcUrls: { default: { http: [rpc] } } });
const publicClient = createPublicClient({ chain, transport: http(rpc, { timeout: 15000, retryCount: 2 }) });
const abi = parseAbi([
  'function canaryCount() view returns (uint256)',
  'function canaries(uint256) view returns (address addr,uint256 baseline,bytes32 exposureTx,uint64 addedAt,bool retired)',
  'function thresholdK() view returns (uint256)', 'function toleranceBps() view returns (uint256)',
  'function alarmed() view returns (bool)', 'function checkAndTrip() returns (bool)',
]);
const db = new DatabaseSync(process.env.WATCHER_DB ?? 'canary-watcher.sqlite');
db.exec('PRAGMA journal_mode=WAL; CREATE TABLE IF NOT EXISTS snapshots (block TEXT, canary INTEGER, balance TEXT, baseline TEXT, PRIMARY KEY(block,canary)); CREATE TABLE IF NOT EXISTS events (id INTEGER PRIMARY KEY, observed_at TEXT, block TEXT, kind TEXT, detail TEXT); CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY,value TEXT); CREATE TABLE IF NOT EXISTS canary_state (canary INTEGER PRIMARY KEY,address TEXT,retired INTEGER)');
const insert = db.prepare('INSERT OR REPLACE INTO snapshots VALUES (?,?,?,?)');
const event = db.prepare('INSERT INTO events(observed_at,block,kind,detail) VALUES (?,?,?,?)');
let lastSuccess = 0;
let lastBlock: string | null = null;
let lastError: string | null = null;
let alarm = false;
let drained = 0;
let running = false;
let stopped = false;
let coverageState: ReturnType<typeof summarizeCoverage> | null = null;
let epochStates: { index: number; coverage: Coverage }[] = [];

function record(block: bigint, kind: string, detail: unknown) {
  const body = JSON.stringify(detail);
  event.run(new Date().toISOString(), block.toString(), kind, body);
  console.log(JSON.stringify({ at: new Date().toISOString(), block: block.toString(), kind, detail }));
}

async function check() {
  if (running || stopped) return;
  running = true;
  try {
    if (await publicClient.getChainId() !== 9800) throw new Error('Refusing non-testnet chain.');
    if (await publicClient.getCode({ address: registry }) === undefined) throw new Error('No deployed registry at configured address.');
    const block = await publicClient.getBlock();
    if (Date.now() / 1000 - Number(block.timestamp) > 120) throw new Error('RPC latest block is more than two minutes old.');
    const read = <T>(functionName: string, args: readonly unknown[] = []) => publicClient.readContract({ address: registry, abi, functionName, args, blockNumber: block.number } as Parameters<typeof publicClient.readContract>[0]) as Promise<T>;
    const [count, k, tolerance, latched] = await Promise.all([read<bigint>('canaryCount'), read<bigint>('thresholdK'), read<bigint>('toleranceBps'), read<boolean>('alarmed')]);
    const gasPrice = await publicClient.getGasPrice().catch(() => 0n);
    if (count > 16n || k === 0n || tolerance >= 10000n) throw new Error('Unexpected registry configuration.');
    const snapshots = await Promise.all(Array.from({ length: Number(count) }, async (_, index) => {
      const [account, baseline, , , retired] = await read<readonly [Address, bigint, string, bigint, boolean]>('canaries', [BigInt(index)]);
      const priorState = db.prepare('SELECT address,retired FROM canary_state WHERE canary=?').get(index) as { address: string; retired: number } | undefined;
      if (priorState && !priorState.retired && retired) record(block.number, 'canary_retired', { index, account });
      if (priorState && priorState.address !== account) record(block.number, 'canary_replaced', { index, previous: priorState.address, account });
      db.prepare('INSERT OR REPLACE INTO canary_state VALUES (?,?,?)').run(index, account, retired ? 1 : 0);
      const balance = await publicClient.getBalance({ address: account, blockNumber: block.number });
      const previous = db.prepare('SELECT balance FROM snapshots WHERE canary=? ORDER BY length(block) DESC,block DESC LIMIT 1').get(index) as { balance?: string } | undefined;
      if (previous?.balance !== undefined && BigInt(previous.balance) !== balance) record(block.number, 'balance_changed', { index, previous: previous.balance, balance: balance.toString() });
      insert.run(block.number.toString(), index, balance.toString(), baseline.toString());
      let window: WindowSnapshot | null = null;
      let transferTargetVerified: boolean | null = null;
      if (nativeRest && !retired) {
        try {
          const response = await fetch(`${nativeRest}/qorechain/pqc/v1/evm_window/${toQorAddress(account)}`, { signal: AbortSignal.timeout(10000) });
          if (!response.ok) throw new Error('Window read failed.');
          const raw = await response.json();
          if (typeof raw.live !== 'boolean') throw new Error('Malformed window.');
          const parsed = parseEvmWindow(raw);
          window = { live: parsed.live, openedHeight: parsed.openedHeight.toString(), expiryHeight: parsed.expiryHeight.toString(),
            remainingBlocks: parsed.remainingBlocks.toString(), remainingTxs: parsed.remainingTxs.toString(), remainingValueUqor: parsed.remainingValue.toString(),
            nativeOnly: parsed.nativeOnly, allowedTargets: parsed.allowedTargets };
          if (window.live) {
            // Empty recipient scope admits any EOA; a different fixed testnet EOA suffices for this reachability check.
            const targets = window.allowedTargets.length ? window.allowedTargets : ['0x000000000000000000000000000000000000dead'];
            if (targets.length > 16 || targets.some(target => !isAddress(target))) throw new Error('Invalid window targets.');
            const codes = await Promise.all(targets.map(target => publicClient.getCode({ address: target as Address, blockNumber: block.number })));
            transferTargetVerified = targets.some((target, i) => target.toLowerCase() !== account.toLowerCase() && (!codes[i] || codes[i] === '0x'));
          }
        } catch { /* Coverage becomes unknown; balance alarm evaluation continues independently. */ }
      }
      return { retired, drained: !retired && balance < baseline * (10000n - tolerance) / 10000n,
        coverage: assessCoverage({ retired, window, balanceWei: balance, baselineWei: baseline, toleranceBps: tolerance,
          feePerGasWei: gasPrice * 2n, transferTargetVerified }) };
    }));
    coverageState = summarizeCoverage(snapshots, Number(k));
    epochStates = snapshots.map((item, index) => ({ index, coverage: item.coverage }));
    db.prepare('INSERT OR REPLACE INTO meta VALUES (?,?)').run('coverage_epochs', JSON.stringify(epochStates));
    const signature = JSON.stringify({ ...coverageState, epochs: snapshots.map(item => [item.coverage.status, item.coverage.openedHeight, item.coverage.expiryHeight]) });
    const priorCoverage = db.prepare("SELECT value FROM meta WHERE key='coverage'").get() as { value: string } | undefined;
    if (signature !== priorCoverage?.value) record(block.number, coverageState.degraded ? 'coverage_degraded' : 'coverage_ready', {
      ...coverageState, epochs: snapshots.map((item, index) => ({ index, ...item.coverage })),
      action: 'Finite epochs: arrange replacement before expiry. PQ-only renewal is not supported; lapse is not an alarm.' });
    db.prepare('INSERT OR REPLACE INTO meta VALUES (?,?)').run('coverage', signature);
    drained = snapshots.filter(item => item.drained).length;
    const priorAlarm = alarm;
    alarm = latched;
    if (!latched && BigInt(drained) >= k) {
      const key = process.env.WATCHER_PRIVATE_KEY;
      if (!key) { record(block.number, 'submission_needed', { drained, threshold: k.toString(), reason: 'No bot signer configured; anyone may call checkAndTrip.' }); }
      else {
        if (!/^0x[0-9a-fA-F]{64}$/.test(key)) throw new Error('Invalid bot key format.');
        const account = privateKeyToAccount(key as `0x${string}`);
        const simulation = await publicClient.simulateContract({ address: registry, abi, functionName: 'checkAndTrip', account });
        const wallet = createWalletClient({ account, chain, transport: http(rpc) });
        const hash = await wallet.writeContract(simulation.request);
        const receipt = await publicClient.waitForTransactionReceipt({ hash, timeout: 45000 });
        if (receipt.status !== 'success') throw new Error('Alarm transaction reverted.');
        alarm = await publicClient.readContract({ address: registry, abi, functionName: 'alarmed' });
        record(receipt.blockNumber, alarm ? 'alarm_tripped' : 'check_completed', { hash });
      }
    }
    if (latched && !priorAlarm) record(block.number, 'alarm_observed', { registry });
    if (!latched && priorAlarm) record(block.number, 'governance_reset_observed', { registry });
    lastBlock = block.number.toString();
    db.prepare('INSERT OR REPLACE INTO meta VALUES (?,?)').run('last_block', lastBlock);
    lastSuccess = Date.now(); lastError = null;
  } catch (error) {
    lastError = error instanceof Error ? error.message : 'Unknown watcher failure';
    console.error(JSON.stringify({ kind: 'watcher_error', message: lastError }));
  } finally { running = false; }
}

await check();
if (process.argv.includes('--once')) { db.close(); if (lastError) process.exitCode = 1; }
else {
  const status = () => ({ network: 'qorechain-diana', registry, alarm, drained, lastBlock,
    lastSuccess: lastSuccess ? new Date(lastSuccess).toISOString() : null, error: lastError,
    submitterConfigured: Boolean(process.env.WATCHER_PRIVATE_KEY), coverage: coverageState,
    coverageMode: 'finite-epochs', epochs: epochStates, nativeCoverageConfigured: Boolean(nativeRest) });
  const server = createServer((request, response) => {
    if (!['/health', '/status'].includes(request.url ?? '')) { response.writeHead(404); response.end(); return; }
    const healthy = !lastError && Date.now() - lastSuccess < 120000;
    response.writeHead(request.url === '/health' && !healthy ? 503 : 200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    response.end(JSON.stringify({ ...status(), healthy }));
  });
  server.listen(Number(process.env.PORT ?? process.env.WATCHER_PORT ?? 8787), process.env.WATCHER_HOST ?? '127.0.0.1');
  const websocketUrl = process.env.QORE_EVM_WS_URL ?? (process.env.QORE_EVM_RPC_URL ? undefined : 'wss://evm-ws-testnet.qore.host');
  const stream = websocketUrl ? createPublicClient({ chain, transport: webSocket(websocketUrl) }) : null;
  const unwatch = stream?.watchBlocks({ emitMissed: true,
    onBlock: () => { void check(); },
    onError: () => { console.warn(JSON.stringify({ kind: 'block_stream_unavailable', fallback: 'HTTP polling remains active' })); },
  });
  let failures = 0;
  // Block polling works on HTTP-only RPCs; bounded exponential backoff on RPC failure.
  const loop = async () => { await check(); failures = lastError ? Math.min(failures + 1, 5) : 0;
    if (!stopped) setTimeout(() => void loop(), Math.min(60000, 3000 * 2 ** failures)).unref(); };
  void loop();
  const shutdown = () => { stopped = true; unwatch?.(); server.close(); if (!running) db.close(); };
  process.once('SIGINT', shutdown); process.once('SIGTERM', shutdown);
}
