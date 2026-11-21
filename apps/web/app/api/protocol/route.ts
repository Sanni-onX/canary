import manifest from '../../../../../deployments/testnet.json';
import drill from '../../../../../docs/evidence/live-drill.json';
import { createPublicClient, http, parseAbi, isAddress, type Address } from 'viem';
import { toQorAddress, parseEvmWindow } from '@qorechain/evm';
import { assessCoverage, summarizeCoverage, type WindowSnapshot } from '@canary/coverage';

export const dynamic = 'force-dynamic';
const abi = parseAbi([
  'function canaryCount() view returns(uint256)', 'function thresholdK() view returns(uint256)',
  'function toleranceBps() view returns(uint256)', 'function securityState() view returns(bool alarm,uint256 lastBlock,bool ready)',
  'function canaries(uint256) view returns(address addr,uint256 baseline,bytes32 exposureTx,uint64 addedAt,bool retired)',
  'function owner() view returns(address)', 'function rescue() view returns(address)', 'function pqNonce() view returns(uint256)',
  'function locked() view returns(bool)', 'function rollingSpent(address) view returns(uint256)',
  'function policies(address) view returns(uint256 dailyLimit,uint64 timelockDelay,uint64 coolingOff)',
]);

export async function GET() {
  try {
    if (manifest.chainId !== 9800) throw new Error('Non-testnet manifest refused');
    const client = createPublicClient({ transport: http('https://evm-testnet.qore.host', { timeout: 15000, retryCount: 1 }) });
    if (await client.getChainId() !== 9800) throw new Error('Wrong chain');
    const block = await client.getBlockNumber();
    const [head, previous, gasPrice] = await Promise.all([client.getBlock({ blockNumber: block }),
      client.getBlock({ blockNumber: block > 60n ? block - 60n : 0n }), client.getGasPrice()]);
    const blockSeconds = block > 60n ? Number(head.timestamp - previous.timestamp) / 60 : null;
    const registry = manifest.contracts.CanaryRegistry.address as `0x${string}`;
    const [count, k, tolerance, state] = await Promise.all([
      client.readContract({ address: registry, abi, functionName: 'canaryCount', blockNumber: block }),
      client.readContract({ address: registry, abi, functionName: 'thresholdK', blockNumber: block }),
      client.readContract({ address: registry, abi, functionName: 'toleranceBps', blockNumber: block }),
      client.readContract({ address: registry, abi, functionName: 'securityState', blockNumber: block }),
    ]);
    if (count > 16n) throw new Error('Unexpected canary count');
    const canaries = await Promise.all(Array.from({ length: Number(count) }, async (_, index) => {
      const [address, baseline, exposureTx, addedAt, retired] = await client.readContract({ address: registry, abi, functionName: 'canaries', args: [BigInt(index)], blockNumber: block });
      const balance = await client.getBalance({ address, blockNumber: block });
      let window: WindowSnapshot | null = null;
      let transferTargetVerified: boolean | null = null;
      try {
        const response = await fetch(`https://api-testnet.qore.host/qorechain/pqc/v1/evm_window/${toQorAddress(address)}`,
          { cache: 'no-store', signal: AbortSignal.timeout(10000) });
        if (!response.ok) throw new Error('Window query unavailable.');
        const raw = await response.json();
        if (typeof raw.live !== 'boolean') throw new Error('Malformed window response.');
        const parsed = parseEvmWindow(raw);
        window = { live: parsed.live, openedHeight: parsed.openedHeight.toString(), expiryHeight: parsed.expiryHeight.toString(),
          remainingBlocks: parsed.remainingBlocks.toString(), remainingTxs: parsed.remainingTxs.toString(), remainingValueUqor: parsed.remainingValue.toString(),
          nativeOnly: parsed.nativeOnly, allowedTargets: parsed.allowedTargets };
        if (window.live) {
          const targets = window.allowedTargets.length ? window.allowedTargets : [manifest.deployer.evm];
          if (targets.length > 16 || targets.some(target => !isAddress(target))) throw new Error('Invalid target scope.');
          const codes = await Promise.all(targets.map(target => client.getCode({ address: target as Address, blockNumber: block })));
          transferTargetVerified = targets.some((target, index) => target.toLowerCase() !== address.toLowerCase() && (!codes[index] || codes[index] === '0x'));
        }
      } catch { /* Unknown coverage must not be treated as a live window. */ }
      const coverage = assessCoverage({ retired, window, balanceWei: balance, baselineWei: baseline, toleranceBps: tolerance,
        feePerGasWei: gasPrice * 2n, transferTargetVerified });
      return { index, address, baselineWei: baseline.toString(), balanceWei: balance.toString(), exposureTx,
        addedAt: addedAt.toString(), retired, window, coverage, drained: !retired && balance < baseline * (10000n - tolerance) / 10000n };
    }));
    let vault = null;
    if (manifest.demoVault) {
      const address = manifest.demoVault.address as `0x${string}`;
      const [balance, owner, rescue, nonce, locked, policy, spent] = await Promise.all([
        client.getBalance({ address, blockNumber: block }),
        client.readContract({ address, abi, functionName: 'owner', blockNumber: block }),
        client.readContract({ address, abi, functionName: 'rescue', blockNumber: block }),
        client.readContract({ address, abi, functionName: 'pqNonce', blockNumber: block }),
        client.readContract({ address, abi, functionName: 'locked', blockNumber: block }),
        client.readContract({ address, abi, functionName: 'policies', args: ['0x0000000000000000000000000000000000000000'], blockNumber: block }),
        client.readContract({ address, abi, functionName: 'rollingSpent', args: ['0x0000000000000000000000000000000000000000'], blockNumber: block }),
      ]);
      vault = { address, owner, rescue, nonce: nonce.toString(), locked, balanceWei: balance.toString(), spentWei: spent.toString(),
        dailyLimitWei: policy[0].toString(), timelockSeconds: policy[1].toString(), coolingOffSeconds: policy[2].toString(),
        creationHash: manifest.demoVault.creationHash, pqExitHash: manifest.demoVault.pqExitHash ?? null };
    }
    return Response.json({ configured: true, network: manifest.network, chainId: 9800, block: block.toString(), observedAt: new Date().toISOString(),
      bounds: manifest.bounds, alarm: state[0], lastAlarmBlock: state[1].toString(), registryReady: state[2],
      threshold: Number(k), toleranceBps: Number(tolerance), canaries, vault, contracts: manifest.contracts,
      coverage: { ...summarizeCoverage(canaries, Number(k)), blockSeconds,
        note: 'Finite coverage epochs. Renewal requires both classical and PQ keys. Destroyed-key canaries cannot be renewed; new accounts and governance additions are needed before expiry.' },
      drill: drill ? { completedAt: drill.completedAt, checks: drill.checks, transactions: drill.transactions } : null }, { headers: { 'Cache-Control': 'no-store' } });
  } catch {
    return Response.json({ configured: true, error: 'Live testnet state could not be read. No simulated values have been substituted.' }, { status: 502 });
  }
}
