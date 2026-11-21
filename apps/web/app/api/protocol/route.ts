import manifest from '../../../../../deployments/testnet.json';
import drill from '../../../../../docs/evidence/live-drill.json';
import { createPublicClient, http, parseAbi } from 'viem';

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
      return { index, address, baselineWei: baseline.toString(), balanceWei: balance.toString(), exposureTx,
        addedAt: addedAt.toString(), retired, drained: !retired && balance < baseline * (10000n - tolerance) / 10000n };
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
      drill: drill ? { completedAt: drill.completedAt, checks: drill.checks, transactions: drill.transactions } : null }, { headers: { 'Cache-Control': 'no-store' } });
  } catch {
    return Response.json({ configured: true, error: 'Live testnet state could not be read. No simulated values have been substituted.' }, { status: 502 });
  }
}
